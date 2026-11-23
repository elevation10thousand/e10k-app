// E10K app: Jobs tab (Spencer 11/22). Everyone: one page per job with progress (checklist, crew can check items off),
// the job's open tasks (+ Add task with the job filled in), who was on site (crew: only their own hours), walkthroughs.
// Spencer and Hanna also get a money line that opens the Finance job page. The server never sends money for crew
// (jobs.list / jobs.view carry none; the money line comes from job.fin, owners only).
(function () {
  var A = window.E10K; if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast, ls = A.ls;
  var J = {list: ls.get('jobsList', null), open: null, cur: null, fin: {}, busy: false, stageOpen: {}};

  function owner() { var m = A.me && A.me(); return !!(m && m.owner); }
  function money(n) { var v = Math.round(Math.abs(n || 0)); return (n < 0 ? '-$' : '$') + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function bar(pct, color) {
    return '<div style="height:8px;border-radius:4px;background:#2a2a2a;overflow:hidden;margin:6px 0 2px"><div style="height:100%;width:' + Math.max(0, Math.min(100, pct || 0)) +
      '%;background:' + (color || 'var(--green)') + '"></div></div>';
  }
  function openTasks(job) {
    return ((A.S.data && A.S.data.tasks) || []).filter(function (t) { return t.job === job && t.status !== 'Done'; });
  }
  function mapLink(addr) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr); }

  function load() {
    if (J.busy || (J.at && Date.now() - J.at < 60000)) return; J.busy = true; J.at = Date.now();
    return A.api('jobs.list', {}).then(function (r) {
      J.busy = false; if (!r.ok) return;
      J.list = r.jobs; ls.set('jobsList', r.jobs); if (A.S.tab === 'jobs' && !J.open) render();
    }).catch(function () { J.busy = false; });
  }
  function loadJob(job) {
    A.api('jobs.view', {job: job}).then(function (r) {
      if (!r.ok) return toast(r.error === 'not_allowed' ? 'That job isn\u2019t on your list' : 'Couldn\u2019t load the job');
      if (J.open !== job) return;
      J.cur = r; render();
    }).catch(function () { if (J.open === job) toast('Needs a signal'); });
    if (A.loadWalks && navigator.onLine) A.loadWalks().then(function () { if (J.open === job) render(); }).catch(function () {});
    if (owner() && !J.fin[job]) A.api('job.fin', {job: job}).then(function (r) { if (r.ok) { J.fin[job] = r.score; if (J.open === job) render(); } }).catch(function () {});
  }
  function openJob(job) { J.open = job; J.cur = null; J.stageOpen = {}; J.allDays = false; J.allWalks = false; A.navPush && A.navPush(); render(); window.scrollTo(0, 0); loadJob(job); }
  A.curJob = function () { return A.S.tab === 'jobs' ? J.open : null; };
  A.setJob = function (job) {   // phone back button (app.js popstate)
    if (A.S.tab !== 'jobs' || (job || null) === J.open) return;
    J.open = job || null; J.cur = null; J.allDays = false; if (job) loadJob(job);
  };

  // ---------- list ----------
  function jobCard(j) {
    var n = openTasks(j.name).length;
    return '<div class="card tap" data-jobopen="' + esc(j.name) + '"><div class="row"><div class="grow"><div class="title">' + esc(j.name) + '</div>' +
      '<div class="sub">' + esc(j.address || (owner() && j.client) || '') + '</div></div>' +
      '<span class="pill">' + esc(j.status || '') + '</span></div>' +
      (j.pct !== null && j.pct !== undefined ? bar(j.pct) + '<div class="sub">' + j.pct + '% done' + (j.stage ? ' \u00b7 now: ' + esc(j.stage) : '') + '</div>'
        : '<div class="sub" style="margin-top:6px">No checklist yet</div>') +
      (n ? '<div class="sub" style="margin-top:2px">' + n + ' open task' + (n > 1 ? 's' : '') + '</div>' : '') + '</div>';
  }
  function renderList() {
    var L = J.list;
    if (!L) { $('#view').innerHTML = '<div class="empty">Loading jobs\u2026</div>'; return; }
    var going = L.filter(function (j) { return j.status !== 'Bidding'; }), bids = L.filter(function (j) { return j.status === 'Bidding'; });
    $('#view').innerHTML = (going.length ? going.map(jobCard).join('') : '<div class="empty">No active jobs</div>') +
      (bids.length ? '<h3 style="margin-top:16px">Bidding</h3>' + bids.map(jobCard).join('') : '');
  }

  // ---------- one job ----------
  function renderJob() {
    var job = J.open, r = J.cur, base = (J.list || []).filter(function (j) { return j.name === job; })[0] || {name: job};
    var j = (r && r.job) || base, html = '<div class="row" style="margin-bottom:6px"><button class="btn" data-jobback style="padding:6px 12px">\u2039 Jobs</button></div>';
    html += '<h2 style="margin:4px 0">' + esc(j.name) + '</h2>' +
      (j.address ? '<div class="sub"><a href="' + mapLink(j.address) + '" target="_blank" rel="noopener">\ud83d\udccd ' + esc(j.address) + '</a></div>' : '') +
      '<div class="sub">' + esc([j.status, owner() ? j.client : '', j.start ? 'start ' + j.start : '', j.finish ? 'finish ' + j.finish : ''].filter(Boolean).join(' \u00b7 ')) + '</div>';
    var sc = J.fin[job];
    if (owner() && sc) {
      html += '<div class="card tap" data-jobfin style="margin-top:10px;border-color:#2a3a55"><div class="sub">\ud83d\udcb5 Money (you and Hanna only)</div><div style="margin-top:4px">' +
        'Spent <b>' + money(sc.spent) + '</b>' + (sc.budget ? ' of ' + money(sc.budget) + ' budget (' + sc.budgetPct + '%)' : '') +
        ' \u00b7 profit so far <b>' + money(sc.profit) + '</b>' + (sc.margin !== null && sc.margin !== undefined ? ' (' + sc.margin + '%)' : '') + '</div>' +
        '<div class="sub" style="margin-top:4px">Open the full job finances \u203a</div></div>';
    }
    if (!r) { $('#view').innerHTML = html + '<div class="empty">Loading\u2026</div>'; return; }
    // progress
    var stages = [], by = {};
    r.checks.forEach(function (c) { if (!by[c.stage]) { by[c.stage] = []; stages.push(c.stage); } by[c.stage].push(c); });
    var done = r.checks.filter(function (c) { return c.done; }).length, pct = r.checks.length ? Math.round(100 * done / r.checks.length) : null;
    html += '<h3 style="margin-top:16px">Progress' + (pct !== null ? ' \u00b7 ' + pct + '%' : '') + '</h3>';
    if (!stages.length) html += '<div class="sub">No checklist on this job yet' + (owner() ? ' \u2013 set one up on the Finance job page.' : '.') + '</div>';
    var curStage = (r.checks.filter(function (c) { return !c.done; })[0] || {}).stage;
    stages.forEach(function (s) {
      var items = by[s], d = items.filter(function (c) { return c.done; }).length, open = J.stageOpen[s] !== undefined ? J.stageOpen[s] : s === curStage;
      var tasksHere = openTasks(job).filter(function (t) { return t.phase === s || t.area === s; }).length;
      html += '<div class="card" style="padding:10px 12px"><div class="row tap" data-jstage="' + esc(s) + '"><div class="grow"><b>' + esc(s) + '</b>' +
        (tasksHere ? ' <span class="sub">\u00b7 ' + tasksHere + ' open</span>' : '') + '</div><span class="sub">' + d + '/' + items.length + (open ? ' \u25b4' : ' \u25be') + '</span></div>' +
        bar(items.length ? 100 * d / items.length : 0, d === items.length ? 'var(--green)' : '#4a8fe7');
      if (open) html += items.map(function (c) {
        return '<div class="row tap" data-jcheck="' + esc(c.id) + '" style="padding:9px 0;border-top:1px solid #222"><span style="font-size:20px;width:30px">' + (c.done ? '\u2705' : '\u2b1c') + '</span>' +
          '<div class="grow"><div' + (c.done ? ' style="color:var(--dim);text-decoration:line-through"' : '') + '>' + (c.kind === 'Inspection' ? '\ud83d\udd0d ' : '') + esc(c.item) + '</div>' +
          (c.done ? '<div class="sub">' + esc([c.by, c.date, c.result].filter(Boolean).join(' \u00b7 ')) + '</div>' : '') + '</div></div>';
      }).join('');
      html += '</div>';
    });
    // tasks
    var ts = openTasks(job);
    html += '<div class="row" style="margin-top:16px;align-items:center"><h3 class="grow" style="margin:0">To do' + (ts.length ? ' \u00b7 ' + ts.length : '') + '</h3>' +
      '<button class="btn" data-jobtask style="padding:6px 12px">+ Add task</button></div>' +
      (ts.length ? ts.map(function (t) { return A.taskCard(t); }).join('') : '<div class="sub">Nothing open on this job.</div>');
    // on site
    html += '<h3 style="margin-top:16px">On site' + (owner() ? '' : ' \u00b7 your hours') + '</h3>';
    if (!r.days.length) html += '<div class="sub">No hours logged yet.</div>';
    html += r.days.slice(0, J.allDays ? 60 : 7).map(function (d) {
      var hrs = d.crew.reduce(function (a, c) { return a + (c.hours || 0); }, 0);
      return '<div class="card" style="padding:10px 12px"><div class="row"><b class="grow">' + esc(d.date) + '</b><span class="sub">' + (Math.round(hrs * 100) / 100) + ' hrs</span></div>' +
        d.crew.map(function (c) { return '<div class="sub" style="margin-top:4px">' + (owner() ? '<b>' + esc(c.person) + '</b> ' : '') + esc(c.start && c.end ? c.start + '\u2013' + c.end : '') +
          ' (' + c.hours + ' hrs)' + (c.work ? ': ' + esc(c.work) : '') + '</div>'; }).join('') +
        d.machines.map(function (m) { return '<div class="sub" style="margin-top:4px">\ud83d\ude9c ' + esc(m.machine) + (owner() && m.operator ? ' (' + esc(m.operator) + ')' : '') +
          (m.running ? ' \u2013 <span style="color:#ffc069">running</span>' : ' \u2013 ' + m.hours + ' hrs') + '</div>'; }).join('') + '</div>';
    }).join('') + (r.days.length > 7 && !J.allDays ? '<div class="tl-more" data-jalldays>Show older days \u203a</div>' : '');
    // walkthroughs (moved here from the Walks tab, Spencer 11/22)
    var ws = (A.S.walks || []).filter(function (w) { return w.job === job; });
    html += '<div class="row" style="margin-top:16px;align-items:center"><h3 class="grow" style="margin:0">Walkthroughs' + (ws.length ? ' \u00b7 ' + ws.length : '') + '</h3>' +
      '<button class="btn" data-jobwalk style="padding:6px 12px">+ Walkthrough</button></div>' +
      (ws.length ? ws.slice(0, J.allWalks ? 50 : 5).map(function (w) {
        var pill = w.pending ? '<span class="pill wait">sending</span>' : w.sent ? '<span class="pill done">sent</span>' : (w.processed ? '<span class="pill">tasks made</span>' : '');
        return '<div class="card tap" data-jwalk="' + (A.S.walks || []).indexOf(w) + '" style="padding:10px 12px"><div class="row"><div class="grow"><div class="sub">' + esc(w.date) + ' \u00b7 ' + esc(w.by) +
          (w.photos ? ' \u00b7 ' + w.photos + ' photo' + (w.photos > 1 ? 's' : '') : '') + '</div><div style="margin-top:4px">' + esc(String(w.summary || '(no notes)').split('\n')[0].slice(0, 140)) + '</div></div>' + pill + '</div></div>';
      }).join('') + (ws.length > 5 && !J.allWalks ? '<div class="tl-more" data-jallwalks>Show all ' + ws.length + ' \u203a</div>' : '')
        : '<div class="sub">None yet. Tap + Walkthrough on site and just talk \u2013 Sam makes the tasks.</div>');
    if (owner() && j.folder) html += '<div style="margin:14px 0"><a href="' + esc(j.folder) + '" target="_blank" rel="noopener">\ud83d\udcc1 Job folder (plans, photos)</a></div>';
    $('#view').innerHTML = html;
  }

  function render() { if (J.open) renderJob(); else renderList(); }

  function check(id) {
    var r = J.cur; if (!r) return;
    var c = r.checks.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    var me = A.me().name;
    if (c.done && !owner() && c.by !== me) return toast('Checked off by ' + c.by + ' \u2013 only they or the office can undo it');
    var was = {done: c.done, by: c.by, date: c.date};
    c.done = !c.done; c.by = c.done ? me : ''; c.date = c.done ? A.todayStr() : ''; render();
    A.api('jobs.check', {fields: {job: J.open, id: id, done: c.done}}).then(function (x) {
      if (!x.ok) { Object.assign(c, was); render(); return toast(x.error === 'not_yours' ? 'Only the person who checked it (or the office) can undo it' : 'Didn\u2019t save'); }
      if (J.cur === r) { r.checks = x.checks; render(); }
      (J.list || []).forEach(function (j) { if (j.name === J.open) { j.pct = x.summary.pct; j.done = x.summary.done; j.stage = x.summary.stage; } }); ls.set('jobsList', J.list);
      if (x.summary.pct === 100) toast('\ud83c\udf89 Checklist complete');
    }).catch(function () { Object.assign(c, was); render(); toast('Needs a signal to check it off'); });
  }

  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'jobs') return;
    var t = e.target.closest('[data-jobopen]'); if (t) return openJob(t.getAttribute('data-jobopen'));
    if (e.target.closest('[data-jobback]')) { history.back(); return; }
    if (e.target.closest('[data-jobfin]')) { if (A.openJob) A.openJob(J.open); return; }
    if (e.target.closest('[data-jobtask]')) return A.newTask({job: J.open, entity: 'E10K'});
    if (e.target.closest('[data-jalldays]')) { J.allDays = true; return render(); }
    if (e.target.closest('[data-jallwalks]')) { J.allWalks = true; return render(); }
    if (e.target.closest('[data-jobwalk]')) return A.walkForm(J.open);
    var wk = e.target.closest('[data-jwalk]'); if (wk) { var w = (A.S.walks || [])[+wk.getAttribute('data-jwalk')]; if (w) return A.walkDetail(w); }
    var s = e.target.closest('[data-jstage]');
    if (s) { var k = s.getAttribute('data-jstage'), cur = (J.cur.checks.filter(function (c) { return !c.done; })[0] || {}).stage;
      J.stageOpen[k] = !(J.stageOpen[k] !== undefined ? J.stageOpen[k] : k === cur); return render(); }
    var c = e.target.closest('[data-jcheck]'); if (c) return check(c.getAttribute('data-jcheck'));
  });

  A.addTab({k: 'jobs', n: 'Jobs', first: true,
    ic: A.svg('<path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/>'),
    render: function () { render(); if (!J.open) load(); else if (!J.cur) loadJob(J.open); },
    fab: function () { return A.newTask(J.open ? {job: J.open, entity: 'E10K'} : {}); }});
})();
