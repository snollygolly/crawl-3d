"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");

const png = () => import("../scripts/lib/png.mjs");
const vector = () => import("../scripts/lib/vector.mjs");

test("encodePng writes a valid RGBA PNG whose rows decode back to the pixels", async() => {
	const { encodePng, pngSize, PNG_SIGNATURE, crc32 } = await png();
	const px = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 6]);
	const buf = encodePng(2, 2, px, 4);
	assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE));
	assert.deepStrictEqual(pngSize(buf), { width: 2, height: 2 });
	assert.strictEqual(buf[25], 6);
	assert.strictEqual(pngSize(Buffer.from("nope")), null);
	// Walk the chunks, checking each CRC, and undo the sub filter on IDAT.
	let o = 8;
	let idat = null;
	while (o < buf.length) {
		const len = buf.readUInt32BE(o);
		const type = buf.toString("ascii", o + 4, o + 8);
		assert.strictEqual(buf.readUInt32BE(o + 8 + len), crc32(buf.subarray(o + 4, o + 8 + len)));
		if (type === "IDAT") idat = zlib.inflateSync(buf.subarray(o + 8, o + 8 + len));
		o += 12 + len;
	}
	const out = [];
	for (let y = 0; y < 2; y++) {
		const row = idat.subarray(y * 9, y * 9 + 9);
		assert.strictEqual(row[0], 1);
		for (let i = 0; i < 8; i++) out.push((row[1 + i] + (i >= 4 ? out[y * 8 + i - 4] : 0)) & 0xff);
	}
	assert.deepStrictEqual(out, [...px]);
	assert.strictEqual(encodePng(1, 1, Buffer.from([1, 2, 3]))[25], 2);
});

test("parseColor reads #rrggbb and rejects anything else", async() => {
	const { parseColor } = await vector();
	assert.deepStrictEqual(parseColor("#ff8000"), [255, 128, 0]);
	assert.deepStrictEqual(parseColor("#FF8000"), [255, 128, 0]);
	assert.throws(() => parseColor("red"), /bad colour/);
});

test("inShape tests rects, polygons and rotated ellipses", async() => {
	const { inShape } = await vector();
	assert.ok(inShape(1, 1, { rect: [0, 0, 2, 2] }));
	assert.ok(!inShape(2, 1, { rect: [0, 0, 2, 2] }));
	const tri = { poly: [[0, 0], [10, 0], [0, 10]] };
	assert.ok(inShape(2, 2, tri));
	assert.ok(!inShape(8, 8, tri));
	assert.ok(!inShape(20, 1, tri));
	// A long thin ellipse turned 90°: tall, not wide.
	const e = { ellipse: [0, 0, 5, 1, 90] };
	assert.ok(inShape(0, 4, e));
	assert.ok(!inShape(4, 0, e));
	assert.ok(inShape(4, 0, { ellipse: [0, 0, 5, 1] }));
	assert.throws(() => inShape(0, 0, { circle: [0, 0, 1] }), /unknown shape/);
});

test("fillAt blends radial gradient stops, premultiplied", async() => {
	const { fillAt } = await vector();
	assert.deepStrictEqual(fillAt(0, 0, "#102030"), [16, 32, 48, 1]);
	const g = { radial: [0, 0, 10], stops: [[0.2, "#ff0000"], [0.6, "#0000ff", 0.5], [1, "#0000ff", 0]] };
	assert.deepStrictEqual(fillAt(1, 0, g), [255, 0, 0, 1]);
	const mid = fillAt(4, 0, g);
	assert.strictEqual(mid[3], 0.75);
	assert.ok(mid[0] > 127 && mid[2] > 0);
	assert.deepStrictEqual(fillAt(10, 0, g).slice(3), [0]);
	assert.deepStrictEqual(fillAt(50, 0, g), [0, 0, 255, 0]);
	const clear = { radial: [0, 0, 10], stops: [[0, "#ffffff", 0], [1, "#000000", 0]] };
	assert.deepStrictEqual(fillAt(5, 0, clear), [0, 0, 0, 0]);
});

test("rasterise composites layers, clips a rounded tile and scales about the centre", async() => {
	const { rasterise, sample } = await vector();
	const layers = [
		{ shape: { rect: [0, 0, 64, 64] }, fill: "#000000" },
		{ shape: { rect: [0, 0, 32, 64] }, fill: "#ffffff", opacity: 0.5 }
	];
	const px = rasterise(layers, 2, {}, 2);
	assert.deepStrictEqual([...px], [128, 128, 128, 255, 0, 0, 0, 255, 128, 128, 128, 255, 0, 0, 0, 255]);
	assert.strictEqual(sample(layers, 0.5, 0.5, { rounded: true }), null);
	const corner = rasterise(layers, 32, { rounded: true }, 2);
	assert.strictEqual(corner[3], 0);
	assert.strictEqual(corner[(16 * 32 + 16) * 4 + 3], 255);
	// Halved about the centre, the white half now ends at x = 32 still, but starts at 16.
	assert.deepStrictEqual(sample(layers, 10, 32, { scale: 0.5 }), [0, 0, 0]);
	assert.deepStrictEqual(sample(layers, 20, 32, { scale: 0.5 }), [127.5, 127.5, 127.5]);
});

test("toSvg writes the same layers as SVG, gradients as defs", async() => {
	const { toSvg } = await vector();
	const svg = toSvg([
		{ shape: { rect: [0, 0, 64, 64] }, fill: "#000000" },
		{ shape: { poly: [[0, 0], [1.234, 5]] }, fill: "#ffffff", opacity: 0.5 },
		{ shape: { ellipse: [1, 2, 3, 4] }, fill: { radial: [1, 2, 3], stops: [[0, "#ff0000"], [1, "#ff0000", 0]] } },
		{ shape: { ellipse: [1, 2, 3, 4, 30] }, fill: "#00ff00" }
	]);
	assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">/);
	assert.match(svg, /<clipPath id="tile"><rect width="64" height="64" rx="12"\/><\/clipPath>/);
	assert.match(svg, /<rect x="0" y="0" width="64" height="64" fill="#000000"\/>/);
	assert.match(svg, /<polygon points="0,0 1.23,5" fill="#ffffff" opacity="0.5"\/>/);
	assert.match(svg, /<radialGradient id="g2" gradientUnits="userSpaceOnUse" cx="1" cy="2" r="3"><stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#ff0000" stop-opacity="0"\/><\/radialGradient>/);
	assert.match(svg, /<ellipse cx="1" cy="2" rx="3" ry="4" fill="url\(#g2\)"\/>/);
	assert.match(svg, /<ellipse cx="1" cy="2" rx="3" ry="4" transform="rotate\(30 1 2\)" fill="#00ff00"\/>/);
});
