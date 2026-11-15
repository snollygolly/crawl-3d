// tile_names.js -- readable names for tiles, for the HUD's tooltips and
// floor prompt.
//
// WebTiles sends tile indexes, not names, for map features and floor items.
// The generated tileinfo modules map tile names to indexes, so we invert
// them: "DNGN_STONE_STAIRS_DOWN" -> "stone staircase down", and map the
// features a player can act on to the key that does it.
define(["./tileinfo-dngn",
	"./tileinfo-main"],
function(dngn, main) {
	"use strict";

	// idx -> name, built on first use. Variants (FOO_1, FOO_2) are resolved
	// through basetile() to their base name.
	const reverse = {};
	let built = false;
	function build(mod, prefer)
	{
		for (const key in mod)
		{
			const v = mod[key];
			if (typeof v !== "number" || /_MAX$/.test(key)) continue;
			if (prefer && !prefer.test(key)) continue;
			// keep the first, plainest name for each index
			if (reverse[v] === undefined || /_\d+$/.test(reverse[v])) reverse[v] = key;
		}
	}
	function lookup(mod, idx)
	{
		if (!built)
		{
			build(dngn, /^(DNGN_|SHOP_)/);
			build(main);
			built = true;
		}
		let base = idx;
		try { base = mod.basetile(idx); } catch (e) {}
		return reverse[base] || reverse[idx] || null;
	}

	function words(s)
	{
		return s.replace(/_\d+$/, "").replace(/_+$/, "").replace(/_/g, " ").toLowerCase().trim();
	}

	const PLACES = {
		orc: "the Orcish Mines", elf: "the Elven Halls", snake: "the Snake Pit",
		spider: "the Spider Nest", slime: "the Slime Pits", hell: "Hell", lair: "the Lair",
		temple: "the Temple", tomb: "the Tomb", vaults: "the Vaults", crypt: "the Crypt",
		depths: "the Depths", swamp: "the Swamp", shoals: "the Shoals", abyss: "the Abyss",
		"wizard lab": "a wizard's laboratory", ecumenical: "an unknown god"
	};
	// "ice cave" -> "Ice Cave", with a few names spelt out properly
	function proper(s)
	{
		if (PLACES[s]) return PLACES[s];
		return s.replace(/\b[a-z]/g, c => c.toUpperCase());
	}

	// Feature on the floor of a cell (bg tile value).
	// -> { name, key, verb, hint } (key/verb only for things you act on)
	const FEATURES = [
		[/STAIRS_DOWN|ABYSSAL_STAIR/, "staircase down", ">", "go down",
			"Stand on it and press > to go down."],
		[/STAIRS_UP/, "staircase up", "<", "go up", "Stand on it and press < to go up."],
		[/ESCAPE_HATCH_DOWN/, "escape hatch down", ">", "drop down",
			"A one-way hatch to the level below (>)."],
		[/ESCAPE_HATCH_UP/, "escape hatch up", "<", "climb up", "A one-way hatch to the level above (<)."],
		[/^DNGN_ENTER_ZOT_CLOSED/, "sealed gate to Zot", null, null, "It opens once you hold three runes."],
		[/^DNGN_ENTER_(\w+?)_?$/, "entrance to $1", ">", "enter", "A branch entrance: press > on it to go in."],
		[/^DNGN_(EXIT|RETURN)_/, "way back up", "<", "leave", "Leads back the way you came (<)."],
		[/^DNGN_PORTAL_.*(GONE|EXPIRED)/, "vanished portal", null, null, "Whatever was here has closed."],
		[/^DNGN_PORTAL_(\w+?)_?$/, "portal to $1", ">", "enter", "A timed portal: press > on it to enter before it closes."],
		[/^DNGN_ALTAR_(\w+?)_?$/, "altar of $1", "p", "pray", "Pray here (p) to learn about this god or join them."],
		[/^DNGN_ABANDONED_SHOP/, "abandoned shop", null, null, "Nothing left to buy."],
		[/^(DNGN_)?SHOP/, "shop", ">", "browse", "Stand on it and press > to see what's for sale."],
		[/^DNGN_TRAP_([A-Z]+)/, "$1 trap", null, null, "A known trap. Travel and explore route around it."],
		[/^DNGN_(CLOSED|RUNED|SEALED)(_CLEAR)?_DOOR|^DNGN_V?GATE_(CLOSED|RUNED|SEALED)/, null, null, null,
			"Walk into it to open it."],
		[/^DNGN_(OPEN|BROKEN)(_CLEAR)?_DOOR|^DNGN_V?GATE_(OPEN|BROKEN)/, null, null, null,
			"Close it with C to slow down pursuers."],
		[/FOUNTAIN/, "fountain", null, null, "Decorative."],
		[/STATUE|IDOL/, "statue", null, null, "Solid; it blocks movement but not always sight."],
		[/TREE|MANGROVE/, "tree", null, null, "Blocks movement and sight."],
		[/DEEP_WATER/, "deep water", null, null, "Most creatures can't wade in. Don't try in heavy armour."],
		[/SHALLOW_WATER|WATER/, "shallow water", null, null, "Wading through it makes you easier to hit."],
		[/LAVA/, "lava", null, null, "Deadly to walk into."],
		[/STONE_ARCH/, "empty arch", null, null, "A portal used to stand here."],
		[/RUNELIGHT/, "runelight", null, null, null],
		[/ORB_DAIS/, "dais", null, null, null]
	];

	function feature(bg)
	{
		if (!bg || bg <= dngn.DNGN_UNSEEN) return null;
		const key = lookup(dngn, bg);
		if (!key) return null;
		const raw = key.replace(/^DNGN_/, "");
		for (const [re, name, k, verb, hint] of FEATURES)
		{
			const m = re.exec(key);
			if (!m) continue;
			let text = name === null ? words(raw) : name;
			for (let i = 1; i < m.length; i++)
			{
				const part = words(m[i] || "");
				// branch, portal and god names are proper nouns; trap kinds aren't
				text = text.replace(`$${i}`, /trap/.test(text) ? part : proper(part));
			}
			return { name: text.replace(/\s+/g, " ").trim(), key: k, verb: verb, hint: hint, tile: key };
		}
		if (/FLOOR|^DNGN_(UNSEEN|BLANK)|WALL|ROCK|STONE|PERMAROCK|CRYSTAL|METAL/.test(key)) return null;
		return { name: words(raw), key: null, verb: null, hint: null, tile: key };
	}

	const KINDS = {
		WPN: "weapon", ARM: "armour", THELM: "helmet", MI: "ammunition", RING: "ring", AMU: "amulet",
		WAND: "wand", BOOK: "book", POTION: "potion", POT: "potion", STAFF: "staff", SCR: "scroll",
		MISC: "misc", GEM: "gem", RUNE: "rune", TALISMAN: "talisman", UNRAND: "artefact",
		CORPSE: "corpse", FOOD: "food", GOLD: "gold", ROD: "rod", GIZMO: "gizmo"
	};

	// Item on a cell (fg tile value), when the fg is an item rather than a
	// monster. -> { name, kind }
	function item(fg)
	{
		if (!fg || fg < dngn.DNGN_MAX || fg >= main.MAIN_MAX) return null;
		const key = lookup(main, fg);
		if (!key) return null;
		const m = /^([A-Z]+)_(.*)$/.exec(key);
		const kind = m && KINDS[m[1]];
		if (!kind) return { name: words(key), kind: "item" };
		return { name: words(m[2]) || kind, kind: kind };
	}

	return { feature: feature, item: item };
});
