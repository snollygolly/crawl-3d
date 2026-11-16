"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

test.describe("doors in 3D", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	// Wall blocks near the camera-to-player line are ghosted, and picking looks
	// through them. With the camera overhead that covers every neighbouring cell,
	// so doors beside the player used to be unclickable. Ghosted or not, a closed
	// door takes the click from any angle.
	test("closed doors beside the player are clickable from any camera angle", async({ page }, testInfo) => {
		await startGame(page, testInfo, "Door");

		// The fixed seed has no door in sight at the start, so turn the open floor
		// around the player into closed doors in the client's map knowledge, which
		// is what the 3D view draws and picks from.
		const doors = await page.evaluate(() => {
			const view = requirejs("game-local/three_view");
			const mk = requirejs("game-local/map_knowledge");
			const dngn = requirejs("game-local/tileinfo-dngn");
			const player = requirejs("game-local/player");
			const out = [];
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					if (!dx && !dy) continue;
					const x = player.pos.x + dx; const y = player.pos.y + dy;
					const c = mk.get(x, y);
					if (!c.t || c.__wall3d || c.mon) continue;
					c.t.bg = dngn.DNGN_CLOSED_DOOR;
					out.push({ x, y });
				}
			view.update(out);
			view.settings.mode = "third";
			return out;
		});
		expect(doors.length).toBeGreaterThan(0);

		const misses = [];
		for (const pitch of [0.95, 1.45])
			for (let i = 0; i < 8; i++) {
				const yaw = i * Math.PI / 4;
				await page.evaluate(([p, yw]) => {
					const view = requirejs("game-local/three_view");
					view.settings.pitch = p;
					view.settings.yaw = yw;
				}, [pitch, yaw]);
				// the camera eases to the new yaw
				await page.waitForTimeout(700);
				const got = await page.evaluate(ds => {
					const view = requirejs("game-local/three_view");
					const out = [];
					for (const d of ds) {
						const p = view.project(d.x, d.y, view.WALL_H);
						out.push({ d, p, hit: p ? view.pick_target(p.x, p.y) : null,
							floor: p ? view.pick(p.x, p.y) : null });
					}
					return out;
				}, doors);
				for (const g of got) {
					// off screen at this angle: nothing to click
					if (!g.p) continue;
					if (!g.hit || g.hit.x !== g.d.x || g.hit.y !== g.d.y || g.floor)
						misses.push({ pitch, yaw: i * 45, door: g.d, hit: g.hit, floor: g.floor });
				}
			}
		expect(misses).toEqual([]);
	});
});
