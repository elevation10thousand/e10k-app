// E10K service worker: keeps the app shell on the phone so it opens with no signal.
// Data calls (script.google.com) are never cached here; the app keeps its own copy.
var CACHE = 'e10k-shell-v3';
var SHELL = ['./', 'index.html', 'app.css?v=3', 'app.js?v=3', 'manifest.webmanifest',
  'logo-word.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network first (so updates show up), fall back to the saved copy offline
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () {
    return caches.match(e.request, {ignoreSearch: false}).then(function (r) { return r || caches.match('index.html'); });
  }));
});
