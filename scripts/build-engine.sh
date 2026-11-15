#!/usr/bin/env bash
# Build the Crawl engine for the browser. Run scripts/fetch-engine.sh first.
#
# Output: engine-build/<build>/   (<build> comes from engine.json)
#   crawl.js crawl.wasm crawl.data   the engine, its data and the cache seed
#   gamedata/                        tile sheets + tileinfo JS from the native build
#   manifest.json
#
# Needs: a native C++ toolchain, make, bison, flex, ncurses headers, python3,
# node, git, and Emscripten (emcc/em++ on PATH). Known-good toolchain:
# Ubuntu 24.04's `emscripten` package (3.1.6 + clang 15); see
# scripts/build-engine-docker.sh to build in exactly that environment.
#
# Steps: native WEBTILES build (generates headers, tile sheets, tileinfo JS)
#   -> compile ~290 files to wasm -> link -> run the engine in Node to build
#   Crawl's caches -> relink with the cache seed -> copy into the bundle.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/vendor/crawl/crawl-ref/source"
WORK="$ROOT/engine-build/work"
OBJ="$WORK/obj"
BUILD_ID="$(python3 -c "import json; print(json.load(open('$ROOT/engine.json'))['build'])")"
OUT="$ROOT/engine-build/$BUILD_ID"
JOBS="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"

[ -f "$SRC/main.cc" ] || { echo "No crawl source; run scripts/fetch-engine.sh first" >&2; exit 1; }
command -v em++ >/dev/null || { echo "em++ not found; install Emscripten" >&2; exit 1; }
mkdir -p "$WORK" "$OBJ"

echo "== 1/6 native WEBTILES build (generates files the wasm build needs)"
make -C "$SRC" -j"$JOBS" WEBTILES=y

echo "== 2/6 object list"
OBJECTS="$(make -C "$SRC" --no-print-directory WEBTILES=y \
    --eval 'crawl3d-print-objs: ; @echo OBJS: $(OBJECTS) main.o $(EXTRA_OBJECTS)' \
    crawl3d-print-objs | sed -n 's/^OBJS: //p')"
echo "$OBJECTS" | tr ' ' '\n' | grep -c '\.o$' | xargs echo "objects:"

if [ ! -d "$WORK/zlib" ]; then
    git clone -q --depth 1 --branch v1.3.1 https://github.com/madler/zlib.git "$WORK/zlib"
fi

echo "== 3/6 compile to wasm ($JOBS jobs)"
export SRC OBJ
export CXXFLAGS_WASM="-std=c++11 -O2 -fexceptions -DUSE_TILE -DUSE_TILE_WEB \
  -DWIZARD -DASSERTS -DCLUA_BINDINGS -D_DEFAULT_SOURCE -D_XOPEN_SOURCE=600 \
  -DDATA_DIR_PATH=\"/crawl/\" -DSAVE_DIR_PATH=\"/saves/\" -Wno-everything \
  -I$SRC/util -I$SRC -isystem $SRC/contrib/sqlite -isystem $WORK/zlib \
  -isystem $ROOT/engine/fakeinc"
