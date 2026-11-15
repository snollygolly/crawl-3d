"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = () => import("../scripts/lib/static-server.mjs");

const dirs = { distDir: "/site/dist", engineDir: "/site/engine-build" };

test("site paths map into dist/, with index.html for directories", async() => {
	const { resolvePath } = await lib();
	assert.deepStrictEqual(resolvePath("/", dirs), { file: path.join("/site/dist", "index.html") });
	assert.deepStrictEqual(resolvePath("/static/scripts/app.js?v=1", dirs), { file: path.join("/site/dist", "static/scripts/app.js") });
	assert.deepStrictEqual(resolvePath("/engine/", dirs), { file: path.join("/site/dist", "engine/index.html") });
});

test("the hub's engine path maps into engine-build/", async() => {
	const { resolvePath } = await lib();
	assert.deepStrictEqual(resolvePath("/.hub/files/engine/0.34.1-b1/crawl.wasm", dirs),
		{ file: path.join("/site/engine-build", "0.34.1-b1/crawl.wasm") });
	assert.deepStrictEqual(resolvePath("/.hub/files/engine/", dirs), { error: 400 });
	assert.deepStrictEqual(resolvePath("/.hub/files/engine/b1/", dirs), { error: 400 });
});

test("rejects traversal and malformed paths", async() => {
	const { resolvePath } = await lib();
	assert.deepStrictEqual(resolvePath("/a/%2e%2e/%2e%2e/etc/passwd", dirs), { error: 400 });
	assert.deepStrictEqual(resolvePath("/.hub/files/engine/../../x", dirs), { error: 400 });
	assert.deepStrictEqual(resolvePath("/%E0%A4%A", dirs), { error: 400 });
	assert.deepStrictEqual(resolvePath("/a%5Cb", dirs), { error: 400 });
	assert.deepStrictEqual(resolvePath("relative", dirs), { error: 400 });
});

test("content types, including wasm", async() => {
	const { mimeFor } = await lib();
	assert.strictEqual(mimeFor("crawl.wasm"), "application/wasm");
	assert.strictEqual(mimeFor("x/INDEX.HTML"), "text/html; charset=utf-8");
	assert.strictEqual(mimeFor("noext"), "application/octet-stream");
});

let tmp;
let server;
let base;
before(async() => {
	const { createStaticServer } = await lib();
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "static-server-"));
	fs.mkdirSync(path.join(tmp, "dist"));
	fs.mkdirSync(path.join(tmp, "engine-build", "b1"), { recursive: true });
	fs.writeFileSync(path.join(tmp, "dist", "index.html"), "<p>hi</p>");
	fs.writeFileSync(path.join(tmp, "engine-build", "b1", "crawl.wasm"), Buffer.from([0, 97, 115, 109]));
	server = createStaticServer({ distDir: path.join(tmp, "dist"), engineDir: path.join(tmp, "engine-build") });
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
	server.close();
	fs.rmSync(tmp, { recursive: true, force: true });
});

test("serves the site and the engine", async() => {
	const page = await fetch(`${base}/`);
	assert.strictEqual(page.status, 200);
	assert.strictEqual(await page.text(), "<p>hi</p>");
	const wasm = await fetch(`${base}/.hub/files/engine/b1/crawl.wasm`);
	assert.strictEqual(wasm.headers.get("content-type"), "application/wasm");
	assert.strictEqual((await wasm.arrayBuffer()).byteLength, 4);
	const head = await fetch(`${base}/`, { method: "HEAD" });
	assert.strictEqual(head.headers.get("content-length"), "9");
});

test("404, 400 and 405", async() => {
	assert.strictEqual((await fetch(`${base}/nope.js`)).status, 404);
	assert.strictEqual((await fetch(`${base}/.hub/files/engine/b1/`)).status, 400);
	assert.strictEqual((await fetch(`${base}/`, { method: "POST" })).status, 405);
});
