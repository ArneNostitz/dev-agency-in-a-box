/* Dev Agency service worker — makes the dashboard installable + usable offline.
   Strategy: never cache the API (/data, /events, …); network-first for the shell + code
   (so a redeploy's new UI shows immediately when online, with a cached fallback offline);
   cache-first for rarely-changing static assets (icons, manifest). */
const CACHE = "devagency-v2";
const PRECACHE = ["/web/vendor/standalone.mjs", "/web/app.js", "/web/icons/icon.svg", "/manifest.webmanifest"];
const NEVER_CACHE = ["/data", "/events", "/thread", "/pr-status", "/app-info", "/agents", "/agent", "/models", "/repos-available"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u)))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((m) => m || caches.match("/")));
}

function cacheFirst(req) {
  return caches.match(req).then((m) => m || fetch(req).then((res) => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never intercept POSTs (actions, comments)
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (NEVER_CACHE.some((p) => url.pathname === p || url.pathname.startsWith(p + "?"))) return; // live data → straight to network
  if (url.pathname.startsWith("/web/icons/") || url.pathname === "/manifest.webmanifest") {
    e.respondWith(cacheFirst(req));
    return;
  }
  // Code modules (app.js + every split ./*.js + the vendor .mjs) → network-first so a redeploy's
  // new UI shows immediately online, with a cached fallback offline.
  if (req.mode === "navigate" || (url.pathname.startsWith("/web/") && (url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")))) {
    e.respondWith(networkFirst(req));
    return;
  }
});
