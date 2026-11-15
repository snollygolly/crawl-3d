"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const load = async opts => (await import("../config.mjs")).loadConfig(opts);

function tempConfig(contents) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
	const file = path.join(dir, "config.json");
	if (contents) fs.writeFileSync(file, JSON.stringify(contents));
	return file;
}

test("falls back to defaults without a config file", async() => {
	const config = await load({ file: tempConfig(), env: {} });
	assert.deepStrictEqual(config, { port: 8765, host: "0.0.0.0" });
});

test("reads values from the config file", async() => {
	const file = tempConfig({ port: 6000, host: "127.0.0.1" });
	assert.deepStrictEqual(await load({ file, env: {} }), { port: 6000, host: "127.0.0.1" });
});

test("env vars override the config file", async() => {
	const file = tempConfig({ port: 6000, host: "127.0.0.1" });
	const env = { PORT: "7000", HOST: "::" };
	assert.deepStrictEqual(await load({ file, env }), { port: 7000, host: "::" });
});
