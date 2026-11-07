/* E10K app: Supplies tab.
 *  - Need to buy: anyone adds what's running low; Spencer + Hanna get an alert; Sam adds a price check.
 *  - Used from shop: anyone logs a part/material pulled from our shop for a job (words and/or photo);
 *    Sam identifies it and finds a recent price; Spencer or Hanna OK it, and only then it's logged to the job's costs. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var SUP = {items: ls.get('supplies', null), cats: ls.get('supplyCats', ['Fuel', 'Oil & Fluids', 'Filters & Parts', 'Batteries', 'Tools', 'Shop Supplies', 'Safety', 'Materials', 'Other'])};
  var SHOP = {items: ls.get('shopUsed', null), categories: ls.get('shopCats', []), billing: ls.get('shopBilling', ['Contract', 'Change order', 'T&M extra', 'Not billable']), def: 'MISC LABOR AND MATERIALS'};
  var RC = {items: ls.get('receipts', null), paidWith: ['Company card', 'Paid myself (pay me back)', 'Cash from petty cash', 'Store account'],
    categories: ls.get('shopCats', []), billing: ['Contract', 'Change order', 'T&M extra', 'Not billable'], folder: '', month: ''};
  var URG = {Out: {ic: '\u26a0\ufe0f', label: 'Out', color: 'var(--red)'}, Low: {ic: '\ud83d\udfe0', label: 'Running low', color: 'var(--orange)'},
    Soon: {ic: '\ud83d\udd35', label: 'Need soon', color: 'var(--blue)'}};
  var RANK = {Out: 0, Low: 1, Soon: 2};
  var SHOP_ST = {Pricing: {t: 'Sam is pricing', c: ''}, 'Check price': {t: 'Waiting for OK', c: 'wait'}, Logged: {t: 'Logged to job', c: 'done'}, 'Not logged': {t: 'Not logged', c: ''}, 'Returned to shop': {t: 'Put back in shop', c: ''}};

  function view() { return ls.get('supView', 'buy'); }
  function count() { return (SUP.items || []).filter(function (x) { return x.status !== 'Got it'; }).length; }
  function checkCount() { return (SHOP.items || []).filter(function (x) { return x.status === 'Check price'; }).length; }
  function money(v) { var n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? '' : '$' + n.toFixed(2); }
  function fixNl(t) { return String(t || '').replace(/\\n/g, '\n'); }
  function linkify(t) {
    return esc(fixNl(t)).replace(/(https?:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + (u.length > 45 ? u.slice(0, 42) + '\u2026' : u) + '</a>'; });
  }
  function badge() {
    var n = count() + (A.me().owner ? checkCount() : 0);
    var ic = document.querySelector('[data-tab=supplies] .ic'); if (!ic) return;
    var old = ic.querySelector('.badge'); if (old) old.remove();
    if (n) ic.insertAdjacentHTML('beforeend', '<span class="badge"' + (A.me().owner && checkCount() ? ' style="background:var(--orange)"' : '') + '>' + n + '</span>');
  }

  function load() {
    var a = A.api('supplies.list').then(function (r) {
      if (!r.ok) return; SUP.items = r.items; SUP.cats = r.cats; ls.set('supplies', SUP.items); ls.set('supplyCats', SUP.cats);
    });
    var b = A.api('shop.list').then(function (r) {
      if (!r.ok) return; SHOP.items = r.items; ls.set('shopUsed', SHOP.items);
      if (r.categories) { SHOP.categories = r.categories; SHOP.billing = r.billing; SHOP.def = r.defaultCategory; ls.set('shopCats', r.categories); ls.set('shopBilling', r.billing); }
    });
    var c = A.api('receipt.list').then(function (r) {
      if (!r.ok) return; RC.items = r.receipts; RC.paidWith = r.paidWith || RC.paidWith; ls.set('receipts', RC.items);
      if (r.categories) { RC.categories = r.categories; RC.billing = r.billing; RC.folder = r.folder; }
    });
    return Promise.all([a, b, c]).then(function () { badge(); if (A.S.tab === 'supplies') render(true); }).catch(function () {});
  }

  function chips() {
    var v = view(), cc = A.me().owner ? checkCount() : 0;
    return '<div class="chips" style="margin:6px 0 2px"><button class="chip' + (v === 'buy' ? ' on' : '') + '" data-supview="buy">\ud83d\uded2 Need to buy' + (count() ? ' (' + count() + ')' : '') + '</button>' +
      '<button class="chip' + (v === 'shop' ? ' on' : '') + '" data-supview="shop">\ud83d\udd27 Used from shop' + (cc ? ' (' + cc + ' to OK)' : '') + '</button>' +
      '<button class="chip' + (v === 'receipts' ? ' on' : '') + '" data-supview="receipts">\ud83e\uddfe Receipts' + (A.me().owner && rcLook() ? ' (' + rcLook() + ' to check)' : '') + '</button></div>';
  }

  function render(noFetch) {
    if (view() === 'shop') renderShop(); else if (view() === 'receipts') renderReceipts(); else renderBuy();
    badge();
    if (!noFetch && navigator.onLine) load();
  }

  // ---------- need to buy ----------
  function buyCard(x) {
    var U = URG[x.urgency] || URG.Low, got = x.status === 'Got it';
    return '<div class="card tap' + (got ? ' done' : '') + '" data-supply="' + esc(x.id) + '" style="cursor:pointer' + (x.urgency === 'Out' && !got ? ';border:2px solid var(--red)' : '') + '">' +
      '<div class="row"><div class="grow"><div class="title">' + (got ? '\u2705 ' : U.ic + ' ') + esc(x.item) + (x.qty ? ' <span class="sub">\u00b7 ' + esc(x.qty) + '</span>' : '') + '</div>' +
      '<div class="sub">' + esc([x.forWhat ? 'for ' + x.forWhat : '', x.by + ' ' + A.shortD(x.date)].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      (x.best || x.vendor ? '<div class="sub" style="color:var(--green)">Best: ' + esc([x.best, x.vendor].filter(Boolean).join(' at ')) + '</div>' :
        (x.priceCheck ? '<div class="sub">\ud83d\udcb2 ' + esc(fixNl(x.priceCheck).split('\n').filter(function (l) { return /^Best:/.test(l); }).concat(fixNl(x.priceCheck).split('\n'))[0].slice(0, 90)) + '</div>' : '')) +
      '</div><span class="pill' + (x.status === 'Ordered' ? ' prog' : got ? ' done' : '') + '"' + (!got && x.status === 'Needed' ? ' style="color:' + U.color + '"' : '') + '>' +
      esc(got ? 'Got it' : x.status === 'Ordered' ? 'Ordered' : U.label) + '</span></div></div>';
  }
  function renderBuy() {
    var html = '<h2>Supplies</h2>' + chips();
    var items = SUP.items;
    if (!items) html += '<div class="empty">Loading\u2026</div>';
    else {
      var open = items.filter(function (x) { return x.status !== 'Got it'; }).sort(function (a, b) {
        return (a.status === 'Ordered') - (b.status === 'Ordered') || (RANK[a.urgency] || 1) - (RANK[b.urgency] || 1) || String(b.date).localeCompare(String(a.date));
      });
      var got = items.filter(function (x) { return x.status === 'Got it'; });
      if (!open.length) html += '<div class="empty">Nothing on the list.<br>Tap + when something is running low.</div>';
      html += open.map(buyCard).join('');
      if (got.length) html += '<h3>Got it (last 10 days)</h3>' + got.map(buyCard).join('');
    }
    $('#view').innerHTML = html;
  }
  function findBuy(id) { return (SUP.items || []).filter(function (x) { return x.id === id; })[0]; }

  function buyForm() {
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
      SUP.items = (SUP.items || []).concat([{id: 'S-' + f.clientId.slice(0, 8), date: A.todayStr(), item: f.item, qty: f.qty, cat: f.cat, forWhat: f.forWhat,
        urgency: urg, by: A.me().name, status: 'Needed', notes: f.notes}]);
      ls.set('supplies', SUP.items);
      A.enqueue('supplies.add', {fields: f});
      A.closeSheet(); render(true); toast('Added \u2013 Spencer and Hanna get a heads-up');
    });
    $('#sp-urg').onclick = function (e) {
      var b = e.target.closest('[data-urg]'); if (!b) return; e.stopPropagation(); urg = b.getAttribute('data-urg');
      Array.prototype.forEach.call(document.querySelectorAll('#sp-urg .chip'), function (x) { x.classList.toggle('on', x === b); });
    };
  }

  function buyDetail(x) {
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
      ls.set('supplies', SUP.items);
      A.enqueue('supplies.update', {fields: f});
      A.closeSheet(); render(true); toast(f.status ? f.status : 'Saved');
    });
  }

  // ---------- used from shop ----------
  function shopCard(x) {
    var st = SHOP_ST[x.status] || SHOP_ST.Pricing, m = A.me();
    return '<div class="card tap" data-shop="' + esc(x.id) + '" style="cursor:pointer' + (m.owner && x.status === 'Check price' ? ';border:2px solid var(--orange)' : '') + '">' +
      '<div class="row"><div class="grow"><div class="title">' + esc(x.identified || x.said || 'Part from shop') + (x.qty && String(x.qty) !== '1' ? ' <span class="sub">\u00b7 x' + esc(x.qty) + '</span>' : '') + '</div>' +
      '<div class="sub">' + esc([x.job, x.by + ' ' + A.shortD(x.date), x.photos ? x.photos + ' photo' + (x.photos > 1 ? 's' : '') : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      (x.identified && x.said && x.identified !== x.said ? '<div class="sub">"' + esc(String(x.said).slice(0, 80)) + '"</div>' : '') +
      '</div><div style="text-align:right">' + (m.owner && x.total ? '<div class="title" style="font-size:15px">' + esc(money(x.total)) + '</div>' : '') +
      '<span class="pill ' + st.c + '">' + esc(st.t) + '</span></div></div></div>';
  }
  function renderShop() {
    var m = A.me(), items = SHOP.items;
    var html = '<h2>Supplies</h2>' + chips() +
      '<div class="sub" style="margin:4px 2px 10px">Grabbed a part or material from the shop for a job? Tap + and describe it or snap a photo. Sam finds the price, ' +
      (m.owner ? 'you OK it, and then it\u2019s charged to the job.' : 'Spencer or Hanna OK it, and then it\u2019s charged to the job.') + '</div>';
    if (!items) html += '<div class="empty">Loading\u2026</div>';
    else {
      var groups = [['Check price', m.owner ? 'Needs your OK' : 'Waiting for Spencer or Hanna'], ['Pricing', 'Sam is pricing'], ['Logged', 'Logged to jobs (last 30 days)'], ['Returned to shop', 'Put back in shop (not charged)'], ['Not logged', 'Not logged']];
      var any = false;
      groups.forEach(function (g) {
        var list = items.filter(function (x) { return x.status === g[0]; }); if (!list.length) return;
        any = true; html += '<h3>' + esc(g[1]) + '</h3>' + list.map(shopCard).join('');
      });
      if (!any) html += '<div class="empty">Nothing logged yet.<br>Tap + when you pull something from the shop.</div>';
    }
    $('#view').innerHTML = html;
  }
  function findShop(id) { return (SHOP.items || []).filter(function (x) { return x.id === id; })[0]; }

  function shopForm() {
    var jobs = (A.S.data.jobs || []).map(function (j) { return j.name; }), photos = [];
    var html = '<h2>Used from shop</h2>' +
      '<label>Which job?</label><select id="su-job"><option value=""></option>' + jobs.map(function (j) {
        return '<option' + (j === ls.get('lastJob', '') ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('') + '</select>' +
      '<label>What is it?</label><textarea id="su-said" style="min-height:70px" placeholder="Tap the mic: 2 inch PVC 90s, a 10 ft stick of 4 inch SDR pipe, 3 hydraulic hose fittings\u2026"></textarea>' +
      '<label>How many</label><input id="su-qty" inputmode="decimal" value="1">' +
      '<label>Photo of the part (helps Sam get it right)</label><input type="file" id="su-ph" accept="image/*" capture="environment" multiple><div class="photos" id="su-ph-prev"></div>' +
      '<div class="sub" style="margin-top:8px">Sam finds a recent price. Nothing is charged to the job until Spencer or Hanna OKs it.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Send</button></div>';
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      var f = {job: $('#su-job').value, said: $('#su-said').value.trim(), qty: $('#su-qty').value.trim() || '1', photos: photos, clientId: A.uid()};
      if (!f.job) return toast('Pick the job');
      if (!f.said && !photos.length) return toast('Describe it or add a photo');
      ls.set('lastJob', f.job);
      SHOP.items = [{id: 'U-' + f.clientId.slice(0, 8), date: A.todayStr(), job: f.job, by: A.me().name, said: f.said, qty: f.qty, photos: photos.length, status: 'Pricing'}].concat(SHOP.items || []);
      ls.set('shopUsed', SHOP.items);
      A.enqueue('shop.add', {fields: f});
      A.closeSheet(); render(true); toast('Sent \u2013 Sam will price it');
    });
    $('#su-ph').onchange = function (e) {
      Array.prototype.forEach.call(e.target.files, function (file) {
        A.shrink(file).then(function (d) {
          photos.push({data: d, type: 'image/jpeg'});
          var im = document.createElement('img'); im.src = d; $('#su-ph-prev').appendChild(im);
        }).catch(function () { toast('Could not read a photo'); });
      });
      e.target.value = '';
    };
  }

  function shopDetail(x) {
    var m = A.me(), st = SHOP_ST[x.status] || SHOP_ST.Pricing, canOk = m.owner && (x.status === 'Check price' || x.status === 'Pricing');
    var cats = SHOP.categories.length ? SHOP.categories : [SHOP.def];
    var html = '<h2>' + esc(x.identified || 'Part from shop') + '</h2>' +
      '<div class="kv">' + esc(x.job) + ' \u00b7 ' + esc(x.by) + ' ' + esc(x.date) + ' \u00b7 <b>' + esc(st.t) + '</b>' + (x.costId ? ' (' + esc(x.costId) + ')' : '') + '</div>' +
      (x.said ? '<div class="notes">' + esc(x.by) + ' said: "' + esc(x.said) + '"</div>' : '') +
      (x.photos ? '<div class="photos" id="sh-ph"><div class="sub">Loading photo\u2026</div></div>' : '') +
      (m.owner ? (x.samNotes || x.source ? '<h3>Sam\u2019s price check</h3><div class="card" style="white-space:pre-wrap;font-size:14px">' + linkify([x.source, x.samNotes].filter(Boolean).join('\n')) + '</div>' :
        (x.status === 'Pricing' ? '<div class="sub" style="margin-top:8px">Sam is identifying and pricing this\u2026</div>' : '')) : '') +
      (x.ownerNotes ? '<div class="sub">' + esc(x.ownerNotes) + '</div>' : '') +
      (canOk ? '<label>Description for the job cost</label><input id="sh-what" value="' + esc(x.identified || x.said || '') + '">' +
        '<div class="two"><div><label>Unit price $</label><input id="sh-unit" inputmode="decimal" value="' + esc(String(x.unit || '').replace(/[$,]/g, '')) + '"></div>' +
        '<div><label>Qty</label><input id="sh-qty" inputmode="decimal" value="' + esc(x.qty || '1') + '"></div></div>' +
        '<div class="kv">Total <b id="sh-total"></b></div>' +
        '<div class="two"><div><label>Category</label><select id="sh-cat">' + cats.map(function (c) { return '<option' + (c === (x.category || SHOP.def) ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Billing</label><select id="sh-bill">' + SHOP.billing.map(function (c) { return '<option' + (c === (x.billing || 'Contract') ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div></div>' +
        '<label>Note (optional, e.g. why it\u2019s wrong)</label><input id="sh-note">' +
        '<div class="btns"><button class="btn" data-act="reprice">Wrong \u2013 re-price</button><button class="btn" data-act="reject">Don\u2019t log</button></div>' +
        '<div class="btns"><button class="btn" data-act="x">Close</button><button class="btn ok" data-act="approve">\u2705 Looks right \u2013 log to job</button></div>'
        : (m.owner && x.total ? '<div class="kv">Logged: <b>' + esc(money(x.total)) + '</b> \u00b7 ' + esc(x.category || '') + ' \u00b7 ' + esc(x.billing || '') + (x.approvedBy ? ' \u00b7 OK\u2019d by ' + esc(x.approvedBy) : '') + '</div>' : '') +
          '<div class="btns"><button class="btn" data-act="x">Close</button></div>');
    var canUndo = x.status !== 'Returned to shop' && (m.owner || (x.by === m.name && x.status !== 'Logged'));
    if (canUndo) html += '<div class="btns"><button class="btn" data-act="returned">\u21a9 Put back in shop</button><button class="btn" data-act="delete" style="color:var(--red)">\ud83d\uddd1 Delete</button></div>' +
      '<div class="sub">Put back in shop: the part wasn\u2019t used, so nothing is charged' + (x.status === 'Logged' ? ' (its job cost line is removed)' : '') + '. Delete: logged by mistake.</div>';
    A.sheet(html, function (act) {
      if (act === 'x') return A.closeSheet();
      if (act === 'returned' || act === 'delete') return undo(x, act);
      if (!canOk) return;
      var f = {id: x.id, action: act, note: $('#sh-note').value.trim()};
      if (act === 'approve') {
        f.identified = $('#sh-what').value.trim(); f.unit = $('#sh-unit').value.trim(); f.qty = $('#sh-qty').value.trim();
        f.category = $('#sh-cat').value; f.billing = $('#sh-bill').value;
        if (!f.unit || isNaN(+f.unit)) return toast('Enter the unit price');
        f.total = Math.round(+f.unit * (+f.qty || 1) * 100) / 100;
        x.status = 'Logged'; x.identified = f.identified; x.unit = f.unit; x.qty = f.qty; x.total = f.total; x.category = f.category; x.billing = f.billing; x.approvedBy = m.name;
      } else if (act === 'reprice') {
        if (!f.note) { $('#sh-note').focus(); return toast('Say what\u2019s wrong so Sam can fix it'); }
        x.status = 'Pricing'; x.unit = ''; x.total = '';
      } else if (act === 'reject') { x.status = 'Not logged'; }
      ls.set('shopUsed', SHOP.items);
      A.enqueue('shop.decide', {fields: f});
      A.closeSheet(); render(true);
      toast(act === 'approve' ? 'Logged to ' + x.job + ' \u2013 ' + money(f.total) : act === 'reprice' ? 'Sent back to Sam' : 'Not logged');
    });
    if (canOk) {
      var upd = function () { var u = +$('#sh-unit').value || 0, q = +$('#sh-qty').value || 1; $('#sh-total').textContent = u ? '$' + (u * q).toFixed(2) : '-'; };
      $('#sh-unit').oninput = upd; $('#sh-qty').oninput = upd; upd();
    }
    if (x.photos && navigator.onLine) A.api('shop.get', {id: x.id}).then(function (r) {
      var el = $('#sh-ph'); if (!el || !r.ok) return;
      el.innerHTML = r.photos.map(function (p) { return p.data ? '<img src="' + p.data + '" style="width:120px;height:120px">' : '<a class="sub" target="_blank" href="' + esc(p.url) + '">Open photo</a>'; }).join('');
      el.onclick = function (e) {
        var im = e.target.closest('img'); if (!im) return;
        var v = document.createElement('div'); v.id = 'photo-viewer';
        v.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:99;display:flex;align-items:center;justify-content:center';
        v.innerHTML = '<img src="' + im.src + '" style="max-width:100%;max-height:100%">'; v.onclick = function () { v.remove(); };
        document.body.appendChild(v);
      };
    }).catch(function () {});
  }

  function undo(x, act) {
    var msg = act === 'delete' ? 'Delete this entry' + (x.status === 'Logged' ? ' and remove its charge from ' + x.job : '') + '?' :
      'Put it back in the shop? Nothing will be charged to ' + x.job + (x.status === 'Logged' ? ' (the job cost line is removed)' : '') + '.';
    if (!confirm(msg)) return;
    if (!navigator.onLine) return toast('Needs a signal');
    A.api('shop.remove', {fields: {id: x.id, action: act}}).then(function (r) {
      if (!r.ok) return toast(r.error === 'already_billed' ? 'Already billed to the client' + (r.invoice ? ' (invoice ' + r.invoice + ')' : '') + ' \u2013 fix it on the invoice' : 'Didn\u2019t work \u2013 try again');
      if (act === 'delete') SHOP.items = (SHOP.items || []).filter(function (y) { return y.id !== x.id; });
      else { x.status = 'Returned to shop'; x.costId = ''; }
      ls.set('shopUsed', SHOP.items);
      A.closeSheet(); render(true);
      toast(act === 'delete' ? 'Deleted' : 'Put back in shop \u2013 not charged');
    }).catch(function () { toast('No signal \u2013 try again'); });
  }

  // ---------- receipts ----------
  function rcLook() { return (RC.items || []).filter(function (x) { return x.status === 'Needs a look'; }).length; }
  function rcMonth(x) { var d = String(x.date || x.uploaded || '').split(' ')[0].split('/'); return d.length === 3 ? d[2] + '-' + d[0] : ''; }
  function monthName(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'}); }
  var RC_ST = {Reading: {t: 'Sam is reading', c: ''}, Logged: {t: 'Logged', c: 'done'}, 'Needs a look': {t: 'Needs a look', c: 'wait'}};
  function rcCard(x) {
    var st = RC_ST[x.status] || RC_ST.Reading;
    return '<div class="card tap" data-rc="' + esc(x.id) + '" style="cursor:pointer' + (x.status === 'Needs a look' && A.me().owner ? ';border:2px solid var(--orange)' : '') + '">' +
      '<div class="row"><div class="grow"><div class="title">\ud83e\uddfe ' + esc(x.vendor || 'Receipt') + (x.date ? ' <span class="sub">\u00b7 ' + esc(x.date) + '</span>' : '') + '</div>' +
      '<div class="sub">' + esc([x.job, x.by, x.paidWith].filter(Boolean).join(' \u00b7 ')) + '</div>' +
      (x.items ? '<div class="sub">' + esc(String(x.items).slice(0, 90)) + '</div>' : '') +
      '</div><div style="text-align:right">' + (x.total ? '<div class="title" style="font-size:15px">' + esc(money(x.total)) + '</div>' : '') +
      '<span class="pill ' + st.c + '">' + esc(st.t) + '</span></div></div></div>';
  }
  function renderReceipts() {
    var m = A.me(), items = RC.items;
    var html = '<h2>Supplies</h2>' + chips() +
      '<div class="sub" style="margin:4px 2px 10px">Bought something? Tap + and snap the receipt. Sam reads it, logs it to the job and files the photo for reconciling.</div>';
    if (!items) { $('#view').innerHTML = html + '<div class="empty">Loading\u2026</div>'; return; }
    if (!items.length) { $('#view').innerHTML = html + '<div class="empty">No receipts yet.<br>Tap + after you buy something.</div>'; return; }
    var look = items.filter(function (x) { return x.status === 'Needs a look'; }), reading = items.filter(function (x) { return x.status === 'Reading'; });
    if (m.owner && look.length) html += '<h3>Needs a look</h3>' + look.map(rcCard).join('');
    if (reading.length) html += '<h3>Sam is reading</h3>' + reading.map(rcCard).join('');
    var done = items.filter(function (x) { return x.status === 'Logged' || (!m.owner && x.status === 'Needs a look'); });
    var months = []; done.forEach(function (x) { var k = rcMonth(x); if (k && months.indexOf(k) < 0) months.push(k); });
    months.sort().reverse();
    if (m.owner && months.length) {
      if (!RC.month || months.indexOf(RC.month) < 0) RC.month = months[0];
      html += '<div class="chips" style="margin-top:12px">' + months.map(function (k) { return '<button class="chip' + (k === RC.month ? ' on' : '') + '" data-rcmonth="' + k + '">' + esc(monthName(k)) + '</button>'; }).join('') + '</div>';
      var inM = done.filter(function (x) { return rcMonth(x) === RC.month; });
      var tot = inM.reduce(function (a, x) { return a + (parseFloat(String(x.total).replace(/[^0-9.\-]/g, '')) || 0); }, 0);
      var byJob = {}; inM.forEach(function (x) { byJob[x.job] = (byJob[x.job] || 0) + (parseFloat(String(x.total).replace(/[^0-9.\-]/g, '')) || 0); });
      var payback = {}; inM.forEach(function (x) { if (/myself/.test(x.paidWith || '')) payback[x.by] = (payback[x.by] || 0) + (parseFloat(String(x.total).replace(/[^0-9.\-]/g, '')) || 0); });
      html += '<div class="card"><div class="row"><div class="grow"><b>' + inM.length + ' receipts</b></div><b>' + money(tot) + '</b></div>' +
        Object.keys(byJob).sort().map(function (j) { return '<div class="row sub"><div class="grow">' + esc(j) + '</div>' + money(byJob[j]) + '</div>'; }).join('') +
        Object.keys(payback).map(function (p) { return '<div class="row sub" style="color:var(--orange)"><div class="grow">Pay back ' + esc(p) + '</div>' + money(payback[p]) + '</div>'; }).join('') +
        (RC.folder ? '<div style="margin-top:8px"><a href="' + esc(RC.folder) + '" target="_blank" rel="noopener">Open all receipt photos (Drive)</a></div>' : '') + '</div>';
      html += inM.map(rcCard).join('');
    } else if (done.length) html += '<h3>Logged</h3>' + done.slice(0, 40).map(rcCard).join('');
    $('#view').innerHTML = html;
  }
  function findRc(id) { return (RC.items || []).filter(function (x) { return x.id === id; })[0]; }

  function receiptForm() {
    var jobs = (A.S.data.jobs || []).map(function (j) { return j.name; }), photos = [];
    var html = '<h2>Receipt</h2>' +
      '<label>Photo of the receipt</label><input type="file" id="rc-ph" accept="image/*" capture="environment" multiple><div class="photos" id="rc-ph-prev"></div>' +
      '<div class="sub">Long receipt? Add more than one photo.</div>' +
      '<label>Which job?</label><select id="rc-job"><option value=""></option>' + jobs.map(function (j) {
        return '<option' + (j === ls.get('lastJob', '') ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('') + '</select>' +
      '<label>How did you pay?</label><div class="chips" id="rc-paid" style="flex-wrap:wrap">' + RC.paidWith.map(function (p, i) {
        return '<button class="chip' + (i === 0 ? ' on' : '') + '" data-paid="' + esc(p) + '">' + esc(p) + '</button>'; }).join('') + '</div>' +
      '<label>Note (optional)</label><input id="rc-note" placeholder="e.g. half of this was for the shop">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Send</button></div>';
    var paid = RC.paidWith[0];
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      if (!photos.length) return toast('Take a photo of the receipt');
      var f = {job: $('#rc-job').value, paidWith: paid, note: $('#rc-note').value.trim(), photos: photos, clientId: A.uid()};
      if (!f.job) return toast('Pick the job');
      ls.set('lastJob', f.job);
      RC.items = [{id: 'RC-' + f.clientId.slice(0, 8), uploaded: A.todayStr(), by: A.me().name, job: f.job, paidWith: paid, note: f.note, photos: photos.length, status: 'Reading'}].concat(RC.items || []);
      ls.set('receipts', RC.items);
      A.enqueue('receipt.add', {fields: f});
      A.closeSheet(); render(true); toast('Sent \u2013 Sam will read it and log it');
    });
    $('#rc-paid').onclick = function (e) {
      var b = e.target.closest('[data-paid]'); if (!b) return; e.stopPropagation(); paid = b.getAttribute('data-paid');
      Array.prototype.forEach.call(document.querySelectorAll('#rc-paid .chip'), function (x) { x.classList.toggle('on', x === b); });
    };
    $('#rc-ph').onchange = function (e) {
      Array.prototype.forEach.call(e.target.files, function (file) {
        A.shrink(file).then(function (d) { photos.push({data: d, type: 'image/jpeg'}); var im = document.createElement('img'); im.src = d; $('#rc-ph-prev').appendChild(im); })
          .catch(function () { toast('Could not read a photo'); });
      });
      e.target.value = '';
    };
  }

  function receiptDetail(x) {
    var m = A.me(), jobs = (A.S.data.jobs || []).map(function (j) { return j.name; });
    var st = RC_ST[x.status] || RC_ST.Reading;
    var html = '<h2>\ud83e\uddfe ' + esc(x.vendor || 'Receipt') + '</h2>' +
      '<div class="kv">' + esc([x.date, x.job, x.by, x.paidWith].filter(Boolean).join(' \u00b7 ')) + ' \u00b7 <b>' + esc(st.t) + '</b>' + (m.owner && x.costId ? ' (' + esc(x.costId) + ')' : '') + '</div>' +
      (x.total ? '<div class="kv">Total <b>' + esc(money(x.total)) + '</b>' + (x.tax ? ' \u00b7 tax ' + esc(money(x.tax)) : '') + (x.receiptNo ? ' \u00b7 #' + esc(x.receiptNo) : '') + (x.card ? ' \u00b7 card ' + esc(x.card) : '') + '</div>' : '') +
      (x.items ? '<div class="notes">' + esc(x.items) + '</div>' : '') +
      (x.note ? '<div class="sub">' + esc(x.by) + ': ' + esc(x.note) + '</div>' : '') +
      (x.samNotes ? '<div class="sub">Sam: ' + esc(x.samNotes) + '</div>' : '') +
      '<div class="photos" id="rc-photos"><div class="sub">Loading photo\u2026</div></div>';
    if (m.owner) html += '<h3>Fix it</h3><div class="two"><div><label>Job</label><select id="rd-job">' + jobs.map(function (j) { return '<option' + (j === x.job ? ' selected' : '') + '>' + esc(j) + '</option>'; }).join('') + '</select></div>' +
      '<div><label>Total $</label><input id="rd-total" inputmode="decimal" value="' + esc(String(x.total || '').replace(/[$,]/g, '')) + '"></div></div>' +
      '<div class="two"><div><label>Vendor</label><input id="rd-vendor" value="' + esc(x.vendor || '') + '"></div><div><label>Date</label><input id="rd-date" value="' + esc(x.date || '') + '"></div></div>' +
      '<div class="two"><div><label>Category</label><select id="rd-cat">' + (RC.categories.length ? RC.categories : ['MISC LABOR AND MATERIALS']).map(function (c) { return '<option' + (c === (x.category || 'MISC LABOR AND MATERIALS') ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
      '<div><label>Billing</label><select id="rd-bill">' + RC.billing.map(function (c) { return '<option' + (c === (x.billing || 'Contract') ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div></div>' +
      '<label>Note</label><input id="rd-note">' +
      '<div class="btns"><button class="btn" data-act="reread">Sam read it wrong</button><button class="btn" data-act="delete" style="color:var(--red)">\ud83d\uddd1 Delete</button></div>' +
      '<div class="btns"><button class="btn" data-act="x">Close</button><button class="btn primary" data-act="save">Save</button></div>';
    else html += '<div class="btns">' + (x.by === m.name && x.status === 'Reading' ? '<button class="btn" data-act="delete" style="color:var(--red)">\ud83d\uddd1 Delete</button>' : '') + '<button class="btn" data-act="x">Close</button></div>';
    A.sheet(html, function (act) {
      if (act === 'x') return A.closeSheet();
      if (act === 'delete') {
        if (!confirm('Delete this receipt' + (x.costId ? ' and its job cost line' : '') + '?')) return;
        return A.api('receipt.remove', {fields: {id: x.id}}).then(function (r) {
          if (!r.ok) return toast(r.error === 'already_billed' ? 'Already billed to the client \u2013 fix it on the invoice' : 'Didn\u2019t work \u2013 try again');
          RC.items = RC.items.filter(function (y) { return y.id !== x.id; }); ls.set('receipts', RC.items); A.closeSheet(); render(true); toast('Deleted');
        }).catch(function () { toast('Needs a signal'); });
      }
      if (!m.owner) return;
      var f = {id: x.id, note: $('#rd-note').value.trim()};
      if (act === 'reread') { if (!f.note) { $('#rd-note').focus(); return toast('Say what\u2019s wrong so Sam can fix it'); } f.reread = true; x.status = 'Reading'; x.costId = ''; }
      else { f.job = $('#rd-job').value; f.total = $('#rd-total').value.trim(); f.vendor = $('#rd-vendor').value.trim(); f.date = $('#rd-date').value.trim();
        f.category = $('#rd-cat').value; f.billing = $('#rd-bill').value;
        Object.assign(x, {job: f.job, total: f.total, vendor: f.vendor, date: f.date, category: f.category, billing: f.billing}); if (x.status === 'Needs a look' && x.costId) x.status = 'Logged'; }
      A.api('receipt.update', {fields: f}).then(function (r) {
        if (!r.ok) return toast(r.error === 'already_billed' ? 'Already billed to the client \u2013 fix it on the invoice' : 'Didn\u2019t save \u2013 try again');
        ls.set('receipts', RC.items); A.closeSheet(); render(true); toast(f.reread ? 'Sent back to Sam' : 'Saved \u2013 job cost updated');
      }).catch(function () { toast('Needs a signal'); });
    });
    if (navigator.onLine) A.api('receipt.get', {id: x.id}).then(function (r) {
      var el = $('#rc-photos'); if (!el || !r.ok) return;
      el.innerHTML = r.photos.map(function (p, i) { return p.data ? '<img src="' + p.data + '" style="width:120px;height:160px">' : '<a class="sub" target="_blank" href="' + esc(r.links[i]) + '">Open photo</a>'; }).join('') +
        (r.links && r.links[0] ? '<div style="width:100%"><a class="sub" target="_blank" rel="noopener" href="' + esc(r.links[0]) + '">Open full size</a></div>' : '');
      el.onclick = function (e) {
        var im = e.target.closest('img'); if (!im) return;
        var v = document.createElement('div'); v.id = 'photo-viewer';
        v.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:99;display:flex;align-items:center;justify-content:center';
        v.innerHTML = '<img src="' + im.src + '" style="max-width:100%;max-height:100%">'; v.onclick = function () { v.remove(); };
        document.body.appendChild(v);
      };
    }).catch(function () {});
  }

  // ---------- wiring ----------
  A.addTab({k: 'supplies', n: 'Supplies', ic: A.svg('<path d="M3 4h2l2.4 11h11.2L21 7H6.2M9 20a1 1 0 1 0 0-.01M18 20a1 1 0 1 0 0-.01"/>'),
    render: function () { render(); },
    // off the tab the count comes from bootstrap (no extra polling); on the tab, from the lists just loaded
    badge: function () {
      var d = A.S.data || {};
      if (A.S.tab !== 'supplies' && d.supplyCount !== undefined) return (d.supplyCount || 0) + (A.me().owner ? (d.shopCheck || 0) + (d.rcLook || 0) : 0);
      return SUP.items || SHOP.items ? count() + (A.me().owner ? checkCount() + rcLook() : 0) : (d.supplyCount || 0) + (d.shopCheck || 0);
    },
    fab: function () { return view() === 'shop' ? shopForm() : view() === 'receipts' ? receiptForm() : buyForm(); }});

  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'supplies') return;
    var v = e.target.closest('[data-supview]');
    if (v) { ls.set('supView', v.getAttribute('data-supview')); window.scrollTo(0, 0); return render(); }
    var c = e.target.closest('[data-supply]'); if (c) { var x = findBuy(c.getAttribute('data-supply')); if (x) return buyDetail(x); }
    var s = e.target.closest('[data-shop]'); if (s) { var y = findShop(s.getAttribute('data-shop')); if (y) return shopDetail(y); }
    var rc = e.target.closest('[data-rc]'); if (rc) { var z = findRc(rc.getAttribute('data-rc')); if (z) return receiptDetail(z); }
    var mo = e.target.closest('[data-rcmonth]'); if (mo) { RC.month = mo.getAttribute('data-rcmonth'); return render(true); }
  });
  // the lists refresh only while the Supplies tab is open (the badge elsewhere uses bootstrap's counts)
  setInterval(function () { if (!document.hidden && navigator.onLine && A.S.data && A.S.tab === 'supplies') load(); }, 180000);
})();
