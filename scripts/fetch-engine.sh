#!/usr/bin/env bash
# Fetch Crawl's source into vendor/crawl at the commit pinned in engine.json,
# init the submodules the wasm build needs, and apply engine/crawl.patch.
# vendor/crawl is gitignored: this script is the record of what's in it.
#
#   scripts/fetch-engine.sh          fetch + apply (safe to re-run)
#   scripts/fetch-engine.sh --reset  undo local edits to tracked crawl files
#                                    first (use after changing the patch)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/crawl"
cfg() { python3 -c "import json,sys; print(json.load(open('$ROOT/engine.json'))[sys.argv[1]])" "$1"; }
REPO="$(cfg crawlRepo)"
COMMIT="$(cfg crawlCommit)"

mkdir -p "$DEST"
cd "$DEST"
if [ ! -d .git ]; then
    git init -q
    git remote add origin "$REPO"
fi

if [ "$(git rev-parse -q --verify HEAD 2>/dev/null || true)" != "$COMMIT" ]; then
    echo "Fetching crawl $COMMIT ..."
    git fetch --depth 1 origin "$COMMIT"
    git checkout -q --force FETCH_HEAD
fi

if [ "${1:-}" = "--reset" ]; then
    git checkout -q -- .
    echo "Reset tracked crawl files"
fi

git submodule update --init --depth 1 \
    crawl-ref/source/contrib/lua \
    crawl-ref/source/contrib/sqlite \
    crawl-ref/source/contrib/pcre

if git apply --reverse --check "$ROOT/engine/crawl.patch" 2>/dev/null; then
    echo "engine/crawl.patch already applied"
else
    git apply "$ROOT/engine/crawl.patch"
    echo "Applied engine/crawl.patch"
fi
echo "Crawl source ready in vendor/crawl"
