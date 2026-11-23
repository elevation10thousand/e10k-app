// E10K app: reminders and meetings (Spencer 11/22). Owners only (Spencer, Hanna), each for their own.
// - Any task: "⏰ Remind me" (in the task and in New/Edit task). At that time the phone pops an alert with Done /
//   Snooze 1 hr (Sam's server sends it; it pings once more after 30 min if ignored).
// - "It's a meeting": goes straight onto the right Google Calendar (CONTRACTING, Real Estate, Spencer's, Hanna's).
// Saved in the Hub tab "Reminders" (Tasks tab unchanged). The alert's buttons work without opening the app: the
// service worker calls rem.act with the token this page hands it (falls back to opening the app).
(function () {
  var A = window.E10K; if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast;
  var ACTIVE = /^(Set|Sent|Re-sent)$/;
  var CALS = [['E10K', 'E10K work (CONTRACTING)'], ['Real Estate', 'Real estate'], ['Spencer', 'Spencer \u2013 personal'], ['Hanna', 'Hanna']];

  function owner() { var m = A.me && A.me(); return !!(m && m.owner); }
  function list() { var D = A.S.data; return D ? (D.reminders || (D.reminders = [])) : []; }
  function forTask(id) { return list().filter(function (r) { return r.kind === 'Task' && r.ref === id && ACTIVE.test(r.status || 'Set'); })[0]; }
  function p2(n) { return ('0' + n).slice(-2); }
  function toIso(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function isoToAt(v) { var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? m[2] + '/' + m[3] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : ''; }
  function atToIso(at) { var m = String(at || '').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); return m ? m[3] + '-' + m[1] + '-' + m[2] + 'T' + m[4] + ':' + m[5] : ''; }
  function atDate(at) { var v = atToIso(at); return v ? new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10), +v.slice(11, 13), +v.slice(14, 16)) : null; }
  function pretty(at) {
    var d = atDate(at); if (!d) return at || '';
    var now = new Date(), tm = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    var tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), isT = d.getDate() === tmr.getDate() && d.getMonth() === tmr.getMonth();
    var h = d.getHours(), t = ((h % 12) || 12) + ':' + p2(d.getMinutes()) + (h < 12 ? ' AM' : ' PM');
    return (tm ? 'today' : isT ? 'tomorrow' : d.toLocaleDateString('en-US', {weekday: 'short'}) + ' ' + (d.getMonth() + 1) + '/' + d.getDate()) + ' ' + t;
  }
  function quick() {
    var n = new Date(), r = [];
    r.push(['In 1 hour', new Date(n.getTime() + 3600000)]);
    r.push(['In 3 hours', new Date(n.getTime() + 3 * 3600000)]);
    if (n.getHours() < 13) r.push(['Today 1 PM', new Date(n.getFullYear(), n.getMonth(), n.getDate(), 13, 0)]);
    r.push(['Tomorrow 8 AM', new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 8, 0)]);
    r.push(['Tomorrow 1 PM', new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 13, 0)]);
    return r;
  }

  function setLocal(ref, at) {
    var D = A.S.data; if (!D) return;
    D.reminders = list().filter(function (r) { return !(r.kind === 'Task' && r.ref === ref); });
    if (at) D.reminders.push({id: 'tmp-' + A.uid(), kind: 'Task', ref: ref, at: at, status: 'Set'});
  }
  function setRem(ref, at) {
    setLocal(ref, at);
    A.enqueue('rem.set', {fields: {ref: ref, at: at}});
    A.save(); A.render();
  }

  // ---- task sheet button + card badge + New/Edit task field ----
  var prevExtra = A.taskExtra;
  A.taskExtra = function (t) {
    var h = prevExtra ? prevExtra(t) : '';
    if (!owner() || t.status === 'Done') return h;
    var r = forTask(t.id);
    return '<div class="btns"><button class="btn" data-remind="' + esc(t.id) + '" style="width:100%">\u23f0 ' +
      (r ? 'Reminder ' + esc(pretty(r.at)) + ' \u2013 change' : 'Remind me') + '</button></div>' + (h || '');
  };
  A.remBadge = function (t) {
    if (!owner() || t.status === 'Done') return '';
    var r = forTask(t.id); return r ? ' \u00b7 \u23f0 ' + esc(pretty(r.at)) : '';
  };
  A.remField = function (t) {
    if (!owner()) return '';
    var r = t ? forTask(t.id) : null;
    return '<label>\u23f0 Remind me <span class="sub">(optional \u2013 your phone pops up at that time)</span></label>' +
      '<input type="datetime-local" id="f-rem" value="' + (r ? atToIso(r.at) : '') + '" data-was="' + (r ? atToIso(r.at) : '') + '">';
  };
  A.remSave = function (ref) {
    var el = document.getElementById('f-rem'); if (!el || !owner()) return;
    if (el.value === el.getAttribute('data-was')) return;
    if (el.value && atDate(isoToAt(el.value)) < new Date(Date.now() - 60000)) { toast('That reminder time already passed \u2013 not set'); return; }
    setRem(ref, isoToAt(el.value));
  };

  function remindSheet(id) {
    var t = (A.S.data.tasks || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    var r = forTask(id), q = quick();
    A.sheet('<h2>\u23f0 Remind me</h2><div class="sub">' + esc(t.task) + '</div>' +
      (r ? '<div class="kv">Set for <b>' + esc(pretty(r.at)) + '</b></div>' : '') +
      '<div class="chips" style="margin-top:8px">' + q.map(function (x, i) { return '<button class="chip" data-rq="' + i + '">' + esc(x[0]) + '</button>'; }).join('') + '</div>' +
      '<label>Or pick a time</label><input type="datetime-local" id="rm-at" value="' + (r ? atToIso(r.at) : toIso(q[0][1])) + '">' +
      '<div class="sub">Your phone pops up with Done and Snooze buttons. If you miss it, it pings once more 30 min later.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (r ? '<button class="btn" data-act="rm" style="color:var(--red)">Remove</button>' : '') +
      '<button class="btn primary" data-act="go">Set reminder</button></div>', function (a) {
      if (a === 'rm') { setRem(id, ''); A.closeSheet(); return toast('Reminder removed'); }
      if (a !== 'go') return A.closeSheet();
      var at = isoToAt($('#rm-at').value);
      if (!at) return toast('Pick a time');
      if (atDate(at) < new Date(Date.now() - 60000)) return toast('That time already passed');
      setRem(id, at); A.closeSheet(); toast('\u23f0 Reminder set for ' + pretty(at));
    });
  }

  // ---- meetings ----
  A.meetingForm = function (title, job) {
    var m = A.me(), n = new Date(), start = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 9, 0);
    var jobs = (A.S.data.jobs || []).map(function (j) { return j.name; });
    A.sheet('<h2>\ud83d\udcc5 New meeting</h2>' +
      '<label>What</label><input id="mt-t" value="' + esc(title || '') + '" placeholder="Meet Adam at Troutdale">' +
      '<div class="two"><div><label>Day</label><input type="date" id="mt-d" value="' + toIso(start).slice(0, 10) + '"></div>' +
      '<div><label>Starts</label><input type="time" id="mt-s" value="09:00"></div></div>' +
      '<label>How long</label><select id="mt-l">' + [['30', '30 min'], ['60', '1 hr'], ['90', '1\u00bd hrs'], ['120', '2 hrs'], ['180', '3 hrs'], ['240', '4 hrs']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === '60' ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<label>Where <span class="sub">(optional)</span></label><input id="mt-w" placeholder="Address or place">' +
      '<label>Which calendar</label><select id="mt-c">' + CALS.map(function (c) {
        return '<option value="' + c[0] + '"' + (c[0] === (m.name === 'Hanna' ? 'Hanna' : 'E10K') ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select>' +
      '<label>Job / deal <span class="sub">(optional)</span></label><input id="mt-j" autocomplete="off" value="' + esc(job || '') + '" placeholder="Tap to pick, or type">' +
      '<label>Notes <span class="sub">(optional)</span></label><textarea id="mt-n"></textarea>' +
      '<div class="sub">Goes on the calendar with your normal calendar reminders. Nobody else is invited.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Put on calendar</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {title: $('#mt-t').value.trim(), date: $('#mt-d').value, start: $('#mt-s').value, mins: $('#mt-l').value, where: $('#mt-w').value.trim(),
        cal: $('#mt-c').value, job: $('#mt-j').value.trim(), notes: $('#mt-n').value.trim(), clientId: 'mt-' + A.uid()};
      if (!f.title) return toast('Type what the meeting is');
      if (!f.date || !f.start) return toast('Pick the day and time');
      var D = A.S.data; if (D) list().push({id: 'tmp-' + f.clientId, tmp: f.clientId, kind: 'Meeting', title: f.title, start: f.date, status: 'To calendar', cal: f.cal});
      A.enqueue('meet.create', {fields: f}); A.save(); A.closeSheet();
      toast('\ud83d\udcc5 Going on the ' + ({E10K: 'CONTRACTING', 'Real Estate': 'Real Estate', Spencer: 'Spencer', Hanna: 'Hanna'}[f.cal] || '') + ' calendar');
    });
    if (A.jobPicker) A.jobPicker('mt-j', function () { return $('#mt-c').value === 'Real Estate' ? 'Real Estate' : 'E10K'; });
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-remind]');
    if (b) { e.stopPropagation(); e.preventDefault(); return remindSheet(b.getAttribute('data-remind')); }
    var q = e.target.closest && e.target.closest('[data-rq]');
    if (q) { e.stopPropagation(); var x = quick()[+q.getAttribute('data-rq')]; if (x) $('#rm-at').value = toIso(x[1]);
      Array.prototype.forEach.call(document.querySelectorAll('[data-rq]'), function (y) { y.classList.toggle('on', y === q); }); }
  }, true);

  // ---- alert buttons: give the service worker what it needs; fallback when it couldn't reach the server ----
  function handOff() {
    if (!owner() || !A.authInfo || !navigator.serviceWorker) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.active) reg.active.postMessage({auth: A.authInfo()}); }).catch(function () {});
  }
  var tries = 0, iv = setInterval(function () { if (A.S.data || ++tries > 30) { clearInterval(iv); handOff(); } }, 1000);
  var m = location.hash.match(/[#&]remdo=(RM-\d+):(done|snooze)/);
  if (m) {
    A.enqueue('rem.act', {fields: {id: m[1], do: m[2], mins: 60}});
    setTimeout(function () { toast(m[2] === 'done' ? 'Marked done \u2713' : 'Snoozed 1 hr'); }, 800);
    try { history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]?remdo=[^&]*/, '')); } catch (e2) {}
  }
})();
