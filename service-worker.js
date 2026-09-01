// service-worker.js — makes the app installable/offline-capable (PWA).
//
// Two different caching strategies are used on purpose:
//
// 1) DATA FILES (assets/data/*.js — encrypted-data.js, vehicle-lookup.js,
//    zone-config.js, handover-config.js): NETWORK-FIRST. Every time the app
//    is opened with an internet connection, the freshest Excel-derived data
//    is fetched from the server and used immediately — there is no "stale
//    data" state as long as the device is online. The cached copy is only
//    used as a fallback when there is genuinely no network connection.
//
// 2) EVERYTHING ELSE (the app shell — HTML/CSS/JS logic, images, fonts):
//    CACHE-FIRST with a background revalidation ("stale-while-revalidate").
//    This makes the app start instantly even on a slow connection. If a
//    newer version exists on the server, it's fetched in the background and
//    used on the *next* load — a fast start now matters more than always
//    having the absolute latest UI code this exact second.
//
// Bump this on any meaningful asset change so old caches get cleaned up.
const CACHE_VERSION = 'v2';
const SHELL_CACHE = 'sixt-fleet-shell-' + CACHE_VERSION;
const DATA_CACHE = 'sixt-fleet-data-' + CACHE_VERSION;

// Data files that must always try the network first.
const DATA_FILE_PATTERN = /\/assets\/data\/(encrypted-data|vehicle-lookup|zone-config|handover-config|drive-upload-config)\.js(\?.*)?$/;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {
      // Missing/renamed file in SHELL_FILES shouldn't block install entirely —
      // the rest of the shell still gets cached lazily as it's fetched.
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POST/etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only handle same-origin requests

  if (DATA_FILE_PATTERN.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  if (cached) {
    // Kick off the background refresh but don't wait on it.
    networkPromise;
    return cached;
  }
  const fresh = await networkPromise;
  return fresh || Response.error();
}
