"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

test.describe("monster health bars in 3D", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	// Crawl tells the player a monster's damage level through its fg tile flags; the
	// 3D view draws it as a bar over the monster's head, none while uninjured.
	test("a damaged monster in view gets a bar that steps with its damage", async({ page }, testInfo) => {
		await startGame(page, testInfo, "Bars");

		// No monster is in sight at the start of the fixed seed, so put a rat on an
		// open floor cell next to the player in the client's map knowledge.
		const MDAM = {
			light: [0x40000000, 0],
			adead: [0x40000000 | (1 << 31), 1],
			none: [0, 0]
		};
		const spot = await page.evaluate(() => {
			const mk = requirejs("game-local/map_knowledge");
			const player = requirejs("game-local/player");
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
				const x = player.pos.x + dx; const y = player.pos.y + dy;
				const c = mk.get(x, y);
				if (c.t && !c.__wall3d && !c.mon && mk.visible(c)) return { x, y };
			}
			return null;
		});
		expect(spot).not.toBeNull();

		const set_damage = bits => page.evaluate(([at, b]) => {
			const view = requirejs("game-local/three_view");
			const mk = requirejs("game-local/map_knowledge");
			const tp = requirejs("game-local/tileinfo-player");
			const c = mk.get(at.x, at.y);
			c.mon = { id: 990001, name: "rat", plural: "rats", att: 0, threat: 1, typedata: {} };
			c.t.fg = [(tp.MONS_RAT | b[0]) >>> 0, b[1]];
			view.update([at]);
		}, [spot, bits]);
		const bar = page.locator("#hpbar_990001");

		await set_damage(MDAM.none);
		await page.waitForTimeout(300);
		await expect(bar).toHaveCount(0);

		await set_damage(MDAM.light);
		await expect(bar).toHaveAttribute("data-level", "1");
		await expect(bar).toBeVisible();

		await set_damage(MDAM.adead);
		await expect(bar).toHaveAttribute("data-level", "5");
		await expect(bar).toHaveAttribute("title", "almost dead");

		// the bar sits above the monster's tile on screen
		const where = await page.evaluate(at => requirejs("game-local/three_view").project(at.x, at.y), spot);
		const box = await bar.boundingBox();
		expect(Math.abs(box.x + box.width / 2 - where.x)).toBeLessThan(40);
		expect(box.y).toBeLessThan(where.y);

		// gone when the monster leaves
		await page.evaluate(at => {
			const mk = requirejs("game-local/map_knowledge");
			const c = mk.get(at.x, at.y);
			delete c.mon;
			c.t.fg = 0;
			requirejs("game-local/three_view").update([at]);
		}, spot);
		await expect(bar).toHaveCount(0);
	});
});
