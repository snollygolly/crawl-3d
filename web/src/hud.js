// hud.js -- the panel HUD drawn over the full-window 3D view.
//
// It renders from the stock client's state (the player module) and never
// talks to the engine itself. web/overrides/gamedata/player.js triggers
// "crawl3d_player" after each player update; three_view.js turns the HUD on
// and off with the 3D view (2D mode keeps the classic WebTiles layout) and
// hands it the player's tile for the portrait.
//
// The stock message pane is not replaced: in HUD mode crawl3d.css moves it
// into a panel, so --more--, prompts and text input keep working unchanged.
define(["jquery", "./player",
	"./options", "./util"],
function($, player, options, util) {
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
</div>`;

	let root = null;
	let active = false;
	let last_place = null;
	let last = { hp: null, mp: null };
	let portrait = null;

	function init()
	{
		cleanup();
		root = $(TEMPLATE.trim()).appendTo("#game");
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
		if (on) render();
	}

	// img: a canvas holding the player's sprite as three_view draws it
	// (TS + 16 wide, 2 * TS tall, the tile's own square at (8, TS)).
	function set_portrait(img)
	{
		portrait = img;
		const c = document.getElementById("hud_portrait");
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

	return {
		init: init,
		cleanup: cleanup,
		set_active: set_active,
		set_portrait: set_portrait,
		is_active: function() { return active; }
	};
});
