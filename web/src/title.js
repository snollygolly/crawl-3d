// title.js -- the start screen: a slow walk down a dark dungeon hallway (three.js, procedural
// textures, nothing downloaded), "Crawl 3D" laid out in stone blocks (inline SVG), and the list of
// saved games to resume. Saves are read straight from the engine's IndexedDB (Emscripten IDBFS at
// /saves) without starting it; their details come from what fakesocket.js records during play.
(function() {
	"use strict";

	const SVG_NS = "http://www.w3.org/2000/svg";
	const META_KEY = "crawl3d_saves";

	function rng(seed)
	{
		let a = seed >>> 0;
		return function() {
			a = a + 0x6D2B79F5 | 0;
			let t = Math.imul(a ^ a >>> 15, 1 | a);
			t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
			return ((t ^ t >>> 14) >>> 0) / 4294967296;
		};
	}

	// ---------------------------------------------------------------- the hallway

	const SEG = 4;
	const WIDTH = 3;
	const HEIGHT = 3.2;
	const SEGMENTS = 8;
	const SPEED = 0.55;

	function canvas(size)
	{
		const c = document.createElement("canvas");
		c.width = c.height = size;
		return c;
	}

	// Stone blocks with mortar. rows: courses per tile; cols: blocks per course.
	function stone_canvas(rows, cols, base, seed, stagger)
	{
		const S = 256;
		const c = canvas(S);
		const g = c.getContext("2d");
		const r = rng(seed);
		g.fillStyle = "#1a1612";
		g.fillRect(0, 0, S, S);
		const h = S / rows;
		const w = S / cols;
		for (let y = 0; y < rows; y++)
		{
			const off = stagger ? (y % 2) * w / 2 : 0;
			for (let x = -1; x < cols; x++)
			{
				const l = base + (r() - 0.5) * 18;
				const hue = 28 + (r() - 0.5) * 14;
				g.fillStyle = `hsl(${hue}, ${8 + r() * 8}%, ${l}%)`;
				const bx = x * w + off + 2;
				const by = y * h + 2;
				g.fillRect(bx, by, w - 4, h - 4);
				// a lighter top edge and darker bottom edge, so blocks read as raised
				g.fillStyle = "rgba(255,240,210,0.10)";
				g.fillRect(bx, by, w - 4, 3);
				g.fillStyle = "rgba(0,0,0,0.25)";
				g.fillRect(bx, by + h - 7, w - 4, 3);
			}
		}
		// grain and chips
		for (let i = 0; i < 2600; i++)
		{
			g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.18)" : "rgba(255,235,200,0.07)";
			const s = 1 + r() * 2.5;
			g.fillRect(r() * S, r() * S, s, s);
		}
		return c;
	}

	function moss_canvas(seed)
	{
		const c = canvas(128);
		const g = c.getContext("2d");
		const r = rng(seed);
		for (let i = 0; i < 70; i++)
		{
			const x = 64 + (r() - 0.5) * 90 * r();
			const y = 64 + (r() - 0.5) * 70 * r();
			const rad = 4 + r() * 14;
			const grd = g.createRadialGradient(x, y, 0, x, y, rad);
			const l = 14 + r() * 16;
			grd.addColorStop(0, `hsla(${85 + r() * 30}, 45%, ${l}%, 0.9)`);
			grd.addColorStop(1, `hsla(${85 + r() * 30}, 45%, ${l}%, 0)`);
			g.fillStyle = grd;
			g.fillRect(0, 0, 128, 128);
		}
		return c;
	}

	function flame_canvas()
	{
		const c = canvas(64);
		const g = c.getContext("2d");
		const grd = g.createRadialGradient(32, 40, 0, 32, 36, 30);
		grd.addColorStop(0, "rgba(255,250,220,1)");
		grd.addColorStop(0.25, "rgba(255,190,90,0.9)");
		grd.addColorStop(0.6, "rgba(220,90,20,0.35)");
		grd.addColorStop(1, "rgba(120,30,0,0)");
		g.fillStyle = grd;
		g.fillRect(0, 0, 64, 64);
		return c;
	}

	function texture(c, rx, ry)
	{
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.repeat.set(rx, ry);
		t.anisotropy = 4;
		return t;
	}

	function Hall(host)
	{
		this.host = host;
		this.frames = 0;
		this.running = false;
	}

	Hall.prototype.start = function()
	{
		if (this.running || !window.THREE) return false;
		let renderer;
		try {
			renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
		} catch (e) {
			return false;
		}
		this.running = true;
		this.disposables = [];
		const self = this;
		const keep = function(x) { self.disposables.push(x); return x; };

		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1) * 0.75);
		renderer.setClearColor(0x050307);
		this.renderer = renderer;
		this.host.appendChild(renderer.domElement);

		const scene = this.scene = new THREE.Scene();
		scene.fog = new THREE.FogExp2(0x050307, 0.16);
		scene.add(new THREE.AmbientLight(0xffe0c0, 0.05));

		const camera = this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 40);
		scene.add(camera);
		// The light comes off the walker: no torch in view, just a warm glow a few steps ahead.
		const lamp = new THREE.PointLight(0xffbf80, 4.2, 9, 1.7);
		lamp.position.set(0.15, -0.35, -0.6);
		camera.add(lamp);
		this.lamp = lamp;
		this.torch_lights = [0, 1].map(function() {
			const l = new THREE.PointLight(0xff9a40, 0, 6, 1.8);
			scene.add(l);
			return l;
		});

		const wall_c = stone_canvas(6, 3, 30, 11, true);
		const floor_c = stone_canvas(3, 3, 24, 23, true);
		const wall_t = keep(texture(wall_c, 2, 1.6));
		const floor_t = keep(texture(floor_c, 1.5, 2));
		const mats = this.mats = {
			wall: keep(new THREE.MeshLambertMaterial({ map: wall_t, bumpMap: wall_t, bumpScale: 3 })),
			floor: keep(new THREE.MeshLambertMaterial({ map: floor_t, bumpMap: floor_t, bumpScale: 3 })),
			ceil: keep(new THREE.MeshLambertMaterial({ map: keep(texture(wall_c, 1.5, 2)), color: 0x6a6460 })),
			metal: keep(new THREE.MeshLambertMaterial({ color: 0x2a2622 })),
			wood: keep(new THREE.MeshLambertMaterial({ color: 0x4a3020 })),
			bone: keep(new THREE.MeshLambertMaterial({ color: 0xcfc4a4 })),
			socket: keep(new THREE.MeshBasicMaterial({ color: 0x0a0806 })),
			rubble: keep(new THREE.MeshLambertMaterial({ color: 0x6a6258 })),
			moss: [1, 2, 3].map(function(s) {
				return keep(new THREE.MeshLambertMaterial({ map: keep(texture(moss_canvas(s * 7), 1, 1)),
					transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
			}),
			flame: keep(new THREE.SpriteMaterial({ map: keep(texture(flame_canvas(), 1, 1)),
				blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
		};
		const geo = this.geo = {
			floor: keep(new THREE.PlaneGeometry(WIDTH, SEG)),
			wall: keep(new THREE.PlaneGeometry(SEG, HEIGHT)),
			bracket: keep(new THREE.BoxGeometry(0.08, 0.08, 0.3)),
			stick: keep(new THREE.CylinderGeometry(0.035, 0.025, 0.4, 6)),
			skull: keep(new THREE.SphereGeometry(0.12, 10, 8)),
			jaw: keep(new THREE.BoxGeometry(0.13, 0.05, 0.1)),
			socket: keep(new THREE.SphereGeometry(0.03, 6, 4)),
			bone: keep(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6)),
			knob: keep(new THREE.SphereGeometry(0.038, 6, 4)),
			rock: keep(new THREE.DodecahedronGeometry(0.12)),
			moss: keep(new THREE.PlaneGeometry(1, 1))
		};

		this.segments = [];
		for (let i = 0; i < SEGMENTS; i++)
			this.segments.push(this.make_segment());
		for (let i = 0; i < SEGMENTS; i++)
			this.place_segment(this.segments[i], i - 1);

		this.reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
		this.resize = function() { self.size(); if (self.reduced) self.render(6); };
		window.addEventListener("resize", this.resize);
		this.size();
		this.t0 = performance.now();
		this.last = 0;
		const loop = function(now) {
			if (!self.running) return;
			self.raf = requestAnimationFrame(loop);
			if (now - self.last < 32) return;
			self.last = now;
			self.render((now - self.t0) / 1000 + 6);
		};
		if (this.reduced) this.render(6);
		else this.raf = requestAnimationFrame(loop);
		return true;
	};

	Hall.prototype.size = function()
	{
		const w = this.host.clientWidth || window.innerWidth;
		const h = this.host.clientHeight || window.innerHeight;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	};

	Hall.prototype.make_segment = function()
	{
		const g = new THREE.Group();
		const m = this.mats;
		const floor = new THREE.Mesh(this.geo.floor, m.floor);
		floor.rotation.x = -Math.PI / 2;
		const ceil = new THREE.Mesh(this.geo.floor, m.ceil);
		ceil.rotation.x = Math.PI / 2;
		ceil.position.y = HEIGHT;
		const left = new THREE.Mesh(this.geo.wall, m.wall);
		left.rotation.y = Math.PI / 2;
		left.position.set(-WIDTH / 2, HEIGHT / 2, 0);
		const right = new THREE.Mesh(this.geo.wall, m.wall);
		right.rotation.y = -Math.PI / 2;
		right.position.set(WIDTH / 2, HEIGHT / 2, 0);
		g.add(floor, ceil, left, right);
		g.props = new THREE.Group();
		g.add(g.props);
		this.scene.add(g);
		return g;
	};

	// Puts segment `seg` at index k (k = 0 is the one the walk starts in) and dresses it with props
	// chosen from k, so a given stretch of hallway always looks the same.
	Hall.prototype.place_segment = function(seg, k)
	{
		const self = this;
		const m = this.mats;
		const geo = this.geo;
		const r = rng(k * 9973 + 17);
		seg.k = k;
		seg.position.z = -(k + 0.5) * SEG;
		seg.props.clear();
		seg.torch = null;
		const add = function(geom, mat, x, y, z) {
			const mesh = new THREE.Mesh(geom, mat);
			mesh.position.set(x, y, z);
			seg.props.add(mesh);
			return mesh;
		};
		const side = function() { return r() < 0.5 ? -1 : 1; };
		const along = function() { return (r() - 0.5) * (SEG - 0.6); };

		if (((k % 3) + 3) % 3 === 1)
		{
			const s = (Math.floor(k / 3) % 2) ? 1 : -1;
			const x = s * (WIDTH / 2 - 0.15);
			const z = along() * 0.5;
			add(geo.bracket, m.metal, x, 1.85, z).rotation.y = Math.PI / 2;
			const stick = add(geo.stick, m.wood, s * (WIDTH / 2 - 0.27), 2.0, z);
			stick.rotation.z = s * 0.35;
			const flame = new THREE.Sprite(m.flame);
			flame.position.set(s * (WIDTH / 2 - 0.34), 2.27, z);
			flame.scale.set(0.32, 0.46, 1);
			seg.props.add(flame);
			seg.torch = flame;
		}
		const moss = Math.floor(r() * 4);
		for (let i = 0; i < moss; i++)
		{
			const mat = m.moss[Math.floor(r() * m.moss.length)];
			const size = 0.6 + r() * 0.9;
			if (r() < 0.6)
			{
				const s = side();
				const p = add(geo.moss, mat, s * (WIDTH / 2 - 0.01), size * 0.35 + r() * 0.3, along());
				p.rotation.y = -s * Math.PI / 2;
				p.scale.set(size, size * 0.7, 1);
			}
			else
			{
				const p = add(geo.moss, mat, side() * (WIDTH / 2 - size * 0.4), 0.01, along());
				p.rotation.x = -Math.PI / 2;
				p.scale.set(size, size, 1);
			}
		}
		if (r() < 0.3)
		{
			// a skull and a couple of long bones, near one wall
			const s = side();
			const x = s * (0.6 + r() * 0.6);
			const z = along();
			const skull = add(geo.skull, m.bone, x, 0.1, z);
			skull.scale.set(1, 0.85, 1.15);
			skull.rotation.y = r() * Math.PI * 2;
			const jaw = new THREE.Mesh(geo.jaw, m.bone);
			jaw.position.set(0, -0.07, 0.06);
			skull.add(jaw);
			[-1, 1].forEach(function(e) {
				const sock = new THREE.Mesh(geo.socket, m.socket);
				sock.position.set(e * 0.045, 0.02, 0.1);
				skull.add(sock);
			});
			for (let i = 0; i < 2; i++)
				self.add_bone(seg, x + (r() - 0.5) * 0.5, z + (r() - 0.5) * 0.6, r() * Math.PI);
		}
		else if (r() < 0.3)
			this.add_bone(seg, side() * (0.3 + r() * 0.9), along(), r() * Math.PI);
		const rocks = r() < 0.45 ? 1 + Math.floor(r() * 3) : 0;
		for (let i = 0; i < rocks; i++)
		{
			const rock = add(geo.rock, m.rubble, side() * (WIDTH / 2 - 0.15 - r() * 0.3), 0.05, along());
			const s = 0.6 + r() * 0.9;
			rock.scale.set(s, s * 0.6, s);
			rock.rotation.set(r() * 3, r() * 3, r() * 3);
		}
	};

	Hall.prototype.add_bone = function(seg, x, z, yaw)
	{
		const bone = new THREE.Group();
		const shaft = new THREE.Mesh(this.geo.bone, this.mats.bone);
		shaft.rotation.z = Math.PI / 2;
		bone.add(shaft);
		[-1, 1].forEach(function(e) {
			const knob = new THREE.Mesh(this.geo.knob, this.mats.bone);
			knob.position.x = e * 0.21;
			bone.add(knob);
		}, this);
		bone.position.set(x, 0.03, z);
		bone.rotation.y = yaw;
		seg.props.add(bone);
	};

	Hall.prototype.render = function(t)
	{
		const cam = this.camera;
		const z = -t * SPEED;
		cam.position.set(Math.sin(t * 0.37) * 0.12, 1.55 + Math.sin(t * 2.3) * 0.025, z);
		cam.rotation.set(-0.04 + Math.sin(t * 2.3 + 1) * 0.006, Math.sin(t * 0.21) * 0.07, Math.sin(t * 1.15) * 0.006);
		this.lamp.intensity = 4.2 + Math.sin(t * 7.3) * 0.12 + Math.sin(t * 13.1) * 0.08;

		// Segments the walker has passed move to the far end.
		let maxk = -Infinity;
		this.segments.forEach(function(s) { maxk = Math.max(maxk, s.k); });
		for (const s of this.segments)
			if (-(s.k + 1) * SEG > z + SEG)
				this.place_segment(s, ++maxk);

		// The two torches nearest ahead (or just behind) get the two torch lights.
		const torches = [];
		for (const s of this.segments)
			if (s.torch && s.position.z + s.torch.position.z < z + 3) torches.push(s);
		torches.sort(function(a, b) { return b.position.z - a.position.z; });
		this.torch_lights.forEach(function(l, i) {
			const s = torches[i];
			if (!s)
			{
				l.intensity = 0;
				return;
			}
			const f = s.torch;
			l.position.set(f.position.x * 0.9, f.position.y, s.position.z + f.position.z);
			const flick = 0.85 + Math.sin(t * 9 + s.k) * 0.08 + Math.sin(t * 23 + s.k * 3) * 0.07;
			l.intensity = 3.2 * flick;
			f.scale.set(0.32 * flick, 0.46 * (0.9 + (flick - 0.85) * 2), 1);
		});
		this.renderer.render(this.scene, cam);
		this.frames++;
	};

	Hall.prototype.stop = function()
	{
		if (!this.running) return;
		this.running = false;
		cancelAnimationFrame(this.raf);
		window.removeEventListener("resize", this.resize);
		this.disposables.forEach(function(d) { d.dispose(); });
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
		this.scene = this.renderer = this.segments = null;
	};

	// ---------------------------------------------------------------- the stone-block title

	// 7x9, strokes two blocks thick so each one is laid as courses of bricks
	const GLYPHS = {
		C: [".######", "#######", "##.....", "##.....", "##.....", "##.....", "##.....", "#######", ".######"],
		R: ["######.", "#######", "##...##", "##...##", "######.", "#####..", "##.###.", "##..###", "##...##"],
		A: ["..###..", ".#####.", "##...##", "##...##", "#######", "#######", "##...##", "##...##", "##...##"],
		W: ["##...##", "##...##", "##...##", "##.#.##", "##.#.##", "##.#.##", "#######", "###.###", "##...##"],
		L: ["##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "#######", "#######"],
		3: ["######.", "#######", ".....##", ".....##", "..####.", ".....##", ".....##", "#######", "######."],
		D: ["######.", "#######", "##...##", "##...##", "##...##", "##...##", "##...##", "#######", "######."]
	};

	function svg(tag, attrs, parent)
	{
		const el = document.createElementNS(SVG_NS, tag);
		for (const k in attrs) el.setAttribute(k, attrs[k]);
		if (parent) parent.appendChild(el);
		return el;
	}

	// The bevel on the stones: shaded by a light from the upper left, a warm glint on their edges,
	// and stone grain.
	const BEVEL = [
		["feTurbulence", { type: "fractalNoise", baseFrequency: "0.85", numOctaves: "3", seed: "4", result: "noise" }],
		["feColorMatrix", { in: "noise", type: "matrix", result: "grain",
			values: "0.5 0 0 0 0.62  0.5 0 0 0 0.62  0.5 0 0 0 0.62  0 0 0 0 1" }],
		["feBlend", { in: "SourceGraphic", in2: "grain", mode: "multiply", result: "tex" }],
		["feGaussianBlur", { in: "SourceAlpha", stdDeviation: "1.6", result: "blur" }],
		["feDiffuseLighting", { in: "blur", surfaceScale: "3", diffuseConstant: "1.3", "lighting-color": "#fff", result: "shade" },
			["feDistantLight", { azimuth: "225", elevation: "50" }]],
		["feBlend", { in: "tex", in2: "shade", mode: "multiply", result: "lit" }],
		["feSpecularLighting", { in: "blur", surfaceScale: "3", specularConstant: "0.7", specularExponent: "14",
			"lighting-color": "#ffd9a0", result: "spec" }, ["feDistantLight", { azimuth: "225", elevation: "38" }]],
		["feComposite", { in: "lit", in2: "spec", operator: "arithmetic", k2: "1", k3: "0.5", result: "stone" }],
		["feComposite", { in: "stone", in2: "SourceAlpha", operator: "in" }]
	];
	// Under the stones: dark mortar, its edge caught by the light, and a shadow on the hall behind.
	const MORTAR = [
		["feGaussianBlur", { in: "SourceAlpha", stdDeviation: "5", result: "sblur" }],
		["feOffset", { in: "sblur", dx: "0", dy: "6", result: "soff" }],
		["feFlood", { "flood-color": "#000", "flood-opacity": "0.9" }],
		["feComposite", { in2: "soff", operator: "in", result: "shadow" }],
		["feMorphology", { in: "SourceAlpha", operator: "dilate", radius: "1.5", result: "fat" }],
		["feFlood", { "flood-color": "#8a6a3a", "flood-opacity": "0.55" }],
		["feComposite", { in2: "fat", operator: "in", result: "rim" }],
		["feMerge", {}, ["feMergeNode", { in: "shadow" }], ["feMergeNode", { in: "rim" }],
			["feMergeNode", { in: "SourceGraphic" }]]
	];

	function svg_filter(defs, id, steps, W, H)
	{
		const f = svg("filter", { id, filterUnits: "userSpaceOnUse", x: "-20", y: "-20",
			width: String(W + 40), height: String(H + 40), "color-interpolation-filters": "sRGB" }, defs);
		steps.forEach(function(p) {
			const e = svg(p[0], p[1], f);
			for (let i = 2; i < p.length; i++) svg(p[i][0], p[i][1], e);
		});
	}

	// Splits a glyph's filled cells into stones: big pavers (2x2, 3x2, 2x3 cells) wherever they fit,
	// smaller ones to fill the corners, so the letters read as laid stone.
	const PAVERS = [[3, 2], [2, 2], [2, 3]];
	const FILLERS = [[2, 1], [1, 2], [1, 1]];
	function glyph_stones(rows, r)
	{
		const used = rows.map(function(row) { return row.split("").map(function(c) { return c !== "#"; }); });
		const fits = function(x, y, w, h) {
			for (let j = 0; j < h; j++)
				for (let i = 0; i < w; i++)
					if (y + j >= rows.length || x + i >= rows[0].length || used[y + j][x + i]) return false;
			return true;
		};
		const stones = [];
		for (let y = 0; y < rows.length; y++)
			for (let x = 0; x < rows[0].length; x++)
			{
				if (used[y][x]) continue;
				const big = PAVERS.slice().sort(function() { return r() - 0.5; });
				const size = big.concat(FILLERS).find(function(sz) { return fits(x, y, sz[0], sz[1]); });
				for (let j = 0; j < size[1]; j++)
					for (let i = 0; i < size[0]; i++) used[y + j][x + i] = true;
				stones.push({ x, y, w: size[0], h: size[1] });
			}
		return stones;
	}

	function build_title(host)
	{
		const CELL = 14;
		const words = ["CRAWL", "3D"];
		let cols = 0;
		const layout = [];
		words.forEach(function(w, wi) {
			if (wi) cols += 2;
			for (let i = 0; i < w.length; i++)
			{
				if (i) cols += 1;
				layout.push({ ch: w[i], col: cols });
				cols += 7;
			}
		});
		const pad = 12;
		const W = cols * CELL + pad * 2;
		const H = 9 * CELL + pad * 2 + 8;
		const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Crawl 3D" });
		const defs = svg("defs", {}, root);
		svg_filter(defs, "crawl3d_bevel", BEVEL, W, H);
		svg_filter(defs, "crawl3d_mortar", MORTAR, W, H);

		const mortar = svg("g", { filter: "url(#crawl3d_mortar)", fill: "#17120e" }, root);
		const stones = svg("g", { filter: "url(#crawl3d_bevel)" }, root);
		const r = rng(1234);
		layout.forEach(function(l) {
			const rows = GLYPHS[l.ch];
			rows.forEach(function(row, y) {
				for (let x = 0; x < row.length; x++)
					if (row[x] === "#")
						svg("rect", { x: pad + (l.col + x) * CELL - 1.5, y: pad + y * CELL - 1.5,
							width: CELL + 3, height: CELL + 3 }, mortar);
			});
			glyph_stones(rows, r).forEach(function(st) {
				const light = 52 + (r() - 0.5) * 16 - st.y;
				// now and then a stone with moss creeping over it, low on the letters
				const mossy = st.y > 4 && r() < 0.14;
				const fill = mossy ? `hsl(${78 + r() * 25}, 24%, ${light - 14}%)`
					: `hsl(${30 + (r() - 0.5) * 14}, ${14 + r() * 10}%, ${light}%)`;
				const gap = 1.1;
				svg("rect", { x: (pad + (l.col + st.x) * CELL + gap + (r() - 0.5) * 0.8).toFixed(1),
					y: (pad + st.y * CELL + gap + (r() - 0.5) * 0.8).toFixed(1),
					width: (st.w * CELL - gap * 2 + (r() - 0.5) * 0.8).toFixed(1),
					height: (st.h * CELL - gap * 2 + (r() - 0.5) * 0.8).toFixed(1),
					rx: (2 + r() * 3).toFixed(1), fill }, stones);
			});
		});
		host.appendChild(root);
	}

	// ---------------------------------------------------------------- saved games

	function read_meta()
	{
		try { return JSON.parse(localStorage.getItem(META_KEY) || "{}") || {}; } catch (e) { return {}; }
	}

	function write_meta(all)
	{
		try { localStorage.setItem(META_KEY, JSON.stringify(all)); } catch (e) {}
	}

	// Calls cb([{ name, saved }]) with the .cs files in the engine's IndexedDB, newest first, without
	// loading their contents. Never creates the database (Emscripten does that, at its own version).
	function list_save_files(cb)
	{
		let done = false;
		let ok = false;
		const finish = function(list) {
			if (done) return;
			done = true;
			list.sort(function(a, b) { return b.saved - a.saved; });
			cb(list, ok);
		};
		let req;
		try { req = window.indexedDB.open("/saves"); } catch (e) { return finish([]); }
		let fresh = false;
		req.onupgradeneeded = function() { fresh = true; req.transaction.abort(); };
		// A fresh browser: there are no saves, and that's a successful read.
		req.onerror = function(ev) { ev.preventDefault(); ok = fresh; finish([]); };
		req.onblocked = function() { finish([]); };
		req.onsuccess = function() {
			const db = req.result;
			const list = [];
			const seen = function(path, ts) {
				const m = /^\/saves\/(?:.*\/)?([^/]+)\.cs$/.exec(String(path));
				if (m) list.push({ name: m[1], saved: ts instanceof Date ? ts.getTime() : Number(ts) || 0 });
			};
			try {
				const store = db.transaction("FILE_DATA", "readonly").objectStore("FILE_DATA");
				let cur;
				if (store.indexNames.contains("timestamp"))
				{
					cur = store.index("timestamp").openKeyCursor();
					cur.onsuccess = function() {
						const c = cur.result;
						if (!c) { db.close(); ok = true; return finish(list); }
						seen(c.primaryKey, c.key);
						c.continue();
					};
				}
				else
				{
					cur = store.openCursor();
					cur.onsuccess = function() {
						const c = cur.result;
						if (!c) { db.close(); ok = true; return finish(list); }
						seen(c.key, c.value && c.value.timestamp);
						c.continue();
					};
				}
				cur.onerror = function() { db.close(); finish(list); };
			} catch (e) {
				db.close();
				finish([]);
			}
		};
	}

	function ago(ms)
	{
		const s = Math.max(0, (Date.now() - ms) / 1000);
		const unit = function(n, w) { n = Math.floor(n); return `${n} ${w}${n === 1 ? "" : "s"} ago`; };
		if (s < 60) return "just now";
		if (s < 3600) return unit(s / 60, "minute");
		if (s < 86400) return unit(s / 3600, "hour");
		if (s < 86400 * 60) return unit(s / 86400, "day");
		return new Date(ms).toLocaleDateString();
	}

	function playtime(ms)
	{
		const m = Math.round(ms / 60000);
		if (m < 1) return "under a minute";
		if (m < 60) return `${m}m`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	}

	function el(tag, cls, text, parent)
	{
		const e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		if (parent) parent.appendChild(e);
		return e;
	}

	function render_saves(box, files, meta, on_pick)
	{
		box.textContent = "";
		box.hidden = !files.length;
		if (!files.length) return;
		el("h2", null, files.length === 1 ? "Continue your game" : "Continue a game", box);
		files.forEach(function(f) {
			const d = meta[f.name];
			const card = el("button", "crawl3d_save", null, box);
			card.type = "button";
			card.dataset.name = f.name;
			const head = el("span", "save_head", null, card);
			el("span", "save_name", f.name, head);
			el("span", "save_go", "Resume", head);
			if (d && d.species)
				el("span", "save_who", [d.species, d.title].filter(Boolean).join(", ") +
					(d.god ? ` of ${d.god}` : ""), card);
			const stats = el("span", "save_stats", null, card);
			if (d && d.xl)
			{
				el("span", "save_xl", `XL ${d.xl}`, stats);
				// as the stock stats panel shows it
				if (d.place) el("span", "save_place", d.depth ? `${d.place}:${d.depth}` : d.place, stats);
				if (d.turn) el("span", "save_turn", `turn ${Number(d.turn).toLocaleString()}`, stats);
			}
			else el("span", "save_unknown", "details appear after you next play it", stats);
			const when = el("span", "save_when", null, card);
			if (d && d.played_ms) el("span", "save_played", `played ${playtime(d.played_ms)}`, when);
			el("span", "save_age", `last played ${ago(Math.max(f.saved, (d && d.updated) || 0))}`, when);
			card.addEventListener("click", function() { on_pick(f.name); });
		});
	}

	// ---------------------------------------------------------------- the screen

	const title = window.crawl3d_title = { hall: null, saves: [] };
	Object.defineProperty(title, "frames", { get: function() { return title.hall ? title.hall.frames : 0; } });

	function $(id) { return document.getElementById(id); }

	window.crawl3d_status = function(text) {
		const s = $("crawl3d_status");
		if (s) s.textContent = text || "";
	};
	window.crawl3d_hide_start = function() {
		$("crawl3d_start").style.display = "none";
		if (title.hall) title.hall.stop();
	};
	window.crawl3d_game_over = function(info) {
		const box = $("crawl3d_start");
		box.style.display = "flex";
		const reasons = { saved: "Game saved.", dead: "You died.", crash: `The game crashed: ${info.message}` };
		const why = reasons[info.reason] || `The game ended${info.message ? `: ${info.message}` : "."}`;
		const body = box.querySelector(".start_body");
		body.textContent = "";
		el("p", "sub over", why, body);
		const again = el("button", "start_again", info.reason === "saved" ? "Back to the title" : "Play again", body);
		again.id = "crawl3d_again";
		again.addEventListener("click", function() { location.reload(); });
		if (title.hall) title.hall.start();
	};

	let starting = false;
	title.start_game = function(name) {
		if (starting) return;
		starting = true;
		try { localStorage.setItem("crawl3d_name", name); } catch (e) {}
		$("crawl3d_start").classList.add("starting");
		$("crawl3d_play").disabled = true;
		$("crawl3d_name").disabled = true;
		document.querySelectorAll(".crawl3d_save").forEach(function(b) { b.disabled = true; });
		window.crawl3d_status("Starting the engine...");
		function go()
		{
			// ?seed=123 in the URL starts a game with a fixed dungeon seed
			const m = /[?&]seed=(\d+)/.exec(location.search);
			const args = m ? ["-seed", m[1]] : [];
			if (!window.crawl3d_start || !window.crawl3d_start(name, args)) setTimeout(go, 100);
		}
		// On a first visit, wait (briefly) for sw.js to take control of the page, so the engine
		// download goes through it and is cached for next time.
		const sw = navigator.serviceWorker;
		if (!sw || sw.controller) return go();
		let started = false;
		function once() { if (!started) { started = true; go(); } }
		setTimeout(once, 3000);
		sw.addEventListener("controllerchange", once);
		sw.ready.then(function() { if (sw.controller) once(); });
	};

	function clean(name)
	{
		return name.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
	}

	function init()
	{
		const hall_host = $("crawl3d_hall");
		if (hall_host)
		{
			title.hall = new Hall(hall_host);
			if (!title.hall.start()) title.hall = null;
		}
		const title_host = $("crawl3d_title");
		if (title_host) build_title(title_host);

		const input = $("crawl3d_name");
		const play = $("crawl3d_play");
		const hint = $("crawl3d_hint");
		let stored = "";
		try { stored = localStorage.getItem("crawl3d_name") || ""; } catch (e) {}
		input.value = stored || "Adventurer";
		const update = function() {
			const resume = title.saves.indexOf(clean(input.value)) !== -1;
			play.textContent = resume ? "Resume" : "Play";
			hint.textContent = resume ? "That character has a saved game; this continues it." : "";
		};
		let typed = false;
		input.addEventListener("input", function() { typed = true; update(); });
		$("crawl3d_form").addEventListener("submit", function(ev) {
			ev.preventDefault();
			title.start_game(clean(input.value) || "Adventurer");
		});

		list_save_files(function(files, ok) {
			const meta = read_meta();
			// Crawl deletes a dead character's save; forget the details of saves that are gone.
			const names = files.map(function(f) { return f.name; });
			let pruned = false;
			for (const n in meta)
				if (names.indexOf(n) === -1) { delete meta[n]; pruned = true; }
			if (pruned && ok) write_meta(meta);
			title.saves = names;
			render_saves($("crawl3d_saves"), files, meta, title.start_game);
			update();
			// With a save, Enter resumes the newest one; otherwise it's ready to name a character.
			const first = document.querySelector(".crawl3d_save");
			if (first && !typed) first.focus();
			title.ready = true;
		});
		input.focus();
		input.select();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();
}());
