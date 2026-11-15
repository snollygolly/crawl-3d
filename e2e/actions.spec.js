"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

// Moves the mouse onto map cell (x, y) in the 3D view, which moves the engine's aim there.
async function aimAt(page, x, y) {
	const at = await page.evaluate(([cx, cy]) => requirejs("game-local/three_view").project(cx, cy), [x, y]);
	expect(at).not.toBeNull();
	await page.mouse.move(at.x + 3, at.y + 3);
	await page.mouse.move(at.x, at.y);
	await page.waitForFunction(([cx, cy]) => {
		const a = requirejs("game-local/three_view").aim_loc();
		return a && a.x === cx && a.y === cy;
	}, [x, y], { timeout: 10000, polling: 200 });
	return at;
}

function playerPos(page) {
	return page.evaluate(() => {
		const p = requirejs("game-local/player").pos;
		return { x: p.x, y: p.y };
	});
}

test.describe("hotbar pickers and aiming", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	test("Cast shows spell cards, and a click on the floor casts", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		// Human Conjurer: knows Magic Dart
		await startGame(page, testInfo, "Caster", ["j", "r"]);

		// The engine's spell menu, drawn as cards (with both sets of its columns)
		await page.locator("#hud_slot_cast").click();
		const dart = page.locator("#hud_spells #hud_spell_a");
		await expect(dart).toBeVisible();
		await expect(dart).toContainText("Magic Dart");
		await expect(dart).toContainText("Conjuration");
		await expect(dart).toContainText("1 MP");
		await expect(dart).toContainText(/\d+% fail/);
		await expect(dart).toContainText(/range \d+/);
		// Styled by crawl3d.css, not the stock "#ui-stack button" rule it sits under
		await expect(dart).toHaveCSS("background-color", "rgb(28, 24, 19)");
		await expect(dart).toHaveCSS("margin-left", "0px");
		await expect(page.locator(".ui-popup.crawl3d-spells .menu_spell > :not(#hud_spells)").first()).toBeHidden();
		await expect(page.locator("#hud_slot_cast .hud-count")).toHaveText("1");
		await expect(page.locator("#hud_spells .hud-repeat")).toContainText("Magic Dart");
		await page.screenshot({ path: testInfo.outputPath("spells.png") });

		// Esc closes it without spending a turn.
		const time = await page.locator("#hud_time").textContent();
		await page.keyboard.press("Escape");
		await expect(page.locator("#hud_spells")).toHaveCount(0);
		await expect(page.locator("#hud_time")).toHaveText(time);

		// The z key skips the "Confirm with Enter" prompt and shows the cards too;
		// the panel's Esc button closes it, still without spending a turn.
		await page.keyboard.press("z");
		await expect(page.locator("#hud_spells #hud_spell_a")).toBeVisible();
		await page.locator("#hud_spells_cancel").click();
		await expect(page.locator("#hud_spells")).toHaveCount(0);
		await expect(page.locator("#hud_time")).toHaveText(time);

		// Pick the spell: the aim banner names it.
		await page.locator("#hud_slot_cast").click();
		await page.locator("#hud_spells #hud_spell_a").click();
		await expect(page.locator("#hud_aim")).toBeVisible();
		await expect(page.locator("#hud_aim")).toContainText("Magic Dart");

		// Hover a square two south (open floor on this seed) and click: it casts, which takes time.
		// (The engine takes the MP when aiming starts and gives it back on cancel, so MP can't tell.)
		const p = await playerPos(page);
		const at = await aimAt(page, p.x, p.y + 2);
		await page.screenshot({ path: testInfo.outputPath("aiming.png") });
		const before = await page.locator("#hud_time").textContent();
		await page.mouse.click(at.x, at.y);
		await expect(page.locator("#hud_time")).not.toHaveText(before, { timeout: 15000 });
		await expect(page.locator("#hud_aim")).toBeHidden();
		expect(await page.evaluate(() => requirejs("game-local/three_view").aim_loc())).toBeNull();

		expect(errors).toEqual([]);
	});

	test("Cast works without a default spell, and Djinn spells cost HP", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		// Djinni Conjurer: four spells, none offered by default, so the engine
		// asks "Cast which spell? (? or * to list)" instead of "Confirm with Enter".
		await startGame(page, testInfo, "Djinn", ["n", "r"]);

		await page.locator("#hud_slot_cast").click();
		const cards = page.locator("#hud_spells .hud-card");
		await expect(cards).toHaveCount(4);
		await expect(page.locator("#hud_spells")).toContainText("Searing Ray");
		await expect(page.locator("#hud_spell_a")).toContainText(/\d+ HP/);
		// a long school list runs into the failure column; still parsed
		await expect(page.locator("#hud_spell_d")).toContainText("Conjuration/Translocation");
		await expect(page.locator("#hud_spell_d")).toContainText(/\d+ HP/);
		// no spell offered, so Enter has nothing to repeat
		await expect(page.locator("#hud_spells .hud-repeat")).toBeHidden();
		await expect(page.locator("#hud_spells")).not.toContainText(/\d+ MP/);
		await page.screenshot({ path: testInfo.outputPath("djinn.png") });
		await page.locator("#hud_spells .hud-close").click();
		await expect(page.locator("#hud_spells")).toHaveCount(0);

		// the z key too
		await page.keyboard.press("z");
		await expect(cards).toHaveCount(4);
		await page.keyboard.press("Escape");

		expect(errors).toEqual([]);
	});

	test("Fire and Read pick from the inventory, with counts", async({ page }, testInfo) => {
		const errors = [];
		page.on("pageerror", e => errors.push(e.message));
		// Human Warper (short sword): 4 darts of disjunction, a scroll of blinking
		await startGame(page, testInfo, "Thrower", ["j", "m", "a"]);

		await expect(page.locator("#hud_slot_fire .hud-count")).toHaveText("×4");
		await page.locator("#hud_slot_fire").click();
		const picker = page.locator("#hud_picker");
		await expect(picker).toBeVisible();
		const darts = picker.locator(".hud-card", { hasText: "darts" });
		await expect(darts).toHaveCount(1);
		await expect(darts).toContainText("×4");
		await expect(darts).toHaveClass(/\bquivered\b/);
		await page.screenshot({ path: testInfo.outputPath("fire.png") });

		// Pick the darts, aim, click: one dart fewer.
		await darts.click();
		await expect(picker).toBeHidden();
		await expect(page.locator("#hud_aim")).toBeVisible();
		const p = await playerPos(page);
		const at = await aimAt(page, p.x, p.y + 2);
		await page.mouse.click(at.x, at.y);
		await expect(page.locator("#hud_slot_fire .hud-count")).toHaveText("×3", { timeout: 15000 });
		await expect(page.locator("#hud_aim")).toBeHidden();

		// Read lists the scroll; Esc closes the picker.
		await page.locator("#hud_slot_read").click();
		await expect(picker.locator(".hud-card", { hasText: "blinking" })).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(picker).toBeHidden();

		// Quaff with no potions says so.
		await page.locator("#hud_slot_quaff").click();
		await expect(picker).toContainText("You have no potions");
		await page.locator("#hud_picker .hud-close").click();
		await expect(picker).toBeHidden();

		expect(errors).toEqual([]);
	});
});
