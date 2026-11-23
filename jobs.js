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
    // progress: steps + to-dos filed in a section are all work items (Spencer 11/22: one % everywhere; a to-do is the task itself)
    var stages = [], by = {};
    r.checks.forEach(function (c) { if (!by[c.stage]) { by[c.stage] = []; stages.push(c.stage); } by[c.stage].push(c); });
    var tasks = jobTasks(job, r), secT = {};
    tasks.forEach(function (t) { if (stages.indexOf(t.phase) >= 0) (secT[t.phase] = secT[t.phase] || []).push(t); });
    var allItems = r.checks.length + tasks.filter(function (t) { return stages.indexOf(t.phase) >= 0; }).length;
    var allDone = r.checks.filter(function (c) { return c.done; }).length + tasks.filter(function (t) { return stages.indexOf(t.phase) >= 0 && t.status === 'Done'; }).length;
    var pct = allItems ? Math.round(100 * allDone / allItems) : null;
    html += '<h3 style="margin-top:16px">Work' + (pct !== null ? ' \u00b7 ' + pct + '%' : '') + '</h3>';
    if (!stages.length) html += '<div class="sub">No work sections on this job yet.' + (r.canEdit ? ' Add one below (e.g. Driveway, Leachfield) and its steps.' : '') + '</div>';
    var curStage = (r.checks.filter(function (c) { return !c.done; })[0] || {}).stage;
    var NOSEL = '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none';
    stages.forEach(function (s) {
      var items = by[s], ts = (secT[s] || []).slice().sort(function (a, b) { return (a.status === 'Done') - (b.status === 'Done'); });
      var n = items.length + ts.length, d = items.filter(function (c) { return c.done; }).length + ts.filter(function (t) { return t.status === 'Done'; }).length;
      var open = J.stageOpen[s] !== undefined ? J.stageOpen[s] : s === curStage, openT = ts.filter(function (t) { return t.status !== 'Done'; }).length;
      var added = items.every(function (c) { return c.added; }) ? items[0].added.replace(/\/\d{4}$/, '') : '';
      html += '<div class="card" style="padding:10px 12px"><div class="row tap" data-jstage="' + esc(s) + '" style="' + NOSEL + '"><div class="grow"><b>' + esc(s) + '</b>' +
        (added ? ' <span class="sub">\u00b7 added ' + esc(added) + '</span>' : '') +
        (openT ? ' <span class="sub">\u00b7 ' + openT + ' to-do' + (openT > 1 ? 's' : '') + '</span>' : '') + '</div><span class="sub"><b style="color:' + (d === n ? 'var(--green)' : 'var(--text)') + '">' +
        Math.round(100 * d / n) + '%</b> \u00b7 ' + d + '/' + n + (open ? ' \u25b4' : ' \u25be') + '</span>' +
        (r.canEdit ? '<span data-jsecmenu="' + esc(s) + '" style="padding:0 2px 0 12px;font-size:18px;color:var(--dim)">\u22ef</span>' : '') + '</div>' +
        bar(n ? 100 * d / n : 0, d === n ? 'var(--green)' : '#4a8fe7');
      if (open) html += items.map(function (c) {
        return '<div class="row tap" data-jcheck="' + esc(c.id) + '" style="padding:9px 0;border-top:1px solid #222;' + NOSEL + '"><span style="font-size:20px;width:30px">' + (c.done ? '\u2705' : '\u2b1c') + '</span>' +
          '<div class="grow"><div' + (c.done ? ' style="color:var(--dim);text-decoration:line-through"' : '') + '>' + (c.kind === 'Inspection' ? '\ud83d\udd0d ' : '') + esc(c.item) + '</div>' +
          (c.done ? '<div class="sub">' + esc([c.by, c.date, c.result].filter(Boolean).join(' \u00b7 ')) + '</div>' : '') + '</div></div>';
      }).join('') + ts.map(todoRow).join('') +
        '<div class="row" style="gap:18px;padding:9px 0 2px;border-top:1px solid #222">' + (r.canEdit ? '<span class="sub tap" data-jaddstep="' + esc(s) + '">+ Add a step</span>' : '') +
        '<span class="sub tap" data-jaddtodo="' + esc(s) + '">+ Add a to-do</span></div>';
      html += '</div>';
    });
    if (r.canEdit) html += '<button class="btn" data-jaddsec style="width:100%;margin-top:6px">+ Add section</button>';
    if (stages.length) html += '<div class="sub" style="margin-top:6px">Tip: press and hold a step, to-do or section for more (add, move, delegate, delete).</div>';
    // to-dos that aren't in a section
    var other = tasks.filter(function (t) { return stages.indexOf(t.phase) < 0 && t.status !== 'Done'; });
    html += '<div class="row" style="margin-top:16px;align-items:center"><h3 class="grow" style="margin:0">' + (stages.length ? 'Other to-dos' : 'To do') + (other.length ? ' \u00b7 ' + other.length : '') + '</h3>' +
      '<button class="btn" data-jobtask style="padding:6px 12px">+ Add task</button></div>' +
      (other.length ? '<div class="card" style="padding:2px 12px">' + other.map(todoRow).join('') + '</div>' : '<div class="sub">Nothing else open on this job.</div>');
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
  /** The job's tasks: the server's list (has older done ones in sections) refreshed with the phone's own copy (instant changes). */
  function jobTasks(job, r) {
    var mine = {}, out = [];
    ((A.S.data && A.S.data.tasks) || []).forEach(function (t) { if (t.job === job) mine[t.id] = t; });
    (r.tasks || []).forEach(function (t) { var l = mine[t.id]; out.push(l || t); delete mine[t.id]; });
    Object.keys(mine).forEach(function (k) { out.push(mine[k]); });
    return out;
  }
  function todoRow(t) {
    var done = t.status === 'Done', who = t.owner ? esc(t.owner) : '<span style="color:#ffc069">Unassigned</span>';
    return '<div class="row tap" data-jtodo="' + esc(t.id) + '" style="padding:9px 0;border-top:1px solid #222;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none">' +
      '<span data-jtodock="' + esc(t.id) + '" style="font-size:20px;width:30px">' + (done ? '\u2705' : '\u2b1c') + '</span>' +
      '<div class="grow"><div' + (done ? ' style="color:var(--dim);text-decoration:line-through"' : '') + '>\ud83d\udcdd ' + esc(t.task) + '</div>' +
      '<div class="sub">' + who + (t.status && !done && t.status !== 'Not Started' ? ' \u00b7 ' + esc(t.status) : '') + (t.due && !done ? ' \u00b7 due ' + esc(A.shortD(t.due)) : '') +
      (done && t.completed ? ' \u00b7 done ' + esc(t.completed) : '') + '</div>' +
      (!t.owner && !done ? '<div style="margin-top:6px;display:flex;gap:8px"><button class="btn" data-jtake="' + esc(t.id) + '" style="padding:4px 10px">I\u2019ll take it</button>' +
        '<button class="btn" data-jdeleg="' + esc(t.id) + '" style="padding:4px 10px">Delegate\u2026</button></div>' : '') + '</div></div>';
  }
  function findT(id) { return jobTasks(J.open, J.cur || {}).filter(function (t) { return t.id === id; })[0]; }
  function localT(t) {   // make sure the phone's copy has it, so the change shows everywhere at once
    var L = A.S.data.tasks || (A.S.data.tasks = []), l = L.filter(function (x) { return x.id === t.id; })[0];
    if (!l) { l = Object.assign({job: J.open, entity: 'E10K'}, t); L.push(l); }
    return l;
  }
  function toggleTodo(id) {
    var t = findT(id); if (!t) return;
    var l = localT(t), done = l.status !== 'Done';
    l.status = done ? 'Done' : 'In Progress'; l.completed = done ? A.todayStr() : '';
    A.enqueue('task.update', {id: id, fields: {status: l.status}}); A.save(); render();
    if (done) toast('Done \u2713');
  }
  function assign(id, who) {
    var t = findT(id); if (!t) return;
    var l = localT(t); l.owner = who;
    A.enqueue('task.assign', {id: id, owners: [who]}); A.save(); render();
    toast(who === A.me().name ? 'It\u2019s yours \u2013 it\u2019s in My Tasks' : 'Sent to ' + who);
  }
  function delegateSheet(id) {
    var t = findT(id); if (!t) return;
    var ppl = ((A.S.data && A.S.data.people) || []).filter(function (p) { return p && p !== A.me().name; });
    A.sheet('<h2>Delegate</h2><div class="sub">' + esc(t.task) + '</div><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
      ppl.map(function (p) { return '<button class="btn" data-act="p:' + esc(p) + '">' + esc(p) + '</button>'; }).join('') +
      '<button class="btn" data-act="x">Cancel</button></div>', function (a) {
      A.closeSheet(); if (a && a.indexOf('p:') === 0) assign(id, a.slice(2));
    });
  }
  function moveSheet(id) {
    var t = findT(id); if (!t || !J.cur) return;
    var st = []; J.cur.checks.forEach(function (c) { if (st.indexOf(c.stage) < 0) st.push(c.stage); });
    A.sheet('<h2>Move to section</h2><div class="sub">' + esc(t.task) + '</div><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
      st.map(function (s, i) { return '<button class="btn' + (s === t.phase ? ' primary' : '') + '" data-act="s' + i + '">' + esc(s) + '</button>'; }).join('') +
      '<button class="btn" data-act="none">No section (Other to-dos)</button><button class="btn" data-act="x">Cancel</button></div>', function (a) {
      A.closeSheet(); if (!a || a === 'x') return;
      var ph = a === 'none' ? '' : st[+a.slice(1)]; if (ph === undefined || ph === t.phase) return;
      var l = localT(t); l.phase = ph;
      A.enqueue('task.update', {id: id, fields: {phase: ph}}); A.save(); render(); toast(ph ? 'Moved to ' + ph : 'Moved to Other to-dos');
    });
  }
  function todoHold(id) {
    var t = findT(id); if (!t) return;
    A.sheet('<h2>' + esc(t.task) + '</h2><div class="sub">' + esc([t.phase, t.owner || 'Unassigned'].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px"><button class="btn" data-act="open">Open the task</button>' +
      '<button class="btn" data-act="move">Move to section\u2026</button>' +
      (t.owner !== A.me().name ? '<button class="btn" data-act="take">I\u2019ll take it</button>' : '') +
      '<button class="btn" data-act="del">Delegate\u2026</button>' +
      (t.phase ? '<button class="btn" data-act="todo">+ Add another to-do in ' + esc(t.phase) + '</button>' : '') +
      '<button class="btn" data-act="x">Cancel</button></div>', function (a) {
      if (a === 'open') { A.closeSheet(); return setTimeout(function () { A.openTask(id); }, 50); }
      if (a === 'move') return moveSheet(id);
      if (a === 'take') { A.closeSheet(); return assign(id, A.me().name); }
      if (a === 'del') return delegateSheet(id);
      if (a === 'todo') { A.closeSheet(); return A.newTask({job: J.open, entity: 'E10K', phase: t.phase}); }
      A.closeSheet();
    });
  }
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

  // ---------- editing sections and steps (owners + people allowed to add jobs) ----------
  function edit(f, okMsg) {
    f.job = J.open;
    return A.api('jobs.edit', {fields: f}).then(function (x) {
      if (!x.ok) return toast({section_exists: 'There\u2019s already a section with that name', has_done_steps: 'It has checked-off steps \u2013 ask Spencer or Hanna',
        steps_required: 'Add at least one step', name_required: 'Type a name', item_required: 'Type the step', not_allowed: 'Not allowed'}[x.error] || 'Didn\u2019t save');
      if (J.cur) { J.cur.checks = x.checks; }
      (J.list || []).forEach(function (j) { if (j.name === J.open) { j.pct = x.summary.pct; j.done = x.summary.done; j.total = x.summary.total; j.stage = x.summary.stage; } }); ls.set('jobsList', J.list);
      render(); if (okMsg) toast(okMsg);
    }).catch(function () { toast('Needs a signal'); });
  }
  function sectionSheet() {
    var secs = (J.cur && J.cur.sections) || [];
    A.sheet('<h2>Add a section</h2><div class="sub">Pick a ready-made one (you can change the steps), or start blank.</div>' +
      '<label>Ready-made</label><select id="js-pre"><option value="">Blank \u2013 I\u2019ll type the steps</option>' +
      secs.map(function (s, i) { return '<option value="' + i + '">' + esc(s.name + (s.from ? ' (' + s.from + ')' : '') + ' \u2013 ' + s.steps.length + ' steps') + '</option>'; }).join('') + '</select>' +
      '<label>Section name</label><input id="js-name" placeholder="e.g. Leachfield">' +
      '<label>Steps <span class="sub">(one per line; start a line with ? for an inspection)</span></label><textarea id="js-steps" rows="8" placeholder="Septic permit issued\nExcavate\n? Open-hole inspection\nBackfill and grade"></textarea>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Add section</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var name = $('#js-name').value.trim(), steps = $('#js-steps').value.split('\n').map(function (l) { l = l.trim(); var insp = /^\?/.test(l);
        return {item: l.replace(/^\?\s*/, ''), kind: insp ? 'Inspection' : 'Step'}; }).filter(function (s) { return s.item; });
      if (!name) return toast('Type the section name'); if (!steps.length) return toast('Add at least one step');
      A.closeSheet(); J.stageOpen[name] = true; edit({op: 'addSection', stage: name, steps: steps}, name + ' added');
    });
    $('#js-pre').onchange = function () {
      var s = secs[+this.value]; if (!s) return;
      $('#js-name').value = s.name; $('#js-steps').value = s.steps.map(function (x) { return (x.kind === 'Inspection' ? '? ' : '') + x.item; }).join('\n');
    };
  }
  function addStepSheet(stage, after) {
    A.sheet('<h2>Add a step</h2><div class="sub">' + esc(stage) + '</div><label>Step</label><input id="jst-i">' +
      '<div class="chips" style="margin-top:8px"><button class="chip on" data-jkind="Step">Step</button><button class="chip" data-jkind="Inspection">\ud83d\udd0d Inspection</button></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Add</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var it = $('#jst-i').value.trim(); if (!it) return toast('Type the step');
      var k = document.querySelector('[data-jkind].on').getAttribute('data-jkind');
      A.closeSheet(); J.stageOpen[stage] = true; edit({op: 'addStep', stage: stage, item: it, kind: k, after: after || ''}, 'Step added');
    });
  }
  function secMenu(stage) {
    A.sheet('<h2>' + esc(stage) + '</h2><label>Rename</label><input id="jsm-n" value="' + esc(stage) + '">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn" data-act="rm" style="color:var(--red)">Delete section</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') { if (!confirm('Delete the whole ' + stage + ' section and its steps?')) return; A.closeSheet(); return edit({op: 'removeSection', stage: stage}, 'Section deleted'); }
      if (a !== 'go') return A.closeSheet();
      var n = $('#jsm-n').value.trim(); A.closeSheet(); if (n && n !== stage) edit({op: 'renameSection', stage: stage, name: n}, 'Renamed');
    });
  }
  // press and hold (Spencer 11/22): a step -> add a step after it, add a to-do, rename, delete; a section -> same for the section
  function stepHold(id) {
    var c = (J.cur.checks || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    var ed = J.cur.canEdit;
    A.sheet('<h2>' + esc(c.item) + '</h2><div class="sub">' + esc(c.stage) + '</div><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
      (ed ? '<button class="btn" data-act="after">+ Add a step after this</button>' : '') +
      '<button class="btn" data-act="todo">+ Add a to-do in ' + esc(c.stage) + '</button>' +
      (ed ? '<button class="btn" data-act="ren">Rename</button><button class="btn" data-act="rm" style="color:var(--red)">Delete this step</button>' : '') +
      '<button class="btn" data-act="x">Cancel</button></div>', function (a) {
      if (a === 'after') return addStepSheet(c.stage, c.id);
      if (a === 'todo') { A.closeSheet(); return A.newTask({job: J.open, entity: 'E10K', phase: c.stage}); }
      if (a === 'ren') return stepMenu(id);
      if (a === 'rm') { if (!confirm('Delete \u201c' + c.item + '\u201d?')) return; A.closeSheet(); return edit({op: 'removeStep', id: id}, 'Step deleted'); }
      A.closeSheet();
    });
  }
  function secHold(stage) {
    var ed = J.cur.canEdit;
    A.sheet('<h2>' + esc(stage) + '</h2><div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
      (ed ? '<button class="btn" data-act="step">+ Add a step</button>' : '') +
      '<button class="btn" data-act="todo">+ Add a to-do</button>' +
      (ed ? '<button class="btn" data-act="sec">+ Add a new section</button><button class="btn" data-act="ren">Rename or delete section</button>' : '') +
      '<button class="btn" data-act="x">Cancel</button></div>', function (a) {
      if (a === 'step') return addStepSheet(stage);
      if (a === 'todo') { A.closeSheet(); return A.newTask({job: J.open, entity: 'E10K', phase: stage}); }
      if (a === 'sec') return sectionSheet();
      if (a === 'ren') return secMenu(stage);
      A.closeSheet();
    });
  }
  var LP = {t: 0, at: 0};
  function holdTarget(e) { return A.S.tab === 'jobs' && J.cur && e.target.closest && e.target.closest('[data-jcheck],[data-jstage],[data-jtodo]'); }
  function hold(el) {
    if (Date.now() - LP.at < 800) return; LP.at = Date.now();
    if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}
    if (el.hasAttribute('data-jcheck')) stepHold(el.getAttribute('data-jcheck'));
    else if (el.hasAttribute('data-jtodo')) todoHold(el.getAttribute('data-jtodo'));
    else secHold(el.getAttribute('data-jstage'));
  }
  document.addEventListener('touchstart', function (e) {
    var el = holdTarget(e); clearTimeout(LP.t); if (!el) return;
    var p = e.touches[0]; LP.x = p.clientX; LP.y = p.clientY;
    LP.t = setTimeout(function () { hold(el); }, 550);
  }, {passive: true});
  document.addEventListener('touchmove', function (e) { var p = e.touches[0]; if (Math.abs(p.clientX - LP.x) > 10 || Math.abs(p.clientY - LP.y) > 10) clearTimeout(LP.t); }, {passive: true});
  document.addEventListener('touchend', function () { clearTimeout(LP.t); }, {passive: true});
  document.addEventListener('contextmenu', function (e) { var el = holdTarget(e); if (!el) return; e.preventDefault(); clearTimeout(LP.t); hold(el); });
  document.addEventListener('click', function (e) {   // the tap that ends a long press must not also check the step off
    if (Date.now() - LP.at < 800 && holdTarget(e)) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  function stepMenu(id) {
    var c = (J.cur.checks || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    A.sheet('<h2>Step</h2><div class="sub">' + esc(c.stage) + '</div><label>Rename</label><input id="jsp-n" value="' + esc(c.item) + '">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn" data-act="rm" style="color:var(--red)">Delete step</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') { A.closeSheet(); return edit({op: 'removeStep', id: id}, 'Step deleted'); }
      if (a !== 'go') return A.closeSheet();
      var n = $('#jsp-n').value.trim(); A.closeSheet(); if (n && n !== c.item) edit({op: 'renameStep', id: id, item: n}, 'Renamed');
    });
  }
  document.addEventListener('click', function (e) {
    var kc = e.target.closest && e.target.closest('[data-jkind]');
    if (kc) { Array.prototype.forEach.call(document.querySelectorAll('[data-jkind]'), function (x) { x.classList.toggle('on', x === kc); }); return; }
  }, true);

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-gojobs]')) { A.S.tab = 'jobs'; ls.set('tab', 'jobs'); J.open = null; window.scrollTo(0, 0); A.navPush && A.navPush(); return A.render(); }
    if (A.S.tab !== 'jobs') return;
    var sm = e.target.closest('[data-jsecmenu]'); if (sm) { e.stopPropagation(); return secMenu(sm.getAttribute('data-jsecmenu')); }
    var tk = e.target.closest('[data-jtake]'); if (tk) { e.stopPropagation(); return assign(tk.getAttribute('data-jtake'), A.me().name); }
    var dg = e.target.closest('[data-jdeleg]'); if (dg) { e.stopPropagation(); return delegateSheet(dg.getAttribute('data-jdeleg')); }
    var tc = e.target.closest('[data-jtodock]'); if (tc) { e.stopPropagation(); return toggleTodo(tc.getAttribute('data-jtodock')); }
    var tr = e.target.closest('[data-jtodo]'); if (tr) { e.stopPropagation(); return A.openTask(tr.getAttribute('data-jtodo')); }
    var td = e.target.closest('[data-jaddtodo]'); if (td) return A.newTask({job: J.open, entity: 'E10K', phase: td.getAttribute('data-jaddtodo')});
    var as = e.target.closest('[data-jaddstep]'); if (as) return addStepSheet(as.getAttribute('data-jaddstep'));
    if (e.target.closest('[data-jaddsec]')) return sectionSheet();
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
