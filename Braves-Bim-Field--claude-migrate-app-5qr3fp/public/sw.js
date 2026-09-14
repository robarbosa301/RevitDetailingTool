// Precache list + cache name are injected at build time (see vite.config.js's
// braves-pwa-shell plugin), which overwrites this file in dist/ with the
// real asset list for that build. In dev (npm run dev) these placeholders
// stay literal, so the SW just no-ops instead of caching garbage.
const CACHE_NAME = "__CACHE_NAME__";
const PRECACHE_URLS = "__PRECACHE_URLS__";
const isBuilt = Array.isArray(PRECACHE_URLS);

self.addEventListener("install", (event) => {
  if (isBuilt) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
  }
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith("braves-shell-") && n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (!isBuilt) return;
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // Network-first so an online app always gets the latest index.html;
    // falls back to the precached shell so the app still opens with zero
    // connectivity (airplane mode, no signal in the field). "reload" forces
    // this past the browser's own HTTP cache — without it a plain fetch()
    // can be satisfied straight from disk cache and never actually reach
    // the network, which would silently serve an old build forever.
    event.respondWith(
      fetch(req, { cache: "reload" }).catch(() => caches.match(req).then((cached) => cached || caches.match(`${self.registration.scope}index.html`)))
    );
    return;
  }

  // Static assets are content-hashed by Vite — safe to serve straight from
  // cache and only hit the network for anything not precached yet.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
