"use strict";

const { test, expect } = require("./fixtures");
const { press, engineBuild, waitInPage } = require("./helpers");

const engine = engineBuild();

// Up to the species screen, as startGame does.
async function openSpecies(page, testInfo, name) {
	await page.goto("/?seed=42");
	await page.locator("#crawl3d_name").fill(name);
	await press(page.locator("#crawl3d_play"), testInfo);
	await expect(page.locator(".ui-popup.crawl3d-newgame .main-items")).toBeVisible({ timeout: 120000 });
}

function screen(page) {
	return page.locator(".ui-popup.crawl3d-newgame").last();
}

function card(page, key) {
	return screen(page).locator(`.main-items > .ng-card[data-hotkey='${key}']`);
}

async function waitStarted(page) {
	await waitInPage(page, () => {
		const t = document.getElementById("stats_time");
		return t && t.textContent.trim() !== "";
	}, "the game to start");
}

test.describe("character creation", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("shows choices as cards with keys, descriptions and buttons", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		await openSpecies(page, testInfo, "Cards");
		const s = screen(page);
		await expect(s.locator(".ng-title")).toContainText("Welcome, Cards.");
		await expect(s.locator(".ng-head")).toHaveText(["Simple", "Intermediate", "Advanced"]);
		const mino = card(page, "b");
		await expect(mino.locator(".hud-key")).toHaveText("b");
		await expect(mino).toHaveAttribute("data-name", "Minotaur");
		await expect(s.locator(".ng-extra", { hasText: "Random species" }).locator(".hud-key")).toHaveText("*");
		await expect(s.locator(".ng-close")).toBeVisible();
		await expect(page.locator("#chat")).toBeHidden();

		// hovering shows the description; a mouse needs no Choose button
		await mino.hover();
		await expect(s.locator(".ng-info-name")).toHaveText("Minotaur");
		await expect(s.locator(".descriptions > .pane.current")).toContainText("Minotaur");
		await expect(page.locator("#hud_newgame_choose")).toBeHidden();
		await page.screenshot({ path: testInfo.outputPath("species.png") });

		// a click picks; the background screen marks what's recommended
		await mino.click();
		await expect(screen(page).locator(".ng-title")).toContainText("Please select your background");
		await expect(card(page, "a")).toHaveClass(/ng-rec/);
		await expect(card(page, "a").locator(".ng-card-note")).toHaveText("Recommended");

		// the footer buttons work: back to species, then by keys as before
		await screen(page).locator(".ng-extra", { hasText: "Change species" }).click();
		await expect(screen(page).locator(".ng-title")).toContainText("Please select your species");
		await page.keyboard.press("b");
		await expect(screen(page).locator(".ng-title")).toContainText("Please select your background");
		await page.keyboard.press("a");

		// weapons: one column of cards, flowed, with their aptitude notes
		await expect(screen(page).locator(".main-items")).toHaveClass(/ng-single/);
		await expect(card(page, "c").locator(".ng-card-note")).toHaveText("(+2 apt)");
		await page.screenshot({ path: testInfo.outputPath("weapon.png") });
		await card(page, "c").click();
		await waitStarted(page);
		expect(errors).toEqual([]);
	});


	test("a random character asks first, with buttons for Y / n / q", async({ page }, testInfo) => {
		await openSpecies(page, testInfo, "Dice");
		await page.keyboard.press("!");
		const combo = page.locator(".ui-popup.crawl3d-ng-combo");
		await expect(combo.locator(".ng-combo-ask")).toHaveText("Do you want to play this combination?");
		await expect(combo.locator(".hud-key")).toHaveText(["Y", "n", "q"]);
		// n rolls another: still asking
		await combo.locator(".ng-combo-btn", { hasText: "Roll again" }).click();
		await page.waitForTimeout(1000);
		await expect(combo.locator(".ng-combo-ask")).toBeVisible();
		await combo.locator(".ng-combo-btn", { hasText: "Play it" }).click();
		await waitStarted(page);
	});
});

test.describe("character creation on a phone", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

	test("fits the screen, and a tap previews before Choose picks", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		await openSpecies(page, testInfo, "Thumbs");
		const fit = await page.evaluate(() => {
			const r = document.querySelector(".crawl3d-newgame .ui-popup-outer").getBoundingClientRect();
			return { l: r.left, r: r.right, t: r.top, b: r.bottom, sw: document.documentElement.scrollWidth };
		});
		expect(fit.l).toBeGreaterThanOrEqual(0);
		expect(fit.r).toBeLessThanOrEqual(390);
		expect(fit.t).toBeGreaterThanOrEqual(0);
		expect(fit.b).toBeLessThanOrEqual(844);
		expect(fit.sw).toBeLessThanOrEqual(390);

		// first tap: selected and described, not picked
		const mino = card(page, "b");
		await mino.tap();
		await expect(mino).toHaveClass(/selected/);
		await expect(screen(page).locator(".ng-info-name")).toHaveText("Minotaur");
		const choose = page.locator("#hud_newgame_choose");
		await expect(choose).toHaveText("Choose Minotaur");
		await page.waitForTimeout(1500);
		await expect(screen(page).locator(".ng-title")).toContainText("Please select your species");
		await page.screenshot({ path: testInfo.outputPath("phone-species.png") });
		await choose.tap();
		await expect(screen(page).locator(".ng-title")).toContainText("Please select your background");

		// a second tap on the same card picks it too
		await card(page, "a").tap();
		await expect(card(page, "a")).toHaveClass(/selected/);
		await card(page, "a").tap();
		await expect(screen(page).locator(".main-items")).toHaveClass(/ng-single/);
		await card(page, "c").tap();
		await page.locator("#hud_newgame_choose").tap();
		await waitStarted(page);
		expect(errors).toEqual([]);
	});
});
