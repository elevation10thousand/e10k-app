/* E10K app: Supplies list (inside the Equipment tab). Anyone adds what's running low;
 * Spencer + Hanna get an alert; Sam fills in a price check; anyone marks Ordered / Got it. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var SUP = {items: ls.get('supplies', null), cats: ls.get('supplyCats', ['Fuel', 'Oil & Fluids', 'Filters & Parts', 'Batteries', 'Tools', 'Shop Supplies', 'Safety', 'Materials', 'Other'])};
  var URG = {Out: {ic: '\u26a0\ufe0f', label: 'Out', color: 'var(--red)'}, Low: {ic: '\ud83d\udfe0', label: 'Running low', color: 'var(--orange)'},
    Soon: {ic: '\ud83d\udd35', label: 'Need soon', color: 'var(--blue)'}};
  var RANK = {Out: 0, Low: 1, Soon: 2};

  function count() { return (SUP.items || []).filter(function (x) { return x.status !== 'Got it'; }).length; }
  function load() {
    return A.api('supplies.list').then(function (r) {
      if (!r.ok) return;
      SUP.items = r.items; SUP.cats = r.cats; ls.set('supplies', SUP.items); ls.set('supplyCats', SUP.cats);
      if (A.S.data) A.S.data.supplyCount = count();
      if (A.S.tab === 'equip' && ls.get('eqView', 'machines') === 'supplies') render(true);
    }).catch(function () {});
  }

  function card(x) {
    var U = URG[x.urgency] || URG.Low, got = x.status === 'Got it';
    return '<div class="card tap' + (got ? ' done' : '') + '" data-supply="' + esc(x.id) + '" style="cursor:pointer' + (x.urgency === 'Out' && !got ? ';border:2px solid var(--red)' : '') + '">' +
      '<div class="row"><div class="grow"><div class="title">' + (got ? '\u2705 ' : U.ic + ' ') + esc(x.item) + (x.qty ? ' <span class="sub">\u00b7 ' + esc(x.qty) + '</span>' : '') + '</div>' +
      '<div class="sub">' + esc([x.forWhat ? 'for ' + x.forWhat : '', x.by + ' ' + A.shortD(x.date)].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      (x.best || x.vendor ? '<div class="sub" style="color:var(--green)">Best: ' + esc([x.best, x.vendor].filter(Boolean).join(' at ')) + '</div>' :
        (x.priceCheck ? '<div class="sub">\ud83d\udcb2 ' + esc(String(x.priceCheck).split('\n')[0].slice(0, 90)) + '</div>' : '')) +
      '</div><span class="pill' + (x.status === 'Ordered' ? ' prog' : got ? ' done' : '') + '"' + (!got && x.status === 'Needed' ? ' style="color:' + U.color + '"' : '') + '>' +
      esc(got ? 'Got it' : x.status === 'Ordered' ? 'Ordered' : U.label) + '</span></div></div>';
  }

  function render(noFetch) {
    var html = (A.eqViewChips ? A.eqViewChips() : '') + '<h2>Supplies</h2>';
    var items = SUP.items;
    if (!items) html += '<div class="empty">Loading\u2026</div>';
    else {
      var open = items.filter(function (x) { return x.status !== 'Got it'; }).sort(function (a, b) {
        return (a.status === 'Ordered') - (b.status === 'Ordered') || (RANK[a.urgency] || 1) - (RANK[b.urgency] || 1) || String(b.date).localeCompare(String(a.date));
      });
      var got = items.filter(function (x) { return x.status === 'Got it'; });
      if (!open.length) html += '<div class="empty">Nothing on the list.<br>Tap + when something is running low.</div>';
      html += open.map(card).join('');
      if (got.length) html += '<h3>Got it (last 10 days)</h3>' + got.map(card).join('');
    }
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine) load();
  }

  function find(id) { return (SUP.items || []).filter(function (x) { return x.id === id; })[0]; }

  function supplyForm() {
    var html = '<h2>Running low</h2>' +
      '<label>What do we need?</label><input id="sp-item" placeholder="Diesel, D batteries for the laser\u2026">' +
      '<div class="two"><div><label>How much</label><input id="sp-qty" placeholder="e.g. 100 gal, 8 pack"></div>' +
      '<div><label>Type</label><select id="sp-cat"><option value=""></option>' + SUP.cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div></div>' +
      '<label>For (machine, job or tool)</label><input id="sp-for" placeholder="e.g. laser level, 950G, shop">' +
      '<label>How urgent?</label><div class="chips" id="sp-urg">' + ['Out', 'Low', 'Soon'].map(function (k) {
        return '<button class="chip' + (k === 'Low' ? ' on' : '') + '" data-urg="' + k + '">' + URG[k].ic + ' ' + URG[k].label + '</button>'; }).join('') + '</div>' +
      '<label>Notes</label><textarea id="sp-notes" style="min-height:60px" placeholder="Brand, size, where we usually get it\u2026"></textarea>' +
      '<div class="sub">Spencer and Hanna get an alert, and Sam looks up the best prices.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Add to list</button></div>';
    var urg = 'Low';
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      var f = {item: $('#sp-item').value.trim(), qty: $('#sp-qty').value.trim(), cat: $('#sp-cat').value, forWhat: $('#sp-for').value.trim(),
        urgency: urg, notes: $('#sp-notes').value.trim(), clientId: A.uid()};
      if (!f.item) return toast('What do we need?');
      var temp = {id: 'S-' + f.clientId.slice(0, 8), date: A.todayStr(), item: f.item, qty: f.qty, cat: f.cat, forWhat: f.forWhat, urgency: urg,
        by: A.me().name, status: 'Needed', notes: f.notes};
      SUP.items = (SUP.items || []).concat([temp]); ls.set('supplies', SUP.items);
      if (A.S.data) A.S.data.supplyCount = count();
      A.enqueue('supplies.add', {fields: f});
      A.closeSheet(); render(true); toast('Added \u2013 Spencer and Hanna get a heads-up');
    });
    $('#sp-urg').onclick = function (e) {
      var b = e.target.closest('[data-urg]'); if (!b) return; e.stopPropagation(); urg = b.getAttribute('data-urg');
      Array.prototype.forEach.call(document.querySelectorAll('#sp-urg .chip'), function (x) { x.classList.toggle('on', x === b); });
    };
    setTimeout(function () { var i = $('#sp-item'); if (i) i.focus(); }, 50);
  }

  function detail(x) {
    var m = A.me(), U = URG[x.urgency] || URG.Low;
    var html = '<h2>' + esc(x.item) + '</h2>' +
      '<div class="kv">' + esc([x.qty, x.cat, x.forWhat ? 'for ' + x.forWhat : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      '<div class="kv">' + U.ic + ' ' + esc(U.label) + ' \u00b7 added by <b>' + esc(x.by) + '</b> ' + esc(x.date) + ' \u00b7 <b>' + esc(x.status) + '</b>' +
      (x.gotBy ? ' by ' + esc(x.gotBy) + ' ' + esc(x.gotDate) : '') + '</div>' +
      (x.notes ? '<div class="notes">' + esc(x.notes) + '</div>' : '') +
      (x.priceCheck ? '<h3>Price check (Sam)</h3><div class="card" style="white-space:pre-wrap;font-size:14px">' + linkify(x.priceCheck) + '</div>' :
        '<div class="sub" style="margin-top:8px">Sam is looking up prices\u2026</div>') +
      (m.owner ? '<div class="two"><div><label>Best price</label><input id="sd-best" value="' + esc(x.best || '') + '"></div>' +
        '<div><label>Vendor</label><input id="sd-vendor" value="' + esc(x.vendor || '') + '"></div></div>' +
        '<label>What we paid $</label><input id="sd-cost" inputmode="decimal" value="' + esc(x.cost || '') + '">' : '') +
      '<label>Add a note</label><input id="sd-note" placeholder="Optional">' +
      '<div class="btns">' + (x.status !== 'Ordered' && x.status !== 'Got it' ? '<button class="btn" data-act="Ordered">Ordered</button>' : '') +
      (x.status !== 'Got it' ? '<button class="btn ok" data-act="Got it">\u2705 Got it</button>' : '<button class="btn" data-act="Needed">Need it again</button>') + '</div>' +
      '<div class="btns"><button class="btn" data-act="x">Close</button><button class="btn primary" data-act="save">Save</button></div>';
    A.sheet(html, function (act) {
      if (act === 'x') return A.closeSheet();
      var f = {id: x.id, note: $('#sd-note').value.trim()};
      if (m.owner) { f.best = $('#sd-best').value.trim(); f.vendor = $('#sd-vendor').value.trim(); f.cost = $('#sd-cost').value.trim(); }
      if (act !== 'save') f.status = act;
      if (act === 'save' && !f.note && !(m.owner && (f.best !== (x.best || '') || f.vendor !== (x.vendor || '') || f.cost !== (x.cost || '')))) return A.closeSheet();
      if (f.status) { x.status = f.status; if (f.status === 'Got it') { x.gotBy = m.name; x.gotDate = A.todayStr(); } }
      if (m.owner) { x.best = f.best; x.vendor = f.vendor; x.cost = f.cost; }
      if (f.note) x.notes = (x.notes ? x.notes + ' | ' : '') + A.todayStr() + ' ' + m.name + ': ' + f.note;
      ls.set('supplies', SUP.items); if (A.S.data) A.S.data.supplyCount = count();
      A.enqueue('supplies.update', {fields: f});
      A.closeSheet(); render(true); toast(f.status ? f.status : 'Saved');
    });
  }
  function linkify(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + (u.length > 45 ? u.slice(0, 42) + '\u2026' : u) + '</a>'; });
  }

  A.renderSupplies = render;
  A.supplyForm = supplyForm;
  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'equip') return;
    var c = e.target.closest('[data-supply]'); if (!c) return;
    var x = find(c.getAttribute('data-supply')); if (x) detail(x);
  });
})();
