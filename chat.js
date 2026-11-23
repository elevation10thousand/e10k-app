/* E10K app: chats (Spencer 11/22): Everyone plus private chats (Spencer & Hanna; each crew member with Spencer & Hanna).
   Header button with unread count; list of chats; full-screen chat; photos; pings only that chat's people. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var C = {msgs: ls.get('chat', []), open: false, cur: null, timer: null, photos: {}, reads: ls.get('chatReads2', {}),
    chats: ls.get('chatList', [{key: 'team', name: 'Everyone'}])};
  C.msgs.forEach(function (m) { if (!m.chat) m.chat = 'team'; });
  var SEEN = ls.get('chatSeen2', null);
  if (!SEEN) { SEEN = {team: ls.get('chatSeen', 0)}; ls.set('chatSeen2', SEEN); }   // older phones: one Everyone board

  function inChat(k) { return C.msgs.filter(function (m) { return (m.chat || 'team') === k; }); }
  function last(k) { var l = inChat(k || C.cur || 'team').filter(function (m) { return !m.pending; }); return l.length ? l[l.length - 1].ms || 0 : 0; }
  function markSeen(k) { if (!k) return; SEEN[k] = Math.max(SEEN[k] || 0, last(k)); ls.set('chatSeen2', SEEN); }
  function unread(k) {
    var me = A.me() && A.me().name, keys = k ? [k] : C.chats.map(function (c) { return c.key; });
    return C.msgs.filter(function (m) { var ck = m.chat || 'team'; return keys.indexOf(ck) >= 0 && (m.ms || 0) > (SEEN[ck] || 0) && m.from !== me; }).length;
  }
  function chatInfo(k) { return C.chats.filter(function (c) { return c.key === k; })[0] || {key: k, name: k === 'team' ? 'Everyone' : k, members: []}; }
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
    C.msgs.forEach(function (m) { if (!m.chat) m.chat = 'team'; });
    C.msgs.sort(function (a, b) { return (a.ms || 9e15) - (b.ms || 9e15); });
    var keep = [], per = {};   // newest 300 per chat
    for (var i = C.msgs.length - 1; i >= 0; i--) { var k = C.msgs[i].chat; per[k] = (per[k] || 0) + 1; if (per[k] <= 300) keep.unshift(C.msgs[i]); }
    C.msgs = keep;
    ls.set('chat', C.msgs.filter(function (m) { return !m.pending; }));
    return added;
  }
  function poll() {
    if (!navigator.onLine || !A.S.data) return Promise.resolve();
    var since = {}; C.chats.forEach(function (c) { since[c.key] = last(c.key); });
    var q = {since: since}; if (C.open && C.cur && document.visibilityState !== 'hidden') { q.seen = {}; q.seen[C.cur] = last(C.cur); }
    return A.api('chat.list', q).then(function (r) {
      if (!r.ok) return;
      if (r.chats) {   // the chats this person is in (server decides)
        var ch = JSON.stringify(r.chats) !== JSON.stringify(C.chats);
        C.chats = r.chats; ls.set('chatList', C.chats);
        C.msgs = C.msgs.filter(function (m) { return m.pending || r.chats.some(function (c) { return c.key === m.chat; }); });
        if (ch && C.open && !C.cur) drawList();
      }
      if (r.reads && !C.hasReads) { C.hasReads = true; ls.set('chatHasReads', 1); }
      var reads = r.chats ? r.reads : {team: r.reads || {}};   // old server: Everyone only
      var rc = reads && JSON.stringify(reads) !== JSON.stringify(C.reads);
      if (rc) { C.reads = reads; ls.set('chatReads2', C.reads); }
      var added = merge(r.messages);
      if (C.open && C.cur) { if (added) draw(true); else if (rc) draw(false); markSeen(C.cur); }
      else if (C.open && added) drawList();
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
    if (!C.cur) return drawList();
    var me = A.me().name, lastDay = '', html = '', lastMine = null, msgs = inChat(C.cur);
    msgs.forEach(function (m) { if (m.from === me && !m.pending) lastMine = m; });
    if (!msgs.length) html = '<div class="empty">No messages yet. Say hi \ud83d\udc4b' + (C.cur !== 'team' ? '<div class="sub" style="margin-top:6px">Only ' + esc(chatInfo(C.cur).members.join(', ')) + ' can see this chat.</div>' : '') + '</div>';
    msgs.forEach(function (m) {
      var d = dayLabel(m.when); if (d && d !== lastDay) { html += '<div class="cday">' + esc(d === A.todayStr() ? 'Today' : d) + '</div>'; lastDay = d; }
      var mine = m.from === me;
      html += '<div class="cmsg' + (mine ? ' mine' : '') + '">' + (mine ? '' : '<div class="cfrom">' + esc(m.from) + '</div>') +
        (m.photo ? '<div class="cph" data-cph="' + esc(m.id) + '">' + (C.photos[m.id] ? '<img src="' + C.photos[m.id] + '">' : (m.localPhoto ? '<img src="' + m.localPhoto + '">' : '\ud83d\udcf7 Loading photo\u2026')) + '</div>' : '') +
        (m.text ? '<div class="ctext">' + esc(m.text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>') + '</div>' : '') +
        '<div class="ctime">' + (m.pending ? 'sending\u2026' : esc(timeLabel(m.when))) + '</div></div>' + (m === lastMine ? seenLine(m) : '');
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

  // "Seen by" under your newest message (Spencer 11/16). Seen = opened the chat after it arrived.
  function seenLine(m) {
    var me = A.me().name, info = chatInfo(C.cur || 'team');
    var people = ((info.members && info.members.length) ? info.members : ((A.S.data && A.S.data.people) || [])).filter(function (p) { return p && p !== me; });
    if (!people.length || !m.ms || !(C.hasReads || ls.get('chatHasReads', 0))) return '';   // server not updated yet
    var rd = C.reads[C.cur || 'team'] || {};
    var yes = people.filter(function (p) { return (rd[p] || 0) >= m.ms; }), no = people.filter(function (p) { return yes.indexOf(p) < 0; });
    var t = !yes.length ? 'Not seen yet' : (no.length ? 'Seen by ' + yes.join(', ') + ' \u00b7 ' + no.join(', ') + (no.length === 1 ? ' hasn\u2019t' : ' haven\u2019t') + ' seen it' : (people.length === 1 ? '\u2713 Seen' : '\u2713 Seen by everyone'));
    return '<div class="cseen">' + esc(t) + '</div>';
  }
  // list of chats (only when the person is in more than one)
  function drawList() {
    var box = document.getElementById('chat-list'); if (!box) return;
    setHead('Messages', ''); document.getElementById('chat-bar').style.display = 'none';
    var me = A.me().name;
    box.innerHTML = C.chats.map(function (c) {
      var l = inChat(c.key).filter(function (m) { return !m.pending; }), m = l[l.length - 1], n = unread(c.key);
      var who = c.key === 'team' ? 'Everyone on the team' : 'Private \u00b7 ' + (c.members || []).filter(function (p) { return p !== me; }).join(', ') + ' + you';
      return '<div class="card tap" data-chat="' + esc(c.key) + '" style="display:flex;align-items:center;gap:10px;padding:12px 14px;margin:8px 10px">' +
        '<div style="font-size:22px">' + (c.key === 'team' ? '\ud83d\udc65' : '\ud83d\udd12') + '</div><div class="grow" style="min-width:0">' +
        '<div><b>' + esc(c.name) + '</b></div><div class="sub">' + esc(who) + '</div>' +
        (m ? '<div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc((m.from === me ? 'You' : m.from) + ': ' + (m.text || '\ud83d\udcf7 Photo')) + '</div>' : '') + '</div>' +
        (n ? '<span class="cbadge" style="display:block;position:static">' + (n > 9 ? '9+' : n) + '</span>' : '') + '</div>';
    }).join('');
  }
  function setHead(title, sub) {
    document.getElementById('chat-title').textContent = title;
    document.getElementById('chat-sub').textContent = sub;
  }
  function showChat(k) {
    C.cur = k; var info = chatInfo(k), me = A.me().name;
    setHead(info.name, k === 'team' ? (info.members && info.members.length ? info.members.join(' \u00b7 ') : 'Everyone') : '\ud83d\udd12 ' + (info.members || []).join(' \u00b7 '));
    document.getElementById('chat-bar').style.display = '';
    document.getElementById('chat-text').placeholder = k === 'team' ? 'Message everyone\u2026' : 'Message ' + info.name + '\u2026';
    draw(true); markSeen(k); badge(); poll();
  }
  function openChat(key) {
    var panel = document.getElementById('chat-panel');
    if (!C.open) {
      panel.classList.remove('hidden'); document.body.style.overflow = 'hidden'; C.open = true;
      try { history.pushState({e10k: 1, tab: A.S.tab, chat: 1}, ''); } catch (e) {}
      clearInterval(C.timer); C.timer = setInterval(poll, 6000);
    }
    if (typeof key !== 'string') key = '';
    if (!key && C.chats.length < 2) key = 'team';
    if (key) {
      if (C.chats.length > 1) try { history.pushState({e10k: 1, tab: A.S.tab, chat: 2}, ''); } catch (e) {}
      showChat(key);
    } else { C.cur = null; drawList(); badge(); poll(); }
  }
  function closeChat(fromPop) {
    var panel = document.getElementById('chat-panel'); if (panel.classList.contains('hidden')) return;
    if (C.cur) markSeen(C.cur);
    panel.classList.add('hidden'); document.body.style.overflow = ''; C.open = false; C.cur = null; clearInterval(C.timer);
    badge();
    if (!fromPop && history.state && history.state.chat) history.go(history.state.chat === 2 ? -2 : -1);
  }
  function back() {   // header arrow: chat -> list -> closed
    if (C.cur && C.chats.length > 1) { markSeen(C.cur); if (history.state && history.state.chat === 2) history.back(); else { C.cur = null; drawList(); badge(); } }
    else closeChat(false);
  }
  window.addEventListener('popstate', function (e) {
    if (!C.open) return;
    var st = e.state || {};
    if (st.chat === 1 && C.cur) { markSeen(C.cur); C.cur = null; drawList(); badge(); }
    else if (!st.chat) closeChat(true);
  });

  var pendingPhoto = null;
  function send() {
    var ta = document.getElementById('chat-text'), text = ta.value.trim();
    if (!text && !pendingPhoto) return;
    var k = C.cur || 'team';
    var cid = A.uid(), msg = {id: 'M-' + cid.slice(0, 8), from: A.me().name, text: text, when: '', ms: 0, pending: true, photo: pendingPhoto ? 1 : 0, localPhoto: pendingPhoto, chat: k};
    C.msgs.push(msg); draw(true);
    var f = {text: text, clientId: cid}; if (k !== 'team') f.chat = k; if (pendingPhoto) f.photo = {data: pendingPhoto};
    ta.value = ''; ta.style.height = ''; pendingPhoto = null; document.getElementById('chat-prev').innerHTML = '';
    A.api('chat.send', {fields: f}).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      if (r.message) { if (msg.localPhoto) C.photos[r.message.id] = msg.localPhoto; merge([r.message]); }
      draw(true); markSeen(k);
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
      '<div class="chat-head"><button class="hbtn" id="chat-close" aria-label="Back">\u2190</button><div class="chat-title" id="chat-title">Messages</div>' +
      '<div class="sub" id="chat-sub" style="margin-left:auto;margin-right:12px;text-align:right"></div></div>' +
      '<div id="chat-list" class="chat-list"></div>' +
      '<div id="chat-prev" class="chat-prev"></div>' +
      '<div class="chat-bar" id="chat-bar"><label class="hbtn" for="chat-ph" aria-label="Photo">\ud83d\udcf7</label><input type="file" id="chat-ph" accept="image/*" style="display:none">' +
      '<textarea id="chat-text" rows="1" placeholder="Message everyone\u2026"></textarea><button id="chat-send" class="btn primary">Send</button></div></div>');
    document.getElementById('chat-btn').onclick = function () { openChat(''); };
    document.getElementById('chat-close').onclick = back;
    document.getElementById('chat-send').onclick = send;
    var ta = document.getElementById('chat-text');
    ta.oninput = function () { ta.style.height = ''; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
    document.getElementById('chat-ph').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      A.shrink(file).then(function (d) { pendingPhoto = d; document.getElementById('chat-prev').innerHTML = '<img src="' + d + '"> <span class="sub">photo ready \u2013 tap Send</span>'; });
      e.target.value = '';
    };
    document.getElementById('chat-list').onclick = function (e) {
      var ch = e.target.closest('[data-chat]');
      if (ch) { try { history.pushState({e10k: 1, tab: A.S.tab, chat: 2}, ''); } catch (x) {} return showChat(ch.getAttribute('data-chat')); }
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
