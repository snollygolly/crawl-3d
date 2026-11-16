"use strict";

const { test, expect } = require("./fixtures");
const { press, engineBuild, waitInPage, startGame } = require("./helpers");

const engine = engineBuild();
const DAY = 86400000;

// Writes fake save files into the engine's IndexedDB the way Emscripten's IDBFS lays them out
// (database "/saves", store FILE_DATA keyed by path, with a timestamp index), plus the details
// fakesocket.js records during play, then reloads so the title screen reads them.
async function seedSaves(page, files, meta) {
	await page.evaluate(({ files, meta }) => new Promise((resolve, reject) => {
		const req = indexedDB.open("/saves", 21);
		req.onupgradeneeded = () => {
			req.result.createObjectStore("FILE_DATA").createIndex("timestamp", "timestamp", { unique: false });
		};
		req.onerror = () => reject(req.error);
		req.onsuccess = () => {
			const tx = req.result.transaction("FILE_DATA", "readwrite");
			for (const [path, ago] of Object.entries(files))
				tx.objectStore("FILE_DATA").put({ timestamp: new Date(Date.now() - ago), mode: 33206,
					contents: new Uint8Array(4) }, path);
			tx.oncomplete = () => {
				req.result.close();
				localStorage.setItem("crawl3d_saves", JSON.stringify(meta));
				resolve();
			};
		};
	}), { files, meta });
	await page.reload();
	await waitInPage(page, () => window.crawl3d_title && window.crawl3d_title.ready, "the save list", 10000);
}

test("the title screen walks the hallway under a stone title", async({ page }) => {
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	await page.goto("/");
	await expect(page.locator("#crawl3d_title svg[aria-label='Crawl 3D']")).toBeVisible();
	expect(await page.locator("#crawl3d_title rect").count()).toBeGreaterThan(50);
	await expect(page.locator("#crawl3d_hall canvas")).toHaveCount(1);
	await waitInPage(page, () => window.crawl3d_title.frames > 5, "the hallway to animate", 10000);
	// No saves in a fresh browser: no list, and the title screen didn't create the engine's database.
	await waitInPage(page, () => window.crawl3d_title.ready, "the save list", 10000);
	await expect(page.locator("#crawl3d_saves")).toBeHidden();
	const dbs = await page.evaluate(async() => (await indexedDB.databases()).map(d => d.name));
	expect(dbs).not.toContain("/saves");
	expect(errors).toEqual([]);
});

test("saved games are listed with their details, newest first", async({ page }) => {
	await page.goto("/");
	await seedSaves(page, {
		"/saves/Tester.cs": 3 * DAY,
		"/saves/Oldie.cs": 2 * 3600000,
		"/saves/logfile": 0
	}, {
		Tester: { species: "Minotaur", title: "Skirmisher", god: "Trog", xl: 7, place: "Lair", depth: 2,
			turn: 4210, played_ms: 72 * 60000, updated: Date.now() - 3 * DAY },
		Gone: { species: "Human", xl: 3, place: "Dungeon", depth: 3 }
	});
	const cards = page.locator(".crawl3d_save");
	await expect(cards).toHaveCount(2);
	await expect(cards.nth(0)).toHaveAttribute("data-name", "Oldie");
	await expect(cards.nth(0)).toContainText("last played 2 hours ago");
	await expect(cards.nth(0)).toContainText("details appear after you next play it");

	const tester = page.locator(".crawl3d_save[data-name='Tester']");
	await expect(tester).toContainText("Minotaur, Skirmisher of Trog");
	await expect(tester.locator(".save_xl")).toHaveText("XL 7");
	await expect(tester.locator(".save_place")).toHaveText("Lair:2");
	await expect(tester).toContainText("turn 4,210");
	await expect(tester).toContainText("played 1h 12m");
	await expect(tester).toContainText("last played 3 days ago");
	// The newest save has focus, so Enter resumes it.
	await expect(cards.nth(0)).toBeFocused();

	// Details of a character whose save is gone (it died) are forgotten.
	const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("crawl3d_saves")));
	expect(Object.keys(meta)).toEqual(["Tester"]);

	// Typing a saved character's name offers to resume it.
	await page.locator("#crawl3d_name").fill("Tester");
	await expect(page.locator("#crawl3d_play")).toHaveText("Resume");
	await expect(page.locator("#crawl3d_hint")).toContainText("saved game");
	await page.locator("#crawl3d_name").fill("Newbie");
	await expect(page.locator("#crawl3d_play")).toHaveText("Play");
});

test.describe("with the engine", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(300000);

	test("a saved game shows on the title screen and resumes from it", async({ page }, testInfo) => {
		await startGame(page, testInfo, "Saver");
		// The hallway stops and gives its WebGL context back once the game is up.
		expect(await page.evaluate(() => window.crawl3d_title.hall.running)).toBe(false);
		await expect(page.locator("#crawl3d_hall canvas")).toHaveCount(0);
		await page.waitForTimeout(2500);
		await page.keyboard.press("Control+s");
		await expect(page.locator("#crawl3d_again")).toBeVisible({ timeout: 30000 });
		await expect(page.locator("#crawl3d_start")).toContainText("Game saved.");
		// IDBFS writes back asynchronously after the engine exits.
		await page.waitForTimeout(6000);

		await page.goto("/");
		await waitInPage(page, () => window.crawl3d_title && window.crawl3d_title.ready, "the save list", 10000);
		const card = page.locator(".crawl3d_save[data-name='Saver']");
		await expect(card).toBeVisible();
		await expect(card.locator(".save_xl")).toHaveText("XL 1");
		await expect(card.locator(".save_place")).toHaveText(/:1$/);
		await expect(card).toContainText("Minotaur");

		await press(card, testInfo);
		// Straight back into the game: no species menu, the stats come back.
		await waitInPage(page, () => {
			const t = document.getElementById("stats_time");
			return t && t.textContent.trim() !== "";
		}, "the saved game to resume");
		await expect(page.locator("#crawl3d_start")).toBeHidden();
	});
});
