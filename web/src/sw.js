// sw.js -- keeps the engine bundle (crawl.js/.wasm/.data and gamedata/) in the browser's Cache
// Storage, one cache per engine build, so it's downloaded once per build instead of every load.
//
// scripts/assemble.py fills in the build this release expects. Engine builds are immutable (a new
// engine always gets a new build id), so a cached file never needs revalidating: cache-first is
// always right. A new build means new bytes here, so the browser installs this worker again and
// activate drops the old build's cache. Requests outside the engine are left to the network.
const ENGINE_URL = "__ENGINE_URL__";
const CACHE_PREFIX = "crawl3d-engine-";
const CACHE = `${CACHE_PREFIX}__ENGINE_BUILD__`;

self.addEventListener("install", function() {
	self.skipWaiting();
});

self.addEventListener("activate", function(ev) {
	ev.waitUntil(caches.keys()
		.then(function(keys) {
			return Promise.all(keys
				.filter(function(k) { return k.startsWith(CACHE_PREFIX) && k !== CACHE; })
				.map(function(k) { return caches.delete(k); }));
		})
		.then(function() { return self.clients.claim(); }));
});

async function from_cache_or_network(ev)
{
	const request = ev.request;
	const cache = await caches.open(CACHE);
	const hit = await cache.match(request, { ignoreSearch: true });
	if (hit) return hit;
	const res = await fetch(request);
	// Only whole files: no 206s or errors. put() fails if the body is cut off, so a partial
	// download never lands in the cache.
	if (res.status === 200) {
		const copy = res.clone();
		ev.waitUntil(cache.put(request, copy)
			.catch(function(e) { console.warn("engine cache put failed", e); }));
	}
	return res;
}

self.addEventListener("fetch", function(ev) {
	const req = ev.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin || !url.pathname.startsWith(`${ENGINE_URL}/`)) return;
	ev.respondWith(from_cache_or_network(ev));
});
