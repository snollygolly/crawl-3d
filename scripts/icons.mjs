// Draws the favicon and app icons into public/: stairs going down into the dark, a torch held in
// the foreground, and eyes waiting at the bottom. Run with `npm run icons`; don't hand-edit the
// outputs. The scene is one list of layers on a 64-unit square (scripts/lib/vector.mjs), written
// out as favicon.svg and rasterised into the PNGs, so they always match.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mjs";
import { rasterise, toSvg } from "./lib/vector.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../public");

// The stairwell in one-point perspective: the near edge spans the bottom of the tile, the far
// doorway is a dark arch above the centre. t runs 0 (near) to 1 (the doorway's sill).
const NEAR = { l: -6, r: 70, y: 64 };
const FAR = { l: 23, r: 41, y: 27 };
const at = (t) => ({
	l: NEAR.l + (FAR.l - NEAR.l) * t,
	r: NEAR.r + (FAR.r - NEAR.r) * t,
	y: NEAR.y + (FAR.y - NEAR.y) * t
});
const band = (t0, t1) => {
	const a = at(t0);
	const b = at(t1);
	return { poly: [[a.l, a.y], [a.r, a.y], [b.r, b.y], [b.l, b.y]] };
};
const mix = (c0, c1, k) => `#${[0, 2, 4].map((i) => {
	const a = parseInt(c0.slice(1 + i, 3 + i), 16);
	const b = parseInt(c1.slice(1 + i, 3 + i), 16);
	return Math.round(a + (b - a) * k).toString(16).padStart(2, "0");
}).join("")}`;

// Step edges, closer together with distance. Each step is a lit tread ending in a bright nosing,
// then a shadowed drop to the next one down (going down, the risers face away from us).
const EDGES = [0, 0.27, 0.47, 0.62, 0.74, 0.84, 0.92, 1];
const steps = [];
for (let k = 0; k < EDGES.length - 1; k++) {
	const t0 = EDGES[k];
	const t1 = EDGES[k + 1];
	const nose = t0 + (t1 - t0) * 0.68;
	const fade = k / (EDGES.length - 2);
	steps.push({ shape: band(t0, nose), fill: mix("#8a6440", "#1c130d", fade) });
	steps.push({ shape: band(nose - (t1 - t0) * 0.1, nose), fill: mix("#c99a5e", "#2a1c12", fade) });
}

const DOOR = { cx: 32, top: 13 };
const FLAME = [48.5, 33];

// Wall courses: faint mortar lines along each wall, converging on the doorway.
const course = (side, y0, y1) => {
	const x0 = side < 0 ? -6 : 70;
	const x1 = side < 0 ? FAR.l : FAR.r;
	return { shape: { poly: [[x0, y0], [x1, y1], [x1, y1 + 0.5], [x0, y0 + 2]] }, fill: "#0d0907", opacity: 0.7 };
};

