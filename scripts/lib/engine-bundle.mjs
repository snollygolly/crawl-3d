// What `npm run upload-engine` sends where. The hub serves games/<slug>/files/<path> at
// /.hub/files/<path> on the game's subdomain (spa-hub src/files.js), so the engine for build B
// lands at games/<slug>/files/engine/B/ and the client loads it from /.hub/files/engine/B/
// (ENGINE_URL in scripts/assemble.py).
import fs from "node:fs";
import path from "node:path";
import {mimeFor} from "./static-server.mjs";

export const MANIFEST = "manifest.json";

export function engineKeyPrefix(slug, build) {
	if (!/^[a-z0-9]+$/.test(slug)) throw new Error(`bad hub slug "${slug}"`);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(build)) throw new Error(`bad engine build id "${build}"`);
	return `games/${slug}/files/engine/${build}/`;
}

// Every file in the bundle as { rel, abs, size, type }, sorted, with manifest.json last: the
// manifest marks a complete upload, so it only goes up once everything it lists is there.
export function listBundle(dir) {
	if (!fs.existsSync(path.join(dir, MANIFEST))) {
		throw new Error(`no engine bundle at ${dir} (run npm run build-engine:docker)`);
	}
	const out = [];
	const walk = sub => {
		for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
			const rel = sub ? `${sub}/${e.name}` : e.name;
			if (e.isDirectory()) walk(rel);
			else if (e.isFile()) out.push(rel);
		}
	};
	walk("");
	out.sort((a, b) => (a === MANIFEST) - (b === MANIFEST) || a.localeCompare(b));
	return out.map(rel => {
		const abs = path.join(dir, ...rel.split("/"));
		return { rel, abs, size: fs.statSync(abs).size, type: mimeFor(rel) };
	});
}
