// Offline-first service worker for the HVAC benchmarking PWA.
// - App shell (HTML/CSS/JS/icons): cache-first, so the whole UI works with
//   zero network, which is the point of a tablet used mid-teardown.
// - Navigations: network-first with a cached-shell fallback, so a refresh
//   while offline still lands on the app instead of a browser error page.
// - API calls (/tools/, /projects/, /evidence/, /health): never cached --
//   the app's own IndexedDB + sync queue (see js/sync.js) is the offline
//   story for data, not the HTTP cache.

const CACHE_VERSION = "v1";
const CACHE_NAME = `hvac-bench-shell-${CACHE_VERSION}`;

const SHELL_FILES = [
  "/app/",
  "/app/index.html",
  "/app/manifest.webmanifest",
  "/app/css/styles.css",
  "/app/js/app.js",
  "/app/js/db.js",
  "/app/js/api.js",
  "/app/js/sync.js",
  "/app/js/units.js",
  "/app/js/checklist-library.js",
  "/app/js/ids.js",
  "/app/js/toast.js",
  "/app/js/state.js",
  "/app/js/ui.js",
  "/app/js/router.js",
  "/app/js/gates.js",
  "/app/js/evidence-capture.js",
  "/app/js/hvac-coverage.js",
  "/app/js/views/projects.js",
  "/app/js/views/checklist.js",
  "/app/js/views/components.js",
  "/app/js/views/evidence.js",
  "/app/js/views/measurements.js",
  "/app/js/views/validation.js",
  "/app/js/views/bom.js",
  "/app/js/views/compare.js",
  "/app/js/views/kpis.js",
  "/app/js/views/report.js",
  "/app/icons/icon-192.png",
  "/app/icons/icon-512.png",
  "/app/icons/icon-192-maskable.png",
  "/app/icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/tools/") || url.pathname.startsWith("/projects/") ||
    url.pathname.startsWith("/evidence/") || url.pathname === "/health";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // API writes go straight to the network; never intercepted.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isApiRequest(url)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/app/index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
