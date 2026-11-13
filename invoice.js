/* E10K invoice PDF (matches Hanna's Google Sheets "Blank Invoice" layout).
 * Works in the browser (window.E10KInvoice, needs window.PDFLib) and in node (module.exports).
 *
 *   E10KInvoice.build(PDFLib, inv, {logo: Uint8Array(png), receipts: [{caption, bytes, type}]}) -> Promise<Uint8Array>
 *
 * inv = {number, date: 'MM/DD/YYYY' | Date, billTo: ['Matt Mrowiec', 'optional line', ...],
 *        lines: [{desc, hours, rate, amount, noFee, onInvoice}], builderFeePct: 12 (or 0/blank), feeLabel: 'GC Fee',
 *        taxRate: % (optional), other: $ (optional), draft: 'DRAFT - NOT APPROVED' (optional red stamp)}
 * Lines with onInvoice === false are tracking only (bid jobs) and never printed; noFee lines are left out of the fee.
 * Totals (Hanna 11/07): Builder Fee = sum(lines) x pct, printed as the LAST item line (above SUBTOTAL);
 *         subtotal = lines + fee; sales tax = subtotal x taxRate; TOTAL = subtotal + tax + other.
 */
(function (root) {
  'use strict';
  var W = 612, H = 792;
  var L = 50, C1 = 354, C2 = 424, C3 = 505, R = 562;     // column edges (points)
  var TABLE_TOP = 225, TABLE_BOTTOM = 630, MIN_ROW = 20.25;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[$,\s]/g, ''), neg = /^\(.*\)$/.test(s);
    var n = parseFloat(s.replace(/[()]/g, ''));
    return isNaN(n) ? null : (neg ? -n : n);
  }
  function r2(x) { return Math.round(x * 100) / 100; }
  function money(n) {
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n < 0 ? '(' + s + ')' : s;
  }
  function qty(n) { return (Math.round(n * 100) / 100).toString(); }
  function longDate(d) {
    if (!d) return '';
    if (!(d instanceof Date)) {
      var p = String(d).split('/');
      if (p.length !== 3) return String(d);
      d = new Date(+p[2], +p[0] - 1, +p[1]);
    }
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /** Totals, the same math the app shows on screen. */
  function shownLines(inv) { return (inv.lines || []).filter(function (l) { return l.onInvoice !== false; }); }
  function totals(inv) {
    var shown = shownLines(inv);
    var items = r2(shown.reduce(function (a, l) { return a + (num(l.amount) || 0); }, 0));
    var feeBase = r2(shown.filter(function (l) { return !l.noFee; }).reduce(function (a, l) { return a + (num(l.amount) || 0); }, 0));
    var pct = num(inv.builderFeePct) || 0;
    var fee = pct ? r2(feeBase * pct / 100) : 0;
    var sub = r2(items + fee);
    var taxRate = num(inv.taxRate) || 0;
    var tax = taxRate ? r2(sub * taxRate / 100) : 0;
    var other = num(inv.other) || 0;
    return {items: items, feePct: pct, fee: fee, subtotal: sub, taxRate: taxRate, tax: tax, other: other, total: r2(sub + tax + other)};
  }

  function wrap(font, size, text, width) {
    var out = [];
    String(text || '').split(/\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(String), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(t, size) <= width) { line = t; return; }
        if (line) out.push(line);
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {   // very long word: hard break
          var k = w.length - 1;
          while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      });
      out.push(line);
    });
    return out;
  }

  // pdf-lib's standard fonts only encode WinAnsi: swap the usual typed characters that would throw.
  function clean(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...').replace(/\t/g, ' ').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');
  }

  function build(PDFLib, inv, opts) {
    opts = opts || {};
    var rgb = PDFLib.rgb, SF = PDFLib.StandardFonts;
    var GREY = rgb(0.5, 0.5, 0.5), LABEL = rgb(0.4, 0.4, 0.4), RED = rgb(1, 0, 0), BLACK = rgb(0, 0, 0),
      FAINT = rgb(0.85, 0.85, 0.85), SHADE = rgb(0.94, 0.94, 0.94);
    return PDFLib.PDFDocument.create().then(function (doc) {
      doc.setTitle('Invoice ' + inv.number);
      doc.setAuthor('Thomas Outdoors Inc.');
      doc.setCreator('E10K app');
      return Promise.all([doc.embedFont(SF.Helvetica), doc.embedFont(SF.HelveticaBold), doc.embedFont(SF.HelveticaBoldOblique),
        opts.logo ? doc.embedPng(opts.logo) : null]).then(function (f) {
        var F = f[0], B = f[1], BI = f[2], logo = f[3];
        var t = totals(inv), page, pages = [];

        function y(top) { return H - top; }
        function text(s, x, top, font, size, color) { page.drawText(clean(s), {x: x, y: y(top), size: size, font: font, color: color || BLACK}); }
        function textR(s, xr, top, font, size, color) { s = clean(s); text(s, xr - font.widthOfTextAtSize(s, size), top, font, size, color); }
        function textC(s, x0, x1, top, font, size, color) { s = clean(s); text(s, (x0 + x1) / 2 - font.widthOfTextAtSize(s, size) / 2, top, font, size, color); }
        function hline(x0, x1, top, color, th) { page.drawLine({start: {x: x0, y: y(top)}, end: {x: x1, y: y(top)}, thickness: th || 0.75, color: color || BLACK}); }
        function vline(x, t0, t1, color, th) { page.drawLine({start: {x: x, y: y(t0)}, end: {x: x, y: y(t1)}, thickness: th || 0.75, color: color || BLACK}); }
        function box(x0, t0, x1, t1, fill, border) {
          page.drawRectangle({x: x0, y: y(t1), width: x1 - x0, height: t1 - t0, color: fill || undefined,
            borderColor: border === false ? undefined : (border || BLACK), borderWidth: border === false ? 0 : 0.75});
        }

        // ---------- rows: wrap descriptions, then split across pages ----------
        var items = shownLines(inv).slice();
        if (t.feePct) items.push({desc: (inv.feeLabel || 'Builder Fee') + ' (' + qty(t.feePct) + '%)', amount: t.fee});
        var DS = 8.5, rows = items.map(function (l) {
          var d = wrap(F, DS, clean(l.desc), C1 - L - 8);
          return {l: l, desc: d, h: Math.max(MIN_ROW, 10 * d.length + 10)};
        });

        function firstPageHeader() {
          if (logo) {
            var lw = 84, lh = lw * logo.height / logo.width;
            page.drawImage(logo, {x: 60, y: y(56 + lh), width: lw, height: lh});
          }
          textR('INVOICE', C1 - 2, 95, F, 22, GREY);
          if (inv.draft) textR(String(inv.draft), R, 40, B, 10, RED);
          text('Thomas Outdoors Inc.', L + 2, 135, B, 15);
          text('DATE:', C1 + 2, 138, BI, 8, LABEL);
          box(C2, 120, C3, 139); text(longDate(inv.date), C2 + 3, 134, F, 8.5);
          text('INVOICE #', C1 + 2, 153, BI, 8, LABEL);
          box(C2, 139, C3, 156); text(String(inv.number || ''), C2 + 3, 152, F, 8.5);
          text('BILL TO:', C1 + 2, 166, BI, 8, RED);
          (inv.billTo || []).slice(0, 5).forEach(function (s, i) { text(s, C2 + 3, 166 + i * 10, F, 8.5, RED); });
          text('Please Make Checks Payable To:', L + 2, 166, B, 7.5);
          text('Thomas Outdoors, Inc.', L + 5 + B.widthOfTextAtSize('Please Make Checks Payable To:', 7.5), 166, F, 7.5);
          text('Mail Checks To:', L + 2, 184, B, 7.5);
          text('Spencer Thomas', L + 2, 193, F, 7.5);
          text('PO Box 1982', L + 2, 202, F, 7.5);
          text('Fairplay, Colorado 80440', L + 2, 211, F, 7.5);
        }
        function contHeader(n) {
          if (logo) { var lw = 50, lh = lw * logo.height / logo.width; page.drawImage(logo, {x: L, y: y(40 + lh), width: lw, height: lh}); }
          text('Thomas Outdoors Inc.', L + 60, 62, B, 12);
          textR('INVOICE # ' + inv.number + '  (page ' + n + ')', R, 62, F, 9, GREY);
        }
        function tableHeader(top) {
          textC('Description', L, C1, top + 8, F, 8.5); textC('Hours', C1, C2, top + 8, F, 8.5);
          textC('Rate', C2, C3, top + 8, F, 8.5); textC('AMOUNT', C3, R, top + 8, F, 8.5);
          return top + 10;
        }
        function drawRow(r, top) {
          var bot = top + r.h, base = bot - 6 - 10 * (r.desc.length - 1);
          r.desc.forEach(function (s, i) { text(s, L + 2, base + i * 10, F, DS); });
          var hrs = num(r.l.hours), rate = num(r.l.rate), amt = num(r.l.amount);
          if (hrs !== null) textR(qty(hrs), C2 - 4, bot - 6, F, DS);
          if (rate !== null) textR('$' + money(rate), C3 - 4, bot - 6, F, DS);
          if (amt !== null) { text('$', C3 + 4, bot - 6, F, DS); textR(money(amt), R - 5, bot - 6, F, DS); }
          return bot;
        }
        function gridFor(top, bot, lines) {
          hline(L, R, top); lines.forEach(function (b) { hline(L, R, b); });
          [L, C1, C2, C3, R].forEach(function (x) { vline(x, top, bot); });
        }

        // lay rows out page by page; the last page must leave room for the totals block
        var i = 0, pageNo = 0;
        while (true) {
          page = doc.addPage([W, H]); pages.push(page); pageNo++;
          var top;
          if (pageNo === 1) { firstPageHeader(); top = tableHeader(TABLE_TOP - 10); }
          else { contHeader(pageNo); top = tableHeader(80); }
          var start = top, cur = top, bottoms = [];
          var remainingH = rows.slice(i).reduce(function (a, r) { return a + r.h; }, 0);
          var lastPage = cur + remainingH <= TABLE_BOTTOM;
          var limit = lastPage ? TABLE_BOTTOM : H - 50;
          while (i < rows.length && cur + rows[i].h <= limit) { cur = drawRow(rows[i], cur); bottoms.push(cur); i++; }
          if (i < rows.length && !bottoms.length) { cur = drawRow(rows[i], cur); bottoms.push(cur); i++; }   // giant row
          if (i < rows.length || cur > TABLE_BOTTOM) { gridFor(start, cur, bottoms); continue; }
          // last page: blank ruled rows down to the totals, like the sheet
          while (cur + MIN_ROW <= TABLE_BOTTOM + 0.5) { cur += MIN_ROW; bottoms.push(cur); }
          gridFor(start, cur, bottoms);
          totalsBlock(cur);
          break;
        }

        function totalsBlock(top) {
          var rowsT = [];
          rowsT.push({label: 'SUBTOTAL', h: 19, amt: t.subtotal, side: true});
          var cur = top;
          rowsT.forEach(function (r) {
            textR(r.label, C3 - 3, cur + 13, BI, 8, LABEL);
            box(C3, cur, R, cur + r.h);
            text('$', C3 + 4, cur + 13, F, 8.5); textR(money(r.amt), R - 5, cur + 13, F, 8.5);
            cur += r.h;
          });
          // tax rate / sales tax / other / total (labels centered in the Hours column like the original)
          textC('TAX RATE', C1, C2, cur + 8, BI, 8, LABEL);
          box(C2, cur, C3, cur + 10, SHADE, false);
          if (t.taxRate) textR(qty(t.taxRate) + '%', C3 - 4, cur + 8, F, 8);
          cur += 10;
          textC('SALES TAX', C1, C2, cur + 8, BI, 8, LABEL);
          box(C2, cur, C3, cur + 10, SHADE, false);
          if (t.tax) { text('$', C2 + 4, cur + 8, F, 8); textR(money(t.tax), C3 - 4, cur + 8, F, 8); }
          cur += 10;
          var footTop = cur;
          text('If you have any questions concerning this invoice, contact Spencer Thomas,', L + 2, cur + 9, F, 7.5);
          text('Spencer@ptbreck.com', L + 2, cur + 18, F, 7.5);
          textC('OTHER', C1, C2, cur + 17, BI, 8, LABEL);
          if (t.other) { text('$', C2 + 4, cur + 17, F, 8); textR(money(t.other), C3 - 4, cur + 17, F, 8); }
          cur += 22;
          text('THANK YOU FOR YOUR BUSINESS!', L + 2, cur + 13, BI, 7.5);
          textC('TOTAL', C1, C2, cur + 13, BI, 8);
          box(C2, cur, C3, cur + 19, SHADE, false);
          text('$', C2 + 4, cur + 13, B, 8.5); textR(money(t.total), C3 - 4, cur + 13, B, 8.5);
          cur += 19;
          void footTop;
        }

        // ---------- receipts appendix ----------
        var recs = opts.receipts || [];
        var chain = Promise.resolve();
        recs.forEach(function (rc, k) {
          chain = chain.then(function () {
            var cap = clean(rc.caption || ('Receipt ' + (k + 1)));
            var head = 'Invoice #' + inv.number + ' - receipt ' + (k + 1) + ' of ' + recs.length;
            if (rc.type === 'application/pdf') {
              return PDFLib.PDFDocument.load(rc.bytes, {ignoreEncryption: true}).then(function (src) {
                return doc.copyPages(src, src.getPageIndices()).then(function (cp) {
                  cp.forEach(function (p, j) {
                    doc.addPage(p); page = p;
                    var ph = p.getHeight(), pw = p.getWidth();
                    p.drawRectangle({x: 0, y: ph - 16, width: pw, height: 16, color: rgb(1, 1, 1), opacity: 0.85});
                    p.drawText(clean(head + (cp.length > 1 ? ' (p' + (j + 1) + ')' : '') + ' - ' + cap).slice(0, 140),
                      {x: 8, y: ph - 11, size: 7, font: F, color: BLACK});
                  });
                });
              }).catch(function () { missing(cap, head, 'could not open this PDF'); });
            }
            var emb = rc.type === 'image/png' ? doc.embedPng(rc.bytes) : doc.embedJpg(rc.bytes);
            return emb.then(function (img) {
              page = doc.addPage([W, H]);
              text(head, L, 40, B, 9);
              wrap(F, 8.5, cap, R - L).slice(0, 3).forEach(function (s, j) { text(s, L, 52 + j * 10, F, 8.5, LABEL); });
              var maxW = R - L, maxH = H - 90 - 40, sc = Math.min(maxW / img.width, maxH / img.height, 1.5);
              var w = img.width * sc, h = img.height * sc;
              page.drawImage(img, {x: L + (maxW - w) / 2, y: 40 + (maxH - h), width: w, height: h});
            }).catch(function () { missing(cap, head, 'could not read this image'); });
          });
        });
        function missing(cap, head, why) {
          page = doc.addPage([W, H]);
          text(head, L, 40, B, 9); text(cap, L, 52, F, 8.5, LABEL); text('(' + why + ' - see the Receipt Link in the Hub)', L, 70, F, 8.5, RED);
        }
        return chain.then(function () { return doc.save(); });
      });
    });
  }

  var api = {build: build, totals: totals, money: money, longDate: longDate, num: num};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.E10KInvoice = api;
})(typeof window !== 'undefined' ? window : this);
