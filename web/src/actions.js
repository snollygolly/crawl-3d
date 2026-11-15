// actions.js -- the hotbar's pickers and aiming, for the 3D HUD.
//
// Cast: the engine has no spell list in its player data, so we show its own
// spell menu as cards. Z (or z) puts up the "Casting: X ... press * to list
// all spells" prompt; we answer * and the engine sends a "menu" tagged
// "spell". Its rows go hidden and a card grid goes in their place, inside the
// same popup, so the stock click-outside, Esc and letter keys keep working.
// We press ! once to get the menu's second set of columns (power, damage,
// range, noise) and merge both into the cards.
//
// Fire / Quaff / Read: pickers built from player.inv, which already has
// counts. A card sends inv_item_action, as the stock action panel does.
//
// Aiming: while the engine is targeting, a banner names what's being aimed
// and offers fire / cancel. three_view moves the engine's aim on hover
// (target_cursor) and draws a reticle at it; a click fires (click_cell).
//
// It sees messages by wrapping comm.handle_message, so no stock file
// changes.
define(["jquery", "comm", "./player",
	"./cell_renderer", "./enums", "./util"],
function($, comm, player, cr, enums, util) {
	"use strict";

	const KEY = { ENTER: 13, ESC: 27, BANG: 33, STAR: 42, Z: 90, f: 102 };
	// object_class_type in the engine (item-prop-enum.h)
	const OBJ = { MISSILES: 1, WANDS: 3, SCROLLS: 5, POTIONS: 7 };

	const PICKERS = {
		fire: { title: "Fire or throw", empty: "Nothing to fire or throw",
			match: it => it.base_type === OBJ.MISSILES || it.base_type === OBJ.WANDS
				|| /^fire$/i.test(it.action_verb || "") },
		quaff: { title: "Drink a potion", empty: "You have no potions",
			match: it => it.base_type === OBJ.POTIONS },
		read: { title: "Read a scroll", empty: "You have no scrolls",
			match: it => it.base_type === OBJ.SCROLLS }
	};

	const FAIL_COLOURS = [[5, "ok"], [20, "fair"], [45, "risky"], [Infinity, "bad"]];

	let hooks = { can_act: () => true };
	let root = null;
	let active = false;
	// letter -> { letter, key, name, tile, fail, level, schools, power, damage, range, noise, colour }
	const spells = new Map();
	let spells_known = false;
	// the open spell menu: { elem, grid, toggled }
	let spell_menu = null;
	// the spell prompt is up: answer * once the engine waits for the key
	let want_list = false;
	// the spell named by the "Casting:" prompt
	let default_spell = null;
	let aim_name = null;
	// the open item picker's kind
	let picker = null;
	let targeting = false;

	// ------------------------------------------------------------------
	// setup

	function init(container, opts)
	{
		cleanup();
		hooks = $.extend(hooks, opts || {});
		install_tap();
		root = $("<div id='hud_actions'>").appendTo(container);
		root.append("<div class='hud-panel' id='hud_picker'><div class='hud-head'>"
			+ "<span class='hud-title'></span><span class='dim'>right-click to describe</span>"
			+ "<button class='hud-close' title='Close (Esc)'>&#x2715;</button></div>"
			+ "<div class='hud-cards'></div></div>");
		root.append("<div class='hud-panel' id='hud_aim'><span class='hud-aim-what'></span>"
			+ "<span class='dim'>click a target</span>"
			+ "<button id='hud_aim_fire' title='Fire at the aimed square'>Fire <span class='hud-key'>Enter</span></button>"
			+ "<button id='hud_aim_cancel' title='Stop aiming'>Cancel <span class='hud-key'>Esc</span></button></div>");
		bind();
		$(document).on("crawl3d_message.actions", function(ev, data) { on_message(data); });
		window.addEventListener("keydown", on_keydown, true);
		document.addEventListener("mousedown", on_mousedown, true);
	}

	function cleanup()
	{
		if (!root) return;
		$(document).off(".actions");
		window.removeEventListener("keydown", on_keydown, true);
		document.removeEventListener("mousedown", on_mousedown, true);
		root.remove();
		root = null;
		spell_menu = null;
		picker = null;
		active = false;
	}

	function set_active(on)
	{
		active = !!on;
		trace(`set_active ${active}`);
		if (!active) close_picker();
		update_aim();
	}

	function bind()
	{
		$("#hud_picker .hud-close").on("click", close_picker);
		$("#hud_picker .hud-cards").on("click", ".hud-card", function() {
			const card = $(this);
			if (card.data("quiver")) send_key(KEY.f);
			else comm.send_message("inv_item_action", { slot: card.data("slot") });
			aim_name = card.data("name");
			close_picker();
		}).on("contextmenu", ".hud-card", function(ev) {
			ev.preventDefault();
			const slot = $(this).data("slot");
			close_picker();
			if (slot !== undefined) comm.send_message("inv_item_describe", { slot: slot });
		});
		$("#hud_aim_fire").on("click", function() { send_key(KEY.ENTER); this.blur(); });
		$("#hud_aim_cancel").on("click", function() { send_key(KEY.ESC); this.blur(); });
	}

	function send_key(code)
	{
		comm.send_message("key", { keycode: code });
	}

	// See every message the client handles, after the stock handler has run.
	function install_tap()
	{
		if (comm.handle_message.crawl3d_tap) return;
		const orig = comm.handle_message;
		const tapped = function(msg) {
			// the stock menu code rewrites msg.items: keep what we read first
			const items = Array.isArray(msg.items) ? msg.items.map(i => ({ text: i.text,
				hotkeys: i.hotkeys, colour: i.colour, tiles: i.tiles })) : null;
			const r = orig.apply(this, arguments);
			try { observe(msg, items); } catch (e) { console.warn("actions:", e); }
			return r;
		};
		tapped.crawl3d_tap = true;
		comm.handle_message = tapped;
	}

	// A short trace of what this module saw, for debugging in the console:
	// window.crawl3d_debug.actions
	function trace(what)
	{
		const d = window.crawl3d_debug;
		if (!d) return;
		d.actions = d.actions || [];
		if (d.actions.length >= 60) d.actions.shift();
		d.actions.push(`${active ? "on " : "off"} ${what}`);
	}

	function observe(msg, items)
	{
		if (msg.msg === "input_mode") trace(`input_mode ${msg.mode} want_list=${want_list}`);
		else if (/menu/.test(msg.msg)) trace(`${msg.msg} ${msg.tag || ""}`);
		switch (msg.msg)
		{
		case "menu":
			if (msg.tag === "spell") open_spell_menu(items || []);
			break;
		case "update_menu_items":
			if (spell_menu) update_spells(items);
			break;
		case "close_menu":
		case "close_all_menus":
			if (spell_menu && !$.contains(document, spell_menu.elem[0])) spell_menu = null;
			break;
		case "input_mode":
			// Send * only now: the engine drops keys that arrive before a
			// prompt starts reading, which the message can beat.
			if (want_list && active && msg.mode === enums.mouse_mode.PROMPT)
				send_key(KEY.STAR);
			want_list = false;
			update_aim();
			break;
		}
	}

	function plain(formatted)
	{
		return $("<div>").html(util.formatted_string_to_html(formatted || "")).text();
	}

	function on_message(data)
	{
		const text = plain(data && data.text).trim();
		trace(`message ${JSON.stringify(text.slice(0, 60))}`);
		let m;
		if ((m = /^Casting: (.+?)(?: \(.*\))?$/.exec(text)))
			default_spell = m[1];
		else if ((m = /^Aiming: (.+?)(?: \(.*\))?$/.exec(text)))
			aim_name = m[1];
		// The spell prompt: "Confirm with . or Enter, or press ? or * to list
		// all spells." when it offers a spell, "Cast which spell? (? or * to
		// list)" when it doesn't. Either way, go straight to the list.
		else if (/^Cast which spell\?/.test(text))
		{
			default_spell = null;
			want_list = true;
		}
		else if (/press \? or \* to list all spells/.test(text))
			want_list = true;
	}

	// ------------------------------------------------------------------
	// spells

	// Cast from the hotbar: Z, which skips the "no targets in range" check,
	// since you pick the target yourself.
	function cast()
	{
		trace("cast clicked");
		close_picker();
		if (!hooks.can_act()) return;
		send_key(KEY.Z);
	}

	// A spell row, as the menu's text: " a + Magic Dart   Conjuration   3%   1",
	// or with the other headers: " a + Magic Dart   64%   1d6   7   Almost silent".
	function parse_spell(item)
	{
		if (!item.hotkeys || !item.hotkeys.length) return null;
		const text = plain(item.text);
		const m = /^\s*(\S)\s+\S?\s+(.*)$/.exec(text);
		if (!m) return null;
		const row = m[2].trim();
		const s = { letter: m[1], key: item.hotkeys[0], colour: item.colour,
			tile: item.tiles && item.tiles[0] };
		// Read the type/failure/level view from the right: a long school list
		// ("Conjuration/Translocation") can run up against the failure column.
		const a = /^(.+?)\s{2,}(.+?)\s+(\d+)%\s+(\d+)$/.exec(row);
		if (a)
		{
			s.name = a[1];
			s.schools = a[2];
			s.fail = parseInt(a[3], 10);
			s.level = parseInt(a[4], 10);
			return s;
		}
		const cols = row.split(/\s{2,}/);
		s.name = cols[0];
		if (cols.length >= 4) [s.power, s.damage, s.range, s.noise] = cols.slice(1);
		return s;
	}

	function update_spells(items)
	{
		for (const item of items || [])
		{
			const s = parse_spell(item);
			if (!s) continue;
			const old = spells.get(s.letter);
			// keep the other view's columns, unless the letter now names another spell
			const merged = old && old.name === s.name ? $.extend(old, strip_undefined(s)) : s;
			spells.set(s.letter, merged);
		}
		spells_known = true;
		render_spells();
		$(document).trigger("crawl3d_actions");
	}

	function strip_undefined(o)
	{
		const out = {};
		for (const k in o) if (o[k] !== undefined) out[k] = o[k];
		return out;
	}

	function open_spell_menu(items)
	{
		if (!active) return;
		const elem = $("#ui-stack .menu_spell").last();
		if (!elem.length) return;
		// the menu lists every spell you know: start the cache afresh
		const letters = new Set(items.filter(i => i.hotkeys && i.hotkeys.length)
			.map(i => String.fromCharCode(i.hotkeys[0])));
		for (const l of [...spells.keys()]) if (!letters.has(l)) spells.delete(l);
		spell_menu = { elem: elem, grid: $("<div id='hud_spells'>"), toggled: false };
		elem.closest(".ui-popup").addClass("crawl3d-spells");
		spell_menu.grid.append("<div class='hud-head'><span class='hud-title'>Cast a spell</span>"
			+ "<span class='hud-head-keys'>"
			+ "<button class='hud-repeat' title='Cast the spell the prompt offered'>"
			+ "<span class='hud-key'>Enter</span> casts <b></b></button>"
			+ "<button id='hud_spells_cancel' title='Close the spell list'>"
			+ "<span class='hud-key'>Esc</span> cancels</button></span>"
			+ "<button class='hud-close' title='Close (Esc)'>\u2715</button></div>"
			+ "<div class='hud-cards'></div>");
		spell_menu.grid.on("click", ".hud-card", function() {
			const card = $(this);
			aim_name = card.data("name");
			send_key(card.data("key"));
		}).on("click", "#hud_spells_cancel, .hud-close", function() {
			send_key(KEY.ESC);
		}).on("click", ".hud-repeat", function() {
			cast_default();
		});
		elem.append(spell_menu.grid);
		update_spells(items);
		if (!letters.size)
		{
			// nothing parsed: leave the stock menu showing
			elem.closest(".ui-popup").removeClass("crawl3d-spells");
			return;
		}
		// the menu's other headers: power, damage, range, noise
		spell_menu.toggled = true;
		send_key(KEY.BANG);
	}

	function fail_class(fail)
	{
		return FAIL_COLOURS.find(e => fail <= e[0])[1];
	}

	function tile_canvas(draw)
	{
		const c = $("<canvas class='hud-card-icon'>");
		const r = new cr.DungeonCellRenderer();
		util.init_canvas(c[0], r.cell_width, r.cell_height);
		r.init(c[0]);
		// the tiles may not have loaded yet
		try { draw(r); } catch (e) {}
		return c;
	}

	function render_spells()
	{
		if (!spell_menu) return;
		const repeat = spell_menu.grid.find(".hud-repeat").toggle(!!default_spell);
		repeat.find("b").text(default_spell || "");
		const box = spell_menu.grid.find(".hud-cards").empty();
		for (const s of spells.values())
		{
			const card = $("<button class='hud-card'>").data({ key: s.key, name: s.name })
				.attr("id", `hud_spell_${s.letter}`);
			if (s.tile)
				card.append(tile_canvas(r => r.draw_from_texture(s.tile.t, 0, 0, s.tile.tex, 0, 0, 0, false)));
			const lines = $("<div class='hud-card-text'>");
			lines.append($("<div class='hud-card-name'>").text(s.name));
			if (s.schools) lines.append($("<div class='dim'>").text(s.schools));
			const stats = $("<div class='hud-card-stats'>");
			if (s.level !== undefined)
			{
				// Djinn cast with their health, and can't spend the last of it
				const djinni = player.species === "Djinni";
				const unit = djinni ? "HP" : "MP";
				const pool = djinni ? player.hp - 1 : player.mp;
				stats.append($("<span class='hud-mp'>").toggleClass("hp", djinni).text(`${s.level} ${unit}`));
				const casts = s.level > 0 ? Math.floor(Math.max(0, pool) / s.level) : 0;
				if (s.level > pool)
				{
					card.addClass("off");
					stats.append($("<span class='hud-warn'>").text(`not enough ${unit}`));
				}
				else if (s.level > 0)
					stats.append($("<span class='dim'>").text(`${casts} ${casts === 1 ? "cast" : "casts"}`));
			}
			if (s.fail !== undefined)
				stats.append($("<span class='hud-fail'>").addClass(fail_class(s.fail))
					.text(`${s.fail}% fail`));
			lines.append(stats);
			const more = [];
			if (s.range && s.range !== "N/A") more.push(`range ${s.range}`);
			if (s.damage && s.damage !== "N/A") more.push(`dmg ${s.damage}`);
			if (s.power && s.power !== "N/A") more.push(`power ${s.power}`);
			if (s.noise) more.push(s.noise.toLowerCase());
			if (more.length) lines.append($("<div class='dim hud-card-more'>").text(more.join(" \u00B7 ")));
			card.append(lines, $("<span class='hud-key'>").text(s.letter));
			if (s.name === default_spell) card.addClass("last");
			card.attr("title", `${s.name} (${s.letter})`);
			box.append(card);
		}
	}

	// ------------------------------------------------------------------
	// item pickers

	function inv_items(kind)
	{
		const set = PICKERS[kind];
		return Object.values(player.inv || {}).filter(it => it.quantity && set.match(it));
	}

	function count_of(it)
	{
		const n = it[it.qty_field || "quantity"];
		return n === undefined ? it.quantity : n;
	}

	function count_label(it)
	{
		if (it.base_type === OBJ.WANDS)
		{
			const n = count_of(it);
			return `${n} ${n === 1 ? "charge" : "charges"}`;
		}
		if (it.base_type === OBJ.MISSILES || it.quantity > 1) return `\u00D7${it.quantity}`;
		return "";
	}

	function quiver_text()
	{
		const q = plain(player.quiver_desc);
		return q && !/^nothing/i.test(q) ? q : "";
	}

	function open_picker(kind)
	{
		if (picker === kind)
		{
			close_picker();
			return;
		}
		if (!hooks.can_act()) return;
		picker = kind;
		const set = PICKERS[kind];
		const panel = $("#hud_picker").attr("data-kind", kind);
		panel.find(".hud-title").text(set.title);
		const box = panel.find(".hud-cards").empty();
		const items = inv_items(kind);
		const quivered = kind === "fire" ? player.quiver_item : -1;
		items.sort((a, b) => (b.slot === quivered) - (a.slot === quivered)
			|| (a.action_panel_order || 0) - (b.action_panel_order || 0) || a.slot - b.slot);
		// a quivered spell or ability isn't in the inventory
		const q = kind === "fire" ? quiver_text() : "";
		if (q && quivered < 0)
		{
			const name = q.replace(/^\w+: /, "");
			box.append($("<button class='hud-card quivered'>").data({ quiver: true, name: name })
				.attr("id", "hud_pick_quiver").attr("title", `${q} (f)`)
				.append($("<div class='hud-card-text'>").append(
					$("<div class='hud-card-name'>").text(name),
					$("<div class='dim'>").text("quivered")),
				$("<span class='hud-key'>").text("f")));
		}
		for (const it of items)
		{
			const name = $("<span>").append(player.inventory_item_desc(it.slot)).text();
			const card = $("<button class='hud-card'>").data({ slot: it.slot, name: name })
				.attr("id", `hud_pick_${it.slot}`).attr("title", name);
			card.append(tile_canvas(r => (it.tile || []).forEach(t => r.draw_main(t, 0, 0))));
			const text = $("<div class='hud-card-text'>")
				.append($("<div class='hud-card-name'>").append(player.inventory_item_desc(it.slot)));
			if (it.slot === quivered) text.append($("<div class='dim'>").text("quivered \u00B7 f"));
			card.append(text);
			const n = count_label(it);
			if (n) card.append($("<span class='hud-count'>").text(n));
			card.append($("<span class='hud-key'>").text(String.fromCharCode(it.letter)));
			if (it.slot === quivered) card.addClass("quivered");
			if (it.useless) card.addClass("off");
			box.append(card);
		}
		if (!box.children().length) box.append($("<div class='hud-empty dim'>").text(set.empty));
		panel.show();
	}

	function close_picker()
	{
		if (!picker) return;
		picker = null;
		$("#hud_picker").hide();
	}

	// ------------------------------------------------------------------
	// aiming

	function update_aim()
	{
		const g = window.game;
		const now = !!(active && g && g.can_target && g.can_target());
		if (!now && targeting) aim_name = null;
		targeting = now;
		if (!root) return;
		$("#hud_aim").toggleClass("on", now);
		root.parent().toggleClass("aiming", now);
		if (now)
		{
			$("#hud_aim .hud-aim-what").empty().append("Aiming ",
				$("<b>").text(aim_name || "\u2026"));
			close_picker();
		}
	}

	// ------------------------------------------------------------------
	// input

	function on_keydown(ev)
	{
		if (picker && ev.key === "Escape")
		{
			ev.preventDefault();
			ev.stopImmediatePropagation();
			close_picker();
			return;
		}
		// Enter or . in the spell list casts the spell the prompt offered,
		// as it would have before we skipped the prompt.
		if (spell_menu && (ev.key === "Enter" || ev.key === ".") && cast_default())
		{
			ev.preventDefault();
			ev.stopImmediatePropagation();
		}
	}

	// Cast the spell the prompt offered, if it's in the list.
	function cast_default()
	{
		const s = default_spell && [...spells.values()].find(sp => sp.name === default_spell);
		if (!s) return false;
		aim_name = s.name;
		send_key(s.key);
		return true;
	}

	function on_mousedown(ev)
	{
		if (!picker) return;
		const t = $(ev.target);
		if (t.closest("#hud_picker, .hud-slot").length) return;
		close_picker();
	}

	// ------------------------------------------------------------------
	// for the hotbar

	function slot(id)
	{
		if (id === "cast") cast();
		else if (PICKERS[id]) open_picker(id);
		else return false;
		return true;
	}

	// The hotbar's badge for a slot, or "".
	function badge(id)
	{
		if (id === "cast") return spells_known ? String(spells.size) : "";
		if (id === "fire")
		{
			const it = player.inv && player.inv[player.quiver_item];
			if (it && it.quantity && (it.base_type === OBJ.MISSILES || it.base_type === OBJ.WANDS))
				return it.base_type === OBJ.WANDS ? String(count_of(it)) : `\u00D7${it.quantity}`;
			return "";
		}
		if (PICKERS[id])
		{
			const n = inv_items(id).reduce((a, it) => a + it.quantity, 0);
			return n ? String(n) : "";
		}
		return "";
	}

	function has_fire()
	{
		return !!quiver_text() || inv_items("fire").length > 0;
	}

	return {
		init: init,
		cleanup: cleanup,
		set_active: set_active,
		slot: slot,
		badge: badge,
		has_fire: has_fire,
		is_targeting: function() { return targeting; },
		picker_open: function() { return picker; }
	};
});
