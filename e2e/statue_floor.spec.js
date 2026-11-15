"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

test.describe("tall features in 3D", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	// Statues and trees stand as billboards, so the ground under them gets
	// only the floor (or water, for mangroves), not a second flat copy.
	test("leave only floor under statues", async({ page }, testInfo) => {
		await startGame(page, testInfo, "Floor");
		const r = await page.evaluate(() => {
			const view = requirejs("game-local/three_view");
			const dngn = requirejs("game-local/tileinfo-dngn");
			const t = { bg: { value: dngn.DNGN_STATUE_CAT, BLOOD: true }, flv: { f: 7, s: 0 } };
			const floor = view.floor_bg_for(t);
			const tree = view.floor_bg_for($.extend({}, t, { mangrove_water: true }));
			return { floor: floor.bg.value, blood: floor.bg.BLOOD, orig: t.bg.value,
				statue: dngn.DNGN_STATUE_CAT, tree: tree.bg.value,
				tree_water: tree.mangrove_water, water: dngn.DNGN_SHALLOW_WATER };
		});
		expect(r.statue).toBeGreaterThan(0);
		expect(r.floor).toBe(7);
		expect(r.blood).toBe(true);
		expect(r.orig).toBe(r.statue);
		expect(r.tree).toBe(r.water);
		expect(r.tree_water).toBe(false);
	});
});
