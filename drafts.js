/* E10K app: "Sam Drafts" (owners only, 11/23/2026). Sam writes email drafts; Spencer or Hanna read the whole email,
 * edit anything, then tap Approve & send (sent once, from Sam's account, logged in the Hub) or Reject.
 * A card on My tasks shows how many are waiting. Phone alerts open it with #task=DRAFTS. Crew never get this. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast;
  var Q = {drafts: A.ls.get('drafts', []), recent: [], busy: null, last: 0};

  function owner() { var m = A.me && A.me(); return !!(m && m.owner); }
  function load(force) {
    if (!owner() || !navigator.onLine) return Promise.resolve();
    if (Q.busy) return Q.busy;
    if (!force && Date.now() - Q.last < 60000) return Promise.resolve();
    return (Q.busy = A.api('draft.list', {}).then(function (r) {
      Q.busy = null; Q.last = Date.now();
      if (!r || !r.ok) return;
      var before = JSON.stringify(Q.drafts.map(function (d) { return d.id; }));
      Q.drafts = r.drafts || []; Q.recent = r.recent || []; A.ls.set('drafts', Q.drafts);
      if (before !== JSON.stringify(Q.drafts.map(function (d) { return d.id; })) && A.S.tab === 'mine' && document.getElementById('sheet').classList.contains('hidden')) A.render();
    }).catch(function () { Q.busy = null; }));
  }

  A.draftsCard = function () {
    if (!owner() || !Q.drafts.length) return '';
    var n = Q.drafts.length;
    return '<div class="card tap brief" data-drafts="open"><div class="row"><div class="grow"><div class="title">\u2709\ufe0f ' +
      n + ' email draft' + (n > 1 ? 's' : '') + ' from Sam</div><div class="sub">' +
      esc(Q.drafts.slice(0, 3).map(function (d) { return d.subject; }).join(' \u00b7 ')) + '</div></div><span class="pill late">Needs your OK</span></div></div>';
  };

  function listHtml() {
    var h = '<h2>Email drafts from Sam</h2><div class="sub">Nothing is sent until you open a draft and tap Approve &amp; send.</div>';
    if (!Q.drafts.length) h += '<div class="empty">No drafts waiting.</div>';
    Q.drafts.forEach(function (d) {
      h += '<div class="card tap" data-act="pick:' + esc(d.id) + '"><div class="title">' + esc(d.subject) + '</div>' +
        '<div class="sub">To ' + esc(d.to) + (d.files.length ? ' \u00b7 \ud83d\udcce ' + d.files.length : '') + '</div>' +
        (d.why ? '<div class="sub">' + esc(d.why) + '</div>' : '') + '</div>';
    });
    if (Q.recent.length) {
      h += '<h3>Recent</h3>';
      Q.recent.slice(0, 5).forEach(function (d) {
        h += '<div class="sub">' + esc(d.status) + ' \u00b7 ' + esc(d.subject) + (d.decidedBy ? ' \u00b7 ' + esc(d.decidedBy) + ' ' + esc(d.decidedAt) : '') + '</div>';
      });
    }
    return h + '<div class="btns"><button class="btn primary" data-act="x">Close</button></div>';
  }
  function openList(thenId) {
    A.sheet(listHtml(), function (act) {
      if (act.indexOf('pick:') === 0) { var d = find(act.slice(5)); if (d) return openDraft(d); return; }
      A.closeSheet();
    });
    load(true).then(function () {
      if (document.getElementById('dr-body') || $('#sheet').classList.contains('hidden')) return;   // already moved on
      var n = thenId ? find(thenId) : null; if (n) return openDraft(n);
      var b = document.getElementById('sheet-body'); if (b && /Email drafts from Sam/.test(b.innerHTML)) b.innerHTML = listHtml();
    });
  }
  function find(id) { return Q.drafts.filter(function (d) { return d.id === id; })[0] || null; }

  function openDraft(d) {
    var html = '<h2>Draft for your OK</h2>' +
      '<div class="kv">Goes out as <b>' + esc(d.sendAs) + '</b>. ' + esc(d.replyNote) + '</div>' +
      (d.why ? '<div class="sub">Why: ' + esc(d.why) + '</div>' : '') +
      '<label>To</label><input id="dr-to" type="email" value="' + esc(d.to) + '">' +
      '<label>Cc</label><input id="dr-cc" type="email" value="' + esc(d.cc) + '" placeholder="(none)">' +
      '<label>Subject</label><input id="dr-sub" value="' + esc(d.subject) + '">' +
      '<label>Message</label><textarea id="dr-body" style="min-height:320px">' + esc(d.body) + '</textarea>' +
      (d.files.length ? '<label>Attachments</label>' + d.files.map(function (f) {
        return '<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" class="dr-file" data-file="' + esc(f.id) + '" checked style="width:auto">' + esc(f.name) + '</label>';
      }).join('') : '') +
      '<div class="sub" style="margin-top:8px">Edit anything above. What you see is exactly what gets sent.</div>' +
      '<div class="btns"><button class="btn" data-act="back">Back</button><button class="btn" data-act="reject">Reject</button><button class="btn ok" data-act="send">Approve &amp; send</button></div>';
    A.sheet(html, function (act) {
      if (act === 'back') return openList();
      if (act === 'reject') return rejectForm(d);
      if (act !== 'send') return;
      var f = read(d);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+/.test(f.to)) return toast('Enter who it goes to');
      if (!f.subject.trim()) return toast('Add a subject');
      confirmSend(d, f);
    });
  }
  function read(d) {
    var drop = [];
    Array.prototype.forEach.call(document.querySelectorAll('#sheet .dr-file'), function (c) { if (!c.checked) drop.push(c.getAttribute('data-file')); });
    d.to = $('#dr-to').value.trim(); d.cc = $('#dr-cc').value.trim(); d.subject = $('#dr-sub').value; d.body = $('#dr-body').value; d.drop = drop;
    return {id: d.id, to: d.to, cc: d.cc, subject: d.subject, body: d.body, drop: drop};
  }
  function confirmSend(d, f) {
    var n = d.files.length - f.drop.length;
    A.sheet('<h2>Send it now?</h2><div class="kv">To <b>' + esc(f.to) + '</b>' + (f.cc ? '<br>Cc ' + esc(f.cc) : '') + '<br>' + esc(f.subject) +
      (n ? '<br>\ud83d\udcce ' + n + ' attachment' + (n > 1 ? 's' : '') : '') + '</div><div class="sub">Goes out as ' + esc(d.sendAs) + '.</div>' +
      '<div class="btns"><button class="btn" data-act="back">Back</button><button class="btn ok" data-act="go">Send now</button></div>', function (act) {
      if (act === 'back') return openDraft(d);
      if (act !== 'go') return;
      if (!navigator.onLine) return toast('Needs a signal to send');
      var btn = document.querySelector('#sheet [data-act=go]'); btn.disabled = true; btn.textContent = 'Sending\u2026';
      A.api('draft.send', {fields: f}).then(function (r) {
        if (!r || !r.ok) {
          btn.disabled = false; btn.textContent = 'Send now';
          var why = {bad_email: 'An email address doesn\'t look right', bad_cc: 'A Cc address doesn\'t look right', too_many: 'Too many recipients (10 max)',
            no_subject: 'Add a subject', no_body: 'The message is empty', attachment_missing: 'An attachment is missing: ' + (r && r.file || ''),
            attachments_too_big: 'Attachments are over 20 MB', already_sent: 'This draft was already sent', not_waiting: 'Already handled',
            check_sent: 'An earlier try may have sent it. Ask Sam to check', not_found: 'Draft not found', send_failed: 'Gmail refused it. Try again later'}[r && r.error];
          return toast(why || 'Didn\'t send. Try again');
        }
        Q.drafts = Q.drafts.filter(function (x) { return x.id !== d.id; }); A.ls.set('drafts', Q.drafts);
        toast(r.duplicate ? 'Already sent' : 'Sent to ' + r.to);
        A.closeSheet(); A.render(); load(true);
      }).catch(function () { btn.disabled = false; btn.textContent = 'Send now'; toast('No signal. Try again'); });
    });
  }
  function rejectForm(d) {
    A.sheet('<h2>Reject this draft?</h2><div class="kv">' + esc(d.subject) + '</div>' +
      '<label>Note for Sam (optional)</label><textarea id="dr-note" placeholder="What should change?"></textarea>' +
      '<div class="sub">Nothing gets sent.</div>' +
      '<div class="btns"><button class="btn" data-act="back">Back</button><button class="btn" data-act="go">Reject</button></div>', function (act) {
      if (act === 'back') return openDraft(d);
      if (act !== 'go') return;
      if (!navigator.onLine) return toast('Needs a signal');
      A.api('draft.reject', {fields: {id: d.id, note: $('#dr-note').value}}).then(function (r) {
        if (!r || !r.ok) return toast(r && r.error === 'not_waiting' ? 'Already handled' : 'Didn\'t save. Try again');
        Q.drafts = Q.drafts.filter(function (x) { return x.id !== d.id; }); A.ls.set('drafts', Q.drafts);
        toast('Rejected'); A.closeSheet(); A.render(); load(true);
      }).catch(function () { toast('No signal. Try again'); });
    });
  }

  A.openDrafts = function (id) {
    if (!owner()) return;
    var d = id ? find(id) : null;
    if (d) return openDraft(d);
    openList(id);   // refreshes itself; jumps into the draft if it just arrived
  };
  document.addEventListener('click', function (e) { if (e.target.closest('[data-drafts]')) openList(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(false); });
  setInterval(function () { if (!document.hidden) load(false); }, 120000);
  setTimeout(function () { load(true); }, 1500);
})();
