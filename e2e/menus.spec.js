"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

// Whether the player carries an item whose name matches re (a source string).
function carries(page, re) {
	return page.evaluate(src => Object.values(requirejs("game-local/player").inv || {})
		.some(it => it && it.quantity > 0 && new RegExp(src).test(it.name || "")), re);
}

async function waitCarries(page, re, want) {
	await expect.poll(() => carries(page, re), { timeout: 20000 }).toBe(want);
}

test.describe("the engine's menus in the 3D HUD", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("drop, pickup and wear menus have buttons and close buttons", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		// Minotaur Fighter: a war axe (a), scale mail and a buckler on, and
		// two potions of might (m).
		await startGame(page, testInfo, "Menus");

		// Drop: the stock list, dressed; not the inventory sheet, though it
		// shares the inventory menu's tag.
		await page.keyboard.press("d");
		const drop = page.locator("#ui-stack .crawl3d-menu .menu_inventory");
		await expect(drop).toBeVisible();
		await expect(page.locator("#hud_inv")).toHaveCount(0);
		await expect(drop.locator(".hud-menu-close")).toBeVisible();
		const axe = drop.locator("li.hud-row", { hasText: "war axe" });
		await expect(axe.locator(".hud-menu-hk .hud-key")).toHaveText("a");
		await axe.click();
		await expect(drop.locator("li.hud-row.hud-picked", { hasText: "war axe" })).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath("drop.png") });
		await drop.locator(".hud-menu-btn", { hasText: "accept" }).click();
		await waitCarries(page, "war axe", false);

		// The potions are in another category: the footer's next button gets there.
		await page.keyboard.press("d");
		await expect(drop).toBeVisible();
		await drop.locator(".hud-menu-next").click();
		const potions = drop.locator("li.hud-row", { hasText: "potions of might" });
		await potions.click();
		await expect(drop.locator("li.hud-picked", { hasText: "potions of might" })).toBeVisible();
		await drop.locator(".hud-menu-btn", { hasText: "accept" }).click();
		await waitCarries(page, "potions? of might", false);

		// Pickup: a sheet of cards, saying what's chosen and what Enter does.
		await page.keyboard.press("g");
		const sheet = page.locator("#hud_pickup");
		await expect(sheet).toBeVisible();
		const axeCard = page.locator("#hud_pickup_item_a");
		const potionCard = page.locator("#hud_pickup_item_b");
		await expect(axeCard).toContainText("war axe");
		await expect(potionCard).toContainText("potions of might");
		const go = page.locator("#hud_pickup_go");
		await expect(go).toContainText("Pick up everything");
		await potionCard.click();
		await expect(potionCard).toHaveClass(/\bpicked\b/);
		await expect(go).toContainText("Pick up 1 item");
		await expect(sheet.locator(".hud-pickup-count")).toHaveText("1 of 2 chosen");
		await page.screenshot({ path: testInfo.outputPath("pickup.png") });
		await page.locator("#hud_pickup_none").click();
		await expect(potionCard).not.toHaveClass(/\bpicked\b/);
		await page.locator("#hud_pickup_all").click();
		await expect(axeCard).toHaveClass(/\bpicked\b/);
		await expect(go).toContainText("Pick up 2 items");
		await axeCard.click();
		await expect(axeCard).not.toHaveClass(/\bpicked\b/);
		await go.click();
		await expect(sheet).toHaveCount(0);
		await waitCarries(page, "potions? of might", true);
		expect(await carries(page, "war axe")).toBe(false);

		// One item left: g takes it without a menu.
		await page.keyboard.press("g");
		await waitCarries(page, "war axe", true);

		// Wear: a close button that closes it.
		await page.keyboard.press("W");
		const wear = page.locator("#ui-stack .crawl3d-menu .menu_use_item");
		await expect(wear).toBeVisible();
		await expect(wear.locator("li.hud-row .hud-menu-hk .hud-key").first()).toBeVisible();
		await wear.locator(".hud-menu-close").click();
		await expect(page.locator("#ui-stack .menu_use_item")).toHaveCount(0);

		// 2D keeps the stock menu.
		await page.locator("#hud_view_2d").click();
		await expect(page.locator("body")).not.toHaveClass(/\bcrawl3d-hud\b/);
		await page.keyboard.press("W");
		const stock = page.locator("#ui-stack .menu_use_item");
		await expect(stock).toBeVisible();
		await expect(page.locator("#ui-stack .crawl3d-menu")).toHaveCount(0);
		await expect(stock.locator(".hud-menu-close, .hud-menu-hk")).toHaveCount(0);
		await page.keyboard.press("Escape");

		expect(errors).toEqual([]);
	});
});
