/* E10K app: MACHINE hours, kept apart from MAN hours (Spencer 11/06).
 * Anyone can start a machine (machine, job, who's running it) and anyone can close any running machine out with the
 * hour meter and who the operator was. Running machines show GREEN on the Hours and Equipment tabs, with a
 * "Machines still running" banner so whoever is on site at the end of the day closes them.
 * Loaded after app.js and equip.js; uses window.E10K. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, toast = A.toast;

  function open() { return (A.S.data && A.S.data.mlogOpen) || []; }
  function fmtH(n) { return n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(undefined, {maximumFractionDigits: 1}); }
  A.mlogOpenFor = function (machine) { return open().filter(function (l) { return l.machine === machine; })[0] || null; };
  function byId(id) { return open().filter(function (l) { return l.id === id; })[0] || null; }
  function since(l) {
    var at = String(l.startedAt || '');
    var t = at.match(/(\d{1,2}:\d{2}\s*[AP]M)/i) ? at.match(/(\d{1,2}:\d{2}\s*[AP]M)/i)[1].toUpperCase() : '';
    if (!t) { var hm = at.match(/(\d{1,2}):(\d{2})/); if (hm) t = ((+hm[1] % 12) || 12) + ':' + hm[2] + (+hm[1] < 12 ? ' AM' : ' PM'); }
    var d = String(l.date || at.split(' ')[0] || '');
    return (t ? t : '') + (d && d !== A.todayStr() ? ' on ' + A.shortD(d) : '');
  }
  function line(l) {
    return esc(l.job) + ' \u00b7 ' + esc(l.operator || '?') + ' running' + (l.meterStart ? ' \u00b7 from ' + esc(fmtH(l.meterStart)) : '') +
      ' \u00b7 started ' + esc(since(l)) + (l.startedBy && l.startedBy !== l.operator ? ' by ' + esc(l.startedBy) : '');
  }

  /** Green banner + start button (Hours and Equipment tabs). */
  A.mlogBanner = function (where) {
    var L = open(), html = '';
    if (L.length) {
      html += '<div class="card running"><div class="title">\ud83d\udfe2 Machines still running (' + L.length + ')</div>' +
        '<div class="sub">When a machine is done for the day, close it out with the hour meter \u2013 anyone can, and pick who ran it.</div>' +
        L.map(function (l) {
          return '<div class="row mlrow"><div class="grow"><div class="title" style="font-size:15px">' + esc(l.machine) + '</div><div class="sub">' + line(l) + '</div></div>' +
            '<button class="btn ok" data-ml="close" data-id="' + esc(l.id) + '">Close out</button></div>';
        }).join('') + '</div>';
    }
    html += '<button class="btn" data-ml="start" style="width:100%;margin-bottom:10px">\u2699 Start machine hours</button>';
    return html;
  };

  function people() { return (A.S.data && A.S.data.people) || []; }
  function opSelect(id, cur) { return '<select id="' + id + '">' + A.options(people(), cur || A.me().name) + '</select>'; }

  function startForm(machine) {
    var jobs = A.S.data.jobs.map(function (j) { return j.name; });
    var ms = (A.S.data.machines || []);
    var html = '<h2>Start machine hours</h2>' +
      '<label>Machine</label><select id="ml-m"><option value="">Pick machine</option>' + ms.map(function (m) {
        var run = A.mlogOpenFor(m.name), L = A.FLAGS[m.status];
        return '<option value="' + esc(m.name) + '"' + (m.name === machine ? ' selected' : '') + (run ? ' disabled' : '') + '>' +
          esc((L ? L.ic + ' ' : '') + m.name + (run ? ' (running)' : '')) + '</option>'; }).join('') + '</select>' +
      '<div class="sub" id="ml-warn" style="display:none;font-weight:600;margin-top:6px"></div>' +
      '<label>Job</label><select id="ml-j">' + A.options(jobs, A.ls.get('lastJob', ''), true) + '</select>' +
      '<label>Who\u2019s running it</label>' + opSelect('ml-op') +
      '<div id="ml-mbox"><label>Hour meter at start</label><input id="ml-ms" inputmode="decimal"><div class="sub" id="ml-hint"></div></div>' +
      '<label>Notes <span class="sub">(optional)</span></label><input id="ml-n">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Start</button></div>';
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      var name = $('#ml-m').value, job = $('#ml-j').value, op = $('#ml-op').value, mc = A.mach(name);
      if (!name) return toast('Pick the machine');
      if (!job) return toast('Pick the job');
      if (A.mlogOpenFor(name)) return toast(name + ' is already running \u2013 close it out first');
      var v = $('#ml-ms').value.trim();
      if (mc && mc.meter) {
        if (!v || isNaN(+v)) { $('#ml-ms').focus(); return toast('Enter the hour meter'); }
        if (mc.hours !== null && mc.hours !== undefined && +v < mc.hours && !confirm(name + ': ' + v + ' is lower than the last reading (' + mc.hours + '). Save anyway?')) return;
        if (mc.hours !== null && mc.hours !== undefined && +v > mc.hours + 300 && !confirm(name + ': that is ' + Math.round(+v - mc.hours) + ' hrs more than the last reading (' + mc.hours + '). Is that right?')) return;
      }
      var cid = A.uid();
      var f = {machine: name, job: job, operator: op, meterStart: mc && mc.meter ? v : '', notes: $('#ml-n').value.trim(), date: A.todayStr(), clientId: cid};
      (A.S.data.mlogOpen = A.S.data.mlogOpen || []).push({id: 'ML-' + cid.slice(0, 8), date: f.date, machine: name, job: job, operator: op,
        meterStart: f.meterStart, status: 'Open', startedBy: A.me().name, startedAt: A.to12(A.nowHM()), pending: true});
      if (mc && mc.meter && mc.hours !== null && mc.hours !== undefined && +v > mc.hours) mc.hours = +v;
      A.ls.set('lastJob', job);
      A.enqueue('mlog.start', {fields: f});
      A.save(); A.closeSheet(); A.render(); toast(name + ' started \u2013 it shows green until someone closes it out');
    });
    var wire = function () {
      var mc = A.mach($('#ml-m').value), box = $('#ml-mbox'), ms = $('#ml-ms'), w = $('#ml-warn');
      box.style.display = mc && mc.meter ? 'block' : 'none';
      var known = mc && mc.hours !== null && mc.hours !== undefined;
      if (known && (!ms.value || ms.getAttribute('data-auto') === '1')) { ms.value = mc.hours; ms.setAttribute('data-auto', '1'); }
      $('#ml-hint').textContent = known ? 'from last log' : (mc ? 'no hours on file yet \u2013 enter it' : '');
      var L = mc && A.FLAGS[mc.status];
      if (L) { w.style.display = 'block'; w.style.color = L.color; w.textContent = L.ic + ' ' + L.label + (mc.note ? ': ' + mc.note : ''); } else w.style.display = 'none';
    };
    $('#ml-m').onchange = wire; $('#ml-ms').oninput = function () { $('#ml-ms').setAttribute('data-auto', '0'); };
    wire();
  }

  function closeForm(l) {
    var mc = A.mach(l.machine) || {meter: true}, metered = mc.meter !== false;
    var html = '<h2>Close out ' + esc(l.machine) + '</h2><div class="kv">' + line(l) + '</div>' +
      '<label>Who ran it</label>' + opSelect('mc-op', l.operator) +
      (metered ? '<label>Hour meter now</label><input id="mc-me" inputmode="decimal" placeholder="' + (l.meterStart ? 'started at ' + esc(fmtH(l.meterStart)) : '') + '">'
        : '<label>Hours on it</label><input id="mc-h" inputmode="decimal" placeholder="e.g. 6.5">') +
      '<label>Notes <span class="sub">(optional)</span></label><input id="mc-n">' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn ok" data-act="save">Close out</button></div>' +
      '<div class="btns"><button class="btn" data-act="cancel" style="font-size:13px">Started by mistake? Cancel it</button></div>';
    A.sheet(html, function (act) {
      if (act === 'cancel') {
        if (!confirm('Cancel this machine log? No hours get recorded for it.')) return;
        A.S.data.mlogOpen = open().filter(function (x) { return x.id !== l.id; });
        A.enqueue('mlog.cancel', {fields: {id: l.id}});
        A.save(); A.closeSheet(); A.render(); return toast('Cancelled');
      }
      if (act !== 'save') return A.closeSheet();
      var f = {id: l.id, operator: $('#mc-op').value, notes: $('#mc-n').value.trim()}, hrs;
      if (metered) {
        var v = $('#mc-me').value.trim();
        if (!v || isNaN(+v)) { $('#mc-me').focus(); return toast('Enter the hour meter'); }
        if (l.meterStart !== '' && l.meterStart !== undefined && +v < +l.meterStart) { $('#mc-me').focus(); return toast('That\u2019s lower than the start (' + fmtH(l.meterStart) + ')'); }
        hrs = l.meterStart !== '' && l.meterStart !== undefined ? +v - +l.meterStart : null;
        if (hrs !== null && hrs > 16 && !confirm(fmtH(hrs) + ' hours on one log \u2013 is that right?')) return;
        if (mc.hours !== null && mc.hours !== undefined && +v > mc.hours + 300 && !confirm('That is ' + Math.round(+v - mc.hours) + ' hrs more than the last reading. Is that right?')) return;
        f.meterEnd = v;
        if (mc.hours === null || mc.hours === undefined || +v > mc.hours) mc.hours = +v;
      } else {
        var h = $('#mc-h').value.trim();
        if (!h || isNaN(+h)) { $('#mc-h').focus(); return toast('Enter the hours'); }
        f.hours = h; hrs = +h;
      }
      A.S.data.mlogOpen = open().filter(function (x) { return x.id !== l.id; });
      (A.S.mlogs = A.S.mlogs || []).unshift(Object.assign({}, l, {status: 'Closed', operator: f.operator, meterEnd: f.meterEnd || '', hours: hrs === null ? '' : Math.round(hrs * 100) / 100, closedBy: A.me().name}));
      A.enqueue('mlog.close', {fields: f});
      A.save(); A.closeSheet(); A.render(); toast(l.machine + ' closed out' + (hrs !== null ? ' \u2013 ' + fmtH(hrs) + ' hrs (' + f.operator + ')' : ''));
    });
  }
  A.mlogStartForm = startForm;
  A.mlogCloseForm = closeForm;

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ml]'); if (!b || !A.S.data) return;
    e.stopPropagation();
    if (b.getAttribute('data-ml') === 'start') return startForm(b.getAttribute('data-mach') || '');
    var l = byId(b.getAttribute('data-id')); if (l) closeForm(l);
  }, true);
})();
