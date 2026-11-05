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
    set: function (k, v) { try { localStorage.setItem('e10k.' + k, JSON.stringify(v)); } catch (e) {} }
  };

  // ---------- token ----------
  function readToken() {
    var m = location.hash.match(/[#&]t=([A-Za-z0-9_\-]{24,})/);
    if (m) {
      if (ls.get('token', null) !== m[1]) {   // new person on this phone: drop the old copy
        ['data', 'hours', 'walks', 'queue', 'tab'].forEach(function (k) { localStorage.removeItem('e10k.' + k); });
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
    queue: ls.get('queue', []),          // pending writes
    tab: ls.get('tab', 'mine'),
    filter: '', chip: 'All'
  };
  function me() { return S.data && S.data.me || {}; }
  function save() { ls.set('data', S.data); ls.set('queue', S.queue); ls.set('hours', S.hours); ls.set('walks', S.walks); }

  // ---------- api ----------
  function api(action, args) {
    var body = Object.assign({}, args || {}, {token: TOKEN, action: action});
    return fetch(API, {method: 'POST', body: JSON.stringify(body), redirect: 'follow'})
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok && j.error === 'not_signed_in') { signedOut(); throw new Error('not_signed_in'); }
        return j;
      });
  }

  function uid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(-8); }

  function enqueue(action, args) {
    S.queue.push({id: uid(), action: action, args: args, tries: 0});
    save(); syncBadge(); flush();
  }

  var flushing = false;
  function flush() {
    if (flushing || !S.queue.length || !navigator.onLine) { syncBadge(); return Promise.resolve(); }
    flushing = true; syncBadge();
    var job = S.queue[0];
    return api(job.action, job.args).then(function (r) {
      S.queue.shift();
      if (!r.ok) toast('Could not save: ' + (r.error || 'error').replace(/_/g, ' '));
      if (r.task) upsertTask(r.task);
      save();
    }).catch(function (e) {
      job.tries++; save();
    }).then(function () {
      flushing = false; syncBadge();
      if (S.queue.length && S.queue[0].tries < 50) setTimeout(flush, S.queue[0].tries ? 15000 : 100);
      else if (!S.queue.length) refresh(true);
    });
  }

  function syncBadge() {
    var el = $('#sync');
    if (!navigator.onLine) { el.textContent = 'offline' + (S.queue.length ? ' \u00b7 ' + S.queue.length + ' to send' : ''); el.className = 'sync warn'; }
    else if (S.queue.length) { el.textContent = 'sending ' + S.queue.length + '\u2026'; el.className = 'sync warn'; }
    else { el.textContent = ''; el.className = 'sync'; }
  }

  function refresh(quiet) {
    if (!TOKEN) return Promise.resolve();
    if (S.queue.length) return flush();
    return api('bootstrap').then(function (r) {
      if (!r.ok) return;
      S.data = r; save(); render();
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
  function tabsFor() {
    var t = [{k: 'mine', ic: ICONS.check, n: 'My Tasks'}];
    t.push({k: 'all', ic: ICONS.list, n: me().owner ? 'All Open' : 'Job Tasks'});
    t.push({k: 'hours', ic: ICONS.clock, n: 'Hours'});
    t.push({k: 'walks', ic: ICONS.mtn, n: 'Walkthroughs'});
    return t;
  }

  function render() {
    if (!TOKEN) return signedOut();
    if (!S.data) { $('#view').innerHTML = '<div class="empty">Loading\u2026</div>'; return; }
    var tabs = tabsFor();
    if (!tabs.some(function (t) { return t.k === S.tab; })) S.tab = 'mine';
    $('#tabs').innerHTML = tabs.map(function (t) {
      var badge = t.k === 'mine' && newCount() ? '<span class="badge">' + newCount() + '</span>' : '';
      return '<button data-tab="' + t.k + '" class="' + (S.tab === t.k ? 'on' : '') + '"><span class="ic">' + t.ic + badge + '</span>' + t.n + '</button>';
    }).join('');
    $('#fab').classList.remove('hidden');
    if (S.tab === 'hours') return renderHours();
    if (S.tab === 'walks') return renderWalks();
    renderTasks();
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

  function renderTasks() {
    var all = S.data.tasks || [], m = me();
    var list = all.filter(function (t) {
      if (S.tab === 'mine') {
        if (t.owner !== m.name && !(m.owner && t.owner === 'Both')) return false;
        return t.status !== 'Done' || t.completed === todayStr();
      }
      return t.status !== 'Done';
    });
    var groupKey = m.owner && S.tab === 'mine' ? 'entity' : (m.owner ? 'entity' : 'job');
    var groups = {};
    list.forEach(function (t) { var g = t[groupKey] || 'Other'; (groups[g] = groups[g] || []).push(t); });
    var names = Object.keys(groups).sort(function (a, b) {
      var ia = ENTITY_ORDER.indexOf(a), ib = ENTITY_ORDER.indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99; return ia - ib || a.localeCompare(b);
    });
    var chips = ['All'].concat(names);
    if (chips.indexOf(S.chip) < 0) S.chip = 'All';
    var q = S.filter.toLowerCase();
    var html = (S.tab === 'mine' ? alertsBanner() : '') + '<input class="search" id="q" placeholder="Search tasks" value="' + esc(S.filter) + '">';
    if (names.length > 1) html += '<div class="chips">' + chips.map(function (c) {
      return '<button class="chip ' + (S.chip === c ? 'on' : '') + '" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
    var shown = 0;
    if (S.tab === 'mine' && S.chip === 'All' && !q) {
      var fresh = sortTasks(list.filter(isNewFor));
      if (fresh.length) { shown += fresh.length; html += '<h3 class="newh">New for you (' + fresh.length + ')</h3>' + fresh.map(taskCard).join(''); }
    }
    names.forEach(function (g) {
      if (S.chip !== 'All' && S.chip !== g) return;
      var items = sortTasks(groups[g].filter(function (t) {
        if (S.tab === 'mine' && S.chip === 'All' && !q && isNewFor(t)) return false;
        return !q || (t.task + ' ' + t.job + ' ' + t.area + ' ' + t.notes + ' ' + t.owner).toLowerCase().indexOf(q) >= 0; }));
      if (!items.length) return;
      shown += items.length;
      html += '<h3>' + esc(g) + ' (' + items.length + ')</h3>' + items.map(taskCard).join('');
    });
    if (!shown) html += '<div class="empty">' + (S.tab === 'mine' ? 'Nothing on your list. Nice.' : 'No open tasks.') + '</div>';
    $('#view').innerHTML = html;
    var qi = $('#q'); qi.oninput = function () { S.filter = qi.value; var pos = qi.selectionStart; renderTasks(); var n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
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

  function findTask(id) { return (S.data.tasks || []).find(function (t) { return t.id === id; }); }

  function openTask(id) {
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
      '<div class="btns">' +
      (t.status === 'Not Started' ? '<button class="btn go" data-act="start">Start</button>' : '') +
      (t.status !== 'Done' ? '<button class="btn ok" data-act="done">Done</button>' : '<button class="btn" data-act="reopen">Reopen</button>') +
      '</div><div class="btns">' +
      (m.owner ? '<button class="btn" data-act="edit">Edit</button>' : '') +
      '<button class="btn" data-act="note">Add note</button>' +
      '<button class="btn" data-act="status">Status\u2026</button></div>';
    sheet(html, function (act) {
      if (act === 'start') return setStatus(t, 'In Progress');
      if (act === 'done') return setStatus(t, 'Done');
      if (act === 'reopen') return setStatus(t, 'In Progress');
      if (act === 'edit') return taskForm(t);
      if (act === 'note') return noteForm(t);
      if (act === 'status') return statusForm(t);
    });
  }

  function setStatus(t, s) {
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

  function noteForm(t) {
    sheet('<h2>Add a note</h2><div class="kv">' + esc(t.task) + '</div><textarea id="nt" placeholder="Tap the mic on your keyboard to talk"></textarea>' +
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
      (m.owner ? '<div class="two"><div><label>Who</label><select id="f-owner">' + options(L['Owner'] || S.data.people, t.owner) + '</select></div>' +
        '<div><label>Priority</label><select id="f-pri">' + options(L['Priority'] || ['High', 'Medium', 'Low'], t.priority) + '</select></div></div>' +
        '<div class="two"><div><label>Due</label><input type="date" id="f-due" value="' + usToIso(t.due) + '"></div>' +
        '<div><label>Status</label><select id="f-status">' + options(L['Status'], t.status) + '</select></div></div>' +
        '<label>Phase / category</label><select id="f-phase">' + options(L['Phase / Category'], t.phase, true) + '</select>'
      : (isNew ? '<div class="two"><div><label>Who</label><select id="f-owner">' + options(S.data.people, m.name) + '</select></div>' +
        '<div><label>Priority</label><select id="f-pri">' + options(['High', 'Medium', 'Low'], 'Medium') + '</select></div></div>' +
        '<label>Due</label><input type="date" id="f-due">' : '')) +
      (isNew || !m.owner ? '' : '<label>Notes</label><textarea id="f-notes">' + esc(t.notes || '') + '</textarea>') +
      (isNew ? '<label>Notes</label><textarea id="f-notes" placeholder="Optional"></textarea>' : '') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>';
    sheet(html, function (act) {
      if (act !== 'save') return closeSheet();
      var f = {task: $('#f-task').value.trim(), job: $('#f-job').value.trim(), area: $('#f-area').value.trim()};
      if (!f.task) return toast('Type the task first');
      if (m.owner) {
        f.entity = $('#f-entity').value; f.owner = $('#f-owner').value; f.priority = $('#f-pri').value;
        f.due = isoToUs($('#f-due').value); f.status = $('#f-status').value; f.phase = $('#f-phase').value;
      } else if (isNew) {
        f.owner = $('#f-owner').value; f.priority = $('#f-pri').value; f.due = isoToUs($('#f-due').value);
        if (!f.job) return toast('Pick the job');
      }
      if ($('#f-notes')) f.notes = $('#f-notes').value.trim();
      if (isNew) {
        var temp = Object.assign({id: 'new-' + uid(), added: todayStr(), status: 'Not Started', owner: m.name, entity: 'E10K', priority: 'Medium'}, f);
        S.data.tasks.push(temp);
        enqueue('task.create', {fields: f, tempId: temp.id});
        toast(f.owner && f.owner !== m.name ? 'Sent to ' + f.owner : 'Added');
      } else {
        Object.assign(t, f);
        if (f.status === 'Done' && !t.completed) t.completed = todayStr();
        enqueue('task.update', {id: t.id, fields: f});
        toast('Saved');
      }
      save(); closeSheet(); render();
    });
  }

  // ---------- hours ----------
  function renderHours(noFetch) {
    var list = (S.hours || []).slice().sort(function (a, b) { return (parseD(b.date) || 0) - (parseD(a.date) || 0); });
    var html = '<h2>Hours</h2>';
    if (!list.length) html += '<div class="empty">No hours logged in the last 3 weeks.<br>Tap + to log today.</div>';
    var last = '';
    list.forEach(function (h) {
      if (h.date !== last) { html += '<h3>' + esc(h.date) + '</h3>'; last = h.date; }
      html += '<div class="card"><div class="row"><div class="grow"><div class="title">' + esc(h.job) + '</div>' +
        '<div class="sub">' + esc((me().owner ? h.person + ' \u00b7 ' : '') + h.start + ' \u2013 ' + h.end) +
        (h.machine ? ' \u00b7 ' + esc(h.machine) + (h.meterEnd ? ' (' + esc(h.meterStart) + '\u2192' + esc(h.meterEnd) + ')' : '') : '') + '</div>' +
        (h.work ? '<div class="sub">' + esc(h.work) + '</div>' : '') + '</div>' + (h.pending ? '<span class="pill wait">sending</span>' : '') + '</div></div>';
    });
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine && !S.queue.length) api('time.list').then(function (r) {
      if (r.ok) { S.hours = r.entries; save(); if (S.tab === 'hours') renderHours(true); } }).catch(function () {});
  }

  function hoursForm() {
    var m = me(), jobs = S.data.jobs.map(function (j) { return j.name; });
    var html = '<h2>Log hours</h2>' +
      (m.owner ? '<label>Who</label><select id="h-person">' + options(S.data.people, m.name) + '</select>' : '') +
      '<label>Date</label><input type="date" id="h-date" value="' + usToIso(todayStr()) + '">' +
      '<label>Job</label><select id="h-job">' + options(jobs, ls.get('lastJob', ''), true) + '</select>' +
      '<div class="two"><div><label>Start</label><input type="time" id="h-start" value="07:00"></div>' +
      '<div><label>End</label><input type="time" id="h-end"></div></div>' +
      '<label>Machine</label><select id="h-machine"><option value="">None</option>' +
      S.data.machines.map(function (x) { return '<option>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<div id="meters" class="two" style="display:none"><div><label>Meter start</label><input inputmode="decimal" id="h-ms"></div>' +
      '<div><label>Meter end</label><input inputmode="decimal" id="h-me"></div></div>' +
      '<label>What you did</label><textarea id="h-work" placeholder="Tap the mic on your keyboard to talk"></textarea>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>';
    sheet(html, function (act) {
      if (act !== 'save') return closeSheet();
      var f = {date: isoToUs($('#h-date').value), job: $('#h-job').value, start: to12($('#h-start').value), end: to12($('#h-end').value),
        machine: $('#h-machine').value, meterStart: $('#h-ms').value, meterEnd: $('#h-me').value, work: $('#h-work').value.trim()};
      if (m.owner) f.person = $('#h-person').value;
      if (!f.job) return toast('Pick the job');
      if (!f.start || !f.end) return toast('Fill in start and end time');
      if (!f.work) return toast('Say what you did');
      if (f.machine && f.meterStart && f.meterEnd && +f.meterEnd < +f.meterStart) return toast('Meter end is lower than start');
      f.clientId = uid();
      ls.set('lastJob', f.job);
      S.hours.unshift(Object.assign({pending: true, person: f.person || m.name}, f));
      enqueue('time.create', {fields: f});
      save(); closeSheet(); render(); toast('Hours logged');
    });
    var ms = $('#h-machine'); ms.onchange = function () { $('#meters').style.display = ms.value ? 'flex' : 'none'; };
  }

  // ---------- walkthroughs ----------
  function renderWalks() {
    var html = '<h2>Walkthroughs</h2>';
    var list = S.walks || [];
    if (!list.length) html += '<div class="empty">No walkthroughs yet.<br>Tap + on site to start one.</div>';
    list.forEach(function (w) {
      html += '<div class="card"><div class="row"><div class="grow"><div class="title">' + esc(w.job) + '</div>' +
        '<div class="sub">' + esc(w.date + ' \u00b7 ' + w.by) + (w.photos ? ' \u00b7 ' + w.photos + ' photo' + (w.photos > 1 ? 's' : '') : '') + '</div>' +
        (w.summary ? '<div class="sub">' + esc(w.summary).slice(0, 160) + '</div>' : '') + '</div>' +
        (w.pending ? '<span class="pill wait">sending</span>' : (w.processed ? '<span class="pill done">tasks made</span>' : '')) + '</div></div>';
    });
    $('#view').innerHTML = html;
    if (navigator.onLine && !S.queue.length && !renderWalks.busy) {
      renderWalks.busy = true;
      api('walk.list').then(function (r) { if (r.ok) { S.walks = r.walks; save(); if (S.tab === 'walks') renderWalksNoFetch(); } })
        .catch(function () {}).then(function () { renderWalks.busy = false; });
    }
  }
  function renderWalksNoFetch() { renderWalks.busy = true; renderWalks(); renderWalks.busy = false; }

  function shrink(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = rej; img.src = url;
    });
  }

  function walkForm() {
    var jobs = S.data.jobs.map(function (j) { return j.name; }), photos = [];
    var html = '<h2>New walkthrough</h2>' +
      '<label>Job</label><select id="w-job">' + options(jobs, ls.get('lastJob', ''), true) + '</select>' +
      '<label>What you saw</label><textarea id="w-sum" placeholder="Tap the mic on your keyboard and just talk"></textarea>' +
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
  function sheet(html, onAct) {
    $('#sheet-body').innerHTML = html; sheetHandler = onAct;
    $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden';
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); document.body.style.overflow = ''; sheetHandler = null; }

  function signedOut() {
    $('#tabs').innerHTML = ''; $('#fab').classList.add('hidden');
    $('#view').innerHTML = '<div class="signin"><img src="logo-word.png" alt="E10K"><p>Open the private E10K link Sam sent you to sign in.</p>' +
      '<p style="font-size:13px">If you already did and still see this, ask Sam for a new link.</p></div>';
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) { S.tab = b.getAttribute('data-tab'); ls.set('tab', S.tab); S.chip = 'All'; S.filter = ''; window.scrollTo(0, 0); return render(); }
    var al = e.target.closest('[data-alerts]');
    if (al) { if (al.getAttribute('data-alerts') === 'on') turnOnAlerts(); else { ls.set('alertsHide', true); render(); } return; }
    var c = e.target.closest('[data-chip]'); if (c) { S.chip = c.getAttribute('data-chip'); return renderTasks(); }
    var t = e.target.closest('[data-task]'); if (t) return openTask(t.getAttribute('data-task'));
    var a = e.target.closest('#sheet [data-act]'); if (a && sheetHandler) return sheetHandler(a.getAttribute('data-act'));
    if (e.target.classList.contains('sheet-bg')) return closeSheet();
  });
  $('#fab').onclick = function () {
    if (!S.data) return;
    if (S.tab === 'hours') return hoursForm();
    if (S.tab === 'walks') return walkForm();
    taskForm(null);
  };
  window.addEventListener('online', function () { syncBadge(); flush().then(function () { refresh(true); }); });
  window.addEventListener('offline', syncBadge);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.openTask) refresh(true).then(function () { openTask(e.data.openTask); });
    });
  }
  var deep = (location.hash.match(/#task=([A-Za-z0-9\-]+)/) || [])[1];
  if (deep) setTimeout(function () { refresh(true).then(function () { S.tab = 'mine'; render(); openTask(deep); }); }, 300);

  render(); syncBadge();
  if (TOKEN) { if (S.queue.length) flush(); else refresh(!!S.data); }
  setInterval(function () { if (!document.hidden) refresh(true); }, 120000);
})();
