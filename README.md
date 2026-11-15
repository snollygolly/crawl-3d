# Crawl 3D

Dungeon Crawl Stone Soup (0.34.1) running entirely in the browser, with a
three.js 3D view (third or first person) over the stock WebTiles UI.
Unofficial fan project; GPL-2.0-or-later like Crawl itself.

## Layout

```
engine.json              pins Crawl (repo, tag, commit) + the engine build id
site.json                site title + public source URL (shown on the start screen)
engine/
  crawl.patch            our changes to Crawl (~110 lines): browser I/O bridge,
                         yielding delays, stable cache stamps, no backtraces
  stubs/                 no-op curses + a main() export shim for old Emscripten
  fakeinc/               ncurses headers the console code compiles against
  prebuild_cache.js      runs the engine in Node to prebuild Crawl's caches
  Dockerfile             known-good engine toolchain (Ubuntu 24.04 Emscripten)
scripts/
  fetch-engine.sh        vendor/crawl <- Crawl at the pinned commit + patch
  build-engine.sh        vendor/crawl -> engine-build/<build>/ (wasm + data + tiles)
  build-engine-docker.sh same, inside engine/Dockerfile
  upload-engine.sh       engine-build/<build>/ -> s3://$S3_BUCKET/$ENGINE_PREFIX/<build>/
  pull-engine.sh         the reverse (CI)
  assemble.py            web/ + engine bundle + three.js -> dist/
web/
  src/                   OUR CODE: three_view.js (3D view), worker.js (runs the
                         engine, fakes the WebTiles server), fakesocket.js,
                         start.html, crawl3d.css
  overrides/             our edited copies of stock client files (display.js)
  vendor-client/         stock WebTiles client from Crawl 0.34.1 (GPL)
vendor/crawl/            Crawl source; gitignored, filled by fetch-engine.sh
tests/smoke.js           Playwright smoke test
.github/workflows/       deploy-site.yml: assemble + deploy on push to main
```

Generated or downloaded, never committed: `vendor/crawl/*`, `engine-build/`,
`dist/`, `node_modules/`.

## Everyday work (client changes)

```
npm install
S3_BUCKET=... npm run pull-engine   # once: download the pinned engine
npm run dev                         # assemble dist/ and serve on :8765
```

Edit files in `web/`, then rerun `npm run dev`. Push to main and CI deploys.
Most work happens in `web/src/three_view.js`.

## Engine changes (rare, manual)

```
npm run fetch-engine                # or: bash scripts/fetch-engine.sh --reset
# edit vendor/crawl, then save your change back into the patch:
(cd vendor/crawl && git diff) > engine/crawl.patch
# bump "build" in engine.json (e.g. 0.34.1-b2)
npm run build-engine:docker         # ~40 min the first time, minutes after
npm run dev                         # try it
S3_BUCKET=... npm run upload-engine
git commit -am "engine 0.34.1-b2"   # CI now deploys against the new engine
```

`build-engine.sh` also runs natively on Linux with Ubuntu's `emscripten`
package. A current emsdk should work too (the main shim switches itself off),
but it hasn't been tested yet.

Upgrading Crawl: change `crawlTag`/`crawlCommit` in `engine.json`, run
`fetch-engine.sh`, fix anything in the patch that no longer applies, refresh
`web/vendor-client/` from the new tag's `crawl-ref/source/webserver/`
(static/, game_data/static/, templates/), and redo `web/overrides/`.

## Deploy

`.github/workflows/deploy-site.yml` runs on every push to main. It pulls the
engine bundle pinned in `engine.json`, assembles `dist/`, and syncs it to
`s3://$S3_BUCKET/$SITE_PREFIX`. The engine goes in a versioned folder,
`engine/<build>/`, that can be cached forever and is skipped when it hasn't
changed. Adjust the S3 steps to match your other Spa Hub projects.

Hosting notes:
- `crawl.wasm` should be served as `application/wasm` (the workflow sets this).
- gzip or brotli shrinks the engine and its data from 46 MB to about 12.5 MB.
- No COOP/COEP headers are needed (it uses Asyncify, not threads).

## How the runtime fits together

```
index.html  stock WebTiles client; window.WebSocket -> fakesocket.js
   │ postMessage
engine/worker.js  plays the Python WebTiles server: batches engine output,
   │              turns client input into keys, IDBFS saves at /saves
engine/<build>/crawl.wasm  Crawl, WEBTILES + -headless + Asyncify
      output: tileweb.cc finish_message() -> self.crawlOut()
      input:  tileweb.cc await_input()    <- self.crawlInputQueue (sleep-polls)
```

`three_view.js` reads the same `map_knowledge` the 2D renderer uses. Cell
backgrounds go into one atlas canvas, drawn with the stock cell renderer.
That atlas textures the ground and the extruded wall/door boxes. Monsters,
items, clouds and bolts are billboard sprites that glide between squares.
WebTiles coordinates are relative to where you entered the level, so the
atlas wraps (x mod 80, y mod 70).

## License

Crawl is (c) Linley Henzell, the dev team and contributors, GPL-2.0-or-later
(see `LICENSE`). Everything here is under the same license. Most tiles are
CC0, three.js is MIT, and the ncurses headers in `engine/fakeinc` are
MIT/X11. Keep this repo public: together with the pinned upstream commit, it
is the source for the deployed game.
