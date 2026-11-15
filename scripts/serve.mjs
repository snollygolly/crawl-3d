// Serves dist/ plus the local engine bundle the way the hub would (see lib/static-server.mjs).
// Port and host come from config.mjs (config.json, PORT, HOST). Run `npm run build` first;
// `npm start` does both.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadConfig} from "../config.mjs";
import {createStaticServer} from "./lib/static-server.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(ROOT, "dist");
const engineDir = path.join(ROOT, "engine-build");
const { port, host } = loadConfig();
const build = JSON.parse(fs.readFileSync(path.join(ROOT, "engine.json"), "utf8")).build;

if (!fs.existsSync(path.join(distDir, "index.html"))) {
	console.error("No dist/index.html; run npm run build first");
	process.exit(1);
}
if (!fs.existsSync(path.join(engineDir, build, "crawl.wasm"))) {
	console.warn(`warning: no engine at engine-build/${build}/; the game won't start. Build it with npm run build-engine:docker`);
}
createStaticServer({ distDir, engineDir }).listen(port, host, () => {
	console.log(`Crawl 3D on http://localhost:${port}/ (engine ${build})`);
});
