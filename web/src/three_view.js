// three_view.js -- a three.js 3D view of the Crawl dungeon.
//
// It reads the same map_knowledge state the stock 2D renderer uses, and draws:
//   * a ground plane textured from a big "atlas" canvas holding every cell's
//     background tile (drawn with the stock cell renderer)
//   * extruded boxes for walls and closed doors, textured from the same atlas
//   * billboard sprites for monsters, items, the player, clouds and bolts,
//     drawn per cell by the stock renderer and cached as textures
// Monster sprites are tracked by monster id and glide between cells, which
// hides the turn-based steps.
define(["jquery", "comm", "./map_knowledge", "./cell_renderer", "./player",
	"./tileinfo-dngn", "./enums"],
function($, comm, map_knowledge, cr, player, dngn, enums) {
	"use strict";

	let THREE = null;
	// Map size and tile size. WebTiles coordinates are relative to the
	// first cell sent for a level, so they can be negative; the real map is
	// still at most GXM x GYM, so (x mod GXM, y mod GYM) gives each cell a
	// unique slot in the atlas.
	const GXM = 80; const GYM = 70; const TS = 32;
	function slot_x(x) { return ((x % GXM) + GXM) % GXM; }
	function slot_y(y) { return ((y % GYM) + GYM) % GYM; }
	const WALL_H = 1.25;

	// everything per game; null until init
	let state = null;
	const settings = {
		// "third" | "first"
		mode: "third",
		// radians; 0 = camera looking north (-z)
		yaw: 0,
		// third-person elevation angle
		pitch: 0.95,
		dist: 6.5,
		enabled: true
	};
	try {
		const saved = JSON.parse(localStorage.getItem("crawl3d_settings") || "{}");
		$.extend(settings, saved);
	} catch (e) {}
	function save_settings()
	{
		try { localStorage.setItem("crawl3d_settings", JSON.stringify(settings)); }
		catch (e) {}
	}

	// ------------------------------------------------------------------
	// Tile drawing helpers: reuse the stock DungeonCellRenderer on our own
	// canvases.

	function make_ctx_proxy(ctx)
	{
		// The stock renderer clears each cell to black first; for sprites we
		// want transparency, so drop black fills.
		return new Proxy(ctx, {
			get: function(t, p) {
				if (p === "fillRect")
					return function(x, y, w, h) {
						if (t.fillStyle === "#000000") return;
						t.fillRect(x, y, w, h);
					};
				const v = t[p];
				return typeof v === "function" ? v.bind(t) : v;
			},
			set: function(t, p, v) { t[p] = v; return true; }
		});
	}

	function TileDrawer(w, h, transparent)
	{
		this.canvas = document.createElement("canvas");
		this.canvas.width = w;
		this.canvas.height = h;
		cr.DungeonCellRenderer.prototype.init.call(this, this.canvas);
		if (transparent)
			this.ctx = make_ctx_proxy(this.ctx);
		// The stock renderer multiplies by devicePixelRatio; undo that so
		// one tile is exactly TS pixels.
		const dpr = window.devicePixelRatio || 1;
		this.set_cell_size(TS / dpr, TS / dpr);
		this.ui_state = -1;
	}
	TileDrawer.prototype = new cr.DungeonCellRenderer();
	TileDrawer.prototype.scaled_size = function(w, h) {
		return { width: TS, height: TS };
	};
	TileDrawer.prototype.render_cursors = function() {};

	// ------------------------------------------------------------------
	// Classification of background tiles

	let box_tiles = null; let tall_tiles = null;
	function build_tile_sets()
	{
		box_tiles = new Set();
		tall_tiles = new Set();
		function add_range(set, idx)
		{
			let n = 1;
			try { n = dngn.tile_count(idx) || 1; } catch (e) {}
			for (let i = 0; i < n; i++) set.add(idx + i);
		}
		for (const key in dngn)
		{
			const idx = dngn[key];
			if (typeof idx !== "number") continue;
			if (/^DNGN_(CLOSED|RUNED|SEALED)(_CLEAR)?_DOOR/.test(key))
				add_range(box_tiles, idx);
			else if (/^DNGN_.*(TREE|MANGROVE|STATUE|IDOL)/.test(key))
				add_range(tall_tiles, idx);
		}
	}

	function bg_value(cell)
	{
		if (!cell || !cell.t) return 0;
		cell.t.bg = enums.prepare_bg_flags(cell.t.bg || 0);
		return cell.t.bg.value;
	}
	function is_wall(v)
	{
		return (v >= dngn.FLOOR_MAX && v < dngn.WALL_MAX) || box_tiles.has(v);
	}
	function is_known(cell)
	{
		return cell && cell.t && bg_value(cell) > dngn.DNGN_UNSEEN;
	}

	// ------------------------------------------------------------------
	// Scene setup

	function init()
	{
		THREE = window.THREE;
		if (!THREE)
		{
			console.error("three.js not loaded; 3D view disabled");
			return;
		}
		if (state) cleanup();
		if (!box_tiles) build_tile_sets();

		const s = state = {};
		s.container = $("<div id='three_view'></div>").appendTo(document.body);
		s.renderer = new THREE.WebGLRenderer({ antialias: true });
		s.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		s.renderer.outputColorSpace = THREE.SRGBColorSpace;
		s.container.append(s.renderer.domElement);

		s.scene = new THREE.Scene();
		s.scene.background = new THREE.Color(0x05040a);
		s.scene.fog = new THREE.Fog(0x05040a, 7, 18);
		s.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);

		s.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
		s.torch = new THREE.PointLight(0xffc98a, 6, 9, 1.2);
		s.scene.add(s.torch);

		// Atlas of background tiles for the whole level
		s.atlas = document.createElement("canvas");
		s.atlas.width = GXM * TS;
		s.atlas.height = GYM * TS;
		s.atlas_ctx = s.atlas.getContext("2d");
		s.atlas_ctx.fillStyle = "#000";
		s.atlas_ctx.fillRect(0, 0, s.atlas.width, s.atlas.height);
		s.atlas_tex = new THREE.CanvasTexture(s.atlas);
		s.atlas_tex.magFilter = THREE.NearestFilter;
		s.atlas_tex.minFilter = THREE.LinearMipmapLinearFilter;
		s.atlas_tex.colorSpace = THREE.SRGBColorSpace;
		s.atlas_tex.anisotropy = 4;
		s.atlas_tex.wrapS = THREE.RepeatWrapping;
		s.atlas_tex.wrapT = THREE.RepeatWrapping;

		s.bg_drawer = new TileDrawer(TS, TS, false);
		s.fg_drawer = new TileDrawer(TS + 16, TS * 2, true);

		s.ground = new THREE.Mesh(new THREE.BufferGeometry(),
			new THREE.MeshLambertMaterial({ map: s.atlas_tex }));
		s.scene.add(s.ground);
		s.ground_bounds = null;

		s.wall_mat = new THREE.MeshLambertMaterial({ map: s.atlas_tex });
		// "Cutaway" walls: in third person, walls between the camera and the
		// player are squashed down so they don't hide the action.
		s.cut = { uCut: { value: new THREE.Vector4(0, 0, 0, -1) },
			uCutOn: { value: 1.0 } };
		s.wall_mat.onBeforeCompile = function(shader) {
			shader.uniforms.uCut = s.cut.uCut;
			shader.uniforms.uCutOn = s.cut.uCutOn;
			const cutaway = [
				"#include <begin_vertex>",
				"{ vec2 rel = cellCenter - uCut.xy;",
				"  float along = dot(rel, uCut.zw);",
				"  float perp = abs(rel.x * uCut.w - rel.y * uCut.z);",
				"  if (uCutOn > 0.5 && along < -0.6 && perp < 7.0)",
				"    transformed.y *= 0.12; }"
			].join("\n");
			const body = shader.vertexShader.replace("#include <begin_vertex>", cutaway);
			shader.vertexShader = `uniform vec4 uCut;\nuniform float uCutOn;\nattribute vec2 cellCenter;\n${body}`;
		};
		s.walls = null;
		s.walls_dirty = true;
		s.atlas_dirty = true;

		// key -> {sprite, target, key}
		s.sprites = {};
		s.tex_cache = new Map();
		s.player_pos = new THREE.Vector3(0, 0, 0);
		s.player_target = null;
		s.hover = make_hover_marker();
		s.scene.add(s.hover);
		s.raycaster = new THREE.Raycaster();
		s.last_time = performance.now();

		build_toolbar();
		bind_input();
		apply_enabled();
		s.running = true;
		requestAnimationFrame(frame);
	}

	function cleanup()
	{
		if (!state) return;
		state.running = false;
		state.renderer.dispose();
		state.container.remove();
		$("#three_toolbar").remove();
		window.removeEventListener("keydown", state.key_handler, true);
		$(window).off(".t3d");
		state = null;
	}

	function make_hover_marker()
	{
		const geo = new THREE.RingGeometry(0.36, 0.46, 32);
		geo.rotateX(-Math.PI / 2);
		const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
			color: 0xffe28a, transparent: true, opacity: 0.8 }));
		m.position.y = 0.02;
		m.visible = false;
		return m;
	}

	// ------------------------------------------------------------------
	// Map updates (called from display.js with the dirty cells)

	function update(dirty)
	{
		if (!state) return;
		for (let i = 0; i < dirty.length; i++)
			draw_atlas_cell(dirty[i].x, dirty[i].y);
	}

	function draw_atlas_cell(x, y)
	{
		const s = state;
		const cell = map_knowledge.get(x, y);
		const ctx = s.atlas_ctx;
		const px = slot_x(x) * TS; const py = slot_y(y) * TS;
		const v = bg_value(cell);
		const was_wall = cell.__wall3d;
		cell.__wall3d = is_known(cell) && is_wall(v);
		if (was_wall !== cell.__wall3d) s.walls_dirty = true;

		if (!is_known(cell))
		{
			ctx.fillStyle = "#000";
			ctx.fillRect(px, py, TS, TS);
		}
		else
		{
			const b = s.bg_drawer;
			b.ctx.fillStyle = "#000";
			b.ctx.fillRect(0, 0, TS, TS);
			const t = cell.t;
			t.fg = enums.prepare_fg_flags(t.fg || 0);
			t.flv = t.flv || {};
			t.flv.f = t.flv.f || 0;
			t.flv.s = t.flv.s || 0;
			try { b.draw_background(0, 0, t); } catch (e) {}
			ctx.drawImage(b.canvas, px, py);
			if (!map_knowledge.visible(cell))
			{
				// remembered but out of sight
				ctx.fillStyle = "rgba(10, 8, 30, 0.55)";
				ctx.fillRect(px, py, TS, TS);
			}
		}
		s.atlas_dirty = true;
	}

	function clear()
	{
		if (!state) return;
		const s = state;
		s.atlas_ctx.fillStyle = "#000";
		s.atlas_ctx.fillRect(0, 0, s.atlas.width, s.atlas.height);
		s.atlas_dirty = true;
		s.walls_dirty = true;
		s.ground_bounds = null;
		for (const k in s.sprites)
			remove_sprite(k);
		s.player_target = null;
	}

	// The ground is one quad covering the known part of the level; its UVs
	// wrap around the atlas the same way the slots do.
	function update_ground()
	{
		const s = state;
		const b = map_knowledge.bounds();
		if (!b) return;
		const key = [b.left, b.top, b.right, b.bottom].join(",");
		if (key === s.ground_bounds) return;
		s.ground_bounds = key;
		const x0 = b.left; const x1 = b.right + 1; const z0 = b.top; const z1 = b.bottom + 1;
		const pos = [x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0];
		const uv = [];
		for (let i = 0; i < pos.length; i += 3)
			uv.push(pos[i] / GXM, 1 - pos[i + 2] / GYM);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
		geo.computeVertexNormals();
		s.ground.geometry.dispose();
		s.ground.geometry = geo;
	}

	// Build one merged geometry for all wall boxes, skipping hidden faces.
	function rebuild_walls()
	{
		const s = state;
		s.walls_dirty = false;
		if (s.walls)
		{
			s.scene.remove(s.walls);
			s.walls.geometry.dispose();
			s.walls = null;
		}
		const pos = []; const uv = []; const nrm = []; const col = []; const ctr = [];
		let cx = 0; let cz = 0;
		const b = map_knowledge.bounds();
		if (!b) return;
		function wall_at(x, y)
		{
			return !!map_knowledge.get(x, y).__wall3d;
		}
		function quad(a, b, c, d, n, u0, v0, u1, v1, shade)
		{
			pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
				a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
			uv.push(u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0);
			for (let i = 0; i < 6; i++)
			{
				nrm.push(n[0], n[1], n[2]);
				col.push(shade, shade, shade);
				ctr.push(cx, cz);
			}
		}
		for (let y = b.top; y <= b.bottom; y++)
			for (let x = b.left; x <= b.right; x++)
			{
				const cell = map_knowledge.get(x, y);
				if (!cell.__wall3d) continue;
				// atlas UVs for this cell (v flipped: canvas y down)
				const sx = slot_x(x); const sy = slot_y(y);
				const u0 = sx / GXM; const u1 = (sx + 1) / GXM;
				const v1 = 1 - sy / GYM; const v0 = 1 - (sy + 1) / GYM;
				const shade = map_knowledge.visible(cell) ? 1.0 : 0.75;
				cx = x + 0.5; cz = y + 0.5;
				const h = WALL_H;
				// top
				quad([x, h, y + 1], [x + 1, h, y + 1], [x + 1, h, y], [x, h, y],
					[0, 1, 0], u0, v0, u1, v1, shade * 0.8);
				// south face (+z)
				if (!wall_at(x, y + 1))
					quad([x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, h, y + 1], [x, h, y + 1],
						[0, 0, 1], u0, v0, u1, v1, shade);
				// north face
				if (!wall_at(x, y - 1))
					quad([x + 1, 0, y], [x, 0, y], [x, h, y], [x + 1, h, y],
						[0, 0, -1], u0, v0, u1, v1, shade);
				// east face
				if (!wall_at(x + 1, y))
					quad([x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, h, y], [x + 1, h, y + 1],
						[1, 0, 0], u0, v0, u1, v1, shade * 0.9);
				// west face
				if (!wall_at(x - 1, y))
					quad([x, 0, y], [x, 0, y + 1], [x, h, y + 1], [x, h, y],
						[-1, 0, 0], u0, v0, u1, v1, shade * 0.9);
			}
		if (!pos.length) return;
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
		geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
		geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
		geo.setAttribute("cellCenter", new THREE.Float32BufferAttribute(ctr, 2));
		s.wall_mat.vertexColors = true;
		s.walls = new THREE.Mesh(geo, s.wall_mat);
		s.scene.add(s.walls);
	}

	// ------------------------------------------------------------------
	// Sprites

	function sprite_key_for(cell, x, y)
	{
		if (x == player.pos.x && y == player.pos.y && map_knowledge.player_on_level())
			return "player";
		if (cell.mon && cell.mon.id)
			return `mon:${cell.mon.id}`;
		return `cell:${x},${y}`;
	}

	function fg_signature(cell)
	{
		const t = cell.t;
		if (!t) return null;
		const fg = t.fg && t.fg.value !== undefined ? t.fg.value : (t.fg || 0);
		const cloud = t.cloud && t.cloud.value !== undefined ? t.cloud.value : (t.cloud || 0);
		const ov = (t.ov || []).filter(function(o) {
			return o >= dngn.FEAT_MAX; });
		const tall = tall_tiles.has(bg_value(cell)) ? bg_value(cell) : 0;
		if (!fg && !cloud && !ov.length && !t.doll && !t.mcache && !tall)
			return null;
		return JSON.stringify([fg, cloud, ov, t.doll || 0, t.mcache || 0,
			t.trans || 0, tall,
			cell.mon ? [cell.mon.att, cell.mon.typedata] : 0]);
	}

	function texture_for(cell, x, y, sig)
	{
		const s = state;
		let tex = s.tex_cache.get(sig);
		if (tex)
		{
			// LRU bump
			s.tex_cache.delete(sig);
			s.tex_cache.set(sig, tex);
			return tex;
		}
		const d = s.fg_drawer;
		d.ctx.clearRect(0, 0, d.canvas.width, d.canvas.height);
		const tall = tall_tiles.has(bg_value(cell));
		try
		{
			if (tall)
				d.draw_dngn(bg_value(cell), 8, TS);
			// Draw only the foreground layers of this cell, without the 2D
			// cursor/highlight boxes
			const bg = $.extend({}, enums.prepare_bg_flags(cell.t.bg || 0),
				{ CURSOR1: false, CURSOR2: false, CURSOR3: false,
					TUT_CURSOR: false, NEW_STAIR: false, NEW_TRANSPORTER: false });
			const t = $.extend({}, cell.t, { bg: bg });
			const saved_bg = d.draw_background;
			d.draw_background = function() {};
			d.do_render_cell(x, y, 8, TS, $.extend({}, cell, { t: t }), t);
			d.draw_background = saved_bg;
		}
		catch (e)
		{
			console.warn("sprite draw failed", e);
		}
		const c = document.createElement("canvas");
		c.width = d.canvas.width;
		c.height = d.canvas.height;
		c.getContext("2d").drawImage(d.canvas, 0, 0);
		tex = new THREE.CanvasTexture(c);
		tex.magFilter = THREE.NearestFilter;
		tex.colorSpace = THREE.SRGBColorSpace;
		s.tex_cache.set(sig, tex);
		if (s.tex_cache.size > 400)
		{
			const oldest = s.tex_cache.keys().next().value;
			s.tex_cache.get(oldest).dispose();
			s.tex_cache.delete(oldest);
		}
		return tex;
	}

	function remove_sprite(key)
	{
		const e = state.sprites[key];
		if (!e) return;
		state.scene.remove(e.sprite);
		e.sprite.material.dispose();
		delete state.sprites[key];
	}

	// Rebuild the sprite list from the current map knowledge around the
	// player. Cheap enough to do every frame for a 23x23 window, but we only
	// do it when something changed.
	function refresh_sprites()
	{
		const s = state;
		const seen = {};
		const px = player.pos.x; const py = player.pos.y;
		const R = 16;
		for (let y = py - R; y <= py + R; y++)
			for (let x = px - R; x <= px + R; x++)
			{
				const cell = map_knowledge.get(x, y);
				if (!is_known(cell)) continue;
				const sig = fg_signature(cell);
				if (!sig) continue;
				let key = sprite_key_for(cell, x, y);
				if (seen[key]) key = `${key}@${x},${y}`;
				seen[key] = true;
				let e = s.sprites[key];
				if (!e)
				{
					const mat = new THREE.SpriteMaterial({
						transparent: true, alphaTest: 0.05, fog: true });
					const sp = new THREE.Sprite(mat);
					sp.center.set(0.5, 0.0);
					sp.scale.set(1.5, 2.0, 1);
					e = s.sprites[key] = { sprite: sp, sig: null,
						target: new THREE.Vector3() };
					sp.position.set(x + 0.5, 0, y + 0.5);
					s.scene.add(sp);
				}
				if (e.sig !== sig)
				{
					e.sig = sig;
					e.sprite.material.map = texture_for(cell, x, y, sig);
					e.sprite.material.needsUpdate = true;
				}
				// Lone items sit smaller on the floor; creatures stand tall
				const small = !cell.mon && key !== "player" && !cell.t.doll
                            && !cell.t.mcache && !tall_tiles.has(bg_value(cell));
				e.sprite.scale.set(small ? 0.9 : 1.5, small ? 1.2 : 2.0, 1);
				const vis = map_knowledge.visible(cell);
				e.sprite.material.color.setScalar(vis ? 1.0 : 0.45);
				// Shift the sprite so its tile (not the padding) is centred
				e.target.set(x + 0.5, 0, y + 0.5);
				e.is_player = (key === "player");
			}
		for (const k in s.sprites)
			if (!seen[k]) remove_sprite(k);
	}

	// ------------------------------------------------------------------
	// Frame loop: camera follow, sprite gliding, rendering

	function layout()
	{
		const s = state;
		const dungeon = document.getElementById("dungeon");
		const r = dungeon && $(dungeon).is(":visible") ? dungeon.getBoundingClientRect() : null;
		const bar = $("#three_toolbar");
		if (r && r.width >= 10)
			bar.show().css({ left: r.left + window.scrollX + 8,
				top: r.top + window.scrollY + 8 });
		else
			bar.hide();
		if (!r || r.width < 10 || !settings.enabled)
		{
			s.container.hide();
			return false;
		}
		s.container.show().css({ left: r.left + window.scrollX,
			top: r.top + window.scrollY,
			width: r.width, height: r.height });
		if (s.w !== r.width || s.h !== r.height)
		{
			s.w = r.width; s.h = r.height;
			s.renderer.setSize(r.width, r.height);
			s.camera.aspect = r.width / r.height;
			s.camera.updateProjectionMatrix();
		}
		return true;
	}

	function frame(now)
	{
		if (!state || !state.running) return;
		requestAnimationFrame(frame);
		const s = state;
		const dt = Math.min(0.1, (now - s.last_time) / 1000);
		s.last_time = now;
		if (!layout()) return;

		if (s.atlas_dirty)
		{
			s.atlas_tex.needsUpdate = true;
			s.atlas_dirty = false;
			refresh_sprites();
		}
		if (s.walls_dirty) rebuild_walls();
		update_ground();

		// Glide sprites and the player toward their cells
		const k = 1 - Math.exp(-dt * 14);
		for (const key in s.sprites)
		{
			const e = s.sprites[key];
			const p = e.sprite.position;
			// teleports
			if (p.distanceToSquared(e.target) > 9) p.copy(e.target);
			else p.lerp(e.target, k);
			e.sprite.visible = !(e.is_player && settings.mode === "first");
		}
		if (map_knowledge.player_on_level())
		{
			if (s.last_pos && (s.last_pos.x !== player.pos.x || s.last_pos.y !== player.pos.y))
			{
				const dx = player.pos.x - s.last_pos.x; const dy = player.pos.y - s.last_pos.y;
				// In first person, turn to face the way we walked, unless the
				// step came from the camera-relative arrow keys.
				if (settings.mode === "first" && !s.arrow_step
                    && Math.abs(dx) <= 1 && Math.abs(dy) <= 1)
					settings.yaw = s.cam_yaw + angle_diff(Math.atan2(dx, -dy), s.cam_yaw);
				s.arrow_step = false;
			}
			s.last_pos = { x: player.pos.x, y: player.pos.y };
			const tgt = new THREE.Vector3(player.pos.x + 0.5, 0, player.pos.y + 0.5);
			if (!s.player_target || s.player_pos.distanceToSquared(tgt) > 9)
				s.player_pos.copy(tgt);
			else
				s.player_pos.lerp(tgt, k);
			s.player_target = tgt;
		}

		// Camera
		const cam = s.camera;
		const pp = s.player_pos;
		const fwd = new THREE.Vector3(Math.sin(settings.yaw), 0, -Math.cos(settings.yaw));
		s.cam_yaw = s.cam_yaw === undefined ? settings.yaw
			: s.cam_yaw + angle_diff(settings.yaw, s.cam_yaw) * (1 - Math.exp(-dt * 10));
		const cf = new THREE.Vector3(Math.sin(s.cam_yaw), 0, -Math.cos(s.cam_yaw));
		if (settings.mode === "first")
		{
			cam.fov = 75;
			cam.position.set(pp.x - cf.x * 0.4, 0.62, pp.z - cf.z * 0.4);
			cam.lookAt(pp.x + cf.x * 4, 0.45, pp.z + cf.z * 4);
			s.scene.fog.near = 3; s.scene.fog.far = 13;
		}
		else
		{
			cam.fov = 55;
			const d = settings.dist;
			const h = Math.sin(settings.pitch) * d; const back = Math.cos(settings.pitch) * d;
			cam.position.set(pp.x - cf.x * back, h, pp.z - cf.z * back);
			cam.lookAt(pp.x, 0.5, pp.z);
			s.scene.fog.near = d + 2; s.scene.fog.far = d + 13;
		}
		cam.updateProjectionMatrix();
		s.torch.position.set(pp.x, 1.6, pp.z);
		s.cut.uCut.value.set(pp.x, pp.z, cf.x, cf.z);
		s.cut.uCutOn.value = settings.mode === "first" ? 0.0 : 1.0;
		s.torch.intensity = 5 + Math.sin(now / 130) * 0.25 + Math.sin(now / 57) * 0.15;

		s.renderer.render(s.scene, cam);
	}

	function angle_diff(a, b)
	{
		let d = a - b;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		return d;
	}

	// ------------------------------------------------------------------
	// Input: camera-relative arrows, mouse orbit, click-to-travel

	// Crawl's absolute directions as vi-keys, clockwise from north.
	const DIR_KEYS = ["k", "u", "l", "n", "j", "b", "h", "y"];

	function game_has_focus()
	{
		// Don't steal keys from menus, prompts or text boxes.
		if ($(document.activeElement).is("input, textarea")) return false;
		if ($("#ui-stack").children(":visible").length) return false;
		if ($(".ui-popup:visible").length) return false;
		if ($("#normal").length && !$("#normal").is(":visible")) return false;
		return true;
	}

	function send_key(ch)
	{
		comm.send_message("key", { keycode: ch.charCodeAt(0) });
	}

	function dir_index_for(offset)
	{
		// offset 0 = camera forward; returns index into DIR_KEYS
		const steps = Math.round(settings.yaw / (Math.PI / 4));
		return (((steps + offset) % 8) + 8) % 8;
	}

	function bind_input()
	{
		const s = state;
		s.key_handler = function(ev) {
			if (!settings.enabled || !game_has_focus()) return;
			if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
			const k = ev.key;
			let dir = null;
			if (settings.mode === "first")
			{
				if (k === "ArrowLeft" || k === "ArrowRight")
				{
					settings.yaw += (k === "ArrowLeft" ? -1 : 1) * Math.PI / 4;
					save_settings();
					ev.preventDefault();
					ev.stopImmediatePropagation();
					return;
				}
				if (k === "ArrowUp") dir = 0;
				else if (k === "ArrowDown") dir = 4;
			}
			else
			{
				if (k === "ArrowUp") dir = 0;
				else if (k === "ArrowRight") dir = 2;
				else if (k === "ArrowDown") dir = 4;
				else if (k === "ArrowLeft") dir = 6;
			}
			if (dir === null) return;
			s.arrow_step = true;
			// shift = run in that direction
			if (ev.shiftKey)
				send_key(DIR_KEYS[dir_index_for(dir)].toUpperCase());
			else
				send_key(DIR_KEYS[dir_index_for(dir)]);
			ev.preventDefault();
			ev.stopImmediatePropagation();
		};
		// capture phase on window runs before the stock client's handlers
		window.addEventListener("keydown", s.key_handler, true);

		const el = s.renderer.domElement;
		let drag = null;
		$(el).on("contextmenu", function(ev) { ev.preventDefault(); });
		el.addEventListener("pointerdown", function(ev) {
			drag = { x: ev.clientX, y: ev.clientY, moved: 0, button: ev.button,
				yaw: settings.yaw, pitch: settings.pitch };
			el.setPointerCapture(ev.pointerId);
		});
		el.addEventListener("pointermove", function(ev) {
			if (drag)
			{
				const dx = ev.clientX - drag.x; const dy = ev.clientY - drag.y;
				drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
				if (drag.moved > 6)
				{
					settings.yaw = drag.yaw + dx * 0.008;
					if (settings.mode === "third")
						settings.pitch = Math.max(0.25, Math.min(1.45,
							drag.pitch + dy * 0.006));
					s.cam_yaw = settings.yaw;
				}
			}
			hover_at(ev);
		});
		el.addEventListener("pointerup", function(ev) {
			if (!drag) return;
			const d = drag;
			drag = null;
			if (d.moved <= 6)
			{
				const c = cell_at(ev);
				if (c)
					comm.send_message("click_cell", { x: c.x, y: c.y,
						button: d.button === 2 ? 3 : 1 });
			}
			else
			{
				// snap to the nearest 45 degrees so arrows stay intuitive
				settings.yaw = Math.round(settings.yaw / (Math.PI / 4)) * (Math.PI / 4);
				save_settings();
			}
		});
		el.addEventListener("wheel", function(ev) {
			ev.preventDefault();
			settings.dist = Math.max(2.5, Math.min(16, settings.dist * (ev.deltaY > 0 ? 1.1 : 0.9)));
			save_settings();
		}, { passive: false });
		$(el).on("mouseleave", function() { s.hover.visible = false; });
	}

	function cell_at(ev)
	{
		const s = state;
		const r = s.renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1,
			-((ev.clientY - r.top) / r.height) * 2 + 1);
		s.raycaster.setFromCamera(ndc, s.camera);
		const targets = [s.ground];
		if (s.walls) targets.push(s.walls);
		const hit = s.raycaster.intersectObjects(targets, false)[0];
		if (!hit) return null;
		// nudge into the face that was hit
		const p = hit.point.clone();
		if (hit.face) p.addScaledVector(hit.face.normal, -0.01);
		return { x: Math.floor(p.x), y: Math.floor(p.z) };
	}

	function hover_at(ev)
	{
		const c = cell_at(ev);
		const m = state.hover;
		if (!c || !is_known(map_knowledge.get(c.x, c.y))) { m.visible = false; return; }
		m.visible = true;
		m.position.x = c.x + 0.5;
		m.position.z = c.y + 0.5;
		m.position.y = map_knowledge.get(c.x, c.y).__wall3d ? WALL_H + 0.02 : 0.02;
	}

	// ------------------------------------------------------------------
	// Small toolbar overlay

	function build_toolbar()
	{
		$("#three_toolbar").remove();
		const bar = $("<div id='three_toolbar'>" +
            "<button data-act='toggle3d'></button>" +
            "<button data-act='mode'></button>" +
            "<button data-act='rotl' title='Rotate view left'>&#x27F2;</button>" +
            "<button data-act='rotr' title='Rotate view right'>&#x27F3;</button>" +
            "</div>").appendTo(document.body);
		function label()
		{
			bar.find("[data-act=toggle3d]").text(settings.enabled ? "2D view" : "3D view");
			bar.find("[data-act=mode]").text(settings.mode === "first" ? "Third person" : "First person")
				.toggle(settings.enabled);
			bar.find("[data-act=rotl],[data-act=rotr]").toggle(settings.enabled);
		}
		bar.on("click", "button", function(ev) {
			const act = $(this).data("act");
			if (act === "toggle3d") { settings.enabled = !settings.enabled; apply_enabled(); }
			else if (act === "mode")
			{
				settings.mode = settings.mode === "first" ? "third" : "first";
				if (settings.mode === "first") face_open_direction();
			}
			else if (act === "rotl") settings.yaw -= Math.PI / 4;
			else if (act === "rotr") settings.yaw += Math.PI / 4;
			save_settings();
			label();
			this.blur();
		});
		label();
	}

	// Point the first-person camera down the most open direction.
	function face_open_direction()
	{
		let best = -1; let best_dir = 0;
		const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
		for (let i = 0; i < 8; i++)
		{
			let n = 0;
			for (let k = 1; k <= 5; k++)
			{
				const c = map_knowledge.get(player.pos.x + dirs[i][0] * k,
					player.pos.y + dirs[i][1] * k);
				if (!is_known(c) || c.__wall3d) break;
				n++;
			}
			if (n > best) { best = n; best_dir = i; }
		}
		settings.yaw = best_dir * Math.PI / 4;
		if (state) state.cam_yaw = settings.yaw;
	}

	function apply_enabled()
	{
		if (!state) return;
		state.container.toggle(settings.enabled);
	}

	$(document).on("game_cleanup.three_view_global", cleanup);

	return {
		init: init,
		update: update,
		clear: clear,
		settings: settings,
		is_active: function() { return !!state; }
	};
});
