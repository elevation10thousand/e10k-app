/* E10K app: Bids & budgets (owners). Finance > Bids. Backend: Bids.js (bid.*). PDF: bidpdf.js + pdf-lib.
 * Build a bid by category (qty x unit cost, markup), reuse building blocks, see last-time unit costs, ask Sam to price a line,
 * send to Spencer, download the client PDF (DRAFT until approved), mark sent, Won (becomes the job's contract, budget and
 * checklist) or Lost, and copy to a new version. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast;
  var B = {list: null, cur: null, no: null, busy: false, open: {}};
  var UNITS = ['ea', 'hr', 'day', 'ton', 'yd3', 'lf', 'sf', 'load', 'ls', 'gal', 'mo'];
  var ST = {'Draft': ['Draft', 'var(--dim)'], 'Waiting on Spencer': ['Waiting on Spencer', 'var(--orange)'], 'Approved': ['Approved \u2013 ready to send', 'var(--blue)'],
    'Sent': ['Sent to client', 'var(--blue)'], 'Won': ['Won', 'var(--green)'], 'Lost': ['Lost', 'var(--red)']};

  function n(v) { var x = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[$,\s%]/g, '')); return isNaN(x) ? 0 : x; }
  function money(v, cents) { var x = n(v), s = (cents === false ? Math.round(Math.abs(x)).toString() : Math.abs(x).toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (x < 0 ? '-$' : '$') + s; }
  function me() { return (A.me() || {}).name; }
  function isApprover() { return me() === ((B.cur && B.cur.approver) || 'Spencer'); }
  function err(e) {
    var m = String((e && e.error) || e || 'error');
    return {locked: 'This bid was sent \u2013 make a new version to change it', only_spencer: 'Only Spencer can approve', note_required: 'Say what needs to change',
      no_price: 'Price at least one line first', not_approved: 'Spencer has to approve it first', item_required: 'Type the item', title_required: 'Give the bid a name',
      name_taken: 'There\u2019s already a block with that name', pick_lines: 'Tick the lines to save', only_drafts: 'Only drafts can be deleted', not_sent: 'Mark it sent first'}[m] || m.replace(/_/g, ' ');
  }
  function call(action, fields) {
    if (!navigator.onLine) { toast('No signal \u2013 this needs a connection'); return Promise.reject('offline'); }
    B.busy = true;
    return A.api(action, fields).then(function (r) { B.busy = false; if (!r.ok) { toast(err(r)); throw r; } return r; },
      function (e) { B.busy = false; toast('Could not reach the server \u2013 try again'); throw e; });
  }
  function onBid() { return A.S.tab === 'fin' && A.curInv && /^BID:/.test(A.curInv() || ''); }
  function set(r) { B.cur = r; B.no = r.bid.no; if (onBid()) draw(); loadList(); }

  // ---------- list (Finance > Bids) ----------
  function loadList() { return A.api('bid.list').then(function (r) { if (r.ok) { B.list = r; if (A.S.tab === 'fin' && !A.curInv() && A.ls.get('finView', 'inv') === 'bids') A.render(); } }).catch(function () {}); }
  function stTxt(b) { var s = ST[b.status] || ST.Draft; return '<span style="color:' + s[1] + '">' + esc(b.status === 'Draft' && /Spencer:/.test(b.approvalNote) ? 'Sent back by Spencer' : s[0]) + '</span>'; }
  function bidRow(b) {
    return '<div class="fn-r" data-bidopen="' + esc(b.no) + '"><div class="tl-x"><div class="fn-t">' + esc(b.title) + '</div><div class="tl-s">' + stTxt(b) + ' \u00b7 ' + esc(b.no) +
      (b.client ? ' \u00b7 ' + esc(b.client) : '') + '</div></div><div class="fn-amt">' + money(b.price, false) + '</div></div>';
  }
  function box(title, rows, hot) {
    return '<div class="tl-box' + (hot ? ' tl-hot' : '') + '"><div class="tl-h"><div class="tl-ht">' + title + '</div><div class="tl-hc">' + rows.length + '</div></div>' + rows.join('') + '</div>';
  }
  A.bidsHtml = function () {
    if (!B.list) { loadList(); return '<div class="empty">Loading\u2026</div>'; }
    var bids = B.list.bids, by = function (s) { return bids.filter(function (b) { return s.indexOf(b.status) >= 0; }); }, html = '';
    var won = by(['Won']), lost = by(['Lost']), sent = by(['Sent']), decided = won.length + lost.length;
    var wonAmt = won.reduce(function (a, b) { return a + b.price; }, 0), sentAmt = sent.reduce(function (a, b) { return a + b.price; }, 0);
    html += '<div class="fn-tiles"><div class="fn-tile"><div class="tl-s">Out with clients</div><div class="fn-big">' + money(sentAmt, false) + '</div><div class="tl-s">' + sent.length + ' bids</div></div>' +
      '<div class="fn-tile"><div class="tl-s">Won</div><div class="fn-big" style="color:var(--green)">' + money(wonAmt, false) + '</div><div class="tl-s">' +
      (decided ? Math.round(100 * won.length / decided) + '% win rate' : 'no results yet') + '</div></div></div>';
    var waiting = by(['Waiting on Spencer']);
    if (waiting.length) html += box(isApprover() || me() === 'Spencer' ? '\u270b Needs your OK' : 'Waiting on Spencer', waiting.map(bidRow), me() === 'Spencer');
    var ap = by(['Approved']); if (ap.length) html += box('Approved \u2013 ready to send', ap.map(bidRow));
    var dr = by(['Draft']); if (dr.length) html += box('Drafts', dr.map(bidRow));
    if (sent.length) html += box('Sent \u2013 waiting to hear', sent.map(bidRow));
    if (decided) html += box('Won & lost', won.concat(lost).map(bidRow));
    if (!bids.length) html += '<div class="empty">No bids yet. Tap + to start one.</div>';
    html += '<div class="tl-hint">Tap + to start a bid. Won bids become the job\u2019s contract, budget and checklist.</div>';
    return html;
  };
  A.bidFab = function () { newBid(); };

  function newBid() {
    var L = B.list || {jobs: [], types: ['Home build', 'Site work', 'Remodel']};
    var jobs = L.jobs.filter(function (j) { return !/complete|lost/i.test(j.status); });
    A.sheet('<h2>New bid</h2><label>For an existing job? <span class="sub">(optional)</span></label><select id="nb-j"><option value="">\u2013 new customer / project \u2013</option>' +
      jobs.map(function (j) { return '<option>' + esc(j.job) + '</option>'; }).join('') + '</select>' +
      '<label>Bid name</label><input id="nb-t" placeholder="e.g. Smith driveway & leachfield">' +
      '<label>Client</label><input id="nb-c"><div style="display:flex;gap:8px"><div style="flex:1"><label>Email</label><input id="nb-e" type="email"></div>' +
      '<div style="flex:1"><label>Phone</label><input id="nb-p" type="tel"></div></div><label>Address</label><input id="nb-a">' +
      '<label>Kind of job</label><select id="nb-ty">' + A.options(L.types, 'Site work') + '</select>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Markup %</label><input id="nb-m" inputmode="decimal" value="15"></div>' +
      '<div style="flex:1"><label>Contingency %</label><input id="nb-ct" inputmode="decimal" value="5"></div></div>' +
      '<label class="fn-chk"><input type="checkbox" id="nb-s" checked> Start with the usual line items for this kind of job</label>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Start bid</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {job: $('#nb-j').value, title: $('#nb-t').value.trim(), client: $('#nb-c').value.trim(), email: $('#nb-e').value.trim(), phone: $('#nb-p').value.trim(),
        address: $('#nb-a').value.trim(), type: $('#nb-ty').value, markup: $('#nb-m').value, contingency: $('#nb-ct').value, starter: $('#nb-s').checked};
      if (!f.title && !f.job) return toast('Give the bid a name');
      A.closeSheet(); call('bid.create', {fields: f}).then(function (r) { B.cur = r; openBid(r.bid.no, true); toast('Bid ' + r.bid.no + ' started'); });
    });
    $('#nb-j').onchange = function () {
      var j = jobs.filter(function (x) { return x.job === $('#nb-j').value; })[0]; if (!j) return;
      $('#nb-t').value = $('#nb-t').value || j.job; $('#nb-c').value = j.client; $('#nb-e').value = j.email; $('#nb-p').value = j.phone; $('#nb-a').value = j.address;
      if (j.type) $('#nb-ty').value = j.type;
    };
  }

  // ---------- one bid ----------
  function load(no) {
    B.no = no;
    if (B.cur && B.cur.bid.no === no) return draw();
    B.cur = null; draw();
    call('bid.get', {no: no}).then(function (r) { if (B.no === no) { B.cur = r; draw(); } });
  }
  function openBid(no, have) {
    if (!have && B.cur && B.cur.bid.no !== no) B.cur = null;
    if (!have && B.cur && B.cur.bid.no === no) B.cur = null;   // fresh copy when opened from a list
    A.openBidRoute(no);   // sets the screen + back button, then renders -> renderBid -> load
  }
  A.openBid = function (no) { if ((A.me() || {}).owner) openBid(no); };
  A.renderBid = load;

  function editable() { return B.cur && ['Draft', 'Waiting on Spencer', 'Approved'].indexOf(B.cur.bid.status) >= 0; }
  function draw() {
    if (!onBid()) return;
    var html = '<div class="fn-back" data-bidback="1">\u2039 Bids</div>', r = B.cur;
    if (!r) { $('#view').innerHTML = html + '<div class="empty">Loading bid ' + esc(B.no || '') + '\u2026</div>'; return; }
    var b = r.bid, t = r.totals, ed = editable();
    html += '<div class="fn-head"><div><div class="fn-no" style="font-size:20px">' + esc(b.title) + '</div><div class="tl-s">' + esc([b.no, b.client, b.type, b.date].filter(Boolean).join(' \u00b7 ')) +
      '</div><div class="tl-s" style="margin-top:2px">' + stTxt(b) + (b.approvalNote ? ' \u00b7 ' + esc(b.approvalNote) : '') + '</div></div>' +
      '<button class="btn" data-bida="info" style="flex:none;min-width:0;padding:8px 12px">\u270e Details</button></div>';
    var mc = t.margin === null ? '' : (t.margin < 10 ? 'var(--orange)' : 'var(--green)');
    html += '<div class="fn-tiles" style="margin-top:10px">' +
      '<div class="fn-tile"><div class="tl-s">Bid price</div><div class="fn-big">' + money(t.total, false) + '</div><div class="tl-s">what the client sees</div></div>' +
      '<div class="fn-tile"><div class="tl-s">Our cost</div><div class="fn-big">' + money(t.totalCost, false) + '</div><div class="tl-s">' + (t.contCost ? 'incl. ' + money(t.contCost, false) + ' contingency' : 'no contingency') + '</div></div>' +
      '<div class="fn-tile"><div class="tl-s">Profit</div><div class="fn-big" style="color:' + mc + '">' + money(t.profit, false) + '</div><div class="tl-s">' + (t.margin === null ? '' : t.margin + '% margin \u00b7 ' + t.markup + '% markup') + '</div></div>' +
      '</div>';
    html += warnings(r);
    // lines by category
    var byCat = {}, order = [];
    r.lines.forEach(function (l) { var k = l.category || 'Other'; if (!byCat[k]) { byCat[k] = []; order.push(k); } byCat[k].push(l); });
    var tc = {}; t.cats.forEach(function (c) { tc[c.cat] = c; });
    order.forEach(function (k) {
      var ls = byCat[k], c = tc[k] || {price: 0, cost: 0}, open = B.open[k] !== undefined ? B.open[k] : true;
      var unp = ls.filter(function (l) { return !l.cost; }).length;
      html += '<div class="tl-box"><div class="tl-h" data-bidcat="' + esc(k) + '"><div class="tl-ht">' + esc(k) + '</div><div class="tl-hc">' + money(c.price, false) + (open ? ' \u25b4' : ' \u203a') + '</div></div>';
      if (open) {
        html += ls.map(function (l) {
          var hist = r.history[String(l.item).toLowerCase().trim()], hint = '';
          if (hist && (l.unitCost === null || Math.abs(hist.unitCost - l.unitCost) > 0.005)) hint = ' \u00b7 <span style="color:var(--blue)">last time ' + money(hist.unitCost) + '/' + esc(hist.unit || 'unit') + '</span>';
          return '<div class="fn-r" data-bidline="' + esc(l.id) + '"><div class="tl-x"><div class="fn-t" style="font-size:15px">' + esc(l.item) + '</div><div class="tl-s">' +
            (l.cost ? (l.qty !== null ? esc(l.qty + ' ' + (l.unit || '')) + ' \u00d7 ' + money(l.unitCost) + ' = ' : '') + 'cost ' + money(l.cost) + (l.markup !== null ? ' \u00b7 ' + l.markup + '% markup' : '')
              : '<span style="color:var(--orange)">not priced yet</span>') + hint + (l.notes ? ' \u00b7 ' + esc(l.notes) : '') + '</div></div>' +
            '<div class="fn-amt">' + (l.cost ? money(l.price) : '\u2013') + '</div></div>';
        }).join('');
        if (ed) html += '<div class="fn-bar"><button class="btn" data-bidadd="' + esc(k) + '">+ Line</button>' + (unp ? '<button class="btn" data-bidclr="' + esc(k) + '">Remove ' + unp + ' unpriced</button>' : '') + '</div>';
      }
      html += '</div>';
    });
    if (!r.lines.length) html += '<div class="empty">No lines yet. Tap + to add one, or drop in a building block.</div>';
    if (ed) html += '<div class="fn-bar" style="flex-wrap:wrap"><button class="btn" data-bida="cat">+ Category</button><button class="btn" data-bida="block">\ud83e\uddf1 Building block</button>' +
      '<button class="btn" data-bida="saveblock">Save lines as a block</button></div>';
    // actions
    html += actions(r);
    if (r.versions.length > 1) html += '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Versions</div></div>' + r.versions.map(function (v) {
      return '<div class="fn-r" data-bidopen="' + esc(v.no) + '"><div class="tl-x"><div class="fn-t" style="font-size:15px">' + esc(v.no) + (v.no === b.no ? ' (this one)' : '') + '</div><div class="tl-s">' + esc(v.status) + '</div></div><div class="fn-amt">' + money(v.price, false) + '</div></div>'; }).join('') + '</div>';
    $('#view').innerHTML = html;
  }
  function warnings(r) {
    var out = [], t = r.totals, unp = r.lines.filter(function (l) { return !l.cost; }).length;
    if (unp) out.push(['orange', unp + ' line' + (unp === 1 ? ' isn\u2019t' : 's aren\u2019t') + ' priced yet (they stay off the PDF).' +
      (editable() && unp > 3 ? ' <button class="btn" data-bida="clearall" style="margin-top:6px;width:100%">Remove all unpriced lines</button>' : '')]);
    if (t.margin !== null && t.margin < 10 && t.total) out.push(['orange', 'Margin is only ' + t.margin + '%.']);
    if (!t.contingency && r.bid.type === 'Home build') out.push(['dim', 'No contingency on a home build \u2013 most builders carry 5\u201310%.']);
    var hi = r.lines.filter(function (l) { var h = r.history[String(l.item).toLowerCase().trim()]; return h && l.unitCost !== null && h.unitCost > l.unitCost * 1.1; });
    if (hi.length) out.push(['orange', hi.length + ' line' + (hi.length === 1 ? ' is' : 's are') + ' priced more than 10% under what you used last time: ' + hi.slice(0, 3).map(function (l) { return esc(l.item); }).join(', ') + '.']);
    if (!r.bid.scope) out.push(['dim', 'Add a scope of work (Details) \u2013 it prints at the top of the bid.']);
    if (!out.length) return '';
    return '<div class="sam-box" style="margin:0 0 10px"><div class="tl-s" style="margin-bottom:4px">\ud83e\udd16 Sam\u2019s checks</div>' + out.map(function (x) {
      return '<div style="margin:3px 0;color:' + ({orange: '#ffc069', dim: '#cfd6e0'}[x[0]]) + '">\u2022 ' + x[1] + '</div>'; }).join('') + '</div>';
  }
  function actions(r) {
    var b = r.bid, s = b.status, btn = [];
    var pdf = '<button class="btn" data-bida="pdf">\u2b07 Bid PDF' + (['Approved', 'Sent', 'Won'].indexOf(s) < 0 ? ' (draft)' : '') + '</button>';
    if (s === 'Draft') btn.push(me() === 'Spencer' ? '<button class="btn primary" data-bida="submit">\u2713 Approve bid</button>' : '<button class="btn primary" data-bida="submit">Send to Spencer for OK</button>');
    if (s === 'Waiting on Spencer' && me() === 'Spencer') btn.push('<button class="btn primary" data-bida="approve">\u2713 Approve</button><button class="btn" data-bida="back">Send back</button>');
    if (s === 'Approved') btn.push('<button class="btn primary" data-bida="sent">Mark sent to client</button>');
    if (s === 'Sent' || s === 'Approved') btn.push('<button class="btn" data-bida="won" style="color:var(--green)">\ud83c\udfc6 Won</button><button class="btn" data-bida="lost" style="color:var(--red)">Lost</button>');
    btn.push(pdf);
    btn.push('<button class="btn" data-bida="copy">Copy to new version</button>');
    if (s === 'Draft' && !b.sent) btn.push('<button class="btn" data-bida="del" style="color:var(--red)">Delete</button>');
    if (s === 'Won' && b.job && A.openJob) btn.push('<button class="btn" data-bida="job">Open the job \u203a</button>');
    return '<div class="tl-box"><div class="tl-h"><div class="tl-ht">Next step</div></div>' +
      (s === 'Waiting on Spencer' && me() !== 'Spencer' ? '<div class="tl-hs">Waiting on Spencer\u2019s OK. Any change sends it back to draft.</div>' : '') +
      (s === 'Won' ? '<div class="tl-hs">Won ' + esc(b.decided) + ' \u2013 it\u2019s now the contract and budget on ' + esc(b.job) + '.</div>' : '') +
      (s === 'Lost' ? '<div class="tl-hs">Lost ' + esc(b.decided) + (b.lostReason ? ': ' + esc(b.lostReason) : '') + '</div>' : '') +
      '<div class="fn-bar" style="flex-wrap:wrap">' + btn.join('') + '</div></div>';
  }

  // ---------- sheets ----------
  function lineSheet(l, cat) {
    var r = B.cur, isNew = !l, items = (r.catItems[cat || (l && l.category)] || []);
    l = l || {category: cat || '', item: '', qty: null, unit: '', unitCost: null, cost: 0, markup: null, notes: ''};
    var cats = r.cats.concat(r.allCats).filter(function (c, i, a) { return c && a.indexOf(c) === i; });
    A.sheet('<h2>' + (isNew ? 'Add a line' : 'Edit line') + '</h2>' +
      '<label>Category</label><select id="bl-c">' + A.options(cats, l.category, true) + '</select>' +
      '<label>Item</label><input id="bl-i" list="bl-il" value="' + esc(l.item) + '"><datalist id="bl-il">' + items.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Qty</label><input id="bl-q" inputmode="decimal" value="' + (l.qty === null ? '' : l.qty) + '"></div>' +
      '<div style="flex:1"><label>Unit</label><input id="bl-u" list="bl-ul" value="' + esc(l.unit) + '"><datalist id="bl-ul">' + UNITS.map(function (u) { return '<option value="' + u + '">'; }).join('') + '</datalist></div>' +
      '<div style="flex:1.3"><label>$ per unit</label><input id="bl-uc" inputmode="decimal" value="' + (l.unitCost === null ? '' : l.unitCost) + '"></div></div>' +
      '<div class="sub" id="bl-hint"></div>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Or lump sum cost</label><input id="bl-ls" inputmode="decimal" value="' + (l.qty === null && l.cost ? l.cost : '') + '" placeholder="sub quote, etc."></div>' +
      '<div style="flex:1"><label>Markup % <span class="sub">(blank = ' + r.totals.markup + '%)</span></label><input id="bl-m" inputmode="decimal" value="' + (l.markup === null ? '' : l.markup) + '"></div></div>' +
      '<label>Notes</label><input id="bl-n" value="' + esc(l.notes) + '">' +
      '<div class="kv" id="bl-tot"></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button>' + (!isNew ? '<button class="btn" data-act="rm" style="color:var(--red)">Delete</button>' : '') +
      '<button class="btn" data-act="ask">\ud83e\udd16 Ask Sam</button><button class="btn primary" data-act="go">Save</button></div>', function (a) {
      if (a === 'rm') { if (!confirm('Delete this line?')) return; A.closeSheet(); return call('bid.line', {fields: {no: r.bid.no, id: l.id, remove: true}}).then(set); }
      if (a === 'ask') {
        var it = $('#bl-i').value.trim(); if (!it) return toast('Type the item first');
        var txt = 'Price check for bid ' + r.bid.no + ' (' + r.bid.title + (r.bid.address ? ', ' + r.bid.address : '') + '): ' + it +
          ($('#bl-q').value ? ', ' + $('#bl-q').value + ' ' + $('#bl-u').value : '') + '. What should we figure per ' + ($('#bl-u').value || 'unit') + ' delivered/installed around Fairplay, CO? Give sources.';
        A.closeSheet(); if (A.openAsk) A.openAsk({person: me(), text: txt}); return;
      }
      if (a !== 'go') return A.closeSheet();
      var f = {no: r.bid.no, category: $('#bl-c').value, item: $('#bl-i').value.trim(), unit: $('#bl-u').value.trim(), markup: $('#bl-m').value.trim(), notes: $('#bl-n').value.trim()};
      var q = $('#bl-q').value.trim(), uc = $('#bl-uc').value.trim(), ls = $('#bl-ls').value.trim();
      if (q && uc) { f.qty = q; f.unitCost = uc; } else if (ls) f.cost = ls; else if (q || uc) { f.qty = q; f.unitCost = uc; }
      if (!isNew) f.id = l.id;
      if (!f.item) return toast('Type the item'); if (!f.category) return toast('Pick a category');
      A.closeSheet(); call('bid.line', {fields: f}).then(set);
    });
    function upd() {
      var q = n($('#bl-q').value), uc = n($('#bl-uc').value), ls = n($('#bl-ls').value), m = $('#bl-m').value.trim() === '' ? r.totals.markup : n($('#bl-m').value);
      var c = q && uc ? q * uc : ls;
      $('#bl-tot').innerHTML = c ? 'Cost ' + money(c) + ' \u2192 price <b>' + money(c * (1 + m / 100)) + '</b>' : '';
      var h = r.history[$('#bl-i').value.toLowerCase().trim()];
      $('#bl-hint').innerHTML = h ? 'Last time: ' + money(h.unitCost) + '/' + esc(h.unit || 'unit') + ' on ' + esc(h.title || h.bid) + ' (' + esc(h.date) + ') <a href="#" id="bl-use">use it</a>' : '';
      var u = document.getElementById('bl-use'); if (u) u.onclick = function (e) { e.preventDefault(); $('#bl-uc').value = h.unitCost; if (!$('#bl-u').value) $('#bl-u').value = h.unit; upd(); };
    }
    document.querySelector('#sheet-body').oninput = upd; upd();
  }
  function infoSheet() {
    var r = B.cur, b = r.bid, L = B.list || {types: ['Home build', 'Site work', 'Remodel']}, ed = editable();
    A.sheet('<h2>Bid details</h2>' + (ed ? '' : '<div class="sub">This bid is ' + esc(b.status.toLowerCase()) + '. Copy it to a new version to change it.</div>') +
      '<label>Bid name</label><input id="bi-t" value="' + esc(b.title) + '"><label>Client</label><input id="bi-c" value="' + esc(b.client) + '">' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Email</label><input id="bi-e" value="' + esc(b.email) + '"></div><div style="flex:1"><label>Phone</label><input id="bi-p" value="' + esc(b.phone) + '"></div></div>' +
      '<label>Address</label><input id="bi-a" value="' + esc(b.address) + '">' +
      '<div style="display:flex;gap:8px"><div style="flex:1.4"><label>Kind of job</label><select id="bi-ty">' + A.options(L.types, b.type, true) + '</select></div>' +
      '<div style="flex:1"><label>Markup %</label><input id="bi-m" inputmode="decimal" value="' + b.markup + '"></div><div style="flex:1"><label>Contingency %</label><input id="bi-ct" inputmode="decimal" value="' + b.contingency + '"></div></div>' +
      '<label>Scope of work <span class="sub">(prints on the bid)</span></label><textarea id="bi-s" rows="4">' + esc(b.scope) + '</textarea>' +
      '<label>Not included <span class="sub">(prints on the bid)</span></label><textarea id="bi-x" rows="3" placeholder="e.g. Permits, asphalt, landscaping, rock removal beyond 2 hrs">' + esc(b.exclusions) + '</textarea>' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label>Good for (days)</label><input id="bi-v" inputmode="numeric" value="' + b.validDays + '"></div><div style="flex:1"><label>Bid date</label><input id="bi-d" value="' + esc(b.date) + '"></div></div>' +
      '<label class="fn-chk"><input type="checkbox" id="bi-l"' + (b.showLines ? ' checked' : '') + '> Show line items on the PDF (otherwise just category totals)</label>' +
      '<label>Notes <span class="sub">(internal)</span></label><input id="bi-n" value="' + esc(b.notes) + '">' +
      '<div class="btns"><button class="btn" data-act="x">' + (ed ? 'Cancel' : 'Close') + '</button>' + (ed ? '<button class="btn primary" data-act="go">Save</button>' : '') + '</div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {no: b.no, title: $('#bi-t').value.trim(), client: $('#bi-c').value.trim(), email: $('#bi-e').value.trim(), phone: $('#bi-p').value.trim(), address: $('#bi-a').value.trim(),
        type: $('#bi-ty').value, markup: $('#bi-m').value, contingency: $('#bi-ct').value, scope: $('#bi-s').value.trim(), exclusions: $('#bi-x').value.trim(),
        validDays: $('#bi-v').value, date: $('#bi-d').value.trim(), showLines: $('#bi-l').checked, notes: $('#bi-n').value.trim()};
      A.closeSheet(); call('bid.update', {fields: f}).then(function (x) { toast('Saved'); set(x); });
    });
  }
  function blockSheet() {
    var r = B.cur;
    if (!r.blocks.length) return toast('No building blocks yet \u2013 save some lines as one first');
    A.sheet('<h2>Drop in a building block</h2><label>Block</label><select id="bk-n">' + r.blocks.map(function (k) { return '<option value="' + esc(k.name) + '">' + esc(k.name) + ' (' + k.lines + ' lines)</option>'; }).join('') + '</select>' +
      '<label>How many times? <span class="sub">(multiplies the quantities, e.g. 3 for 300 ft of driveway)</span></label><input id="bk-x" inputmode="decimal" value="1">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Add</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var f = {no: r.bid.no, use: $('#bk-n').value, times: $('#bk-x').value}; A.closeSheet(); call('bid.block', {fields: f}).then(function (x) { toast('Added'); set(x); });
    });
  }
  function saveBlockSheet() {
    var r = B.cur, priced = r.lines;
    if (!priced.length) return toast('Add some lines first');
    A.sheet('<h2>Save lines as a building block</h2><div class="sub">Reuse them on the next bid (e.g. \u201cStandard leachfield\u201d).</div><label>Block name</label><input id="sb-n">' +
      '<div style="max-height:45vh;overflow:auto;margin-top:8px">' + priced.map(function (l) { return '<label class="fn-chk"><input type="checkbox" class="sb-l" value="' + esc(l.id) + '"> ' + esc(l.category + ': ' + l.item) + '</label>'; }).join('') + '</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Save block</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var ids = Array.prototype.map.call(document.querySelectorAll('.sb-l:checked'), function (x) { return x.value; }), nm = $('#sb-n').value.trim();
      if (!nm) return toast('Name the block'); if (!ids.length) return toast('Tick the lines to save');
      A.closeSheet(); call('bid.block', {fields: {no: r.bid.no, name: nm, ids: ids}}).then(function (x) { toast('Block saved'); set(x); });
    });
  }
  function catSheet() {
    var r = B.cur, have = r.lines.map(function (l) { return l.category; });
    var opts = r.cats.concat(r.allCats).filter(function (c, i, a) { return c && a.indexOf(c) === i && have.indexOf(c) < 0; });
    A.sheet('<h2>Add a category</h2><select id="bc-c">' + A.options(opts, '', true) + '</select><label>Or a new one</label><input id="bc-n">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Next</button></div>', function (a) {
      if (a !== 'go') return A.closeSheet();
      var c = $('#bc-n').value.trim() || $('#bc-c').value; if (!c) return toast('Pick a category');
      lineSheet(null, c);
    });
  }
  function pdf() {
    var r = B.cur, b = r.bid, t = r.totals, byCat = {};
    r.lines.forEach(function (l) { if (!l.cost) return; (byCat[l.category || 'Other'] = byCat[l.category || 'Other'] || []).push(l); });
    var groups = t.cats.filter(function (c) { return byCat[c.cat]; }).map(function (c) { return {cat: c.cat, price: c.price, lines: byCat[c.cat].map(function (l) { return {item: l.item, qty: l.qty, unit: l.unit, price: l.price}; })}; });
    var bid = {number: b.no, date: b.date, validDays: b.validDays, client: [b.client, b.email, b.phone], project: [b.title, b.address], scope: b.scope, exclusions: b.exclusions,
      showLines: b.showLines, groups: groups, contingency: t.contPrice, total: t.total, draft: ['Approved', 'Sent', 'Won'].indexOf(b.status) >= 0 ? '' : 'DRAFT - NOT APPROVED'};
    toast('Building the bid\u2026');
    var logo = fetch('logo-invoice.png').then(function (x) { return x.arrayBuffer(); }).then(function (x) { return new Uint8Array(x); }).catch(function () { return null; });
    Promise.all([A.loadPdfLib(), logo]).then(function (v) { return window.E10KBid.build(window.PDFLib, bid, {logo: v[1]}); }).then(function (bytes) {
      var name = 'Bid ' + b.no + ' - ' + String(b.title).replace(/[\\/:*?"<>|]/g, '') + (bid.draft ? ' (DRAFT)' : '') + '.pdf';
      var url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'})), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000); toast('Downloaded \u2013 check your Downloads');
    }).catch(function (e) { toast('Could not build the PDF (' + String(e).slice(0, 60) + ')'); });
  }
  function act(a) {
    var r = B.cur, b = r.bid, no = b.no;
    if (a === 'info') return infoSheet();
    if (a === 'cat') return catSheet();
    if (a === 'block') return blockSheet();
    if (a === 'saveblock') return saveBlockSheet();
    if (a === 'pdf') return pdf();
    if (a === 'clearall') { if (!confirm('Remove every line that has no price yet?')) return; return call('bid.clear', {fields: {no: no, unpriced: true}}).then(set); }
    if (a === 'job') return A.openJob(b.job);
    if (a === 'submit') {
      if (me() === 'Spencer') return call('bid.submit', {fields: {no: no}}).then(function (x) { toast('Approved'); set(x); });
      var note = prompt('Anything for Spencer? (optional)'); if (note === null) return;
      return call('bid.submit', {fields: {no: no, note: note}}).then(function (x) { toast('Sent to Spencer'); set(x); });
    }
    if (a === 'approve') return call('bid.decide', {fields: {no: no, approve: true}}).then(function (x) { toast('Approved \u2013 Hanna gets a ping'); set(x); });
    if (a === 'back') { var nt = prompt('What needs to change?'); if (!nt) return; return call('bid.decide', {fields: {no: no, approve: false, note: nt}}).then(set); }
    if (a === 'sent') { if (!confirm('Mark bid ' + no + ' as sent to ' + (b.client || 'the client') + '? (The app doesn\u2019t email it \u2013 send the PDF yourself.)')) return; return call('bid.sent', {fields: {no: no}}).then(set); }
    if (a === 'won') {
      var L = B.list || {jobs: []};
      A.sheet('<h2>\ud83c\udfc6 Won ' + esc(b.no) + '</h2><div class="sub">This sets the job\u2019s contract to ' + money(r.totals.total) + ' (bid), its budget to the bid\u2019s costs by category, and starts its checklist.</div>' +
        '<label>Job</label><select id="bw-j"><option value="">Make a new job: ' + esc(b.title) + '</option>' + L.jobs.map(function (j) { return '<option' + (j.job === b.job ? ' selected' : '') + '>' + esc(j.job) + '</option>'; }).join('') + '</select>' +
        '<label class="fn-chk"><input type="checkbox" id="bw-b" checked> Replace the job\u2019s budget with this bid</label>' +
        '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="go">Mark won</button></div>', function (x) {
        if (x !== 'go') return A.closeSheet();
        var f = {no: no, job: $('#bw-j').value, budget: $('#bw-b').checked}; A.closeSheet();
        call('bid.won', {fields: f}).then(function (y) { toast('Won! ' + (y.won.created ? 'Job ' + y.won.job + ' created' : 'Set up on ' + y.won.job)); set(y); });
      });
      return;
    }
    if (a === 'lost') { var why = prompt('Why did we lose it? (price, timing, went with someone else\u2026)'); if (why === null) return; return call('bid.lost', {fields: {no: no, reason: why}}).then(set); }
    if (a === 'copy') return call('bid.copy', {fields: {no: no}}).then(function (x) { B.cur = x; openBid(x.bid.no, true); toast('New version ' + x.bid.no); });
    if (a === 'del') { if (!confirm('Delete draft ' + no + '?')) return; return call('bid.delete', {fields: {no: no}}).then(function (x) { B.list = x; B.cur = null; history.back(); }); }
  }

  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'fin' || e.target.closest('#sheet')) return;
    var t;
    if ((t = e.target.closest('[data-bidopen]'))) return openBid(t.getAttribute('data-bidopen'));
    if (!onBid()) return;
    if ((t = e.target.closest('[data-bidback]'))) return history.back();
    if (!B.cur) return;
    if (B.busy && e.target.closest('[data-bida],[data-bidadd],[data-bidclr]')) return toast('One moment\u2026');
    if ((t = e.target.closest('[data-bida]'))) return act(t.getAttribute('data-bida'));
    if ((t = e.target.closest('[data-bidcat]'))) { var k = t.getAttribute('data-bidcat'); B.open[k] = B.open[k] === undefined ? false : !B.open[k]; return draw(); }
    if ((t = e.target.closest('[data-bidadd]'))) return lineSheet(null, t.getAttribute('data-bidadd'));
    if ((t = e.target.closest('[data-bidclr]'))) { var c = t.getAttribute('data-bidclr'); return call('bid.clear', {fields: {no: B.cur.bid.no, category: c, unpriced: true}}).then(set); }
    if ((t = e.target.closest('[data-bidline]'))) {
      if (!editable()) return toast('This bid was ' + B.cur.bid.status.toLowerCase() + ' \u2013 copy it to a new version to change it');
      var l = B.cur.lines.filter(function (x) { return x.id === t.getAttribute('data-bidline'); })[0]; return lineSheet(l);
    }
  });
  A.bidLineFab = function () { if (B.cur && editable()) lineSheet(null, ''); else if (B.cur) toast('Copy it to a new version to change it'); };
  setTimeout(function () { if ((A.me() || {}).owner) loadList(); }, 4000);
})();
