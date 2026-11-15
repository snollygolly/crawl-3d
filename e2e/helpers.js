"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Taps on touch projects, clicks everywhere else, so a touch project would exercise the same path
// a phone does. (Only desktop-webkit runs today: Crawl's UI is keyboard-driven.)
async function press(locator, testInfo) {
	if (testInfo.project.use.hasTouch) await locator.tap();
	else await locator.click();
}

// The engine bundle isn't in git or in dist/: it's built locally (npm run build-engine:docker) and
// served from engine-build/ by scripts/serve.mjs. Specs that need it skip without it.
function engineBuild() {
	const build = JSON.parse(fs.readFileSync(path.join(ROOT, "engine.json"), "utf8")).build;
	return { build, present: fs.existsSync(path.join(ROOT, "engine-build", build, "crawl.wasm")) };
}

// Polls fn in the page until it returns truthy. The engine is slow to boot and to answer keys, and
// nothing in the stock client signals "ready", so specs wait on the DOM the way a player would.
async function waitInPage(page, fn, what, timeout = 120000) {
	try {
		await page.waitForFunction(fn, null, { timeout, polling: 500 });
	} catch (err) {
		throw new Error(`timed out waiting for ${what}: ${err.message}`);
	}
}

module.exports = { press, engineBuild, waitInPage };
