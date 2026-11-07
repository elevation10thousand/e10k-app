/* E10K app front end. Talks to the Apps Script API; data lives in the Thomas Hub.
 * Sign-in: private link https://elevation10thousand.github.io/e10k-app/#t=TOKEN
 * Offline: last data is cached; changes are queued and sent when signal returns. */
(function () {
  'use strict';
  var VAPID = 'BFAxeXlnBFlp_oOaQpYewm8sJ-iqWTjvbwwOuEY1ANtmqSkhi8nvcaIBvyvMzOfz--Kxtk-lTHZQ_IAeymGVruU';
  var API = 'https://script.google.com/macros/s/AKfycbxkbNeFYayitjUo9vF-V76J2NGIWmYLFXSPMoq3ZL9V4y32lXrZ7k5HvqmzHL3HCmUg/exec';
  var ENTITY_ORDER = ['Real Estate', 'E10K', 'Personal', 'One Cent LLC', 'Two Cent LLC', 'Western Approach LLC', 'Aircraft'];
  var STATUS_ORDER = {'In Progress': 0, 'Blocked': 1, 'Waiting': 2, 'Not Started': 3, 'Done': 9};
  var PRI = {High: 0, Medium: 1, Low: 2};
  var svg = function (d) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  var ICONS = {
    check: svg('<path d="M4 12l5 5L20 6"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    mtn: svg('<path d="M2 20l7-12 4 6 3-4 6 10z"/>')
  };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
  var ls = {
    get: function (k, d) { try { var v = localStorage.getItem('e10k.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('e10k.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  // IndexedDB key/value store: the outgoing queue (it can hold photos) and photo previews live here, so the small
  // localStorage quota can never stop a change from being kept on the phone.
  var idb = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        if (!window.indexedDB) return rej(new Error('no indexedDB'));
        var r = indexedDB.open('e10k', 1);
        r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      dbp.catch(function () { dbp = null; });
      return dbp;
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
          t.oncomplete = function () { res(req && req.result); };
          t.onerror = t.onabort = function () { rej(t.error || new Error('idb')); };
        });
      });
    }
    return {
      get: function (k) { return run('readonly', function (st) { return st.get(k); }); },
      set: function (k, v) { return run('readwrite', function (st) { return st.put(v, k); }); },
      del: function (k) { return run('readwrite', function (st) { return st['delete'](k); }); }
    };
  })();

  // ---------- token ----------
  function readToken() {
    var m = location.hash.match(/[#&]t=([A-Za-z0-9_\-]{24,})/);
    if (m) {
      var oldTok = ls.get('token', null);
      if (oldTok !== m[1]) {   // new person on this phone: drop the old copy (unsent changes are kept and still go out as the old person)
        var oq = ls.get('queue', null);
        if (oq && oq.length) { oq.forEach(function (j) { if (!j.tok) j.tok = oldTok; }); ls.set('queue', oq); }
        ['data', 'hours', 'walks', 'tab', 'chat', 'chatSeen', 'supplies', 'shopUsed', 'seen', 'equip', 'mlogs'].forEach(function (k) { localStorage.removeItem('e10k.' + k); });
      }
      ls.set('token', m[1]); return m[1];
    }
    return ls.get('token', null);
  }
  var TOKEN = readToken();

  // ---------- state ----------
  var S = {
    data: ls.get('data', null),          // bootstrap payload
    hours: ls.get('hours', []),
    walks: ls.get('walks', []),
    queue: [],                           // pending writes (IndexedDB; loaded at start)
    failed: [],                          // writes the server refused (shown so nothing is lost silently)
    mlogs: ls.get('mlogs', []),          // recent machine logs (Hours tab)
    tab: ls.get('tab', 'mine'),
    filter: '', chip: 'All'
  };
  function me() { return S.data && S.data.me || {}; }
  function save() {
    if (!ls.set('data', S.data)) { try { localStorage.removeItem('e10k.walks'); } catch (e) {} ls.set('data', S.data); }
    ls.set('hours', S.hours); ls.set('walks', S.walks); ls.set('mlogs', S.mlogs);
    saveQueue();
  }
  // The queue is written to IndexedDB (fallback: localStorage). If neither works, a red banner says so.
  var qSaving = null, qAgain = false;
  function saveQueue() {
    if (!S.qLoaded) return;
    if (qSaving) { qAgain = true; return; }
    var snap = {queue: S.queue.slice(), failed: S.failed.slice()};
    qSaving = idb.set('q', snap).then(function () { S.persistFail = false; try { localStorage.removeItem('e10k.queue'); } catch (e) {} })
      .catch(function () { S.persistFail = !(ls.set('queue', S.queue) && ls.set('failed', S.failed)); })
      .then(function () { qSaving = null; syncBadge(); if (qAgain) { qAgain = false; saveQueue(); } });
  }
  function loadQueue() {
    var legacy = ls.get('queue', []) || [], legacyF = ls.get('failed', []) || [];
    return idb.get('q').catch(function () { return null; }).then(function (v) {
      var q = (v && v.queue) || [], f = (v && v.failed) || [];
      var ids = {}; q.concat(f).forEach(function (j) { ids[j.id] = 1; });
      legacy.forEach(function (j) { if (!ids[j.id]) q.push(j); });
      legacyF.forEach(function (j) { if (!ids[j.id]) f.push(j); });
      S.queue = q.concat(S.queue); S.failed = f.concat(S.failed); S.qLoaded = true;
      saveQueue();
    });
  }

  // ---------- api ----------
  var READS = {'bootstrap': 1, 'tasks': 1, 'time.list': 1, 'walk.list': 1, 'walk.get': 1, 'equip.list': 1, 'equip.history': 1, 'lead.list': 1,
    'supplies.list': 1, 'shop.list': 1, 'shop.get': 1, 'chat.list': 1, 'chat.photo': 1, 'receipt.list': 1, 'receipt.get': 1, 'mlog.list': 1, 'briefing.get': 1};
  /** POST to the backend with a time limit (a hung request on 1 bar never blocks the app). Writes carry a request id
   *  (rid) so a resend after a lost answer is recognised by the server and never done twice. */
  function api(action, args, opt) {
    opt = opt || {};
    var body = Object.assign({}, args || {}, {token: opt.token || TOKEN, action: action});
    if (!READS[action] && action !== 'batch' && !body.rid) body.rid = uid() + uid();
    var json = JSON.stringify(body);
    var ms = opt.timeout || (READS[action] ? 25000 : (json.length > 400000 ? 120000 : 60000));
    var ac = window.AbortController ? new AbortController() : null;
    var tm = ac ? setTimeout(function () { ac.abort(); }, ms) : 0;
    return fetch(API, {method: 'POST', body: json, redirect: 'follow', signal: ac ? ac.signal : undefined})
      .then(function (r) { clearTimeout(tm); return r.json(); }, function (e) { clearTimeout(tm); throw e; })
      .then(function (j) {
        if (!j.ok && j.error === 'not_signed_in') { if (!opt.token || opt.token === TOKEN) signedOut(); throw new Error('not_signed_in'); }
        return j;
      });
  }

  function uid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(-8); }

  function enqueue(action, args) {
    S.queue.push({id: uid() + uid(), action: action, args: args, tries: 0, tok: TOKEN, at: Date.now()});
    save(); syncBadge(); flush();
  }

  var RETRYABLE = /lock|timed out|timeout|too many|service|exceeded|try again|in_progress|unknown_action|internal|rate|not_run/i;
  function isRetry(r) { return !r || r.retry || RETRYABLE.test(String(r.error || '')); }
  function bigJob(j) { var a = j.args || {}, f = a.fields || {}; return !!((f.photos && f.photos.length) || (f.photo && f.photo.data)); }
  function plainErr(e) { return String(e || 'error').replace(/_/g, ' '); }

  /** What a saved change tells us back (real task ids, machine logs, clock) goes straight into the local copy. */
  function applyResult(job, r) {
    if (r.task) {
      var temp = job.args && job.args.tempId;
      if (temp && S.data) {
        S.data.tasks = (S.data.tasks || []).filter(function (t) { return t.id !== temp || t.id === r.task.id; });
        S.queue.forEach(function (q) { if (q.args && q.args.id === temp) q.args.id = r.task.id; });
        var nf = ls.get('seen', {}); if (nf[temp]) { nf[r.task.id] = 1; ls.set('seen', nf); }
      }
      upsertTask(r.task);
    }
    if (S.data && r.log) {
      var L = S.data.mlogOpen || (S.data.mlogOpen = []);
      S.data.mlogOpen = L.filter(function (x) { return x.id !== r.log.id; });
      if (r.log.status === 'Open') S.data.mlogOpen.push(r.log);
    }
    if (S.data && r.mlogs) r.mlogs.forEach(function (lg) {
      S.data.mlogOpen = (S.data.mlogOpen || []).filter(function (x) { return x.id !== lg.id; });
      if (lg.status === 'Open') S.data.mlogOpen.push(lg);
    });
    if (S.data && r.clock && job.action === 'time.clockin') S.data.clock = r.clock;
  }

  var flushing = false;
  function flush() {
    if (flushing || !S.qLoaded || !S.queue.length || !navigator.onLine) { syncBadge(); return Promise.resolve(); }
    flushing = true; syncBadge();
    var first = S.queue[0], group = [first];
    if (!bigJob(first)) for (var i = 1; i < S.queue.length && group.length < 10; i++) {
      var nj = S.queue[i]; if (bigJob(nj) || (nj.tok || TOKEN) !== (first.tok || TOKEN)) break; group.push(nj);
    }
    var tok = first.tok || TOKEN;
    var p = group.length === 1
      ? api(first.action, Object.assign({}, first.args, {rid: first.id}), {token: tok}).then(function (r) { return [r]; })
      : api('batch', {ops: group.map(function (j) { return Object.assign({}, j.args, {action: j.action, rid: j.id}); })}, {token: tok, timeout: 90000})
          .then(function (r) { if (!r.ok || !r.results) throw new Error(r.error || 'batch'); return r.results; });
    return p.then(function (results) {
      group.forEach(function (job, i) {
        var r = results[i];
        if (r && r.ok) { S.queue.splice(S.queue.indexOf(job), 1); applyResult(job, r); }
        else if (isRetry(r)) { job.tries++; job.lastError = r && r.error; }
        else {
          S.queue.splice(S.queue.indexOf(job), 1);
          job.error = (r && r.error) || 'error'; job.when = Date.now();
          S.failed.push(job);
          toast('Couldn\u2019t save: ' + plainErr(job.error) + ' \u2013 tap the red note at the top');
        }
      });
    }).catch(function (e) {
      var signedOff = e && e.message === 'not_signed_in';
      group.forEach(function (j) {
        j.tries++; j.lastError = signedOff ? 'link no longer works' : 'no signal';
        if (signedOff && j.tries > 3) { S.queue.splice(S.queue.indexOf(j), 1); j.error = 'link no longer works'; S.failed.push(j); }
      });
    }).then(function () {
      flushing = false; save(); syncBadge(); render();
      if (S.queue.length) { var t = S.queue[0].tries; setTimeout(flush, t ? Math.min(60000, 3000 * Math.pow(2, t - 1)) : 100); }
      else laterRefresh();
    });
  }

  function syncBadge() {
    var el = $('#sync'); if (!el) return;
    var n = S.queue.length, retrying = S.queue.some(function (j) { return j.tries > 0; }), nf = S.failed.length;
    if (!navigator.onLine) { el.textContent = 'offline' + (n ? ' \u00b7 ' + n + ' not sent yet' : ''); el.className = 'sync warn'; }
    else if (n && retrying) { el.textContent = n + ' not saved yet \u00b7 retrying'; el.className = 'sync warn'; }
    else if (n) { el.textContent = 'sending ' + n + '\u2026'; el.className = 'sync warn'; }
    else if (nf) { el.textContent = nf + ' couldn\u2019t save'; el.className = 'sync bad'; }
    else { el.textContent = ''; el.className = 'sync'; }
    el.onclick = nf || S.persistFail ? failedSheet : null;
    var bar = $('#savebar');
    if (bar) {
      var msg = S.persistFail ? '\u26a0 This phone can\u2019t store changes right now \u2013 keep E10K open until they send' + (n ? ' (' + n + ')' : '') :
        (nf ? '\u26a0 ' + nf + ' change' + (nf > 1 ? 's' : '') + ' couldn\u2019t be saved \u2013 tap to see' : '');
      bar.textContent = msg; bar.className = msg ? 'savebar' : 'savebar hidden';
      bar.onclick = msg ? failedSheet : null;
    }
  }

  var JOB_NAMES = {'task.update': 'Task change', 'task.create': 'New task', 'task.assign': 'Assign', 'time.create': 'Hours', 'time.clockin': 'Clock in',
    'time.clockout': 'Clock out', 'walk.create': 'Walkthrough', 'equip.check': 'Pre-start check', 'equip.problem': 'Problem report', 'equip.log': 'Service log',
    'equip.hours': 'Hours update', 'equip.service': 'Back in service', 'equip.flag': 'Level change', 'supplies.add': 'Supplies item', 'supplies.update': 'Supplies change',
    'shop.add': 'Shop part', 'shop.decide': 'Shop part decision', 'receipt.add': 'Receipt', 'chat.send': 'Message', 'task.followup': 'Follow-up', 'sam.ask': 'Note to Sam',
    'lead.email': 'Lead email log', 'walk.email': 'Walkthrough email log', 'mlog.start': 'Machine start', 'mlog.close': 'Machine close-out', 'mlog.cancel': 'Machine cancel', 'task.seen': 'Seen'};
  function failedSheet() {
    var html = '<h2>Not saved</h2>' + (S.persistFail ? '<div class="card" style="border-color:var(--red)">This phone ran out of room to keep changes. Keep E10K open with signal until the top bar clears.</div>' : '') +
      (S.failed.length ? '<div class="sub" style="margin-bottom:8px">The server said no to these. Fix and redo them, try again, or drop them.</div>' : '') +
      S.failed.map(function (j, i) {
        var f = (j.args && j.args.fields) || {}, tk = j.args && j.args.id ? findTask(j.args.id) : null;
        var what = f.task || (tk && tk.task) || f.work || f.item || f.text || f.summary || f.machine || '';   // never show task codes
        return '<div class="card"><div class="title">' + esc(JOB_NAMES[j.action] || j.action) + '</div><div class="sub">' + esc(String(what).slice(0, 120)) + '</div>' +
          '<div class="sub" style="color:var(--red)">' + esc(plainErr(j.error)) + '</div>' +
          '<div class="btns"><button class="btn" data-act="drop:' + i + '">Drop it</button><button class="btn primary" data-act="retry:' + i + '">Try again</button></div></div>';
      }).join('') + '<div class="btns"><button class="btn" data-act="x">Close</button></div>';
    sheet(html, function (act) {
      var m = String(act).split(':'), j = S.failed[+m[1]];
      if (m[0] === 'retry' && j) { S.failed.splice(+m[1], 1); j.tries = 0; delete j.error; S.queue.push(j); save(); flush(); }
      else if (m[0] === 'drop' && j) { S.failed.splice(+m[1], 1); save(); }
      else return closeSheet();
      syncBadge(); if (S.failed.length || S.persistFail) failedSheet(); else closeSheet();
    });
  }

  // refresh after writes: the local copy is already updated, so a full reload can wait a little
  var refreshT = null, lastRefresh = 0;
  function laterRefresh() { clearTimeout(refreshT); refreshT = setTimeout(function () { refresh(true); }, 15000); }

  function refresh(quiet) {
    if (!TOKEN) return Promise.resolve();
    if (S.queue.length) return flush();
    clearTimeout(refreshT);
    lastRefresh = Date.now();
    var have = S.data && S.data.hash;
    return api('bootstrap', have ? {have: have} : {}).then(function (r) {
      if (!r.ok) return;
      if (r.unchanged) {   // server copy unchanged: drop any leftover temporary tasks nothing is waiting on
        var before = (S.data.tasks || []).length;
        S.data.tasks = (S.data.tasks || []).filter(function (t) { return !/^new-/.test(t.id) || S.queue.some(function (q) { return q.args && q.args.tempId === t.id; }); });
        if (S.data.tasks.length !== before) { save(); render(); }
        return;
      }
      if (S.queue.length) return;   // a change was made while this was loading: keep the local copy, reload later
      S.data = r;
      var seen = ls.get('seen', {}), nf = r.newFor || {};
      Object.keys(seen).forEach(function (k) { if (nf[k] === undefined) delete seen[k]; });
      ls.set('seen', seen);
      save(); render();
    }).catch(function () { if (!quiet) toast('No signal \u2013 showing saved copy'); });
  }

  function upsertTask(t) {
    if (!S.data) return;
    var a = S.data.tasks, i = a.findIndex(function (x) { return x.id === t.id; });
    if (i >= 0) a[i] = Object.assign(a[i], t); else a.push(t);
  }

  // ---------- helpers ----------
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }
  function parseD(s) { if (!s) return null; var p = s.split('/'); return p.length === 3 ? new Date(+p[2], +p[0] - 1, +p[1]) : null; }
  function todayStr() { var d = new Date(); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function shortD(s) { var d = parseD(s); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; }
  function isoToUs(v) { if (!v) return ''; var p = v.split('-'); return p[1] + '/' + p[2] + '/' + p[0]; }
  function usToIso(v) { var d = parseD(v); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; }
  function to24(v) { var m = String(v || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i); if (!m) return ''; var h = +m[1] % 12;
    if (m[3] && m[3].toUpperCase() === 'PM') h += 12; if (!m[3]) h = +m[1]; return pad(h) + ':' + m[2]; }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function sinceTxt(date, start) {
    var d = parseD(date), hm = to24(start); if (!d || !hm) return '';
    d.setHours(+hm.split(':')[0], +hm.split(':')[1]); var min = Math.max(0, Math.round((Date.now() - d) / 60000));
    return Math.floor(min / 60) + 'h ' + pad(min % 60) + 'm';
  }
  function to12(v) { if (!v) return ''; var p = v.split(':'), h = +p[0]; return ((h % 12) || 12) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function late(t) { var d = parseD(t.due); if (!d || t.status === 'Done') return false; var n = new Date(); n.setHours(0, 0, 0, 0); return d < n; }
  function statusCls(s) { return {'In Progress': 'prog', 'Waiting': 'wait', 'Blocked': 'block', 'Done': 'done'}[s] || ''; }

  function sortTasks(a) {
    return a.sort(function (x, y) {
      var dx = parseD(x.due), dy = parseD(y.due);
      if (x.status === 'Done' !== (y.status === 'Done')) return x.status === 'Done' ? 1 : -1;
      if (dx && dy && +dx !== +dy) return dx - dy;
      if (!!dx !== !!dy) return dx ? -1 : 1;
      var p = (PRI[x.priority] || 1) - (PRI[y.priority] || 1); if (p) return p;
      return (STATUS_ORDER[x.status] || 5) - (STATUS_ORDER[y.status] || 5);
    });
  }

  // ---------- phone alerts ----------
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function alertsState() {
    if (isIOS && !standalone) return 'ios-install';
    if (!pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return ls.get('alertsOn', false) && Notification.permission === 'granted' ? 'on' : 'off';
  }
  function b64ToBytes(b) {
    var p = '='.repeat((4 - b.length % 4) % 4), s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/'));
    var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a;
  }
  function turnOnAlerts() {
    var st = alertsState();
    if (st === 'ios-install') return toast('On iPhone: open this in Safari, tap Share \u2192 Add to Home Screen, then open E10K from the icon and turn alerts on there.');
    if (st === 'unsupported') return toast('This browser can\u2019t do alerts. Use Chrome on Android or Safari on iPhone.');
    if (st === 'blocked') return toast('Alerts are blocked. Allow notifications for this site in your phone settings, then try again.');
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Alerts not allowed'); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID)});
        });
      }).then(function (sub) {
        return api('push.subscribe', {sub: sub.toJSON(), device: navigator.userAgent.slice(0, 120)});
      }).then(function (r) {
        if (r && r.ok) { ls.set('alertsOn', true); toast('Alerts are on \u2713'); render(); }
        else toast('Could not turn on alerts');
      });
    }).catch(function () { toast('Could not turn on alerts \u2013 try again with signal'); });
  }
  function alertsBanner() {
    var st = alertsState();
    if (st === 'on' || st === 'unsupported' || ls.get('alertsHide', false)) return '';
    var msg = st === 'ios-install' ? 'To get task alerts on iPhone, add E10K to your Home Screen from Safari (Share \u2192 Add to Home Screen).'
      : st === 'blocked' ? 'Alerts are blocked for E10K. Allow notifications in your phone settings.'
      : 'Get a phone alert when someone gives you a task.';
    return '<div class="card"><div class="row"><div class="grow"><div class="title">\uD83D\uDD14 Task alerts</div><div class="sub">' + msg + '</div></div></div>' +
      '<div class="btns" style="margin-top:10px">' + (st === 'off' ? '<button class="btn primary" data-alerts="on">Turn on alerts</button>' : '') +
      '<button class="btn" data-alerts="hide">Not now</button></div></div>';
  }

  // ---------- rendering ----------
  var EXTRA_TABS = [];
  function tabsFor() {
    var t = [{k: 'mine', ic: ICONS.check, n: 'My Tasks'}];
    t.push({k: 'all', ic: ICONS.list, n: me().owner ? 'All Open' : 'Job Tasks'});
    t.push({k: 'hours', ic: ICONS.clock, n: 'Hours'});
    t.push({k: 'walks', ic: ICONS.mtn, n: 'Walks'});
    t.splice.apply(t, [3, 0].concat(EXTRA_TABS));
    return t;
  }

  function render() {
    if (!TOKEN) return signedOut();
    if (!S.data) { $('#view').innerHTML = '<div class="empty">Loading\u2026</div>'; return; }
    var tabs = tabsFor();
    if (!tabs.some(function (t) { return t.k === S.tab; })) S.tab = 'mine';
    $('#tabs').innerHTML = tabs.map(function (t) {
      var nf = ((S.data && S.data.flags) || []).length;
      var badge = t.k === 'mine' && newCount() ? '<span class="badge">' + newCount() + '</span>' :
        (t.k === 'mine' && urgentCount() ? '<span class="badge" style="background:var(--red)">' + urgentCount() + '</span>' : '') ||
        (t.k === 'equip' && nf ? '<span class="badge" style="background:var(--red)">' + nf + '</span>' :
        (t.badge && t.badge() ? '<span class="badge">' + t.badge() + '</span>' :
        (t.k === 'hours' && runningCount() ? '<span class="badge" style="background:var(--green)">' + runningCount() + '</span>' :
        (t.k === 'hours' && S.data && S.data.clock ? '<span class="badge" style="background:var(--green);min-width:10px;height:10px;padding:0"></span>' : ''))));
      return '<button data-tab="' + t.k + '" class="' + (S.tab === t.k ? 'on' : '') + '"><span class="ic">' + t.ic + badge + '</span>' + t.n + '</button>';
    }).join('');
    $('#fab').classList.remove('hidden');
    renderFlags();
    if (S.tab === 'hours') return renderHours();
    if (S.tab === 'walks') return renderWalks();
    var ex = EXTRA_TABS.filter(function (x) { return x.k === S.tab; })[0];
    if (ex) return ex.render();
    renderTasks();
  }

  function runningCount() { return ((S.data && S.data.mlogOpen) || []).length; }

  // ---------- briefing (written by Sam's server at 7:30 am and 5 pm; newest one for today) ----------
  function briefHidden(b) { return ls.get('briefHide', '') === (b.date + b.mode); }
  function briefingCard() {
    var b = S.data && S.data.briefing; if (!b || !b.data || briefHidden(b)) return '';
    var d = b.data, secs = d.sections || [], n = secs.reduce(function (a, x) { return a + ((x.items || []).length); }, 0);
    var warn = secs.reduce(function (a, x) { return a + (x.items || []).filter(function (i) { return i.tone === 'warn'; }).length; }, 0);
    return '<div class="card tap brief" data-brief="open"><div class="row"><div class="grow"><div class="title">' + (b.mode === 'evening' ? '\ud83c\udf05 ' : '\u2600\ufe0f ') +
      esc(d.title || (b.mode === 'evening' ? 'Evening briefing' : 'Morning briefing')) + '</div>' +
      '<div class="sub">' + esc(secs.slice(0, 3).map(function (x) { return /\)\s*$/.test(x.heading || '') ? x.heading : x.heading + ' (' + (x.items || []).length + ')'; }).join(' \u00b7 ') || (n + ' items')) + '</div></div>' +
      (warn ? '<span class="pill late">' + warn + ' heads-up</span>' : '<span class="pill">Read</span>') + '</div></div>';
  }
  function briefingHtml(b) {
    var d = b.data || {};
    return '<h2>' + esc(d.title || (b.mode === 'evening' ? 'Evening briefing' : 'Morning briefing')) + '</h2>' +
      '<div class="kv">' + esc((b.mode === 'evening' ? 'Evening' : 'Morning') + ' \u00b7 ' + b.date + (b.generatedAt ? ' \u00b7 ' + b.generatedAt : '')) + '</div>' +
      (d.sections || []).map(function (sec) {
        return '<h3>' + esc(sec.heading || '') + '</h3><div class="card">' + ((sec.items || []).map(function (it) {
          return '<div class="bfi ' + (it.tone ? 'bf-' + esc(it.tone) : '') + '"><div>' + esc(it.text || '') + '</div>' + (it.sub ? '<div class="sub">' + esc(it.sub) + '</div>' : '') + '</div>';
        }).join('') || '<div class="sub">Nothing here.</div>') + '</div>';
      }).join('') +
      '<div class="btns"><button class="btn" data-act="hide">Hide for today</button><button class="btn primary" data-act="x">Close</button></div>';
  }
  function openBriefing() {
    var shown = false;
    var show = function (b) {
      if (!b || !b.data) return toast('No briefing yet today');
      shown = true;
      sheet(briefingHtml(b), function (act) { if (act === 'hide') { ls.set('briefHide', b.date + b.mode); render(); } closeSheet(); });
    };
    var b = S.data && S.data.briefing;
    if (b && b.data) show(b);
    if (!navigator.onLine) { if (!shown) toast('No briefing saved on this phone yet'); return; }
    api('briefing.get').then(function (r) {
      if (!r.ok || !S.data) return;
      var had = JSON.stringify(S.data.briefing || null); S.data.briefing = r.briefing; save();
      if (had !== JSON.stringify(r.briefing || null)) { if (r.briefing) show(r.briefing); else if (!shown) toast('No briefing yet today'); render(); }
      else if (!shown) toast('No briefing yet today');
    }).catch(function () { if (!shown) toast('Needs a signal to load the briefing'); });
  }

  var FLAGS = {
    DOWN: {ic: '\u26d4', label: 'CRITICAL \u2013 do not operate until repaired', short: 'Critical', cls: 'flagdown', b: '', color: 'var(--red)'},
    Problem: {ic: '\u26a0\ufe0f', label: 'Broken but operational', short: 'Broken, still running', cls: 'flagprob', b: ' problem', color: 'var(--orange)'},
    Watch: {ic: '\u2139\ufe0f', label: 'Something to be aware of', short: 'Be aware', cls: 'flagwatch', b: ' watch', color: '#e6c200'}
  };
  var FLAG_ORDER = {DOWN: 0, Problem: 1, Watch: 2};
  function renderFlags() {
    $('#flags').innerHTML = '';
    var eb = document.querySelector('[data-tab=equip] .ic');
    if (eb) {
      var old = eb.querySelector('.badge'); if (old) old.remove();
      var n = ((S.data && S.data.flags) || []).length;
      if (n) eb.insertAdjacentHTML('beforeend', '<span class="badge" style="background:var(--red)">' + n + '</span>');
    }
  }
  function oldBanner_() {
    var fl = ((S.data && S.data.flags) || []).slice().sort(function (a, b) { return (FLAG_ORDER[a.status] || 0) - (FLAG_ORDER[b.status] || 0); });
    $('#flags').innerHTML = fl.map(function (f) {
      var L = FLAGS[f.status] || FLAGS.Problem;
      var note = String(f.note || '').split(' | ').pop();
      return '<button class="flag' + L.b + '" data-flag="' + esc(f.key) + '">' + L.ic + ' ' + esc(f.model) + ': ' + esc(L.label) +
        '<span class="fs">' + esc(note) + (f.since ? ' \u00b7 since ' + esc(shortD(f.since)) : '') + '</span></button>';
    }).join('');
  }

  function taskCard(t) {
    var where = [t.job, t.area].filter(Boolean).join(' \u00b7 ') || t.entity;
    var pill = esc(t.status) + (t.due ? ' \u00b7 ' + shortD(t.due) : '');
    var nw = isNewFor(t);
    return '<div class="card tap ' + (t.status === 'Done' ? 'done' : '') + (nw ? ' new' : '') + '" data-task="' + esc(t.id) + '">' +
      (nw ? '<div class="newtag">NEW' + (S.data.newFor[t.id] ? ' \u00b7 from ' + esc(S.data.newFor[t.id]) : '') + '</div>' : '') +
      '<div class="row">' +
      '<span class="dot ' + esc(t.priority) + '"></span>' +
      '<div class="grow"><div class="title">' + esc(t.task) + '</div><div class="sub">' + esc(where) +
      (S.tab === 'all' && t.owner ? ' \u00b7 ' + esc(t.owner) : '') + '</div></div>' +
      '<span class="pill ' + (late(t) ? 'late' : statusCls(t.status)) + '">' + pill + '</span></div></div>';
  }

  // ---------- several people on a task ----------
  function ownersOf(v) { return String(v || '').split(/\s*,\s*/).filter(Boolean); }
  function isMine(t, m) { var o = ownersOf(t.owner); return o.indexOf(m.name) >= 0 || (m.owner && o.indexOf('Both') >= 0); }
  function whoChoices() {
    var m = me(), L = (S.data.lists || {})['Owner'];
    var list = (S.data.people || []).slice();
    if (m.owner && L) L.forEach(function (x) { if (list.indexOf(x) < 0) list.push(x); });
    return list;
  }
  function whoPicker(id, cur) {
    var sel = ownersOf(cur);
    return '<div class="chips" id="' + id + '" style="flex-wrap:wrap">' + whoChoices().map(function (n) {
      return '<button class="chip' + (sel.indexOf(n) >= 0 ? ' on' : '') + '" data-who="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>';
  }
  function wireWho(id) {
    var box = document.getElementById(id);
    box.onclick = function (e) { var b = e.target.closest('[data-who]'); if (!b) return; e.stopPropagation(); b.classList.toggle('on'); };
    return function () { return Array.prototype.map.call(box.querySelectorAll('.chip.on'), function (b) { return b.getAttribute('data-who'); }); };
  }
  function assignForm(t) {
    sheet('<h2>Who\u2019s on it?</h2><div class="kv">' + esc(t.task) + '</div><div class="sub" style="margin:6px 0">Tap everyone who should do this. New people get a phone alert.</div>' +
      whoPicker('as-who', t.owner) +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>', function (act) {
      if (act !== 'save') return closeSheet();
      var who = get(); if (!who.length) return toast('Pick at least one person');
      var before = ownersOf(t.owner), added = who.filter(function (x) { return before.indexOf(x) < 0 && x !== me().name; });
      t.owner = who.join(', ');
      enqueue('task.assign', {id: t.id, owners: who});
      save(); closeSheet(); render();
      toast(added.length ? 'Sent to ' + added.join(', ') : 'Saved');
    });
    var get = wireWho('as-who');
  }

  /** Follow-ups stay out of the lists until their date comes up (they're still searchable). */
  function isLater(t) {
    if (!t || t.status === 'Done' || !/^follow[ -]?up/i.test(t.task || '')) return false;
    var d = parseD(t.due); if (!d) return false;
    var n = new Date(); n.setHours(0, 0, 0, 0); return d > n;
  }
  // ---------- task list: briefing-style. "By job" (Do these first + one card per job) or "By when" ----------
  var TL_ORDER = ['E10K', 'Real Estate', 'Personal', 'One Cent LLC', 'Two Cent LLC', 'Western Approach LLC', 'Aircraft'];
  function tDays(t) { var d = parseD(t.due); if (!d) return null; var n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((d - n) / 864e5); }
  function tScore(t) {
    var n = tDays(t);
    var band = n !== null && n < 0 ? 0 : n === 0 ? 1 : n === 1 ? 2 : t.priority === 'High' ? 3 : n !== null && n <= 7 ? 4 : t.status === 'In Progress' ? 5 : 6;
    return band * 10000 + (n === null ? 5000 : Math.max(-999, Math.min(n, 4000)) + 1000) + (t.priority === 'High' ? 0 : t.priority === 'Low' ? 2 : 1);
  }
  function bySc(a, b) { return tScore(a) - tScore(b); }
  function dueTxt(t) {
    var n = tDays(t); if (n === null) return '';
    if (n < 0) return '<span class="tl-late">' + (-n) + ' day' + (n < -1 ? 's' : '') + ' late</span>';
    if (n === 0) return '<span class="tl-soon">due today</span>';
    if (n === 1) return '<span class="tl-soon">due tomorrow</span>';
    var d = parseD(t.due); return 'due ' + d.toLocaleDateString('en-US', {weekday: 'short'}) + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function isHot(t) { var n = tDays(t); return t.status !== 'Waiting' && t.status !== 'Done' && ((n !== null && n <= 1) || t.priority === 'High'); }
  function tRow(t, showJob) {
    var bits = [], nw = isNewFor(t);
    if (showJob) bits.push(esc(t.job || t.entity));
    if (t.status === 'Done') bits.push('<span class="tl-done">done</span>');
    else { var dt = dueTxt(t); if (dt) bits.push(dt); }
    if (t.status === 'Waiting') bits.push('<span class="tl-prog">waiting</span>');
    else if (t.status === 'In Progress') bits.push('<span class="tl-prog">in progress</span>');
    else if (t.status === 'Blocked') bits.push('<span class="tl-late">blocked</span>');
    if (t.area) bits.push(esc(t.area));
    if (S.tab === 'all' && t.owner) bits.push(esc(t.owner));
    return '<div class="tl-r p-' + esc(t.priority || 'Medium') + (t.status === 'Done' ? ' is-done' : '') + (nw ? ' is-new' : '') + '" data-task="' + esc(t.id) + '">' +
      '<span class="tl-ckw" data-ck="' + esc(t.id) + '"><span class="tl-ck"></span></span><div class="tl-x">' + (nw ? '<span class="newtag">NEW' + (S.data.newFor[t.id] ? ' \u00b7 ' + esc(S.data.newFor[t.id]) : '') + '</span>' : '') +
      '<div class="tl-t">' + esc(t.task) + '</div><div class="tl-s">' + bits.join(' \u00b7 ') + '</div></div></div>';
  }
  /** A briefing-style box. key = remembers if it's opened up. */
  function tBox(key, title, count, rows, opt) {
    opt = opt || {};
    var limit = opt.limit === undefined ? 3 : opt.limit, open = !!(S.tlOpen || {})[key], collapsed = opt.collapsed && !open;
    var shown = collapsed ? [] : (open ? rows : rows.slice(0, limit)), rest = rows.length - shown.length;
    return '<div class="tl-box' + (opt.cls ? ' ' + opt.cls : '') + '"><div class="tl-h"' + (opt.collapsed ? ' data-tlopen="' + esc(key) + '"' : '') + '><div class="tl-ht">' + title + '</div>' +
      '<div class="tl-hc">' + count + (opt.collapsed ? (open ? ' \u25b4' : ' \u203a') : '') + '</div></div>' + (opt.sub ? '<div class="tl-hs">' + esc(opt.sub) + '</div>' : '') +
      shown.join('') + (!collapsed && rest > 0 ? '<div class="tl-more" data-tlopen="' + esc(key) + '">+' + rest + ' more \u203a</div>' : '') +
      (!collapsed && open && rows.length > limit && !opt.collapsed ? '<div class="tl-more" data-tlopen="' + esc(key) + '">Show less \u25b4</div>' : '') + '</div>';
  }
  // ---------- tap the circle = done (with Undo) ----------
  function undoToast(msg, undo) {
    var el = $('#toast'); el.innerHTML = esc(msg) + ' <button class="tl-undo">Undo</button>'; el.classList.remove('hidden');
    el.querySelector('.tl-undo').onclick = function (e) { e.stopPropagation(); el.classList.add('hidden'); undo(); };
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.add('hidden'); }, 5000);
  }
  function quickDone(id, rowEl) {
    var t = findTask(id); if (!t) return;
    if (t.status === 'Done') {   // tapping a finished one (Done today) reopens it
      t.status = 'In Progress'; t.completed = ''; enqueue('task.update', {id: t.id, fields: {status: 'In Progress'}}); save(); render(); return toast('Reopened');
    }
    if (window.E10K.onDone && window.E10K.onDone(t)) return;   // real estate: asks how it went + next follow-up
    var was = t.status;
    if (rowEl) rowEl.classList.add('is-done');
    setTimeout(function () {
      t.status = 'Done'; t.completed = todayStr();
      enqueue('task.update', {id: t.id, fields: {status: 'Done'}}); save(); render();
      undoToast('Done \u2713', function () { t.status = was; t.completed = ''; enqueue('task.update', {id: t.id, fields: {status: was}}); save(); render(); toast('Put back'); });
    }, 250);
  }

  // ---------- swipe left on a task = push the due date ----------
  function usDate(d) { return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear(); }
  function canPush(t) { var m = me(); return t && t.status !== 'Done' && (m.owner || isMine(t, m)); }
  function pushDate(t, d, why) {
    var was = t.due || '', m = me();
    if (!m.owner) { why = String(why || '').trim(); if (!why) { var wi = document.querySelector('.tl-sw .tl-why'); if (wi) wi.focus(); return toast('Type why it\u2019s getting pushed'); } }
    var f = {due: usDate(d)}; if (!m.owner) { f.reason = why; t.notes = (t.notes ? t.notes + ' | ' : '') + todayStr() + ' ' + m.name + ': moved due date to ' + f.due + ' - ' + why; }
    t.due = f.due; enqueue('task.update', {id: t.id, fields: f}); save(); render();
    undoToast('Moved to ' + d.toLocaleDateString('en-US', {weekday: 'short'}) + ' ' + (d.getMonth() + 1) + '/' + d.getDate(), function () {
      var uf = {due: was}; if (!m.owner) uf.reason = 'undo';
      t.due = was; enqueue('task.update', {id: t.id, fields: uf}); save(); render(); toast('Put back'); });
  }
  function swipeBar(row) {
    var t = findTask(row.getAttribute('data-task')); if (!t) return;
    if (!canPush(t)) { row.style.transform = ''; return toast('Only the office can change that date'); }
    closeSwipes();
    var bar = document.createElement('div'); bar.className = 'tl-sw';
    bar.innerHTML = (me().owner ? '' : '<input class="tl-why" placeholder="Why? (required)">') + '<span class="sub">Push to</span><button data-p="1">Tomorrow</button><button data-p="mon">Next Mon</button><button data-p="7">+1 week</button>' +
      '<label class="tl-pick">Pick<input type="date"></label><button data-p="x" aria-label="Close">\u2715</button>';
    row.insertAdjacentElement('afterend', bar); row.classList.add('sw-open');
    bar.onclick = function (e) {
      e.stopPropagation(); var b = e.target.closest('[data-p]'); if (!b) return;
      var k = b.getAttribute('data-p'); if (k === 'x') return closeSwipes();
      var base = new Date(); base.setHours(12, 0, 0, 0);
      if (k === 'mon') base.setDate(base.getDate() + ((8 - base.getDay()) % 7 || 7)); else base.setDate(base.getDate() + +k);
      pushDate(t, base, why());
    };
    function why() { var w = bar.querySelector('.tl-why'); return w ? w.value : ''; }
    bar.querySelector('input[type=date]').onchange = function (e) { var v = e.target.value; if (!v) return; var p2 = v.split('-'); pushDate(t, new Date(+p2[0], +p2[1] - 1, +p2[2], 12), why()); };
    var wf = bar.querySelector('.tl-why'); if (wf) { wf.onclick = function (e) { e.stopPropagation(); }; setTimeout(function () { wf.focus(); }, 50); }
  }
  function closeSwipes() {
    Array.prototype.forEach.call(document.querySelectorAll('.tl-sw'), function (x) { x.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll('.tl-r.sw-open'), function (x) { x.classList.remove('sw-open'); x.style.transform = ''; });
  }
  function wireSwipes() {
    Array.prototype.forEach.call(document.querySelectorAll('.tl-r'), function (row) {
      var x0 = 0, y0 = 0, dx = 0, on = false, dead = false;
      row.addEventListener('touchstart', function (e) { var p0 = e.touches[0]; x0 = p0.clientX; y0 = p0.clientY; dx = 0; on = false; dead = false; }, {passive: true});
      row.addEventListener('touchmove', function (e) {
        if (dead) return; var p0 = e.touches[0], ddx = p0.clientX - x0, ddy = p0.clientY - y0;
        if (!on) { if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { dead = true; return; } if (Math.abs(ddx) > 12) on = true; }
        if (on) { dx = Math.min(0, ddx); row.style.transform = 'translateX(' + Math.max(dx, -110) + 'px)'; }
      }, {passive: true});
      row.addEventListener('touchend', function () {
        if (!on) return; row.style.transform = '';
        if (dx < -60) { row.dataset.swiped = '1'; setTimeout(function () { delete row.dataset.swiped; }, 400); swipeBar(row); }
      });
    });
  }
  function urgentCount() {
    var m = me(); if (!S.data || !m) return 0;
    return (S.data.tasks || []).filter(function (t) { if (t.status === 'Done' || t.status === 'Waiting' || !isMine(t, m)) return false; var n = tDays(t); return n !== null && n <= 0; }).length;
  }

  function renderTasks() {
    var all = S.data.tasks || [], m = me(), qq = S.filter.trim(), later = [];
    var list = all.filter(function (t) {
      if (!qq && isLater(t) && (S.tab !== 'mine' || isMine(t, m))) { later.push(t); return false; }
      if (S.tab === 'mine') {
        if (!isMine(t, m)) return false;
        return t.status !== 'Done' || t.completed === todayStr();
      }
      return t.status !== 'Done';
    });
    var ents = {}; list.forEach(function (t) { ents[t.entity || 'Other'] = 1; });
    var names = Object.keys(ents).sort(function (a, b) {
      var ia = TL_ORDER.indexOf(a), ib = TL_ORDER.indexOf(b); if (ia < 0) ia = 99; if (ib < 0) ib = 99; return ia - ib || a.localeCompare(b); });
    if (['All'].concat(names).indexOf(S.chip) < 0) S.chip = 'All';
    var q = S.filter.toLowerCase();
    list = list.filter(function (t) {
      if (S.chip !== 'All' && (t.entity || 'Other') !== S.chip) return false;
      return !q || (t.task + ' ' + t.job + ' ' + t.area + ' ' + t.notes + ' ' + t.owner).toLowerCase().indexOf(q) >= 0;
    });
    var mode = ls.get('taskView', 'job');
    var html = (S.tab === 'mine' ? briefingCard() + alertsBanner() : '') + '<input class="search" id="q" placeholder="Search tasks" value="' + esc(S.filter) + '">';
    html += '<div class="tl-seg"><button class="' + (mode === 'job' ? 'on' : '') + '" data-tlview="job">By job</button><button class="' + (mode === 'when' ? 'on' : '') + '" data-tlview="when">By when</button></div>';
    if (names.length > 1) html += '<div class="chips">' + ['All'].concat(names).map(function (c) {
      return '<button class="chip ' + (S.chip === c ? 'on' : '') + '" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    var open = list.filter(function (t) { return t.status !== 'Done'; }), doneToday = list.filter(function (t) { return t.status === 'Done'; });
    var fresh = S.tab === 'mine' && !q ? open.filter(isNewFor).sort(bySc) : [];
    var freshIds = {}; fresh.forEach(function (t) { freshIds[t.id] = 1; });
    var rest = open.filter(function (t) { return !freshIds[t.id]; });
    var waiting = rest.filter(function (t) { return t.status === 'Waiting'; }).sort(bySc);
    var active = rest.filter(function (t) { return t.status !== 'Waiting'; });
    var todayJob = !m.owner && S.tab === 'mine' && !q && S.data.clock && S.data.clock.job;
    if (!m.owner && S.tab === 'mine' && !q) {
      if (todayJob) {
        var tj = (S.data.tasks || []).filter(function (t) { return t.job === todayJob && t.status !== 'Done' && t.status !== 'Waiting' && !isLater(t); }).sort(bySc);
        var tjIds = {}; tj.forEach(function (t) { tjIds[t.id] = 1; });
        rest = rest.filter(function (t) { return !tjIds[t.id]; }); active = active.filter(function (t) { return !tjIds[t.id]; });
        fresh = fresh.filter(function (t) { return !tjIds[t.id]; }); waiting = waiting.filter(function (t) { return !tjIds[t.id]; });
        html += tBox('today', '<span class="tl-dot" style="background:var(--green)"></span>Today at ' + esc(todayJob), tj.length + ' open',
          tj.length ? tj.map(function (t) { var r = tRow(t, false); return isMine(t, m) ? r : r.replace('<div class="tl-s">', '<div class="tl-s">' + esc(t.owner || 'nobody yet') + ' \u00b7 '); }) : ['<div class="tl-more">Nothing open on this job.</div>'],
          {limit: 99, cls: 'tl-today'});
      } else html += '<div class="tl-hint">\u23f1 Clock in on the Hours tab and today\u2019s job list shows up here.</div>';
    }
    if (fresh.length) html += tBox('new', '<span class="tl-dot" style="background:#fff"></span>New for you', fresh.length, fresh.map(function (t) { return tRow(t, true); }), {limit: 99, cls: 'tl-new'});
    if (mode === 'when') {
      var B = [['late', 'Late', 'var(--red)', function (n) { return n !== null && n < 0; }, 'tl-hot'],
        ['soon', 'Today & tomorrow', 'var(--orange)', function (n) { return n === 0 || n === 1; }],
        ['week', 'This week', '', function (n) { return n !== null && n > 1 && n <= 7; }],
        ['imp', 'Important, no date', '', function (n, t) { return n === null && t.priority === 'High'; }],
        ['later', 'Later', '', function (n) { return n !== null && n > 7; }],
        ['some', 'Someday', '', function () { return true; }]];
      var used = {};
      B.forEach(function (b) {
        var L = active.filter(function (t) { return !used[t.id] && b[3](tDays(t), t); }).sort(bySc);
        L.forEach(function (t) { used[t.id] = 1; });
        if (L.length) html += tBox('w-' + b[0], (b[2] ? '<span class="tl-dot" style="background:' + b[2] + '"></span>' : '') + b[1], L.length, L.map(function (t) { return tRow(t, true); }), {limit: 6, cls: b[4]});
      });
    } else {
      var hot = active.filter(isHot).sort(bySc), hotIds = {};
      hot.forEach(function (t) { hotIds[t.id] = 1; });
      if (hot.length) html += tBox('hot', '<span class="tl-dot" style="background:var(--red)"></span>Do these first', hot.length, hot.map(function (t) { return tRow(t, true); }), {limit: 6, cls: 'tl-hot'});
      var clients = {}; ((S.data && S.data.jobs) || []).forEach(function (j) { clients[j.name] = j.client; });
      var ents2 = {}; active.forEach(function (t) { if (!hotIds[t.id]) ents2[t.entity || 'Other'] = 1; });
      Object.keys(ents2).sort(function (a, b) { var ia = TL_ORDER.indexOf(a), ib = TL_ORDER.indexOf(b); if (ia < 0) ia = 99; if (ib < 0) ib = 99; return ia - ib; }).forEach(function (e) {
        var et = active.filter(function (t) { return (t.entity || 'Other') === e; });
        var groups = {}; et.forEach(function (t) { var k = t.job || 'General'; (groups[k] = groups[k] || []).push(t); });
        var keys = Object.keys(groups).filter(function (k) { return groups[k].some(function (t) { return !hotIds[t.id]; }); });
        if (!keys.length) return;
        if (m.owner) html += '<h3>' + esc(e) + '</h3>';
        keys.sort(function (a, b) { return Math.min.apply(null, groups[a].map(tScore)) - Math.min.apply(null, groups[b].map(tScore)) || a.localeCompare(b); }).forEach(function (j) {
          var g = groups[j], rows = g.filter(function (t) { return !hotIds[t.id]; }).sort(bySc);
          var lateN = g.filter(function (t) { var n = tDays(t); return n !== null && n < 0; }).length;
          var cnt = g.length + ' open' + (lateN ? ' \u00b7 <b class="tl-late">' + lateN + ' late</b>' : '') + (g.length > rows.length ? ' \u00b7 ' + (g.length - rows.length) + ' up top' : '');
          html += tBox('j-' + e + '-' + j, esc(j), cnt, rows.map(function (t) { return tRow(t, false); }), {sub: clients[j] && clients[j] !== j && /[A-Za-z]/.test(clients[j]) ? clients[j] : ''});
        });
      });
    }
    if (waiting.length) html += tBox('waiting', '<span class="tl-dot" style="background:var(--blue)"></span>Waiting on someone else', waiting.length, waiting.map(function (t) { return tRow(t, true); }), {limit: 99, collapsed: true});
    if (doneToday.length) html += tBox('done', '<span class="tl-dot" style="background:var(--green)"></span>Done today', doneToday.length, doneToday.map(function (t) { return tRow(t, true); }), {limit: 99, collapsed: true});
    if (!open.length && !doneToday.length) html += '<div class="empty">' + (q ? 'Nothing matches.' : S.tab === 'mine' ? 'Nothing on your list. Nice.' : 'No open tasks.') + '</div>';
    if (later.length) {
      later.sort(function (a, b) { return parseD(a.due) - parseD(b.due); });
      html += tBox('later', '<span class="tl-dot" style="background:#777"></span>Follow-ups scheduled for later', later.length, later.map(function (t) { return tRow(t, true); }), {limit: 99, collapsed: true});
    }
    $('#view').innerHTML = html;
    var qi = $('#q'); qi.oninput = function () { S.filter = qi.value; var pos = qi.selectionStart; renderTasks(); var n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-tlview]'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); ls.set('taskView', b.getAttribute('data-tlview')); renderTasks(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ck]'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); quickDone(b.getAttribute('data-ck'), b.closest('.tl-r')); }; });
    wireSwipes();
    Array.prototype.forEach.call(document.querySelectorAll('[data-tlopen]'), function (b) {
      b.onclick = function (e) { e.stopPropagation(); var k = b.getAttribute('data-tlopen'); S.tlOpen = S.tlOpen || {}; S.tlOpen[k] = !S.tlOpen[k]; renderTasks(); }; });
  }

  function assignedBy(t) {
    var m, re = /Assigned (?:to [^|]*? )?by ([A-Za-z]+)/g, last = '';
    while ((m = re.exec(t.notes || ''))) last = m[1];
    return last;
  }

  function isNewFor(t) {
    var nf = (S.data && S.data.newFor) || {}, seen = ls.get('seen', {});
    return t && nf[t.id] !== undefined && !seen[t.id] && t.status !== 'Done';
  }
  function newCount() { return (S.data && S.data.tasks || []).filter(isNewFor).length; }
  function markSeen(t) {
    var seen = ls.get('seen', {}); seen[t.id] = 1; ls.set('seen', seen);
    enqueue('task.seen', {id: t.id});
  }

  function mach(name) { return ((S.data && S.data.machines) || []).filter(function (x) { return x.name === name; })[0]; }

  function findTask(id) { return (S.data.tasks || []).find(function (t) { return t.id === id; }); }

  function openTask(id) {
    if (id === 'CHAT') { if (window.E10K.openChat) window.E10K.openChat(); return; }
    if (id === 'BRIEFING' || id === 'briefing') return openBriefing();
    var t = findTask(id); if (!t) return;
    var m = me();
    if (isNewFor(t)) { markSeen(t); setTimeout(render, 0); }
    var html = '<h2>' + esc(t.task) + '</h2>' +
      '<div class="kv">' + esc([t.entity, t.job, t.area].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      '<div class="kv">Owner <b>' + esc(t.owner || '-') + '</b> \u00b7 Priority <b>' + esc(t.priority || '-') + '</b></div>' +
      '<div class="kv">Status <b>' + esc(t.status) + '</b>' + (t.due ? ' \u00b7 Due <b>' + esc(t.due) + '</b>' : '') +
      (t.completed ? ' \u00b7 Done <b>' + esc(t.completed) + '</b>' : '') + '</div>' +
      (t.phase ? '<div class="kv">' + esc(t.phase) + '</div>' : '') +
      (assignedBy(t) ? '<div class="kv">Assigned by <b>' + esc(assignedBy(t)) + '</b></div>' : '') +
      (t.notes ? '<div class="notes">' + esc(t.notes) + '</div>' : '') +
      (m.owner ? samBlock(t) : '') +
      '<div class="btns">' +
      (t.status === 'Not Started' ? '<button class="btn go" data-act="start">Start</button>' : '') +
      (t.status !== 'Done' ? '<button class="btn ok" data-act="done">Done</button>' : '<button class="btn" data-act="reopen">Reopen</button>') +
      '</div><div class="btns">' +
      '<button class="btn" data-act="assign">\ud83d\udc65 Assign</button>' +
      (m.owner ? '<button class="btn" data-act="edit">Edit</button>' : '') +
      '<button class="btn" data-act="note">Add note</button>' +
      '<button class="btn" data-act="status">Status\u2026</button></div>' +
      (window.E10K.taskExtra ? window.E10K.taskExtra(t) : '');
    sheet(html, function (act) {
      if (act === 'email' && window.E10K.onEmail) return window.E10K.onEmail(t);
      if (act === 'start') return setStatus(t, 'In Progress');
      if (act === 'done') { if (window.E10K.onDone && window.E10K.onDone(t)) return; return setStatus(t, 'Done'); }
      if (act === 'reopen') return setStatus(t, 'In Progress');
      if (act === 'edit') return taskForm(t);
      if (act === 'assign') return assignForm(t);
      if (act === 'note') return noteForm(t);
      if (act === 'sam') return samForm(t);
      if (act === 'status') return statusForm(t);
    });
  }

  function setStatus(t, s) {
    if (s === 'Done' && t.status !== 'Done' && window.E10K.onDone && window.E10K.onDone(t)) return;
    t.status = s; t.completed = s === 'Done' ? todayStr() : '';
    enqueue('task.update', {id: t.id, fields: {status: s}});
    save(); closeSheet(); render(); toast(s === 'Done' ? 'Done \u2713' : s);
  }

  function statusForm(t) {
    var opts = ['Not Started', 'In Progress', 'Waiting', 'Blocked', 'Done'];
    sheet('<h2>Status</h2>' + opts.map(function (o) {
      return '<button class="btn ' + (o === t.status ? 'primary' : '') + '" style="width:100%;margin-bottom:8px" data-act="' + esc(o) + '">' + esc(o) + '</button>'; }).join(''),
      function (act) { setStatus(t, act); });
  }

  // ---------- Tell Sam (owners): a note to Sam on this task; Sam does it and replies here + on the phone ----------
  function samAsksFor(t) { return ((S.data && S.data.samAsks) || []).filter(function (a) { return a.taskId === t.id; }); }
  function samBlock(t) {
    var asks = samAsksFor(t);
    return (asks.length ? '<div class="sam-box">' + asks.map(function (a) {
        var st = a.status === 'Done' ? '<span class="tl-done">done</span>' : a.status === 'Needs you' ? '<span class="tl-soon">needs you</span>' : '<span class="tl-prog">Sam is on it\u2026</span>';
        return '<div class="sam-q"><b>' + esc(a.from) + ':</b> ' + esc(a.text) + ' <span class="sub">\u00b7 ' + st + '</span></div>' +
          (a.reply ? '<div class="sam-a">\ud83e\udd16 <b>Sam:</b> ' + esc(a.reply) + '</div>' : '');
      }).join('') + '</div>' : '') +
      '<div class="btns"><button class="btn" data-act="sam" style="width:100%">\ud83e\udd16 Tell Sam</button></div>';
  }
  function samForm(t) {
    sheet('<h2>\ud83e\udd16 Tell Sam</h2><div class="kv">' + esc(t.task) + '</div>' +
      '<textarea id="sam-t" placeholder="Tap the mic: yes, set it up as a job, call it Mosquito Pass Gate"></textarea>' +
      '<div class="sub">Sam reads these every couple of minutes, does it, and answers right here with a ping on your phone. Anything that would email or text a client comes back to you as a draft first.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Send to Sam</button></div>',
      function (act) {
        if (act !== 'save') return openTask(t.id);
        var v = $('#sam-t').value.trim(); if (!v) return toast('Say what you want done');
        var cid = uid(), m = me();
        S.data.samAsks = (S.data.samAsks || []).concat([{id: 'SR-' + cid, taskId: t.id, text: v, status: 'New', from: m.name}]);
        t.notes = (t.notes ? t.notes + ' | ' : '') + todayStr() + ' ' + m.name + ' \u2192 Sam: ' + v;
        enqueue('sam.ask', {fields: {taskId: t.id, text: v, clientId: cid}});
        save(); render(); openTask(t.id); toast('Sent to Sam');
      });
  }

  function noteForm(t) {
    sheet('<h2>Add a note</h2><div class="kv">' + esc(t.task) + '</div><textarea id="nt" placeholder="Type, or tap 🎤 to talk"></textarea>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>',
      function (act) {
        if (act !== 'save') return closeSheet();
        var v = $('#nt').value.trim(); if (!v) return closeSheet();
        var m = me();
        var add = todayStr() + ' ' + m.name + ': ' + v;
        if (m.owner) { var notes = t.notes ? t.notes + ' | ' + add : add; t.notes = notes; enqueue('task.update', {id: t.id, fields: {notes: notes}}); }
        else { t.notes = t.notes ? t.notes + ' | ' + add : add; enqueue('task.update', {id: t.id, fields: {notes: v}}); }
        save(); closeSheet(); render(); toast('Note saved');
      });
  }

  function options(list, cur, blank) {
    return (blank ? '<option value=""></option>' : '') + (list || []).map(function (o) {
      return '<option ' + (o === cur ? 'selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }

  function taskForm(t) {
    var m = me(), L = S.data.lists || {}, isNew = !t;
    t = t || {entity: 'E10K', owner: m.name, priority: 'Medium', status: 'Not Started'};
    var jobs = S.data.jobs.map(function (j) { return j.name; });
    var html = '<h2>' + (isNew ? 'New task' : 'Edit task') + '</h2>' +
      '<label>Task</label><textarea id="f-task" style="min-height:70px">' + esc(t.task || '') + '</textarea>' +
      (m.owner ? '<label>Business</label><select id="f-entity">' + options(L['Entity'] || ENTITY_ORDER, t.entity) + '</select>' +
        '<label>Job / deal</label><input id="f-job" list="joblist" value="' + esc(t.job || '') + '" placeholder="Pick a job or type a deal">' +
        '<datalist id="joblist">' + jobs.map(function (j) { return '<option value="' + esc(j) + '">'; }).join('') + '</datalist>'
      : '<label>Job</label><select id="f-job">' + options(jobs, t.job || ls.get('lastJob', ''), true) + '</select>') +
      '<label>Area / room</label><input id="f-area" value="' + esc(t.area || '') + '">' +
      (m.owner ? '<label>Who <span class="sub">(tap one or more)</span></label>' + whoPicker('f-who', t.owner) +
        '<label>Priority</label><select id="f-pri">' + options(L['Priority'] || ['High', 'Medium', 'Low'], t.priority) + '</select>' +
        '<div class="two"><div><label>Due</label><input type="date" id="f-due" value="' + usToIso(t.due) + '"></div>' +
        '<div><label>Status</label><select id="f-status">' + options(L['Status'], t.status) + '</select></div></div>' +
        '<label>Phase / category</label><select id="f-phase">' + options(L['Phase / Category'], t.phase, true) + '</select>'
      : (isNew ? '<label>Who <span class="sub">(tap one or more)</span></label>' + whoPicker('f-who', m.name) +
        '<label>Priority</label><select id="f-pri">' + options(['High', 'Medium', 'Low'], 'Medium') + '</select>' +
        '<label>Due</label><input type="date" id="f-due">' : '')) +
      (isNew || !m.owner ? '' : '<label>Notes</label><textarea id="f-notes">' + esc(t.notes || '') + '</textarea>') +
      (isNew ? '<label>Notes</label><textarea id="f-notes" placeholder="Optional"></textarea>' : '') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>';
    sheet(html, function (act) {
      if (act !== 'save') return closeSheet();
      var f = {task: $('#f-task').value.trim(), job: $('#f-job').value.trim(), area: $('#f-area').value.trim()};
      if (!f.task) return toast('Type the task first');
      if (m.owner) {
        f.entity = $('#f-entity').value; f.owners = getWho(); f.owner = f.owners.join(', '); f.priority = $('#f-pri').value;
        if (!f.owners.length) return toast('Pick who it\u2019s for');
        f.due = isoToUs($('#f-due').value); f.status = $('#f-status').value; f.phase = $('#f-phase').value;
      } else if (isNew) {
        f.owners = getWho(); f.owner = f.owners.join(', '); f.priority = $('#f-pri').value; f.due = isoToUs($('#f-due').value);
        if (!f.owners.length) return toast('Pick who it\u2019s for');
        if (!f.job) return toast('Pick the job');
      }
      if ($('#f-notes')) f.notes = $('#f-notes').value.trim();
      if (isNew) {
        var temp = Object.assign({id: 'new-' + uid(), added: todayStr(), status: 'Not Started', owner: m.name, entity: 'E10K', priority: 'Medium'}, f);
        S.data.tasks.push(temp);
        enqueue('task.create', {fields: f, tempId: temp.id});
        var oth = (f.owners || []).filter(function (x) { return x !== m.name; });
        toast(oth.length ? 'Sent to ' + oth.join(', ') : 'Added');
      } else {
        Object.assign(t, f);
        if (f.status === 'Done' && !t.completed) t.completed = todayStr();
        enqueue('task.update', {id: t.id, fields: f});
        toast('Saved');
      }
      save(); closeSheet(); render();
    });
    var getWho = document.getElementById('f-who') ? wireWho('f-who') : function () { return ownersOf(t.owner); };
  }

  // ---------- hours ----------
  function renderHours(noFetch) {
    var list = (S.hours || []).slice().sort(function (a, b) { return (parseD(b.date) || 0) - (parseD(a.date) || 0); });
    var html = '<h2>Hours</h2>', ck = S.data.clock;
    if (ck) html += '<div class="card" style="border:2px solid var(--green)"><div class="title">\ud83d\udfe2 On the clock \u2013 ' + esc(ck.job) + '</div>' +
      '<div class="sub">Since ' + esc(ck.start) + (ck.date !== todayStr() ? ' on ' + esc(ck.date) : '') + ' \u00b7 ' + esc(sinceTxt(ck.date, ck.start)) +
      (ck.machine ? ' \u00b7 ' + esc(ck.machine) + (ck.meterStart ? ' from ' + esc(ck.meterStart) : '') : '') + '</div>' +
      '<button class="btn ok" data-clock="out" style="width:100%;margin-top:10px">Clock out &amp; finish log</button></div>';
    else html += '<button class="btn primary" data-clock="in" style="width:100%;padding:16px;font-size:17px;margin-bottom:10px">\u23f1 Clock in</button>' +
      '<div class="sub" style="margin:-4px 2px 10px">Forgot to clock in? Tap + to log the hours after.</div>';
    html += (window.E10K.mlogBanner ? window.E10K.mlogBanner('hours') : '');
    var oc = (S.data.onClock || []).filter(function (e) { return e.person !== me().name; });
    if (me().owner && oc.length) html += '<h3>On the clock now</h3>' + oc.map(function (e) {
      return '<div class="card"><div class="title">' + esc(e.person) + ' \u00b7 ' + esc(e.job) + '</div><div class="sub">Since ' + esc(e.start) +
        (e.date !== todayStr() ? ' on ' + esc(e.date) : '') + ' \u00b7 ' + esc(sinceTxt(e.date, e.start)) + (e.machine ? ' \u00b7 ' + esc(e.machine) : '') + '</div></div>'; }).join('');
    list = list.filter(function (h) { return h.end || h.pending; });
    if (!list.length) html += '<div class="empty">No hours logged in the last 3 weeks.</div>';
    var last = '';
    list.forEach(function (h) {
      if (h.date !== last) { html += '<h3>' + esc(h.date) + '</h3>'; last = h.date; }
      html += '<div class="card"><div class="row"><div class="grow"><div class="title">' + esc(h.job) + '</div>' +
        '<div class="sub">' + esc((me().owner ? h.person + ' \u00b7 ' : '') + h.start + ' \u2013 ' + h.end) + (h.total ? ' (' + esc(h.total) + ' hrs)' : '') + '</div>' +
        (h.machines || (h.machine ? [{machine: h.machine, meterStart: h.meterStart, meterEnd: h.meterEnd}] : [])).concat(machLogsFor(h)).map(function (x) {
          var hrs = x.hours || (x.meterEnd && x.meterStart ? Math.round((x.meterEnd - x.meterStart) * 10) / 10 : '');
          return '<div class="sub"' + (x.status === 'Open' ? ' style="color:var(--green);font-weight:600"' : '') + '>' + (x.status === 'Open' ? '\ud83d\udfe2 ' : '\u2699 ') + esc(x.machine) +
            (x.meterStart ? ' \u00b7 ' + esc(x.meterStart) + (x.meterEnd ? '\u2192' + esc(x.meterEnd) : '') : '') +
            (hrs !== '' ? ' \u00b7 ' + esc(hrs) + ' hrs' : '') + (x.status === 'Open' ? ' \u00b7 still running' : '') + '</div>';
        }).join('') +
        (h.work ? '<div class="sub">' + esc(h.work) + '</div>' : '') + '</div>' + (h.pending ? '<span class="pill wait">sending</span>' : '') + '</div></div>';
    });
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine && !S.queue.length) api('time.list').then(function (r) {
      if (r.ok) { S.hours = r.entries; S.mlogs = r.mlogs || []; save(); if (S.tab === 'hours') renderHours(true); } }).catch(function () {});
  }
  /** Machine Log rows where this entry's person ran a machine on that day + job (machine hours live apart from man hours). */
  function machLogsFor(h) {
    if (h.pending) return [];
    return (S.mlogs || []).filter(function (x) { return x.operator === h.person && x.date === h.date && x.job === h.job && x.status !== 'Cancelled'; });
  }

  function machLabel(x) { var L = FLAGS[x.status]; return (L ? L.ic + ' ' : '') + x.name + (L ? ' (' + L.short + ')' : ''); }
  function machineLine(i) {
    return '<div class="card mline" data-i="' + i + '" style="padding:10px 12px">' +
      '<div class="row"><select class="h-mach grow">' + '<option value="">Pick machine</option>' +
      S.data.machines.map(function (x) { return '<option value="' + esc(x.name) + '">' + esc(machLabel(x)) + '</option>'; }).join('') + '</select>' +
      '<button class="chip" data-mdel="1" style="margin-left:8px">\u2715</button></div>' +
      '<div class="sub h-warn" style="display:none;font-weight:600;margin-top:6px"></div>' +
      '<div class="two h-met" style="display:none"><div><label>Meter start</label><input inputmode="decimal" class="h-ms"></div>' +
      '<div><label>Meter end</label><input inputmode="decimal" class="h-me" placeholder="blank = still running"></div></div>' +
      '<div class="h-hrsbox" style="display:none"><label>Hours on it</label><input inputmode="decimal" class="h-hrs" placeholder="e.g. 1.5"></div>' +
      '</div>';
  }

  function clockInForm() {
    var jobs = S.data.jobs.map(function (j) { return j.name; });
    sheet('<h2>Clock in</h2><div class="kv">Starting now: <b>' + esc(to12(nowHM())) + '</b></div>' +
      '<label>Which job?</label><select id="ci-job">' + options(jobs, ls.get('lastJob', ''), true) + '</select>' +
      '<div class="sub">Machines and their hours go in when you clock out. Starting hours fill in from the last log.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Clock in</button></div>', function (act) {
      if (act !== 'save') return closeSheet();
      var job = $('#ci-job').value; if (!job) return toast('Pick the job');
      var f = {job: job, at: to12(nowHM()), date: todayStr(), clientId: uid()};
      S.data.clock = {id: f.clientId.slice(0, 8), person: me().name, date: f.date, job: job, start: f.at, machine: '', meterStart: ''};
      ls.set('lastJob', job);
      enqueue('time.clockin', {fields: f});
      save(); closeSheet(); render(); toast('Clocked in at ' + f.at);
    });
  }
  function wireLine(el) {
    var mc = mach(el.querySelector('.h-mach').value);
    el.querySelector('.h-met').style.display = mc && mc.meter ? 'flex' : 'none';
    el.querySelector('.h-hrsbox').style.display = mc && !mc.meter && !el.closest('#sheet-body').querySelector('#ci-job') ? 'block' : 'none';
    var msEl = el.querySelector('.h-ms'), known = mc && mc.hours !== null && mc.hours !== undefined;
    if (known && (!msEl.value || msEl.getAttribute('data-auto') === '1')) { msEl.value = mc.hours; msEl.setAttribute('data-auto', '1'); }
    msEl.placeholder = known ? '' : 'first time: enter it';
    var hint = el.querySelector('.h-mshint');
    if (!hint) { msEl.insertAdjacentHTML('afterend', '<div class="sub h-mshint"></div>'); hint = el.querySelector('.h-mshint'); }
    hint.textContent = known ? 'from last log' : 'no hours on file yet';
    msEl.oninput = function () { msEl.setAttribute('data-auto', '0'); };
    var meEl = el.querySelector('.h-me'); if (meEl) meEl.placeholder = 'blank = still running';
    var run = mc && window.E10K.mlogOpenFor ? window.E10K.mlogOpenFor(mc.name) : null;
    if (run) { if (!msEl.value || msEl.getAttribute('data-auto') === '1') { msEl.value = run.meterStart || msEl.value; msEl.setAttribute('data-auto', '1'); }
      hint.textContent = '\ud83d\udfe2 running since ' + (run.startedAt || run.date) + ' (' + run.startedBy + ') \u2013 your end reading closes it'; }
    var w = el.querySelector('.h-warn'), L = mc && FLAGS[mc.status];
    if (L) { w.style.display = 'block'; w.style.color = L.color; w.textContent = L.ic + ' ' + L.label + (mc.note ? ': ' + mc.note : ''); }
    else w.style.display = 'none';
  }
  function clockOut() {
    var ck = S.data.clock; if (!ck) return;
    hoursForm({id: ck.id, date: ck.date, job: ck.job, start: to24(ck.start), end: nowHM(),
      machines: ck.machine ? [{machine: ck.machine, meterStart: ck.meterStart}] : []});
  }

  function hoursForm(pre) {
    var m = me(), jobs = S.data.jobs.map(function (j) { return j.name; });
    pre = pre || null;
    var html = '<h2>' + (pre ? 'Clock out \u2013 finish your log' : 'Log hours') + '</h2>' +
      (m.owner && !pre ? '<label>Who</label><select id="h-person">' + options(S.data.people, m.name) + '</select>' : '') +
      '<label>Date</label><input type="date" id="h-date" value="' + usToIso(pre ? pre.date : todayStr()) + '"' + (pre ? ' disabled' : '') + '>' +
      '<label>Job</label><select id="h-job">' + options(jobs, pre ? pre.job : ls.get('lastJob', ''), true) + '</select>' +
      '<div class="two"><div><label>Start</label><input type="time" id="h-start" value="' + (pre ? pre.start : '07:00') + '"></div>' +
      '<div><label>End</label><input type="time" id="h-end" value="' + (pre ? pre.end : '') + '"></div></div>' +
      '<label>Machines used <span class="sub">(skip if none)</span></label><div id="h-mlist"></div>' +
      '<button class="btn" id="h-madd" style="width:100%">+ Add a machine</button>' +
      '<label>What you did</label><textarea id="h-work" placeholder="Type, or tap 🎤 to talk"></textarea>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>';
    var n = 0;
    function addLine() {
      $('#h-mlist').insertAdjacentHTML('beforeend', machineLine(n++));
      $('#h-madd').textContent = '+ Add another machine';
    }
    sheet(html, function (act) {
      if (act !== 'save') return closeSheet();
      var f = {date: isoToUs($('#h-date').value), job: $('#h-job').value, start: to12($('#h-start').value), end: to12($('#h-end').value),
        work: $('#h-work').value.trim(), machines: []};
      if (m.owner) f.person = $('#h-person').value;
      if (!f.job) return toast('Pick the job');
      if (!f.start || !f.end) return toast('Fill in start and end time');
      var lines = Array.prototype.slice.call(document.querySelectorAll('#h-mlist .mline'));
      for (var i = 0; i < lines.length; i++) {
        var el = lines[i], name = el.querySelector('.h-mach').value; if (!name) continue;
        var mc = mach(name), x = {machine: name, meterStart: el.querySelector('.h-ms').value.trim(), meterEnd: el.querySelector('.h-me').value.trim(),
          hours: el.querySelector('.h-hrs').value.trim()};
        if (mc && mc.meter) {
          if (!x.meterStart || isNaN(+x.meterStart)) { el.querySelector('.h-ms').focus(); return toast('Enter the hour meter at start for ' + name); }
          if (x.meterEnd && isNaN(+x.meterEnd)) { el.querySelector('.h-me').focus(); return toast('The end reading for ' + name + ' isn\u2019t a number'); }
          if (x.meterEnd && +x.meterEnd < +x.meterStart) { el.querySelector('.h-me').focus(); return toast(name + ': meter end is lower than start'); }
          if (mc.hours !== null && mc.hours !== undefined && +x.meterStart < mc.hours &&
            !confirm(name + ': meter start (' + x.meterStart + ') is lower than the last reading (' + mc.hours + '). Save anyway?')) return;
          if (mc.hours !== null && mc.hours !== undefined && +x.meterStart > mc.hours + 300 &&
            !confirm(name + ': meter start is ' + Math.round(+x.meterStart - mc.hours) + ' hrs more than the last reading (' + mc.hours + '). Is that right?')) return;
        }
        f.machines.push(x);
      }
      if (!f.work) return toast('Say what you did');
      var t0 = to24(f.start).split(':'), t1 = to24(f.end).split(':');
      var span = ((+t1[0] * 60 + +t1[1]) - (+t0[0] * 60 + +t0[1]) + 1440) % 1440 / 60;
      var onM = f.machines.reduce(function (a, x) { var v = x.meterEnd && x.meterStart ? x.meterEnd - x.meterStart : (+x.hours || 0); return a + (v > 0 ? v : 0); }, 0);
      var stillOn = f.machines.filter(function (x) { var mc = mach(x.machine); return mc && (mc.meter ? !x.meterEnd : !x.hours); }).map(function (x) { return x.machine; });
      if (onM > span + 0.25 && !confirm('Machine hours (' + onM.toFixed(1) + ') are more than your time on the job (' + span.toFixed(1) + ' hrs). Save anyway?')) return;
      f.machines.forEach(function (x) { var mc = mach(x.machine); if (mc && mc.meter && (x.meterEnd || x.meterStart)) mc.hours = Math.max(mc.hours || 0, +(x.meterEnd || x.meterStart)); });
      var src = pre ? pre.id : null;   // filled below for after-the-fact logs
      var localLogs = function (base) {   // same IDs the server gives, so a close-out made before this syncs still finds it
        f.machines.forEach(function (x, i) {
          var run = window.E10K.mlogOpenFor ? window.E10K.mlogOpenFor(x.machine) : null, mc = mach(x.machine);
          var done = mc && (mc.meter ? !!x.meterEnd : !!x.hours);
          if (run && done) S.data.mlogOpen = S.data.mlogOpen.filter(function (l) { return l !== run; });
          if (!run && !done) (S.data.mlogOpen = S.data.mlogOpen || []).push({id: 'ML-' + String(base).slice(0, 8) + '-' + (i + 1), date: f.date, machine: x.machine, job: f.job,
            operator: f.person || m.name, meterStart: x.meterStart, status: 'Open', startedBy: m.name, startedAt: to12(nowHM()), pending: true});
        });
      };
      ls.set('lastJob', f.job);
      if (pre) {
        f.id = pre.id; f.date = pre.date;
        S.data.clock = null;
        S.hours = (S.hours || []).filter(function (h) { return h.id !== pre.id; });
        S.hours.unshift(Object.assign({pending: true, person: m.name}, f));
        localLogs(f.id);
        enqueue('time.clockout', {fields: f});
        save(); closeSheet(); render(); toast('Clocked out \u2013 hours logged' + (stillOn.length ? '. Still running: ' + stillOn.join(', ') : ''));
        return;
      }
      f.clientId = uid();
      localLogs(f.clientId);
      S.hours.unshift(Object.assign({pending: true, person: f.person || m.name}, f));
      enqueue('time.create', {fields: f});
      save(); closeSheet(); render(); toast('Hours logged' + (stillOn.length ? '. Still running: ' + stillOn.join(', ') : ''));
    });
    $('#h-madd').onclick = function (e) { e.stopPropagation(); addLine(); };
    if (pre && pre.machines) pre.machines.forEach(function (x) {
      addLine(); var el = document.querySelector('#h-mlist .mline:last-child');
      el.querySelector('.h-mach').value = x.machine; wireLine(el); el.querySelector('.h-ms').value = x.meterStart || '';
    });
    $('#h-mlist').onchange = function (e) { var el = e.target.closest('.mline'); if (el && e.target.classList.contains('h-mach')) wireLine(el); };
    $('#h-mlist').onclick = function (e) {
      var d = e.target.closest('[data-mdel]'); if (!d) return; e.stopPropagation();
      d.closest('.mline').remove();
      if (!document.querySelector('#h-mlist .mline')) $('#h-madd').textContent = '+ Add a machine';
    };
  }

  // ---------- walkthroughs ----------
  function renderWalks() {
    var list = S.walks || [];
    var jobs = [];
    list.forEach(function (w) { if (w.job && jobs.indexOf(w.job) < 0) jobs.push(w.job); });
    var jf = ls.get('walkJob', '');
    if (jf && jobs.indexOf(jf) < 0) jf = '';
    var html = '<h2>Walkthroughs</h2>';
    if (jobs.length > 1) html += '<div class="chips" id="wjobs"><button class="chip' + (!jf ? ' on' : '') + '" data-wjob="">All jobs</button>' +
      jobs.map(function (j) { return '<button class="chip' + (j === jf ? ' on' : '') + '" data-wjob="' + esc(j) + '">' + esc(j) + '</button>'; }).join('') + '</div>';
    var shown = list.filter(function (w) { return !jf || w.job === jf; });
    if (!shown.length) html += '<div class="empty">No walkthroughs yet.<br>Tap + on site to start one.</div>';
    var groups = jf ? [jf] : jobs.filter(function (j) { return shown.some(function (w) { return w.job === j; }); });
    if (shown.some(function (w) { return !w.job; })) groups.push('');
    groups.forEach(function (g) {
      if (!jf) html += '<h3>' + esc(g || 'No job') + '</h3>';
      shown.filter(function (w) { return (w.job || '') === g; }).forEach(function (w) {
        var i = list.indexOf(w);
        var pill = w.pending ? '<span class="pill wait">sending</span>' : w.sent ? '<span class="pill done">sent ' + esc(shortD(w.sent)) + '</span>' :
          (w.processed ? '<span class="pill">tasks made</span>' : '');
        html += '<div class="card" data-walk="' + i + '" style="cursor:pointer"><div class="row"><div class="grow">' +
          '<div class="title">' + esc(w.date) + (jf ? '' : '') + ' \u00b7 ' + esc(w.by) + '</div>' +
          '<div class="sub">' + (w.photos ? w.photos + ' photo' + (w.photos > 1 ? 's' : '') + ' \u00b7 ' : '') + 'tap to read</div>' +
          (w.summary ? '<div class="sub" style="margin-top:4px">' + esc(firstLine(w.summary)) + '</div>' : '') + '</div>' + pill + '</div></div>';
      });
    });
    $('#view').innerHTML = html;
    if (navigator.onLine && !S.queue.length && !renderWalks.busy) {
      renderWalks.busy = true;
      api('walk.list').then(function (r) { if (r.ok) { S.walks = r.walks; save(); if (S.tab === 'walks') renderWalksNoFetch(); } })
        .catch(function () {}).then(function () { renderWalks.busy = false; });
    }
  }
  function firstLine(t) { var l = String(t).split('\n')[0].replace(/^[-\u2022*]\s*/, ''); return l.length > 110 ? l.slice(0, 107) + '\u2026' : l; }
  function textBlock(t) {
    return '<div style="white-space:pre-wrap;line-height:1.45;font-size:15px">' + esc(String(t || '').replace(/\\n/g, '\n')) + '</div>';
  }

  function walkDetail(w) {
    var html = '<h2>' + esc(w.job || 'Walkthrough') + '</h2><div class="kv">' + esc(w.date + ' \u00b7 ' + w.by) +
      (w.sent ? ' \u00b7 update sent ' + esc(shortD(w.sent)) + (w.sentTo ? ' to ' + esc(w.sentTo) : '') : '') + '</div>' +
      (w.summary ? '<h3>What we saw</h3><div class="card">' + textBlock(w.summary) + '</div>' : '') +
      (w.actions ? '<h3>What needs done</h3><div class="card">' + textBlock(w.actions) + '</div>' : '') +
      (w.processed ? '<div class="kv">Sam turned these into tasks.</div>' : '') +
      (w.photos ? '<h3>Photos</h3><div class="photos" id="wd-ph"><div class="sub">Loading photos\u2026</div></div>' : '') +
      '<div class="btns"><button class="btn" data-act="x">Close</button>' +
      (me().owner && !w.pending ? '<button class="btn primary" data-act="mail">' + (w.sent ? 'Send another update' : 'Email update to client') + '</button>' : '') + '</div>';
    sheet(html, function (act) {
      if (act === 'mail') return walkEmailForm(w);
      closeSheet();
    });
    var showPh = function (r) {
      var el = $('#wd-ph'); if (!el || !r || !r.ok) return;
      el.innerHTML = r.photos.map(function (ph) {
        return ph.data ? '<img src="' + ph.data + '" data-big="1" style="cursor:zoom-in">' : '<a href="' + esc(ph.url) + '" target="_blank" class="sub">Open photo</a>';
      }).join('');
      el.onclick = function (e) {
        var im = e.target.closest('img'); if (!im) return;
        var v = document.createElement('div'); v.id = 'photo-viewer';
        v.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:99;display:flex;align-items:center;justify-content:center';
        v.innerHTML = '<img src="' + im.src + '" style="max-width:100%;max-height:100%">'; v.onclick = function () { v.remove(); };
        document.body.appendChild(v);
      };
    };
    if (w.photos && w.id) idb.get('walk:' + w.id).catch(function () { return null; }).then(function (hit) {
      if (hit && hit.ok) return showPh(hit);
      return api('walk.get', {id: w.id}).then(function (r) {
        showPh(r);
        if (r.ok && r.photos.every(function (x) { return x.data; })) idb.set('walk:' + w.id, r).catch(function () {});
      });
    }).catch(function () { var el = $('#wd-ph'); if (el) el.innerHTML = '<div class="sub">Photos need a signal.</div>'; });
  }

  function walkDraft(w) {
    if (w.draft) return w.draft;
    var first = (w.client || '').split(/[\s(&,]/)[0] || 'there';
    var b = 'Hi ' + first + ',\n\nHere\'s a quick update from ' + (w.job || 'the job') + ' on ' + shortD(w.date) + ':\n\n';
    if (w.summary) b += String(w.summary).split('\n').map(function (l) { l = l.replace(/^[-\u2022*]\s*/, '').trim(); return l ? '- ' + l : ''; }).filter(String).join('\n') + '\n\n';
    if (w.actions) b += 'Next up:\n' + String(w.actions).split('\n').map(function (l) { l = l.replace(/^[-\u2022*]\s*/, '').trim(); return l ? '- ' + l : ''; }).filter(String).join('\n') + '\n\n';
    return b + 'Let me know if you have any questions.';
  }

  function walkEmailForm(w) {
    var sig = '\n\n' + me().name + (me().name === 'Spencer' ? ' Thomas' : '') + '\nElevation 10 Thousand';
    var body = walkDraft(w);
    if (body.indexOf('Elevation 10 Thousand') < 0) body += sig;
    var subj = (w.job || 'Job') + ' update \u2013 ' + shortD(w.date);
    var html = '<h2>Email update</h2>' +
      '<label>To' + (w.client ? ' (' + esc(w.client) + ')' : '') + '</label><input id="we-to" type="email" value="' + esc(w.clientEmail || '') + '" placeholder="client@email.com">' +
      (w.clientEmail ? '' : '<div class="sub">No email on file for this job yet. It will be saved after you send.</div>') +
      '<label>Subject</label><input id="we-sub" value="' + esc(subj) + '">' +
      '<label>Message <span class="sub">(edit anything)</span></label><textarea id="we-body" style="min-height:300px">' + esc(body) + '</textarea>' +
      (w.photos ? '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="we-att" checked style="width:auto"> Attach the ' + w.photos + ' photo' + (w.photos > 1 ? 's' : '') + '</label>' : '') +
      '<div class="sub" style="margin-top:8px">Send: goes out from Sam\'s email as "Elevation 10 Thousand". You\'re cc\'d and replies come to you. ' +
      'My email: opens it in your own email app instead (no photos).</div>' +
      '<div class="btns"><button class="btn" data-act="back">Back</button><button class="btn" data-act="mailto">My email</button><button class="btn ok" data-act="send">Send</button></div>';
    sheet(html, function (act) {
      if (act === 'back') return walkDetail(w);
      var to = $('#we-to').value.trim(), sub = $('#we-sub').value.trim(), b = $('#we-body').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+/.test(to)) return toast('Enter the client\'s email');
      if (act === 'mailto') {
        location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(b);
        return setTimeout(function () {
          sheet('<h2>Did you send it?</h2><div class="kv">To ' + esc(to) + '<br>' + esc(sub) + '</div>' +
            '<div class="sub">Tap Yes once it\'s sent from your email and the walkthrough gets marked as sent.</div>' +
            '<div class="btns"><button class="btn" data-act="no">Not sent</button><button class="btn ok" data-act="yes">Yes, log it</button></div>', function (a2) {
            if (a2 !== 'yes') return walkDetail(w);
            enqueue('walk.email', {fields: {id: w.id, to: to, subject: sub, body: b, logOnly: true}});
            w.sent = todayStr(); w.sentTo = to; w.draft = b; if (!w.clientEmail) w.clientEmail = to;
            save(); closeSheet(); render(); toast('Logged as sent');
          });
        }, 600);
      }
      if (act !== 'send') return;
      if (!navigator.onLine) return toast('Needs a signal to send');
      var btn = document.querySelector('#sheet [data-act=send]'); btn.disabled = true; btn.textContent = 'Sending\u2026';
      api('walk.email', {fields: {id: w.id, to: to, subject: sub, body: b, attach: !!($('#we-att') && $('#we-att').checked)}}).then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = 'Send'; return toast(r.error === 'bad_email' ? 'That email doesn\'t look right' : 'Didn\'t send \u2013 try again'); }
        w.sent = r.sent; w.sentTo = r.to; w.draft = b; if (!w.clientEmail) w.clientEmail = to;
        (S.walks || []).forEach(function (x) { if (x.job === w.job && !x.clientEmail) x.clientEmail = to; });
        save(); closeSheet(); render(); toast('Update sent to ' + to);
      }).catch(function () { btn.disabled = false; btn.textContent = 'Send'; toast('No signal \u2013 try again'); });
    });
  }
  function renderWalksNoFetch() { renderWalks.busy = true; renderWalks(); renderWalks.busy = false; }

  function shrink(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1280, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = rej; img.src = url;
    });
  }

  function walkForm() {
    var jobs = S.data.jobs.map(function (j) { return j.name; }), photos = [];
    var html = '<h2>New walkthrough</h2>' +
      '<label>Job</label><select id="w-job">' + options(jobs, ls.get('lastJob', ''), true) + '</select>' +
      '<label>What you saw</label><textarea id="w-sum" placeholder="Type, or tap 🎤 and just talk"></textarea>' +
      '<label>What needs done</label><textarea id="w-act" placeholder="One item per line"></textarea>' +
      '<label>Photos</label><input type="file" id="w-ph" accept="image/*" multiple><div class="photos" id="w-prev"></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>';
    sheet(html, function (act) {
      if (act !== 'save') return closeSheet();
      var f = {job: $('#w-job').value, summary: $('#w-sum').value.trim(), actions: $('#w-act').value.trim(), photos: photos, clientId: uid()};
      if (!f.job) return toast('Pick the job');
      if (!f.summary && !f.actions && !photos.length) return toast('Add notes or photos');
      S.walks.unshift({job: f.job, date: todayStr(), by: me().name, summary: f.summary, photos: photos.length, pending: true});
      enqueue('walk.create', {fields: f});
      ls.set('lastJob', f.job);
      save(); closeSheet(); render(); toast('Walkthrough saved');
    });
    $('#w-ph').onchange = function (e) {
      Array.prototype.forEach.call(e.target.files, function (file) {
        shrink(file).then(function (d) {
          photos.push({data: d, type: 'image/jpeg'});
          var im = document.createElement('img'); im.src = d; $('#w-prev').appendChild(im);
        }).catch(function () { toast('Could not read a photo'); });
      });
      e.target.value = '';
    };
  }

  // ---------- sheet ----------
  var sheetHandler = null;
  // ---------- phone back button ----------
  // Each screen change made by a tap adds a history entry, so Android's back button steps back
  // (closes a pop-up, leaves a machine page, returns to the previous tab) instead of leaving the app.
  var sheetEntry = false, skipPop = 0;
  function navState() { return {e10k: 1, tab: S.tab, machine: window.E10K && window.E10K.curMachine ? window.E10K.curMachine() : null}; }
  function navPush() { try { history.pushState(navState(), ''); } catch (e) {} }
  try { history.replaceState(navState(), ''); } catch (e) {}
  window.addEventListener('popstate', function (e) {
    if (skipPop > 0) { skipPop--; return; }
    var viewer = document.getElementById('photo-viewer'); if (viewer) viewer.remove();
    if (!$('#sheet').classList.contains('hidden')) { sheetEntry = false; hideSheet(); return; }
    var st = e.state || {};
    if (!st.e10k) return;
    var changed = st.tab && st.tab !== S.tab;
    if (st.tab) { S.tab = st.tab; ls.set('tab', S.tab); }
    if (window.E10K && window.E10K.setMachine) window.E10K.setMachine(st.machine || null);
    window.scrollTo(0, 0);
    if (changed) { S.chip = 'All'; S.filter = ''; }
    render();
  });

  function sheet(html, onAct) {
    if ($('#sheet').classList.contains('hidden') && !sheetEntry) { sheetEntry = true; try { history.pushState(Object.assign(navState(), {sheet: 1}), ''); } catch (e) {} }
    $('#sheet-body').innerHTML = html; sheetHandler = onAct;
    $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  }
  function hideSheet() { $('#sheet').classList.add('hidden'); document.body.style.overflow = ''; sheetHandler = null; }
  function closeSheet() {
    hideSheet();
    if (sheetEntry) { sheetEntry = false; skipPop++; history.back(); }
  }

  function signedOut() {
    $('#tabs').innerHTML = ''; $('#fab').classList.add('hidden');
    $('#view').innerHTML = '<div class="signin"><img src="logo-word.png" alt="E10K"><p>Open the private E10K link Sam sent you to sign in.</p>' +
      '<p style="font-size:13px">If you already did and still see this, ask Sam for a new link.</p></div>';
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) {
      var nt = b.getAttribute('data-tab'), same = nt === S.tab;
      S.tab = nt; ls.set('tab', S.tab); S.chip = 'All'; S.filter = ''; window.scrollTo(0, 0);
      if (window.E10K.setMachine) window.E10K.setMachine(null);
      if (!same) navPush(); else try { history.replaceState(navState(), ''); } catch (e) {}
      return render();
    }
    var al = e.target.closest('[data-alerts]');
    if (al) { if (al.getAttribute('data-alerts') === 'on') turnOnAlerts(); else { ls.set('alertsHide', true); render(); } return; }
    var ckb = e.target.closest('[data-clock]');
    if (ckb) return ckb.getAttribute('data-clock') === 'in' ? clockInForm() : clockOut();
    var fg = e.target.closest('[data-flag]');
    if (fg) { S.tab = 'equip'; ls.set('tab', 'equip'); window.scrollTo(0, 0); render(); if (window.E10K.openMachine) window.E10K.openMachine(fg.getAttribute('data-flag')); return; }
    var c = e.target.closest('[data-chip]'); if (c) { S.chip = c.getAttribute('data-chip'); return renderTasks(); }
    var wj = e.target.closest('[data-wjob]'); if (wj) { ls.set('walkJob', wj.getAttribute('data-wjob')); return renderWalks(); }
    var wk = e.target.closest('[data-walk]'); if (wk) { var w = (S.walks || [])[+wk.getAttribute('data-walk')]; if (w) return walkDetail(w); }
    var bf = e.target.closest('[data-brief]'); if (bf) return openBriefing();
    var t = e.target.closest('[data-task]'); if (t) { if (t.dataset.swiped || t.classList.contains('sw-open')) return; return openTask(t.getAttribute('data-task')); }
    var a = e.target.closest('#sheet [data-act]'); if (a && sheetHandler) return sheetHandler(a.getAttribute('data-act'));
    if (e.target.classList.contains('sheet-bg')) return closeSheet();
  });
  $('#fab').onclick = function () {
    if (!S.data) return;
    if (S.tab === 'hours') return hoursForm();
    if (S.tab === 'walks') return walkForm();
    var ex = EXTRA_TABS.filter(function (x) { return x.k === S.tab; })[0];
    if (ex) return ex.fab();
    taskForm(null);
  };
  window.addEventListener('online', function () { syncBadge(); flush().then(function () { refresh(true); }); });
  window.addEventListener('offline', syncBadge);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (S.queue.length) flush(); else if (Date.now() - lastRefresh > 60000) refresh(true);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.openTask) refresh(true).then(function () { openTask(e.data.openTask); });
    });
  }
  var deep = (location.hash.match(/#task=([A-Za-z0-9\-]+)/) || [])[1] || (/#briefing\b/.test(location.hash) ? 'BRIEFING' : '');
  if (deep) setTimeout(function () { refresh(true).then(function () { S.tab = 'mine'; render(); openTask(deep); }); }, 300);

  window.E10K = {
    $: $, esc: esc, ls: ls, toast: toast, api: api, S: S, enqueue: enqueue, sheet: sheet, closeSheet: closeSheet,
    shrink: shrink, uid: uid, todayStr: todayStr, usToIso: usToIso, isoToUs: isoToUs, svg: svg, me: me, idb: idb, mach: mach,
    options: options, to12: to12, nowHM: nowHM, sinceTxt: sinceTxt, flush: flush, syncBadge: syncBadge,
    addTab: function (t) { EXTRA_TABS.push(t); }, save: save, render: render, renderFlags: renderFlags, shortD: shortD, FLAGS: FLAGS, navPush: navPush
  };
  document.addEventListener('DOMContentLoaded', function () {
    render(); syncBadge();
    loadQueue().then(function () { syncBadge(); if (TOKEN) { if (S.queue.length) flush(); else refresh(!!S.data); } });
  });
  setInterval(function () { if (!document.hidden) refresh(true); }, 120000);
})();
