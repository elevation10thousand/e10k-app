// E10K service worker: keeps the app shell on the phone so it opens instantly, even with one bar or no signal,
// and shows phone alerts (web push) sent by Sam's server.
// Data calls (script.google.com) are never cached here; the app keeps its own copy.
// Strategy (11/06): files with ?v=N never change -> straight from the cache. The page itself (index.html / ./ and
// the Planes page) -> the saved copy if the network takes more than 2.5 s, refreshed in the background.
var CACHE = 'e10k-shell-v71';
var SHELL = ['./', 'index.html', 'app.css?v=29', 'app.js?v=46', 'equip.js?v=23', 'supplies.js?v=10', 'leads.js?v=17', 'fuel.js?v=2', 'chat.js?v=2', 'ask.js?v=2', 'invoice.js?v=1', 'finance.js?v=8', 'jobfin.js?v=4', 'bidpdf.js?v=1', 'bids.js?v=1', 'payroll.js?v=2', 'logo-invoice.png', 'mic.js?v=2', 'weather.js?v=5', 'mlog.js?v=1', 'reminders.js?v=2', 'jobs.js?v=1', 'manifest.webmanifest',
  'logo-word.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.png', 'badge-72.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== AUTH; }).map(function (k) { return caches.delete(k); }));
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

// Reminders (11/22): the page hands over {api, token} so the alert's Done / Snooze buttons work without opening the app.
var AUTH = 'e10k-auth';
self.addEventListener('message', function (e) {
  if (!e.data || !e.data.auth || !e.data.auth.api || !e.data.auth.token) return;
  e.waitUntil(caches.open(AUTH).then(function (c) { return c.put('auth', new Response(JSON.stringify(e.data.auth))); }));
});
function remAct(id, what) {
  return caches.open(AUTH).then(function (c) { return c.match('auth'); }).then(function (r) { return r ? r.json() : null; }).then(function (a) {
    if (!a) throw new Error('no_auth');
    return fetch(a.api, {method: 'POST', redirect: 'follow', body: JSON.stringify({token: a.token, action: 'rem.act', fields: {id: id, do: what, mins: 60}, rid: 'sw-' + id + '-' + what + '-' + Date.now()})})
      .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error((j && j.error) || 'failed'); return j; });
  });
}

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {title: 'E10K', body: e.data ? e.data.text() : ''}; }
  var o = {body: d.body || '', tag: d.tag || 'e10k', renotify: true,
    icon: 'icon-192.png', badge: 'badge-72.png', data: {url: d.url || './', rem: d.rem || ''}};
  if (d.actions) o.actions = d.actions.slice(0, 2);
  if (d.sticky) { o.requireInteraction = true; o.vibrate = [300, 150, 300, 150, 300]; }
  e.waitUntil(self.registration.showNotification(d.title || 'E10K', o));
});

self.addEventListener('notificationclose', function (e) {   // swiped away: no second ping
  var rem = e.notification.data && e.notification.data.rem;
  if (rem) e.waitUntil(remAct(rem, 'seen').catch(function () {}));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var data = e.notification.data || {}, rem = data.rem;
  if (rem && (e.action === 'done' || e.action === 'snooze')) {
    var base = (data.url || './').split('#')[0];
    e.waitUntil(remAct(rem, e.action).catch(function () { return self.clients.openWindow(base + '#remdo=' + rem + ':' + e.action); }));
    return;
  }
  if (rem) e.waitUntil(remAct(rem, 'seen').catch(function () {}));
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
