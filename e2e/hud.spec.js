"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, waitInPage, startGame } = require("./helpers");

const engine = engineBuild();

test.describe("the 3D HUD", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("shows the panels in 3D and the classic layout in 2D", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		await startGame(page, testInfo, "Hud");

		// Character card and location banner, filled from the player state
		await expect(page.locator("#hud_char")).toBeVisible();
		await expect(page.locator("#hud_name")).toHaveText("Hud");
		await expect(page.locator("#hud_sub")).toContainText("Minotaur");
		await expect(page.locator("#hud_hp .num")).toHaveText(/^\d+ \/ \d+/);
		await expect(page.locator("#hud_xl")).toHaveText(/^XL \d+$/);
		await expect(page.locator("#hud_status .hud-noise")).toHaveText(/^Noise: /);
		await expect(page.locator("#hud_loc")).toContainText("The Dungeon · Level 1");

		// The portrait is the player's tile
		const drawn = await page.evaluate(() => {
			const c = document.getElementById("hud_portrait");
			const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			let n = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
			return n;
		});
		expect(drawn).toBeGreaterThan(100);

		// The stock sidebar is hidden; its message pane is now a panel.
		await expect(page.locator("#right_column")).toHaveCSS("visibility", "hidden");
		await expect(page.locator("#message_pane")).toHaveCSS("position", "fixed");
		await expect(page.locator("#message_pane")).toBeVisible();
		await expect(page.locator("#messages .game_message").first()).toBeVisible();

		// The view switcher sits in the HUD and marks the current view.
		await expect(page.locator("#three_toolbar")).toHaveClass(/\bhud\b/);
		await expect(page.locator("#hud_view_third")).toHaveClass(/\bon\b/);

		// 2D brings back the classic WebTiles layout.
		await page.locator("#hud_view_2d").click();
		await expect(page.locator("#hud_char")).toBeHidden();
		await expect(page.locator("#three_view")).toBeHidden();
		await expect(page.locator("#right_column")).toHaveCSS("visibility", "visible");
		await expect(page.locator("#message_pane")).not.toHaveCSS("position", "fixed");
		await expect(page.locator("#hud_view_2d")).toHaveClass(/\bon\b/);
		await expect(page.locator("#hud_rotl")).toBeHidden();

		// ...and first person turns the 3D view and HUD back on.
		await page.locator("#hud_view_first").click();
		await expect(page.locator("#hud_char")).toBeVisible();
		await expect(page.locator("#three_view")).toBeVisible();
		await expect(page.locator("#hud_view_first")).toHaveClass(/\bon\b/);
		await waitInPage(page, () => requirejs("game-local/three_view").settings.mode === "first",
			"first person", 5000);

		// Walking still works with the HUD up, and the banner tracks the time.
		const before = await page.locator("#hud_time").textContent();
		for (const k of ["j", "j", "l", "h", "k", "k"]) {
			await page.keyboard.press(k);
			await page.waitForTimeout(400);
		}
		await expect(page.locator("#hud_time")).not.toHaveText(before);

		await page.screenshot({ path: testInfo.outputPath("hud.png") });
		expect(errors).toEqual([]);
	});
});
