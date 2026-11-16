// A tiny vector scene on a 64-unit square, drawn two ways from the same layers: as SVG text
// (public/favicon.svg) and rasterised to RGBA with supersampling (the PNG icons), so the two can't
// drift apart. scripts/icons.mjs holds the scene itself.
//
// A layer is { shape, fill, opacity? }:
//   shape: { rect: [x, y, w, h] } | { poly: [[x, y], ...] } | { ellipse: [cx, cy, rx, ry, deg?] }
//   fill:  "#rrggbb" | { radial: [cx, cy, r], stops: [[offset, "#rrggbb", alpha?], ...] }

const parsed = new Map();

export function parseColor(hex) {
	if (parsed.has(hex)) return parsed.get(hex);
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) throw new Error(`bad colour "${hex}"`);
	const n = parseInt(m[1], 16);
	const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	parsed.set(hex, rgb);
	return rgb;
}

function inPoly(x, y, pts) {
	let inside = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i];
		const [xj, yj] = pts[j];
		if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function inEllipse(x, y, [cx, cy, rx, ry, deg = 0]) {
	const a = -deg * Math.PI / 180;
	const dx = x - cx;
	const dy = y - cy;
	const u = dx * Math.cos(a) - dy * Math.sin(a);
	const v = dx * Math.sin(a) + dy * Math.cos(a);
	return (u / rx) ** 2 + (v / ry) ** 2 <= 1;
}

// [x0, y0, x1, y1] around a shape, cached, so most layers are skipped without a full test.
const boxes = new WeakMap();
function box(shape) {
	let b = boxes.get(shape);
	if (b) return b;
	if (shape.rect) b = [shape.rect[0], shape.rect[1], shape.rect[0] + shape.rect[2], shape.rect[1] + shape.rect[3]];
	else if (shape.poly) {
		const xs = shape.poly.map((p) => p[0]);
		const ys = shape.poly.map((p) => p[1]);
		b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
	} else {
		const [cx, cy, rx, ry] = shape.ellipse;
		const r = Math.max(rx, ry);
		b = [cx - r, cy - r, cx + r, cy + r];
	}
	boxes.set(shape, b);
	return b;
}

export function inShape(x, y, shape) {
	if (shape.rect || shape.poly || shape.ellipse) {
		const b = box(shape);
		if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
	}
	if (shape.rect) {
		const [rx, ry, w, h] = shape.rect;
		return x >= rx && x < rx + w && y >= ry && y < ry + h;
	}
	if (shape.poly) return inPoly(x, y, shape.poly);
	if (shape.ellipse) return inEllipse(x, y, shape.ellipse);
	throw new Error(`unknown shape ${JSON.stringify(shape)}`);
}

// [r, g, b, a] of a fill at a point, a in 0..1. Gradients blend premultiplied, as browsers do.
export function fillAt(x, y, fill) {
	if (typeof fill === "string") return [...parseColor(fill), 1];
	const [cx, cy, r] = fill.radial;
	const t = Math.hypot(x - cx, y - cy) / r;
	const stops = fill.stops;
	const stop = (s) => [...parseColor(s[1]), s[2] ?? 1];
	if (t <= stops[0][0]) return stop(stops[0]);
	for (let i = 1; i < stops.length; i++) {
		if (t > stops[i][0]) continue;
		const a = stop(stops[i - 1]);
		const b = stop(stops[i]);
		const k = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
		const alpha = a[3] + (b[3] - a[3]) * k;
		if (alpha === 0) return [0, 0, 0, 0];
		const c = [0, 1, 2].map((ch) => (a[ch] * a[3] + (b[ch] * b[3] - a[ch] * a[3]) * k) / alpha);
		return [...c, alpha];
	}
	return stop(stops[stops.length - 1]);
}

