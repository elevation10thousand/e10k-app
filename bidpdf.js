/* E10K bid / proposal PDF (client-facing). Same look as the invoice (invoice.js).
 *   E10KBid.build(PDFLib, bid, {logo: Uint8Array(png)}) -> Promise<Uint8Array>
 * bid = {number, date, validDays, client: [lines], project: [lines], scope, exclusions, showLines, draft,
 *        groups: [{cat, price, lines: [{item, qty, unit, price}]}], contingency: $, total: $}
 * Prices already include markup; costs and markup are never printed. */
(function (root) {
  'use strict';
  var W = 612, H = 792, L = 50, R = 562;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function money(n) { var s = Math.abs(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (n < 0 ? '-$' : '$') + s; }
  function pd(d) { if (!d) return null; if (d instanceof Date) return d; var p = String(d).split('/'); if (p.length !== 3) return null; var y = +p[2]; if (y < 100) y += 2000; return new Date(y, +p[0] - 1, +p[1]); }
  function longDate(d) { d = pd(d); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() : ''; }
  function clean(s) { return String(s === undefined || s === null ? '' : s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00d7/g, 'x').replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, ''); }
  function wrap(font, size, text, width) {
    var out = [];
    clean(text).split(/\r?\n/).forEach(function (para) {
      var words = para.split(/\s+/), line = '';
      if (!para.trim()) { out.push(''); return; }
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) <= width) line = t;
        else { if (line) out.push(line); while (font.widthOfTextAtSize(w, size) > width && w.length > 1) { var k = w.length; while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--; out.push(w.slice(0, k)); w = w.slice(k); } line = w; }
      });
      out.push(line);
    });
    return out;
  }
  function build(PDFLib, bid, opts) {
    opts = opts || {};
    var rgb = PDFLib.rgb, SF = PDFLib.StandardFonts, GREY = rgb(0.45, 0.45, 0.45), RED = rgb(1, 0, 0), BLACK = rgb(0, 0, 0), SHADE = rgb(0.94, 0.94, 0.94), RULE = rgb(0.8, 0.8, 0.8);
    return PDFLib.PDFDocument.create().then(function (doc) {
      doc.setTitle('Bid ' + bid.number); doc.setAuthor('Thomas Outdoors Inc.'); doc.setCreator('E10K app');
      return Promise.all([doc.embedFont(SF.Helvetica), doc.embedFont(SF.HelveticaBold), doc.embedFont(SF.HelveticaOblique), opts.logo ? doc.embedPng(opts.logo) : null]).then(function (f) {
        var F = f[0], B = f[1], I = f[2], logo = f[3], page, top, pageNo = 0;
        function y(t) { return H - t; }
        function text(s, x, t, font, size, color) { page.drawText(clean(s), {x: x, y: y(t), size: size, font: font, color: color || BLACK}); }
        function textR(s, xr, t, font, size, color) { s = clean(s); text(s, xr - font.widthOfTextAtSize(s, size), t, font, size, color); }
        function hline(t, color, th) { page.drawLine({start: {x: L, y: y(t)}, end: {x: R, y: y(t)}, thickness: th || 0.6, color: color || BLACK}); }
        function newPage() {
          page = doc.addPage([W, H]); pageNo++;
          if (pageNo === 1) return;
          if (logo) { var lw = 46, lh = lw * logo.height / logo.width; page.drawImage(logo, {x: L, y: y(36 + lh), width: lw, height: lh}); }
          text('Thomas Outdoors Inc.', L + 56, 56, B, 11); textR('BID # ' + bid.number + '  (page ' + pageNo + ')', R, 56, F, 9, GREY);
          if (bid.draft) textR(bid.draft, R, 34, B, 9, RED);
          top = 90;
        }
        function need(h) { if (top + h > H - 60) newPage(); }
        newPage();
        if (logo) { var lw = 84, lh = lw * logo.height / logo.width; page.drawImage(logo, {x: 60, y: y(50 + lh), width: lw, height: lh}); }
        textR('BID / PROPOSAL', R, 80, F, 20, GREY);
        if (bid.draft) textR(bid.draft, R, 38, B, 10, RED);
        text('Thomas Outdoors Inc.', L + 2, 140, B, 15);
        text('Elevation 10 Thousand  |  PO Box 1982, Fairplay, CO 80440  |  Spencer@ptbreck.com', L + 2, 154, F, 8, GREY);
        textR('Bid #: ' + bid.number, R, 104, F, 9); textR('Date: ' + longDate(bid.date), R, 116, F, 9);
        var vd = pd(bid.date); if (vd && bid.validDays) { vd = new Date(vd.getTime() + bid.validDays * 864e5); textR('Good through: ' + longDate(vd), R, 128, F, 9); }
        top = 178;
        text('PREPARED FOR', L + 2, top, B, 8, GREY); text('PROJECT', 320, top, B, 8, GREY);
        var cl = (bid.client || []).filter(Boolean), pj = (bid.project || []).filter(Boolean);
        for (var i = 0; i < Math.max(cl.length, pj.length, 1); i++) {
          if (cl[i]) text(cl[i], L + 2, top + 13 + i * 11, i ? F : B, 9.5);
          if (pj[i]) wrap(i ? F : B, 9.5, pj[i], R - 320).slice(0, 1).forEach(function (s) { text(s, 320, top + 13 + i * 11, i ? F : B, 9.5); });
        }
        top += 18 + Math.max(cl.length, pj.length, 1) * 11 + 8;
        if (bid.scope) {
          need(30); text('SCOPE OF WORK', L + 2, top, B, 9); top += 13;
          wrap(F, 9, bid.scope, R - L - 4).forEach(function (s) { need(12); text(s, L + 2, top, F, 9); top += 11.5; });
          top += 8;
        }
        // price table
        need(40);
        page.drawRectangle({x: L, y: y(top + 6), width: R - L, height: 16, color: SHADE});
        text('DESCRIPTION', L + 6, top + 2, B, 8.5); textR('AMOUNT', R - 6, top + 2, B, 8.5); top += 22;
        (bid.groups || []).forEach(function (g) {
          need(18);
          text(g.cat, L + 6, top, B, 9.5); textR(money(g.price), R - 6, top, B, 9.5); top += 13;
          if (bid.showLines) (g.lines || []).forEach(function (l) {
            var d = l.item + (l.qty !== null && l.qty !== undefined && l.unit ? '  (' + (Math.round(l.qty * 100) / 100) + ' ' + l.unit + ')' : '');
            wrap(F, 8.5, d, R - L - 120).forEach(function (s, k) { need(11); text(s, L + 18, top, F, 8.5, GREY); if (!k) textR(money(l.price), R - 70, top, F, 8.5, GREY); top += 10.5; });
          });
          hline(top - 4, RULE, 0.5); top += 6;
        });
        if (bid.contingency) { need(18); text('Contingency', L + 6, top, B, 9.5); textR(money(bid.contingency), R - 6, top, B, 9.5); top += 13; hline(top - 4, RULE, 0.5); top += 6; }
        need(30); hline(top - 2, BLACK, 1);
        text('TOTAL BID', L + 6, top + 13, B, 11); textR(money(bid.total), R - 6, top + 13, B, 12); top += 32;
        if (bid.exclusions) {
          need(30); text('NOT INCLUDED', L + 2, top, B, 9); top += 13;
          wrap(F, 8.5, bid.exclusions, R - L - 4).forEach(function (s) { need(11); text(s, L + 2, top, F, 8.5); top += 11; });
          top += 8;
        }
        var terms = 'This bid is based on the scope above and site conditions known today. Changes in scope, hidden conditions (rock, groundwater, frost) or ' +
          'material price changes are handled by written change order. Prices are good for ' + (bid.validDays || 30) + ' days.';
        need(40); wrap(I, 8, terms, R - L - 4).forEach(function (s) { text(s, L + 2, top, I, 8, GREY); top += 10; });
        top += 22; need(60);
        text('ACCEPTED BY', L + 2, top, B, 8.5, GREY); top += 30;
        page.drawLine({start: {x: L + 2, y: y(top)}, end: {x: 300, y: y(top)}, thickness: 0.6, color: BLACK});
        page.drawLine({start: {x: 340, y: y(top)}, end: {x: R, y: y(top)}, thickness: 0.6, color: BLACK});
        text('Signature', L + 2, top + 11, F, 8, GREY); text('Date', 340, top + 11, F, 8, GREY);
        top += 30; text('Thank you for the opportunity - Spencer Thomas', L + 2, top, I, 9);
        return doc.save();
      });
    });
  }
  var api = {build: build, money: money};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.E10KBid = api;
})(typeof window !== 'undefined' ? window : this);
