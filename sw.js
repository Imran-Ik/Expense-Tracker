const CACHE_NAME = 'exp-tracker-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Cache-first for the app shell, network-first (with cache fallback) for everything else
// (e.g. the backend API calls are POST/GET to a different origin and are left to the page's
// own fetch() + localStorage queue logic — the service worker does not intercept those writes).
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isShellRequest = url.origin === self.location.origin;

  if (!isShellRequest) return; // let cross-origin API calls pass straight through

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      const networkFetch = fetch(event.request)
        .then(function (response) {
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, response.clone());
          });
          return response;
        })
        .catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
