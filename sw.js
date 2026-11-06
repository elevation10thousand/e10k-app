// E10K service worker: keeps the app shell on the phone so it opens with no signal,
// and shows phone alerts (web push) sent by Sam's server.
// Data calls (script.google.com) are never cached here; the app keeps its own copy.
var CACHE = 'e10k-shell-v17';
var SHELL = ['./', 'index.html', 'app.css?v=11', 'app.js?v=14', 'equip.js?v=12', 'leads.js?v=14', 'manifest.webmanifest',
  'logo-word.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.png', 'badge-72.png'];

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
    return caches.match(e.request).then(function (r) { return r || caches.match('index.html'); });
  }));
});

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {title: 'E10K', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'E10K', {
    body: d.body || '', tag: d.tag || 'e10k', renotify: true,
    icon: 'icon-192.png', badge: 'badge-72.png', data: {url: d.url || './'}
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  var task = url.split('#task=')[1] || '';
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0) {
        list[i].postMessage({openTask: task});
        return list[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
