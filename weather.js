/* E10K app: live weather where your phone is. Header chip shows temp now; tap for the detailed view
 * (crew heads-ups: freezing, wind gusts, rain/snow timing, NWS alerts, hourly + 3 days).
 * Free sources, no keys: Open-Meteo forecast, weather.gov alerts, OpenStreetMap place names. Refreshes every 15 min. */
(function () {
  'use strict';
  var A = window.E10K;
  if (!A) return;
  var $ = A.$, esc = A.esc, ls = A.ls, toast = A.toast;
  var FALLBACK = {lat: 39.2247, lon: -105.9989, name: 'Fairplay (no location)'};
  var W = {data: ls.get('wx', null), at: ls.get('wxAt', 0), pos: ls.get('wxPos', null), place: ls.get('wxPlace', ''), alerts: ls.get('wxAlerts', []), busy: false};

  var CODES = {0: ['\u2600\ufe0f', 'Clear'], 1: ['\ud83c\udf24\ufe0f', 'Mostly clear'], 2: ['\u26c5', 'Partly cloudy'], 3: ['\u2601\ufe0f', 'Cloudy'],
    45: ['\ud83c\udf2b\ufe0f', 'Fog'], 48: ['\ud83c\udf2b\ufe0f', 'Freezing fog'], 51: ['\ud83c\udf26\ufe0f', 'Light drizzle'], 53: ['\ud83c\udf26\ufe0f', 'Drizzle'], 55: ['\ud83c\udf27\ufe0f', 'Heavy drizzle'],
    56: ['\ud83c\udf27\ufe0f', 'Freezing drizzle'], 57: ['\ud83c\udf27\ufe0f', 'Freezing drizzle'], 61: ['\ud83c\udf26\ufe0f', 'Light rain'], 63: ['\ud83c\udf27\ufe0f', 'Rain'], 65: ['\ud83c\udf27\ufe0f', 'Heavy rain'],
    66: ['\ud83e\uddca', 'Freezing rain'], 67: ['\ud83e\uddca', 'Freezing rain'], 71: ['\ud83c\udf28\ufe0f', 'Light snow'], 73: ['\ud83c\udf28\ufe0f', 'Snow'], 75: ['\u2744\ufe0f', 'Heavy snow'],
    77: ['\ud83c\udf28\ufe0f', 'Snow grains'], 80: ['\ud83c\udf26\ufe0f', 'Showers'], 81: ['\ud83c\udf27\ufe0f', 'Showers'], 82: ['\u26c8\ufe0f', 'Heavy showers'],
    85: ['\ud83c\udf28\ufe0f', 'Snow showers'], 86: ['\u2744\ufe0f', 'Heavy snow showers'], 95: ['\u26c8\ufe0f', 'Thunderstorms'], 96: ['\u26c8\ufe0f', 'Storms + hail'], 99: ['\u26c8\ufe0f', 'Storms + hail']};
  function code(c) { return CODES[c] || ['\ud83c\udf21\ufe0f', '']; }
  function dir(deg) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg || 0) % 360) / 45) % 8]; }
  function hr(iso) { var h = +String(iso).slice(11, 13); return ((h % 12) || 12) + (h < 12 ? 'a' : 'p'); }
  function hm(iso) { var t = String(iso).slice(11, 16).split(':'), h = +t[0]; return ((h % 12) || 12) + ':' + t[1] + (h < 12 ? ' am' : ' pm'); }

  function locate() {
    return new Promise(function (res) {
      if (!navigator.geolocation) return res(W.pos || FALLBACK);
      navigator.geolocation.getCurrentPosition(function (p) {
        res({lat: Math.round(p.coords.latitude * 1000) / 1000, lon: Math.round(p.coords.longitude * 1000) / 1000});
      }, function () { res(W.pos || FALLBACK); }, {enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60000});
    });
  }

  function fetchWx(force) {
    if (W.busy || !navigator.onLine) return Promise.resolve();
    if (!force && W.data && Date.now() - W.at < 15 * 60000) return Promise.resolve();
    W.busy = true;
    return locate().then(function (pos) {
      var moved = !W.pos || Math.abs(W.pos.lat - pos.lat) > 0.02 || Math.abs(W.pos.lon - pos.lon) > 0.02;
      W.pos = pos; ls.set('wxPos', pos);
      var u = 'https://api.open-meteo.com/v1/forecast?latitude=' + pos.lat + '&longitude=' + pos.lon +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
        '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_gusts_10m_max,sunrise,sunset' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=3';
      var jobs = [fetch(u).then(function (r) { return r.json(); })];
      jobs.push(fetch('https://api.weather.gov/alerts/active?point=' + pos.lat + ',' + pos.lon, {headers: {Accept: 'application/geo+json'}})
        .then(function (r) { return r.json(); }).catch(function () { return null; }));
      if (pos.name) W.place = pos.name;
      else if (moved || !W.place) jobs.push(fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&lat=' + pos.lat + '&lon=' + pos.lon)
        .then(function (r) { return r.json(); }).then(function (j) {
          var a = (j && j.address) || {}; W.place = a.town || a.city || a.village || a.hamlet || a.county || 'Your location';
        }).catch(function () { W.place = W.place || 'Your location'; }));
      return Promise.all(jobs).then(function (rs) {
        if (!rs[0] || !rs[0].current) throw new Error('no data');
        W.data = rs[0]; W.at = Date.now();
        W.alerts = rs[1] && rs[1].features ? rs[1].features.map(function (f) {
          var p = f.properties || {}; return {event: p.event, headline: p.headline, ends: p.ends || p.expires, sev: p.severity};
        }) : [];
        ls.set('wx', W.data); ls.set('wxAt', W.at); ls.set('wxPlace', W.place); ls.set('wxAlerts', W.alerts);
        chip(); if (isOpen()) draw();
      });
    }).catch(function () {}).then(function () { W.busy = false; });
  }

  function chip() {
    var b = document.getElementById('wx-btn'); if (!b) return;
    if (!W.data) { b.innerHTML = '\u2601\ufe0f <span>Weather</span>'; return; }
    var c = W.data.current;
    b.innerHTML = code(c.weather_code)[0] + ' <span>' + Math.round(c.temperature_2m) + '\u00b0</span>' + (W.alerts.length ? ' <span style="color:var(--red)">\u26a0</span>' : '');
  }

  /** Plain-language heads-ups for the crew for the rest of today + tonight. */
  function headsUps(d) {
    var h = d.hourly, now = d.current.time.slice(0, 13), out = [];
    var idx = h.time.findIndex(function (t) { return t.slice(0, 13) >= now; }); if (idx < 0) idx = 0;
    var end = Math.min(h.time.length, idx + 18);
    function windows(test) {
      var w = [], s = -1;
      for (var i = idx; i < end; i++) { if (test(i)) { if (s < 0) s = i; } else if (s >= 0) { w.push([s, i - 1]); s = -1; } }
      if (s >= 0) w.push([s, end - 1]); return w;
    }
    function span(w) { return w.map(function (x) { return x[0] === x[1] ? hr(h.time[x[0]]) : hr(h.time[x[0]]) + '\u2013' + hr(h.time[x[1] + 1] || h.time[x[1]]); }).join(', '); }
    var frz = windows(function (i) { return h.temperature_2m[i] <= 32; });
    if (frz.length) out.push('\ud83e\uddca Freezing ' + span(frz) + ' (low ' + Math.round(Math.min.apply(null, h.temperature_2m.slice(idx, end))) + '\u00b0) \u2013 concrete, water lines, slick ground');
    var gust = windows(function (i) { return h.wind_gusts_10m[i] >= 30; });
    if (gust.length) out.push('\ud83d\udca8 Gusts 30+ mph ' + span(gust) + ' (up to ' + Math.round(Math.max.apply(null, h.wind_gusts_10m.slice(idx, end))) + ')');
    var wet = windows(function (i) { return h.precipitation_probability[i] >= 50; });
    var snowIn = h.snowfall.slice(idx, end).reduce(function (a, b) { return a + (b || 0); }, 0);   // inches (precipitation_unit=inch)
    var rainIn = h.precipitation.slice(idx, end).reduce(function (a, b) { return a + (b || 0); }, 0);
    if (wet.length) out.push((snowIn >= 0.5 ? '\ud83c\udf28\ufe0f Snow likely ' : '\ud83c\udf27\ufe0f Rain/snow likely ') + span(wet) +
      (snowIn >= 0.5 ? ' (~' + snowIn.toFixed(1) + ' in)' : rainIn >= 0.05 ? ' (~' + rainIn.toFixed(2) + ' in)' : ''));
    var ss = d.daily.sunset && d.daily.sunset[0];
    if (ss) out.push('\ud83c\udf05 Sunset ' + hm(ss) + (d.daily.sunrise ? ' \u00b7 sunrise ' + hm(d.daily.sunrise[1] || d.daily.sunrise[0]) + ' tomorrow' : ''));
    if (out.length === 1) out.unshift('\ud83d\udc4d No weather problems for the rest of today');
    return out;
  }

  function isOpen() { return !!document.getElementById('wx-sheet'); }
  function draw() {
    var body = document.getElementById('wx-sheet'); if (!body) return;
    if (!W.data) { body.innerHTML = '<div class="empty">Getting the weather for where you are\u2026</div>'; return; }
    var d = W.data, c = d.current, cc = code(c.weather_code), h = d.hourly;
    var idx = h.time.findIndex(function (t) { return t.slice(0, 13) >= c.time.slice(0, 13); }); if (idx < 0) idx = 0;
    var mins = Math.round((Date.now() - W.at) / 60000);
    var html = '<div class="kv">\ud83d\udccd ' + esc(W.place || 'Your location') + ' \u00b7 ' + Math.round(d.elevation * 3.281).toLocaleString() + ' ft \u00b7 updated ' +
      (mins < 1 ? 'just now' : mins + ' min ago') + ' <a href="#" id="wx-refresh">refresh</a></div>' +
      W.alerts.map(function (a) { return '<div class="card flagdown"><b>\u26a0\ufe0f ' + esc(a.event) + '</b><div class="sub" style="color:#ddd">' + esc(a.headline || '') + '</div></div>'; }).join('') +
      '<div class="row" style="align-items:center;margin:8px 0"><div style="font-size:54px;line-height:1">' + cc[0] + '</div><div style="margin-left:14px">' +
      '<div style="font:600 40px var(--sans)">' + Math.round(c.temperature_2m) + '\u00b0</div><div class="sub">' + esc(cc[1]) + ' \u00b7 feels ' + Math.round(c.apparent_temperature) + '\u00b0</div></div>' +
      '<div style="margin-left:auto;text-align:right" class="sub">\ud83d\udca8 ' + Math.round(c.wind_speed_10m) + ' mph ' + dir(c.wind_direction_10m) + '<br>gusts ' + Math.round(c.wind_gusts_10m) +
      '<br>\ud83d\udca7 ' + c.relative_humidity_2m + '% humidity</div></div>' +
      '<h3>Heads-up for the crew</h3><div class="card">' + headsUps(d).map(function (x) { return '<div style="margin:3px 0">' + esc(x) + '</div>'; }).join('') + '</div>' +
      '<h3>Next 12 hours</h3><div class="card" style="padding:6px 10px">';
    for (var i = idx; i < Math.min(h.time.length, idx + 12); i++) {
      var hc = code(h.weather_code[i]);
      html += '<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)"><div style="width:44px" class="sub">' + hr(h.time[i]) + '</div><div style="width:30px">' + hc[0] +
        '</div><div style="width:46px"><b>' + Math.round(h.temperature_2m[i]) + '\u00b0</b></div><div style="width:58px;color:var(--blue)" class="sub">' + (h.precipitation_probability[i] || 0) +
        '%</div><div class="sub grow" style="text-align:right">' + Math.round(h.wind_speed_10m[i]) + ' g' + Math.round(h.wind_gusts_10m[i]) + ' mph</div></div>';
    }
    html += '</div><h3>3 days</h3><div class="card" style="padding:6px 10px">';
    d.daily.time.forEach(function (t, i) {
      var dc = code(d.daily.weather_code[i]), dt = new Date(t + 'T12:00');
      var snow = d.daily.snowfall_sum[i] || 0;
      html += '<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="width:58px">' + (i === 0 ? 'Today' : dt.toLocaleDateString(undefined, {weekday: 'short'})) +
        '</div><div style="width:30px">' + dc[0] + '</div><div style="width:80px"><b>' + Math.round(d.daily.temperature_2m_max[i]) + '\u00b0</b> / ' + Math.round(d.daily.temperature_2m_min[i]) +
        '\u00b0</div><div class="sub grow" style="text-align:right">' + (d.daily.precipitation_probability_max[i] || 0) + '%' + (snow >= 0.3 ? ' \u00b7 ' + snow.toFixed(1) + ' in snow' : '') +
        ' \u00b7 gusts ' + Math.round(d.daily.wind_gusts_10m_max[i]) + '</div></div>';
    });
    html += '</div><div class="sub" style="margin:8px 2px">Based on your phone\u2019s location. Forecast: Open-Meteo \u00b7 alerts: National Weather Service.</div>' +
      '<div class="btns"><button class="btn" data-act="x">Close</button></div>';
    body.innerHTML = html;
    var r = document.getElementById('wx-refresh'); if (r) r.onclick = function (e) { e.preventDefault(); e.stopPropagation(); W.at = 0; fetchWx(true); toast('Updating\u2026'); };
  }

  function openWx() {
    A.sheet('<h2>Weather</h2><div id="wx-sheet"></div>', function () { A.closeSheet(); });
    draw();
    fetchWx(!W.data || Date.now() - W.at > 5 * 60000);
  }

  function build() {
    document.getElementById('top').insertAdjacentHTML('beforeend', '<button id="wx-btn" class="hbtn hleft wx" aria-label="Weather"></button>');
    document.getElementById('wx-btn').onclick = openWx;
    chip();
    // get location automatically only if already allowed; otherwise wait for a tap on the weather button
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({name: 'geolocation'}).then(function (p) { if (p.state === 'granted') fetchWx(); }).catch(function () {});
    } else if (W.data) fetchWx();
  }

  A.openWeather = openWx;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  setInterval(function () { if (!document.hidden && W.data) fetchWx(); }, 5 * 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && W.data) fetchWx(); });
})();
