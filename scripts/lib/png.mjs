// A minimal PNG encoder (8-bit RGB or RGBA, no interlace) on node:zlib, so scripts/icons.mjs needs no
// image library.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

export function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// `rgb` is width * height * channels bytes, rows top to bottom; channels is 3 (RGB) or 4 (RGBA).
export function encodePng(width, height, rgb, channels = 3) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = channels === 4 ? 6 : 2;
	const stride = width * channels;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		// Filter type 1 (sub) per row: flat-colour art compresses far better with it.
		const o = y * (stride + 1);
		raw[o] = 1;
		for (let i = 0; i < stride; i++) {
			const v = rgb[y * stride + i];
			const left = i >= channels ? rgb[y * stride + i - channels] : 0;
			raw[o + 1 + i] = (v - left) & 0xff;
		}
	}
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0))
	]);
}

// Width and height from a PNG's IHDR, or null if `buf` isn't a PNG.
export function pngSize(buf) {
	if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString("ascii", 12, 16) !== "IHDR") return null;
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
