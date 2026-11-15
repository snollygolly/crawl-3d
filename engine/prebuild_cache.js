// Run the wasm engine in Node until it reaches the new-game menu, then copy
// the caches it built under /saves (level layouts, text databases) to a
// folder. build-engine.sh packs that folder into crawl.data as /crawl/seed,
// and worker.js copies it into the player's save folder on first run.
//
//   node prebuild_cache.js <dir with crawl.js> <output dir>
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ENGINE = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);

// older Emscripten loaders try fetch() for files in Node
globalThis.fetch = undefined;
// the engine's JS bridge talks to `self`
globalThis.self = globalThis;
self.crawlInputQueue = ['{"msg":"attach","primary":true}'];

let done = false;
self.crawlOut = (m) => {
	if (!done && m.indexOf('"msg":"ui-push"') !== -1) {
		done = true;
		setTimeout(dump, 500);
	}
};

function dump() {
	const FS = Module.FS;
	fs.rmSync(OUT, { recursive: true, force: true });
	fs.mkdirSync(OUT, { recursive: true });
	let count = 0;
	(function walk(dir) {
		for (const f of FS.readdir(dir)) {
			if (f === "." || f === "..") continue;
			const p = `${dir}/${f}`;
			const host = path.join(OUT, p.replace(/^\/saves/, ""));
			if (FS.isDir(FS.stat(p).mode)) {
				fs.mkdirSync(host, { recursive: true });
				walk(p);
			} else {
				fs.writeFileSync(host, FS.readFile(p));
				count++;
			}
		}
	}("/saves"));
	console.log(`cache seed: ${count} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	process.exit(0);
}

setTimeout(() => {
	console.error("timed out waiting for the new-game menu");
	process.exit(1);
}, 10 * 60 * 1000);

globalThis.Module = {
	arguments: ["-name", "Seed", "-headless", "-webtiles-socket", "wasm", "-await-connection"],
	print: () => {},
	printErr: (s) => console.error("[crawl]", s),
	preRun: [() => { Module.FS.mkdir("/saves"); Module.ENV.HOME = "/saves"; }],
	onAbort: (w) => { console.error("engine aborted:", w); process.exit(1); }
};
globalThis.require = require;
globalThis.__dirname = ENGINE;
process.chdir(ENGINE);
const t0 = Date.now();
// Evaluate in global scope so the engine picks up the Module object above.
vm.runInThisContext(fs.readFileSync(path.join(ENGINE, "crawl.js"), "utf8"), { filename: "crawl.js" });
