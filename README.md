# Crawl 3D

Dungeon Crawl Stone Soup (0.34.1) running entirely in the browser, with a
three.js 3D view (third or first person) over the stock WebTiles UI.
Unofficial fan project; GPL-2.0-or-later like Crawl itself.

See `CLAUDE.md` for the tech stack and the ground rules for working in this repo. It's built on
the house vibe-starter-spa toolchain (ESLint, `node --test`, Playwright, hub publishing) around its
own build, `scripts/assemble.py`.

## Layout

```
engine.json              pins Crawl (repo, tag, commit) + the engine build id
evilmouse.json           title, tagline and source link; hub block (slug crawl3d) for publishing
config.example.json      template for config.json (local server port/host)
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
  upload-engine.mjs      engine-build/<build>/ -> hub bucket games/crawl3d/files/engine/<build>/
  assemble.py            web/ + public/ + three.js -> dist/ (the engine is NOT copied in)
  serve.mjs              local server: dist/ + engine-build/ at the hub's URLs
  lib/                   tested helpers for the two scripts above
web/
  src/                   OUR CODE: three_view.js (3D view), worker.js (runs the
                         engine, fakes the WebTiles server), fakesocket.js,
                         start.html, crawl3d.css
  overrides/             our edited copies of stock client files (display.js)
  vendor-client/         stock WebTiles client from Crawl 0.34.1 (GPL)
public/                  favicons, copied to the root of dist/
vendor/crawl/            Crawl source; gitignored, filled by fetch-engine.sh
test/                    unit tests (node --test)
e2e/                     Playwright specs (desktop WebKit)
.github/workflows/       ci.yml (lint + unit tests), publish.yml (publish to the hub)
```

Generated or downloaded, never committed: `vendor/crawl/*`, `engine-build/`,
`dist/`, `node_modules/`.

## Everyday work (client changes)

You need Node.js 22.8+ and Python 3.

```
npm install
npx playwright install webkit       # once, for npm run test:e2e
npm start                           # build dist/ and serve it on :8765
```

`npm start` needs a local engine in `engine-build/<build>/` to actually play
(see below). Without one the start screen loads, but the game won't start.
Copy `config.example.json` to `config.json` to change the port or host
(`PORT`/`HOST` env vars also work).

Edit files in `web/`, then rerun `npm start`. Most work happens in
`web/src/three_view.js`. Push to main and the client is published.

```
npm test                            # lint + unit tests
npm run test:coverage               # unit tests with coverage thresholds
npm run test:e2e                    # build, serve on :5055, run the WebKit specs
```

## Engine changes (rare, manual)

```
npm run fetch-engine                # or: bash scripts/fetch-engine.sh --reset
# edit vendor/crawl, then save your change back into the patch:
(cd vendor/crawl && git diff) > engine/crawl.patch
# bump "build" in engine.json (e.g. 0.34.1-b2)
npm run build-engine:docker         # ~40 min the first time, minutes after
npm start                           # try it locally
npm run upload-engine               # to the hub bucket (credentials from ~/.env.hub)
git commit -am "engine 0.34.1-b2"   # the next publish loads the new engine
```

`npm run upload-engine -- --dry-run` lists what it would send. It refuses to
overwrite a build that's already uploaded, so builds stay immutable.
`--local` copies into a local hub's bucket folder instead
(`../spa-hub/.dev-bucket`, or `$HUB_FS_ROOT`).

`build-engine.sh` also runs natively on Linux with Ubuntu's `emscripten`
package. A current emsdk should work too (the main shim switches itself off),
but it hasn't been tested yet.

Upgrading Crawl:
1. Change `crawlTag`/`crawlCommit` in `engine.json` and run `fetch-engine.sh`.
2. Fix anything in the patch that no longer applies.
3. Refresh `web/vendor-client/` from the new tag's `crawl-ref/source/webserver/`
   (static/, game_data/static/, templates/), and redo `web/overrides/`.
4. Check `GENERATED_MODULES` in `scripts/assemble.py` against the tileinfo
   files the engine build produces.

## Deploy

Pushing to `main` runs `.github/workflows/publish.yml`. It calls the hub's
reusable workflow, which runs `npm run build` and publishes `dist/` to
`https://crawl3d.<hub domain>/`. The repo needs the hub's secrets; set them
from the spa-hub repo with `./scripts/set-game-secrets.sh snollygolly/crawl-3d`.

The engine isn't part of that build: the hub's build has no secrets, and 46 MB
per release is wasteful. It is uploaded once per engine build with
`npm run upload-engine` to `games/crawl3d/files/engine/<build>/` in the hub's
bucket. The hub serves it same-origin at `/.hub/files/engine/<build>/`, cached
forever. So a new engine is:
1. build it;
2. `npm run upload-engine`;
3. bump `build` in `engine.json` and push.

Hosting notes:
- The hub serves `crawl.wasm` as `application/wasm`.
- No COOP/COEP headers are needed (it uses Asyncify, not threads).

## How the runtime fits together

```
index.html  stock WebTiles client; window.WebSocket -> fakesocket.js
   │ postMessage
engine/worker.js  plays the Python WebTiles server: batches engine output,
   │              turns client input into keys, IDBFS saves at /saves
/.hub/files/engine/<build>/crawl.wasm  Crawl, WEBTILES + -headless + Asyncify
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
