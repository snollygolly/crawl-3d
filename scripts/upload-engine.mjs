// Uploads engine-build/<build>/ (from scripts/build-engine.sh) to the hub's bucket at
// games/<slug>/files/engine/<build>/, where the hub serves it as /.hub/files/engine/<build>/.
// Builds are immutable: bump "build" in engine.json for every new engine, upload it, then commit
// engine.json so the next publish loads the new one.
//
//   npm run upload-engine [-- --dry-run] [--force] [--local]
//
// Bucket credentials come from the env, else ~/.env.hub (or $HUB_ENV_FILE), the same file spa-hub's
// and evil-mouse-studios' scripts read. --local (or HUB_STORAGE_DRIVER=fs) copies into a local hub's
// bucket folder instead: $HUB_FS_ROOT, default ../spa-hub/.dev-bucket.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {parseArgs} from "node:util";
import {fileURLToPath} from "node:url";
import {engineKeyPrefix, listBundle, MANIFEST} from "./lib/engine-bundle.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const CONCURRENCY = 4;

const { values } = parseArgs({
	options: {
		"dry-run": { type: "boolean", default: false },
		force: { type: "boolean", default: false },
		local: { type: "boolean", default: false }
	}
});

const envFile = process.env.HUB_ENV_FILE || path.join(os.homedir(), ".env.hub");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const build = readJson("engine.json").build;
const slug = readJson("evilmouse.json").hub.slug;
const prefix = engineKeyPrefix(slug, build);
const files = listBundle(path.join(ROOT, "engine-build", build));
const total = files.reduce((n, f) => n + f.size, 0);
const local = values.local || process.env.HUB_STORAGE_DRIVER === "fs";

function fsStorage() {
	const root = path.resolve(ROOT, process.env.HUB_FS_ROOT || "../spa-hub/.dev-bucket");
	const at = key => path.join(root, ...key.split("/"));
	return {
		where: root,
		exists: key => Promise.resolve(fs.existsSync(at(key))),
		put: async(key, f) => {
			await fs.promises.mkdir(path.dirname(at(key)), { recursive: true });
			await fs.promises.copyFile(f.abs, at(key));
		}
	};
}

async function s3Storage() {
	const env = process.env;
	for (const k of ["AWS_S3_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) {
		if (!env[k]) throw new Error(`${k} is not set (put the hub's bucket settings in ${envFile})`);
	}
	const sdk = await import("@aws-sdk/client-s3");
	const client = new sdk.S3Client({
		endpoint: env.AWS_ENDPOINT_URL || "https://storage.railway.app",
		region: env.AWS_DEFAULT_REGION || "auto",
		credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
	});
	const Bucket = env.AWS_S3_BUCKET_NAME;
	return {
		where: `s3://${Bucket}`,
		exists: async Key => {
			try {
				await client.send(new sdk.HeadObjectCommand({ Bucket, Key }));
				return true;
			} catch (err) {
				if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return false;
				throw err;
			}
		},
		put: (Key, f) => client.send(new sdk.PutObjectCommand({
			Bucket, Key,
			Body: fs.createReadStream(f.abs),
			ContentLength: f.size,
			ContentType: f.type,
			CacheControl: CACHE_CONTROL
		}))
	};
}

async function main() {
	const storage = local ? fsStorage() : await s3Storage();
	const mb = (total / 1e6).toFixed(1);
	console.log(`engine ${build}: ${files.length} files, ${mb} MB -> ${storage.where}/${prefix}`);
	if (await storage.exists(prefix + MANIFEST) && !values.force) {
		throw new Error(`${prefix} already exists. Bump "build" in engine.json (or pass --force)`);
	}
	if (values["dry-run"]) {
		for (const f of files) console.log(`  ${f.rel} (${f.size} bytes, ${f.type})`);
		console.log("dry run: nothing uploaded");
		return;
	}
	const body = files.filter(f => f.rel !== MANIFEST);
	const queue = [...body];
	let done = 0;
	const worker = async() => {
		while (queue.length > 0) {
			const f = queue.shift();
			await storage.put(prefix + f.rel, f);
			done += 1;
			if (f.size > 1e6 || done % 25 === 0) console.log(`  ${done}/${body.length} ${f.rel}`);
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	await storage.put(prefix + MANIFEST, files.find(f => f.rel === MANIFEST));
	console.log(`uploaded engine ${build}; the game loads it from /.hub/files/engine/${build}/`);
}

main().catch(err => {
	console.error(`upload failed: ${err.message}`);
	process.exit(1);
});
