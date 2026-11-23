/* E10K app: machine cost cards (Spencer 11/22, option B). Owners only.
   What each machine costs us per hour it runs (not counting the operator): owning + fuel + repairs & wear,
   our logged numbers blended with a published starting estimate. "Use this rate" sets Finance's cost per hour. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var MC = {cards: ls.get('mcost', {}), list: ls.get('mcostList', null)};

  function d(n) { return n === null || n === undefined ? '\u2013' : '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function d0(n) { return n === null || n === undefined ? '\u2013' : '$' + Math.round(n).toLocaleString(); }
  function owner() { var m = A.me(); return m && m.owner; }

  function line(label, part, detail) {
    var v = part && part.v !== null && part.v !== undefined;
    return '<div class="row" style="margin:6px 0;align-items:baseline"><div class="grow"><b>' + esc(label) + '</b>' +
      (part && part.from ? ' <span class="sub">\u00b7 ' + esc(part.from) + '</span>' : '') +
      (detail ? '<div class="sub">' + detail + '</div>' : '') + '</div><div style="flex:none">' + (v ? d(part.v) + '/hr' : '<span class="sub">needs numbers</span>') + '</div></div>';
  }

  function cardHtml(c) {
    if (!c) return '<div class="empty" style="padding:14px">Loading\u2026</div>';
    var tot = c.total, h = '<div class="card">';
    h += '<div class="row" style="align-items:baseline"><div class="grow"><div class="title" style="font-size:22px">' +
      (tot !== null ? d(tot) + '/hr' : (c.partial ? 'At least ' + d(c.partial) + '/hr' : 'Not enough yet')) + '</div>' +
      '<div class="sub">what it costs us to run, not counting the operator</div></div>' +
      (c.bill !== null ? '<div style="text-align:right;flex:none"><div class="sub">Bill rate ' + d(c.bill) + '</div>' +
        (c.margin !== null ? '<div style="font-weight:700;color:' + (c.margin >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (c.margin >= 0 ? '+' : '') + d(c.margin) + '/hr</div><div class="sub">before operator pay</div>' : '') + '</div>' : '') + '</div>';
    h += '<div style="border-top:1px solid #222;margin-top:8px;padding-top:4px">' +
      line('Owning', c.own, c.own && c.own.from === 'ours' ? esc(d0(c.ownYr)) + ' a year \u00f7 ' + Math.round(c.hrsYrUsed) + ' hrs' : 'payment or price, insurance, registration') +
      line('Fuel', c.fuel, c.galHr !== null ? c.galHr + ' gal/hr \u00d7 ' + d(c.fuelPrice) + '/gal ' + esc((c.fuelType || '').toLowerCase()) : '') +
      line('Repairs & wear', c.other, 'last 12 mo: parts ' + d0(c.parts) + ', labor ' + (c.laborHrs || 0) + ' hrs (' + d0(c.laborCost) + ')' +
        (c.wearHr ? ' \u00b7 wear items ' + d(c.wearHr) + '/hr' : '')) + '</div>';
    h += '<div class="sub" style="margin-top:6px">Our logs: ' + (c.hrsRun || 0) + ' hrs run' + (c.days ? ' over ' + c.days + ' days' : '') +
      (c.hrsYrUsed ? ' \u00b7 runs about ' + Math.round(c.hrsYrUsed) + ' hrs a year' + (c.hrsYrFrom && c.hrsYrFrom !== 'typed' ? ' (' + esc(c.hrsYrFrom) + ')' : '') : '') + '</div>';
    if (c.start && c.start.source) h += '<div class="sub">Starting estimate: ' + esc(c.start.source) + '</div>';
    (c.missing || []).forEach(function (x) { h += '<div class="sub" style="color:var(--orange)">Needs: ' + esc(x) + '</div>'; });
    (c.notes || []).forEach(function (x) { h += '<div class="sub" style="color:var(--orange)">Check: ' + esc(x) + '</div>'; });
    h += '<div class="sub" style="margin-top:6px">' + (c.our !== null ? 'Finance uses <b>' + d(c.our) + '/hr</b>' + (c.ourSet ? ' (set ' + esc(c.ourSet) + ')' : '') : 'Finance has no cost for this machine yet, so jobs count its hours as $0') + '</div>';
    h += '<div class="btns">' + (tot !== null && (c.our === null || Math.abs(tot - c.our) >= 0.01) ? '<button class="btn ok" data-mc="use">Use ' + d(tot) + '/hr in Finance</button>' : '') +
      '<button class="btn" data-mc="edit">Edit numbers</button><button class="btn" data-mc="wear">Wear items' + (c.wear && c.wear.length ? ' (' + c.wear.length + ')' : '') + '</button></div>';
    return h + '</div>';
  }

  function paint(key) {
    var el = document.getElementById('eq-mcost'); if (el && A.curMachine() === key) el.innerHTML = cardHtml(MC.cards[key]);
  }
  function fetchCard(key) {
    if (!navigator.onLine) return Promise.resolve();
    return A.api('mcost.get', {fields: {machine: key}}).then(function (r) {
      if (!r.ok) return; MC.cards[key] = r.card; ls.set('mcost', MC.cards); paint(key);
    }).catch(function () {});
  }
  function save(f, msg) {
    return A.api('mcost.' + (f.op ? 'wear' : 'set'), {fields: f}).then(function (r) {
      if (!r.ok) return toast({bad_number: 'That number doesn\u2019t look right', item_required: 'Name the part', not_allowed: 'Owners only'}[r.error] || 'Didn\u2019t save');
      MC.cards[f.machine] = r.card; ls.set('mcost', MC.cards); MC.list = null; paint(f.machine); if (msg) toast(msg);
      return r;
    }).catch(function () { toast('Needs a signal'); });
  }

  function editSheet(key) {
    var c = MC.cards[key] || {};
    A.sheet('<h2>Cost numbers</h2><div class="sub">' + esc(key) + '. Rough is fine; the card gets better as the crew logs.</div>' +
      '<label>Owning cost per year $ <span class="sub">(loan payment \u00d7 12 or price \u00f7 years kept, + insurance + registration)</span></label>' +
      '<input id="mc-own" inputmode="decimal" value="' + esc(c.ownYr === null || c.ownYr === undefined ? '' : c.ownYr) + '">' +
      '<label>Hours it runs in a year <span class="sub">(your best guess)</span></label><input id="mc-hy" inputmode="decimal" value="' + esc(c.hrsYr === null || c.hrsYr === undefined ? '' : c.hrsYr) + '">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {machine: key, ownYr: $('#mc-own').value.replace(/[$,\s]/g, ''), hrsYr: $('#mc-hy').value.replace(/[,\s]/g, '')};
      A.closeSheet(); save(f, 'Saved');
    });
  }
  function wearSheet(key) {
    var c = MC.cards[key] || {}, list = c.wear || [];
    A.sheet('<h2>Wear items</h2><div class="sub">Tires, tracks / undercarriage, teeth, cutting edges: cost spread over the hours they last.</div>' +
      (list.length ? '<div class="card" style="padding:4px 12px">' + list.map(function (w) {
        return '<div class="row" style="padding:8px 0;border-bottom:1px solid #222"><div class="grow"><b>' + esc(w.item) + '</b><div class="sub">' + d0(w.cost) + ' \u00f7 ' + w.life + ' hrs = ' +
          d(w.cost / w.life) + '/hr' + (w.installedHrs ? ' \u00b7 put on at ' + w.installedHrs + ' hrs' : '') + '</div></div><button class="btn" data-act="rm:' + esc(w.id) + '" style="padding:4px 10px">\u2715</button></div>';
      }).join('') + '</div>' : '') +
      '<h3>Add one</h3><label>What</label><input id="wi-i" placeholder="e.g. Tracks, 4 tires, bucket teeth">' +
      '<div class="two"><div><label>Cost $</label><input id="wi-c" inputmode="decimal"></div><div><label>Lasts (hrs)</label><input id="wi-l" inputmode="decimal"></div></div>' +
      '<label>Put on at (hour meter, optional)</label><input id="wi-h" inputmode="decimal">' +
      '<div class="btns"><button class="btn" data-act="x">Close</button><button class="btn primary" data-act="add">Add</button></div>', function (a) {
      if (a && a.indexOf('rm:') === 0) { if (!confirm('Remove this wear item?')) return; A.closeSheet(); return save({machine: key, op: 'remove', id: a.slice(3)}, 'Removed'); }
      if (a !== 'add') return A.closeSheet();
      var f = {machine: key, op: 'add', item: $('#wi-i').value.trim(), cost: $('#wi-c').value.replace(/[$,\s]/g, ''), lifeHrs: $('#wi-l').value.replace(/[,\s]/g, ''), installedHrs: $('#wi-h').value.trim()};
      if (!f.item) return toast('Say what it is');
      if (!(+f.cost > 0) || !(+f.lifeHrs > 0)) return toast('Enter the cost and how many hours it lasts');
      A.closeSheet(); save(f, 'Added');
    });
  }

  /** Summary of every machine (from the Equipment tab). */
  function listSheet() {
    function body(L) {
      if (!L) return '<div class="empty">Loading\u2026</div>';
      return L.slice().sort(function (a, b) { return (b.total !== null) - (a.total !== null) || a.name.localeCompare(b.name); }).map(function (m) {
        return '<div class="row tap" data-act="m:' + esc(m.name) + '" style="padding:10px 0;border-bottom:1px solid #222;align-items:baseline"><div class="grow"><b>' + esc(m.name) + '</b>' +
          '<div class="sub">' + (m.bill !== null ? 'bills ' + d(m.bill) : 'no bill rate') + (m.our !== null ? ' \u00b7 Finance uses ' + d(m.our) : '') + (m.missing ? ' \u00b7 ' + m.missing + ' number' + (m.missing > 1 ? 's' : '') + ' missing' : '') + '</div></div>' +
          '<div style="text-align:right;flex:none">' + (m.total !== null ? '<b>' + d(m.total) + '/hr</b>' : '<span class="sub">' + (m.partial ? '\u2265 ' + d(m.partial) : 'needs numbers') + '</span>') +
          (m.margin !== null ? '<div class="sub" style="color:' + (m.margin >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (m.margin >= 0 ? '+' : '') + d(m.margin) + '/hr</div>' : '') + '</div></div>';
      }).join('');
    }
    A.sheet('<h2>Machine cost per hour</h2><div class="sub">What each costs us to run (no operator). Green = bill rate minus that cost, before the operator\u2019s pay.</div><div id="mcl">' + body(MC.list) + '</div>' +
      '<div class="btns"><button class="btn" data-act="x">Close</button></div>', function (a) {
      A.closeSheet();
      if (a && a.indexOf('m:') === 0 && A.openMachine) setTimeout(function () { A.openMachine(a.slice(2)); }, 60);
    });
    A.api('mcost.list', {}).then(function (r) {
      if (!r.ok) return; MC.list = r.machines; ls.set('mcostList', MC.list);
      var el = document.getElementById('mcl'); if (el) el.innerHTML = body(MC.list);
    }).catch(function () {});
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-mc]'); if (!b || !owner()) return;
    var key = A.curMachine(); if (!key && b.getAttribute('data-mc') !== 'list') return;
    var act = b.getAttribute('data-mc');
    if (act === 'list') return listSheet();
    var c = MC.cards[key];
    if (act === 'use' && c && c.total !== null) {
      if (!confirm('Use ' + d(c.total) + '/hr as what the ' + key + ' costs us? Finance uses it for every job\u2019s profit from now on.')) return;
      return save({machine: key, useRate: c.total}, 'Finance now uses ' + d(c.total) + '/hr');
    }
    if (act === 'edit') return editSheet(key);
    if (act === 'wear') return wearSheet(key);
  });

  A.mcostCardHtml = function (key) { return owner() ? '<h3>What it costs us per hour</h3><div id="eq-mcost">' + cardHtml(MC.cards[key]) + '</div>' : ''; };
  A.mcostLoad = function (key) { if (owner()) fetchCard(key); };
  A.mcostChip = function () { return owner() ? '<button class="chip" data-mc="list" style="margin:4px 0 8px">\ud83d\udcb2 Cost per hour, every machine</button>' : ''; };
})();
