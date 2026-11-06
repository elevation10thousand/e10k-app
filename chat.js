/* E10K app: team message board. Header button with unread count; full-screen chat; photos; pings everyone's phone. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var C = {msgs: ls.get('chat', []), open: false, timer: null, photos: {}};

  function last() { return C.msgs.length ? C.msgs[C.msgs.length - 1].ms || 0 : 0; }
  function unread() {
    var seen = ls.get('chatSeen', 0), me = A.me() && A.me().name;
    return C.msgs.filter(function (m) { return (m.ms || 0) > seen && m.from !== me; }).length;
  }
  function badge() {
    var b = document.getElementById('chat-btn'); if (!b) return;
    var n = unread(); b.querySelector('.cbadge').textContent = n > 9 ? '9+' : n || '';
    b.querySelector('.cbadge').style.display = n ? 'block' : 'none';
  }
  function merge(list) {
    var have = {}; C.msgs.forEach(function (m) { have[m.id] = 1; });
    var added = false;
    (list || []).forEach(function (m) { if (!have[m.id]) { C.msgs.push(m); added = true; } else {
      C.msgs.forEach(function (x, i) { if (x.id === m.id && x.pending) C.msgs[i] = m; }); } });
    C.msgs = C.msgs.filter(function (m) { return !m.pending || !list.some(function (x) { return x.id === m.id; }); }).concat([]);
    C.msgs.sort(function (a, b) { return (a.ms || 9e15) - (b.ms || 9e15); });
    if (C.msgs.length > 300) C.msgs = C.msgs.slice(-300);
    ls.set('chat', C.msgs.filter(function (m) { return !m.pending; }));
    return added;
  }
  function poll() {
    if (!navigator.onLine || !A.S.data) return Promise.resolve();
    var since = 0; C.msgs.forEach(function (m) { if (!m.pending && (m.ms || 0) > since) since = m.ms; });
    return A.api('chat.list', {since: since}).then(function (r) {
      if (!r.ok) return;
      if (merge(r.messages) && C.open) draw(true);
      if (C.open) ls.set('chatSeen', last());
      badge();
    }).catch(function () {});
  }

  function dayLabel(when) { return String(when || '').split(' ')[0]; }
  function timeLabel(when) {
    var t = String(when || '').split(' ')[1] || ''; var p = t.split(':'); if (p.length < 2) return t;
    var h = +p[0]; return ((h % 12) || 12) + ':' + p[1] + (h < 12 ? ' am' : ' pm');
  }
  function draw(scroll) {
    var box = document.getElementById('chat-list'); if (!box) return;
    var me = A.me().name, lastDay = '', html = '';
    if (!C.msgs.length) html = '<div class="empty">No messages yet. Say hi \ud83d\udc4b</div>';
    C.msgs.forEach(function (m) {
      var d = dayLabel(m.when); if (d && d !== lastDay) { html += '<div class="cday">' + esc(d === A.todayStr() ? 'Today' : d) + '</div>'; lastDay = d; }
      var mine = m.from === me;
      html += '<div class="cmsg' + (mine ? ' mine' : '') + '">' + (mine ? '' : '<div class="cfrom">' + esc(m.from) + '</div>') +
        (m.photo ? '<div class="cph" data-cph="' + esc(m.id) + '">' + (C.photos[m.id] ? '<img src="' + C.photos[m.id] + '">' : (m.localPhoto ? '<img src="' + m.localPhoto + '">' : '\ud83d\udcf7 Loading photo\u2026')) + '</div>' : '') +
        (m.text ? '<div class="ctext">' + esc(m.text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>') + '</div>' : '') +
        '<div class="ctime">' + (m.pending ? 'sending\u2026' : esc(timeLabel(m.when))) + '</div></div>';
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('[data-cph]'), function (el) {
      var id = el.getAttribute('data-cph'); if (C.photos[id] || /^M-/.test(id) === false) return;
      if (el.querySelector('img')) return;
      A.api('chat.photo', {id: id}).then(function (r) {
        if (r.ok && r.photos[0] && r.photos[0].data) { C.photos[id] = r.photos[0].data; el.innerHTML = '<img src="' + C.photos[id] + '">'; }
      }).catch(function () {});
    });
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  function openChat() {
    var panel = document.getElementById('chat-panel');
    panel.classList.remove('hidden'); document.body.style.overflow = 'hidden'; C.open = true;
    try { history.pushState({e10k: 1, tab: A.S.tab, chat: 1}, ''); } catch (e) {}
    draw(true); ls.set('chatSeen', last()); badge(); poll();
    clearInterval(C.timer); C.timer = setInterval(poll, 6000);
  }
  function closeChat(fromPop) {
    var panel = document.getElementById('chat-panel'); if (panel.classList.contains('hidden')) return;
    panel.classList.add('hidden'); document.body.style.overflow = ''; C.open = false; clearInterval(C.timer);
    ls.set('chatSeen', last()); badge();
    if (!fromPop && history.state && history.state.chat) history.back();
  }
  window.addEventListener('popstate', function () { if (C.open) closeChat(true); });

  var pendingPhoto = null;
  function send() {
    var ta = document.getElementById('chat-text'), text = ta.value.trim();
    if (!text && !pendingPhoto) return;
    var cid = A.uid(), msg = {id: 'M-' + cid.slice(0, 8), from: A.me().name, text: text, when: '', ms: 0, pending: true, photo: pendingPhoto ? 1 : 0, localPhoto: pendingPhoto};
    C.msgs.push(msg); draw(true);
    var f = {text: text, clientId: cid}; if (pendingPhoto) f.photo = {data: pendingPhoto};
    ta.value = ''; ta.style.height = ''; pendingPhoto = null; document.getElementById('chat-prev').innerHTML = '';
    A.api('chat.send', {fields: f}).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      if (r.message) { if (msg.localPhoto) C.photos[r.message.id] = msg.localPhoto; merge([r.message]); }
      draw(true); ls.set('chatSeen', last());
    }).catch(function () {
      // keep it in the offline queue so it goes when there's signal
      C.msgs = C.msgs.filter(function (m) { return m !== msg; });
      A.enqueue('chat.send', {fields: f});
      msg.pending = true; C.msgs.push(msg); draw(true);
      toast('No signal \u2013 it will send when you have service');
    });
  }

  function build() {
    var hdr = document.getElementById('top');
    hdr.insertAdjacentHTML('beforeend', '<button id="chat-btn" class="hbtn hright" aria-label="Messages">' +
      A.svg('<path d="M4 5h16v11H8l-4 4z"/>') + '<span class="cbadge"></span></button>');
    document.body.insertAdjacentHTML('beforeend', '<div id="chat-panel" class="chat hidden">' +
      '<div class="chat-head"><button class="hbtn" id="chat-close" aria-label="Back">\u2190</button><div class="chat-title">Team messages</div>' +
      '<div class="sub" style="margin-left:auto;margin-right:12px">Spencer \u00b7 Hanna \u00b7 Bob \u00b7 Will</div></div>' +
      '<div id="chat-list" class="chat-list"></div>' +
      '<div id="chat-prev" class="chat-prev"></div>' +
      '<div class="chat-bar"><label class="hbtn" for="chat-ph" aria-label="Photo">\ud83d\udcf7</label><input type="file" id="chat-ph" accept="image/*" style="display:none">' +
      '<textarea id="chat-text" rows="1" placeholder="Message everyone\u2026"></textarea><button id="chat-send" class="btn primary">Send</button></div></div>');
    document.getElementById('chat-btn').onclick = openChat;
    document.getElementById('chat-close').onclick = function () { closeChat(false); };
    document.getElementById('chat-send').onclick = send;
    var ta = document.getElementById('chat-text');
    ta.oninput = function () { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
    document.getElementById('chat-ph').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      A.shrink(file).then(function (d) { pendingPhoto = d; document.getElementById('chat-prev').innerHTML = '<img src="' + d + '"> <span class="sub">photo ready \u2013 tap Send</span>'; });
      e.target.value = '';
    };
    document.getElementById('chat-list').onclick = function (e) {
      var im = e.target.closest('.cph img'); if (!im) return;
      var v = document.createElement('div'); v.id = 'photo-viewer';
      v.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:200;display:flex;align-items:center;justify-content:center';
      v.innerHTML = '<img src="' + im.src + '" style="max-width:100%;max-height:100%">'; v.onclick = function () { v.remove(); };
      document.body.appendChild(v);
    };
    badge();
  }

  A.openChat = openChat;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  setTimeout(poll, 3000);
  setInterval(function () { if (!document.hidden && !C.open) poll(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
})();
