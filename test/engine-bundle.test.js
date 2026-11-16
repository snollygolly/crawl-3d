"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = () => import("../scripts/lib/engine-bundle.mjs");

test("engine keys live under the game's files/ prefix in the hub bucket", async() => {
	const { engineKeyPrefix } = await lib();
	assert.strictEqual(engineKeyPrefix("crawl3d", "0.34.1-b1"), "games/crawl3d/files/engine/0.34.1-b1/");
	assert.throws(() => engineKeyPrefix("crawl-3d", "b1"), /slug/);
	assert.throws(() => engineKeyPrefix("crawl3d", "../b1"), /build/);
});

test("the matching URL is what assemble.py points the client at", () => {
	const assemble = fs.readFileSync(path.join(__dirname, "..", "scripts", "assemble.py"), "utf8");
	assert.match(assemble, /ENGINE_URL = "\/\.hub\/files\/engine\/" \+ engine\["build"\]/);
});

test("lists the bundle with types, manifest.json last", async() => {
	const { listBundle } = await lib();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
	fs.mkdirSync(path.join(dir, "gamedata"));
	for (const f of ["manifest.json", "crawl.wasm", "crawl.js", "gamedata/main.png"]) fs.writeFileSync(path.join(dir, f), "x");
	const files = await listBundle(dir);
	assert.deepStrictEqual(files.map(f => f.rel), ["crawl.js", "crawl.wasm", "gamedata/main.png", "manifest.json"]);
	assert.strictEqual(files[1].type, "application/wasm");
	assert.strictEqual(files[2].abs, path.join(dir, "gamedata", "main.png"));
	assert.strictEqual(files[0].size, 1);
	fs.rmSync(dir, { recursive: true });
});

test("leaves dotfiles like .DS_Store out of the bundle", async() => {
	const { listBundle } = await lib();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
	fs.mkdirSync(path.join(dir, "gamedata"));
	for (const f of ["manifest.json", ".DS_Store", "gamedata/.DS_Store", "gamedata/main.png"]) fs.writeFileSync(path.join(dir, f), "x");
	assert.deepStrictEqual(listBundle(dir).map(f => f.rel), ["gamedata/main.png", "manifest.json"]);
	fs.rmSync(dir, { recursive: true });
});

test("refuses a folder without a manifest", async() => {
	const { listBundle } = await lib();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
	assert.throws(() => listBundle(dir), /no engine bundle/);
	fs.rmSync(dir, { recursive: true });
});
