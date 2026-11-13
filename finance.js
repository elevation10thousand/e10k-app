/* E10K app: 💵 Finance (owners only: Spencer and Hanna).
 *  - Invoices: one open draft per job that fills itself from bills, receipts, crew hours and machine hours.
 *    Hanna asks Spencer to approve -> Spencer approves or sends it back -> Hanna downloads it (Invoice only /
 *    Invoice + receipts), sends it herself, marks it Sent, then records payments. Every invoice needs Spencer's OK.
 *  - Bills & pay-backs: unpaid vendor bills, crew pay-backs, mark paid (date + check #), add a bill.
 *  - Money: spent vs billed vs collected per job and per month; what's owed to us; job billing setup.
 * Backend: Finance.js (fin.*). PDF: invoice.js + pdf-lib (loaded only when downloading). */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var F = {d: ls.get('fin', null), open: null, cur: null, busy: false, box: {}, pick: {}, bpick: {}};
  var ST = {
    'Draft': {c: 'var(--dim)', t: 'Draft'}, 'Waiting on Spencer': {c: 'var(--orange)', t: 'Waiting on Spencer'},
    'Approved': {c: 'var(--green)', t: 'Approved \u2013 ready to send'}, 'Sent': {c: 'var(--blue)', t: 'Sent'},
    'Part paid': {c: 'var(--blue)', t: 'Part paid'}, 'Paid': {c: 'var(--green)', t: 'Paid'}, 'Void': {c: 'var(--dim)', t: 'Void'}};

  function owner() { var m = A.me(); return !!(m && m.owner); }
  function meName() { var m = A.me(); return m ? m.name : ''; }
  function isApprover() { return F.d ? meName() === F.d.approver : meName() === 'Spencer'; }
  function view() { return ls.get('finView', 'inv'); }
  function n(v) { var s = String(v === undefined || v === null ? '' : v).replace(/[$,\s]/g, ''); var neg = /^\(.*\)$/.test(s); var x = parseFloat(s.replace(/[()]/g, '')); return isNaN(x) ? 0 : (neg ? -x : x); }
  function money(v, cents) {
    var x = n(v), a = Math.abs(x), s = cents === false ? Math.round(a).toString() : a.toFixed(2);
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (x < 0 ? '-$' : '$') + s;
  }
  function err(e) {
    var m = String((e && e.error) || e || 'error');
    var plain = {needs_approval: 'Spencer has to approve it first', only_spencer: 'Only Spencer can approve invoices', note_required: 'Type a note for Hanna',
      no_lines: 'Add at least one line first', locked: 'This invoice was already sent, so it can\u2019t be changed', draft_exists: 'This job already has an open draft',
      amount_required: 'Type an amount', desc_required: 'Type a description', pick_a_job: 'Pick a job or type who it\u2019s for', vendor_required: 'Type the vendor'};
    return plain[m] || m.replace(/_/g, ' ');
  }
  function call(action, args) {
    if (!navigator.onLine) { toast('No signal \u2013 Finance needs a connection'); return Promise.reject('offline'); }
    F.busy = true;
    return A.api(action, args).then(function (r) { F.busy = false; if (!r.ok) { toast(err(r)); throw r; } return r; },
      function (e) { F.busy = false; toast('Could not reach the server \u2013 try again'); throw e; });
  }

  // ---------- data ----------
  function load() {
    if (!owner() || !navigator.onLine) return Promise.resolve();
    return A.api('fin.list').then(function (r) {
      if (!r.ok) return;
      F.d = r; ls.set('fin', r); badge();
      if (A.S.tab === 'fin' && !F.open) render(true);
    }).catch(function () {});
  }
  function badgeCount() {
    if (!F.d) return 0;
    var inv = F.d.invoices || [];
    if (isApprover()) return inv.filter(function (i) { return i.status === 'Waiting on Spencer'; }).length;
    return inv.filter(function (i) { return i.overdue || i.status === 'Approved' || (i.status === 'Draft' && /Spencer:/.test(i.approvalNote || '')); }).length;
  }
  function badge() {
    var ic = document.querySelector('[data-tab=fin] .ic'); if (!ic) return;
    var old = ic.querySelector('.badge'); if (old) old.remove();
    var c = badgeCount();
    if (c) ic.insertAdjacentHTML('beforeend', '<span class="badge" style="background:var(--orange)">' + c + '</span>');
  }

  // ---------- shared bits ----------
  function seg() {
    var v = view();
    return '<div class="tl-seg">' + [['inv', 'Invoices'], ['jobs', 'Jobs'], ['bills', 'Bills'], ['money', 'Money']].map(function (x) {
      return '<button class="' + (v === x[0] ? 'on' : '') + '" data-finview="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
  }
  function box(key, title, count, rows, opt) {
    opt = opt || {};
    var open = !!F.box[key], collapsed = opt.collapsed && !open, limit = opt.limit || 6;
    var shown = collapsed ? [] : (open ? rows : rows.slice(0, limit)), rest = rows.length - shown.length;
    return '<div class="tl-box' + (opt.cls ? ' ' + opt.cls : '') + '"><div class="tl-h"' + (opt.collapsed ? ' data-finbox="' + key + '"' : '') + '><div class="tl-ht">' + title +
      '</div><div class="tl-hc">' + count + (opt.collapsed ? (open ? ' \u25b4' : ' \u203a') : '') + '</div></div>' + (opt.sub ? '<div class="tl-hs">' + esc(opt.sub) + '</div>' : '') +
      shown.join('') + (!collapsed && rest > 0 ? '<div class="tl-more" data-finbox="' + key + '">+' + rest + ' more \u203a</div>' : '') + '</div>';
  }
  function row(attrs, title, sub, right, rightSub) {
    return '<div class="fn-r" ' + attrs + '><div class="tl-x"><div class="fn-t">' + title + '</div>' + (sub ? '<div class="tl-s">' + sub + '</div>' : '') + '</div>' +
      '<div class="fn-amt">' + right + (rightSub ? '<div class="tl-s" style="text-align:right">' + rightSub + '</div>' : '') + '</div></div>';
  }
  function stTxt(i) {
    var s = ST[i.status] || ST.Draft, t = s.t, c = s.c;
    if (i.overdue) { t = 'Overdue \u2013 sent ' + i.days + ' days ago'; c = 'var(--red)'; }
    else if ((i.status === 'Sent' || i.status === 'Part paid') && i.days !== null) t += ' ' + i.days + ' day' + (i.days === 1 ? '' : 's') + ' ago';
    if (i.status === 'Draft' && /Spencer:/.test(i.approvalNote || '')) { t = 'Sent back by Spencer'; c = 'var(--orange)'; }
    return '<span style="color:' + c + '">' + esc(t) + '</span>';
  }
  function invRow(i) {
    var who = i.billTo || i.job || '';
    return row('data-finv="' + esc(i.no) + '"', esc(who), stTxt(i) + (i.job && i.billTo && i.job !== i.billTo ? ' \u00b7 ' + esc(i.job) : ''),
      money(i.total), (i.status === 'Part paid' ? money(i.due) + ' left' : '#' + esc(i.no)));
  }
  function tiles(list) {
    return '<div class="fn-tiles">' + list.map(function (t) {
      return '<div class="fn-tile"' + (t.go ? ' data-finview="' + t.go + '"' : '') + '><div class="tl-s">' + esc(t.l) + '</div><div class="fn-big"' + (t.c ? ' style="color:' + t.c + '"' : '') + '>' + t.v + '</div></div>'; }).join('') + '</div>';
  }

  // ---------- tab ----------
  function render(noFetch) {
    if (!owner()) { $('#view').innerHTML = '<div class="empty">Finance is for Spencer and Hanna.</div>'; return; }
    if (F.open && /^JOB:/.test(F.open)) return A.renderJob ? A.renderJob(F.open.slice(4)) : null;
    if (F.open) return renderInv(noFetch);
    var v = view(), html = seg();
    if (!F.d) html += '<div class="empty">Loading\u2026</div>';
    else if (v === 'bills') html += billsHtml();
    else if (v === 'money') html += moneyHtml();
    else if (v === 'jobs') html += jobsHtml();
    else html += invHtml();
    $('#view').innerHTML = html;
    badge();
    if (!noFetch) load();
  }

  function invHtml() {
    var d = F.d, inv = d.invoices || [], m = d.money || {}, html = '';
    html += tiles([{l: 'Owed to us', v: money(m.owed, false)}, {l: 'Overdue', v: money(m.overdue, false), c: m.overdue ? 'var(--red)' : ''},
      {l: 'Ready to bill', v: money(m.ready, false)}]);
    var by = function (s) { return inv.filter(function (i) { return s.indexOf(i.status) >= 0; }); };
    var waiting = by(['Waiting on Spencer']), drafts = by(['Draft']), appr = by(['Approved']), sent = by(['Sent', 'Part paid']);
    sent.sort(function (a, b) { return (b.days || 0) - (a.days || 0); });
    if (waiting.length) html += box('w', (isApprover() ? '\u270b Needs your OK' : 'Waiting on Spencer'), waiting.length, waiting.map(invRow), {cls: isApprover() ? 'tl-hot' : ''});
    if (appr.length) html += box('a', 'Approved \u2013 ready to send', appr.length, appr.map(invRow));
    if (drafts.length) html += box('d', 'Drafts', drafts.length, drafts.map(invRow), {limit: 8});
    if (sent.length) html += box('s', 'Sent \u2013 waiting for payment', sent.length, sent.map(invRow));
    var jobs = (d.jobs || []).filter(function (j) { return j.ready && !j.draft; });
    if (jobs.length) html += box('j', 'Ready to bill \u2013 no invoice yet', jobs.length, jobs.map(function (j) {
      return row('data-finstart="' + esc(j.job) + '"', esc(j.job), j.ready + ' item' + (j.ready === 1 ? '' : 's') + ' \u00b7 <span style="color:var(--blue)">Start invoice \u203a</span>', money(j.readyAmt)); }));
    var done = by(['Paid', 'Void']);
    if (done.length) html += box('p', 'Paid & void', done.length, done.slice().reverse().map(invRow), {collapsed: true, limit: 20});
    if (!inv.length && !jobs.length) html += '<div class="empty">No invoices yet. Tap + to start one.</div>';
    html += '<div class="tl-hint">Tap + to start an invoice for a job or a one-off customer.</div>';
    return html;
  }

  // ---------- jobs (each opens its money page, jobfin.js) ----------
  function jobsHtml() {
    var d = F.d, jobs = (d.jobs || []).slice(), html = '';
    var act = function (j) { return !/complete|closed|lost|cancel/i.test(j.status || ''); };
    var line = function (j) {
      var bits = [j.type || '', j.budget ? Math.round(100 * (j.cost || 0) / j.budget) + '% of budget' : '', j.pctDone !== null && j.pctDone !== undefined ? j.pctDone + '% done' : '',
        j.ready ? j.ready + ' to bill' : ''].filter(Boolean);
      var over = j.budget && j.cost > j.budget, warn = j.budget && j.pctDone !== null && j.pctDone !== undefined && (100 * j.cost / j.budget) - j.pctDone > 15;
      return row('data-finjob="' + esc(j.job) + '"', esc(j.job), (over ? '<span style="color:var(--red)">over budget</span> \u00b7 ' : (warn ? '<span style="color:var(--orange)">spending ahead of progress</span> \u00b7 ' : '')) +
        esc(bits.join(' \u00b7 ') || (j.status || '')), money(j.cost || 0, false), j.budget ? 'of ' + money(j.budget, false) : 'spent');
    };
    var a = jobs.filter(act), done = jobs.filter(function (j) { return !act(j); });
    a.sort(function (x, y) { return (y.cost || 0) - (x.cost || 0); });
    html += box('ja', 'Jobs', a.length, a.map(line), {limit: 30, sub: 'Tap a job to see what it cost, what we made, its budget and checklist.'});
    if (done.length) html += box('jd', 'Finished jobs', done.length, done.map(line), {collapsed: true, limit: 40});
    return html;
  }
  function openJob(job) {
    F.open = 'JOB:' + job;
    if (A.S.tab !== 'fin') { A.S.tab = 'fin'; ls.set('tab', 'fin'); }
    A.navPush(); window.scrollTo(0, 0); A.render();
  }

  // ---------- one invoice ----------
  function openInv(no) {
    F.open = String(no); F.cur = null; F.pick = {};
    if (A.S.tab !== 'fin') { A.S.tab = 'fin'; ls.set('tab', 'fin'); }
    A.navPush(); window.scrollTo(0, 0);
    A.render();
    return call('fin.get', {no: no}).then(function (r) { F.cur = r; if (F.open === String(no)) renderInv(true); });
  }
  function setCur(r) { F.cur = r; renderInv(true); load(); }

  function renderInv() {
    var r = F.cur;
    if (!r || r.invoice.no !== F.open) {
      $('#view').innerHTML = '<div class="fn-back" data-finback="1">\u2039 Invoices</div><div class="empty">Loading invoice ' + esc(F.open) + '\u2026</div>';
      return;
    }
    var i = r.invoice, t = r.totals, locked = ['Sent', 'Part paid', 'Paid', 'Void'].indexOf(i.status) >= 0, bid = i.kind === 'Bid';
    var html = '<div class="fn-back" data-finback="1">\u2039 Invoices</div>';
    html += '<div class="fn-head"><div><div class="fn-no">#' + esc(i.no) + '</div><div class="tl-s">' + stTxt(i) + '</div></div>' +
      '<div style="text-align:right"><div class="fn-big">' + money(t.total) + '</div>' + (i.paid ? '<div class="tl-s">' + money(i.paid) + ' paid</div>' : '') + '</div></div>';
    html += '<div class="kv"><b>' + esc(i.billTo || '(no bill-to)') + '</b>' + (i.address ? ' \u00b7 ' + esc(i.address) : '') + '</div>';
    html += '<div class="kv">' + esc([i.job || 'No job (one-off)', bid ? 'Bid job \u2013 client sees only the typed lines' : '', i.date].filter(Boolean).join(' \u00b7 ')) +
      (!locked ? ' \u00b7 <a href="#" data-finedit="1">Edit details</a>' : '') + '</div>';
    if (i.approvalNote) html += '<div class="fn-note">' + esc(i.approvalNote) + '</div>';
    // actions
    var acts = [];
    if (i.status === 'Waiting on Spencer' && r.canApprove) {
      acts.push('<button class="btn ok" data-finact="approve">\u2705 Approve</button>', '<button class="btn" data-finact="back">\u21a9 Send back</button>');
    } else if (i.status === 'Draft' || (i.status === 'Waiting on Spencer' && !r.canApprove)) {
      if (i.status === 'Draft') acts.push('<button class="btn primary" data-finact="submit">' + (r.canApprove ? '\u2705 Approve it' : 'Ask Spencer to approve') + '</button>');
    }
    if (i.status === 'Approved') acts.push('<button class="btn primary" data-finact="sent">\ud83d\udce4 Mark sent</button>');
    if (i.status === 'Sent' || i.status === 'Part paid') acts.push('<button class="btn ok" data-finact="pay">\ud83d\udcb5 Record payment</button>');
    if (acts.length) html += '<div class="btns" style="margin-top:8px">' + acts.join('') + '</div>';
    html += '<div class="btns" style="margin-top:8px"><button class="btn" data-finact="pdf">\u2b07 Invoice</button><button class="btn" data-finact="pdfr">\u2b07 Invoice + receipts</button></div>';
    if (['Draft', 'Waiting on Spencer'].indexOf(i.status) >= 0) html += '<div class="tl-hint" style="padding-top:6px">Downloads say \u201cDRAFT\u201d until Spencer approves.</div>';
    // ready items
    if (r.ready && r.ready.length && !locked) {
      var rows = r.ready.map(function (x, k) {
        var key = x.src + '|' + x.id, on = x.needsRate ? F.pick[key] === true : F.pick[key] !== false;
        var sub = esc(x.src) + ' \u00b7 ' + esc(x.date || '') + (x.hours ? ' \u00b7 ' + x.hours + ' hrs \u00d7 ' + money(x.rate) : '') +
          (x.needsRate ? ' \u00b7 <span class="tl-late">no bill rate \u2013 tick it, then tap the line to type a rate</span>' : '') + (x.receipt ? ' \u00b7 \ud83e\uddfe' : '');
        return '<label class="fn-r fn-pick"><input type="checkbox" data-finpick="' + esc(key) + '"' + (on ? ' checked' : '') + '>' +
          '<div class="tl-x"><div class="fn-t">' + esc(x.desc) + '</div><div class="tl-s">' + sub + '</div></div><div class="fn-amt">' + money(x.amount) + '</div></label>';
      });
      html += '<div class="tl-box" style="border-color:#1f3352;background:#0d1420"><div class="tl-h"><div class="tl-ht">\u2795 Ready to add</div><div class="tl-hc">' + r.ready.length + '</div></div>' +
        '<div class="tl-hs">New bills, receipts and hours on this job that aren\u2019t on an invoice yet.</div>' + rows.join('') +
        '<div class="fn-bar"><button class="btn primary" data-finact="add">Add picked</button><button class="btn" data-finact="skip">Not billing these\u2026</button></div></div>';
    }
    // lines
    var shown = r.lines.filter(function (l) { return l.onInvoice; }), tracked = r.lines.filter(function (l) { return !l.onInvoice; });
    var lineRow = function (l) {
      var sub = [l.kind === 'Imported' ? 'from Hanna\u2019s sheet' : l.kind];
      if (l.hours !== '' && l.rate !== '') sub.push(l.hours + ' \u00d7 ' + money(l.rate));
      if (l.date) sub.push(esc(l.date));
      if (l.noFee && t.feePct) sub.push('no fee');
      if (l.receipt) sub.push('\ud83e\uddfe');
      return row((locked ? '' : 'data-finline="' + esc(l.id) + '"'), esc(l.desc), sub.join(' \u00b7 '), money(l.amount));
    };
    html += box('lines', 'On the invoice', shown.length, shown.map(lineRow), {limit: 999});
    if (!locked) html += '<div class="btns" style="margin:-4px 0 10px"><button class="btn" data-finact="line">+ Add a line</button></div>';
    if (tracked.length) html += box('tracked', 'Tracking only (not on the invoice)', money(t.tracked), tracked.map(lineRow), {collapsed: !bid, limit: 999,
      sub: bid ? 'Costs on this bid job, kept so you can see what it cost.' : ''});
    // totals
    var tr = function (a, b, bold) { return '<div class="fn-tr' + (bold ? ' fn-tot' : '') + '"><span>' + a + '</span><span>' + b + '</span></div>'; };
    html += '<div class="card">' + tr('Items', money(t.items)) + (t.feePct ? tr(esc(i.feeLabel || 'Builder Fee') + ' (' + t.feePct + '%)', money(t.fee)) : '') +
      (t.taxRate ? tr('Sales tax (' + t.taxRate + '%)', money(t.tax)) : '') + (t.other ? tr('Other', money(t.other)) : '') + tr('Total', money(t.total), true) +
      (i.paid ? tr('Paid', money(i.paid)) + tr('Left to pay', money(i.due), true) : '') + '</div>';
    if (r.payments && r.payments.length) html += box('pays', 'Payments', r.payments.length, r.payments.map(function (p) {
      return row('data-finpayx="' + esc(p.id) + '"', money(p.amount) + ' on ' + esc(p.date), esc(p.how || '') + (p.by ? ' \u00b7 entered by ' + esc(p.by) : ''), ''); }), {limit: 99});
    html += '<div class="kv" style="margin-top:6px">Notes: ' + (i.notes ? esc(i.notes.replace(/\[[^\]]+\]/g, '').trim()) : '<span class="tl-s">none</span>') + ' \u00b7 <a href="#" data-finact="notes">edit</a></div>';
    if (!locked) html += '<div class="btns"><button class="btn" data-finact="void" style="color:var(--red)">Void this invoice</button></div>';
    $('#view').innerHTML = html;
  }

  function invAction(act) {
    var r = F.cur, i = r.invoice, no = i.no;
    if (act === 'approve') {
      return A.sheet('<h2>Approve invoice #' + esc(no) + '?</h2><div class="kv">' + esc(i.billTo) + ' \u00b7 <b>' + money(r.totals.total) + '</b></div>' +
        '<label>Note for Hanna (optional)</label><textarea id="fn-note"></textarea><div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn ok" data-act="go">Approve</button></div>',
        function (a) { if (a !== 'go') return A.closeSheet(); var note = $('#fn-note').value.trim(); A.closeSheet();
          call('fin.decide', {no: no, approve: true, note: note}).then(function (x) { toast('Approved \u2013 Hanna gets a ping'); setCur(x); }); });
    }
    if (act === 'back') {
      return A.sheet('<h2>Send #' + esc(no) + ' back to Hanna</h2><label>What needs to change?</label><textarea id="fn-note" placeholder="e.g. take off the culvert, bill Bob at $70"></textarea>' +
        '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Send back</button></div>',
        function (a) { if (a !== 'go') return A.closeSheet(); var note = $('#fn-note').value.trim(); if (!note) return toast('Type what needs to change');
          A.closeSheet(); call('fin.decide', {no: no, approve: false, note: note}).then(function (x) { toast('Sent back to Hanna'); setCur(x); }); });
    }
    if (act === 'submit') {
      if (r.canApprove) return call('fin.submit', {no: no}).then(function (x) { toast('Approved'); setCur(x); });
      return A.sheet('<h2>Ask Spencer to approve #' + esc(no) + '</h2><div class="kv">' + esc(i.billTo) + ' \u00b7 <b>' + money(r.totals.total) + '</b></div>' +
        '<label>Note for Spencer (optional)</label><textarea id="fn-note"></textarea><div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Send to Spencer</button></div>',
        function (a) { if (a !== 'go') return A.closeSheet(); var note = $('#fn-note').value.trim(); A.closeSheet();
          call('fin.submit', {no: no, note: note}).then(function (x) { toast('Spencer gets a ping to approve it'); setCur(x); }); });
    }
    if (act === 'sent') {
      return A.sheet('<h2>Mark #' + esc(no) + ' sent</h2><label>Date sent</label><input type="date" id="fn-d" value="' + A.usToIso(A.todayStr()) + '">' +
        '<div class="sub">Everything on it is marked billed. It can\u2019t be changed after this.</div><div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Mark sent</button></div>',
        function (a) { if (a !== 'go') return A.closeSheet(); var d = A.isoToUs($('#fn-d').value) || A.todayStr(); A.closeSheet();
          call('fin.sent', {no: no, date: d}).then(function (x) { toast('Marked sent'); setCur(x); }); });
    }
    if (act === 'pay') {
      return A.sheet('<h2>Payment on #' + esc(no) + '</h2><label>Amount</label><input id="fn-amt" inputmode="decimal" value="' + n(i.due).toFixed(2) + '">' +
        '<label>Date received</label><input type="date" id="fn-d" value="' + A.usToIso(A.todayStr()) + '"><label>Check # or how they paid</label><input id="fn-how" placeholder="Check 1234">' +
        '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn ok" data-act="go">Save payment</button></div>',
        function (a) { if (a !== 'go') return A.closeSheet(); var f = {no: no, amount: $('#fn-amt').value, date: A.isoToUs($('#fn-d').value) || A.todayStr(), how: $('#fn-how').value.trim(), clientId: A.uid()};
          if (!n(f.amount)) return toast('Type the amount'); A.closeSheet();
          call('fin.pay', {fields: f}).then(function (x) { toast(x.invoice.status === 'Paid' ? 'Paid in full \u2713' : 'Payment saved'); setCur(x); }); });
    }
    if (act === 'add') {
      var items = (r.ready || []).filter(function (x) { var k = x.src + '|' + x.id; return x.needsRate ? F.pick[k] === true : F.pick[k] !== false; }).map(function (x) { return {src: x.src, id: x.id}; });
      if (!items.length) return toast('Nothing picked');
      return call('fin.add', {no: no, items: items}).then(function (x) { F.pick = {}; toast(items.length + ' added'); setCur(x); });
    }
    if (act === 'skip') {
      var sk = (r.ready || []).filter(function (x) { var k = x.src + '|' + x.id; return x.needsRate ? F.pick[k] === true : F.pick[k] !== false; }).map(function (x) { return {src: x.src, id: x.id}; });
      if (!sk.length) return toast('Nothing picked');
      return A.sheet('<h2>' + sk.length + ' picked item' + (sk.length === 1 ? '' : 's') + '</h2><div class="sub">They\u2019ll stop showing as ready to bill.</div>' +
        '<div class="btns" style="flex-direction:column"><button class="btn" data-act="billed">Already billed (outside the app)</button><button class="btn" data-act="nobill">Not billable \u2013 don\u2019t bill them</button><button class="btn" data-act="x">Cancel</button></div>',
        function (a) { if (a !== 'billed' && a !== 'nobill') return A.closeSheet(); A.closeSheet();
          call('fin.skip', {items: sk, how: a}).then(function () { F.pick = {}; return call('fin.get', {no: no}); }).then(function (x) { toast('Done'); setCur(x); }); });
    }
    if (act === 'line') return lineForm(null);
    if (act === 'notes') {
      return A.sheet('<h2>Notes on #' + esc(no) + '</h2><div class="sub">For you and Spencer \u2013 not printed on the invoice.</div><textarea id="fn-notes" style="min-height:110px">' +
        esc((i.notes || '').replace(/\[[^\]]+\]/g, '').trim()) + '</textarea><div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save</button></div>',
        function (a) { if (a !== 'go') return A.closeSheet(); var v = $('#fn-notes').value; A.closeSheet();
          call('fin.update', {no: no, fields: {notes: v}}).then(setCur); });
    }
    if (act === 'void') {
      if (!window.confirm('Void invoice #' + no + '? Its items go back to "ready to bill". The number stays used.')) return;
      return call('fin.void', {no: no}).then(function () { toast('Voided'); F.open = null; render(); });
    }
    if (act === 'pdf' || act === 'pdfr') return download(act === 'pdfr');
  }

  function lineForm(l) {
    var r = F.cur, i = r.invoice, isNew = !l;
    l = l || {desc: '', hours: '', rate: '', amount: '', noFee: false, onInvoice: true};
    A.sheet('<h2>' + (isNew ? 'Add a line' : 'Edit line') + '</h2>' + (l.kind && l.kind !== 'Manual' && l.kind !== 'Imported' ? '<div class="sub">From: ' + esc(l.kind) + ' ' + esc(l.src || '') + '</div>' : '') +
      '<label>Description (prints on the invoice)</label><textarea id="fl-d">' + esc(l.desc) + '</textarea>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Hours / qty</label><input id="fl-h" inputmode="decimal" value="' + esc(l.hours) + '"></div>' +
      '<div style="flex:1"><label>Rate</label><input id="fl-r" inputmode="decimal" value="' + esc(l.rate) + '"></div></div>' +
      '<label>Amount</label><input id="fl-a" inputmode="decimal" value="' + (isNew ? '' : n(l.amount).toFixed(2)) + '" placeholder="leave blank = hours \u00d7 rate">' +
      '<div class="sub">Use a minus sign for a credit, e.g. -500.</div>' +
      (r.totals.feePct ? '<label class="fn-chk"><input type="checkbox" id="fl-nf"' + (l.noFee ? ' checked' : '') + '> No ' + esc(i.feeLabel || 'fee') + ' on this line</label>' : '') +
      '<label class="fn-chk"><input type="checkbox" id="fl-on"' + (l.onInvoice ? ' checked' : '') + '> Show on the invoice (off = tracking only)</label>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (isNew ? '' : '<button class="btn" data-act="rm" style="color:var(--red)">Remove</button>') +
      '<button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') {
        A.closeSheet();
        return call('fin.line', {fields: {no: i.no, id: l.id, remove: true}}).then(function (x) { toast(l.kind && l.kind !== 'Manual' ? 'Removed \u2013 it\u2019s back in \u201cready to add\u201d' : 'Removed'); setCur(x); });
      }
      if (a !== 'go') return A.closeSheet();
      var f = {no: i.no, desc: $('#fl-d').value.trim(), hours: $('#fl-h').value.trim(), rate: $('#fl-r').value.trim(), onInvoice: $('#fl-on').checked};
      var amt = $('#fl-a').value.trim(), was = isNew ? '' : n(l.amount).toFixed(2);
      var hrChanged = !isNew && (String(f.hours) !== String(l.hours) || String(f.rate) !== String(l.rate));
      if (f.hours && f.rate && (!amt || (hrChanged && amt === was))) f.amount = (n(f.hours) * n(f.rate)).toFixed(2);
      else if (amt) f.amount = amt;
      if ($('#fl-nf')) f.noFee = $('#fl-nf').checked;
      if (!f.desc) return toast('Type a description');
      if (isNew && f.amount === undefined) return toast('Type an amount (or hours and rate)');
      if (!isNew) f.id = l.id;
      A.closeSheet();
      call('fin.line', {fields: f}).then(setCur);
    });
  }

  function detailsForm() {
    var i = F.cur.invoice;
    A.sheet('<h2>Invoice #' + esc(i.no) + '</h2><label>Bill to</label><input id="fd-b" value="' + esc(i.billTo) + '">' +
      '<label>Address (prints under the name)</label><textarea id="fd-a" style="min-height:50px">' + esc(i.address) + '</textarea>' +
      '<label>Invoice date</label><input type="date" id="fd-d" value="' + A.usToIso(i.date) + '">' +
      '<label>Kind</label><select id="fd-k"><option value="Itemized"' + (i.kind !== 'Bid' ? ' selected' : '') + '>Itemized \u2013 client sees each line</option>' +
      '<option value="Bid"' + (i.kind === 'Bid' ? ' selected' : '') + '>Bid \u2013 client sees only typed lines</option></select>' +
      '<div style="display:flex;gap:8px"><div style="flex:2"><label>Fee name</label><input id="fd-fl" value="' + esc(i.feeLabel || '') + '" placeholder="Builder Fee"></div>' +
      '<div style="flex:1"><label>Fee %</label><input id="fd-fp" inputmode="decimal" value="' + esc(i.feePct) + '"></div></div>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Sales tax %</label><input id="fd-t" inputmode="decimal" value="' + esc(i.taxRate) + '"></div>' +
      '<div style="flex:1"><label>Other $</label><input id="fd-o" inputmode="decimal" value="' + esc(i.other) + '"></div></div>' +
      (i.status === 'Approved' ? '<div class="sub" style="color:var(--orange)">It\u2019s approved \u2013 saving a change sends it back to Spencer for a new OK.</div>' : '') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {billTo: $('#fd-b').value.trim(), address: $('#fd-a').value.trim(), date: A.isoToUs($('#fd-d').value) || i.date, kind: $('#fd-k').value,
        feeLabel: $('#fd-fl').value.trim(), feePct: $('#fd-fp').value.trim(), taxRate: $('#fd-t').value.trim(), other: $('#fd-o').value.trim()};
      if (f.feePct && !f.feeLabel) f.feeLabel = 'Builder Fee';
      A.closeSheet();
      call('fin.update', {no: i.no, fields: f}).then(setCur);
    });
  }

  function newInvoice(job) {
    var jobs = (F.d && F.d.jobs) || [];
    A.sheet('<h2>New invoice</h2><label>Job</label><select id="fn-j"><option value="">\u2014 one-off customer (no job) \u2014</option>' + jobs.map(function (j) {
      return '<option value="' + esc(j.job) + '"' + (j.job === job ? ' selected' : '') + '>' + esc(j.job) + (j.draft ? ' (has draft #' + esc(j.draft) + ')' : (j.ready ? ' \u2013 ' + j.ready + ' ready' : '')) + '</option>'; }).join('') + '</select>' +
      '<div id="fn-oneoff"><label>Bill to</label><input id="fn-b" placeholder="Customer name"><label>Address</label><textarea id="fn-a" style="min-height:50px"></textarea></div>' +
      '<div class="sub" id="fn-jsub"></div><div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Start invoice</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var j = $('#fn-j').value, jr = jobs.filter(function (x) { return x.job === j; })[0];
      if (jr && jr.draft) { A.closeSheet(); return openInv(jr.draft); }
      var f = {job: j, clientId: A.uid()};
      if (!j) { f.billTo = $('#fn-b').value.trim(); f.address = $('#fn-a').value.trim(); if (!f.billTo) return toast('Type who it\u2019s for'); }
      A.closeSheet();
      call('fin.create', {fields: f}).then(function (x) {
        F.open = x.created || x.no; F.cur = x.invoice ? x : null; A.navPush(); window.scrollTo(0, 0);
        if (F.cur) renderInv(true); else openInv(F.open);
        toast('Invoice #' + F.open + ' started' + (x.lines && x.lines.length ? ' with ' + x.lines.length + ' line' + (x.lines.length === 1 ? '' : 's') : ''));
        load();
      }, function (e) { if (e && e.error === 'draft_exists' && e.no) openInv(e.no); });
    });
    var sync = function () {
      var j = $('#fn-j').value, jr = jobs.filter(function (x) { return x.job === j; })[0];
      $('#fn-oneoff').style.display = j ? 'none' : 'block';
      $('#fn-jsub').textContent = jr ? (jr.draft ? 'This job already has a draft \u2013 it will open.' : 'Bill to ' + (jr.client || '?') + '. Everything ready to bill (' + money(jr.readyAmt) + ') goes on; you can take lines off.') : '';
    };
    $('#fn-j').onchange = sync; sync();
  }

  // ---------- PDF ----------
  var libP = null;
  function loadLib() {
    if (window.PDFLib && window.E10KInvoice) return Promise.resolve();
    if (libP) return libP;
    // pdf-lib 1.17.1 (MIT) from a CDN, pinned with a hash so a changed file is refused; second CDN as a backup
    var SRI = 'sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI';
    var urls = ['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'];
    function tryLoad(i, res, rej) {
      if (i >= urls.length) { libP = null; return rej('pdf-lib'); }
      var s = document.createElement('script'); s.src = urls[i]; s.integrity = SRI; s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = function () { s.remove(); tryLoad(i + 1, res, rej); };
      document.head.appendChild(s);
    }
    libP = new Promise(function (res, rej) { tryLoad(0, res, rej); });
    return libP;
  }
  function b64Bytes(b64) { var s = atob(b64), a = new Uint8Array(s.length); for (var k = 0; k < s.length; k++) a[k] = s.charCodeAt(k); return a; }
  function download(withReceipts) {
    var r = F.cur, i = r.invoice;
    if (!navigator.onLine && withReceipts) return toast('Receipts need a connection');
    toast(withReceipts ? 'Building the invoice + receipts\u2026' : 'Building the invoice\u2026');
    var inv = {number: i.no, date: i.date, billTo: [i.billTo].concat(String(i.address || '').split(/\n|,\s*(?=[A-Za-z])/).map(function (s) { return s.trim(); }).filter(Boolean)).slice(0, 5),
      lines: r.lines.map(function (l) { return {desc: l.desc, hours: l.hours, rate: l.rate, amount: l.amount, noFee: l.noFee, onInvoice: l.onInvoice}; }),
      builderFeePct: n(i.feePct) || 0, feeLabel: i.feeLabel || 'Builder Fee', taxRate: n(i.taxRate) || 0, other: n(i.other) || 0,
      draft: ['Approved', 'Sent', 'Part paid', 'Paid'].indexOf(i.status) >= 0 ? '' : 'DRAFT - NOT APPROVED'};
    var logo = fetch('logo-invoice.png').then(function (x) { return x.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }).catch(function () { return null; });
    var recs = Promise.resolve([]);
    if (withReceipts) {
      var seen = {}, list = [];
      r.lines.forEach(function (l) { if (l.receipt && !seen[l.receipt]) { seen[l.receipt] = 1; list.push(l); } });
      recs = list.reduce(function (p, l) {
        return p.then(function (acc) {
          return A.api('fin.file', {no: i.no, link: l.receipt}).then(function (x) {
            acc.push(x.ok ? {caption: l.desc + ' - ' + money(l.amount), bytes: b64Bytes(x.data), type: /pdf/.test(x.mime) ? 'application/pdf' : (/png/.test(x.mime) ? 'image/png' : 'image/jpeg')}
              : {caption: l.desc + ' - ' + money(l.amount), bytes: new Uint8Array(0), type: 'image/jpeg'});
            return acc;
          }, function () { acc.push({caption: l.desc + ' - ' + money(l.amount), bytes: new Uint8Array(0), type: 'image/jpeg'}); return acc; });
        });
      }, Promise.resolve([]));
    }
    return Promise.all([loadLib(), logo, recs]).then(function (v) {
      return window.E10KInvoice.build(window.PDFLib, inv, {logo: v[1], receipts: v[2]});
    }).then(function (bytes) {
      var name = 'Invoice ' + i.no + ' - ' + (i.billTo || i.job || '').replace(/[\\/:*?"<>|]/g, '') + (withReceipts ? ' + receipts' : '') + (inv.draft ? ' (DRAFT)' : '') + '.pdf';
      var blob = new Blob([bytes], {type: 'application/pdf'}), url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      toast('Downloaded \u2013 check your Downloads');
    }).catch(function (e) { toast('Could not build the PDF (' + String(e).slice(0, 60) + ')'); });
  }

  // ---------- bills & pay-backs ----------
  function billRow(b, pickable) {
    var key = b.id, on = !!F.bpick[key];
    return '<div class="fn-r">' + (pickable ? '<input type="checkbox" data-finbpick="' + esc(key) + '"' + (on ? ' checked' : '') + ' style="margin-top:3px">' : '') +
      '<div class="tl-x" data-finbill="' + esc(b.id) + '"><div class="fn-t">' + esc(b.vendor || b.desc || 'Bill') + '</div><div class="tl-s">' +
      esc([b.job, b.date, b.invNo ? 'inv ' + b.invNo : '', b.paidDate ? 'paid ' + b.paidDate + (b.how ? ' (' + b.how + ')' : '') : ''].filter(Boolean).join(' \u00b7 ')) +
      (b.receipt ? ' \u00b7 \ud83e\uddfe' : '') + '</div></div><div class="fn-amt">' + money(b.amount) + '</div></div>';
  }
  function billsHtml() {
    var b = F.d.bills || {}, html = '';
    var pbTot = (b.paybacks || []).reduce(function (a, p) { return a + p.total; }, 0);
    html += tiles([{l: 'Bills to pay', v: money(b.toPayTotal, false), c: b.toPayTotal ? 'var(--orange)' : ''}, {l: 'Pay-backs owed', v: money(pbTot, false)}]);
    var picked = Object.keys(F.bpick).filter(function (k) { return F.bpick[k]; }).length;
    if (picked) html += '<div class="fn-bar" style="position:sticky;top:0;z-index:5;background:#000;padding:6px 0"><button class="btn ok" data-finbact="paid">Mark ' + picked + ' paid</button>' +
      '<button class="btn" data-finbact="clear">Clear</button></div>';
    html += box('tp', 'Bills to pay', (b.toPay || []).length, (b.toPay || []).map(function (x) { return billRow(x, true); }), {limit: 12});
    if ((b.paybacks || []).length) html += box('pb', 'Pay back the crew', b.paybacks.length, b.paybacks.map(function (p) {
      return row('data-finpb="' + esc(p.person) + '"', esc(p.person), p.items.length + ' receipt' + (p.items.length === 1 ? '' : 's') + ' they paid for \u00b7 <span style="color:var(--blue)">Pay back \u203a</span>', money(p.total)); }));
    if (b.unknownCount) html += box('uk', 'Not marked paid or unpaid', b.unknownCount, (b.unknown || []).slice().reverse().map(function (x) { return billRow(x, true); }),
      {collapsed: true, limit: 30, sub: 'Older costs from before the app. Pick any and mark them paid, or tap one to set it \u201cstill owe\u201d.'});
    if ((b.recent || []).length) html += box('rp', 'Paid lately', b.recent.length, b.recent.map(function (x) { return billRow(x, false); }), {collapsed: true, limit: 40});
    html += '<div class="tl-hint">Tap + to add a bill. Receipts the crew upload show up here on their own.</div>';
    return html;
  }
  function allBills() { var b = F.d.bills || {}, out = [].concat(b.toPay || [], b.unknown || [], b.recent || []); (b.paybacks || []).forEach(function (p) { out = out.concat(p.items); }); return out; }
  function paidForm(ids, title, onDone) {
    A.sheet('<h2>' + esc(title) + '</h2><label>Date paid</label><input type="date" id="fp-d" value="' + A.usToIso(A.todayStr()) + '">' +
      '<label>Check # or how it was paid</label><input id="fp-h" placeholder="Check 1234, card, Venmo\u2026">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn ok" data-act="go">Mark paid</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {ids: ids, date: A.isoToUs($('#fp-d').value) || A.todayStr(), how: $('#fp-h').value.trim()}; A.closeSheet();
      call('fin.billPaid', f).then(function () { toast('Marked paid \u2713'); F.bpick = {}; if (onDone) onDone(); load(); });
    });
  }
  function billSheet(id) {
    var b = allBills().filter(function (x) { return x.id === id; })[0]; if (!b) return;
    A.sheet('<h2>' + esc(b.vendor || 'Bill') + ' \u00b7 ' + money(b.amount) + '</h2><div class="kv">' + esc([b.job, b.date, b.invNo ? 'Vendor inv ' + b.invNo : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      '<div class="kv">' + esc(b.desc) + '</div>' + (b.notes ? '<div class="sub">' + esc(b.notes) + '</div>' : '') +
      (b.paidDate ? '<div class="kv">Paid ' + esc(b.paidDate) + (b.how ? ' \u00b7 ' + esc(b.how) : '') + '</div>' : '') +
      (b.receipt ? '<div class="kv"><a href="' + esc(b.receipt) + '" target="_blank" rel="noopener">\ud83e\uddfe Open the bill / receipt</a></div>' : '') +
      '<div class="btns"><button class="btn" data-act="x">Close</button>' + (b.paidDate ? '' : '<button class="btn" data-act="owe">Still owe it</button><button class="btn ok" data-act="paid">Mark paid</button>') + '</div>',
      function (a) {
        if (a === 'paid') return paidForm([b.id], 'Mark paid: ' + (b.vendor || 'bill'));
        if (a === 'owe') { A.closeSheet(); return call('fin.billPaid', {ids: [b.id], unpaid: true}).then(function () { toast('Moved to bills to pay'); load(); }); }
        A.closeSheet();
      });
  }
  function paybackSheet(person) {
    var p = ((F.d.bills || {}).paybacks || []).filter(function (x) { return x.person === person; })[0]; if (!p) return;
    A.sheet('<h2>Pay back ' + esc(person) + ' \u00b7 ' + money(p.total) + '</h2>' + p.items.map(function (b) {
      return '<div class="kv">' + esc(b.date) + ' \u00b7 ' + esc(b.vendor || b.desc) + ' \u00b7 <b>' + money(b.amount) + '</b>' + (b.receipt ? ' \u00b7 <a href="' + esc(b.receipt) + '" target="_blank" rel="noopener">receipt</a>' : '') + '</div>'; }).join('') +
      '<div class="btns"><button class="btn" data-act="x">Close</button><button class="btn ok" data-act="go">Paid ' + esc(person) + ' back</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      paidForm(p.items.map(function (x) { return x.id; }), 'Paid ' + person + ' back ' + money(p.total));
    });
  }
  function billForm(preJob) {
    var L = F.d.lists || {}, jobs = [];
    // open jobs + Shop / Office from the app, plus every billing job (finished ones too: bills often come in late)
    (A.S.data && A.S.data.jobs || []).map(function (j) { return j.name; }).concat((F.d.jobs || []).map(function (j) { return j.job; }))
      .forEach(function (n) { if (n && jobs.indexOf(n) < 0) jobs.push(n); });
    var file = null;
    A.sheet('<h2>Add a bill</h2><label>Job</label><select id="fb-j">' + A.options(jobs, preJob || '', true) + '</select>' +
      '<label>Vendor</label><input id="fb-v" placeholder="Ann\u2019s Trucking"><label>What it\u2019s for</label><input id="fb-d" placeholder="Fines haul for driveway">' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Amount</label><input id="fb-a" inputmode="decimal"></div><div style="flex:1"><label>Bill date</label><input type="date" id="fb-dt" value="' + A.usToIso(A.todayStr()) + '"></div></div>' +
      '<label>Vendor invoice #</label><input id="fb-n">' +
      '<label>Category</label><select id="fb-c">' + A.options(L.category, 'MISC LABOR AND MATERIALS') + '</select>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Type</label><select id="fb-t">' + A.options(L.costType, 'Material') + '</select></div>' +
      '<div style="flex:1"><label>Billing</label><select id="fb-bl">' + A.options(L.billing, 'Contract') + '</select></div></div>' +
      '<label>Paid yet?</label><div class="chips"><button class="chip on" data-fbp="No">Still to pay</button><button class="chip" data-fbp="Yes">Already paid</button></div>' +
      '<div id="fb-paid" style="display:none"><label>Check # or how</label><input id="fb-h"></div>' +
      '<label>Photo or PDF of the bill</label><input type="file" id="fb-f" accept="image/*,application/pdf"><div class="sub" id="fb-fs"></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save bill</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var paid = document.querySelector('[data-fbp].on').getAttribute('data-fbp');
      var f = {job: $('#fb-j').value, vendor: $('#fb-v').value.trim(), desc: $('#fb-d').value.trim(), amount: $('#fb-a').value.trim(), date: A.isoToUs($('#fb-dt').value) || A.todayStr(),
        invNo: $('#fb-n').value.trim(), category: $('#fb-c').value, type: $('#fb-t').value, billing: $('#fb-bl').value, paid: paid, how: $('#fb-h').value.trim(), clientId: A.uid()};
      if (paid === 'Yes') f.paidDate = f.date;
      if (!f.job) return toast('Pick the job'); if (!f.vendor) return toast('Type the vendor'); if (!f.amount) return toast('Type the amount');
      if (file) f.file = file;
      A.closeSheet(); toast('Saving\u2026');
      call('fin.billAdd', {fields: f}).then(function () { toast('Bill saved \u2713'); load(); if (A.reloadJob && F.open && /^JOB:/.test(F.open)) A.reloadJob(); });
    });
    document.querySelector('#sheet .chips').onclick = function (e) {
      var b = e.target.closest('[data-fbp]'); if (!b) return; e.stopPropagation();
      Array.prototype.forEach.call(document.querySelectorAll('[data-fbp]'), function (x) { x.classList.toggle('on', x === b); });
      $('#fb-paid').style.display = b.getAttribute('data-fbp') === 'Yes' ? 'block' : 'none';
    };
    $('#fb-f').onchange = function (e) {
      var f0 = e.target.files[0]; if (!f0) return;
      if (/pdf/.test(f0.type)) {
        if (f0.size > 9e6) { toast('That PDF is too big (9 MB max)'); return; }
        var rd = new FileReader(); rd.onload = function () { file = {data: rd.result, mime: 'application/pdf', name: f0.name}; $('#fb-fs').textContent = 'PDF ready: ' + f0.name; }; rd.readAsDataURL(f0);
      } else A.shrink(f0).then(function (d) { file = {data: d, mime: 'image/jpeg'}; $('#fb-fs').textContent = 'Photo ready'; });
    };
  }

  // ---------- money ----------
  function moneyHtml() {
    var m = F.d.money || {}, html = '', b = F.d.bills || {};
    html += tiles([{l: 'Owed to us', v: money(m.owed, false)}, {l: 'Overdue', v: money(m.overdue, false), c: m.overdue ? 'var(--red)' : ''},
      {l: 'Ready to bill', v: money(m.ready, false), go: 'inv'}, {l: 'Bills to pay', v: money(b.toPayTotal, false), go: 'bills'}]);
    var months = (m.months || []).slice().reverse();
    var max = months.reduce(function (a, x) { return Math.max(a, x.spent, x.billed, x.collected); }, 1);
    var bar = function (v, c) { return '<div class="fn-bar1"><div style="width:' + Math.max(1, Math.round(100 * Math.abs(v) / max)) + '%;background:' + c + '"></div></div>'; };
    html += box('mo', 'By month', months.length, months.map(function (x) {
      var p = x.month.split('-'), name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1] + ' ' + p[0];
      return '<div class="fn-mo"><div class="fn-t">' + name + '</div>' +
        '<div class="fn-mr"><span>Spent</span>' + bar(x.spent, 'var(--orange)') + '<b>' + money(x.spent, false) + '</b></div>' +
        '<div class="fn-mr"><span>Billed</span>' + bar(x.billed, 'var(--blue)') + '<b>' + money(x.billed, false) + '</b></div>' +
        '<div class="fn-mr"><span>Collected</span>' + bar(x.collected, 'var(--green)') + '<b>' + money(x.collected, false) + '</b></div></div>'; }),
      {limit: 3, sub: 'Spent = bills, receipts and crew payroll. Billed = invoices sent from the app.'});
    html += box('jb', 'By job', (m.jobs || []).length, (m.jobs || []).map(function (j) {
      var spent = j.spent + j.payroll;
      var sub = 'Spent ' + money(spent, false) + (j.payroll ? ' (crew ' + money(j.payroll, false) + ')' : '') + ' \u00b7 billed ' + money(j.billed, false) +
        ' \u00b7 collected ' + money(j.collected, false);
      var sub2 = [j.owed ? '<span style="color:var(--blue)">owed ' + money(j.owed, false) + '</span>' : '', j.ready ? 'ready to bill ' + money(j.ready, false) : '',
        j.drafts ? 'in drafts ' + money(j.drafts, false) : '', j.billedBefore ? 'billed before the app ' + money(j.billedBefore, false) : ''].filter(Boolean).join(' \u00b7 ');
      return '<div class="fn-r" data-finjob="' + esc(j.job) + '"><div class="tl-x"><div class="fn-t">' + esc(j.job) + '</div><div class="tl-s">' + sub + '</div>' +
        (sub2 ? '<div class="tl-s">' + sub2 + '</div>' : '') + '</div></div>'; }), {limit: 8, sub: 'Tap a job to set how it\u2019s billed.'});
    return html;
  }
  function jobSheet(name) {
    var j = (F.d.jobs || []).filter(function (x) { return x.job === name; })[0];
    if (!j) return toast('That job isn\u2019t billed (shop / office)');
    var L = F.d.lists || {}, modes = [['', 'Machine hrs \u00d7 rate + off-machine labor (normal)'], ['Machine hrs incl. operator', 'Machine hrs only (operator included)'], ['Machine + labor', 'Machine hrs + all labor hours']];
    A.sheet('<h2>' + esc(j.job) + '</h2><div class="kv">Client: ' + esc(j.client || '?') + '</div>' +
      '<label>Contract type</label><select id="fj-c">' + A.options(L.contract, j.contract, true) + '</select>' +
      '<div style="display:flex;gap:8px"><div style="flex:2"><label>Fee name</label><input id="fj-fl" value="' + esc(j.feeLabel) + '" placeholder="Builder Fee"></div>' +
      '<div style="flex:1"><label>Fee %</label><input id="fj-m" inputmode="decimal" value="' + esc(String(j.markup || '').replace('%', '')) + '"></div></div>' +
      '<label>How often it\u2019s billed</label><select id="fj-s">' + A.options(['When the job is done', 'Monthly', 'At milestones'], j.schedule, true) + '</select>' +
      '<label>Machine & labor billing</label><select id="fj-md">' + modes.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === j.mode ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>' +
      '<div class="sub">Changing the machine & labor billing re-figures the crew\u2019s billable hours on this job.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (j.draft ? '<button class="btn" data-act="open">Open draft #' + esc(j.draft) + '</button>' : '') +
      '<button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'open') { A.closeSheet(); return openInv(j.draft); }
      if (a !== 'go') return A.closeSheet();
      var f = {job: j.job, contract: $('#fj-c').value, feeLabel: $('#fj-fl').value.trim(), markup: $('#fj-m').value.trim(), schedule: $('#fj-s').value, mode: $('#fj-md').value};
      if (f.markup && !f.feeLabel) f.feeLabel = 'Builder Fee';
      A.closeSheet();
      call('fin.jobSet', {fields: f}).then(function () { toast('Saved'); load(); });
    });
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'fin' || e.target.closest('#sheet')) return;
    var t;
    if ((t = e.target.closest('[data-finjob]'))) return openJob(t.getAttribute('data-finjob'));
    if ((t = e.target.closest('[data-finview]'))) { ls.set('finView', t.getAttribute('data-finview')); F.open = null; window.scrollTo(0, 0); return render(true); }
    if ((t = e.target.closest('[data-finbox]'))) { var k = t.getAttribute('data-finbox'); F.box[k] = !F.box[k]; return F.open ? renderInv() : render(true); }
    if ((t = e.target.closest('[data-finv]'))) return openInv(t.getAttribute('data-finv'));
    if ((t = e.target.closest('[data-finstart]'))) return newInvoice(t.getAttribute('data-finstart'));
    if ((t = e.target.closest('[data-finback]'))) { history.back(); return; }
    if ((t = e.target.closest('[data-finedit]'))) { e.preventDefault(); return detailsForm(); }
    if ((t = e.target.closest('[data-finact]'))) { e.preventDefault(); if (F.busy) return toast('One moment\u2026'); return invAction(t.getAttribute('data-finact')); }
    if ((t = e.target.closest('[data-finline]'))) { var l = F.cur.lines.filter(function (x) { return x.id === t.getAttribute('data-finline'); })[0]; return lineForm(l); }
    if ((t = e.target.closest('[data-finpayx]'))) {
      var pid = t.getAttribute('data-finpayx');
      if (window.confirm('Remove this payment? (Only if it was entered by mistake.)')) call('fin.payRemove', {no: F.cur.invoice.no, id: pid}).then(setCur);
      return;
    }
    if ((t = e.target.closest('[data-finbill]'))) return billSheet(t.getAttribute('data-finbill'));
    if ((t = e.target.closest('[data-finpb]'))) return paybackSheet(t.getAttribute('data-finpb'));
    if ((t = e.target.closest('[data-finjob]'))) return jobSheet(t.getAttribute('data-finjob'));
    if ((t = e.target.closest('[data-finbact]'))) {
      if (t.getAttribute('data-finbact') === 'clear') { F.bpick = {}; return render(true); }
      var ids = Object.keys(F.bpick).filter(function (k) { return F.bpick[k]; });
      return paidForm(ids, 'Mark ' + ids.length + ' bill' + (ids.length === 1 ? '' : 's') + ' paid');
    }
  });
  document.addEventListener('change', function (e) {
    if (A.S.tab !== 'fin') return;
    var p = e.target.closest('[data-finpick]');
    if (p) { F.pick[p.getAttribute('data-finpick')] = p.checked; return; }
    var b = e.target.closest('[data-finbpick]');
    if (b) { F.bpick[b.getAttribute('data-finbpick')] = b.checked; render(true); }
  });

  A.addTab({k: 'fin', n: 'Finance', show: owner, badge: badgeCount,
    ic: A.svg('<path d="M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 9.6 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/>'),
    render: function () { render(); },
    fab: function () { if (F.open && /^JOB:/.test(F.open)) return billForm(F.open.slice(4)); if (F.open) return F.cur && ['Draft', 'Waiting on Spencer', 'Approved'].indexOf(F.cur.invoice.status) >= 0 ? lineForm(null) : null; if (view() === 'bills') return billForm(); return newInvoice(''); }});
  A.openInvoice = function (no) { if (!owner()) return; openInv(no); };
  A.openJob = function (job) { if (owner()) openJob(job); };
  A.finReload = function () { return load(); };
  A.curInv = function () { return A.S.tab === 'fin' ? F.open : null; };
  A.setInv = function (no) { if (F.open !== (no || null)) { F.open = no || null; if (no && /^JOB:/.test(no)) return; if (no && (!F.cur || F.cur.invoice.no !== no)) call('fin.get', {no: no}).then(function (r) { F.cur = r; if (F.open === no) renderInv(); }); } };
  setTimeout(function () { if (owner()) load(); }, 3000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && owner() && A.S.tab === 'fin' && !F.open) load(); });
})();
