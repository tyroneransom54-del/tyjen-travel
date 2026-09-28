// Minimal PWA service worker: caches the static app shell (CSS/JS/icons) so
// the app installs cleanly as a PWA, while always going to the network first
// for page content so travelers never see stale prices or booking state.
const CACHE_NAME = "tyjen-shell-v1";
const SHELL_ASSETS = ["/css/styles.css", "/js/app.js", "/icons/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
  // All other requests (pages, search, checkout) intentionally bypass the
  // cache and go straight to the network — this is a live travel app, not
  // a static site, and prices/availability must never be served stale.
});
