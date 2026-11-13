/* E10K app: 🎤 talk-to-type button on every text box (works without changing phone keyboard settings).
 * Uses the phone browser's built-in speech recognition (Chrome on Android, Safari on iPhone). Text is added
 * where the box left off; tap again to stop. Boxes that shouldn't get one can set data-nomic. */
(function () {
  'use strict';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;   // browser can't do it: no button
  var active = null;   // {rec, btn, el}

  // Stop right away on screen (Samsung/Android can take a long time to end, or never fire onend), then make sure the
  // phone really lets go of the mic.
  function done(a) {
    if (!a) return;
    a.btn.classList.remove('on'); a.btn.innerHTML = '\ud83c\udfa4';
    if (active === a) active = null;
  }
  function stop() {
    var a = active; if (!a) return;
    a.stopping = true; done(a);
    try { a.rec.stop(); } catch (e) {}
    setTimeout(function () { try { a.rec.abort(); } catch (e) {} delete a.btn.dataset.busy; }, 1200);
  }

  function start(el, btn) {
    if (active && active.el === el) return stop();
    stop();
    if (btn.dataset.busy) return;   // a double tap while the last one is still closing
    var rec = new SR();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    var base = el.value, me = null;
    function join(a, b) { return a && b && !/\s$/.test(a) ? a + ' ' + b : a + b; }
    // Rebuild from every result each time. Android Chrome / Samsung repeat earlier words inside later results in
    // continuous mode, so a piece that already contains what we have replaces it instead of being added again.
    function addFinal(acc, t) {
      var a = acc.toLowerCase(), b = t.toLowerCase();
      if (!a) return t;
      if (b.indexOf(a) === 0) return t;
      if (a.slice(-b.length) === b) return acc;
      return join(acc, t);
    }
    rec.onresult = function (e) {
      var interim = '', finalTxt = '';
      for (var i = 0; i < e.results.length; i++) {
        var t = String(e.results[i][0].transcript || '').trim(); if (!t) continue;
        if (e.results[i].isFinal) finalTxt = addFinal(finalTxt, t); else interim = join(interim, t);
      }
      if (interim && finalTxt && interim.toLowerCase().indexOf(finalTxt.toLowerCase()) === 0) interim = interim.slice(finalTxt.length).trim();
      var said = join(finalTxt, interim);
      if (said && (!base.trim() || /[.!?]\s*$/.test(base))) said = said.charAt(0).toUpperCase() + said.slice(1);
      el.value = join(base, said);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    };
    rec.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for this app to talk-to-type');
      else if (e.error === 'no-speech') toast('Didn\u2019t hear anything \u2013 tap \ud83c\udfa4 and try again');
      else if (e.error !== 'aborted' && !(me && me.stopping)) toast('Mic stopped (' + e.error + ')');
    };
    rec.onend = function () {
      delete btn.dataset.busy;
      if (active && active.rec === rec) done(active);
      el.dispatchEvent(new Event('change', {bubbles: true}));
    };
    try { rec.start(); } catch (e) { return toast('Mic not available right now'); }
    active = me = {rec: rec, btn: btn, el: el}; btn.dataset.busy = '1';
    btn.classList.add('on'); btn.innerHTML = '\u25cf Stop';
    if (navigator.vibrate) navigator.vibrate(30);
  }

  function toast(m) { if (window.E10K && window.E10K.toast) window.E10K.toast(m); }

  function decorate(el) {
    if (el.dataset.mic || el.dataset.nomic !== undefined || el.disabled || el.readOnly) return;
    if (el.tagName === 'INPUT' && !/^(text|search|)$/i.test(el.getAttribute('type') || '')) return;
    if (el.tagName === 'INPUT' && !el.closest('#sheet, .chat') ) return;   // plain inputs only inside forms
    if (el.classList.contains('search') || el.getAttribute('inputmode') === 'decimal' || el.getAttribute('inputmode') === 'numeric') return;
    el.dataset.mic = '1';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mic-btn' + (el.tagName === 'INPUT' ? ' mic-in' : ''); b.innerHTML = '\ud83c\udfa4'; b.setAttribute('aria-label', 'Talk to type');
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); start(el, b); });
    var wrap = document.createElement('div'); wrap.className = 'mic-wrap' + (el.tagName === 'INPUT' ? ' mic-wrap-in' : '');
    if (el.closest('.chat-bar')) wrap.className += ' mic-wrap-chat';
    el.parentNode.insertBefore(wrap, el); wrap.appendChild(el); wrap.appendChild(b);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('textarea, input')) decorate(root);
    Array.prototype.forEach.call(root.querySelectorAll('textarea, input'), decorate);
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); }); });
  }).observe(document.documentElement, {childList: true, subtree: true});
  scan(document.body);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
  // stop listening when a sheet closes
  document.addEventListener('click', function (e) { if (active && e.target.closest('[data-act]') ) stop(); }, true);
})();
