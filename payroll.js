/* E10K app: Finance > Payroll (owners). What each guy is owed (hours x pay rate), by job and by day; check the odd
 * entries; Mark paid resets him to $0 (hours stay for billing); pay history with undo; this year's total (1099s).
 * Backend: Payroll.js (pay.list / pay.mark / pay.undo). */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast;
  var P = {d: A.ls.get('pay', null), open: {}, hist: false, busy: false};
  function money(v) { var x = +v || 0; return (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function hrs(v) { return (Math.round((+v || 0) * 100) / 100) + ' hrs'; }
  function onPay() { return A.S.tab === 'fin' && !(A.curInv && A.curInv()) && A.ls.get('finView', 'inv') === 'pay'; }
  function load() {
    return A.api('pay.list').then(function (r) { if (r.ok) { P.d = r; A.ls.set('pay', r); if (onPay()) A.render(); } }).catch(function () {});
  }
  function call(action, fields) {
    if (!navigator.onLine) { toast('No signal \u2013 this needs a connection'); return Promise.reject('offline'); }
    P.busy = true;
    return A.api(action, {fields: fields}).then(function (r) {
      P.busy = false;
      if (!r.ok) { toast({nothing_owed: 'Nothing owed through that date', bad_date: 'Check the date', already_billed: 'That entry is on a sent invoice \u2013 its times are locked',
        already_paid: 'Already paid \u2013 change the times instead of deleting', unknown_job: 'Pick a job from the list', bad_time: 'Check the start and end time',
        imported_entry: 'That entry came from the old hours sheet \u2013 ask Sam to fix it in the Hub', sheet_history: 'That\u2019s pay history from the old hours sheets \u2013 ask Sam to change it'}[r.error] || r.error); throw r; }
      P.d = r; A.ls.set('pay', r); A.render(); return r;
    }, function (e) { P.busy = false; toast('Could not reach the server \u2013 try again'); throw e; });
  }
  A.payHtml = function () {
    if (!P.at || Date.now() - P.at > 20000) { P.at = Date.now(); load(); }
    if (!P.d) return '<div class="empty">Loading\u2026</div>';
    var html = '';
    var tot = P.d.people.reduce(function (a, p) { return a + p.amount; }, 0);
    html += '<div class="fn-tiles"><div class="fn-tile"><div class="tl-s">Owed to the crew</div><div class="fn-big">' + money(tot) + '</div></div>' +
      P.d.people.map(function (p) { return '<div class="fn-tile"><div class="tl-s">' + esc(p.person) + '</div><div class="fn-big">' + money(p.amount) + '</div><div class="tl-s">' + hrs(p.hours) + '</div></div>'; }).join('') + '</div>';
    P.d.people.forEach(function (p) {
      var open = !!P.open[p.person];
      html += '<div class="tl-box"><div class="tl-h"><div class="tl-ht">' + esc(p.person) + ' \u00b7 ' + money(p.amount) + '</div><div class="tl-hc">' + hrs(p.hours) + '</div></div>' +
        '<div class="tl-hs">' + (p.rate !== null ? '$' + p.rate + '/hr' : 'no pay rate in People') + (p.lastPaid ? ' \u00b7 last paid ' + esc(p.lastPaid) : '') +
        ' \u00b7 paid this year ' + money(p.paidYear) + (p.open ? ' \u00b7 clocked in now (not counted yet)' : '') + '</div>' +
        (p.adjust ? '<div class="tl-hs" style="color:' + (p.adjust < 0 ? '#ff8a80' : '#ffc069') + '">' + (p.adjust < 0 ? 'Overpaid ' + money(-p.adjust) + ' (comes off his next pay)' : money(p.adjust) + ' more owed') +
          ' from changes to already-paid days: ' + p.adjusts.map(function (e) { return esc(e.date) + ' ' + money(e.was) + ' \u2192 ' + money(e.amount); }).join(', ') + '</div>' : '');
      if (p.flags.length) html += '<div class="sam-box" style="margin:4px 12px 8px"><div class="tl-s" style="margin-bottom:4px">\u26a0\ufe0f Check before you pay</div>' +
        p.flags.map(function (f) { return '<div style="margin:3px 0;color:#ffc069"' + (f.id ? ' data-payedit="' + esc(f.id) + '"' : '') + '>\u2022 ' + esc(f.text) + (f.id ? ' <u>Fix</u>' : '') + '</div>'; }).join('') + '</div>';
      html += p.jobs.map(function (j) {
        return '<div class="fn-r"><div class="tl-x"><div class="fn-t" style="font-size:15px">' + esc(j.job) + '</div><div class="tl-s">' + j.days + ' entr' + (j.days === 1 ? 'y' : 'ies') + '</div></div>' +
          '<div class="fn-amt">' + money(j.amount) + '<div class="tl-s" style="text-align:right">' + hrs(j.hours) + '</div></div></div>'; }).join('');
      if (p.entries.length) html += '<div class="tl-more" data-payday="' + esc(p.person) + '">' + (open ? 'Hide days \u25b4' : 'Show each day (' + p.entries.length + ') \u203a') + '</div>';
      if (open) html += p.entries.map(function (e) {
        return '<div class="fn-r" data-payedit="' + esc(e.id) + '" style="padding-top:4px;padding-bottom:4px"><div class="tl-x"><div class="tl-s" style="color:var(--text)">' + esc(e.date) + ' \u00b7 ' + esc(e.job) + ' \u00b7 ' + esc(e.start) + '\u2013' + esc(e.end) + '</div>' +
          (e.work ? '<div class="tl-s">' + esc(e.work) + '</div>' : '') + '</div><div class="fn-amt" style="font-size:14px">' + hrs(e.hours) + ' \u270e</div></div>'; }).join('');
      if (p.amount || p.adjust) html += '<div class="fn-bar"><button class="btn primary" data-paymark="' + esc(p.person) + '">Mark ' + esc(p.person) + ' paid</button></div>';
      else html += '<div class="tl-hs">All paid up.</div>';
      html += '</div>';
    });
    var runs = P.d.runs || [];
    if (runs.length) html += '<div class="tl-box"><div class="tl-h" data-payhist="1"><div class="tl-ht">Pay history</div><div class="tl-hc">' + runs.length + (P.hist ? ' \u25b4' : ' \u203a') + '</div></div>' +
      (P.hist ? runs.map(function (x) {
        return '<div class="fn-r" data-payrun="' + esc(x.id) + '"><div class="tl-x"><div class="fn-t" style="font-size:15px">' + esc(x.person) + ' \u00b7 ' + esc(x.date) + '</div><div class="tl-s">' +
          esc(['through ' + x.through, hrs(x.hours), x.how, 'by ' + x.by, x.notes].filter(Boolean).join(' \u00b7 ')) + '</div></div><div class="fn-amt">' + money(x.amount) + '</div></div>'; }).join('') : '') + '</div>';
    html += '<div class="tl-hint">Tap a day to fix it. Marking paid resets that person to $0; hours stay on the jobs for billing.</div>';
    return html;
  };
  function findEntry(id) {
    var hit = null;
    P.d.people.forEach(function (p) { p.entries.concat(p.adjusts || []).forEach(function (e) { if (e.id === id) hit = {e: e, person: p.person}; }); });
    (P.d.runs || []).forEach(function (x) { (x.entries || []).forEach(function (e) { if (!hit && e.id === id) hit = {e: e, person: x.person}; }); });
    return hit;
  }
  function t24(s) { var m = String(s || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i); if (!m) return ''; var h = +m[1] % 12; if (/p/i.test(m[3] || '')) h += 12; if (!m[3] && +m[1] === 12) h = 12; return ('0' + h).slice(-2) + ':' + m[2]; }
  function t12(v) { if (!v) return ''; var p = v.split(':'), h = +p[0]; return ((h % 12) || 12) + ':' + p[1] + (h < 12 ? ' AM' : ' PM'); }
  function editSheet(id) {
    var hit = findEntry(id); if (!hit) return toast('Can\u2019t find that entry \u2013 pull down to refresh');
    var e = hit.e, billed = !!e.billed, jobs = (P.d.jobs || []).slice(); if (jobs.indexOf(e.job) < 0) jobs.unshift(e.job);
    var dis = billed ? ' disabled' : '';
    A.sheet('<h2>' + esc(hit.person) + '\u2019s hours</h2>' +
      (billed ? '<div class="sub" style="color:#ffc069">On sent invoice #' + esc(e.billed) + ' \u2013 date, job and times are locked.</div>' : '') +
      (e.paid ? '<div class="sub">Already paid ' + esc(e.paid) + '. A change shows in Payroll as owed or overpaid.</div>' : '') +
      '<label>Date</label><input type="date" id="pe-d" value="' + A.usToIso(e.date) + '"' + dis + '>' +
      '<label>Job</label><select id="pe-j"' + dis + '>' + A.options(jobs, e.job) + '</select>' +
      '<div class="two"><div><label>Start</label><input type="time" id="pe-s" value="' + t24(e.start) + '"' + dis + '></div><div><label>End</label><input type="time" id="pe-e" value="' + t24(e.end) + '"' + dis + '></div></div>' +
      '<div class="kv" id="pe-h"></div>' +
      '<label>What he did</label><textarea id="pe-w">' + esc(e.work) + '</textarea>' +
      (e.edits ? '<div class="sub">Changes: ' + esc(e.edits) + '</div>' : '') +
      '<div class="sub">' + esc(hit.person) + ' gets a heads-up when his hours change.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (!billed && !e.paid ? '<button class="btn" data-act="rm" style="color:var(--red)">Delete</button>' : '') +
      '<button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') {
        if (!confirm('Delete ' + hit.person + '\u2019s ' + e.date + ' entry (' + e.start + '\u2013' + e.end + ', ' + e.hours + ' hrs)? A copy is kept in the Hub.')) return;
        A.closeSheet(); return call('time.remove', {id: e.id}).then(function () { toast('Deleted'); });
      }
      if (a !== 'go') return A.closeSheet();
      var f = {id: e.id, work: $('#pe-w').value.trim()};
      if (!billed) { f.date = A.isoToUs($('#pe-d').value); f.job = $('#pe-j').value; f.start = t12($('#pe-s').value); f.end = t12($('#pe-e').value); if (!f.start || !f.end || !f.date) return toast('Fill in date, start and end');
        var a1 = $('#pe-s').value.split(':'), b1 = $('#pe-e').value.split(':'), hx = (((+b1[0] * 60 + +b1[1]) - (+a1[0] * 60 + +a1[1]) + 1440) % 1440) / 60;
        if (hx > 12 && !confirm('That\u2019s ' + Math.round(hx * 100) / 100 + ' hrs (end time is past midnight or before the start). Save anyway?')) return; }
      A.closeSheet(); call('time.edit', f).then(function () { toast('Saved'); });
    });
    function hh() { var s = $('#pe-s').value, en = $('#pe-e').value; if (!s || !en) return; var a = s.split(':'), b = en.split(':');
      var h = (((+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]) + 1440) % 1440) / 60; $('#pe-h').textContent = Math.round(h * 100) / 100 + ' hrs' + (h > 12 ? ' \u2013 over 12, is that right?' : ''); }
    $('#pe-s').onchange = $('#pe-e').onchange = hh; hh();
  }
  function runSheet(id) {
    var x = (P.d.runs || []).filter(function (r) { return r.id === id; })[0]; if (!x) return;
    A.sheet('<h2>' + esc(x.person) + ' \u00b7 paid ' + esc(x.date) + '</h2><div class="kv">' + money(x.amount) + ' for ' + hrs(x.hours) + ' through ' + esc(x.through) + (x.how ? ' \u00b7 ' + esc(x.how) : '') + '</div>' +
      (x.notes ? '<div class="sub">' + esc(x.notes) + '</div>' : '') +
      (x.entries || []).map(function (e, k) { return '<div class="fn-r" data-act="e' + k + '" style="padding-left:0;padding-right:0"><div class="tl-x"><div class="tl-s" style="color:var(--text)">' + esc(e.date) + ' \u00b7 ' + esc(e.job) +
        ' \u00b7 ' + esc(e.start) + '\u2013' + esc(e.end) + '</div></div><div class="fn-amt" style="font-size:14px">' + hrs(e.hours) + ' \u270e</div></div>'; }).join('') +
      '<div class="btns"><button class="btn" data-act="x">Close</button><button class="btn" data-act="undo" style="color:var(--red)">Undo this payment</button></div>', function (a) {
      if (/^e\d+$/.test(a)) return editSheet(x.entries[+a.slice(1)].id);
      if (a === 'undo') {
        if (!confirm('Undo paying ' + x.person + ' ' + money(x.amount) + ' on ' + x.date + '? Those hours go back to owed. (Only if it was entered by mistake.)')) return;
        A.closeSheet(); return call('pay.undo', {id: x.id}).then(function () { toast('Undone'); });
      }
      A.closeSheet();
    });
  }
  function markSheet(name) {
    var p = P.d.people.filter(function (x) { return x.person === name; })[0]; if (!p) return;
    var lastDate = p.entries.length ? p.entries[p.entries.length - 1].date : A.todayStr();
    A.sheet('<h2>Pay ' + esc(name) + '</h2>' +
      '<label>Paying for hours through</label><input type="date" id="pm-t" value="' + A.usToIso(lastDate) + '">' +
      '<div class="kv" id="pm-sum"></div>' +
      '<label>Paid with <span class="sub">(check #, cash, Venmo\u2026)</span></label><input id="pm-h">' +
      '<label>Note <span class="sub">(optional)</span></label><input id="pm-n">' +
      (p.flags.length ? '<div class="sub" style="color:#ffc069">\u26a0\ufe0f ' + p.flags.length + ' thing' + (p.flags.length === 1 ? '' : 's') + ' to check first (see the list).</div>' : '') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Mark paid</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var thr = A.isoToUs($('#pm-t').value); if (!thr) return toast('Pick the date');
      var f = {person: name, through: thr, how: $('#pm-h').value.trim(), note: $('#pm-n').value.trim()};
      A.closeSheet(); call('pay.mark', f).then(function () { toast(name + ' marked paid'); });
    });
    function sum() {
      var t = A.isoToUs($('#pm-t').value), d = Date.parse(A.usToIso(t)), h = 0, m = 0;
      p.entries.forEach(function (e) { if (Date.parse(A.usToIso(e.date)) <= d) { h += e.hours; m += e.amount; } });
      (p.adjusts || []).forEach(function (e) { if (Date.parse(A.usToIso(e.date)) <= d) m += e.amount - e.was; });
      $('#pm-sum').innerHTML = 'Paying <b>' + money(m) + '</b> for ' + hrs(h) + (p.adjust ? ' (includes ' + money(p.adjust) + ' from changed paid days)' : '') + (m < p.amount - 0.005 ? ' \u00b7 ' + money(p.amount - m) + ' stays owed (later days)' : '');
    }
    $('#pm-t').onchange = sum; sum();
  }
  document.addEventListener('click', function (e) {
    if (!onPay() || e.target.closest('#sheet')) return;
    var t;
    if ((t = e.target.closest('[data-paymark]'))) { if (P.busy) return toast('One moment\u2026'); return markSheet(t.getAttribute('data-paymark')); }
    if ((t = e.target.closest('[data-payday]'))) { var k = t.getAttribute('data-payday'); P.open[k] = !P.open[k]; return A.render(); }
    if ((t = e.target.closest('[data-payhist]'))) { P.hist = !P.hist; return A.render(); }
    if ((t = e.target.closest('[data-payrun]'))) return runSheet(t.getAttribute('data-payrun'));
    if ((t = e.target.closest('[data-payedit]'))) { if (P.busy) return toast('One moment\u2026'); return editSheet(t.getAttribute('data-payedit')); }
  });
})();
