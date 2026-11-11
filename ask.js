/* E10K app: "Ask Sam" — a private one-on-one chat with Sam about equipment and company research (everyone).
 * Header 🤖 button (next to team messages) and "Ask Sam about this machine" on each machine page.
 * Sam answers on the server within about a minute; the phone gets a push. Owners can read everyone's chats (read-only). */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var Q = {msgs: ls.get('ask', []), view: '', machine: '', timer: null, open: false, photos: {}, people: [], other: {}};

  function me() { return A.me() && A.me().name; }
  function viewing() { return Q.view || me(); }
  function mine() { return viewing() === me(); }
  function list() { return mine() ? Q.msgs : (Q.other[Q.view] || []); }
  function lastMs(arr) { var x = 0; arr.forEach(function (m) { if (!m.pending && (m.ms || 0) > x) x = m.ms; }); return x; }
  function unread() { var seen = ls.get('askSeen', 0); return Q.msgs.filter(function (m) { return m.from === 'Sam' && (m.ms || 0) > seen; }).length; }
  function waiting() { var m = Q.msgs; for (var i = m.length - 1; i >= 0; i--) { if (m[i].from === 'Sam') return false; if (m[i].status === 'New' || m[i].status === 'Working' || m[i].pending) return true; } return false; }
  function badge() {
    var b = document.getElementById('ask-btn'); if (!b) return;
    var n = unread(), el = b.querySelector('.cbadge'); el.textContent = n > 9 ? '9+' : n || ''; el.style.display = n ? 'block' : 'none';
  }
  function merge(arr, incoming) {
    var have = {}; arr.forEach(function (m, i) { have[m.id] = i; });
    incoming.forEach(function (m) { if (have[m.id] !== undefined) arr[have[m.id]] = m; else arr.push(m); });
    arr.sort(function (a, b) { return (a.ms || 9e15) - (b.ms || 9e15); });
    return arr.slice(-200);
  }
  function poll() {
    if (!navigator.onLine || !A.S.data) return Promise.resolve();
    var who = viewing(), arr = list(), full = Q.open;   // while open: refresh statuses too (Working -> Answered)
    var args = {since: full ? 0 : lastMs(arr)}; if (who !== me()) args.person = who;
    return A.api('ask.list', args).then(function (r) {
      if (!r.ok) return;
      if (r.people) Q.people = r.people;
      if (who === me()) { var pend = Q.msgs.filter(function (m) { return m.pending; }); Q.msgs = merge(full ? pend : Q.msgs, r.messages); ls.set('ask', Q.msgs.filter(function (m) { return !m.pending; })); }
      else Q.other[who] = merge(full ? [] : (Q.other[who] || []), r.messages);
      if (Q.open) { draw(); if (mine()) ls.set('askSeen', lastMs(Q.msgs)); }
      badge();
    }).catch(function () {});
  }

  function timeLabel(when) { var t = String(when || '').split(' ')[1] || '', p = t.split(':'); if (p.length < 2) return t; var h = +p[0]; return ((h % 12) || 12) + ':' + p[1] + (h < 12 ? ' am' : ' pm'); }
  function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
  function draw() {
    var box = document.getElementById('ask-list'); if (!box) return;
    var arr = list(), lastDay = '', html = '';
    // owner: whose conversation
    var pick = document.getElementById('ask-people');
    if (pick) {
      var names = [me()].concat(Q.people.map(function (p) { return p.name; }).filter(function (n) { return n !== me(); }));
      pick.innerHTML = A.me().owner && names.length > 1 ? names.map(function (n) {
        return '<button class="chip' + (n === viewing() ? ' on' : '') + '" data-askp="' + esc(n) + '">' + esc(n === me() ? 'Mine' : n) + '</button>'; }).join('') : '';
    }
    if (!arr.length) html = mine() ? '<div class="empty">Ask me anything about the equipment or the company:<br>fluids, part numbers, manuals, error codes, where to buy something, how-to.<br><br>Add a photo of a nameplate, part or problem with \ud83d\udcf7.</div>'
      : '<div class="empty">No questions yet.</div>';
    arr.forEach(function (m) {
      var d = String(m.when || '').split(' ')[0];
      if (d && d !== lastDay) { html += '<div class="cday">' + esc(d === A.todayStr() ? 'Today' : d) + '</div>'; lastDay = d; }
      var sam = m.from === 'Sam', right = mine() ? !sam : sam;
      html += '<div class="cmsg' + (right ? ' mine' : '') + (sam ? ' ask-sam' : '') + '">' + (sam ? '<div class="cfrom">\ud83e\udd16 Sam</div>' : (mine() ? '' : '<div class="cfrom">' + esc(m.from) + '</div>')) +
        (m.machine && !sam ? '<div class="ask-tag">\ud83d\ude9c ' + esc(m.machine) + '</div>' : '') +
        (m.photo ? '<div class="cph" data-askph="' + esc(m.id) + '">' + (Q.photos[m.id] || m.localPhoto ? '<img src="' + (Q.photos[m.id] || m.localPhoto) + '">' : '\ud83d\udcf7 Loading photo\u2026') + '</div>' : '') +
        (m.text ? '<div class="ctext">' + linkify(m.text) + '</div>' : '') +
        (sam && m.actions && A.me().owner ? '<div class="ctime">Did: ' + esc(m.actions) + '</div>' : '') +
        '<div class="ctime">' + (m.pending ? 'sending\u2026' : esc(timeLabel(m.when)) + (m.status === 'Needs Spencer' ? ' \u00b7 waiting on Spencer' : '')) + '</div></div>';
    });
    if (mine() && waiting()) html += '<div class="cmsg ask-sam"><div class="cfrom">\ud83e\udd16 Sam</div><div class="ctext ask-typing">looking into it\u2026</div></div>';
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('[data-askph]'), function (el) {
      var id = el.getAttribute('data-askph'); if (Q.photos[id] || el.querySelector('img') || /^Q-new/.test(id)) return;
      A.api('ask.photo', {id: id}).then(function (r) { if (r.ok && r.photos[0] && r.photos[0].data) { Q.photos[id] = r.photos[0].data; el.innerHTML = '<img src="' + Q.photos[id] + '">'; } }).catch(function () {});
    });
    box.scrollTop = box.scrollHeight;
    var bar = document.getElementById('ask-bar'); if (bar) bar.style.display = mine() ? '' : 'none';
    var ro = document.getElementById('ask-ro'); if (ro) ro.style.display = mine() ? 'none' : 'block';
    var mt = document.getElementById('ask-mtag');
    if (mt) mt.innerHTML = Q.machine && mine() ? '\ud83d\ude9c About: <b>' + esc(Q.machine) + '</b> <button data-askclear="1">\u2715</button>' : '';
  }

  function openAsk(opt) {
    opt = opt || {};
    if (opt.person !== undefined) Q.view = opt.person === me() ? '' : opt.person;
    if (opt.machine !== undefined) Q.machine = opt.machine;
    var panel = document.getElementById('ask-panel');
    panel.classList.remove('hidden'); document.body.style.overflow = 'hidden'; Q.open = true;
    try { history.pushState({e10k: 1, tab: A.S.tab, ask: 1}, ''); } catch (e) {}
    draw(); poll(); badge();
    clearInterval(Q.timer); Q.timer = setInterval(poll, waiting() ? 5000 : 15000);
    if (opt.machine && mine()) setTimeout(function () { var t = document.getElementById('ask-text'); if (t) t.focus(); }, 100);
  }
  function closeAsk(fromPop) {
    var panel = document.getElementById('ask-panel'); if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden'); document.body.style.overflow = ''; Q.open = false; clearInterval(Q.timer);
    if (mine()) ls.set('askSeen', lastMs(Q.msgs)); Q.view = ''; badge();
    if (!fromPop && history.state && history.state.ask) history.back();
  }
  window.addEventListener('popstate', function () { if (Q.open) closeAsk(true); });

  var pendingPhoto = null;
  function send() {
    var ta = document.getElementById('ask-text'), text = ta.value.trim();
    if (!text && !pendingPhoto) return;
    var cid = A.uid(), msg = {id: 'Q-' + cid.slice(0, 8), person: me(), from: me(), text: text, machine: Q.machine, when: '', ms: 0, pending: true, status: 'New',
      photo: pendingPhoto ? 1 : 0, localPhoto: pendingPhoto};
    Q.msgs.push(msg);
    var f = {text: text, machine: Q.machine, clientId: cid}; if (pendingPhoto) f.photo = {data: pendingPhoto};
    ta.value = ''; ta.dispatchEvent(new Event('input', {bubbles: true})); pendingPhoto = null; document.getElementById('ask-prev').innerHTML = '';
    draw();
    A.api('ask.send', {fields: f}).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      Q.msgs = Q.msgs.filter(function (m) { return m !== msg; });
      if (r.message) { if (msg.localPhoto) Q.photos[r.message.id] = msg.localPhoto; Q.msgs = merge(Q.msgs, [r.message]); }
      ls.set('ask', Q.msgs.filter(function (m) { return !m.pending; })); draw();
      clearInterval(Q.timer); Q.timer = setInterval(poll, 5000);
    }).catch(function () {
      A.enqueue('ask.send', {fields: f});   // no signal: goes when there is
      toast('No signal \u2013 it will send when you have service');
    });
  }

  function build() {
    document.getElementById('top').insertAdjacentHTML('beforeend', '<button id="ask-btn" class="hbtn hright2" aria-label="Ask Sam">\ud83e\udd16<span class="cbadge"></span></button>');
    document.body.insertAdjacentHTML('beforeend', '<div id="ask-panel" class="chat hidden">' +
      '<div class="chat-head"><button class="hbtn" id="ask-close" aria-label="Back">\u2190</button><div class="chat-title">\ud83e\udd16 Ask Sam</div>' +
      '<div class="sub" style="margin-left:auto;margin-right:12px">equipment \u00b7 parts \u00b7 research</div></div>' +
      '<div id="ask-people" class="chips" style="padding:6px 10px 0;margin:0"></div>' +
      '<div id="ask-list" class="chat-list"></div>' +
      '<div id="ask-ro" class="sub" style="display:none;padding:8px 12px;border-top:1px solid var(--line)">Reading only \u2013 tap Mine to ask your own question.</div>' +
      '<div id="ask-bar"><div id="ask-mtag" class="ask-mtag"></div><div id="ask-prev" class="chat-prev"></div>' +
      '<div class="chat-bar"><label class="hbtn" for="ask-ph" aria-label="Photo">\ud83d\udcf7</label><input type="file" id="ask-ph" accept="image/*" style="display:none">' +
      '<textarea id="ask-text" rows="1" placeholder="Ask Sam\u2026"></textarea><button id="ask-send" class="btn primary">Send</button></div></div></div>');
    document.getElementById('ask-btn').onclick = function () { openAsk({person: me()}); };
    document.getElementById('ask-close').onclick = function () { closeAsk(false); };
    document.getElementById('ask-send').onclick = send;
    var ta = document.getElementById('ask-text');
    ta.oninput = function () { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
    document.getElementById('ask-ph').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      A.shrink(file).then(function (d) { pendingPhoto = d; document.getElementById('ask-prev').innerHTML = '<img src="' + d + '"> <span class="sub">photo ready \u2013 tap Send</span>'; });
      e.target.value = '';
    };
    document.getElementById('ask-panel').addEventListener('click', function (e) {
      var p = e.target.closest('[data-askp]');
      if (p) { var n = p.getAttribute('data-askp'); Q.view = n === me() ? '' : n; draw(); return poll(); }
      if (e.target.closest('[data-askclear]')) { Q.machine = ''; return draw(); }
      var im = e.target.closest('.cph img');
      if (im) { var v = document.createElement('div'); v.id = 'photo-viewer'; v.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:200;display:flex;align-items:center;justify-content:center';
        v.innerHTML = '<img src="' + im.src + '" style="max-width:100%;max-height:100%">'; v.onclick = function () { v.remove(); }; document.body.appendChild(v); }
    });
    badge();
  }

  A.openAsk = openAsk;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  setTimeout(poll, 4000);
  setInterval(function () { if (!document.hidden && !Q.open) poll(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
