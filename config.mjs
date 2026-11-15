// Reads config.json (gitignored; config.example.json is the tracked template), with env vars on
// top. Only scripts/serve.mjs uses it: the port and host of the local server behind `npm start`
// and `npm run preview` (0.0.0.0 by default, so other machines on the network can reach it).
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json");

export function loadConfig({file = DEFAULT_FILE, env = process.env} = {}) {
	const fileConfig = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
	return {
		port: parseInt(env.PORT || fileConfig.port || 8765, 10),
		host: env.HOST || fileConfig.host || "0.0.0.0"
	};
}
