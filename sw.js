// E10K service worker: keeps the app shell on the phone so it opens instantly, even with one bar or no signal,
// and shows phone alerts (web push) sent by Sam's server.
// Data calls (script.google.com) are never cached here; the app keeps its own copy.
// Strategy (11/06): files with ?v=N never change -> straight from the cache. The page itself (index.html / ./ and
// the Planes page) -> the saved copy if the network takes more than 2.5 s, refreshed in the background.
var CACHE = 'e10k-shell-v34';
var SHELL = ['./', 'index.html', 'app.css?v=15', 'app.js?v=25', 'equip.js?v=19', 'supplies.js?v=6', 'leads.js?v=14', 'chat.js?v=1', 'weather.js?v=1', 'mlog.js?v=1', 'manifest.webmanifest',
  'logo-word.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.png', 'badge-72.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromNetwork(req) {
  return fetch(req).then(function (r) {
    if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return r;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  var page = req.mode === 'navigate' || /\/$|index\.html$/.test(u.pathname);
  if (!page && (u.search.indexOf('v=') >= 0 || /\.(png|jpg|webmanifest)$/.test(u.pathname))) {
    // versioned / static: cache first
    e.respondWith(caches.match(req).then(function (hit) { return hit || fromNetwork(req); }));
    return;
  }
  // the page: network with a 2.5 s limit, else the saved copy (the network answer still refreshes the cache)
  e.respondWith(new Promise(function (resolve) {
    var done = false, net = fromNetwork(req);
    var fallback = function () {
      caches.match(req, {ignoreSearch: true}).then(function (hit) {
        if (done) return;
        if (hit) { done = true; resolve(hit); }
      });
    };
    var t = setTimeout(fallback, 2500);
    net.then(function (r) { clearTimeout(t); if (!done) { done = true; resolve(r); } }).catch(function () {
      clearTimeout(t);
      caches.match(req, {ignoreSearch: true}).then(function (hit) {
        if (done) return; done = true;
        resolve(hit || caches.match('index.html').then(function (x) { return x || new Response('Offline', {status: 503}); }));
      });
    });
    e.waitUntil(net.catch(function () {}));
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
  var task = url.split('#task=')[1] || (/#briefing/.test(url) ? 'BRIEFING' : '');
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
