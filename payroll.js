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
      if (!r.ok) { toast({nothing_owed: 'Nothing owed through that date', bad_date: 'Check the date'}[r.error] || r.error); throw r; }
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
        ' \u00b7 paid this year ' + money(p.paidYear) + (p.open ? ' \u00b7 clocked in now (not counted yet)' : '') + '</div>';
      if (p.flags.length) html += '<div class="sam-box" style="margin:4px 12px 8px"><div class="tl-s" style="margin-bottom:4px">\u26a0\ufe0f Check before you pay</div>' +
        p.flags.map(function (f) { return '<div style="margin:3px 0;color:#ffc069">\u2022 ' + esc(f.text) + '</div>'; }).join('') + '</div>';
      html += p.jobs.map(function (j) {
        return '<div class="fn-r"><div class="tl-x"><div class="fn-t" style="font-size:15px">' + esc(j.job) + '</div><div class="tl-s">' + j.days + ' entr' + (j.days === 1 ? 'y' : 'ies') + '</div></div>' +
          '<div class="fn-amt">' + money(j.amount) + '<div class="tl-s" style="text-align:right">' + hrs(j.hours) + '</div></div></div>'; }).join('');
      if (p.entries.length) html += '<div class="tl-more" data-payday="' + esc(p.person) + '">' + (open ? 'Hide days \u25b4' : 'Show each day (' + p.entries.length + ') \u203a') + '</div>';
      if (open) html += p.entries.map(function (e) {
        return '<div class="fn-r" style="padding-top:4px;padding-bottom:4px"><div class="tl-x"><div class="tl-s" style="color:var(--text)">' + esc(e.date) + ' \u00b7 ' + esc(e.job) + ' \u00b7 ' + esc(e.start) + '\u2013' + esc(e.end) + '</div>' +
          (e.work ? '<div class="tl-s">' + esc(e.work) + '</div>' : '') + '</div><div class="fn-amt" style="font-size:14px">' + hrs(e.hours) + '</div></div>'; }).join('');
      if (p.amount) html += '<div class="fn-bar"><button class="btn primary" data-paymark="' + esc(p.person) + '">Mark ' + esc(p.person) + ' paid</button></div>';
      else html += '<div class="tl-hs">All paid up.</div>';
      html += '</div>';
    });
    var runs = P.d.runs || [];
    if (runs.length) html += '<div class="tl-box"><div class="tl-h" data-payhist="1"><div class="tl-ht">Pay history</div><div class="tl-hc">' + runs.length + (P.hist ? ' \u25b4' : ' \u203a') + '</div></div>' +
      (P.hist ? runs.map(function (x) {
        return '<div class="fn-r" data-payrun="' + esc(x.id) + '"><div class="tl-x"><div class="fn-t" style="font-size:15px">' + esc(x.person) + ' \u00b7 ' + esc(x.date) + '</div><div class="tl-s">' +
          esc(['through ' + x.through, hrs(x.hours), x.how, 'by ' + x.by, x.notes].filter(Boolean).join(' \u00b7 ')) + '</div></div><div class="fn-amt">' + money(x.amount) + '</div></div>'; }).join('') : '') + '</div>';
    html += '<div class="tl-hint">Marking paid resets that person to $0. Their hours stay on the jobs for billing.</div>';
    return html;
  };
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
      $('#pm-sum').innerHTML = 'Paying <b>' + money(m) + '</b> for ' + hrs(h) + (m < p.amount - 0.005 ? ' \u00b7 ' + money(p.amount - m) + ' stays owed (later days)' : '');
    }
    $('#pm-t').onchange = sum; sum();
  }
  document.addEventListener('click', function (e) {
    if (!onPay() || e.target.closest('#sheet')) return;
    var t;
    if ((t = e.target.closest('[data-paymark]'))) { if (P.busy) return toast('One moment\u2026'); return markSheet(t.getAttribute('data-paymark')); }
    if ((t = e.target.closest('[data-payday]'))) { var k = t.getAttribute('data-payday'); P.open[k] = !P.open[k]; return A.render(); }
    if ((t = e.target.closest('[data-payhist]'))) { P.hist = !P.hist; return A.render(); }
    if ((t = e.target.closest('[data-payrun]'))) {
      var x = (P.d.runs || []).filter(function (r) { return r.id === t.getAttribute('data-payrun'); })[0]; if (!x) return;
      if (confirm('Undo paying ' + x.person + ' ' + money(x.amount) + ' on ' + x.date + '? Those hours go back to owed. (Only if it was entered by mistake.)'))
        call('pay.undo', {id: x.id}).then(function () { toast('Undone'); });
    }
  });
})();
