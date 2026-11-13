/* E10K app: one job's money (owners). Opened from Finance > Jobs (or a job's name anywhere in Finance).
 * Scoreboard (cost, earned, profit, margin, budget used, % complete), Sam's notes, budget vs actual by category
 * (tap to see and fix every entry), budget editor, change orders, completion checklist, invoices, cost vs billed chart.
 * Backend: JobFin.js (job.fin / job.setup / job.budget / job.edit / job.check / job.co). */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast;
  var JF = {cur: null, job: null, open: {}, showAll: false, busy: false};

  function n(v) { var x = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[$,\s]/g, '')); return isNaN(x) ? 0 : x; }
  function money(v, cents) { var x = n(v), s = (cents === false ? Math.round(Math.abs(x)).toString() : Math.abs(x).toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (x < 0 ? '-$' : '$') + s; }
  function err(e) {
    var m = String((e && e.error) || e || 'error');
    return {already_billed: 'That one is already billed, so the amount can\u2019t change', item_required: 'Type the item', amount_required: 'Type an amount',
      desc_required: 'Type what it is', bad_type: 'Pick a job type'}[m] || m.replace(/_/g, ' ');
  }
  function call(action, fields) {
    if (!navigator.onLine) { toast('No signal \u2013 this needs a connection'); return Promise.reject('offline'); }
    JF.busy = true;
    return A.api(action, action === 'job.fin' ? {job: fields} : {fields: fields}).then(function (r) {
      JF.busy = false; if (!r.ok) { toast(err(r)); throw r; } return r; }, function (e) { JF.busy = false; toast('Could not reach the server \u2013 try again'); throw e; });
  }
  function set(r) { JF.cur = r; JF.job = r.job.job; draw(); if (A.finReload) A.finReload(); }

  function load(job) {
    if (!JF.cur || JF.cur.job.job !== job) { JF.cur = null; JF.job = job; draw(); }
    return call('job.fin', job).then(function (r) { if (JF.job === job) { JF.cur = r; draw(); } });
  }

  // ---------- page ----------
  function tile(label, value, sub, color) {
    return '<div class="fn-tile"><div class="tl-s">' + esc(label) + '</div><div class="fn-big"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div>' +
      (sub ? '<div class="tl-s">' + sub + '</div>' : '') + '</div>';
  }
  function bar(pct, color) { return '<div class="fn-bar1" style="height:7px"><div style="width:' + Math.min(100, Math.max(1, pct || 0)) + '%;background:' + color + '"></div></div>'; }
  function hasB(c) { return c.hasBudget && c.budget > 0; }
  function catColor(c) { var p = c.pctBudget; return p === null ? 'var(--dim)' : (p > 100 ? 'var(--red)' : (p >= 80 ? 'var(--orange)' : 'var(--green)')); }
  function notes(r) {
    var s = r.score, out = [];
    var over = r.cats.filter(function (c) { return c.pctBudget !== null && c.pctBudget > 100; });
    var near = r.cats.filter(function (c) { return c.pctBudget !== null && c.pctBudget >= 80 && c.pctBudget <= 100; });
    over.sort(function (a, b) { return (b.total - b.budget) - (a.total - a.budget); });
    if (over.length > 3) out.push(['red', over.length + ' categories are over budget. Biggest: ' + over.slice(0, 3).map(function (c) {
      return esc(c.cat) + ' +' + money(c.total - c.budget, false); }).join(', ') + '.']);
    else over.forEach(function (c) { out.push(['red', esc(c.cat) + ' is over budget: ' + money(c.total, false) + ' of ' + money(c.budget, false) + ' (' + c.pctBudget + '%).']); });
    if (near.length > 3) out.push(['orange', near.length + ' categories are at 80\u2013100% of budget.']);
    else near.forEach(function (c) { out.push(['orange', esc(c.cat) + ' is at ' + c.pctBudget + '% of its budget.']); });
    if (s.budgetPct !== null && s.pctComplete !== null && s.budgetPct - s.pctComplete > 15)
      out.push(['orange', 'You\u2019ve spent ' + s.budgetPct + '% of the budget but the job is ' + s.pctComplete + '% done \u2013 watch the remaining work.']);
    if (s.budgetPct !== null && s.pctComplete !== null && s.pctComplete - s.budgetPct > 10)
      out.push(['green', s.pctComplete + '% done for ' + s.budgetPct + '% of the budget \u2013 running under.']);
    if (s.projProfit !== null) out.push([s.projProfit < 0 ? 'red' : 'dim', 'If every category lands at its budget (or what\u2019s spent, if more), the job ends at ' + money(s.projProfit, false) + ' profit.']);
    var uns = r.cats.filter(function (c) { return c.cat === 'Not sorted yet'; })[0];
    if (uns && uns.items.length) out.push(['dim', uns.items.length + ' entr' + (uns.items.length === 1 ? 'y isn\u2019t' : 'ies aren\u2019t') + ' sorted into a category yet \u2013 tap \u201cNot sorted yet\u201d below.']);
    if (s.machineUnknownHrs) out.push(['dim', s.machineUnknownHrs + ' machine hours aren\u2019t in the cost yet \u2013 waiting on what each machine costs us per hour.']);
    if (s.direct) out.push(['dim', money(s.direct, false) + ' was paid by the client straight to vendors. It counts toward the budget but not our cost or income.']);
    if (s.owed) out.push(['blue', money(s.owed, false) + ' billed and not paid yet.']);
    if (s.readyCount) out.push(['blue', money(s.ready, false) + ' is ready to bill (' + s.readyCount + ' items).']);
    if (!r.cats.some(function (c) { return c.hasBudget; })) out.push(['dim', 'No budget yet \u2013 tap \u201cEdit budget\u201d to add one.']);
    return out;
  }
  function chart(r) {
    // cumulative cost vs billed by month
    var m = {};
    r.cats.forEach(function (c) { c.items.forEach(function (it) { var d = String(it.date || '').split('/'); if (d.length < 3) return; var y = +d[2] < 100 ? 2000 + +d[2] : +d[2];
      var k = y + '-' + ('0' + d[0]).slice(-2); (m[k] = m[k] || {c: 0, b: 0}).c += n(it.amount); }); });
    r.invoices.forEach(function (i) { if (!i.sent) return; var d = i.sent.split('/'); var k = d[2] + '-' + ('0' + d[0]).slice(-2); (m[k] = m[k] || {c: 0, b: 0}).b += i.total; });
    var ks = Object.keys(m).sort(); if (ks.length < 2) return '';
    var cc = 0, bb = 0, pts = ks.map(function (k) { cc += m[k].c; bb += m[k].b; return {k: k, c: cc, b: bb}; });
    var max = pts.reduce(function (a, p) { return Math.max(a, p.c, p.b); }, 1), W = 340, Hh = 110;
    var xy = function (i, v) { return (10 + i * (W - 20) / (pts.length - 1)).toFixed(1) + ',' + (Hh - 10 - v / max * (Hh - 25)).toFixed(1); };
    var line = function (key, col) { return '<polyline fill="none" stroke="' + col + '" stroke-width="2.5" points="' + pts.map(function (p, i) { return xy(i, p[key]); }).join(' ') + '"/>'; };
    return '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Cost vs billed over time</div></div><div style="padding:0 10px 10px">' +
      '<svg viewBox="0 0 ' + W + ' ' + Hh + '" style="width:100%;height:auto">' + line('c', '#f0a030') + line('b', '#6ea8ff') +
      '<text x="10" y="12" fill="#f0a030" font-size="11">cost ' + money(cc, false) + '</text><text x="' + (W - 10) + '" y="12" fill="#6ea8ff" font-size="11" text-anchor="end">billed ' + money(bb, false) + '</text></svg>' +
      '<div class="tl-s">' + esc(pts[0].k) + ' \u2192 ' + esc(pts[pts.length - 1].k) + '</div></div></div>';
  }

  function draw() {
    if (A.S.tab !== 'fin' || !A.curInv || A.curInv() !== 'JOB:' + JF.job) return;
    var r = JF.cur, html = '<div class="fn-back" data-jfback="1">\u2039 Jobs</div>';
    if (!r) { $('#view').innerHTML = html + '<div class="empty">Loading ' + esc(JF.job || '') + '\u2026</div>'; return; }
    var j = r.job, s = r.score;
    html += '<div class="fn-head"><div><div class="fn-no" style="font-size:20px">' + esc(j.job) + '</div><div class="tl-s">' +
      esc([j.client, j.type || 'no job type', j.contract ? j.contract + (j.contractAmt ? ' ' + money(j.contractAmt, false) : '') + (j.markup ? ' + ' + j.markup + '% ' + (j.feeLabel || 'fee') : '') : '', j.status].filter(Boolean).join(' \u00b7 ')) +
      '</div></div><button class="btn" data-jfa="setup" style="flex:none;min-width:0;padding:8px 12px">\u2699 Setup</button></div>';
    var pc = s.margin === null ? '' : (s.profit < 0 ? 'var(--red)' : (s.margin < 10 ? 'var(--orange)' : 'var(--green)'));
    html += '<div class="fn-tiles" style="margin-top:10px">' +
      tile('Cost so far', money(s.cost, false), 'bills ' + money(s.costs, false) + ' \u00b7 crew ' + money(s.payroll, false) + ' \u00b7 machines ' + money(s.machine, false)) +
      tile('Earned', money(s.earned, false), esc(s.earnedHow)) +
      tile('Profit so far', money(s.profit, false), s.margin === null ? '' : s.margin + '% margin', pc) +
      tile('Budget used', s.budgetPct === null ? '\u2013' : s.budgetPct + '%', s.budget ? money(s.spent, false) + ' of ' + money(s.budget, false) + (s.direct ? ' (incl. ' + money(s.direct, false) + ' the client paid directly)' : '') : 'no budget yet', s.budgetPct > 100 ? 'var(--red)' : '') +
      tile('Done', s.pctComplete === null ? '\u2013' : s.pctComplete + '%', s.pctComplete === null ? 'no checklist yet' : 'of the checklist') +
      tile('Billed', money(s.billed, false), 'collected ' + money(s.collected, false) + (s.owed ? ' \u00b7 owed ' + money(s.owed, false) : '') + (s.billedBefore ? ' \u00b7 before the app ' + money(s.billedBefore, false) : '')) +
      '</div>';
    var nt = notes(r);
    if (nt.length) html += '<div class="sam-box" style="margin:0 0 10px"><div class="tl-s" style="margin-bottom:4px">\ud83e\udd16 Sam\u2019s notes</div>' + nt.map(function (x) {
      return '<div style="margin:3px 0;color:' + ({red: '#ff8a80', orange: '#ffc069', green: '#8fe3a8', blue: '#9cc3ff', dim: '#cfd6e0'}[x[0]]) + '">\u2022 ' + x[1] + '</div>'; }).join('') + '</div>';
    // budget vs actual
    var cats = r.cats.filter(function (c) { return JF.showAll || hasB(c) || c.total || c.items.length || c.machineUnknownHrs; });
    var rows = cats.map(function (c) {
      var col = catColor(c);
      return '<div class="fn-r" data-jfcat="' + esc(c.cat) + '" style="flex-direction:column;gap:4px"><div style="display:flex;gap:8px;width:100%"><div class="tl-x"><div class="fn-t">' + esc(c.cat) + '</div></div>' +
        '<div class="fn-amt">' + money(c.total, false) + (hasB(c) ? '<span class="tl-s"> / ' + money(c.budget, false) + '</span>' : '') + '</div></div>' +
        (hasB(c) ? bar(c.pctBudget, col) : '') +
        '<div class="tl-s">' + [c.costs ? 'bills ' + money(c.costs, false) : '', c.labor ? 'crew ' + money(c.labor, false) : '', c.machine ? 'machines ' + money(c.machine, false) : '', c.direct ? 'client paid ' + money(c.direct, false) : '',
          c.machineUnknownHrs ? c.machineUnknownHrs + ' machine hrs (no cost yet)' : '', c.pctBudget !== null ? '<span style="color:' + col + '">' + c.pctBudget + '%</span>' : 'no budget',
          c.items.length + ' entr' + (c.items.length === 1 ? 'y' : 'ies')].filter(Boolean).join(' \u00b7 ') + '</div></div>';
    });
    html += '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Budget vs actual</div><div class="tl-hc">' + (s.budget ? money(s.spent, false) + ' / ' + money(s.budget, false) : '') + '</div></div>' +
      (rows.length ? rows.join('') : '<div class="tl-hs">Nothing spent or budgeted yet.</div>') +
      '<div class="fn-bar"><button class="btn primary" data-jfa="budget">Edit budget</button><button class="btn" data-jfa="all">' + (JF.showAll ? 'Hide empty' : 'Show all categories') + '</button></div></div>';
    html += chart(r);
    // change orders
    html += '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Change orders</div><div class="tl-hc">' + (s.coApproved ? money(s.coApproved, false) + ' approved' : r.changeOrders.length) + '</div></div>' +
      r.changeOrders.map(function (c) {
        return '<div class="fn-r" data-jfco="' + esc(c.id) + '"><div class="tl-x"><div class="fn-t">' + esc((c.no ? c.no + ' \u00b7 ' : '') + c.desc) + '</div><div class="tl-s">' +
          (c.approvedBy ? '<span style="color:var(--green)">approved by ' + esc(c.approvedBy) + '</span>' : '<span style="color:var(--orange)">not approved yet</span>') + (c.billed ? ' \u00b7 billed' : '') +
          (c.date ? ' \u00b7 ' + esc(c.date) : '') + '</div></div><div class="fn-amt">' + money(c.amount) + '</div></div>'; }).join('') +
      '<div class="fn-bar"><button class="btn" data-jfa="co">+ Add a change order</button></div></div>';
    // checklist
    html += checklistHtml(r);
    // invoices
    if (r.invoices.length) html += '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Invoices</div><div class="tl-hc">' + r.invoices.length + '</div></div>' + r.invoices.map(function (i) {
      return '<div class="fn-r" data-finv="' + esc(i.no) + '"><div class="tl-x"><div class="fn-t">#' + esc(i.no) + ' \u00b7 ' + esc(i.status) + '</div><div class="tl-s">' + esc(i.sent ? 'sent ' + i.sent : i.date) +
        (i.paid ? ' \u00b7 paid ' + money(i.paid, false) : '') + '</div></div><div class="fn-amt">' + money(i.total) + '</div></div>'; }).join('') + '</div>';
    $('#view').innerHTML = html;
  }

  function checklistHtml(r) {
    var ck = r.checklist, s = r.score;
    if (!ck.length) return '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Completion checklist</div></div><div class="tl-hs">' +
      (r.job.type ? 'Start the ' + esc(r.job.type) + ' checklist: permits, inspections and each stage of the build.' : 'Pick a job type in Setup first, then start its checklist.') + '</div>' +
      '<div class="fn-bar">' + (r.job.type ? '<button class="btn primary" data-jfa="startck">Start checklist</button>' : '<button class="btn" data-jfa="setup">Setup</button>') + '</div></div>';
    var stages = [], by = {};
    ck.forEach(function (c) { if (!by[c.stage]) { by[c.stage] = []; stages.push(c.stage); } by[c.stage].push(c); });
    var html = '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Completion checklist</div><div class="tl-hc">' + s.pctComplete + '% done</div></div>' +
      '<div style="padding:0 14px 8px">' + bar(s.pctComplete, 'var(--green)') + '</div>';
    stages.forEach(function (st) {
      var items = by[st], d = items.filter(function (c) { return c.done; }).length, open = JF.open[st] !== undefined ? JF.open[st] : (d < items.length && !JF.firstOpen && (JF.firstOpen = st));
      if (JF.open[st] === undefined && JF.firstOpen === st) open = true;
      html += '<div class="fn-r" data-jfstage="' + esc(st) + '" style="background:#151515"><div class="tl-x"><div class="fn-t"><b>' + esc(st) + '</b></div></div><div class="fn-amt" style="font-weight:400">' +
        (d === items.length ? '<span style="color:var(--green)">\u2713 done</span>' : d + ' of ' + items.length) + ' ' + (open ? '\u25b4' : '\u203a') + '</div></div>';
      if (open) items.forEach(function (c) {
        html += '<div class="tl-r' + (c.done ? ' is-done' : '') + '"><span class="tl-ckw" data-jfck="' + esc(c.id) + '"><span class="tl-ck"></span></span>' +
          '<div class="tl-x" data-jfitem="' + esc(c.id) + '"><div class="tl-t">' + (c.kind === 'Inspection' ? '\ud83d\udd0e ' : '') + esc(c.item) + '</div><div class="tl-s">' +
          esc([c.done ? 'done ' + c.date + (c.by ? ' by ' + c.by : '') : '', c.inspector ? c.inspector : '', c.result, c.notes].filter(Boolean).join(' \u00b7 ')) + '</div></div></div>';
      });
    });
    return html + '<div class="fn-bar"><button class="btn" data-jfa="ckadd">+ Add an item</button></div></div>';
  }

  // ---------- sheets ----------
  function setupSheet() {
    var r = JF.cur, j = r.job, L = r.lists || {};
    var modes = [['', 'Machine hrs \u00d7 rate + off-machine labor (normal)'], ['Machine hrs incl. operator', 'Machine hrs only (operator included)'], ['Machine + labor', 'Machine hrs + all labor hours']];
    A.sheet('<h2>' + esc(j.job) + ' \u2013 setup</h2>' +
      '<label>Job type (sets its categories and checklist)</label><select id="js-t">' + A.options(r.types, j.type, true) + '</select>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Contract</label><select id="js-c">' + A.options(L.contract, j.contract, true) + '</select></div>' +
      '<div style="flex:1"><label>Bid / contract $</label><input id="js-a" inputmode="decimal" value="' + (j.contractAmt || '') + '"></div></div>' +
      '<div style="display:flex;gap:8px"><div style="flex:2"><label>Fee name</label><input id="js-fl" value="' + esc(j.feeLabel) + '" placeholder="Builder Fee"></div>' +
      '<div style="flex:1"><label>Fee %</label><input id="js-m" inputmode="decimal" value="' + (j.markup || '') + '"></div></div>' +
      '<label>How often it\u2019s billed</label><select id="js-s">' + A.options(['When the job is done', 'Monthly', 'At milestones'], j.schedule, true) + '</select>' +
      '<label>Machine & labor billing</label><select id="js-md">' + modes.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === j.mode ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>' +
      '<div class="sub">For bid jobs, \u201cEarned\u201d = bid \u00d7 % of the checklist done.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {job: j.job, type: $('#js-t').value, contract: $('#js-c').value, contractAmt: $('#js-a').value.trim(), feeLabel: $('#js-fl').value.trim(), markup: $('#js-m').value.trim(),
        schedule: $('#js-s').value, mode: $('#js-md').value};
      if (f.markup && !f.feeLabel) f.feeLabel = 'Builder Fee';
      A.closeSheet(); call('job.setup', f).then(function (x) { toast('Saved'); set(x); });
    });
  }

  function budgetSheet() {
    var r = JF.cur, cats = [];
    r.templateCats.concat(r.cats.map(function (c) { return c.cat; })).forEach(function (c) { if (c && c !== 'Not sorted yet' && cats.indexOf(c) < 0) cats.push(c); });
    var byCat = {}; r.cats.forEach(function (c) { byCat[c.cat] = c; });
    var rowH = function (c) { var x = byCat[c] || {}; return '<div class="fn-brow"><div class="tl-x"><div class="fn-t" style="font-size:14px">' + esc(c) + '</div><div class="tl-s">spent ' + money(x.total || 0, false) +
      '</div></div><input class="jb-in" data-cat="' + esc(c) + '" inputmode="decimal" value="' + (x.hasBudget ? x.budget : '') + '" placeholder="$"></div>'; };
    A.sheet('<h2>Budget \u2013 ' + esc(r.job.job) + '</h2><div class="sub">Type a budget for each category. Leave blank for none.</div>' +
      '<div id="jb-rows">' + cats.map(rowH).join('') + '</div>' +
      '<label>Add a category</label><div style="display:flex;gap:8px"><select id="jb-new" style="flex:1"><option value=""></option>' + r.allCats.filter(function (c) { return cats.indexOf(c) < 0; }).map(function (c) {
        return '<option>' + esc(c) + '</option>'; }).join('') + '</select><button class="btn" data-act="addcat" style="flex:none;min-width:0">Add</button></div>' +
      '<div class="kv" style="margin-top:10px">Total: <b id="jb-tot"></b></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save budget</button></div>', function (a) {
      if (a === 'addcat') { var v = $('#jb-new').value; if (!v) return; cats.push(v); $('#jb-rows').insertAdjacentHTML('beforeend', rowH(v)); var sel = $('#jb-new'); sel.remove(sel.selectedIndex); sel.value = ''; return; }
      if (a !== 'go') return A.closeSheet();
      var lines = [];
      Array.prototype.forEach.call(document.querySelectorAll('.jb-in'), function (el) {
        var c = el.getAttribute('data-cat'), v = el.value.trim(), x = byCat[c];
        if (v === '' && !(x && x.hasBudget)) return;
        if (x && x.hasBudget && v !== '' && n(v) === x.budget) return;
        lines.push({category: c, amount: v});
      });
      A.closeSheet();
      if (!lines.length) return toast('No changes');
      call('job.budget', {job: r.job.job, lines: lines}).then(function (x) { toast('Budget saved'); set(x); });
    });
    var tot = function () { var t = 0; Array.prototype.forEach.call(document.querySelectorAll('.jb-in'), function (el) { t += n(el.value); }); $('#jb-tot').textContent = money(t, false); };
    $('#jb-rows').oninput = tot; tot();
  }

  function catSheet(name) {
    var r = JF.cur, c = r.cats.filter(function (x) { return x.cat === name; })[0]; if (!c) return;
    A.sheet('<h2>' + esc(name) + '</h2><div class="kv">' + money(c.total) + (c.hasBudget ? ' of ' + money(c.budget) + ' budget (' + c.pctBudget + '%)' : ' \u00b7 no budget') + '</div>' +
      (c.lineItems.length ? '<div class="sub">Usually includes: ' + esc(c.lineItems.join(', ')) + '</div>' : '') +
      (c.items.length ? c.items.map(function (it, k) {
        return '<div class="fn-r" data-act="it' + k + '" style="padding-left:0;padding-right:0"><div class="tl-x"><div class="fn-t" style="font-size:14px">' + esc(it.what) + '</div><div class="tl-s">' +
          esc([it.src === 'Cost' ? 'bill/receipt' : (it.src === 'Labor' ? 'crew pay' : 'machine'), it.date, it.billed ? 'billed ' + it.billed : '', it.inherited ? 'sorted from the crew\u2019s pick' : '',
            it.costUnknown ? 'no hourly cost yet' : ''].filter(Boolean).join(' \u00b7 ')) + '</div></div><div class="fn-amt" style="font-size:14px">' + (it.costUnknown ? '\u2013' : money(it.amount)) + '</div></div>'; }).join('')
        : '<div class="sub">Nothing in this category yet.</div>') +
      '<div class="btns"><button class="btn" data-act="x">Close</button></div>', function (a) {
      if (/^it\d+$/.test(a)) return editItem(c.items[+a.slice(2)], name);
      A.closeSheet(); });
  }

  function editItem(it, fromCat) {
    var r = JF.cur, cost = it.src === 'Cost';
    A.sheet('<h2>' + esc(cost ? 'Fix this cost' : 'Sort this entry') + '</h2><div class="kv">' + esc(it.what) + '</div>' +
      '<label>Category</label><select id="je-c">' + A.options(r.allCats, it.category || '', true) + '</select>' +
      (cost ? '<label>Vendor</label><input id="je-v" value="' + esc(it.vendor) + '"><label>Description</label><input id="je-d" value="' + esc(it.desc) + '">' +
        '<div style="display:flex;gap:8px"><div style="flex:1"><label>Amount</label><input id="je-a" inputmode="decimal" value="' + n(it.amount).toFixed(2) + '"' + (it.billed === 'Yes' ? ' disabled' : '') + '></div>' +
        '<div style="flex:1"><label>Date</label><input id="je-dt" value="' + esc(it.date) + '"></div></div>' +
        '<label>Billing</label><select id="je-b">' + A.options(r.lists.billing, it.billing) + '</select>' +
        (it.billed === 'Yes' ? '<div class="sub">Already billed to the client, so the amount is locked.</div>' : '') +
        (it.receipt ? '<div class="kv"><a href="' + esc(it.receipt) + '" target="_blank" rel="noopener">\ud83e\uddfe Open the receipt</a></div>' : '')
        : '<div class="sub">' + (it.src === 'Labor' ? 'Crew pay comes from the hours they logged.' : 'Machine cost = hours \u00d7 what the machine costs us per hour.') + '</div>') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {job: r.job.job, src: it.src, id: it.id, category: $('#je-c').value};
      if (cost) { f.vendor = $('#je-v').value.trim(); f.desc = $('#je-d').value.trim(); f.date = $('#je-dt').value.trim(); f.billing = $('#je-b').value; if (it.billed !== 'Yes') f.amount = $('#je-a').value.trim(); }
      A.closeSheet(); call('job.edit', f).then(function (x) { toast('Saved'); set(x); });
    });
  }

  function coSheet(c) {
    var r = JF.cur, isNew = !c; c = c || {desc: '', amount: '', approvedBy: '', date: A.todayStr(), no: ''};
    A.sheet('<h2>' + (isNew ? 'New change order' : 'Change order ' + esc(c.no)) + '</h2><label>What changed</label><textarea id="jc-d">' + esc(c.desc) + '</textarea>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Amount</label><input id="jc-a" inputmode="decimal" value="' + (isNew ? '' : n(c.amount).toFixed(2)) + '"' + (c.billed ? ' disabled' : '') + '></div>' +
      '<div style="flex:1"><label>Date</label><input id="jc-dt" value="' + esc(c.date) + '"></div></div>' +
      '<label>Approved by the client? (who)</label><input id="jc-ap" value="' + esc(c.approvedBy) + '" placeholder="e.g. Adam Buna, by text 11/12">' +
      '<div class="sub">Approved change orders add to the contract and show up as ready to bill.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (!isNew && !c.billed ? '<button class="btn" data-act="rm" style="color:var(--red)">Delete</button>' : '') +
      '<button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') { if (!confirm('Delete this change order?')) return; A.closeSheet(); return call('job.co', {job: r.job.job, id: c.id, remove: true}).then(set); }
      if (a !== 'go') return A.closeSheet();
      var f = {job: r.job.job, desc: $('#jc-d').value.trim(), date: $('#jc-dt').value.trim(), approvedBy: $('#jc-ap').value.trim()};
      if (!c.billed) f.amount = $('#jc-a').value.trim();
      if (!isNew) f.id = c.id;
      if (!f.desc) return toast('Say what changed'); if (isNew && !f.amount) return toast('Type the amount');
      A.closeSheet(); call('job.co', f).then(function (x) { toast('Saved'); set(x); });
    });
  }

  function itemSheet(c) {
    var r = JF.cur;
    A.sheet('<h2>' + esc(c.item) + '</h2><div class="kv">' + esc(c.stage) + (c.kind === 'Inspection' ? ' \u00b7 inspection' : '') + '</div>' +
      '<label class="fn-chk"><input type="checkbox" id="ji-d"' + (c.done ? ' checked' : '') + '> Done</label>' +
      '<label>Date done</label><input id="ji-dt" value="' + esc(c.date || A.todayStr()) + '">' +
      (c.kind === 'Inspection' ? '<div style="display:flex;gap:8px"><div style="flex:1"><label>Inspector</label><input id="ji-i" value="' + esc(c.inspector) + '"></div>' +
        '<div style="flex:1"><label>Result</label><select id="ji-r">' + A.options(['Passed', 'Passed with notes', 'Failed \u2013 re-inspect'], c.result, true) + '</select></div></div>' : '') +
      '<label>Notes</label><textarea id="ji-n">' + esc(c.notes) + '</textarea>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn" data-act="rm" style="color:var(--red)">Remove</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') { if (!confirm('Remove \u201c' + c.item + '\u201d from this job\u2019s checklist?')) return; A.closeSheet(); return call('job.check', {job: r.job.job, id: c.id, remove: true}).then(set); }
      if (a !== 'go') return A.closeSheet();
      var f = {job: r.job.job, id: c.id, done: $('#ji-d').checked, date: $('#ji-dt').value.trim(), notes: $('#ji-n').value.trim()};
      if ($('#ji-i')) { f.inspector = $('#ji-i').value.trim(); f.result = $('#ji-r').value; }
      A.closeSheet(); call('job.check', f).then(set);
    });
  }
  function addItemSheet() {
    var r = JF.cur, stages = []; r.checklist.forEach(function (c) { if (stages.indexOf(c.stage) < 0) stages.push(c.stage); });
    A.sheet('<h2>Add to the checklist</h2><label>Item</label><input id="ja-i" placeholder="e.g. Propane line pressure test">' +
      '<label>Stage</label><select id="ja-s">' + A.options(stages.concat(['Other']), stages[stages.length - 1]) + '</select>' +
      '<label class="fn-chk"><input type="checkbox" id="ja-k"> It\u2019s an inspection</label>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Add</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {job: r.job.job, item: $('#ja-i').value.trim(), stage: $('#ja-s').value, kind: $('#ja-k').checked ? 'Inspection' : 'Step'};
      if (!f.item) return toast('Type the item');
      A.closeSheet(); call('job.check', f).then(set);
    });
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'fin' || !JF.job || !A.curInv || A.curInv() !== 'JOB:' + JF.job || e.target.closest('#sheet')) return;
    var t, r = JF.cur;
    if ((t = e.target.closest('[data-jfback]'))) { history.back(); return; }
    if (!r) return;
    if (JF.busy && (e.target.closest('[data-jfa]') || e.target.closest('[data-jfck]'))) return toast('One moment\u2026');
    if ((t = e.target.closest('[data-jfa]'))) {
      var a = t.getAttribute('data-jfa');
      if (a === 'setup') return setupSheet();
      if (a === 'budget') return budgetSheet();
      if (a === 'all') { JF.showAll = !JF.showAll; return draw(); }
      if (a === 'co') return coSheet(null);
      if (a === 'startck') return call('job.setup', {job: r.job.job, checklist: true}).then(function (x) { toast('Checklist started'); set(x); });
      if (a === 'ckadd') return addItemSheet();
    }
    if ((t = e.target.closest('[data-jfcat]'))) return catSheet(t.getAttribute('data-jfcat'));
    if ((t = e.target.closest('[data-jfco]'))) return coSheet(r.changeOrders.filter(function (c) { return c.id === t.getAttribute('data-jfco'); })[0]);
    if ((t = e.target.closest('[data-jfstage]'))) { var st = t.getAttribute('data-jfstage'), cur = JF.open[st]; JF.open[st] = !(cur === undefined ? JF.firstOpen === st : cur); return draw(); }
    if ((t = e.target.closest('[data-jfck]'))) {
      var c = r.checklist.filter(function (x) { return x.id === t.getAttribute('data-jfck'); })[0]; if (!c) return;
      c.done = !c.done; draw();   // instant, then save
      return call('job.check', {job: r.job.job, id: c.id, done: c.done}).then(set, function () { c.done = !c.done; draw(); });
    }
    if ((t = e.target.closest('[data-jfitem]'))) return itemSheet(r.checklist.filter(function (x) { return x.id === t.getAttribute('data-jfitem'); })[0]);
  });

  A.renderJob = function (job) { if (JF.job !== job || !JF.cur) { JF.firstOpen = null; JF.open = {}; load(job); } else draw(); };
  A.reloadJob = function () { if (JF.job) load(JF.job); };
})();
