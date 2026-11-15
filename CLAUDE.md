# CLAUDE.md

Crawl 3D is Dungeon Crawl Stone Soup (0.34.1) compiled to WebAssembly, running entirely in the browser under the stock WebTiles client, with a three.js 3D view. It's a GPL fan project built on the house vibe-starter-spa toolchain, but its build is `scripts/assemble.py`, not Vite.

The output is static files only. `npm run build` writes `dist/`, and `.github/workflows/publish.yml` publishes it to the game hub (`spa-hub`) on every push to `main`, configured by the `hub` block in `evilmouse.json` (slug `crawl3d`). The hub serves it from the root of its own subdomain. The one exception is **the engine**: it is too big to republish every release, so it is not in `dist/` (see below).

## Tech stack

- **Runtime**: Node.js 22+ and Python 3 for tooling only; nothing runs server-side.
- **Client**: the stock WebTiles client (RequireJS + jQuery, `web/vendor-client/`), our edited copies of a few of its files (`web/overrides/`), and our code in `web/src/`:
  - `three_view.js`: the 3D view, an AMD module;
  - `worker.js`: runs the engine in a Web Worker and plays the WebTiles server;
  - `fakesocket.js`: replaces the client's WebSocket;
  - `start.html` and `crawl3d.css`.
  three.js comes from `node_modules/three` and is exposed as `window.THREE`.
- **Build**: `scripts/assemble.py` → `dist/`. It renders the client's Tornado templates, copies the client, our code, three.js and `public/`, and fills in the engine URL. The title and source link come from `evilmouse.json`.
- **Engine**: Crawl at the commit pinned in `engine.json`, plus `engine/crawl.patch`.
  - `scripts/fetch-engine.sh` puts the source in `vendor/crawl`.
  - `scripts/build-engine.sh` (or `build-engine-docker.sh`, the known-good toolchain, ~40 min the first time) builds `engine-build/<build>/`.
  - `npm run upload-engine` uploads that bundle to the hub bucket at `games/crawl3d/files/engine/<build>/`, using credentials from `~/.env.hub`.
  - The hub serves it same-origin at `/.hub/files/engine/<build>/` (spa-hub's `src/files.js`). The worker (`ENGINE_URL`), the tile sheet `<img>`s and the generated `tileinfo-*` modules (`GENERATED_MODULES` in `assemble.py`) all load from there.
  - Builds are immutable: bump `build` in `engine.json` for every new engine.
- **Local server**: `scripts/serve.mjs` (`scripts/lib/static-server.mjs`, no dependencies) serves `dist/`, and serves `engine-build/<build>/` at the same `/.hub/files/engine/<build>/` path, so local runs match production without a hub. `npm start` builds then serves. Port and host come from `config.mjs`.
- **Config**: `config.mjs` reads `config.json` (gitignored; template `config.example.json`) with env overrides (`PORT`, `HOST`). Default port 8765, host `0.0.0.0`. Never put secrets in it.
- **Unit tests**: Node's built-in runner (`node --test`), files in `test/`. `npm run test:coverage` enforces 90% lines/functions and 85% branches over `config.mjs` and `scripts/lib/`. Keep testable Node logic in `scripts/lib/`. The client code is covered by e2e, not unit tests.
- **E2E tests**: Playwright (`playwright.config.js`), specs in `e2e/`, **desktop WebKit only**, because Crawl's UI is keyboard-driven. `npm run test:e2e` builds, then serves on port 5055. The engine spec needs a local `engine-build/<build>/` and skips without one.
- **CI**: `.github/workflows/ci.yml` runs lint and unit tests with coverage. E2E isn't in CI; run it on demand.
- **Lint**: ESLint (`eslint.config.cjs`): tabs, double quotes, semicolons.
  - CommonJS for tests, e2e and configs; ESM for `*.mjs`.
  - `web/src` is linted as browser and AMD scripts, with `func-names` off.
  - `web/vendor-client/` and `web/overrides/` are upstream Crawl code and aren't linted. Keep them close to upstream so Crawl upgrades stay mechanical.

## Layout

- `engine.json`: Crawl repo, tag and commit, plus the engine `build` id.
- `evilmouse.json`: title, tagline and source link for the launcher, the studio site and the start screen; `hub` block for publishing.
- `engine/`:
  - `crawl.patch`: our changes to Crawl;
  - `stubs/` and `fakeinc/`: curses stand-ins;
  - `prebuild_cache.js`: builds Crawl's caches in Node;
  - `Dockerfile`: the engine toolchain.
- `scripts/`:
  - `fetch-engine.sh`, `build-engine.sh`, `build-engine-docker.sh`;
  - `upload-engine.mjs`;
  - `assemble.py`;
  - `serve.mjs`;
  - `lib/`: tested Node helpers.
- `web/`: `src/` (ours), `overrides/` (edited stock files), `vendor-client/` (stock client, GPL).
- `public/`: favicons, copied to the `dist/` root.
- `test/`: `node --test` files.
- `e2e/`: Playwright specs plus `env.js`, `fixtures.js` (`test`/`expect`) and `helpers.js` (`press`, `engineBuild`, `waitInPage`).
- Never committed: `vendor/crawl/*`, `engine-build/`, `dist/`, `node_modules/`.

## Cardinal rules

1. **No new dependencies unless absolutely necessary for what's being asked.** Reach for what's already in `package.json` first. If a task genuinely needs something new, say so and ask before adding it.
2. **Never run `npm install` or any package/dependency install command, in any language.** Installing dependencies is always the human's job. After editing `package.json`, stop and let them run the install.
3. **Network access is limited to documentation and the app itself.** You may read vendor or technical documentation for this project, its dependencies or the services it uses, and reach the app itself (e.g. its local server). No other external APIs, and no code that assumes network access beyond that. Fetching Crawl's source (`fetch-engine.sh`) and uploading the engine (`upload-engine`) are the human's steps unless they ask.
4. **E2E tests may be run, with what's already installed, and no Chromium.** Use only the dependencies and browsers already installed with the project. Don't install or download browsers (`npx playwright install`) or anything else to make it run. Never use Chromium: not as a Playwright project, not via `--browser`, not in ad-hoc scripts. If the suite can't run with what's installed, stop and tell the human. Either way, say which specs you added or changed.
5. **Every new feature or bug fix should come with tests where practical.**
   - Add a unit test in `test/` for Node-side logic.
   - When the change affects something a player sees or does, add an e2e spec in `e2e/` as well.
   - In specs, import `test`/`expect` from `e2e/fixtures.js`, reuse or extend `e2e/helpers.js`, and target stable ids rather than layout or styling.
   - If adding a small test would force a disproportionate refactor, skip the test rather than restructure the code.
6. **Engine builds are immutable.** Never re-upload a different bundle under an existing `build` id (`--force` exists for a broken upload, not for changes). A new engine means a new id in `engine.json`.
