// inventory.js -- the 3D HUD's inventory: a character sheet with a paper doll
// of equipment slots and a bag of item tiles.
//
// Like Cast in actions.js, it redraws the engine's own menu rather than
// replacing it. "i" (or the hotbar's Inventory) opens the stock inventory
// menu (tag "inventory"); its rows go hidden and the sheet goes in their
// place, inside the same popup, so Esc, click-outside and letter keys keep
// working.
//
// The bag comes from player.inv, which lists every item. What's equipped
// doesn't: apart from the weapon (weapon_index / offhand_index), the player
// data never says. The menu's gear rows do ("b - a +0 scale mail (worn)"),
// so the sheet reads them each time it opens. The menu reopens on whichever
// category it last showed, so if that isn't gear, the sheet presses Right
// until it is. Which slot a piece goes in
// comes from its tile's name (THELM_* is a helmet, ARM_BOOTS* boots, ...),
// with the item's name as a fallback for artefacts.
//
// Letters aren't unique: gear and consumables are lettered separately, so a
// cloak and a scroll can both be "c". Items are known by their inventory slot
// (player.inv index) instead, and a menu row is matched to its item by its
// tile, then its name.
//
// Clicking an item sends its letter, and the engine shows its description
// with actions. The menu shows one category at a time (gear, potions, ...),
// and letters only work for the category on screen, so for an item elsewhere
// we press Right until its category comes up, then send the letter.
//
// The item description's actions ("(q)uaff, (d)rop, or (i)nscribe.") are
// turned into buttons while the HUD is on, it gets a close button, and its
// trailing stash search / menu colouring prefixes become rows of chips.
//
// Any action closes the engine's menu. For gear actions (wear, take off,
// drop...) the sheet then reopens itself once the engine is waiting for a
// command again, so it shows the change; using up an item (quaff, read, fire)
// leaves it closed, so you see what happens.
//
// Messages come from actions.js's comm tap, as "crawl3d_comm" events.
define(["jquery", "comm", "./player", "./util", "./enums",
	"./tile_names", "./tileinfo-main", "./actions"],
function($, comm, player, util, enums, names, main, actions) {
	"use strict";

	const KEY = { ESC: 27, RIGHT: -251 };
	// object_class_type values seen in player.inv
	const OBJ = { WEAPONS: 0, MISSILES: 1, ARMOUR: 2, WANDS: 3, SCROLLS: 5, POTIONS: 7 };

	// [id, label, placeholder tile]
	const DOLL = [
		["cloak", "Cloak", "ARM_CLOAK"],
		["head", "Helmet", "THELM_HELM"],
		["amulet", "Amulet", "AMU_NORMAL_OFFSET"],
		["weapon", "Weapon", "WPN_LONG_SWORD"],
		["body", "Body armour", "ARM_SCALE_MAIL"],
		["offhand", "Off-hand", "ARM_KITE_SHIELD"],
		["hands", "Gloves", "ARM_GLOVES"],
		["ring1", "Ring", "RING_NORMAL_OFFSET"],
		["feet", "Boots", "ARM_BOOTS"],
		["ring2", "Ring", "RING_NORMAL_OFFSET"]
	];
	const SLOT_LABEL = {};
	for (const [id, label] of DOLL) SLOT_LABEL[id] = label;

	// bag groups: [title, kinds] (kinds from tile_names KINDS)
	const GROUPS = [
		["Weapons", ["weapon", "staff"]],
		["Ammunition", ["ammunition"]],
		["Armour", ["armour", "helmet"]],
		["Jewellery", ["ring", "amulet"]],
		["Wands", ["wand"]],
		["Potions", ["potion"]],
		["Scrolls", ["scroll"]],
		["Books", ["book"]],
		["Talismans", ["talisman"]],
		["Gizmos", ["gizmo"]],
		["Other", null]
	];
	const GEAR = new Set(["weapon", "staff", "armour", "helmet", "ring", "amulet", "gizmo"]);

	// Verbs that use or equip the item; the rest (drop, inscribe...) are secondary.
	const PRIMARY = /^(wield|unwield|wear|take off|put on|remove|equip|unequip|quaff|drink|read|evoke|zap|memorise|fire|throw)$/i;

	// Actions after which the sheet comes back.
	const STAY = /^(wield|unwield|wear|take off|put on|remove|equip|unequip|drop|adjust|inscribe|quiver)$/i;
	const REOPEN_MS = 30000;

	const HINT = "Click an item for details and actions · Esc closes";

	let hooks = { can_act: () => true };
	let active = false;
	let bound = false;
	// the open sheet: { elem, box, rows, total, page, asked, gear,
	// fresh (equipment read since it opened), seek (Rights sent to find it) };
	// page: the inventory slots of the items on the category showing
	let sheet = null;
	// inventory slot -> the menu's annotation ("worn", "weapon", ...), from the gear rows
	let equipped = new Map();
	// an item to describe once its category comes up: { slot, tries }
	let pending = null;
	// when a gear action was chosen from the sheet, so it should reopen
	let reopen_at = 0;

	// ------------------------------------------------------------------
	// setup

	function init(opts)
	{
		cleanup();
		hooks = $.extend(hooks, opts || {});
		$(document).on("crawl3d_comm.inventory", function(ev, msg, items) {
			try { observe(msg, items); } catch (e) { console.warn("inventory:", e); }
		});
		$(document).on("crawl3d_player.inventory", function() { if (sheet) render(); });
		// Before the stock handler's key reaches the engine, note whether the
		// action should bring the sheet back. (Hotkeys click the button too.)
		$(document).on("click.inventory", "#ui-stack .describe-item .hud-act", function() {
			reopen_at = sheet && STAY.test($(this).attr("data-verb") || "") ? performance.now() : 0;
		});
		$(document).on("click.inventory", "#ui-stack .describe-item .hud-desc-close", function() {
			send_key(KEY.ESC);
		});
		bound = true;
	}

	function cleanup()
	{
		if (!bound) return;
		$(document).off(".inventory");
		close_sheet();
		bound = false;
		active = false;
	}

	function set_active(on)
	{
		active = !!on;
		if (!active) close_sheet();
	}

	function send_key(code)
	{
		comm.send_message("key", { keycode: code });
	}

	function plain(formatted)
	{
		return $("<div>").html(util.formatted_string_to_html(formatted || "")).text();
	}

	function observe(msg, items)
	{
		switch (msg.msg)
		{
		case "menu":
			// drop shares the tag, but chooses items: that's menus.js's
			if (msg.tag === "inventory" && !((msg.flags || 0) & enums.menu_flag.MULTISELECT))
				open_sheet(msg, items || []);
			else forget_closed();
			break;
		case "update_menu":
			if (!sheet || !is_ours()) break;
			if (msg.total_items !== undefined)
			{
				sheet.rows = [];
				sheet.total = msg.total_items;
				sheet.asked = false;
			}
			if (msg.title) read_title(msg.title);
			break;
		case "update_menu_items":
			if (sheet && is_ours()) put_rows(msg.chunk_start || 0, items || []);
			break;
		case "close_menu":
		case "close_all_menus":
			forget_closed();
			break;
		case "input_mode":
			if (msg.mode === enums.mouse_mode.COMMAND) maybe_reopen();
			break;
		case "ui-push":
			if (msg.type === "describe-item" && active) dress_desc();
			break;
		}
	}

	// The engine is waiting for a command: bring the sheet back after a gear
	// action, unless something else has come up.
	function maybe_reopen()
	{
		if (!reopen_at) return;
		const late = performance.now() - reopen_at > REOPEN_MS;
		if (late || !active)
		{
			reopen_at = 0;
			return;
		}
		if (sheet || $("#ui-stack").children().length) return;
		reopen_at = 0;
		send_key("i".charCodeAt(0));
	}

	// the menu on top is the inventory (not, say, a prompt on top of it)
	function is_ours()
	{
		return sheet && $.contains(document, sheet.elem[0]);
	}

	function forget_closed()
	{
		if (sheet && !is_ours())
		{
			sheet = null;
			pending = null;
		}
	}

	// ------------------------------------------------------------------
	// reading the menu

	function open_sheet(msg, items)
	{
		close_sheet();
		if (!active) return;
		const elem = $("#ui-stack .menu_inventory").last();
		if (!elem.length) return;
		const box = $("<div id='hud_inv'>").html(
			"<div class='hud-head'><span class='hud-title'>Inventory</span>"
			+ "<span class='hud-inv-meta'></span>"
			+ "<button class='hud-close' title='Close (Esc)'>✕</button></div>"
			+ "<div class='hud-inv-body'><div class='hud-inv-left'><div class='hud-inv-doll'></div>"
			+ "<div class='hud-inv-extra'></div><div class='hud-inv-defs'></div></div>"
			+ "<div class='hud-inv-bag'></div></div>"
			+ "<div class='hud-inv-info'></div>");
		sheet = { elem: elem, box: box, rows: [], total: msg.total_items || 0,
			page: new Set(), asked: false, gear: "", fresh: false, seek: 0 };
		pending = null;
		elem.closest(".ui-popup").addClass("crawl3d-inv");
		elem.append(box);
		bind(box);
		read_title(msg.title);
		put_rows(msg.chunk_start || 0, items);
	}

	function close_sheet()
	{
		if (!sheet) return;
		sheet.elem.closest(".ui-popup").removeClass("crawl3d-inv");
		sheet.box.remove();
		sheet = null;
		pending = null;
	}

	function read_title(title)
	{
		const m = /(\d+)\s*\/\s*(\d+) gear slots/.exec(plain(title && title.text));
		if (m) sheet.gear = `${m[1]}/${m[2]}`;
		if (sheet.box) render_meta();
	}

	function put_rows(start, items)
	{
		items.forEach(function(it, i) { sheet.rows[start + i] = it; });
		const have = sheet.rows.filter(() => true).length;
		if (have < sheet.total)
		{
			// the list is hidden, so the stock menu won't scroll to fetch
			// the rest: ask for all of it
			if (!sheet.asked)
			{
				sheet.asked = true;
				comm.send_message("menu_scroll", { first: 0, last: sheet.total - 1, hover: -1 });
			}
			return;
		}
		const rows = [];
		for (const r of sheet.rows)
		{
			const it = r && r.hotkeys && r.hotkeys.length ? item_for_row(r) : null;
			if (it) rows.push([r, it]);
		}
		sheet.page = new Set(rows.map(([, it]) => it.slot));
		if (read_equipped(rows)) sheet.fresh = true;
		if (pending)
		{
			const it = sheet.page.has(pending.slot) && player.inv[pending.slot];
			if (it)
			{
				pending = null;
				send_key(it.letter);
			}
			else if (++pending.tries < 12)
				send_key(KEY.RIGHT);
			else
				pending = null;
		}
		else if (!sheet.fresh && ++sheet.seek < 12)
			send_key(KEY.RIGHT);
		render();
	}

	// The item a menu row lists. Its letter may be shared by a gear item and
	// a consumable; the row's tiles (which end with the item's own) or its
	// text tell them apart.
	function item_for_row(r)
	{
		const letter = r.hotkeys[0];
		const cands = inv_items().filter(it => it.letter === letter);
		if (cands.length <= 1) return cands[0] || null;
		const tiles = (r.tiles || []).map(t => t.t);
		const text = plain(r.text);
		return cands.find(it => it.tile && it.tile.length && tiles.includes(it.tile[0]))
			|| cands.find(it => it.name && text.includes(it.name)) || null;
	}

	// The gear rows say what's equipped: " b - a +0 scale mail (worn)".
	// rows: [[row, item]]. -> false if this page isn't the gear category,
	// so says nothing
	function read_equipped(rows)
	{
		const gear_rows = rows.filter(([, it]) => GEAR.has(kind_of(it)));
		const has_gear = inv_items().some(it => GEAR.has(kind_of(it)));
		// another category's page says nothing about equipment
		if (has_gear && !gear_rows.length) return false;
		equipped = new Map();
		for (const [r, it] of gear_rows)
		{
			const m = /\(([^()]+)\)\s*$/.exec(plain(r.text).trim());
			if (m) equipped.set(it.slot, m[1]);
		}
		return true;
	}

	// ------------------------------------------------------------------
	// items

	function inv_items()
	{
		return Object.values(player.inv || {}).filter(it => it && it.quantity > 0);
	}

	function letter_of(it)
	{
		return String.fromCharCode(it.letter);
	}

	// weapon, armour, helmet, ring, potion, ... (tile_names KINDS)
	function kind_of(it)
	{
		const t = names.inv_tile(it.tile && it.tile[0]);
		const k = t && t.kind;
		if (k && k !== "artefact") return k;
		const name = it.name || "";
		switch (it.base_type)
		{
		case OBJ.WEAPONS: return /\bstaff\b/i.test(name) ? "staff" : "weapon";
		case OBJ.ARMOUR: return "armour";
		case OBJ.MISSILES: return "ammunition";
		case OBJ.WANDS: return "wand";
		case OBJ.SCROLLS: return "scroll";
		case OBJ.POTIONS: return "potion";
		}
		if (/\bring\b/i.test(name)) return "ring";
		if (/\b(amulet|necklace|brooch|pendant|medallion|scarab)\b/i.test(name)) return "amulet";
		if (/\bstaff\b/i.test(name)) return "staff";
		return k || "item";
	}

	// Which doll slot a piece of gear goes in.
	function slot_of(it)
	{
		const kind = kind_of(it);
		switch (kind)
		{
		case "weapon":
		case "staff":
			return it.slot === player.offhand_index ? "offhand" : "weapon";
		case "helmet": return "head";
		case "ring": return "ring";
		case "amulet": return "amulet";
		case "gizmo": return "gizmo";
		case "armour":
		{
			const t = names.inv_tile(it.tile && it.tile[0]);
			const key = t && t.kind === "armour" ? t.key : "";
			const text = key || (it.name || "").toUpperCase();
			if (/GLOVES|GAUNTLETS/.test(text)) return "hands";
			if (/BOOTS|BARDING/.test(text)) return "feet";
			if (/CLOAK|SCARF|CAPE/.test(text)) return "cloak";
			if (/BUCKLER|SHIELD|ORB\b|ARM_ORB/.test(text)) return "offhand";
			if (/THELM|\bHAT\b|HELM|\bCAP\b|CROWN|MASK/.test(text)) return "head";
			return "body";
		}
		default: return null;
		}
	}

	function is_equipped(it)
	{
		return equipped.has(it.slot) || it.slot === player.weapon_index
			|| (it.slot === player.offhand_index && player.offhand_index >= 0);
	}

	function draw_item(it)
	{
		return actions.tile_canvas(r => (it.tile || []).forEach(t => r.draw_main(t, 0, 0)));
	}

	// ------------------------------------------------------------------
	// drawing

	function render()
	{
		if (!sheet) return;
		try
		{
			render_meta();
			render_doll();
			render_bag();
			render_defs();
		}
		catch (e)
		{
			// leave the stock menu showing rather than a broken sheet
			console.warn("inventory:", e);
			close_sheet();
		}
	}

	function render_meta()
	{
		const meta = sheet.box.find(".hud-inv-meta").empty();
		meta.append($("<span class='hud-inv-gold'>").attr("title", "Gold")
			.text(`● ${player.gold || 0} gold`));
		if (sheet.gear)
			meta.append($("<span class='dim'>").attr("title", "Gear slots used").text(`gear ${sheet.gear}`));
	}

	// slot id -> item, for what's equipped
	function worn_by_slot()
	{
		const out = new Map();
		const extra = [];
		let rings = 0;
		const worn = inv_items().filter(is_equipped)
			.sort((a, b) => a.slot - b.slot);
		for (const it of worn)
		{
			let s = slot_of(it);
			if (s === "ring") s = `ring${++rings}`;
			if (!s || out.has(s) || (s.startsWith("ring") && rings > 2))
				extra.push([s, it]);
			else
				out.set(s, it);
		}
		return { slots: out, extra: extra };
	}

	function render_doll()
	{
		const { slots, extra } = worn_by_slot();
		const doll = sheet.box.find(".hud-inv-doll").empty();
		for (const [id, label, ph] of DOLL)
			doll.append(slot_button(id, label, slots.get(id), ph));
		const more = sheet.box.find(".hud-inv-extra").empty();
		extra.forEach(function([s, it], i) {
			const label = s && s.startsWith("ring") ? "Ring" : SLOT_LABEL[s] || (s === "gizmo" ? "Gizmo" : "Equipped");
			more.append(slot_button(`extra${i}`, label, it, null));
		});
		more.toggle(extra.length > 0);
	}

	function slot_button(id, label, it, placeholder)
	{
		const b = $("<button class='hud-inv-slot'>").attr({ id: `hud_inv_slot_${id}`, "data-slot": id })
			.css("grid-area", id);
		if (it)
		{
			const letter = letter_of(it);
			b.addClass("filled").attr({ "data-letter": letter, "data-inv": it.slot })
				.append(draw_item(it), $("<span class='hud-key'>").text(letter));
			if (it.plus) b.append($("<span class='hud-inv-plus'>").text(it.plus > 0 ? `+${it.plus}` : it.plus));
		}
		else
		{
			const idx = placeholder && main[placeholder];
			if (idx) b.append(actions.tile_canvas(r => r.draw_main(idx, 0, 0)).addClass("ghost"));
		}
		// nagas and armataurs wear barding where others wear boots
		if (it && id === "feet" && /barding/i.test(it.name || "")) label = "Barding";
		b.append($("<span class='hud-inv-label'>").text(label));
		return b;
	}

	function render_bag()
	{
		const bag = sheet.box.find(".hud-inv-bag").empty();
		const groups = GROUPS.map(g => [g[0], g[1], []]);
		const loose = inv_items().filter(it => !is_equipped(it))
			.sort((a, b) => a.slot - b.slot);
		for (const it of loose)
		{
			const kind = kind_of(it);
			const g = groups.find(x => x[1] && x[1].includes(kind)) || groups[groups.length - 1];
			g[2].push(it);
		}
		for (const [title, , list] of groups)
		{
			if (!list.length) continue;
			const row = $("<div class='hud-inv-tiles'>");
			for (const it of list) row.append(bag_button(it));
			bag.append($("<div class='hud-inv-group'>").append(
				$("<div class='hud-inv-group-name'>").text(title), row));
		}
		if (!loose.length)
			bag.append($("<div class='hud-empty dim'>").text(inv_items().length
				? "Everything you carry is equipped" : "You aren't carrying anything"));
	}

	function bag_button(it)
	{
		const letter = letter_of(it);
		const b = $("<button class='hud-inv-item'>")
			.attr({ id: `hud_inv_item_${it.slot}`, "data-letter": letter, "data-inv": it.slot })
			.append(draw_item(it), $("<span class='hud-key'>").text(letter));
		const s = slot_of(it);
		if (s) b.attr("data-fits", s.startsWith("ring") ? "ring" : s);
		if (it.quantity > 1) b.append($("<span class='hud-count'>").text(it.quantity));
		if (it.useless) b.addClass("off");
		return b;
	}

	function render_defs()
	{
		const defs = sheet.box.find(".hud-inv-defs").empty();
		const chip = (k, v, title) => $("<span class='hud-chip'>").attr("title", title)
			.append($("<span class='dim'>").text(`${k} `), $("<b>").text(v));
		defs.append(chip("AC", player.ac, "Armour class: reduces damage taken"),
			chip("EV", player.ev, "Evasion: chance to dodge attacks"),
			chip("SH", player.sh, "Shield: chance to block attacks"));
		info(null);
	}

	// The strip under the sheet: what's under the pointer.
	function info(el)
	{
		if (!sheet) return;
		const box = sheet.box.find(".hud-inv-info").empty();
		const inv = el && el.attr("data-inv");
		const it = inv !== undefined && inv !== null && player.inv[inv];
		if (it && it.quantity > 0)
		{
			const ann = equipped.get(it.slot) || (is_equipped(it) ? "equipped" : null);
			box.append($("<span class='hud-key'>").text(letter_of(it)), " ",
				player.inventory_item_desc(it.slot));
			if (ann) box.append($("<span class='hud-inv-ann'>").text(ann));
			box.append($("<span class='dim'>").text(" · click for details"));
			return;
		}
		if (el && el.hasClass("hud-inv-slot"))
		{
			const fits = slot_fits(el.attr("data-slot"));
			box.append($("<b>").text(`${el.find(".hud-inv-label").text()}: `),
				$("<span class='dim'>").text(fits.length ? "empty · highlighted items fit here"
					: "empty · you carry nothing that fits"));
			return;
		}
		box.append($("<span class='dim'>").text(HINT));
	}

	function slot_fits(id)
	{
		const want = /^ring/.test(id) ? "ring" : id;
		return sheet.box.find(`.hud-inv-item[data-fits='${want}']`);
	}

	// ------------------------------------------------------------------
	// input

	function bind(box)
	{
		box.on("click", ".hud-close", function() { send_key(KEY.ESC); })
			.on("click contextmenu", "[data-inv]", function(ev) {
				ev.preventDefault();
				select(Number($(this).attr("data-inv")));
			})
			.on("mouseenter", ".hud-inv-slot, .hud-inv-item", function() {
				const el = $(this);
				info(el);
				if (el.hasClass("hud-inv-slot") && !el.hasClass("filled"))
					slot_fits(el.attr("data-slot")).addClass("fits");
			})
			.on("mouseleave", ".hud-inv-slot, .hud-inv-item", function() {
				info(null);
				box.find(".hud-inv-item.fits").removeClass("fits");
			});
	}

	// Describe an item (by inventory slot): its letter, once its category
	// is on screen.
	function select(slot)
	{
		const it = player.inv[slot];
		if (!sheet || !it || !(it.quantity > 0)) return;
		if (sheet.page.has(slot))
			send_key(it.letter);
		else
		{
			pending = { slot: slot, tries: 0 };
			send_key(KEY.RIGHT);
		}
	}

	// ------------------------------------------------------------------
	// item description: a close button, actions as buttons, tags as chips

	function dress_desc()
	{
		const popup = $("#ui-stack .describe-item").last();
		if (!popup.length || popup.hasClass("hud-desc")) return;
		popup.addClass("hud-desc");
		popup.closest(".ui-popup").addClass("crawl3d-desc");
		popup.children(".header")
			.append("<button class='hud-close hud-desc-close' title='Close (Esc)'>✕</button>");
		tagify_desc(popup.children(".body"));
		buttonize_actions(popup.children(".actions"));
	}

	function buttonize_actions(acts)
	{
		if (!acts.length) return;
		acts.addClass("hud-actions");
		// drop the ", " and ", or " between actions, and the final "."
		acts.contents().filter(function() { return this.nodeType === 3; }).remove();
		acts.children("span[data-hotkey]").each(function() {
			const span = $(this);
			const key = span.attr("data-hotkey");
			// "(q)uaff" -> "quaff", "(=)adjust" -> "adjust"
			const label = span.text().replace(/\((.)\)/, (m, c) => (/[a-z]/i.test(c) ? c : "")).trim();
			const nice = label.charAt(0).toUpperCase() + label.slice(1);
			span.empty().addClass("hud-act").attr({ role: "button", title: `${nice} (${key})`, "data-verb": label })
				.append($("<span class='hud-key'>").text(key), $("<span>").text(nice));
			if (PRIMARY.test(label)) span.addClass("primary");
		});
	}

	// The engine ends a full item description with its stash search terms
	// and menu colouring prefixes (describe.cc), then a "____" rule and the
	// quote, all as text. Show the first two as rows of chips, and style
	// the quote instead of the rule.
	function tagify_desc(body)
	{
		const pre = body.find("pre").filter(function() {
			return /^\s*Stash search prefixes:/.test($(this).text());
		}).last();
		if (!pre.length) return;
		const lines = pre.html().split(/<br\s*\/?>/i).map(h => $("<div>").html(h).text().trim());
		const tags = $("<div class='hud-desc-tags'>");
		const row = (label, title, chips) => {
			if (!chips.length) return;
			const r = $("<div class='hud-tag-row'>").attr("title", title)
				.append($("<span class='hud-tag-label'>").text(label));
			for (const c of chips) r.append(c);
			tags.append(r);
		};
		let rule = false;
		for (const line of lines)
		{
			let m;
			if ((m = /^Stash search prefixes:(.*)$/.exec(line)))
			{
				const terms = [...m[1].matchAll(/\{([^}]+)\}/g)].map(t => t[1].trim()).filter(Boolean);
				row("Search", "Ctrl-F (stash search) finds this item by these",
					terms.map(t => $("<span class='hud-tag'>").text(t)));
			}
			else if ((m = /^Menu\/colouring prefixes:(.*)$/.exec(line)))
			{
				const words = m[1].trim();
				// one chip: the prefixes are space-joined and some are two words
				row("Menu", "What menu_colour and autopickup rules match this item by",
					words ? [$("<span class='hud-tag dim'>").text(words)] : []);
			}
			else if (/^_{3,}$/.test(line))
				rule = true;
		}
		if (rule) pre.nextAll("pre").addClass("hud-desc-quote");
		pre.replaceWith(tags);
	}

	return {
		init: init,
		cleanup: cleanup,
		set_active: set_active,
		is_open: function() { return !!sheet; },
		equipped: function() { return new Map(equipped); }
	};
});