# contrib lua headers live in different places depending on the native build
for d in "$SRC"/contrib/install/*/include "$SRC/contrib/lua/src"; do
    [ -d "$d" ] && CXXFLAGS_WASM="$CXXFLAGS_WASM -isystem $d"
done
compile_one() {
    local o="$1" src="${1%.o}.cc"
    mkdir -p "$OBJ/$(dirname "$o")"
    if [ ! -f "$OBJ/$o" ] || [ "$SRC/$src" -nt "$OBJ/$o" ]; then
        (cd "$SRC" && em++ $CXXFLAGS_WASM -c "$src" -o "$OBJ/$o") || { echo "FAILED: $o" >&2; return 1; }
        echo "  $o"
    fi
}
export -f compile_one
echo "$OBJECTS" | tr ' ' '\n' | grep '\.o$' | xargs -P "$JOBS" -I{} bash -c 'compile_one {}'

mkdir -p "$OBJ/lua" "$OBJ/sqlite" "$OBJ/zlib" "$OBJ/stubs"
for f in "$SRC"/contrib/lua/src/*.c; do
    b="$(basename "$f" .c)"; [ "$b" = lua ] || [ "$b" = luac ] && continue
    [ -f "$OBJ/lua/$b.o" ] || emcc -O2 -DLUA_COMPAT_5_2 -DLUA_USE_POSIX -c "$f" -o "$OBJ/lua/$b.o"
done
[ -f "$OBJ/sqlite/sqlite3.o" ] || emcc -O2 -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION \
    -c "$SRC/contrib/sqlite/sqlite3.c" -o "$OBJ/sqlite/sqlite3.o"
for f in "$WORK"/zlib/*.c; do
    b="$(basename "$f" .c)"
    [ -f "$OBJ/zlib/$b.o" ] || emcc -O2 -DHAVE_UNISTD_H -DHAVE_STDARG_H -c "$f" -o "$OBJ/zlib/$b.o"
done
emcc -O2 -isystem "$ROOT/engine/fakeinc" -c "$ROOT/engine/stubs/curses_stub.c" -o "$OBJ/stubs/curses_stub.o"

# Older Emscripten + newer clang name main() "__main_argc_argv" and never
# export "main"; the shim bridges that. MAIN_SHIM=1/0 forces it on/off.
LINK_OBJS=()
while IFS= read -r o; do LINK_OBJS+=("$OBJ/$o"); done < <(echo "$OBJECTS" | tr ' ' '\n' | grep '\.o$')
LINK_OBJS+=("$OBJ"/lua/*.o "$OBJ/sqlite/sqlite3.o" "$OBJ"/zlib/*.o "$OBJ/stubs/curses_stub.o")
if [ "${MAIN_SHIM:-auto}" = 1 ] || { [ "${MAIN_SHIM:-auto}" = auto ] && emcc --version | head -1 | grep -q ' 3\.1\.6 '; }; then
    emcc -O2 -c "$ROOT/engine/stubs/main_shim.c" -o "$OBJ/stubs/main_shim.o"
    LINK_OBJS+=("$OBJ/stubs/main_shim.o")
    echo "(using main shim)"
fi

echo "== 4/6 stage game data"
rm -rf "$WORK/data" && mkdir -p "$WORK/data/crawl"
cp -R "$SRC/dat" "$WORK/data/crawl/dat" && rm -rf "$WORK/data/crawl/dat/tiles"
cp -R "$SRC/../docs" "$WORK/data/crawl/docs"
cp -R "$SRC/../settings" "$WORK/data/crawl/settings"
mkdir -p "$WORK/seed"

link() {
    mkdir -p "$WORK/link"
    em++ "${LINK_OBJS[@]}" -o "$WORK/link/crawl.js" -O2 -fexceptions \
      -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576 \
      -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sTOTAL_STACK=8388608 \
      -sEXIT_RUNTIME=1 -sENVIRONMENT=worker,node -sFORCE_FILESYSTEM=1 \
      -lidbfs.js -lnodefs.js \
      -sEXPORTED_RUNTIME_METHODS=FS,ENV,addRunDependency,removeRunDependency \
      -sERROR_ON_UNDEFINED_SYMBOLS=0 \
      --preload-file "$WORK/data/crawl@/crawl" --preload-file "$WORK/seed@/crawl/seed"
}

echo "== 5/6 link, build Crawl's caches in Node, relink with them"
rm -rf "$WORK/seed" && mkdir -p "$WORK/seed"
link
node "$ROOT/engine/prebuild_cache.js" "$WORK/link" "$WORK/seed"
find "$WORK/seed" -name '*.lk' -delete
link

echo "== 6/6 bundle -> engine-build/$BUILD_ID"
rm -rf "$OUT" && mkdir -p "$OUT/gamedata"
cp "$WORK"/link/crawl.{js,wasm,data} "$OUT/"
G="$SRC/webserver/game_data/static"
cp "$G"/*.png "$G"/tileinfo-*.js "$G"/status-icon-sizes.js "$OUT/gamedata/"
python3 - "$OUT" "$ROOT" <<'PY'
import json, os, subprocess, sys
out, root = sys.argv[1], sys.argv[2]
eng = json.load(open(os.path.join(root, "engine.json")))
emcc = subprocess.run(["emcc", "--version"], capture_output=True, text=True).stdout.splitlines()[0]
files = {}
for d, _, fs in os.walk(out):
    for f in fs:
        p = os.path.join(d, f)
        files[os.path.relpath(p, out)] = os.path.getsize(p)
json.dump({"build": eng["build"], "crawlCommit": eng["crawlCommit"],
           "emcc": emcc, "files": files}, open(os.path.join(out, "manifest.json"), "w"), indent=2)
PY
du -sh "$OUT"
echo "Done. Next: scripts/upload-engine.sh (or npm run dev to try it locally)"
