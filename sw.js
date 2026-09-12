// Bump this version string every time you change any file in this folder.
// It forces old caches to be discarded so updates aren't stuck stale on phones.
const CACHE_NAME = 'exp-tracker-shell-v6';
const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './config.js',
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

// NETWORK-FIRST for the app shell: always try to fetch the latest file first
// (so edits to config.js / app.js / index.html show up immediately next time
// you're online), and only fall back to the cached copy when there's no
// connection. Cross-origin requests (the Apps Script API calls) are left
// alone entirely -- the page's own fetch()/localStorage queue logic handles those.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isShellRequest = url.origin === self.location.origin;
  if (!isShellRequest) return;

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
