// sw.js
// PWA Service Worker für "Flachdach – Draufsicht & Seitenansicht"
// Version wird täglich geändert, damit alte Caches zuverlässig bereinigt werden
const VERSION = "flachdach-v4-" + new Date().toISOString().slice(0,10);
const CORE_CACHE = `core-${VERSION}`;
const STATIC_CACHE = `static-${VERSION}`;

// Passen: trage deinen HTML-Dateinamen ein, wenn nicht index.html
const START_URL = "./index.html";
const CORE_ASSETS = [
  "./",
  START_URL,
  "./manifest.webmanifest"
];
const STATIC_ASSETS = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  // Neu: maskable Icon aus Manifest cachen
  "./icons/icon-maskable.png"
];

// Sofort neue SW aktivieren, wenn möglich
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const core = await caches.open(CORE_CACHE);
    await core.addAll(CORE_ASSETS);
    const stat = await caches.open(STATIC_CACHE);
    await stat.addAll(STATIC_ASSETS);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Alte Caches wegräumen
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => ![CORE_CACHE, STATIC_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    // Optional: Navigation Preload (beschleunigt First Load, wenn Browser unterstützt)
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch(_) {}
    }
  })());
  self.clients.claim();
});

// Utility: Network-First mit Timeout (Fallback Cache)
async function networkFirst(req, cacheName, timeoutMs = 2500) {
  const cache = await caches.open(cacheName);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fresh = await fetch(req, { signal: controller.signal });
    clearTimeout(id);
    // Nur erfolgreiche Antworten cachen
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    clearTimeout(id);
    const cached = await cache.match(req);
    if (cached) return cached;
    // Letzter Fallback: irgendeine gecachte Startseite
    const start = await cache.match(START_URL);
    if (start) return start;
    throw e;
  }
}

// Utility: Stale-While-Revalidate
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => undefined);
  return cached || fetchPromise || fetch(req);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Nur GET-Anfragen behandeln
  if (request.method !== 'GET') return;

  // Nur eigene Origin cachen
  const sameOrigin = url.origin === self.location.origin;

  // Navigationsanfragen / index.html: Network-First
  const isNavigate =
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname.endsWith("/index.html");

  // Navigation Preload bevorzugen, falls aktiv
  if (sameOrigin && isNavigate) {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
      } catch (_) {}
      return networkFirst(request, CORE_CACHE);
    })());
    return;
  }

  // Statische Assets: Manifest, Icons, Images, Styles, Fonts, Skripte
  if (sameOrigin && (
      request.destination === "manifest" ||
      request.destination === "image" ||
      request.destination === "style" ||
      request.destination === "font" ||
      request.destination === "script"
    )) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Default: Netzwerk (kein spezielles Caching)
});

// Sofortige Übernahme, wenn die Seite "SKIP_WAITING" sendet
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
