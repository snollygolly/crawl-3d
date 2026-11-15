// The local stand-in for the game hub, behind `npm start`, `npm run preview` and the e2e suite.
// It serves dist/ (the assembled site), and serves engine-build/<build>/ at the same URL the hub
// serves the uploaded engine from, /.hub/files/engine/<build>/, so local runs load exactly what
// production does without a hub or the bucket.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const ENGINE_URL_PREFIX = "/.hub/files/engine/";

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".wasm": "application/wasm",
	".data": "application/octet-stream",
	".png": "image/png",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8"
};

export function mimeFor(file) {
	return TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

// Maps a request path to a file on disk: { file } or { error: 400 }. Doesn't check the file exists.
export function resolvePath(urlPath, { distDir, engineDir }) {
	let decoded;
	try {
		decoded = decodeURIComponent(urlPath.split("?")[0]);
	} catch {
		return { error: 400 };
	}
	if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) return { error: 400 };
	const segments = decoded.split("/").slice(1);
	if (segments.some(s => s === ".." || s === ".")) return { error: 400 };
	if (decoded.startsWith(ENGINE_URL_PREFIX)) {
		const rest = decoded.slice(ENGINE_URL_PREFIX.length);
		if (!rest || rest.endsWith("/")) return { error: 400 };
		return { file: path.join(engineDir, ...rest.split("/")) };
	}
	let rel = segments.join("/");
	if (rel === "" || rel.endsWith("/")) rel += "index.html";
	return { file: path.join(distDir, ...rel.split("/")) };
}

function send(res, status, text) {
	res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
	res.end(text);
}

export function createStaticServer({ distDir, engineDir }) {
	return http.createServer((req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed\n");
		const r = resolvePath(req.url, { distDir, engineDir });
		if (r.error) return send(res, r.error, "Bad request\n");
		fs.stat(r.file, (err, st) => {
			if (err || !st.isFile()) return send(res, 404, "Not found\n");
			res.writeHead(200, { "Content-Type": mimeFor(r.file), "Content-Length": st.size, "Cache-Control": "no-cache" });
			if (req.method === "HEAD") return res.end();
			fs.createReadStream(r.file).pipe(res);
		});
	});
}
