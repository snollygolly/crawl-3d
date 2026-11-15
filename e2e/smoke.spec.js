"use strict";

const { test, expect } = require("./fixtures");
const { press, engineBuild, waitInPage, startGame } = require("./helpers");

const engine = engineBuild();

test("the start screen loads without page errors", async({ page }) => {
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	await page.goto("/");
	await expect(page).toHaveTitle(/^Crawl 3D - /);
	await expect(page.locator("#crawl3d_name")).toBeVisible();
	await expect(page.locator("#crawl3d_play")).toBeEnabled();
	await expect(page.locator("#crawl3d_start a[href^='https://github.com/']")).toHaveCount(1);
	expect(errors).toEqual([]);
});

test.describe("with the engine", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("starts a game, walks, and the 3D view runs", async({ page }, testInfo) => {
		const errors = [];
		const missing = [];
		page.on("pageerror", e => errors.push(e.message));
		// three.js reports shader compile failures on the console
		const glErrors = [];
		page.on("console", m => {
			if (m.type() === "error" && /WebGL|shader/i.test(m.text())) glErrors.push(m.text());
		});
		page.on("response", r => {
			if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
		});

		// The fixed dungeon seed keeps the walk below on open floor.
		await startGame(page, testInfo);

		// Walk away from the stairs; at least one step should take a turn.
		for (const k of ["j", "j", "l", "h", "k", "k"]) {
			await page.keyboard.press(k);
			await page.waitForTimeout(400);
		}
		await waitInPage(page, () => !document.getElementById("stats_time").textContent.trim().startsWith("0.0"),
			"game time to pass after moving", 15000);

		// Picking never targets a wall, solid or ghosted, but does find floor.
		const picked = await page.evaluate(() => {
			const view = requirejs("game-local/three_view");
			const mk = requirejs("game-local/map_knowledge");
			const canvas = document.querySelector("#three_view canvas");
			const w = canvas.clientWidth; const h = canvas.clientHeight;
			const out = { floor: 0, walls: [] };
			for (let py = 4; py < h; py += 12)
				for (let px = 4; px < w; px += 12) {
					const c = view.pick(px, py);
					if (!c) continue;
					if (mk.get(c.x, c.y).__wall3d) out.walls.push(c);
					else out.floor++;
				}
			return out;
		});
		expect(picked.walls).toEqual([]);
		expect(picked.floor).toBeGreaterThan(0);

		await page.screenshot({ path: testInfo.outputPath("game.png") });
		expect(missing).toEqual([]);
		expect(errors).toEqual([]);
		expect(glErrors).toEqual([]);
	});
});