const LAYERS = [
	// Walls and ceiling.
	{ shape: { rect: [-64, -64, 192, 192] }, fill: "#2b1f17" },
	{ shape: { poly: [[-6, -6], [70, -6], [FAR.r, DOOR.top], [FAR.l, DOOR.top]] }, fill: "#140e0b" },
	course(-1, 20, 18), course(-1, 38, 22.5), course(1, 20, 18), course(1, 38, 22.5),
	// The stairs: a shadowed well, then the treads over it.
	{ shape: band(0, 1), fill: "#0e0907" },
	...steps,
	// The doorway at the bottom: an arch of solid dark.
	{ shape: { poly: [[FAR.l, FAR.y], [FAR.l, 19], [FAR.r, 19], [FAR.r, FAR.y]] }, fill: "#040203" },
	{ shape: { ellipse: [DOOR.cx, 19, 9, 6.5] }, fill: "#040203" },
	// Torchlight warming what's near, and the dark swallowing what isn't.
	{ shape: { rect: [-64, -64, 192, 192] }, fill: { radial: [...FLAME, 46], stops: [[0, "#ff9a3c", 0.38], [0.45, "#ff7a2a", 0.14], [1, "#ff7a2a", 0]] } },
	{ shape: { rect: [-64, -64, 192, 192] }, fill: { radial: [DOOR.cx, 22, 30], stops: [[0, "#000000", 0.75], [0.55, "#000000", 0.35], [1, "#000000", 0]] } },
	// Eyes in the dark: a big pair at the door, a smaller one just behind.
	{ shape: { ellipse: [28.6, 21, 3.4, 3.4] }, fill: { radial: [28.6, 21, 3.4], stops: [[0, "#ff2a10", 0.4], [1, "#ff2a10", 0]] } },
	{ shape: { ellipse: [35.4, 21, 3.4, 3.4] }, fill: { radial: [35.4, 21, 3.4], stops: [[0, "#ff2a10", 0.4], [1, "#ff2a10", 0]] } },
	{ shape: { ellipse: [28.6, 21, 1.9, 1.1, 12] }, fill: "#ff4a1c" },
	{ shape: { ellipse: [35.4, 21, 1.9, 1.1, -12] }, fill: "#ff4a1c" },
	{ shape: { ellipse: [28.6, 21, 0.7, 0.45] }, fill: "#ffd27a" },
	{ shape: { ellipse: [35.4, 21, 0.7, 0.45] }, fill: "#ffd27a" },
	{ shape: { ellipse: [26.4, 16, 0.95, 0.55, 8] }, fill: "#d8301a" },
	{ shape: { ellipse: [29, 16, 0.95, 0.55, -8] }, fill: "#d8301a" },
	// The torch, held up from out of frame at the bottom right: haft and wrapped head.
	{ shape: { poly: [[52, 70], [60, 70], [51.6, 40], [48.2, 40.4]] }, fill: "#4a2d16" },
	{ shape: { poly: [[56.5, 70], [60, 70], [51.6, 40], [50.4, 40.2]] }, fill: "#6e4422" },
	{ shape: { poly: [[46.4, 36.6], [52.6, 36], [52.2, 42.2], [47.6, 42.6]] }, fill: "#2e1d10" },
	{ shape: { poly: [[46.6, 38.4], [52.5, 37.8], [52.4, 38.9], [46.8, 39.5]] }, fill: "#7a5530" },
	{ shape: { poly: [[47.1, 40.6], [52.3, 40.1], [52.2, 41.1], [47.3, 41.6]] }, fill: "#7a5530" },
	// The flame: glow, then orange, yellow and a white-hot core, licking up to a point.
	{ shape: { ellipse: [...FLAME, 15, 15] }, fill: { radial: [...FLAME, 15], stops: [[0, "#ffb347", 0.55], [1, "#ff8a2a", 0]] } },
	{ shape: { ellipse: [49.4, 31.6, 5.2, 6.4] }, fill: "#f2561a" },
	{ shape: { poly: [[44.6, 30.6], [54.2, 30.6], [50.8, 19.6]] }, fill: "#f2561a" },
	{ shape: { ellipse: [49.6, 32.4, 3.6, 4.6] }, fill: "#ffa62b" },
	{ shape: { poly: [[46.2, 31.6], [53, 31.6], [50.6, 23.6]] }, fill: "#ffa62b" },
	{ shape: { ellipse: [49.8, 33.4, 2, 2.8] }, fill: "#fff1c2" },
	{ shape: { poly: [[48, 33], [51.6, 33], [50.4, 28.4]] }, fill: "#fff1c2" }
];

// `rounded`: transparent corners (tabs, install prompts). Otherwise full-bleed for platforms that
// crop, with `scale` keeping the scene inside their safe zone.
const ICONS = [
	{ file: "favicon-32.png", size: 32, rounded: true, scale: 1 },
	{ file: "icon-192.png", size: 192, rounded: true, scale: 1 },
	{ file: "icon-512.png", size: 512, rounded: true, scale: 1 },
	{ file: "icon-maskable-512.png", size: 512, rounded: false, scale: 0.78 },
	{ file: "apple-touch-icon.png", size: 180, rounded: false, scale: 0.9 }
];

writeFileSync(join(OUT, "favicon.svg"), toSvg(LAYERS));
console.log("public/favicon.svg");
for (const { file, size, rounded, scale } of ICONS) {
	writeFileSync(join(OUT, file), encodePng(size, size, rasterise(LAYERS, size, { rounded, scale }), 4));
	console.log(`public/${file} (${size} × ${size})`);
}
