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

  function prompt(t) {
    var D = A.S.data, leads = (D.leads || []).filter(function (l) { return ['Closed', 'Lost'].indexOf(l.stage) < 0 || l.id === t.lead; });
    var cad = D.cadence || {Hot: 3, Warm: 7, Cold: 30, Nurture: 90};
    var stages = (D.crm && D.crm.stages) || [], kinds = (D.crm && D.crm.activity) || ['Call', 'Text', 'Email', 'Note'];
    var leadId = guessLead(t, leads);
    var lead = function () { return leads.filter(function (l) { return l.id === $('#fu-lead').value; })[0]; };
    var st = {temp: '', when: 'none', how: 'Call'};

    var html = '<h2>Done \u2013 follow up?</h2><div class="kv">' + esc(t.task) + '</div>' +
      '<label>How did it go?</label><textarea id="fu-out" style="min-height:70px" placeholder="Tap the mic: talked to her, wants to see it Saturday\u2026"></textarea>' +
      '<label>How</label><div class="chips" id="fu-how">' + kinds.map(function (k) {
        return '<button class="chip' + (k === 'Call' ? ' on' : '') + '" data-how="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') + '</div>' +
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
      if (act !== 'save') return A.closeSheet();
      var when = '';
      if (st.when === 'pick') { var v = $('#fu-date').value; if (!v) return A.toast('Pick the follow-up date'); var p = v.split('-'); when = p[1] + '/' + p[2] + '/' + p[0]; }
      else if (st.when !== 'none') when = us(addDays(+st.when));
      var f = {id: t.id, outcome: $('#fu-out').value.trim(), lead: $('#fu-lead').value, temp: $('#fu-lead').value ? st.temp : '',
        stage: $('#fu-lead').value ? $('#fu-stage').value : '', when: when, next: $('#fu-next').value.trim(), how: st.how};
      // optimistic update
      t.status = 'Done'; t.completed = A.todayStr();
      if (f.outcome) t.notes = (t.notes ? t.notes + ' | ' : '') + A.todayStr() + ' ' + A.me().name + ': ' + f.outcome;
      if (when) D.tasks.push({id: 'new-' + A.uid(), entity: 'Real Estate', job: t.job, phase: t.phase || 'Lead', task: f.next || defaultNext(),
        owner: t.owner, priority: f.temp === 'Hot' ? 'High' : 'Medium', status: 'Not Started', due: when, added: A.todayStr(), notes: '', lead: f.lead});
      var l = lead();
      if (l) { l.last = A.todayStr(); if (f.temp) l.temp = f.temp; if (f.stage) l.stage = f.stage; l.nextDate = when; }
      A.enqueue('task.followup', {fields: f});
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

  A.onDone = function (t) {
    if (!A.me().owner || t.entity !== 'Real Estate') return false;
    prompt(t);
    return true;
  };
})();
