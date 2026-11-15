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

// Starts a Minotaur Fighter (war axe) on a fixed seed, so the map is the same every run, and
// waits until the game and the 3D view are up.
async function startGame(page, testInfo, name = "Smoke") {
	await page.goto("/?seed=42");
	await page.locator("#crawl3d_name").fill(name);
	await press(page.locator("#crawl3d_play"), testInfo);
	await waitInPage(page, () => !!document.querySelector("#ui-stack > *"), "the species menu");
	for (const k of ["b", "a", "c"]) {
		await page.keyboard.press(k);
		await page.waitForTimeout(1200);
	}
	await waitInPage(page, () => {
		const t = document.getElementById("stats_time");
		return t && t.textContent.trim() !== "";
	}, "the game to start");
	await waitInPage(page, () => requirejs("game-local/three_view").is_active()
		&& !!document.querySelector("#three_view canvas"), "the 3D view", 15000);
}

module.exports = { press, engineBuild, waitInPage, startGame };
