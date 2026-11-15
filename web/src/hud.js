// hud.js -- the panel HUD drawn over the full-window 3D view.
//
// It renders from the stock client's state (the player module) and never
// talks to the engine itself. web/overrides/gamedata/player.js triggers
// "crawl3d_player" after each player update; three_view.js turns the HUD on
// and off with the 3D view (2D mode keeps the classic WebTiles layout) and
// hands it the player's tile for the portrait.
//
// It also draws its own minimap and "In view" monster list from
// map_knowledge; three_view calls refresh() once per frame after map changes.
// Hotbar slots and minimap buttons just send the game's own keys.
//
// The stock message pane is not replaced: in HUD mode crawl3d.css moves it
// into a panel, so --more--, prompts and text input keep working unchanged.
define(["jquery", "comm", "./player", "./map_knowledge",
	"./options", "./util", "./enums"],
function($, comm, player, map_knowledge, options, util, enums) {
	"use strict";

	// player.place is the branch's short name; show the long one, in the
	// branch's colour.
	const BRANCHES = {
		Dungeon: ["The Dungeon", "#d9b36c"],
		Temple: ["Ecumenical Temple", "#f3e3a0"],
		Orc: ["Orcish Mines", "#c98a4b"],
		Elf: ["Elven Halls", "#9fd6ff"],
		Lair: ["Lair of Beasts", "#8fd36b"],
		Swamp: ["The Swamp", "#7fa860"],
		Shoals: ["The Shoals", "#6fc7d6"],
		Snake: ["Snake Pit", "#b8d86b"],
		Spider: ["Spider Nest", "#c48bd8"],
		Slime: ["Slime Pits", "#9be36b"],
		Vaults: ["The Vaults", "#c0c6d0"],
		Crypt: ["The Crypt", "#b0a4c8"],
		Tomb: ["Tomb of the Ancients", "#e0c27a"],
		Depths: ["The Depths", "#a88fd8"],
		Zot: ["Realm of Zot", "#ff6be0"],
		Hell: ["Vestibule of Hell", "#ff6b4a"],
		Dis: ["Iron City of Dis", "#a8b4c4"],
		Gehenna: ["Gehenna", "#ff7a3a"],
		Geh: ["Gehenna", "#ff7a3a"],
		Cocytus: ["Cocytus", "#9fe0ff"],
		Coc: ["Cocytus", "#9fe0ff"],
		Tartarus: ["Tartarus", "#9a8fb8"],
		Tar: ["Tartarus", "#9a8fb8"],
		Abyss: ["The Abyss", "#d86bff"],
		Pan: ["Pandemonium", "#ff5c8a"],
		Pandemonium: ["Pandemonium", "#ff5c8a"],
		Zig: ["Ziggurat", "#ffd36b"],
		Ziggurat: ["Ziggurat", "#ffd36b"],
		Bazaar: ["Bazaar", "#ffd36b"],
		Trove: ["Treasure Trove", "#ffd36b"],
		Sewer: ["The Sewers", "#8fae7a"],
		Ossuary: ["The Ossuary", "#d8cfae"],
		Bailey: ["The Bailey", "#c9a46b"],
		IceCv: ["Ice Cave", "#bfe8ff"],
		"Ice Cave": ["Ice Cave", "#bfe8ff"],
		Volcano: ["The Volcano", "#ff8a4a"],
		WizLab: ["Wizard's Laboratory", "#b48bff"],
		Wizlab: ["Wizard's Laboratory", "#b48bff"],
		Desolation: ["Desolation of Salt", "#e8e2d4"],
		Gauntlet: ["The Gauntlet", "#c9a46b"],
		Arena: ["The Arena", "#c9a46b"]
	};

	const NOISE = [
		[333, "quiet", "quiet"],
		[666, "loud", "loud"],
		[999, "veryloud", "very loud"],
		[Infinity, "superloud", "deafening"]
	];

	// Hotbar: [group, [[id, key, label, icon, help, key caption]]]
	const SLOTS = [
		["Magic", [
			["cast", "z", "Cast", "\u2726", "Cast a spell"],
			["learn", "M", "Learn", "\u270E", "Memorise a spell from your library"]
		]],
		["Combat", [
			["fight", "\t", "Fight", "\u2694", "Attack the nearest monster, or move toward it", "Tab"],
			["fire", "f", "Fire", "\u27B9", "Fire or throw your quivered item"]
		]],
		["Actions", [
			["explore", "o", "Explore", "\u2316", "Explore the level automatically until something interesting happens"],
			["rest", "5", "Rest", "\u263E", "Rest until healed, or until something appears"],
			["pickup", "g", "Pick up", "\u270B", "Pick up items here"],
			["abilities", "a", "Abilities", "\u2605", "Use an ability (species, god or item)"]
		]],
		["Items", [
			["quaff", "q", "Quaff", "\u2697", "Drink a potion"],
			["read", "r", "Read", "\u00B6", "Read a scroll"],
			["inventory", "i", "Inventory", "\u25A3", "Look at what you carry"]
		]]
	];

	const COACH_TIPS = [
		"New to Crawl? Hover anything for info \u00B7 <span class='hud-key'>?</span> lists every command",
		"<span class='hud-key'>o</span> auto-explores the level, and stops when something needs you",
		"<span class='hud-key'>Tab</span> attacks the nearest monster \u00B7 <span class='hud-key'>5</span> rests until healed",
		"Click a square to travel there \u00B7 right-click anything to describe it",
		"<span class='hud-key'>&gt;</span> on stairs goes down \u00B7 <span class='hud-key'>G</span> travels to any level you've seen",
		"Drag to turn the camera, scroll to zoom, arrow keys move relative to the view"
	];
	const COACH_KEY = "crawl3d_coach_dismissed";

	const THREAT = ["trivial", "easy", "tough", "nasty"];
	const ATTITUDE = ["hostile", "neutral", "peaceful", "peaceful", "ally"];
	const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

	const TEMPLATE = `
<div id="hud_root">
  <div class="hud-panel" id="hud_char">
    <div class="hud-top">
      <div class="hud-port"><canvas id="hud_portrait" width="56" height="56"></canvas><div class="hud-xl" id="hud_xl"></div></div>
      <div class="hud-who">
        <div class="hud-name" id="hud_name"></div>
        <div class="hud-sub" id="hud_sub"></div>
        <div class="hud-xpbar"><div id="hud_xp_fill"></div></div>
        <div class="hud-xptext" id="hud_xp_text"></div>
      </div>
    </div>
    <div class="hud-bar" id="hud_hp"><div class="ghost"></div><div class="poison"></div><div class="fill"></div><span><b>&#x2665; HP</b><b class="num"></b></span></div>
    <div class="hud-bar" id="hud_mp"><div class="ghost"></div><div class="fill"></div><span><b>&#x2726; MP</b><b class="num"></b></span></div>
    <div class="hud-chips" id="hud_defs"></div>
    <div class="hud-chips" id="hud_gear"></div>
    <div class="hud-status" id="hud_status"></div>
  </div>
  <div class="hud-panel" id="hud_loc">
    <div class="hud-place" id="hud_place"></div>
    <div class="hud-time" id="hud_time"></div>
  </div>
  <div class="hud-panel" id="hud_coach"><span id="hud_coach_text"></span><button id="hud_coach_close" title="Hide tips">&#x2715;</button></div>
  <div id="hud_right">
    <div class="hud-panel" id="hud_map">
      <div class="hud-head"><span class="hud-title" id="hud_map_title"></span><span class="dim">click to travel</span></div>
      <canvas id="hud_map_canvas"></canvas>
      <div class="hud-legend">
        <span><i style="background:#fff"></i>you</span><span><i style="background:#4fd1ff"></i>stairs</span><span><i style="background:#e5c14a"></i>items</span><span><i style="background:#ff5c5c"></i>monsters</span><span><i style="background:#a8553a"></i>unexplored</span>
      </div>
      <div class="hud-btnrow">
        <button data-key="o" id="hud_map_explore" title="Explore automatically"><span class="hud-key">o</span> Explore</button>
        <button data-key="X" id="hud_map_full" title="Full level map"><span class="hud-key">X</span> Map</button>
        <button data-key="G" id="hud_map_travel" title="Travel to another level"><span class="hud-key">G</span> Travel</button>
      </div>
    </div>
    <div class="hud-panel" id="hud_mons">
      <div class="hud-head"><span class="hud-title">In view</span><span class="dim">click to describe</span></div>
      <div id="hud_mons_list"></div>
    </div>
  </div>
  <div class="hud-panel" id="hud_bar"></div>
</div>`;

	let root = null;
	let active = false;
	let last_place = null;
	let last = { hp: null, mp: null };
	let portrait = null;
	let hooks = { can_act: () => true, icon_for: () => null };
	let map_xf = null;
	let coach_timer = null;
	let hostiles = 0;

	// opts.can_act(): false while a menu or prompt has the keyboard.
	// opts.icon_for(mon_id): the monster's sprite canvas, if three_view has one.
	function init(opts)
	{
		cleanup();
		hooks = $.extend(hooks, opts || {});
		root = $(TEMPLATE.trim()).appendTo("#game");
		build_hotbar();
		bind_map();
		start_coach();
		$("#message_pane").prepend("<div id='hud_log_head'><span>Messages</span>"
			+ "<span><span class='hud-key'>Ctrl-P</span> history</span></div>");
		last_place = null;
		last = { hp: null, mp: null };
		$(document).on("crawl3d_player.hud", render);
		if (portrait) set_portrait(portrait);
		render();
	}

	function cleanup()
	{
		if (!root) return;
		$(document).off(".hud");
		clearInterval(coach_timer);
		root.remove();
		$("#hud_log_head").remove();
		root = null;
		set_active(false);
	}

	// On while the 3D view is showing the game. Toggling the body class is
	// what moves the stock message pane and hides the stock sidebar.
	function set_active(on)
	{
		on = !!on;
		if (on === active) return;
		active = on;
		$(document.body).toggleClass("crawl3d-hud", on);
		if (on)
		{
			render();
			refresh();
		}
	}

	function send_key(key)
	{
		if (!hooks.can_act()) return false;
		comm.send_message("key", { keycode: key.charCodeAt(0) });
		return true;
	}

	// img: a canvas holding the player's sprite as three_view draws it
	// (TS + 16 wide, 2 * TS tall, the tile's own square at (8, TS)).
	function set_portrait(img)
	{
		portrait = img;
		draw_tile(document.getElementById("hud_portrait"), img);
	}

	function draw_tile(c, img)
	{
		if (!c || !img) return;
		const ctx = c.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, c.width, c.height);
		const ts = img.height / 2;
		// a little headroom above the tile for tall dolls
		const src = ts * 1.25;
		ctx.drawImage(img, (img.width - src) / 2, img.height - src, src, src,
			0, 0, c.width, c.height);
	}

	function pct(v, max)
	{
		if (!max || max <= 0) return 0;
		return Math.max(0, Math.min(100, (100 * v) / max));
	}

	// HP/MP bar. The ghost segment trails behind the fill when the value
	// drops (crawl3d.css delays its transition) and snaps up when it rises.
	function set_bar(el, key, val, max, label, poison)
	{
		const p = pct(val, max);
		el.toggleClass("rising", last[key] === null || p >= last[key]);
		last[key] = p;
		el.find(".ghost").css("width", `${p}%`);
		const under = poison !== undefined && poison < val ? pct(poison, max) : p;
		el.find(".fill").css("width", `${under}%`);
		el.find(".poison").css("width", `${p}%`);
		el.find(".num").text(label);
	}

	function chip(text, cls, title)
	{
		const c = $("<span class='hud-chip'>").text(text);
		if (cls) c.addClass(cls);
		if (title) c.attr("title", title);
		return c;
	}

	function plain(formatted)
	{
		return $("<div>").html(util.formatted_string_to_html(formatted || "")).text();
	}

	function render()
	{
		if (!root || !active || !player.name) return;
		render_card();
		render_location();
		render_hotbar();
	}

	// Map-driven panels; three_view calls this after map updates.
	function refresh()
	{
		if (!root || !active || !player.name) return;
		draw_map();
		render_monsters();
		render_hotbar();
	}

	function render_card()
	{
		$("#hud_name").text(player.name);
		let sub = player.species;
		if (player.god)
		{
			sub += ` · ${player.god}`;
			if (player.god !== "Gozag" && player.piety_rank >= 0)
				sub += ` ${"*".repeat(player.piety_rank)}`;
			if (player.penance) sub += " (penance)";
		}
		else
			sub += " · no god";
		$("#hud_sub").text(sub).attr("title", `${player.name} ${player.title}`.trim());

		$("#hud_xl").text(`XL ${player.xl}`);
		$("#hud_xp_fill").css("width", `${pct(player.progress, 100)}%`);
		$("#hud_xp_text").text(player.xl >= 27 ? "maximum level"
			: `${player.progress}% to XL ${player.xl + 1}`);

		const hp = $("#hud_hp");
		let hp_label = `${Math.max(0, player.hp)} / ${player.hp_max}`;
		if (player.real_hp_max !== player.hp_max) hp_label += ` (${player.real_hp_max})`;
		set_bar(hp, "hp", player.hp, player.hp_max, hp_label, player.poison_survival);
		hp.toggleClass("low", player.hp_max > 0 && player.hp / player.hp_max <= 0.3);
		hp.toggleClass("poisoned", player.poison_survival < player.hp);

		const mp = $("#hud_mp");
		mp.toggle(player.species !== "Djinni");
		set_bar(mp, "mp", player.mp, player.mp_max, `${player.mp} / ${player.mp_max}`);

		const defs = $("#hud_defs").empty();
		defs.append(chip(`AC ${player.ac}`, null, "Armour class: reduces damage taken"),
			chip(`EV ${player.ev}`, null, "Evasion: chance to dodge attacks"),
			chip(`SH ${player.sh}`, null, "Shield: chance to block attacks"));
		const stats = [["Str", player.str, player.str_max], ["Int", player.int, player.int_max],
			["Dex", player.dex, player.dex_max]];
		const best = Math.max(player.str, player.int, player.dex);
		for (const [name, v, max] of stats)
		{
			const drained = max && v < max;
			let cls = v === best ? "best" : "dim";
			if (drained) cls = "drained";
			defs.append(chip(drained ? `${name} ${v} (${max})` : `${name} ${v}`, cls,
				drained ? `${name} drained from ${max}` : null));
		}

		const gear = $("#hud_gear").empty();
		gear.append(weapon_chip(player.weapon_index, false));
		if (player.offhand_weapon) gear.append(weapon_chip(player.offhand_index, true));
		if (player.quiver_desc)
		{
			const q = plain(player.quiver_desc);
			if (q && !/^nothing/i.test(q))
				gear.append($("<span class='hud-chip hud-quiver'>").attr("title", `Fire (f): ${q}`)
					.append("<span class='dim'>f </span>")
					.append(util.formatted_string_to_html(player.quiver_desc)));
		}

		const st = $("#hud_status").empty();
		for (const s of player.status || [])
		{
			if (!s.light) continue;
			st.append($("<span class='hud-light'>").addClass(`fg${s.col}`)
				.text(s.light).attr("title", plain(s.desc) || s.text || s.light));
		}
		st.append(noise_pill());
	}

	function weapon_chip(index, offhand)
	{
		const c = $("<span class='hud-chip hud-weapon'>");
		if (index === -1 || index === undefined)
			c.text(player.unarmed_attack || "unarmed").addClass(`fg${player.unarmed_attack_colour}`);
		else
			c.append(player.inventory_item_desc(index));
		c.attr("title", offhand ? "Off-hand weapon" : "Wielded (w to change)");
		return c;
	}

	function noise_pill()
	{
		const pill = $("<span class='hud-noise'>");
		if (player.has_status("silence"))
			return pill.attr("data-level", "blank").text("Silenced");
		const n = Math.max(0, player.adjusted_noise || 0);
		const [, level, word] = NOISE.find(e => n <= e[0]);
		return pill.attr("data-level", level).text(`Noise: ${word}`)
			.attr("title", "How far your last action could be heard");
	}

	function render_location()
	{
		const b = BRANCHES[player.place] || [player.place, "#d9b36c"];
		let text = b[0];
		if (player.depth) text += ` · Level ${player.depth}`;
		const place = $("#hud_place").text(text).css("color", b[1]);
		const key = `${player.place}:${player.depth}`;
		if (last_place !== null && key !== last_place)
		{
			// restart the flash animation
			const loc = $("#hud_loc").removeClass("flash");
			void loc[0].offsetWidth;
			loc.addClass("flash");
		}
		last_place = key;
		place.attr("title", `${player.place}${player.depth ? `:${player.depth}` : ""}`);

		let time = options.get("show_game_time") === true
			? `Time ${(player.time / 10).toFixed(1)}` : `Turn ${player.turn}`;
		if (player.time_delta) time += ` · last action ${(player.time_delta / 10).toFixed(1)}`;
		$("#hud_time").text(time);
	}

	// ------------------------------------------------------------------
	// 3: minimap

	function map_colour(mf)
	{
		const E = enums;
		switch (mf)
		{
		case E.MF_FLOOR: return "#666";
		case E.MF_MAP_FLOOR: return "#3c3c3c";
		case E.MF_WALL: return "#2c2822";
		case E.MF_MAP_WALL: return "#1f1c18";
		case E.MF_DOOR: return "#a8553a";
		case E.MF_ITEM: return "#e5c14a";
		case E.MF_MONS_FRIENDLY: return "#6bdc7a";
		case E.MF_MONS_PEACEFUL:
		case E.MF_MONS_NEUTRAL: return "#f2dc6b";
		case E.MF_MONS_HOSTILE: return "#ff5c5c";
		case E.MF_MONS_NO_EXP: return "#3f6b3f";
		case E.MF_STAIR_UP: return "#2f86a8";
		case E.MF_STAIR_DOWN: return "#4fd1ff";
		case E.MF_STAIR_BRANCH: return "#ff9de0";
		case E.MF_FEATURE: return "#c9a46b";
		case E.MF_WATER: return "#2f5fb8";
		case E.MF_DEEP_WATER: return "#1d3a80";
		case E.MF_LAVA: return "#ff5a1f";
		case E.MF_TRAP: return "#ff9a4a";
		case E.MF_EXCL_ROOT: return "#b04040";
		case E.MF_EXCL: return "#5a2a2a";
		case E.MF_PORTAL: return "#d86bff";
		// after MF_PORTAL the engine has transporter, landing, explore horizon
		case E.MF_PORTAL + 1:
		case E.MF_PORTAL + 2: return "#d86bff";
		case E.MF_PORTAL + 3: return "#a8553a";
		default: return null;
		}
	}

	function draw_map()
	{
		const c = document.getElementById("hud_map_canvas");
		const b = map_knowledge.bounds();
		if (!c || !b) return;
		const dpr = window.devicePixelRatio || 1;
		const w = c.clientWidth; const h = c.clientHeight;
		if (!w || !h) return;
		if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr))
		{
			c.width = Math.round(w * dpr);
			c.height = Math.round(h * dpr);
		}
		const ctx = c.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = "#050505";
		ctx.fillRect(0, 0, w, h);
		const cols = b.right - b.left + 1; const rows = b.bottom - b.top + 1;
		const cell = Math.max(1, Math.min(8, Math.floor(Math.min((w - 8) / cols, (h - 8) / rows))));
		const ox = Math.floor((w - cols * cell) / 2); const oy = Math.floor((h - rows * cell) / 2);
		map_xf = { left: b.left, top: b.top, cell: cell, ox: ox, oy: oy };
		for (let y = b.top; y <= b.bottom; y++)
			for (let x = b.left; x <= b.right; x++)
			{
				const col = map_colour(map_knowledge.get(x, y).mf);
				if (!col) continue;
				ctx.fillStyle = col;
				ctx.fillRect(ox + (x - b.left) * cell, oy + (y - b.top) * cell, cell, cell);
			}
		if (map_knowledge.player_on_level())
		{
			const px = ox + (player.pos.x - b.left + 0.5) * cell;
			const py = oy + (player.pos.y - b.top + 0.5) * cell;
			ctx.strokeStyle = "rgba(255, 215, 122, 0.45)";
			ctx.beginPath();
			ctx.arc(px, py, cell * 2.5 + 4, 0, Math.PI * 2);
			ctx.stroke();
			const r = Math.max(2, cell * 0.75);
			ctx.fillStyle = "#fff";
			ctx.fillRect(px - r, py - r, r * 2, r * 2);
		}
		let title = $("#hud_place").text().replace("The Dungeon", "Dungeon");
		if (!title) title = "Map";
		$("#hud_map_title").text(title);
	}

	function bind_map()
	{
		const c = $("#hud_map_canvas");
		c.on("contextmenu", function(ev) { ev.preventDefault(); });
		c.on("mouseup", function(ev) {
			if (!map_xf || !hooks.can_act()) return;
			const r = this.getBoundingClientRect();
			const x = Math.floor((ev.clientX - r.left - map_xf.ox) / map_xf.cell) + map_xf.left;
			const y = Math.floor((ev.clientY - r.top - map_xf.oy) / map_xf.cell) + map_xf.top;
			const cell = map_knowledge.get(x, y);
			if (!cell || !cell.mf) return;
			comm.send_message("click_cell", { x: x, y: y, button: ev.button === 2 ? 3 : 1 });
		});
		// a monster row describes that monster, like right-clicking it
		$("#hud_mons_list").on("click", ".hud-mon", function() {
			const loc = $(this).data("loc");
			if (loc && hooks.can_act())
				comm.send_message("click_cell", { x: loc.x, y: loc.y, button: 3 });
		});
		$("#hud_map .hud-btnrow").on("click", "button", function() {
			send_key($(this).data("key"));
			this.blur();
		});
	}

	// ------------------------------------------------------------------
	// 4: monsters in view

	function mon_state(cell)
	{
		if (!cell.t) return "";
		const fg = cell.t.fg = enums.prepare_fg_flags(cell.t.fg || 0);
		if (fg.PARALYSED) return "paralysed";
		if (fg.FLEEING) return "fleeing";
		if (fg.STAB) return "asleep";
		if (fg.MAY_STAB) return "unaware";
		return "";
	}

	function visible_monsters()
	{
		const out = [];
		const R = 9;
		const px = player.pos.x; const py = player.pos.y;
		for (let y = py - R; y <= py + R; y++)
			for (let x = px - R; x <= px + R; x++)
			{
				if (x === px && y === py) continue;
				const cell = map_knowledge.get(x, y);
				const mon = cell.mon;
				if (!mon || !map_knowledge.visible(cell)) continue;
				if (mon.typedata && mon.typedata.no_exp && mon.att !== 4) continue;
				const dx = x - px; const dy = y - py;
				const dir = Math.round(Math.atan2(dx, -dy) / (Math.PI / 4));
				out.push({ mon: mon, x: x, y: y, cell: cell,
					dist: Math.max(Math.abs(dx), Math.abs(dy)),
					dir: COMPASS[((dir % 8) + 8) % 8],
					state: mon_state(cell) });
			}
		return out;
	}

	function render_monsters()
	{
		const seen = visible_monsters();
		hostiles = seen.filter(m => !m.mon.att).length;
		const groups = new Map();
		for (const m of seen)
		{
			const key = [m.mon.name, m.mon.att, m.mon.threat, m.state].join("|");
			const g = groups.get(key);
			if (!g) groups.set(key, [m]);
			else g.push(m);
		}
		const list = [...groups.values()].map(g => g.sort((a, b) => a.dist - b.dist));
		// most dangerous hostiles first, then the closest
		list.sort((a, b) => {
			const ha = a[0].mon.att ? 1 : 0; const hb = b[0].mon.att ? 1 : 0;
			if (ha !== hb) return ha - hb;
			return (b[0].mon.threat || 0) - (a[0].mon.threat || 0) || a[0].dist - b[0].dist;
		});
		$("#hud_mons").toggle(list.length > 0);
		const box = $("#hud_mons_list").empty();
		const MAX = 6;
		for (const g of list.slice(0, MAX))
		{
			const m = g[0];
			const name = g.length > 1 ? `${m.mon.plural || m.mon.name} \u00D7${g.length}` : m.mon.name;
			const where = [m.state, `${m.dist} ${m.dist === 1 ? "tile" : "tiles"} ${m.dir}`]
				.filter(Boolean).join(" \u00B7 ");
			const row = $("<div class='hud-mon'>").attr("title", `${m.mon.name}: click to describe`)
				.data("loc", { x: m.x, y: m.y });
			const icon = $("<canvas class='hud-mon-icon' width='32' height='32'>");
			draw_tile(icon[0], hooks.icon_for(m.mon.id));
			const tag = m.mon.att
				? $("<span class='hud-threat ally'>").text(ATTITUDE[m.mon.att] || "neutral")
				: $("<span class='hud-threat'>").addClass(THREAT[m.mon.threat] || "easy")
					.text(THREAT[m.mon.threat] || "?");
			row.append(icon, $("<div class='hud-mon-text'>")
				.append($("<div>").text(name), $("<div class='dim'>").text(where)), tag);
			box.append(row);
		}
		if (list.length > MAX)
			box.append($("<div class='hud-mon-more dim'>").text(`+${list.length - MAX} more`));
	}

	// ------------------------------------------------------------------
	// 5: hotbar

	function build_hotbar()
	{
		const bar = $("#hud_bar");
		SLOTS.forEach(function([group, slots], i) {
			if (i) bar.append("<div class='hud-sep'></div>");
			const g = $("<div class='hud-grp'>").append($("<div class='hud-grp-name'>").text(group));
			const row = $("<div class='hud-slots'>");
			for (const [id, key, label, icon, help, cap] of slots)
			{
				const caption = cap || key;
				row.append($("<button class='hud-slot'>").attr({ id: `hud_slot_${id}`,
					title: `${help} (${caption})` }).data("key", key)
					.append($("<span class='hud-key'>").text(caption),
						$("<span class='hud-icon'>").text(icon),
						$("<small>").text(label)));
			}
			bar.append(g.append(row));
		});
		bar.on("click", ".hud-slot", function() {
			send_key($(this).data("key"));
			this.blur();
		});
	}

	function render_hotbar()
	{
		const caster = player.species !== "Djinni";
		$("#hud_slot_cast").toggleClass("off", caster && player.mp <= 0);
		$("#hud_slot_fire").toggleClass("off", player.quiver_available === false);
		$("#hud_slot_fire small").text(player.quiver_available === false ? "Fire: none" : "Fire");
		const hurt = player.hp < player.hp_max * 0.6 || player.mp < player.mp_max * 0.5;
		$("#hud_slot_fight").toggleClass("hl", hostiles > 0);
		$("#hud_slot_rest").toggleClass("hl", hostiles === 0 && hurt);
	}

	// ------------------------------------------------------------------
	// 10: first-run coach strip

	function start_coach()
	{
		let dismissed = false;
		try { dismissed = localStorage.getItem(COACH_KEY) === "1"; } catch (e) {}
		const coach = $("#hud_coach");
		if (dismissed)
		{
			coach.remove();
			return;
		}
		let i = 0;
		const show = function() {
			$("#hud_coach_text").html(COACH_TIPS[i % COACH_TIPS.length]);
			i++;
		};
		show();
		coach_timer = setInterval(show, 12000);
		$("#hud_coach_close").on("click", function() {
			try { localStorage.setItem(COACH_KEY, "1"); } catch (e) {}
			clearInterval(coach_timer);
			coach.remove();
		});
	}

	return {
		init: init,
		refresh: refresh,
		cleanup: cleanup,
		set_active: set_active,
		set_portrait: set_portrait,
		is_active: function() { return active; }
	};
});
