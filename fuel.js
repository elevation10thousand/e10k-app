/* E10K app: Fuel tab. Tank levels (diesel + gas totals), fuel a machine, move fuel between tanks,
 * fuel deliveries with price per gallon (owners), monthly gallons/cost by machine (owners). Crew never see prices. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var F = {tanks: ls.get('fuelTanks', null), log: ls.get('fuelLog', null), months: null, month: ''};
  var TYPE = {Delivery: '\ud83d\ude9a', Fill: '\u26fd', Transfer: '\u2194\ufe0f', Station: '\ud83c\udfea', Adjust: '\u270f\ufe0f'};

  function n1(v) { return v === null || v === undefined || v === '' ? '' : (Math.round(v * 10) / 10).toLocaleString(); }
  function money(v) { return v === null || v === undefined || v === '' || isNaN(v) ? '' : '$' + Number(v).toFixed(2); }
  function money0(v) { return '$' + Math.round(v || 0).toLocaleString(); }
  function tankNames() { return (F.tanks || []).map(function (t) { return t.name; }); }
  function machines() { return ((A.S.data && A.S.data.machines) || []).map(function (m) { return m.name; }); }
  function onFuel() { return A.S.tab === 'equip' && ls.get('eqView', 'machines') === 'fuel' && !(A.curMachine && A.curMachine()); }

  function load() {
    return A.api('fuel.list').then(function (r) {
      if (!r.ok) return;
      F.tanks = r.tanks; F.log = r.log; F.months = r.months || null;
      ls.set('fuelTanks', F.tanks); ls.set('fuelLog', F.log);
      if (onFuel()) render(true);
    }).catch(function () {});
  }

  function gauge(t) {
    var pct = t.cap ? Math.max(0, Math.min(1, t.onHand / t.cap)) : 0, low = pct < 0.2;
    return '<div class="card"><div class="row" style="align-items:baseline"><div class="title grow">' + esc(t.name) + '</div>' +
      '<div class="sub" style="flex:none">' + esc(t.fuel) + '</div></div>' +
      '<div class="fu-bar"><div style="width:' + Math.round(pct * 100) + '%;background:' + (low ? 'var(--red)' : t.fuel === 'Gas' ? 'var(--orange)' : 'var(--green)') + '"></div></div>' +
      '<div class="row sub" style="margin-top:4px"><div class="grow"><b style="color:' + (low ? 'var(--red)' : 'var(--text)') + '">' + n1(Math.max(0, t.onHand)) + ' gal</b> of ' + n1(t.cap) +
      (low ? ' \u00b7 low' : '') + '</div>' + (t.avg ? '<div>avg ' + money(t.avg) + '/gal</div>' : '') + '</div></div>';
  }

  function logRow(x) {
    var own = A.me().owner, what;
    if (x.type === 'Delivery') what = (x.vendor || 'Delivery') + ' \u2192 ' + x.to;
    else if (x.type === 'Adjust') what = 'Correction: ' + (x.to || x.from);
    else what = (x.from || '') + ' \u2192 ' + x.to;
    var extra = [];
    if (x.hours) extra.push(n1(x.hours) + ' hrs');
    if (x.galHr) extra.push(x.galHr + ' gal/hr');
    if (own && x.type === 'Delivery' && x.price) extra.push(money(x.price) + '/gal');
    if (own && (x.total || x.cost)) extra.push(money(x.total || x.cost));
    return '<div class="fu-r" data-fuel="' + esc(x.id) + '"><div class="fu-ic">' + (TYPE[x.type] || '') + '</div><div class="grow"><div>' + esc(what) + '</div>' +
      '<div class="sub">' + esc([x.date, x.by].filter(Boolean).join(' \u00b7 ')) + (extra.length ? ' \u00b7 ' + esc(extra.join(' \u00b7 ')) : '') + '</div></div>' +
      '<div class="fu-g">' + (x.type === 'Adjust' && x.from ? '\u2212' : '') + n1(x.gal) + '<span class="sub"> gal</span></div></div>';
  }

  var HEAD = '<h2>Fuel</h2>';
  function render(noFetch, head) {
    if (head) HEAD = head;
    var own = A.me().owner, html = HEAD;
    if (!F.tanks) { $('#view').innerHTML = html + '<div class="empty">Loading\u2026</div>'; if (!noFetch) load(); return; }
    var tot = {}; F.tanks.forEach(function (t) { tot[t.fuel] = (tot[t.fuel] || 0) + Math.max(0, t.onHand); });
    html += '<div class="fu-tot">' + Object.keys(tot).map(function (k) { return '<div><div class="sub">' + esc(k) + ' on hand</div><div class="fu-big">' + n1(tot[k]) + ' <span class="sub">gal</span></div></div>'; }).join('') + '</div>';
    html += '<div class="btns" style="margin:4px 0 10px"><button class="btn primary" data-fu="fill">\u26fd Fuel up</button><button class="btn" data-fu="move">\u2194\ufe0f Move fuel</button></div>' +
      (own ? '<div class="btns" style="margin:-4px 0 10px"><button class="btn" data-fu="delivery">\ud83d\ude9a Fuel delivery</button></div>' : '');
    html += F.tanks.map(gauge).join('');
    if (own && F.months && F.months.length) {
      if (!F.month || !F.months.some(function (m) { return m.month === F.month; })) F.month = F.months[0].month;
      var mm = F.months.filter(function (m) { return m.month === F.month; })[0];
      html += '<h3>By machine</h3><div class="chips">' + F.months.map(function (m) { var p = m.month.split('-');
        return '<button class="chip' + (m.month === F.month ? ' on' : '') + '" data-fumonth="' + m.month + '">' + new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, {month: 'short', year: 'numeric'}) + '</button>'; }).join('') + '</div>';
      html += '<div class="card">' + (mm.machines.length ? mm.machines.map(function (mc) {
        return '<div class="row" style="padding:4px 0"><div class="grow">' + esc(mc.machine) + (mc.galHr ? ' <span class="sub">\u00b7 ' + mc.galHr + ' gal/hr</span>' : '') + '</div><div>' + n1(mc.gal) + ' gal' + (mc.cost ? ' <span class="sub">\u00b7 ' + money0(mc.cost) + '</span>' : '') + '</div></div>';
      }).join('') : '<div class="sub">No fill-ups logged this month.</div>') +
        '<div class="row sub" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><div class="grow">Delivered: ' +
        (Object.keys(mm.delivered).map(function (k) { return n1(mm.delivered[k]) + ' gal ' + k.toLowerCase(); }).join(', ') || 'none') + '</div>' + (mm.deliveredCost ? money0(mm.deliveredCost) : '') + '</div></div>';
    }
    html += '<h3>Log</h3>' + ((F.log || []).length ? '<div class="card" style="padding:0 0 2px">' + F.log.slice(0, 40).map(logRow).join('') + '</div>' : '<div class="empty">Nothing logged yet.</div>');
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine) load();
  }

  function chipRow(id, items, cur) {
    return '<div class="chips" id="' + id + '" style="flex-wrap:wrap">' + items.map(function (x) {
      return '<button class="chip' + (x === cur ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>';
  }
  function wireChips(id, onPick) {
    var box = document.getElementById(id), v = (box.querySelector('.chip.on') || {}).getAttribute ? box.querySelector('.chip.on').getAttribute('data-v') : '';
    box.onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; e.stopPropagation(); v = b.getAttribute('data-v');
      Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === b); }); if (onPick) onPick(v); };
    return function () { return v; };
  }
  function isoToday() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function us(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[1] + '/' + p[2] + '/' + p[0] : A.todayStr(); }

  function submit(f, localRow) {
    f.clientId = A.uid();
    A.enqueue('fuel.add', {fields: f});
    // update the screen right away
    F.log = [Object.assign({id: 'F-' + f.clientId.slice(0, 8), by: A.me().name, date: f.date}, localRow)].concat(F.log || []);
    (F.tanks || []).forEach(function (t) {
      if (t.name === localRow.from) t.onHand -= localRow.gal;
      if (t.name === localRow.to) t.onHand += localRow.gal;
    });
    ls.set('fuelTanks', F.tanks); ls.set('fuelLog', F.log);
    A.closeSheet(); render(true); setTimeout(load, 6000);
  }

  function fillForm(machine) {
    var tanks = tankNames(), lastTank = ls.get('fuelTank', tanks[0]);
    if (tanks.indexOf(lastTank) < 0) lastTank = tanks[0];
    var ms = machines();
    A.sheet('<h2>\u26fd Fuel up</h2><label>From</label>' + chipRow('fu-from', tanks, lastTank) +
      '<label>Machine / truck</label><select id="fu-to"><option value=""></option>' + ms.map(function (m) { return '<option' + (m === machine ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') +
      '<option>Slip tank</option><option>Gas cans</option><option value="__other">Something else\u2026</option></select><input id="fu-other" placeholder="What did you fuel?" style="display:none;margin-top:6px">' +
      '<label>Gallons (from the pump meter)</label><input id="fu-g" inputmode="decimal" placeholder="e.g. 42.5">' +
      '<div class="two"><div><label>Date</label><input type="date" id="fu-d" value="' + isoToday() + '"></div><div><label>Note</label><input id="fu-n" placeholder="optional"></div></div>' +
      '<div class="sub">Machine hours fill in from the last logged hours.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var from = getFrom(), to = $('#fu-to').value === '__other' ? $('#fu-other').value.trim() : $('#fu-to').value, g = parseFloat($('#fu-g').value);
      if (!from) return toast('Pick the tank');
      if (!to) return toast('Pick what you fueled');
      if (!(g > 0)) { $('#fu-g').focus(); return toast('Enter the gallons'); }
      var tk = (F.tanks || []).filter(function (t) { return t.name === from; })[0];
      if (tk && g > tk.onHand + 5 && !confirm(from + ' only shows about ' + Math.round(tk.onHand) + ' gal. Save ' + g + ' gal anyway?')) return;
      ls.set('fuelTank', from);
      submit({type: 'Fill', from: from, to: to, gallons: g, date: us($('#fu-d').value), notes: $('#fu-n').value.trim()},
        {type: 'Fill', from: from, to: to, gal: g, fuel: tk ? tk.fuel : ''});
      toast('Saved \u2013 ' + g + ' gal into ' + to);
    });
    var getFrom = wireChips('fu-from');
    $('#fu-to').onchange = function () { $('#fu-other').style.display = $('#fu-to').value === '__other' ? 'block' : 'none'; };
  }

  function moveForm() {
    var tanks = tankNames();
    A.sheet('<h2>\u2194\ufe0f Move fuel</h2><label>From</label>' + chipRow('mv-from', tanks, '') + '<label>To</label>' + chipRow('mv-to', tanks, '') +
      '<label>Gallons</label><input id="mv-g" inputmode="decimal"><label>Date</label><input type="date" id="mv-d" value="' + isoToday() + '">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var from = gf(), to = gt(), g = parseFloat($('#mv-g').value);
      if (!from || !to || from === to) return toast('Pick two different tanks');
      if (!(g > 0)) return toast('Enter the gallons');
      submit({type: 'Transfer', from: from, to: to, gallons: g, date: us($('#mv-d').value)}, {type: 'Transfer', from: from, to: to, gal: g});
      toast('Moved ' + g + ' gal');
    });
    var gf = wireChips('mv-from'), gt = wireChips('mv-to');
  }

  function deliveryForm(x) {
    var tanks = tankNames(), edit = !!x;
    x = x || {to: ls.get('fuelDelivTank', tanks[0]), vendor: ls.get('fuelVendor', 'McFarland')};
    A.sheet('<h2>\ud83d\ude9a ' + (edit ? 'Fix delivery' : 'Fuel delivery') + '</h2><label>Into</label>' + chipRow('dl-to', tanks, x.to) +
      '<label>From (company)</label><input id="dl-v" value="' + esc(x.vendor || '') + '">' +
      '<div class="two"><div><label>Gallons</label><input id="dl-g" inputmode="decimal" value="' + esc(x.gal || '') + '"></div>' +
      '<div><label>Price per gallon $</label><input id="dl-p" inputmode="decimal" value="' + esc(x.price ? Number(x.price).toFixed(3) : '') + '"></div></div>' +
      '<div class="two"><div><label>Total $ <span class="sub">(optional)</span></label><input id="dl-t" inputmode="decimal" value="' + esc(x.total ? Number(x.total).toFixed(2) : '') + '"></div>' +
      '<div><label>Delivery date</label><input type="date" id="dl-d" value="' + (x.date ? usToIso(x.date) : isoToday()) + '"></div></div>' +
      '<div class="sub" id="dl-sum"></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (edit ? '<button class="btn" data-act="del" style="color:var(--red)">\ud83d\uddd1 Delete</button>' : '') +
      '<button class="btn primary" data-act="save">Save</button></div>', function (act) {
      if (act === 'del') return removeEntry(x);
      if (act !== 'save') return A.closeSheet();
      var to = gt(), g = parseFloat($('#dl-g').value), p = parseFloat($('#dl-p').value), t = parseFloat($('#dl-t').value);
      if (!to) return toast('Pick the tank');
      if (!(g > 0)) { $('#dl-g').focus(); return toast('Enter the gallons'); }
      var f = {type: 'Delivery', to: to, vendor: $('#dl-v').value.trim(), gallons: g, price: isNaN(p) ? '' : p, total: isNaN(t) ? '' : t, date: us($('#dl-d').value)};
      ls.set('fuelDelivTank', to); if (f.vendor) ls.set('fuelVendor', f.vendor);
      if (edit) {
        f.id = x.id;
        A.api('fuel.update', {fields: f}).then(function (r) { if (!r.ok) return toast('Didn\u2019t save \u2013 try again'); A.closeSheet(); toast('Saved'); load(); })
          .catch(function () { toast('Needs a signal'); });
        return;
      }
      submit(f, {type: 'Delivery', vendor: f.vendor, to: to, gal: g, price: f.price, total: f.total || (f.price ? f.price * g : '')});
      toast('Delivery saved \u2013 ' + g + ' gal');
    });
    var gt = wireChips('dl-to');
    function sum() {
      var g = parseFloat($('#dl-g').value), p = parseFloat($('#dl-p').value), t = parseFloat($('#dl-t').value);
      $('#dl-sum').textContent = g > 0 && p > 0 && isNaN(t) ? 'Total about ' + money(g * p) : g > 0 && t > 0 && isNaN(p) ? 'About ' + money(t / g) + '/gal' : '';
    }
    ['dl-g', 'dl-p', 'dl-t'].forEach(function (id) { $('#' + id).oninput = sum; }); sum();
  }
  function usToIso(v) { var p = String(v).split('/'); return p.length === 3 ? p[2] + '-' + ('0' + p[0]).slice(-2) + '-' + ('0' + p[1]).slice(-2) : isoToday(); }

  function removeEntry(x) {
    if (!confirm('Delete this fuel entry?')) return;
    A.api('fuel.remove', {fields: {id: x.id}}).then(function (r) {
      if (!r.ok) return toast(r.error === 'not_allowed' ? 'Only the office can delete older entries' : 'Didn\u2019t work \u2013 try again');
      F.log = (F.log || []).filter(function (y) { return y.id !== x.id; }); A.closeSheet(); render(true); toast('Deleted'); load();
    }).catch(function () { toast('Needs a signal'); });
  }

  function entryDetail(x) {
    var own = A.me().owner;
    if (own && x.type === 'Delivery') return deliveryForm(x);
    var mine = x.by === A.me().name && x.date === A.todayStr();
    A.sheet('<h2>' + (TYPE[x.type] || '') + ' ' + esc(x.type === 'Fill' ? 'Fuel up' : x.type) + '</h2>' +
      '<div class="kv">' + esc((x.from || x.vendor || '') + ' \u2192 ' + (x.to || '')) + '</div>' +
      '<div class="kv"><b>' + n1(x.gal) + ' gal</b> \u00b7 ' + esc(x.date) + ' \u00b7 ' + esc(x.by || '') + '</div>' +
      (x.hours ? '<div class="kv">Machine at ' + n1(x.hours) + ' hrs' + (x.galHr ? ' \u00b7 ' + x.galHr + ' gal/hr since last fill' : '') + '</div>' : '') +
      (own && (x.total || x.cost) ? '<div class="kv">Cost ' + money(x.total || x.cost) + (x.price ? ' \u00b7 ' + money(x.price) + '/gal' : '') + '</div>' : '') +
      (x.notes ? '<div class="notes">' + esc(x.notes) + '</div>' : '') +
      '<div class="btns">' + (own || mine ? '<button class="btn" data-act="del" style="color:var(--red)">\ud83d\uddd1 Delete</button>' : '') + '<button class="btn" data-act="x">Close</button></div>',
      function (act) { if (act === 'del') return removeEntry(x); A.closeSheet(); });
  }

  A.fuelUp = function (machine) { if (!F.tanks) return load().then(function () { fillForm(machine); }); fillForm(machine); };

  A.renderFuel = function (head, noFetch) { render(noFetch, head); };

  document.addEventListener('click', function (e) {
    if (!onFuel()) return;
    var b = e.target.closest('[data-fu]');
    if (b) { var k = b.getAttribute('data-fu'); return k === 'fill' ? fillForm() : k === 'move' ? moveForm() : deliveryForm(); }
    var mo = e.target.closest('[data-fumonth]'); if (mo) { F.month = mo.getAttribute('data-fumonth'); return render(true); }
    var r = e.target.closest('[data-fuel]'); if (r) { var x = (F.log || []).filter(function (y) { return y.id === r.getAttribute('data-fuel'); })[0]; if (x) return entryDetail(x); }
  });
})();
