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

  function viewChips() {
    var v = ls.get('eqView', 'machines'), n = (A.S.data && A.S.data.supplyCount) || 0;
    return '<div class="chips" style="margin:6px 0 2px"><button class="chip' + (v === 'machines' ? ' on' : '') + '" data-eqview="machines">Machines</button>' +
      '<button class="chip' + (v === 'supplies' ? ' on' : '') + '" data-eqview="supplies">\ud83d\uded2 Supplies' + (n ? ' (' + n + ')' : '') + '</button></div>';
  }
  A.eqViewChips = viewChips;

  function render(noFetch) {
    if (EQ.open) return renderMachine(EQ.open, noFetch);
    var html = '<h2>Equipment</h2>' + (A.mlogBanner ? A.mlogBanner('equip') : '');
    if (!EQ.list) html += '<div class="empty">Loading\u2026</div>';
    else {
      var rank = {overdue: 0, soon: 1, nohours: 2, ok: 3}, fr = {DOWN: 0, Problem: 1, Watch: 2};
      EQ.list.slice().sort(function (a, b) {
        var fa = fr[a.status] === undefined ? 3 : fr[a.status], fb = fr[b.status] === undefined ? 3 : fr[b.status];
        return fa - fb || rank[a.state] - rank[b.state] || a.key.localeCompare(b.key);
      }).forEach(function (m) {
        var run = A.mlogOpenFor ? A.mlogOpenFor(m.key) : null;
        html += '<div class="card tap' + flagCls(m) + (run ? ' running' : '') + '" data-machine="' + esc(m.key) + '"><div class="row"><div class="grow">' +
          (run ? '<div class="sub" style="color:var(--green);font-weight:700">\ud83d\udfe2 Running \u00b7 ' + esc(run.operator || '') + ' \u00b7 ' + esc(run.job || '') + '</div>' : '') +
          '<div class="title">' + (FL(m.status) ? '<span class="ficon">' + FL(m.status).ic + '</span>' : '') + esc(m.model) + '</div><div class="sub">' + (m.hours !== null && m.hours !== undefined ? fmtH(m.hours) + ' hrs' +
          (m.hoursAsOf ? ' \u00b7 as of ' + esc(m.hoursAsOf) : '') : '') + '</div>' +
          (FL(m.status) ? '<div class="sub" style="color:' + FL(m.status).color + ';font-weight:600">' + esc(FL(m.status).label) + ': ' + esc(lastNote(m.statusNote)) + '</div>' : '') +
          '</div><span class="pill ' + stateCls(m.state) + '">' + esc(nextLine(m)) + '</span></div></div>';
      });
    }
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine) load(true);
  }

  function FL(st) { return A.FLAGS[st]; }
  function flagCls(m) { var L = FL(m.status); return L ? ' ' + L.cls : ''; }
  function levelPicker(id, cur) {
    return '<div id="' + id + '">' + ['DOWN', 'Problem', 'Watch'].map(function (k) {
      var L = FL(k), sub = {DOWN: 'Do not run it. Bob gets a High repair task.', Problem: 'Still OK to run carefully. Bob gets a repair task.', Watch: 'Runs fine, just keep an eye on it.'}[k];
      return '<button class="lvl l-' + k + (k === cur ? ' on' : '') + '" data-lvl="' + k + '">' + L.ic + ' ' + esc(L.label) + '<span class="ls">' + sub + '</span></button>';
    }).join('') + '</div>';
  }
  function wireLevels(id, onPick) {
    var box = document.getElementById(id); var picked = '';
    var on = box.querySelector('.lvl.on'); if (on) picked = on.getAttribute('data-lvl');
    box.onclick = function (e) {
      var b = e.target.closest('[data-lvl]'); if (!b) return; e.stopPropagation();
      picked = b.getAttribute('data-lvl');
      Array.prototype.forEach.call(box.querySelectorAll('.lvl'), function (x) { x.classList.toggle('on', x === b); });
      if (onPick) onPick(picked);
    };
    return function () { return picked; };
  }
  function lastNote(n) { return String(n || '').split(' | ').pop(); }
  var RANK = {'In Service': 0, Watch: 1, Problem: 2, DOWN: 3};
  function setLocalFlag(m, level, note) {
    if ((RANK[level] || 0) >= (RANK[m.status] || 0)) m.status = level;
    var line = A.me().name + ' ' + A.todayStr() + ': ' + note;
    m.statusNote = m.statusNote ? m.statusNote + ' | ' + line : line;
    if (!m.statusSince) m.statusSince = A.todayStr();
    var fl = A.S.data.flags || (A.S.data.flags = []);
    var f = fl.filter(function (x) { return x.key === m.key; })[0];
    if (f) { f.status = m.status; f.note = m.statusNote; } else fl.push({key: m.key, model: m.model, status: m.status, note: m.statusNote, since: m.statusSince, by: A.me().name});
    var bm = (A.S.data.machines || []).filter(function (x) { return x.name === m.key; })[0]; if (bm) bm.status = m.status;
    A.save(); A.renderFlags();
  }

  function machine(key) { return (EQ.list || []).filter(function (m) { return m.key === key; })[0]; }

  function renderMachine(key, noFetch) {
    var m = machine(key); if (!m) { EQ.open = null; return render(); }
    var html = '<button class="chip" data-eq="back">\u2190 All equipment</button>' +
      '<h2>' + (FL(m.status) ? FL(m.status).ic + ' ' : '') + esc(m.model) + '</h2>' +
      (FL(m.status) ? '<div class="card' + flagCls(m) + '"><div class="title">' + FL(m.status).ic + ' ' + esc(FL(m.status).label) + '</div>' +
        String(m.statusNote || '').split(' | ').map(function (n) { return '<div class="sub" style="color:#ddd">' + esc(n) + '</div>'; }).join('') +
        '<div class="btns"><button class="btn" data-eq="level">Change level</button><button class="btn ok" data-eq="service">\u2705 Back in service</button></div></div>' : '') +
      '<div class="kv">Hours <b>' + (m.hours !== null && m.hours !== undefined ? fmtH(m.hours) : 'not entered') + '</b>' + (m.hoursAsOf ? ' \u00b7 as of ' + esc(m.hoursAsOf) : '') + '</div>' +
      (m.serial ? '<div class="kv">S/N <b>' + esc(m.serial) + '</b></div>' : '') +
      (m.engine ? '<div class="kv">Engine <b>' + esc(m.engine) + '</b>' + (m.engineSn ? ' \u00b7 S/N ' + esc(m.engineSn) : '') + '</div>' : '') +
      (m.built ? '<div class="kv">Built <b>' + esc(m.built) + '</b></div>' : '') +
      (m.specs ? '<div class="kv">' + esc(m.specs) + '</div>' : '') +
      (function () {
        var run = A.mlogOpenFor ? A.mlogOpenFor(m.key) : null;
        if (run) return '<div class="card running"><div class="title">\ud83d\udfe2 Running \u2013 ' + esc(run.job) + '</div><div class="sub">' + esc(run.operator || '') +
          (run.meterStart ? ' \u00b7 from ' + esc(fmtH(run.meterStart)) : '') + ' \u00b7 started by ' + esc(run.startedBy || '') + '</div>' +
          '<button class="btn ok" data-ml="close" data-id="' + esc(run.id) + '" style="width:100%;margin-top:8px">Close out machine hours</button></div>';
        return '<button class="btn" data-ml="start" data-mach="' + esc(m.key) + '" style="width:100%;margin:6px 0">\u2699 Start machine hours</button>';
      })() +
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
    if (A.me().owner) html += '<h3>Cost (parts + labor)</h3><div id="eq-cost">' + costHtml(EQ.hist[key]) + '</div>';
    html += '<h3>History</h3><div id="eq-hist">' + histHtml(EQ.hist[key]) + '</div>';
    $('#view').innerHTML = html;
    if (!noFetch && navigator.onLine) {
      A.api('equip.history', {machine: key}).then(function (r) {
        if (!r.ok) return; EQ.hist[key] = r;
        var el = $('#eq-hist'); if (el && EQ.open === key) el.innerHTML = histHtml(r);
        var ec = $('#eq-cost'); if (ec && EQ.open === key) ec.innerHTML = costHtml(r);
      }).catch(function () {});
    }
  }

  function money(n) { return '$' + Math.round(n || 0).toLocaleString(); }
  function costHtml(r) {
    if (!r || !r.costs) return '<div class="empty" style="padding:14px">Loading\u2026</div>';
    var c = r.costs;
    if (!c.years.length) return '<div class="empty" style="padding:14px">No parts or labor logged yet.</div>';
    return '<div class="card">' + c.years.map(function (y) {
      return '<div class="row" style="margin:4px 0"><div class="grow"><b>' + esc(y.year) + '</b> <span class="sub">' + y.services + ' service' + (y.services === 1 ? '' : 's') +
        ', ' + y.repairs + ' repair' + (y.repairs === 1 ? '' : 's') + '</span><div class="sub">Parts ' + money(y.parts) + ' \u00b7 Labor ' +
        (Math.round(y.laborHrs * 10) / 10) + ' hrs (' + money(y.laborCost) + ')</div></div><span class="pill">' + money(y.total) + '</span></div>';
    }).join('') + (c.years.length > 1 ? '<div class="kv" style="margin-top:8px">All years: <b>' + money(c.lifetime.total) + '</b></div>' : '') + '</div>';
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
  function after(msg) { A.closeSheet(); render(true); toast(msg); setTimeout(function () { load(true).then(function () { if (EQ.open) delete EQ.hist[EQ.open]; render(); }); }, 4000); }

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
    var html = '<h2>Pre-start: ' + esc(m.model) + '</h2>' +
      (FL(m.status) ? '<div class="card' + flagCls(m) + '"><b>' + FL(m.status).ic + ' ' + esc(FL(m.status).label) + '</b><div class="sub">' + esc(lastNote(m.statusNote)) + '</div></div>' : '') +
      hoursField(m, 'pc-h') +
      '<div class="sub" style="margin:10px 2px">Tap anything that is NOT OK and add a note.</div>' +
      items.map(function (it, i) {
        return '<div class="card" style="padding:10px 12px"><div class="row"><div class="grow title" style="font-size:15px">' + esc(it) + '</div>' +
          '<button class="chip on" data-pc="' + i + '">OK</button></div><input id="pc-n' + i + '" placeholder="What\u2019s wrong?" style="display:none;margin-top:8px"></div>';
      }).join('') +
      '<div id="pc-lvlbox" style="display:none"><label>How bad is it?</label>' + levelPicker('pc-lvl', '') + '</div>' +
      '<label>Notes</label><textarea id="pc-notes" style="min-height:60px"></textarea>' + photoInput('pc-ph') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save check</button></div>';
    A.sheet(html, function (act) {
      if (act !== 'save') return A.closeSheet();
      var res = items.map(function (it, i) {
        var bad = $('[data-pc="' + i + '"]').getAttribute('data-bad') === '1';
        return {name: it, ok: !bad, note: bad ? $('#pc-n' + i).value.trim() : ''};
      });
      var hv = $('#pc-h').value.trim();
      if (m.meter !== false && (!hv || isNaN(+hv))) { $('#pc-h').focus(); return toast('Enter the hour meter reading'); }
      if (hv && m.hours !== null && m.hours !== undefined && +hv < m.hours && !confirm('That is lower than the last reading (' + fmtH(m.hours) + '). Save anyway?')) return;
      var nbad = res.filter(function (x) { return !x.ok; }).length, lvl = pcLevel();
      if (nbad && !lvl) { $('#pc-lvlbox').scrollIntoView({block: 'center'}); return toast('Pick how bad it is'); }
      var f = {machine: m.key, hours: hv, items: res, level: lvl, down: lvl === 'DOWN',
        notes: $('#pc-notes').value.trim(), photos: photos, clientId: A.uid()};
      var bad = res.filter(function (x) { return !x.ok; }).length;
      A.enqueue('equip.check', {fields: f});
      if (hv) { m.hours = +hv; m.hoursAsOf = A.todayStr(); }
      if (bad) setLocalFlag(m, lvl, res.filter(function (x) { return !x.ok; }).map(function (x) { return x.note || x.name + ' - not OK'; }).join('; '));
      after(bad ? 'Saved \u2013 flagged for everyone and Bob has a repair task' : 'All OK \u2013 saved');
    });
    wirePhotos('pc-ph', photos);
    var pcLevel = wireLevels('pc-lvl');
    if (m.hours !== null && m.hours !== undefined && $('#pc-h')) $('#pc-h').value = m.hours;
    Array.prototype.forEach.call(document.querySelectorAll('[data-pc]'), function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var i = b.getAttribute('data-pc'), bad = b.getAttribute('data-bad') !== '1';
        b.setAttribute('data-bad', bad ? '1' : '0'); b.textContent = bad ? 'NOT OK' : 'OK';
        b.className = 'chip' + (bad ? '' : ' on'); b.style.background = bad ? 'var(--red)' : ''; b.style.color = bad ? '#000' : '';
        $('#pc-n' + i).style.display = bad ? 'block' : 'none'; if (bad) $('#pc-n' + i).focus();
        $('#pc-lvlbox').style.display = document.querySelector('[data-pc][data-bad="1"]') ? 'block' : 'none';
      };
    });
  }

  function problemForm(m) {
    var photos = [];
    A.sheet('<h2>Problem: ' + esc(m.model) + '</h2><label>What\u2019s wrong?</label><textarea id="pr-t" placeholder="Tap the mic and describe it"></textarea>' +
      '<label>How bad is it?</label>' + levelPicker('pr-lvl', '') + hoursField(m, 'pr-h') + photoInput('pr-ph') +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Send</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var t = $('#pr-t').value.trim(); if (!t) return toast('Describe the problem');
      var lv = prLevel(); if (!lv) return toast('Pick how bad it is');
      A.enqueue('equip.problem', {fields: {machine: m.key, text: t, hours: $('#pr-h').value.trim(), level: lv, down: lv === 'DOWN', photos: photos, clientId: A.uid()}});
      setLocalFlag(m, lv, t);
      after('Sent \u2013 flagged for everyone (Spencer, Hanna, Bob, Will)');
    });
    wirePhotos('pr-ph', photos);
    var prLevel = wireLevels('pr-lvl');
  }

  function levelForm(m) {
    A.sheet('<h2>' + esc(m.model) + '</h2><div class="sub">' + esc(lastNote(m.statusNote)) + '</div><label>How bad is it now?</label>' + levelPicker('lv-lvl', m.status) +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn primary" data-act="save">Save</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var lv = get(); if (!lv || lv === m.status) return A.closeSheet();
      A.enqueue('equip.flag', {fields: {machine: m.key, level: lv}});
      m.status = lv;
      var f = (A.S.data.flags || []).filter(function (x) { return x.key === m.key; })[0]; if (f) f.status = lv;
      var bm = (A.S.data.machines || []).filter(function (x) { return x.name === m.key; })[0]; if (bm) bm.status = lv;
      A.save(); A.renderFlags();
      after('Changed to ' + FL(lv).label + ' \u2013 everyone gets a heads-up');
    });
    var get = wireLevels('lv-lvl');
  }

  function serviceForm(m) {
    var repairs = (EQ.hist[m.key] && EQ.hist[m.key].repairs || []).filter(function (r) { return r.phase === 'Equipment Repair'; });
    A.sheet('<h2>Back in service: ' + esc(m.model) + '</h2>' +
      '<div class="sub">' + esc(lastNote(m.statusNote)) + '</div>' +
      '<label>What fixed it?</label><textarea id="bs-n" placeholder="Tap the mic: replaced the hydraulic hose, no more leak"></textarea>' + hoursField(m, 'bs-h') +
      (repairs.length ? '<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" id="bs-close" checked style="width:auto"> Close the repair task' + (repairs.length > 1 ? 's' : '') +
        ' (' + esc(repairs.map(function (r) { return r.task.replace(/^Fix [^:]+: /, ''); }).join('; ').slice(0, 90)) + ')</label>' : '') +
      '<div class="sub">For parts and labor, also use Log service / repair.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Cancel</button><button class="btn ok" data-act="save">Back in service</button></div>', function (act) {
      if (act !== 'save') return A.closeSheet();
      var note = $('#bs-n').value.trim(); if (!note) return toast('Say what fixed it');
      var hv = $('#bs-h').value.trim();
      A.enqueue('equip.service', {fields: {machine: m.key, note: note, hours: hv, closeRepairs: !!($('#bs-close') && $('#bs-close').checked), clientId: A.uid()}});
      m.status = 'In Service'; m.statusNote = ''; if (hv) { m.hours = +hv; m.hoursAsOf = A.todayStr(); }
      A.S.data.flags = (A.S.data.flags || []).filter(function (x) { return x.key !== m.key; });
      var bm = (A.S.data.machines || []).filter(function (x) { return x.name === m.key; })[0]; if (bm) bm.status = 'In Service';
      A.save(); A.renderFlags();
      after('Back in service \u2013 everyone gets a heads-up');
    });
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

  A.openMachine = function (key) { EQ.open = key; A.navPush(); window.scrollTo(0, 0); render(); };
  A.curMachine = function () { return A.S.tab === 'equip' ? EQ.open : null; };
  A.setMachine = function (key) { EQ.open = key || null; };

  document.addEventListener('click', function (e) {
    if (A.S.tab !== 'equip') return;
    var vw = e.target.closest('[data-eqview]');
    if (vw) { ls.set('eqView', vw.getAttribute('data-eqview')); EQ.open = null; window.scrollTo(0, 0); return render(); }
    var mc = e.target.closest('[data-machine]');
    if (mc) { EQ.open = mc.getAttribute('data-machine'); A.navPush(); window.scrollTo(0, 0); return render(); }
    var b = e.target.closest('[data-eq]'); if (!b) return;
    var act = b.getAttribute('data-eq'), m = machine(EQ.open);
    if (act === 'back') { if (history.state && history.state.machine) return history.back(); EQ.open = null; return render(true); }
    if (!m) return;
    if (act === 'hours') return hoursForm(m);
    if (act === 'check') return checkForm(m);
    if (act === 'problem') return problemForm(m);
    if (act === 'log') return logForm(m);
    if (act === 'service') return serviceForm(m);
    if (act === 'level') return levelForm(m);
  });
})();
