"use strict";

const { test, expect } = require("./fixtures");
const { engineBuild, startGame } = require("./helpers");

const engine = engineBuild();

test.describe("sprite depth in 3D", () => {
	test.skip(!engine.present, `no engine-build/${engine.build}/ - build it with npm run build-engine:docker`);
	test.setTimeout(240000);

	// A sprite standing next to a wall draws over the wall behind it (its head used to
	// be cut off by the wall block), but a wall in front of it still hides it.
	test("draw sprites over the wall behind, under the wall in front", async({ page }, testInfo) => {
		await startGame(page, testInfo, "Depth");
		const r = await page.evaluate(() => {
			const view = requirejs("game-local/three_view");
			const T = window.THREE;
			const SIZE = 128;
			const renderer = new T.WebGLRenderer({ canvas: document.createElement("canvas") });
			const target = new T.WebGLRenderTarget(SIZE, SIZE);
			const camera = new T.PerspectiveCamera(55, 1, 0.1, 100);
			// the default third-person camera
			const pitch = 0.95; const dist = 6.5;
			camera.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
			camera.lookAt(0, 0.5, 0);
			camera.updateMatrixWorld();

			// pixel at a point of the sprite quad, given in view-space offsets from its feet
			const pixel = function pixel(dx, dy) {
				const v = new T.Vector3(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
				v.x += dx; v.y += dy;
				v.applyMatrix4(camera.projectionMatrix);
				return [Math.round((v.x + 1) / 2 * SIZE), Math.round((v.y + 1) / 2 * SIZE)];
			};
			const color_at = function color_at(wall_z, upright, at) {
				const scene = new T.Scene();
				const wall = new T.Mesh(new T.BoxGeometry(1, view.WALL_H, 1),
					new T.MeshBasicMaterial({ color: 0x0000ff }));
				wall.position.set(0, view.WALL_H / 2, wall_z);
				scene.add(wall);
				let mat = new T.SpriteMaterial({ color: 0xff0000, transparent: true, alphaTest: 0.05 });
				if (upright) mat = view.upright_depth(mat);
				const sp = new T.Sprite(mat);
				sp.center.set(0.5, 0.0);
				sp.scale.set(1.5, 2.0, 1);
				scene.add(sp);
				renderer.setRenderTarget(target);
				renderer.render(scene, camera);
				const buf = new Uint8Array(4);
				renderer.readRenderTargetPixels(target, at[0], at[1], 1, 1, buf);
				renderer.setRenderTarget(null);
				if (buf[0] > 200 && buf[2] < 50) return "sprite";
				return buf[2] > 200 ? "wall" : "other";
			};
			const head = pixel(0, 1.8);
			const feet = pixel(0, 0.1);
			const out = {
				head_stock: color_at(-1, false, head),
				head: color_at(-1, true, head),
				feet_behind_wall: color_at(1, true, feet)
			};
			renderer.dispose();
			target.dispose();
			return out;
		});
		// the stock sprite is cut by the wall behind it: the bug this guards against
		expect(r.head_stock).toBe("wall");
		expect(r.head).toBe("sprite");
		expect(r.feet_behind_wall).toBe("wall");
	});
});
