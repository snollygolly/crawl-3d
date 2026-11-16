"use strict";

const { test, expect } = require("./fixtures");
const { press, engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

// Rects of the HUD panels in the page, by id; null for hidden ones.
function rects(page, ids) {
	return page.evaluate(list => {
		const out = {};
		for (const id of list) {
			const el = document.getElementById(id);
			const r = el && el.getBoundingClientRect();
			out[id] = r && r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
		}
		return out;
	}, ids);
}

function overlap(a, b) {
	return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

test.describe("the phone layout", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test("fits the panels on a phone, folds them, and has a Keys drawer", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		await startGame(page, testInfo, "Phone");
		// a fresh page: both panels start folded
		await expect(page.locator("#hud_char")).toHaveClass(/folded/);
		await expect(page.locator("#hud_right")).toHaveClass(/folded/);
		await expect(page.locator("#hud_map_canvas")).toBeHidden();
		await expect(page.locator("#hud_map_title")).toContainText("Level 1");
		await expect(page.locator("#hud_loc")).toBeHidden();

		const ids = ["hud_char", "hud_right", "three_toolbar", "message_pane", "hud_bar"];
		// retried: the panels restack (hud.js watch_edges) a frame after a fold
		async function check_layout() {
			await expect(async() => layout_ok(await rects(page, ids))).toPass({ timeout: 5000 });
		}
		function layout_ok(r) {
			for (const id of ids) {
				expect(r[id], `${id} shows`).not.toBeNull();
				expect(r[id].l, `${id} left edge`).toBeGreaterThanOrEqual(0);
				expect(r[id].r, `${id} right edge`).toBeLessThanOrEqual(390);
				expect(r[id].b, `${id} bottom edge`).toBeLessThanOrEqual(844);
			}
			for (let i = 0; i < ids.length; i++)
				for (let j = i + 1; j < ids.length; j++)
					expect(overlap(r[ids[i]], r[ids[j]]), `${ids[i]} clear of ${ids[j]}`).toBe(false);
		}
		await check_layout();

		// Unfold both: the map shows, and still nothing overlaps.
		await press(page.locator("#hud_map .hud-head"), testInfo);
		await press(page.locator("#hud_char .hud-top"), testInfo);
		await expect(page.locator("#hud_map_canvas")).toBeVisible();
		await expect(page.locator("#hud_defs")).toBeVisible();
		await check_layout();
		// folding back hides the map again
		await press(page.locator("#hud_map .hud-head"), testInfo);
		await expect(page.locator("#hud_map_canvas")).toBeHidden();

		// The Keys drawer's Esc closes a menu the hotbar opened.
		await press(page.locator("#hud_slot_inventory"), testInfo);
		await expect(page.locator("#ui-stack .menu_inventory")).toBeVisible();
		// the drawer sits above menus, so it can be opened from the hotbar first
		await page.keyboard.press("Escape");
		await expect(page.locator("#ui-stack .menu_inventory")).toBeHidden();
		await press(page.locator("#hud_slot_keys"), testInfo);
		await expect(page.locator("#hud_keys")).toBeVisible();
		await press(page.locator("#hud_slot_inventory"), testInfo);
		await expect(page.locator("#ui-stack .menu_inventory")).toBeVisible();
		await press(page.locator("#hud_keys button[data-code='27']"), testInfo);
		await expect(page.locator("#ui-stack .menu_inventory")).toBeHidden();

		// Typing into the drawer's keyboard box reaches the game: "i" opens
		// the inventory, then Esc closes it.
		await press(page.locator("#hud_keys_type"), testInfo);
		await expect(page.locator("#hud_keys_input")).toBeFocused();
		await page.keyboard.type("i");
		await expect(page.locator("#ui-stack .menu_inventory")).toBeVisible();
		await press(page.locator("#hud_keys button[data-code='27']"), testInfo);
		await expect(page.locator("#ui-stack .menu_inventory")).toBeHidden();
		expect(errors).toEqual([]);
	});
});

test.describe("the desktop layout", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("has no Keys slot and keeps the location banner", async({ page }, testInfo) => {
		await startGame(page, testInfo, "Desk");
		await expect(page.locator("#hud_loc")).toBeVisible();
		await expect(page.locator("#hud_slot_keys")).toBeHidden();
		// .folded means nothing on desktop: the map shows
		await expect(page.locator("#hud_map_canvas")).toBeVisible();
	});
});
