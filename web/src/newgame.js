// newgame.js -- the HUD look for character creation (species, background,
// weapon) and the "play this combination?" prompt.
//
// The engine's choice screens are the stock "newgame-choice" popup: a grid of
// buttons placed by inline grid-row / grid-column, a pane of descriptions and
// a grid of extra choices (random, recommended, aptitudes, help...). This
// dresses that popup rather than redrawing it, so the stock code keeps the
// work: clicking a [data-hotkey] button sends its key, keys go to the engine,
// and the engine's cursor moves the selection (newgame_choice_update).
//   - choices become cards with a key chip in place of their "a - " prefix,
//     sorted by column so a phone can show them as one list;
//   - the column labels become section heads;
//   - the description pane gets the selected choice's name, and on touch a
//     Choose button: there's no hover on a phone, so a first tap selects a
//     card and shows its description, and a second tap (or Choose) picks it;
//   - the extra choices become footer buttons with key chips.
//
// Character creation comes before the game view, so this isn't tied to the
// 3D HUD being on: everyone gets it. Its rules sit under .crawl3d-newgame.
//
// Messages come from actions.js's comm tap, as "crawl3d_comm" events, after
// the stock handler has drawn the popup.
define(["jquery", "comm", "./ui", "./menus"], function($, comm, ui, menus) {
	"use strict";

	const KEY = { ESC: 27 };
	// how long after a touchstart a click counts as a tap
	const TAP_MS = 1000;
	// the engine's colours for a choice it recommends / one it doesn't
	const REC_CLASS = "hlc-2";
	const OFF_CLASS = "fg8";
	// n rolls another random character; q quits to the title
	const COMBO_KEYS = [["Y", "Play it"], ["n", "Roll again"], ["q", "Quit"]];

	let bound = false;
	let observer = null;
	// the last touchstart: when, and whether its card was already selected
	let touch = { at: 0, selected: false };

	function init()
	{
		cleanup();
		$(document).on("crawl3d_comm.newgame", function(ev, msg) {
			if (msg.msg !== "ui-push") return;
			try
			{
				if (msg.type === "newgame-choice") dress(top_popup());
				else if (msg.type === "newgame-random-combo") dress_combo(top_popup());
			}
			catch (e) { console.warn("newgame:", e); }
		});
		document.addEventListener("touchstart", on_touchstart, true);
		document.addEventListener("click", on_click, true);
		$(document).on("click.newgame", "#ui-stack .ng-close", function() {
			send_key(KEY.ESC);
		}).on("click.newgame", "#hud_newgame_choose", function() {
			const btn = $(this).closest(".newgame-choice").find(".main-items .button.selected");
			if (btn.length) send_key(ui.utf8_from_key_value(btn.attr("data-hotkey")));
		}).on("click.newgame", "#ui-stack .ng-combo-btn", function() {
			send_key(Number($(this).attr("data-key")));
		}).on("mousedown.newgame", "#ui-stack .ng-close, #hud_newgame_choose, #ui-stack .ng-combo-btn", function(ev) {
			// keep focus off the button: Enter would click it again
			ev.preventDefault();
		});
		bound = true;
	}

	function cleanup()
	{
		if (!bound) return;
		$(document).off(".newgame");
		document.removeEventListener("touchstart", on_touchstart, true);
		document.removeEventListener("click", on_click, true);
		if (observer) observer.disconnect();
		observer = null;
		bound = false;
	}

	function top_popup()
	{
		return $("#ui-stack").children(".ui-popup").last();
	}

	function send_key(code)
	{
		if (code) comm.send_message("key", { keycode: code });
	}

	// ------------------------------------------------------------------
	// the choice screens

	function dress(popup)
	{
		const box = popup.find(".newgame-choice");
		if (!box.length || popup.hasClass("crawl3d-newgame")) return;
		popup.addClass("crawl3d-newgame");
		popup.find(".ui-popup-outer").first()
			.append("<button class='hud-close ng-close' title='Back (Esc)'>✕</button>");
		dress_header(box);

		const main = box.find(".main-items");
		sort_by_column(main);
		main.children(".label").addClass("ng-head");
		main.children(".button").each(function() { dress_card($(this)); });
		const cols = Math.max(1, ...main.children().map(function() { return col_of(this); }).get());
		main[0].style.setProperty("--ng-cols", cols);
		main.toggleClass("ng-single", cols === 1);

		box.find(".sub-items > .button").each(function() { dress_extra($(this)); });

		const info = $("<div class='ng-info'><div class='ng-info-head'><span class='ng-info-name'></span>"
			+ "<button id='hud_newgame_choose' class='ng-choose'></button></div></div>");
		box.find(".descriptions").before(info);
		info.append(box.find(".descriptions"));

		if (observer) observer.disconnect();
		observer = new MutationObserver(function() { show_info(box); });
		box.find(".main-items, .sub-items").each(function() {
			observer.observe(this, { subtree: true, attributes: true, attributeFilter: ["class"] });
		});
		show_info(box);
	}

	// The species and background screens have one header ("Welcome, Cap."
	// then "Please select your species."); the weapon screen a header with
	// the doll and a second one with the question.
	function dress_header(box)
	{
		const heads = box.children(".header");
		heads.first().addClass("ng-title");
		heads.slice(1).addClass("ng-prompt");
		heads.last().addClass("ng-head-last");
		const spans = heads.first().children("span");
		if (spans.length > 1) spans.slice(1).addClass("ng-ask");
	}

	function col_of(el)
	{
		return parseInt(el.style.gridColumnStart, 10) || 1;
	}

	function row_of(el)
	{
		return parseInt(el.style.gridRowStart, 10) || 1;
	}

	// Column by column, so with the inline placement ignored (phones) the
	// list reads like the columns do: each head, then its choices.
	function sort_by_column(grid)
	{
		const kids = grid.children().get();
		kids.sort((a, b) => col_of(a) - col_of(b) || row_of(a) - row_of(b));
		grid.append(kids);
	}

	// "a - Gnoll" -> a key chip and "Gnoll". The weapon screen adds a second
	// span, "(+2 apt)", which becomes the card's note.
	function dress_card(btn)
	{
		btn.addClass("ng-card");
		const spans = btn.children("span");
		const first = spans.first();
		const name = strip_key(first);
		const text = $("<div class='ng-card-text'>");
		const canvas = btn.children("canvas").last();
		if (canvas.length) text.insertAfter(canvas);
		else text.prependTo(btn);
		text.append(first.addClass("ng-card-name"));
		const notes = spans.slice(1).addClass("ng-card-note");
		if (btn.hasClass(REC_CLASS)) btn.addClass("ng-rec");
		if (first.hasClass(OFF_CLASS)) btn.addClass("ng-off");
		if (notes.length) text.append(notes);
		else if (btn.hasClass("ng-rec")) text.append("<span class='ng-card-note'>Recommended</span>");
		btn.attr({ "data-name": name, title: name });
	}

	// "+ - Recommended species", "Space - Pick background first"
	function dress_extra(btn)
	{
		btn.addClass("ng-extra");
		const name = strip_key(btn.children("span").first());
		// beside the label rather than in it, so a long label wraps clear of it
		btn.prepend(btn.find(".ng-key"));
		btn.attr({ "data-name": name, title: name });
	}

	// Hides the "a - " prefix of the label span (wrapped, so the text stays
	// whole) and puts a key chip before it. -> the name without the prefix
	function strip_key(span)
	{
		const text = span.text();
		const m = /^\s*(\S+) - /.exec(text);
		if (!m) return text.trim();
		const prefix = menus.wrap_prefix(span[0], m[0].length);
		if (prefix) $(prefix).before($("<span class='hud-key ng-key'>").text(m[1]));
		return text.slice(m[0].length).trim();
	}

	// The info strip's title follows the selection, whoever moved it (the
	// mouse, a tap, or the engine's cursor).
	function show_info(box)
	{
		const sel = box.find(".button.selected").first();
		box.find(".ng-info-name").text(sel.attr("data-name") || "");
		const choose = box.find("#hud_newgame_choose");
		const card = sel.hasClass("ng-card");
		// shown on touch only (CSS): a mouse picks with one click
		choose.toggleClass("on", card).text(card ? `Choose ${sel.attr("data-name")}` : "");
	}

	// ------------------------------------------------------------------
	// touch: the first tap on a card selects it, the next picks it

	function card_of(target)
	{
		const btn = $(target).closest(".crawl3d-newgame .main-items > .button");
		return btn.length ? btn : null;
	}

	function on_touchstart(ev)
	{
		const btn = card_of(ev.target);
		touch = { at: Date.now(), selected: !!(btn && btn.hasClass("selected")) };
		if (btn) btn.closest(".crawl3d-newgame").addClass("ng-touch");
	}

	// Runs before the stock [data-hotkey] click handler (it's delegated, in
	// the bubble phase). A tap's emulated mouseenter has already selected the
	// card by now, so whether it was selected comes from the touchstart.
	function on_click(ev)
	{
		const btn = card_of(ev.target);
		if (!btn || Date.now() - touch.at > TAP_MS || touch.selected) return;
		ev.preventDefault();
		ev.stopPropagation();
		preview(btn);
	}

	// What the stock focus_button does: select it, show its description, and
	// move the engine's cursor there.
	function preview(btn)
	{
		const box = btn.closest(".newgame-choice");
		box.find(".button.selected").removeClass("selected");
		btn.addClass("selected");
		const panes = box.find(".descriptions").children(".pane").removeClass("current");
		panes.eq(Number(btn.attr("data-description-index"))).addClass("current");
		comm.send_message("outer_menu_focus", {
			hotkey: ui.utf8_from_key_value(btn.attr("data-hotkey")),
			menu_id: btn.closest("[menu_id]").attr("menu_id")
		});
		touch.selected = true;
		show_info(box);
	}

	// ------------------------------------------------------------------
	// "Do you want to play this combination? [Y/n/q]"

	function dress_combo(popup)
	{
		if (!popup.length || popup.hasClass("crawl3d-newgame")) return;
		popup.addClass("crawl3d-newgame crawl3d-ng-combo");
		const body = popup.find(".body").first();
		body.addClass("ng-combo-ask").text("Do you want to play this combination?");
		const foot = $("<div class='ng-combo-foot'>").insertAfter(body);
		for (const [key, label] of COMBO_KEYS)
		{
			foot.append($("<button class='ng-combo-btn'>").attr({ "data-key": key.charCodeAt(0), title: `${label} (${key})` })
				.append($("<span class='hud-key'>").text(key), $("<span>").text(label)));
		}
	}

	return { init: init, cleanup: cleanup };
});
