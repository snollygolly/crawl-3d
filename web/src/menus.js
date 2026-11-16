// menus.js -- the 3D HUD's look for the engine's other menus and popups.
//
// Cast (actions.js) and Inventory (inventory.js) redraw their menus. Every
// other menu (drop, wear / wield / put on, quiver, abilities, travel...)
// keeps the stock list, dressed:
//   - a close button;
//   - rows as buttons, with the " a - " prefix as a key chip (the prefix is
//     kept, hidden, so 2D mode shows the stock menu unchanged), and chosen
//     rows (" a + ") marked;
//   - the "[key] what" hints of the engine's footer line as buttons.
// The stock menu code still does the work: keys, Esc, click-outside,
// scrolling, hover, and clicking a row.
//
// Pickup (tag "pickup", g on a square with several items) goes further, like
// Cast: its rows go hidden and a sheet of item cards goes in their place, in
// the same popup. A card shows whether it's chosen; the footer says how many
// are and what Enter will do, and offers all / none.
//
// The describe popups other than the item's (monster, spell, feature, god)
// and text pages get the same panel and a close button.
//
// Messages come from actions.js's comm tap, as "crawl3d_comm" events, after
// the stock handler has drawn the menu. menus.js is set up after
// inventory.js, so it sees the inventory sheet's class and leaves that menu
// alone.
define(["jquery", "comm", "./util", "./enums", "./actions"], function($, comm, util, enums, actions) {
	"use strict";

	const KEY = { TAB: 9, ENTER: 13, ESC: 27, SPACE: 32, COMMA: 44, MINUS: 45, LEFT: -252, RIGHT: -251 };
	const MF = enums.menu_flag;
	// the engine's DARKGREY: its menu colour for useless items
	const USELESS_COLOUR = 8;
	// footer hints the mouse doesn't need: moving the cursor, paging, the
	// scroll position, and Esc (the close button)
	const SKIP_HINT = /^(Up|Down|PgUp|PgDn|Home|End|XXX|Esc)\b/i;
	const NAMED_KEYS = { enter: KEY.ENTER, ret: KEY.ENTER, esc: KEY.ESC, tab: KEY.TAB,
		space: KEY.SPACE, left: KEY.LEFT, right: KEY.RIGHT };
	const PICK_HINT = "Click items to choose them · Enter picks up · Esc cancels";

	let active = false;
	let bound = false;
	// the engine's open menus, oldest first, as the stock menu.js keeps them:
	// { elem, tag, type, flags, title, more, alt_more }
	let stack = [];
	// the open pickup sheet: { menu, box, rows, total, asked }
	let pickup = null;

	// ------------------------------------------------------------------
	// setup

	function init()
	{
		cleanup();
		$(document).on("crawl3d_comm.menus", function(ev, msg, items) {
			try { observe(msg, items); } catch (e) { console.warn("menus:", e); }
		});
		$(document).on("click.menus", "#ui-stack .hud-menu-close, #ui-stack .hud-desc-other", function() {
			send_key(KEY.ESC);
		});
		$(document).on("click.menus", "#ui-stack .hud-menu-btn", function() {
			send_key(Number($(this).attr("data-key")));
		});
		// Keep buttons from taking focus on click: Enter on a focused button
		// would click it again as well as reach the engine.
		$(document).on("mousedown.menus", "#ui-stack .hud-menu-btn, #ui-stack .hud-menu-close, #hud_pickup button", function(ev) {
			ev.preventDefault();
		});
		bound = true;
	}

	function cleanup()
	{
		if (!bound) return;
		$(document).off(".menus");
		close_pickup();
		stack = [];
		bound = false;
		active = false;
	}

	function set_active(on)
	{
		active = !!on;
		// Our markup stays, but its looks are all under body.crawl3d-hud, so
		// 2D shows the stock menu. Dress what's open now.
		if (active) stack.forEach(dress);
	}

	function send_key(code)
	{
		if (Number.isFinite(code)) comm.send_message("key", { keycode: code });
	}

	function plain(formatted)
	{
		return $("<div>").html(util.formatted_string_to_html(formatted || "")).text();
	}

	function top()
	{
		return stack[stack.length - 1] || null;
	}

	function observe(msg, items)
	{
		switch (msg.msg)
		{
		case "menu":
		{
			if (msg.replace) stack.pop();
			const m = { elem: $("#ui-stack .menu, #ui-stack .menu_txt").last(), tag: msg.tag,
				type: msg.type, flags: msg.flags || 0, title: msg.title && msg.title.text,
				more: msg.more || "", alt_more: msg.alt_more || "" };
			stack.push(m);
			if (pickup && pickup.menu !== m && !$.contains(document, pickup.box[0])) pickup = null;
			if (is_pickup(m)) open_pickup(m, msg, items || []);
			else dress(m);
			break;
		}
		case "update_menu":
		{
			const m = top();
			if (!m) break;
			if (msg.more !== undefined) m.more = msg.more;
			if (msg.alt_more !== undefined) m.alt_more = msg.alt_more;
			if (msg.title) m.title = msg.title.text;
			if (msg.flags !== undefined) m.flags = msg.flags;
			if (pickup && pickup.menu === m)
			{
				if (msg.total_items !== undefined && msg.total_items !== pickup.total)
				{
					pickup.rows = [];
					pickup.total = msg.total_items;
					pickup.asked = false;
				}
				render_pickup();
			}
			else
				dress(m);
			break;
		}
		case "update_menu_items":
		{
			const m = top();
			if (!m) break;
			if (pickup && pickup.menu === m) put_rows(msg.chunk_start || 0, items || []);
			else dress(m);
			break;
		}
		case "close_menu":
			stack.pop();
			forget_pickup();
			break;
		case "close_all_menus":
			stack = [];
			forget_pickup();
			break;
		case "ui-push":
			if (active && /^(describe-|formatted-scroller)/.test(msg.type || "") && msg.type !== "describe-item")
				dress_popup();
			break;
		}
	}

	function is_pickup(m)
	{
		return m.tag === "pickup"
			|| ((m.flags & MF.MULTISELECT) && /^Pick up what\?/.test(plain(m.title).trim()));
	}

	// ------------------------------------------------------------------
	// any menu

	function dress(m)
	{
		if (!active || !m || m.type === "crt" || !m.elem || !m.elem.length) return;
		if (!$.contains(document, m.elem[0])) return;
		if (is_pickup(m)) return;
		const popup = m.elem.closest(".ui-popup");
		// Cast and Inventory draw their own
		if (popup.hasClass("crawl3d-spells") || popup.hasClass("crawl3d-inv")) return;
		popup.addClass("crawl3d-menu");
		if (!m.elem.children(".hud-menu-close").length)
			m.elem.prepend("<button class='hud-close hud-menu-close' title='Close (Esc)'>✕</button>");
		m.elem.find(".menu_contents_inner > ol > li").each(function() { dress_row($(this)); });
		render_foot(m);
	}

	// A row: headers get the header look; item rows a key chip in place of
	// their " a - " prefix. The stock code rewrites a row (and its classes)
	// whenever the engine updates it, so a row without .hud-row is new.
	function dress_row(li)
	{
		if (li.hasClass("hud-row") || li.hasClass("placeholder")) return;
		const item = li.data("item");
		if (!item) return;
		li.addClass("hud-row");
		if (item.level < 2)
		{
			li.addClass("hud-menu-head");
			return;
		}
		const m = /^(\s?)(\S) ([-+#]) /.exec(li.text());
		if (!m) return;
		const prefix = wrap_prefix(li[0], m[0].length);
		if (!prefix) return;
		const chip = $("<span class='hud-menu-hk'>").css("width", `${m[0].length}ch`)
			.append($("<span class='hud-key'>").text(m[2]));
		$(prefix).before(chip);
		if (m[3] !== "-") li.addClass("hud-picked");
	}

	// Wraps the first n characters of el's text in a span (they may span
	// several text nodes; all are wrapped). -> the first wrapper, or null
	function wrap_prefix(el, n)
	{
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const nodes = [];
		for (let t = walker.nextNode(); t; t = walker.nextNode()) nodes.push(t);
		let first = null;
		for (const node of nodes)
		{
			if (n <= 0) break;
			if (!node.nodeValue.length) continue;
			if (node.nodeValue.length > n) node.splitText(n);
			n -= node.nodeValue.length;
			const span = document.createElement("span");
			span.className = "hud-menu-prefix";
			node.parentNode.insertBefore(span, node);
			span.appendChild(node);
			first = first || span;
		}
		return first;
	}

	// The engine's footer ("[?] describe selected  [!] equip|wield|wear")
	// as buttons. The stock .menu_more is hidden in the HUD: the stock code
	// rewrites it on every scroll.
	function render_foot(m)
	{
		let foot = m.elem.children(".hud-menu-foot");
		if (!foot.length) foot = $("<div class='hud-menu-foot'>").appendTo(m.elem);
		foot.empty();
		if (/Left\/Right to switch category/.test(plain(m.title)))
		{
			foot.append(button(KEY.LEFT, "◀", "Previous category", "hud-menu-prev"),
				button(KEY.RIGHT, "▶", "Next category", "hud-menu-next"));
		}
		for (const part of parse_hints(m.more || m.alt_more))
		{
			if (part.code === undefined)
				foot.append($("<span class='hud-menu-hint'>").text(part.text));
			else
				foot.append(button(part.code, part.keys, part.text));
		}
		foot.toggle(foot.children().length > 0);
	}

	function button(code, key, label, cls)
	{
		const b = $("<button class='hud-menu-btn'>").attr({ "data-key": code, title: `${label} (${key})` })
			.append($("<span class='hud-key'>").text(key), $("<span>").text(label));
		if (cls) b.addClass(cls);
		return b;
	}

	// "[.|Space] toggle selected    [Enter] accept (1 chosen)" ->
	// [{ keys, code, text }]; text with no key has no code.
	function parse_hints(more)
	{
		const out = [];
		for (const line of plain(more).split("\n"))
		{
			const lead = line.split("[")[0].trim();
			if (lead) out.push({ text: lead });
			for (const h of line.matchAll(/\[([^\]]+)\]\s*([^[]*)/g))
			{
				const keys = h[1].trim();
				const text = h[2].trim();
				if (SKIP_HINT.test(keys) || !text) continue;
				const code = key_code(keys.split("|")[0]);
				out.push(code === null ? { text: `${keys} ${text}` } : { keys: keys.split("|")[0], code: code, text: text });
			}
		}
		return out;
	}

	function key_code(name)
	{
		if (name.length === 1) return name.charCodeAt(0);
		const c = NAMED_KEYS[name.toLowerCase()];
		return c === undefined ? null : c;
	}

	// ------------------------------------------------------------------
	// describe popups and text pages: the HUD panel and a close button

	function dress_popup()
	{
		const popup = $("#ui-stack").children(".ui-popup").last();
		const content = popup.find(".ui-popup-inner").children().first();
		if (!content.length || popup.hasClass("crawl3d-desc")) return;
		popup.addClass("crawl3d-desc");
		// in the panel's corner: some have no header, some an empty one
		popup.find(".ui-popup-outer").first()
			.append("<button class='hud-close hud-desc-close hud-desc-other' title='Close (Esc)'>\u2715</button>");
	}

	// ------------------------------------------------------------------
	// pickup

	function open_pickup(m, msg, items)
	{
		close_pickup();
		if (!active || !m.elem.length) return;
		const box = $("<div id='hud_pickup'>").html(
			"<div class='hud-head'><span class='hud-title'>Pick up</span>"
			+ "<span class='hud-pickup-meta dim'></span>"
			+ "<button class='hud-close' id='hud_pickup_close' title='Close (Esc)'>✕</button></div>"
			+ "<div class='hud-pickup-body'></div>"
			+ "<div class='hud-pickup-info'></div>"
			+ "<div class='hud-pickup-foot'><span class='hud-pickup-count'></span>"
			+ "<button id='hud_pickup_all' title='Choose everything (,)'><span class='hud-key'>,</span>All</button>"
			+ "<button id='hud_pickup_none' title='Choose nothing (-)'><span class='hud-key'>-</span>None</button>"
			+ "<span class='hud-pickup-gap'></span>"
			+ "<button id='hud_pickup_cancel' title='Pick up nothing (Esc)'><span class='hud-key'>Esc</span>Cancel</button>"
			+ "<button id='hud_pickup_go'><span class='hud-key'>Enter</span><span class='hud-pickup-go-label'></span></button>"
			+ "</div>");
		pickup = { menu: m, box: box, rows: [], total: msg.total_items || 0, asked: false };
		m.elem.closest(".ui-popup").addClass("crawl3d-menu crawl3d-pickup");
		m.elem.append(box);
		bind_pickup(box);
		put_rows(msg.chunk_start || 0, items);
	}

	function close_pickup()
	{
		if (!pickup) return;
		pickup.menu.elem.closest(".ui-popup").removeClass("crawl3d-menu crawl3d-pickup");
		pickup.box.remove();
		pickup = null;
	}

	function forget_pickup()
	{
		if (pickup && !$.contains(document, pickup.box[0])) pickup = null;
	}

	function put_rows(start, items)
	{
		items.forEach(function(it, i) { pickup.rows[start + i] = it; });
		const have = pickup.rows.filter(() => true).length;
		if (have < pickup.total)
		{
			// the list is hidden, so the stock menu won't scroll to fetch
			// the rest: ask for all of it
			if (!pickup.asked)
			{
				pickup.asked = true;
				comm.send_message("menu_scroll", { first: 0, last: pickup.total - 1, hover: -1 });
			}
			return;
		}
		render_pickup();
	}

	// The rows as groups of entries: [{ title, key, entries: [{ letter, key,
	// name, picked, part, colour, tiles }] }]
	function read_rows()
	{
		const groups = [];
		let group = null;
		for (const r of pickup.rows)
		{
			if (!r) continue;
			const text = plain(r.text);
			if (r.level < 2)
			{
				const k = /\((?:select all|go to first) with (\S)\)\s*$/.exec(text);
				group = { title: text.replace(/\(.*\)\s*$/, "").trim(), key: k ? k[1] : null, entries: [] };
				groups.push(group);
				continue;
			}
			const m = /^\s?(\S) ([-+#]) (.*)$/.exec(text);
			if (!m || !r.hotkeys || !r.hotkeys.length) continue;
			if (!group)
			{
				group = { title: "", key: null, entries: [] };
				groups.push(group);
			}
			group.entries.push({ letter: m[1], key: r.hotkeys[0], name: m[3].trim(),
				picked: m[2] !== "-", part: m[2] === "#", colour: r.colour, tiles: item_tiles(r.tiles) });
		}
		return groups.filter(g => g.entries.length);
	}

	// A floor row's tiles start with what it lies on (the stairs, an altar):
	// keep the item's own.
	function item_tiles(tiles)
	{
		const T = enums.texture;
		const own = (tiles || []).filter(t => t.tex !== T.FLOOR && t.tex !== T.WALL && t.tex !== T.FEAT);
		return own.length ? own : tiles || [];
	}

	function render_pickup()
	{
		if (!pickup) return;
		const groups = read_rows();
		const entries = groups.flatMap(g => g.entries);
		if (!entries.length)
		{
			// nothing we can read: leave the stock menu showing
			close_pickup();
			return;
		}
		const box = pickup.box;
		const slots = /(\d+\s*\/\s*\d+ (?:gear )?slots)/.exec(plain(pickup.menu.title));
		box.find(".hud-pickup-meta").text(slots ? slots[1] : "");
		const body = box.find(".hud-pickup-body").empty();
		for (const g of groups)
		{
			const head = $("<div class='hud-inv-group-name'>").text(g.title || "Items");
			if (g.key && g.entries.length > 1)
			{
				head.append($("<button class='hud-pickup-group-all'>").attr({ "data-key": g.key.charCodeAt(0),
					title: `Choose all ${g.title.toLowerCase()} (${g.key})` })
					.append($("<span class='hud-key'>").text(g.key), "all"));
			}
			const cards = $("<div class='hud-cards'>");
			for (const e of g.entries) cards.append(pickup_card(e));
			body.append($("<div class='hud-pickup-group'>").append(head, cards));
		}
		const n = entries.filter(e => e.picked).length;
		box.find(".hud-pickup-count").text(n ? `${n} of ${entries.length} chosen` : `${entries.length} items here`);
		box.find("#hud_pickup_none").prop("disabled", !n);
		box.find("#hud_pickup_all").prop("disabled", n === entries.length);
		const go = box.find("#hud_pickup_go").attr("data-count", n);
		const what = n === 1 ? "1 item" : `${n} items`;
		go.find(".hud-pickup-go-label").text(n ? `Pick up ${what}` : "Pick up everything");
		go.attr("title", n ? "Pick up what's chosen (Enter)" : "Pick up everything here (, then Enter)");
		info(null);
	}

	function pickup_card(e)
	{
		const card = $("<button class='hud-card hud-pickup-card'>")
			.attr({ id: `hud_pickup_item_${e.letter}`, "data-key": e.key, "data-name": e.name, title: e.name })
			.toggleClass("picked", e.picked);
		card.append(actions.tile_canvas(r => e.tiles.forEach(t =>
			r.draw_from_texture(t.t, 0, 0, t.tex, 0, 0, t.ymax, false))));
		const text = $("<div class='hud-card-text'>").append($("<div class='hud-card-name'>").text(e.name));
		let note = "click to choose";
		if (e.picked) note = e.part ? "some chosen" : "chosen";
		if (e.colour === USELESS_COLOUR)
		{
			card.addClass("off");
			note = `useless to you · ${note}`;
		}
		text.append($("<div class='dim'>").text(note));
		card.append(text, $("<span class='hud-pickup-check'>").text(e.picked ? "✓" : ""),
			$("<span class='hud-key'>").text(e.letter));
		return card;
	}

	// The strip under the cards: what's under the pointer.
	function info(card)
	{
		const strip = pickup.box.find(".hud-pickup-info").empty();
		if (card && card.length)
		{
			strip.append($("<span class='hud-key'>").text(card.find(".hud-key").text()), " ",
				$("<span>").text(card.attr("data-name")),
				$("<span class='dim'>").text(card.hasClass("picked") ? " · click to leave it" : " · click to choose it"));
		}
		else
			strip.append($("<span class='dim'>").text(PICK_HINT));
	}

	function bind_pickup(box)
	{
		box.on("click", ".hud-pickup-card, .hud-pickup-group-all", function() {
			send_key(Number($(this).attr("data-key")));
		}).on("contextmenu", ".hud-pickup-card", function(ev) {
			ev.preventDefault();
		}).on("mouseenter", ".hud-pickup-card", function() {
			info($(this));
		}).on("mouseleave", ".hud-pickup-card", function() {
			info(null);
		}).on("click", "#hud_pickup_close, #hud_pickup_cancel", function() {
			send_key(KEY.ESC);
		}).on("click", "#hud_pickup_all", function() {
			send_key(KEY.COMMA);
		}).on("click", "#hud_pickup_none", function() {
			send_key(KEY.MINUS);
		}).on("click", "#hud_pickup_go", function() {
			if (Number($(this).attr("data-count")) === 0) send_key(KEY.COMMA);
			send_key(KEY.ENTER);
		});
	}

	return {
		init: init,
		cleanup: cleanup,
		set_active: set_active,
		pickup_open: function() { return !!pickup; }
	};
});
