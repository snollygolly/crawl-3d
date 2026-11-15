"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

test.describe("the inventory sheet", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("shows equipment in slots, and items' actions as buttons", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		// Minotaur Fighter: a war axe (a), scale mail (b) and a buckler (c) on,
		// two potions of might (m) in the pack. Bag items' ids are inventory
		// slots: c is slot 2, and consumables start at 52.
		await startGame(page, testInfo, "Packer");

		await page.locator("#hud_slot_inventory").click();
		const sheet = page.locator("#hud_inv");
		await expect(sheet).toBeVisible();
		await expect(page.locator("#hud_inv_slot_weapon")).toHaveAttribute("data-letter", "a");
		await expect(page.locator("#hud_inv_slot_body")).toHaveAttribute("data-letter", "b");
		await expect(page.locator("#hud_inv_slot_offhand")).toHaveAttribute("data-letter", "c");
		await expect(page.locator("#hud_inv_slot_head")).not.toHaveAttribute("data-letter", /./);
		// equipped gear is on the doll, not in the bag
		await expect(page.locator("#hud_inv_item_2")).toHaveCount(0);
		await expect(page.locator("#hud_inv_item_52 .hud-count")).toHaveText("2");
		await page.screenshot({ path: testInfo.outputPath("sheet.png") });

		// The potion is in another category of the engine's menu: clicking it
		// still describes it, with its actions as buttons.
		await page.locator("#hud_inv_item_52").click();
		const quaff = page.locator("#ui-stack .describe-item .hud-act[data-hotkey='q']");
		await expect(quaff).toBeVisible();
		await expect(quaff).toHaveClass(/\bprimary\b/);
		await expect(quaff).toContainText("Quaff");
		await page.keyboard.press("Escape");
		await expect(page.locator("#ui-stack .describe-item")).toHaveCount(0);
		await expect(sheet).toBeVisible();

		// Take the buckler off with its button: the sheet comes back by
		// itself, with the buckler out of the off-hand slot.
		await page.locator("#hud_inv_slot_offhand").click();
		await page.locator("#ui-stack .describe-item .hud-act[data-hotkey='t']").click();
		await page.waitForFunction(() => requirejs("game-local/player").sh === 0, null, { timeout: 20000 });
		await expect(page.locator("#hud_inv_slot_offhand")).not.toHaveAttribute("data-letter", /./, { timeout: 15000 });
		await expect(sheet).toBeVisible();
		await expect(page.locator("#hud_inv_item_2")).toBeVisible();

		// Leave the engine's menu on the potions page, then wear the buckler
		// with the stock W command: the menu reopens on potions, and the
		// sheet still has to find the gear page to see the buckler is on.
		await page.locator("#hud_inv_item_52").click();
		await expect(quaff).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator("#ui-stack .describe-item")).toHaveCount(0);
		// the engine can miss a key sent while the menu is still coming back
		await expect(async() => {
			if (await sheet.count()) await page.locator("#hud_inv .hud-close").click();
			await expect(sheet).toBeHidden({ timeout: 1500 });
		}).toPass({ timeout: 15000 });
		await page.keyboard.press("W");
		await expect(page.locator("#ui-stack .menu_use_item")).toBeVisible();
		await page.keyboard.press("c");
		await page.waitForFunction(() => requirejs("game-local/player").sh > 0, null, { timeout: 20000 });
		await page.locator("#hud_slot_inventory").click();
		await expect(sheet).toBeVisible();
		await expect(page.locator("#hud_inv_slot_offhand")).toHaveAttribute("data-letter", "c");
		await expect(page.locator("#hud_inv_item_2")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		// 2D keeps the stock menu.
		await page.locator("#hud_view_2d").click();
		await page.keyboard.press("i");
		await expect(page.locator("#ui-stack .menu_inventory")).toBeVisible();
		await expect(sheet).toHaveCount(0);
		await page.keyboard.press("Escape");

		expect(errors).toEqual([]);
	});

	test("tells apart a gear item and a consumable with the same letter", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		// Human Warper: leather armour (b, worn) and a scroll of blinking, also b
		await startGame(page, testInfo, "Twins", ["j", "m", "a"]);

		await page.locator("#hud_slot_inventory").click();
		await expect(page.locator("#hud_inv")).toBeVisible();
		await expect(page.locator("#hud_inv_slot_body")).toHaveAttribute("data-letter", "b");
		await expect(page.locator("#hud_inv_item_1")).toHaveCount(0);
		const scroll = page.locator("#hud_inv_item_52");
		await expect(scroll).toHaveAttribute("data-letter", "b");

		// The scroll's b opens the scroll, not the armour.
		await scroll.click();
		await expect(page.locator("#ui-stack .describe-item .header")).toContainText("blinking");
		await expect(page.locator("#ui-stack .describe-item .hud-act[data-hotkey='r']")).toHaveClass(/\bprimary\b/);
		await page.keyboard.press("Escape");
		await expect(page.locator("#ui-stack .describe-item")).toHaveCount(0);

		// And the armour's b, from the doll, opens the armour.
		await page.locator("#hud_inv_slot_body").click();
		await expect(page.locator("#ui-stack .describe-item .header")).toContainText("leather armour");

		// Its stash search terms are chips, not "Stash search prefixes: {...}".
		const desc = page.locator("#ui-stack .describe-item");
		await expect(desc.locator(".hud-desc-tags .hud-tag", { hasText: /^inventory$/ })).toBeVisible();
		await expect(desc.locator(".body")).not.toContainText("Stash search prefixes");
		await expect(desc.locator(".body")).not.toContainText("____");
		await expect(desc.locator("pre.hud-desc-quote")).toContainText("Blake");
		await page.screenshot({ path: testInfo.outputPath("desc.png") });

		// The close button closes it, back to the sheet.
		await desc.locator(".hud-desc-close").click();
		await expect(desc).toHaveCount(0);
		await expect(page.locator("#hud_inv")).toBeVisible();
		await page.locator("#hud_inv_slot_body").click();
		await expect(page.locator("#ui-stack .describe-item .header")).toContainText("leather armour");

		// Take it off and wear it again from the sheet: it stays open throughout.
		const act = verb => page.locator("#ui-stack .describe-item .hud-act", { hasText: verb });
		await act("Take off").click();
		await expect(page.locator("#hud_inv_slot_body")).not.toHaveAttribute("data-letter", /./, { timeout: 20000 });
		await expect(page.locator("#hud_inv_item_1")).toBeVisible();
		await page.locator("#hud_inv_item_1").click();
		await expect(act("Wear")).toHaveClass(/\bprimary\b/);
		await act("Wear").click();
		await expect(page.locator("#hud_inv_slot_body")).toHaveAttribute("data-letter", "b", { timeout: 20000 });
		await expect(page.locator("#hud_inv_item_1")).toHaveCount(0);
		await expect(page.locator("#hud_inv")).toBeVisible();

		expect(errors).toEqual([]);
	});
});
