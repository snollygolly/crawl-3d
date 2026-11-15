"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();
const CACHE = `crawl3d-engine-${engine.build}`;
const ENGINE_PATH = `/.hub/files/engine/${engine.build}/`;
const BIG = ["crawl.js", "crawl.wasm", "crawl.data"];

// Runs in the page: leaves an older build's cache behind and unregisters the service worker.
async function seedStaleCache() {
	const c = await caches.open("crawl3d-engine-old");
	await c.put("/stale", new Response("old"));
	for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
}

// Runs in the page: which cache names exist, and which of files the build's cache holds.
async function inspectCache({ name, prefix, files }) {
	const c = await caches.open(name);
	const hits = await Promise.all(files.map(f => c.match(prefix + f)));
	return { keys: await caches.keys(), cached: hits.map(Boolean) };
}

test.describe("engine cache", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(300000);

	test("downloads the engine once per build, then plays from the cache", async({ page }, testInfo) => {
		// A cache from an older build, which the service worker should drop when it next activates.
		// Unregistering it here makes the next load install it again, as a new build would.
		await page.goto("/");
		await page.evaluate(seedStaleCache);

		await startGame(page, testInfo, "Cachey");
		const cacheState = () => page.evaluate(inspectCache, { name: CACHE, prefix: ENGINE_PATH, files: BIG });
		// Writing the cache finishes a little after the download does.
		await expect.poll(async() => (await cacheState()).cached, { timeout: 60000 }).toEqual([true, true, true]);
		const { keys } = await cacheState();
		expect(keys).toContain(CACHE);
		expect(keys).not.toContain("crawl3d-engine-old");

		// Second visit (a new character, as Cachey's game is saved and would resume): every engine
		// file comes from the service worker's cache.
		const engineResponses = [];
		page.on("response", r => {
			if (new URL(r.url()).pathname.startsWith(ENGINE_PATH)) engineResponses.push(r);
		});
		await startGame(page, testInfo, "Cachetoo");
		const names = engineResponses.map(r => new URL(r.url()).pathname.slice(ENGINE_PATH.length));
		for (const f of BIG) expect(names).toContain(f);
		for (const r of engineResponses) expect(r.fromServiceWorker(), r.url()).toBe(true);
	});
});
