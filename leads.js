/* E10K app: real estate follow-up prompt.
 * For owners, "Done" on a Real Estate task asks how it went, which lead, how hot, and when to follow up.
 * Hooks into app.js through window.E10K.onDone. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc;
  var TEMPS = ['Hot', 'Warm', 'Cold', 'Nurture'];
  var WHEN = [['none', 'No'], ['1', 'Tomorrow'], ['3', '3 days'], ['7', '1 week'], ['14', '2 weeks'], ['30', '1 month'], ['90', '3 months'], ['pick', 'Pick date']];

  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d; }
  function us(d) { return ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2) + '/' + d.getFullYear(); }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  var STOP = {the: 1, and: 1, for: 1, with: 1, team: 1, buyer: 1, seller: 1, lead: 1, web: 1, sale: 1, land: 1, ranch: 1, about: 1, from: 1};
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2 && !STOP[w]; }); }

  /** Best-guess lead for a task: its saved Lead ID, else name matching. */
  function guessLead(t, leads) {
    if (t.lead) return t.lead;
    var hay = ' ' + words(t.job + ' ' + t.task + ' ' + t.notes).join(' ') + ' ';
    var best = '', score = 0;
    leads.forEach(function (l) {
      var s = 0;
      words(l.contact).forEach(function (w) { if (hay.indexOf(' ' + w + ' ') >= 0) s += 3; });
      words(l.name).forEach(function (w) { if (hay.indexOf(' ' + w + ' ') >= 0) s += 1; });
      if (s > score) { score = s; best = l.id; }
    });
    return score >= 3 ? best : '';
  }

  function prompt(t, pre) {
    pre = pre || {};
    var D = A.S.data, leads = (D.leads || []).filter(function (l) { return ['Closed', 'Lost'].indexOf(l.stage) < 0 || l.id === t.lead; });
    var cad = D.cadence || {Hot: 3, Warm: 7, Cold: 30, Nurture: 90};
    var stages = (D.crm && D.crm.stages) || [], kinds = (D.crm && D.crm.activity) || ['Call', 'Text', 'Email', 'Note'];
    var leadId = guessLead(t, leads);
    var lead = function () { return leads.filter(function (l) { return l.id === $('#fu-lead').value; })[0]; };
    var st = {temp: '', when: 'none', how: pre.how || 'Call'};

    var html = '<h2>Done \u2013 follow up?</h2><div class="kv">' + esc(t.task) + '</div>' +
      '<div id="fu-mailbox" style="margin:8px 0"><button class="btn" data-act="mail" style="width:100%">\u2709 Email them first</button></div>' +
      '<label>How did it go?</label><textarea id="fu-out" style="min-height:70px" placeholder="Tap the mic: talked to her, wants to see it Saturday\u2026">' + esc(pre.outcome || '') + '</textarea>' +
      '<label>How</label><div class="chips" id="fu-how">' + kinds.map(function (k) {
        return '<button class="chip' + (k === st.how ? ' on' : '') + '" data-how="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
      '<label>Lead</label><select id="fu-lead"><option value="">(not a lead)</option>' + leads.map(function (l) {
        return '<option value="' + esc(l.id) + '"' + (l.id === leadId ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select>' +
      '<div id="fu-leadbox">' +
      '<label>How hot?</label><div class="chips" id="fu-temp">' + TEMPS.map(function (x) {
        return '<button class="chip" data-temp="' + x + '">' + x + (cad[x] ? ' <span style="opacity:.6">(' + (cad[x] < 30 ? cad[x] + 'd' : Math.round(cad[x] / 30) + 'mo') + ')</span>' : '') + '</button>'; }).join('') + '</div>' +
      '<label>Stage</label><select id="fu-stage"><option value="">(no change)</option>' + stages.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
      '</div>' +
      '<label>Follow up again?</label><div class="chips" id="fu-when" style="flex-wrap:wrap">' + WHEN.map(function (w) {
        return '<button class="chip" data-when="' + w[0] + '">' + w[1] + '</button>'; }).join('') + '</div>' +
      '<input type="date" id="fu-date" style="display:none;margin-top:8px">' +
      '<div id="fu-nextbox" style="display:none"><label>Next step</label><input id="fu-next"></div>' +
      '<div class="sub" id="fu-sum" style="margin-top:10px"></div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn ok" data-act="save">Done</button></div>';

    A.sheet(html, function (act) {
      if (act === 'mail') {
        var l0 = lead(); if (!l0) return A.toast('Pick the lead first');
        return emailForm(l0, t, function (sent) {
          prompt(t, sent ? {how: 'Email', outcome: 'Emailed: ' + sent.subject} : {});
        });
      }
      if (act !== 'save') return A.closeSheet();
      var when = '';
      if (st.when === 'pick') { var v = $('#fu-date').value; if (!v) return A.toast('Pick the follow-up date'); var p = v.split('-'); when = p[1] + '/' + p[2] + '/' + p[0]; }
      else if (st.when !== 'none') when = us(addDays(+st.when));
      var f = {id: t.id, outcome: $('#fu-out').value.trim(), lead: $('#fu-lead').value, temp: $('#fu-lead').value ? st.temp : '',
        stage: $('#fu-lead').value ? $('#fu-stage').value : '', when: when, next: $('#fu-next').value.trim(), how: st.how};
      // optimistic update
      t.status = 'Done'; t.completed = A.todayStr();
      if (f.outcome) t.notes = (t.notes ? t.notes + ' | ' : '') + A.todayStr() + ' ' + A.me().name + ': ' + f.outcome;
      var tempId = 'new-' + A.uid();
      if (when) D.tasks.push({id: tempId, entity: 'Real Estate', job: t.job, phase: t.phase || 'Lead', task: f.next || defaultNext(),
        owner: t.owner, priority: f.temp === 'Hot' ? 'High' : 'Medium', status: 'Not Started', due: when, added: A.todayStr(), notes: '', lead: f.lead});
      var l = lead();
      if (l) { l.last = A.todayStr(); if (f.temp) l.temp = f.temp; if (f.stage) l.stage = f.stage; l.nextDate = when; }
      A.enqueue('task.followup', {fields: f, tempId: when ? tempId : undefined});
      A.save(); A.closeSheet(); A.render();
      A.toast(when ? 'Done \u2013 follow-up set for ' + when.slice(0, 5) : 'Done \u2713');
    });

    function defaultNext() { var l = lead(); return 'Follow up with ' + (l ? (l.contact || l.name) : (t.job || 'them')); }
    function pickWhen(k) {
      st.when = k;
      Array.prototype.forEach.call(document.querySelectorAll('#fu-when [data-when]'), function (b) { b.classList.toggle('on', b.getAttribute('data-when') === k); });
      $('#fu-date').style.display = k === 'pick' ? 'block' : 'none';
      $('#fu-nextbox').style.display = k === 'none' ? 'none' : 'block';
      if (k !== 'none' && !$('#fu-next').value) $('#fu-next').value = defaultNext();
      summary();
    }
    function pickTemp(x, auto) {
      st.temp = x;
      Array.prototype.forEach.call(document.querySelectorAll('#fu-temp [data-temp]'), function (b) { b.classList.toggle('on', b.getAttribute('data-temp') === x); });
      if (!auto && cad[x]) pickWhen(String(cad[x]) === '90' ? '90' : String(cad[x]));
    }
    function syncLead() {
      var l = lead();
      $('#fu-leadbox').style.display = l ? 'block' : 'none';
      $('#fu-mailbox').style.display = l ? 'block' : 'none';
      if (l) { pickTemp(l.temp || 'Warm', true); if (st.when === 'none' && cad[st.temp]) pickWhen(String(cad[st.temp])); }
      if ($('#fu-next').value.indexOf('Follow up with') === 0) $('#fu-next').value = defaultNext();
      summary();
    }
    function summary() {
      var s = st.when === 'none' ? 'No new follow-up. This task just closes.' :
        st.when === 'pick' ? 'A follow-up task will be added on the date you pick.' :
        'A follow-up task will show on ' + us(addDays(+st.when)).slice(0, 5) + '.';
      $('#fu-sum').textContent = s;
    }
    document.getElementById('fu-when').onclick = function (e) { var b = e.target.closest('[data-when]'); if (b) { e.stopPropagation(); pickWhen(b.getAttribute('data-when')); } };
    document.getElementById('fu-temp').onclick = function (e) { var b = e.target.closest('[data-temp]'); if (b) { e.stopPropagation(); pickTemp(b.getAttribute('data-temp')); } };
    document.getElementById('fu-how').onclick = function (e) {
      var b = e.target.closest('[data-how]'); if (!b) return; e.stopPropagation(); st.how = b.getAttribute('data-how');
      Array.prototype.forEach.call(document.querySelectorAll('#fu-how [data-how]'), function (x) { x.classList.toggle('on', x === b); });
    };
    $('#fu-lead').onchange = syncLead;
    syncLead();
    if (!lead()) pickWhen('none');
  }

  // ---------- email a lead ----------
  function parseDraft(d) {
    var m = String(d || '').match(/^\s*Subject:\s*(.*)\n+([\s\S]*)$/i);
    return m ? {subject: m[1].trim(), body: m[2].trim()} : {subject: '', body: String(d || '').trim()};
  }
  function firstName(l) {
    var c = String(l.contact || l.name || '').replace(/\(.*?\)/g, '').trim();
    if (c.indexOf('&') > 0) return c.split(/\s+/).filter(function (w, i, a) { return i < a.length - 1 || a.length < 3; }).join(' ').replace(/\s*&\s*/, ' and ');
    return c.split(/\s+/)[0] || 'there';
  }
  function fallback(l) {
    var body = 'Hi ' + firstName(l) + ',\n\nJust checking in' + (l.next && !/^follow up/i.test(l.next) ? ' about ' + l.next.charAt(0).toLowerCase() + l.next.slice(1) : '') +
      '. Let me know if you have any questions or if there\'s anything I can help with.\n\nThanks,';
    return {subject: 'Checking in', body: body};
  }

  function emailForm(l, t, after) {
    var D = A.S.data, all = D.reSenders || {};
    var who = (l.from && all[l.from]) ? l.from : A.me().name;
    var snd = all[who] || D.reSender || {name: A.me().name, sig: A.me().name};
    var d = l.draft ? parseDraft(l.draft) : fallback(l);
    var body = d.body + '\n' + snd.sig;
    var names = Object.keys(all);
    var html = '<h2>Email ' + esc(firstName(l)) + '</h2><div class="kv">' + esc(l.name) + (l.stage ? ' \u00b7 ' + esc(l.stage) : '') + '</div>' +
      (l.draft ? '<div class="sub">Sam wrote this draft from the lead\'s history. Edit anything.</div>' : '<div class="sub">Quick check-in draft. Edit anything.</div>') +
      (names.length > 1 ? '<label>From</label><div class="chips" id="le-from">' + names.map(function (n) {
        return '<button class="chip' + (n === who ? ' on' : '') + '" data-from="' + esc(n) + '">' + esc(all[n].name) + '</button>'; }).join('') + '</div>' : '') +
      '<label>To</label><input id="le-to" type="email" value="' + esc(l.email || '') + '" placeholder="their@email.com">' +
      (l.email ? '' : '<div class="sub">No email on file yet. It will be saved to their contact after you send.</div>') +
      '<label>Subject</label><input id="le-sub" value="' + esc(d.subject) + '">' +
      '<label>Message</label><textarea id="le-body" style="min-height:300px">' + esc(body) + '</textarea>' +
      '<div class="sub" style="margin-top:8px" id="le-how"></div>' +
      '<div class="btns"><button class="btn" data-act="back">Back</button>' + (A.me().name === 'Spencer' ? '<button class="btn" data-act="mailto">My email</button>' : '') + '<button class="btn ok" data-act="send">Send</button></div>';
    A.sheet(html, function (act) {
      if (act === 'back') return after ? after(null) : A.closeSheet();
      var to = $('#le-to').value.trim(), sub = $('#le-sub').value.trim(), b = $('#le-body').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+/.test(to)) return A.toast('Enter their email');
      if (act === 'mailto') {
        location.href = 'mailto:' + encodeURIComponent(to).replace(/%2C/g, ',') + '?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(b);
        return setTimeout(function () { askLogged(l, to, sub, b, after, who); }, 600);
      }
      if (act !== 'send') return;
      if (!navigator.onLine) return A.toast('Needs a signal to send');
      var btn = document.querySelector('#sheet [data-act=send]'); btn.disabled = true; btn.textContent = 'Sending\u2026';
      A.api('lead.email', {fields: {lead: l.id, to: to, subject: sub, body: b, from: who}}).then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = 'Send'; return A.toast(r.error === 'bad_email' ? 'That email doesn\'t look right' : 'Didn\'t send \u2013 try again'); }
        l.last = r.sent; if (!l.email) l.email = to; A.save();
        A.toast('Sent to ' + to);
        if (after) after({subject: sub}); else A.closeSheet();
      }).catch(function () { btn.disabled = false; btn.textContent = 'Send'; A.toast('No signal \u2013 try again'); });
    });
    function how() {
      $('#le-how').innerHTML = '<b>Send</b>: goes out as ' + esc(snd.name) + ' (the broker); replies and a copy go to ' + esc(snd.reply || 'him') + '.' +
        (A.me().name === 'Spencer' ? ' <b>My email</b>: opens it in your own email app, then asks if you sent it so it still gets logged.' : '');
    }
    how();
    var fr = document.getElementById('le-from');
    if (fr) fr.onclick = function (e) {
      var b = e.target.closest('[data-from]'); if (!b) return; e.stopPropagation();
      var nw = b.getAttribute('data-from'); if (nw === who) return;
      var ta = $('#le-body'), old = snd.sig;
      who = nw; snd = all[nw];
      if (ta.value.indexOf(old) >= 0) ta.value = ta.value.replace(old, snd.sig);
      Array.prototype.forEach.call(fr.querySelectorAll('[data-from]'), function (x) { x.classList.toggle('on', x === b); });
      how();
    };
  }

  function askLogged(l, to, sub, b, after, who) {
    A.sheet('<h2>Did you send it?</h2><div class="kv">To ' + esc(to) + '<br>' + esc(sub) + '</div>' +
      '<div class="sub">Tap Yes once it\'s sent from your email and it gets logged on ' + esc(firstName(l)) + '\'s lead.</div>' +
      '<div class="btns"><button class="btn" data-act="no">Not sent</button><button class="btn ok" data-act="yes">Yes, log it</button></div>', function (act) {
      if (act !== 'yes') return after ? after(null) : A.closeSheet();
      A.enqueue('lead.email', {fields: {lead: l.id, to: to, subject: sub, body: b, logOnly: true, from: who}});
      l.last = A.todayStr(); if (!l.email) l.email = to; A.save();
      A.toast('Logged');
      if (after) after({subject: sub}); else A.closeSheet();
    });
  }

  function leadOf(t) {
    var D = A.S.data; if (!D || !D.leads) return null;
    var id = guessLead(t, D.leads);
    return D.leads.filter(function (l) { return l.id === id; })[0] || null;
  }
  A.taskExtra = function (t) {
    if (!A.me().owner || t.entity !== 'Real Estate') return '';
    var l = leadOf(t); if (!l) return '';
    return '<div class="btns"><button class="btn" data-act="email" style="width:100%">\u2709 Email ' + esc(firstName(l)) + '</button></div>';
  };
  A.onEmail = function (t) { var l = leadOf(t); if (l) emailForm(l, t, null); };

  A.onDone = function (t) {
    if (!A.me().owner || t.entity !== 'Real Estate') return false;
    prompt(t);
    return true;
  };
})();