function inRoundedSquare(x, y, r) {
	const cx = Math.min(Math.max(x, r), 64 - r);
	const cy = Math.min(Math.max(y, r), 64 - r);
	return x >= 0 && x <= 64 && y >= 0 && y <= 64 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// The colour of the scene at a point of the 64-unit tile, or null outside a rounded tile.
// `scale` shrinks the scene about the centre, for platforms that crop (maskable icons).
export function sample(layers, x, y, { rounded = false, radius = 12, scale = 1 } = {}) {
	if (rounded && !inRoundedSquare(x, y, radius)) return null;
	const u = 32 + (x - 32) / scale;
	const v = 32 + (y - 32) / scale;
	let r = 0;
	let g = 0;
	let b = 0;
	for (const layer of layers) {
		if (!inShape(u, v, layer.shape)) continue;
		const solid = typeof layer.fill === "string";
		const f = solid ? parseColor(layer.fill) : fillAt(u, v, layer.fill);
		const a = (solid ? 1 : f[3]) * (layer.opacity ?? 1);
		r += (f[0] - r) * a;
		g += (f[1] - g) * a;
		b += (f[2] - b) * a;
	}
	return [r, g, b];
}

// RGBA bytes, size × size, with ss × ss supersampling.
export function rasterise(layers, size, opts = {}, ss = 4) {
	const out = Buffer.alloc(size * size * 4);
	const step = 64 / size / ss;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const sum = [0, 0, 0];
			let n = 0;
			for (let sy = 0; sy < ss; sy++) {
				for (let sx = 0; sx < ss; sx++) {
					const c = sample(layers, (px * ss + sx + 0.5) * step, (py * ss + sy + 0.5) * step, opts);
					if (!c) continue;
					sum[0] += c[0];
					sum[1] += c[1];
					sum[2] += c[2];
					n++;
				}
			}
			const o = (py * size + px) * 4;
			if (n) for (let i = 0; i < 3; i++) out[o + i] = Math.round(sum[i] / n);
			out[o + 3] = Math.round(n / (ss * ss) * 255);
		}
	}
	return out;
}

const num = (v) => String(Math.round(v * 100) / 100);

// The same scene as an SVG document (64 × 64 viewBox), clipped to a rounded tile.
export function toSvg(layers, { radius = 12 } = {}) {
	const defs = [`\t\t<clipPath id="tile"><rect width="64" height="64" rx="${radius}"/></clipPath>`];
	const body = [];
	layers.forEach((layer, i) => {
		let fill = layer.fill;
		if (typeof fill !== "string") {
			const [cx, cy, r] = fill.radial;
			const stops = fill.stops.map(([o, col, a = 1]) =>
				`<stop offset="${num(o)}" stop-color="${col}"${a === 1 ? "" : ` stop-opacity="${num(a)}"`}/>`).join("");
			defs.push(`\t\t<radialGradient id="g${i}" gradientUnits="userSpaceOnUse" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}">${stops}</radialGradient>`);
			fill = `url(#g${i})`;
		}
		const op = layer.opacity === undefined ? "" : ` opacity="${num(layer.opacity)}"`;
		const s = layer.shape;
		if (s.rect) {
			const [x, y, w, h] = s.rect.map(num);
			body.push(`\t\t<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${op}/>`);
		} else if (s.poly) {
			body.push(`\t\t<polygon points="${s.poly.map((p) => p.map(num).join(",")).join(" ")}" fill="${fill}"${op}/>`);
		} else {
			const [cx, cy, rx, ry, deg = 0] = s.ellipse;
			const rot = deg ? ` transform="rotate(${num(deg)} ${num(cx)} ${num(cy)})"` : "";
			body.push(`\t\t<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}"${rot} fill="${fill}"${op}/>`);
		}
	});
	return [
		"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">",
		"\t<defs>", ...defs, "\t</defs>",
		"\t<g clip-path=\"url(#tile)\">", ...body, "\t</g>",
		"</svg>", ""
	].join("\n");
}
