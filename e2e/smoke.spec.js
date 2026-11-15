"use strict";

const { test, expect } = require("./fixtures");
const { press, engineBuild, waitInPage } = require("./helpers");

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
		page.on("response", r => {
			if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
		});

		// A fixed dungeon seed keeps the walk below on open floor.
		await page.goto("/?seed=42");
		await page.locator("#crawl3d_name").fill("Smoke");
		await press(page.locator("#crawl3d_play"), testInfo);
		await waitInPage(page, () => !!document.querySelector("#ui-stack > *"), "the species menu");

		// Minotaur, Fighter, war axe
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

		// Walk away from the stairs; at least one step should take a turn.
		for (const k of ["j", "j", "l", "h", "k", "k"]) {
			await page.keyboard.press(k);
			await page.waitForTimeout(400);
		}
		await waitInPage(page, () => !document.getElementById("stats_time").textContent.trim().startsWith("0.0"),
			"game time to pass after moving", 15000);

		await page.screenshot({ path: testInfo.outputPath("game.png") });
		expect(missing).toEqual([]);
		expect(errors).toEqual([]);
	});
});
