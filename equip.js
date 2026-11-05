/* E10K app: Equipment tab (machines, service due, pre-start checks, problems, service/repair log).
 * Loaded after app.js; uses the hooks it exposes on window.E10K. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var EQ = {list: ls.get('equip', null), checklist: ls.get('checklist', []), hist: {}, open: null};

  function fmtH(n) { return n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(undefined, {maximumFractionDigits: 1}); }
  function stateCls(s) { return {overdue: 'block', soon: 'wait', ok: 'done', nohours: ''}[s] || ''; }

  function nextLine(m) {
    if (m.hours === null || m.hours === undefined) return 'Hour meter needed';
    var d = m.schedule.filter(function (x) { return x.left !== undefined || x.daysLeft !== undefined; })[0];
    if (!d) return 'No schedule yet';
    var same = m.schedule.filter(function (x) { return x.dueAt === d.dueAt && x.dueAt !== undefined; });
    var label = same.map(function (x) { return fmtH(x.every) + '-hr'; }).join(' + ');
    if (d.left !== undefined) {
      return d.left <= 0 ? label + ' OVERDUE by ' + fmtH(-d.left) + ' hrs' : label + ' in ' + fmtH(d.left) + ' hrs (at ' + fmtH(d.dueAt) + ')';
    }
    return label + ' due ' + d.dueDate;
  }

  function load(quiet) {
    return A.api('equip.list').then(function (r) {
      if (!r.ok) return;
      EQ.list = r.machines; EQ.checklist = r.checklist; ls.set('equip', EQ.list); ls.set('checklist', EQ.checklist);
      if (A.S.tab === 'equip') render(true);
    }).catch(function () { if (!quiet) toast('No signal \u2013 showing saved copy'); });
  }

  function render(noFetch) {
    if (EQ.open) return renderMachine(EQ.open, noFetch);
    var html = '<h2>Equipment</h2>';
    if (!EQ.list) html += '<div class="empty">Loading\u2026</div>';
    else {
      var rank = {overdue: 0, soon: 1, nohours: 2, ok: 3};
      EQ.list.slice().sort(function (a, b) { return rank[a.state] - rank[b.state] || a.key.localeCompare(b.key); }).forEach(function (m) {
        html += '<div class="card tap" data-machine="' + esc(m.key) + '"><div class="row"><div class="grow">' +
          '<div class="title">' + esc(m.model) + '</div><div class="sub">' + (m.hours !== null && m.hours !== undefined ? fmtH(m.hours) + ' hrs' +
          (m.hoursAsOf ? ' \u00b7 as of ' + esc(m.hoursAsOf) : '') : '') + '</div></div>' +
          '<span class="pill ' + stateCls(m.state) + '">' + esc(nextLine(m)) + '</span></div></div>';
      });
    }
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine) load(true);
  }

  function machine(key) { return (EQ.list || []).filter(function (m) { return m.key === key; })[0]; }

  function renderMachine(key, noFetch) {
    var m = machine(key); if (!m) { EQ.open = null; return render(); }
    var html = '<button class="chip" data-eq="back">\u2190 All equipment</button>' +
      '<h2>' + esc(m.model) + '</h2>' +
      '<div class="kv">Hours <b>' + (m.hours !== null && m.hours !== undefined ? fmtH(m.hours) : 'not entered') + '</b>' + (m.hoursAsOf ? ' \u00b7 as of ' + esc(m.hoursAsOf) : '') + '</div>' +
      (m.serial ? '<div class="kv">S/N <b>' + esc(m.serial) + '</b></div>' : '') +
      (m.engine ? '<div class="kv">Engine <b>' + esc(m.engine) + '</b>' + (m.engineSn ? ' \u00b7 S/N ' + esc(m.engineSn) : '') + '</div>' : '') +
      (m.built ? '<div class="kv">Built <b>' + esc(m.built) + '</b></div>' : '') +
      (m.specs ? '<div class="kv">' + esc(m.specs) + '</div>' : '') +
      '<div class="btns"><button class="btn primary" data-eq="hours">Update hours</button><button class="btn" data-eq="check">Pre-start check</button></div>' +
      '<div class="btns"><button class="btn ok" data-eq="log">Log service / repair</button><button class="btn" data-eq="problem">Report problem</button></div>';
    html += '<h3>Service schedule</h3>';
    if (!m.schedule.length) html += '<div class="empty" style="padding:14px">No schedule on file. Tell Sam the intervals.</div>';
    m.schedule.forEach(function (d) {
      var when = d.dueAt !== undefined ? (d.left <= 0 ? 'OVERDUE ' + fmtH(-d.left) + ' hrs' : 'in ' + fmtH(d.left) + ' hrs \u00b7 at ' + fmtH(d.dueAt)) :
        (d.dueDate ? 'due ' + d.dueDate : (m.hours === null || m.hours === undefined ? 'needs hours' : ''));
      html += '<div class="card"><div class="row"><div class="grow"><div class="title">Every ' + (d.every ? fmtH(d.every) + ' hrs' : '') +
        (d.months ? (d.every ? ' or ' : '') + d.months + ' months' : '') + '</div><div class="sub">' + esc(d.service) + '</div>' +
        '<div class="sub">' + (d.lastHrs !== null && d.lastHrs !== undefined ? 'Last done at ' + fmtH(d.lastHrs) + (d.lastDate ? ' (' + esc(d.lastDate) + ')' : '') : 'Not logged yet') + '</div></div>' +
        '<span class="pill ' + stateCls(d.state) + '">' + esc(when) + '</span></div></div>';
    });
    if (m.parts.length) {
      html += '<h3>Parts & fluids</h3><div class="card">' + m.parts.map(function (p) {
        return '<div class="kv"><b>' + esc(p.item) + '</b> ' + esc([p.part, p.alt].filter(Boolean).join(' \u00b7 ')) +
          (p.qty ? ' \u00b7 ' + esc(p.qty) : '') + (p.spec ? ' \u00b7 ' + esc(p.spec) : '') + '</div>';
      }).join('') + '</div>';
    }
    html += '<h3>History</h3><div id="eq-hist">' + histHtml(EQ.hist[key]) + '</div>';
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine) {
      A.api('equip.history', {machine: key}).then(function (r) {
        if (!r.ok) return; EQ.hist[key] = r;
        var el = $('#eq-hist'); if (el && EQ.open === key) el.innerHTML = histHtml(r);
      }).catch(function () {});
    }
  }

  function histHtml(r) {
    if (!r) return '<div class="empty" style="padding:14px">Loading\u2026</div>';
    if (!r.history.length) return '<div class="empty" style="padding:14px">Nothing logged yet.</div>';
    return r.history.map(function (x) {
      if (x.kind === 'check') return '<div class="card"><div class="title">' + esc(x.date) + ' \u00b7 Pre-start: ' + esc(x.result) + '</div>' +
        '<div class="sub">' + esc([x.by, x.hours ? fmtH(x.hours) + ' hrs' : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
        (x.problems ? '<div class="sub">' + esc(x.problems) + '</div>' : '') + '</div>';
      return '<div class="card"><div class="title">' + esc(x.date) + ' \u00b7 ' + esc(x.type) + (x.intervals ? ' (' + esc(x.intervals) + ')' : '') + '</div>' +
        '<div class="sub">' + esc([x.by, x.hours ? fmtH(x.hours) + ' hrs' : '', x.labor ? x.labor + ' hrs labor' : '', x.cost ? '$' + x.cost : ''].filter(Boolean).join(' \u00b7 ')) + '</div>' +
        (x.what ? '<div class="notes">' + esc(x.what) + (x.parts ? '\nParts: ' + esc(x.parts) : '') + '</div>' : '') +
        (x.photos ? '<div class="sub">' + x.photos + ' photo' + (x.photos > 1 ? 's' : '') + '</div>' : '') + '</div>';
    }).join('');
  }

  // ---------- forms ----------
  function photoInput(id) { return '<label>Photos</label><input type="file" id="' + id + '" accept="image/*" multiple><div class="photos" id="' + id + '-prev"></div>'; }
  function wirePhotos(id, arr) {
    $('#' + id).onchange = function (e) {
      Array.prototype.forEach.call(e.target.files, function (file) {
        A.shrink(file).then(function (d) {
          arr.push({data: d, type: 'image/jpeg'});
          var im = document.createElement('img'); im.src = d; $('#' + id + '-prev').appendChild(im);
        }).catch(function () { toast('Could not read a photo'); });
      });
      e.target.value = '';
    };
  }
  function hoursField(m, id) {
    return '<label>Hour meter</label><input id="' + id + '" inputmode="decimal" placeholder="' + (m.hours !== null && m.hours !== undefined ? 'last: ' + fmtH(m.hours) : 'e.g. 2231.5') + '">';
  }
  function after(msg) { A.closeSheet(); toast(msg); setTimeout(function () { load(true).then(function () { if (EQ.open) delete EQ.hist[EQ.open]; render(); }); }, 4000); }

  function hoursForm(m) {
    A.sheet('<h2>' + esc(m.model) + '</h2>' + hoursField(m, 'eq-h') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var v = $('#eq-h').value.trim();
      if (!v || isNaN(+v)) return toast('Type the hour meter reading');
      if (m.hours !== null && m.hours !== undefined && +v < m.hours && !confirm('That is lower than the last reading (' + fmtH(m.hours) + '). Save anyway?')) return;
      m.hours = +v; m.hoursAsOf = A.todayStr();
      A.enqueue('equip.hours', {fields: {machine: m.key, hours: v, force: m.hours > +v}});
      after('Hours saved');
    });
  }

  function checkForm(m) {
    var items = EQ.checklist || [], photos = [];
    var html = '<h2>Pre-start: ' + esc(m.model) + '</h2>' + hoursField(m, 'pc-h') +
      '<div class="sub" style="margin:10px 2px">Tap anything that is NOT OK and add a note.</div>' +
      items.map(function (it, i) {
        return '<div class="card" style="padding:10px 12px"><div class="row"><div class="grow title" style="font-size:15px">' + esc(it) + '</div>' +
          '<button class="chip on" data-pc="' + i + '">OK</button></div><input id="pc-n' + i + '" placeholder="What\u2019s wrong?" style="display:none;margin-top:8px"></div>';
      }).join('') +
      '<label><input type="checkbox" id="pc-down" style="width:auto"> Machine is DOWN \u2013 do not run</label>' +
      '<label>Notes</label><textarea id="pc-notes" style="min-height:60px"></textarea>' + photoInput('pc-ph') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save check</button></div>';
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      var res = items.map(function (it, i) {
        var bad = $('[data-pc="' + i + '"]').getAttribute('data-bad') === '1';
        return {name: it, ok: !bad, note: bad ? $('#pc-n' + i).value.trim() : ''};
      });
      var f = {machine: m.key, hours: $('#pc-h').value.trim(), items: res, down: $('#pc-down').checked,
        notes: $('#pc-notes').value.trim(), photos: photos, clientId: A.uid()};
      var bad = res.filter(function (x) { return !x.ok; }).length;
      A.enqueue('equip.check', {fields: f});
      after(bad ? 'Saved \u2013 Bob has been sent a repair task' : 'All OK \u2013 saved');
    });
    wirePhotos('pc-ph', photos);
    Array.prototype.forEach.call(document.querySelectorAll('[data-pc]'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var i = b.getAttribute('data-pc'), bad = b.getAttribute('data-bad') !== '1';
        b.setAttribute('data-bad', bad ? '1' : '0'); b.textContent = bad ? 'NOT OK' : 'OK';
        b.className = 'chip' + (bad ? '' : ' on'); b.style.background = bad ? 'var(--red)' : ''; b.style.color = bad ? '#000' : '';
        $('#pc-n' + i).style.display = bad ? 'block' : 'none'; if (bad) $('#pc-n' + i).focus();
      };
    });
  }

  function problemForm(m) {
    var photos = [];
    A.sheet('<h2>Problem: ' + esc(m.model) + '</h2><label>What\u2019s wrong?</label><textarea id="pr-t" placeholder="Tap the mic and describe it"></textarea>' +
      hoursField(m, 'pr-h') + '<label><input type="checkbox" id="pr-down" style="width:auto"> Machine is DOWN \u2013 do not run</label>' + photoInput('pr-ph') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Send</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var t = $('#pr-t').value.trim(); if (!t) return toast('Describe the problem');
      A.enqueue('equip.problem', {fields: {machine: m.key, text: t, hours: $('#pr-h').value.trim(), down: $('#pr-down').checked, photos: photos, clientId: A.uid()}});
      after('Sent \u2013 Bob, Spencer and Will get an alert');
    });
    wirePhotos('pr-ph', photos);
  }

  function logForm(m) {
    var photos = [], repairs = (EQ.hist[m.key] && EQ.hist[m.key].repairs) || [];
    var due = m.schedule.filter(function (d) { return d.state !== 'ok' || (d.left !== undefined && d.left <= 50); }).map(function (d) { return d.id; });
    var html = '<h2>Log: ' + esc(m.model) + '</h2>' +
      '<label>Type</label><select id="sl-type"><option>Scheduled service</option><option>Repair</option><option>Winter rebuild</option><option>Inspection</option><option>Other</option></select>' +
      '<div class="two"><div><label>Date</label><input type="date" id="sl-date" value="' + A.usToIso(A.todayStr()) + '"></div><div>' + hoursField(m, 'sl-h') + '</div></div>' +
      (m.schedule.length ? '<label>Services done (resets their countdown)</label>' + m.schedule.slice().sort(function (a, b) { return (a.every || 0) - (b.every || 0); }).map(function (d) {
        return '<label style="color:var(--text);margin:6px 2px"><input type="checkbox" class="sl-int" value="' + esc(d.id) + '" style="width:auto"' + (due.indexOf(d.id) >= 0 ? ' checked' : '') + '> ' +
          (d.every ? fmtH(d.every) + '-hr' : '') + (d.months ? ' / ' + d.months + '-month' : '') + ' <span class="sub">' + esc(d.service.slice(0, 70)) + '\u2026</span></label>';
      }).join('') : '') +
      (repairs.length ? '<label>Closes this repair</label><select id="sl-rep"><option value="">(none)</option>' + repairs.map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.task.slice(0, 80)) + '</option>'; }).join('') + '</select>' : '') +
      '<label>What was done</label><textarea id="sl-what" placeholder="Tap the mic and talk it through"></textarea>' +
      '<label>Parts used (one per line: part #, qty, vendor)</label><textarea id="sl-parts" style="min-height:70px" placeholder="1R-1807 oil filter x1, NAPA"></textarea>' +
      '<div class="two"><div><label>Parts cost $</label><input id="sl-cost" inputmode="decimal"></div><div><label>Labor hrs</label><input id="sl-labor" inputmode="decimal"></div></div>' +
      '<label>Notes</label><textarea id="sl-notes" style="min-height:60px"></textarea>' + photoInput('sl-ph') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>';
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      var ints = Array.prototype.filter.call(document.querySelectorAll('.sl-int'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      var f = {machine: m.key, type: $('#sl-type').value, date: A.isoToUs($('#sl-date').value), hours: $('#sl-h').value.trim(), intervals: ints,
        repairTask: $('#sl-rep') ? $('#sl-rep').value : '', what: $('#sl-what').value.trim(), parts: $('#sl-parts').value.trim(),
        cost: $('#sl-cost').value.trim(), labor: $('#sl-labor').value.trim(), notes: $('#sl-notes').value.trim(), photos: photos, clientId: A.uid()};
      if (!f.what && !ints.length) return toast('Say what was done');
      if (ints.length && !f.hours) return toast('Add the hour meter so the countdown resets right');
      A.enqueue('equip.log', {fields: f});
      after('Logged' + (ints.length ? ' \u2013 countdown reset' : ''));
    });
    wirePhotos('sl-ph', photos);
    $('#sl-type').onchange = function () {
      var sched = $('#sl-type').value === 'Scheduled service';
      if (!sched) Array.prototype.forEach.call(document.querySelectorAll('.sl-int'), function (c) { c.checked = false; });
    };
  }

  // ---------- wiring ----------
  A.addTab({k: 'equip', n: 'Equipment', ic: A.svg('<path d="M3 17h13M5 17V9h7l3 4h4v4M7 20a2 2 0 1 0 0-.01M17 20a2 2 0 1 0 0-.01M12 9V5h3"/>'),
    render: function () { render(); },
    fab: function () {
      if (!EQ.list) return;
      if (EQ.open) return problemForm(machine(EQ.open));
      A.sheet('<h2>Which machine?</h2>' + EQ.list.map(function (m) {
        return '<button class="btn" style="width:100%;margin-bottom:8px" data-act="' + esc(m.key) + '">' + esc(m.model) + '</button>'; }).join(''),
        function (k) { A.closeSheet(); EQ.open = k; render(true); });
    }});

  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'equip') return;
    var mc = e.target.closest('[data-machine]');
    if (mc) { EQ.open = mc.getAttribute('data-machine'); window.scrollTo(0, 0); return render(); }
    var b = e.target.closest('[data-eq]'); if (!b) return;
    var act = b.getAttribute('data-eq'), m = machine(EQ.open);
    if (act === 'back') { EQ.open = null; return render(true); }
    if (!m) return;
    if (act === 'hours') return hoursForm(m);
    if (act === 'check') return checkForm(m);
    if (act === 'problem') return problemForm(m);
    if (act === 'log') return logForm(m);
  });
})();
