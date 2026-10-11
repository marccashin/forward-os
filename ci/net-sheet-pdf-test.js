#!/usr/bin/env node
/*
 * FORWARD OS: the seller net sheet PDF. Run on every pull request.
 *
 * Since Oct 11, 2026 the PDF prints the calculated lines in three groups
 * (charges, credits, settlement summary) with the loan payoff beside the sale
 * price. The page holds no math: it sorts the lines nsCompute() returned.
 * This test opens the real index.html in headless Chromium, presses Calculate
 * for every recorded sheet in ci/net-sheet-golden.json plus a few built here,
 * and reads every piece of text the real jsPDF put on the page, with its
 * position and its real width.
 *
 * 1. THE PAGE SAYS WHAT THE CALCULATOR SAID. Every recorded line is on the page
 *    once, in the right group, with its amount to the penny. The group totals
 *    and the summary are checked against sums made HERE from the recorded JSON,
 *    not by the app. Sale price, less payoff, less charges, plus credits equals
 *    the recorded net, and that net is the figure in the navy bar.
 * 2. LAYOUT. Nothing runs past the margins or into the footer; no label touches
 *    its amount; the summary, the net and the disclaimer share a page; every
 *    page has the footer. Measured with real jsPDF widths, never estimated.
 * 3. THE SUMMARY BOX. No Gross Equity line (Marc, Oct 11, 2026). The seller's
 *    name prints only on a sheet opened from a listing, from that listing.
 *
 * SAFETY: never touches production. Every request is intercepted.
 * Usage: node ci/net-sheet-pdf-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'net-sheet-golden.json'), 'utf8'));
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 900) : '')); } }

// Independent of the app: cents as integers, and this file's own money format.
const cents = (n) => Math.round(Number(n) * 100);
const money = (c) => { const a = Math.abs(c); return (c < 0 ? '-' : '') + '$' + String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(a % 100).padStart(2, '0'); };
const paren = (c) => c > 0 ? '(' + money(c) + ')' : money(c);
const W = 612, H = 792, FOOT_TOP = H - 50;
const HEAD = { charges: 'CHARGES PAID BY SELLER', credits: 'CREDITS TO SELLER', summary: 'SETTLEMENT SUMMARY' };

// What the page must show for a set of calculated lines, worked out here.
function expected(lines, salePrice, net) {
  const loans = lines.filter(l => l.label === '1st Loan Payoff' || l.label === '2nd Loan Payoff');
  const credits = lines.filter(l => l.amount < 0);
  const charges = lines.filter(l => l.amount >= 0 && loans.indexOf(l) < 0);
  const sum = (a) => a.reduce((s, l) => s + Math.abs(cents(l.amount)), 0);
  return { loans, credits, charges, payoff: sum(loans), totCharges: sum(charges), totCredits: sum(credits), price: cents(salePrice), net: cents(net) };
}

// Checks one recorded PDF. Returns a list of problems; empty means right.
function check(rec, lines, salePrice, net) {
  const bad = [];
  if (!rec || !rec.texts || !rec.texts.length) return ['no PDF was drawn'];
  const e = expected(lines, salePrice, net);
  const T = rec.texts, pos = (t) => t.page * 10000 + t.y;
  const find = (s) => T.filter(t => t.str === s);
  const one = (s) => { const f = find(s); if (f.length !== 1) bad.push('"' + s + '" is on the page ' + f.length + ' times'); return f[0]; };
  // the amount drawn on the same row as a label
  const amountOn = (t) => { const r = T.filter(x => x !== t && x.page === t.page && Math.abs(x.y - t.y) < 0.01 && x.align === 'right'); return r.length === 1 ? r[0] : null; };
  const hC = one(HEAD.charges), hK = one(HEAD.credits), hS = one(HEAD.summary);
  const tC = one('Total Charges to Seller'), tK = one('Total Credits to Seller');
  const netLabel = one('Net Proceeds to the Seller');
  if (bad.length) return bad;
  if (!(pos(hC) < pos(tC) && pos(tC) < pos(hK) && pos(hK) < pos(tK) && pos(tK) < pos(hS) && pos(hS) < pos(netLabel))) bad.push('the groups are out of order');
  // every calculated line once, in its group, with its amount
  const used = new Set();
  const inGroup = (l, from, to, shown, group) => {
    const c = T.filter(t => t.str === l.label && !used.has(t) && pos(t) > pos(from) && pos(t) < pos(to));
    if (!c.length) { bad.push(group + ': "' + l.label + '" is missing'); return; }
    used.add(c[0]);
    const a = amountOn(c[0]);
    if (!a || a.str !== shown) bad.push(group + ': "' + l.label + '" shows ' + (a ? a.str : 'nothing') + ', expected ' + shown);
  };
  e.charges.forEach(l => inGroup(l, hC, tC, money(cents(l.amount)), 'charges'));
  e.credits.forEach(l => inGroup(l, hK, tK, money(-cents(l.amount)), 'credits'));
  // nothing else sits in a group: rows between a heading and its total = the lines expected
  const rowsBetween = (from, to) => T.filter(t => t.align !== 'right' && !t.footer && pos(t) > pos(from) && pos(t) < pos(to)).map(t => t.str);
  const cRows = rowsBetween(hC, tC), kRows = rowsBetween(hK, tK);
  if (cRows.length !== Math.max(e.charges.length, 1)) bad.push('charges holds ' + cRows.length + ' rows, expected ' + e.charges.length + ': ' + cRows.join(' | '));
  if (kRows.length !== Math.max(e.credits.length, 1)) bad.push('credits holds ' + kRows.length + ' rows, expected ' + e.credits.length + ': ' + kRows.join(' | '));
  if (!e.credits.length && kRows[0] !== 'None') bad.push('an empty credits group does not say None');
  if (cRows.some(s => /Loan Payoff/.test(s)) || kRows.some(s => /Loan Payoff/.test(s))) bad.push('a loan payoff is listed as a charge or a credit');
  // totals and the summary, against this file's own sums
  const rowIs = (label, shown, after) => {
    const c = T.filter(t => t.str === label && (!after || pos(t) > pos(after)));
    const a = c.length ? amountOn(c[c.length - 1]) : null;
    if (!a || a.str !== shown) bad.push('"' + label + '" shows ' + (a ? a.str : 'nothing') + ', expected ' + shown);
  };
  rowIs('Total Charges to Seller', money(e.totCharges));
  rowIs('Total Credits to Seller', money(e.totCredits));
  rowIs('Sale Price', money(e.price), hS);
  rowIs('Mortgage Payoff', paren(e.payoff), hS);
  rowIs('Charges to Seller', paren(e.totCharges), hS);
  rowIs('Credits to Seller', money(e.totCredits), hS);
  if (e.price - e.payoff - e.totCharges + e.totCredits !== e.net) bad.push('the summary does not add up to the net: ' + [e.price, e.payoff, e.totCharges, e.totCredits, e.net].join(' '));
  // the net is set larger than its label, one point lower on the same bar
  const netRow = T.filter(x => x.page === netLabel.page && x.align === 'right' && Math.abs(x.y - netLabel.y) <= 1.5);
  const netShown = netRow.length === 1 ? netRow[0] : null;
  if (!netShown || netShown.str !== money(e.net)) bad.push('the navy bar shows ' + (netShown ? netShown.str : 'nothing') + ', expected ' + money(e.net));
  // the box at the top: payoff rows and the sale price, above the first group
  const top = (label) => T.filter(t => t.str === label && pos(t) < pos(hC));
  e.loans.forEach(l => { const c = top(l.label); const a = c.length === 1 ? amountOn(c[0]) : null; if (!a || a.str !== paren(cents(l.amount))) bad.push('top box: "' + l.label + '" shows ' + (a ? a.str : 'nothing')); });
  const tp = top('Total Payoff');
  if (e.loans.length) { const a = tp.length === 1 ? amountOn(tp[0]) : null; if (!a || a.str !== paren(e.payoff)) bad.push('top box: Total Payoff shows ' + (a ? a.str : 'nothing')); }
  else if (tp.length) bad.push('top box: Total Payoff printed with no loan');
  const sp = top('Sale Price'); const spa = sp.length === 1 ? amountOn(sp[0]) : null;
  if (!spa || spa.str !== money(e.price)) bad.push('top box: Sale Price shows ' + (spa ? spa.str : 'nothing'));
  if (T.some(t => /gross equity/i.test(t.str))) bad.push('Gross Equity is on the page');
  if (T.some(t => /^[-+] \$/.test(t.str))) bad.push('an amount is printed with a plus or minus sign, as the old sheet did');
  // layout, from real jsPDF widths
  T.forEach(t => {
    if (t.left < 39.5 || t.right > W - 39.5) bad.push('"' + t.str.slice(0, 40) + '" runs outside the margins: ' + t.left.toFixed(1) + ' to ' + t.right.toFixed(1));
    if (!t.footer && t.y > FOOT_TOP - 8) bad.push('"' + t.str.slice(0, 40) + '" runs into the footer at y ' + t.y.toFixed(1));
  });
  T.filter(t => t.align === 'right' && !t.footer).forEach(a => {
    T.filter(l => l !== a && l.page === a.page && Math.abs(l.y - a.y) < 0.01 && l.align !== 'right').forEach(l => {
      if (l.right > a.left - 6) bad.push('"' + l.str.slice(0, 40) + '" touches its amount ' + a.str + ' (' + l.right.toFixed(1) + ' / ' + a.left.toFixed(1) + ')');
    });
  });
  const disc = T.filter(t => /^This is an estimate only/.test(t.str))[0];
  if (!disc) bad.push('the disclaimer is missing');
  else if (!(hS.page === netLabel.page && netLabel.page === disc.page && disc.page === rec.pages)) bad.push('summary, net and disclaimer are not together on the last page');
  if (find('FORWARD Real Estate').length !== rec.pages) bad.push('footer on ' + find('FORWARD Real Estate').length + ' of ' + rec.pages + ' pages');
  if (rec.pages > 1 && find('Page 1 of ' + rec.pages + '  |  Prepared with FORWARD OS').length !== 1) bad.push('more than one page and no page numbers');
  return bad;
}

(async () => {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(dir, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
    if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
    const t = route.request().resourceType();
    if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
    return J(route, 200, []);
  });
  await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); window.open = () => null; });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);

  // Record every text the real jsPDF draws: page, position, alignment, real width.
  await page.evaluate(() => {
    const Orig = window.jspdf.jsPDF;
    window.__pdfs = [];
    window.jspdf.jsPDF = function (opts) {
      const doc = new Orig(opts), rec = { texts: [], pages: 1 };
      const text = doc.text.bind(doc);
      doc.text = function (t, x, y, o) {
        const arr = Array.isArray(t) ? t : [t];
        const size = doc.getFontSize(), lh = size * doc.getLineHeightFactor();
        arr.forEach((s, i) => {
          const w = doc.getTextWidth(String(s)) + ((o && o.charSpace) ? o.charSpace * String(s).length : 0);
          const align = (o && o.align) || 'left';
          const left = align === 'right' ? x - w : x;
          const yy = y + i * lh;
          rec.texts.push({ str: String(s), page: doc.internal.getCurrentPageInfo().pageNumber, x: x, y: yy, align: align, left: left, right: left + w, size: size, footer: yy > 792 - 50 });
        });
        rec.pages = doc.getNumberOfPages();
        return text(t, x, y, o);
      };
      window.__pdfs.push(rec);
      return doc;
    };
  });
  const base = { address: '1 Test St', unit: '', firstTimeHomebuyerDC: 'no', loan1: '', loan2: '', sellerCompMode: 'pct', sellerCompVal: '', buyerCompMode: 'pct', buyerCompVal: '', transactionFee: '', concessionMode: 'pct', concessionVal: '', hoaFreq: 'monthly', hoaAmount: '', hoaPaidCurrent: 'no', hoaResaleCert: '', hoaTransferFee: '', propTaxAnnual: '', otherCosts: '', nsTaxH1Touched: true, nsTaxH2Touched: true, _detectedCounty: '', _detectedState: '' };
  const run = (cases) => page.evaluate(async (a) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const tick = () => new Promise(r => setTimeout(r, 0));
    const out = [];
    for (const c of a.cases) {
      st.lstActiveProp = c.prop || null;
      Object.assign(st.ns, a.base, c.input, { result: null, breakdown: [], _propId: c.propId || null });
      await tick(); await tick();
      Object.assign(st.ns, { nsTaxH1Paid: c.input.nsTaxH1Paid || 'yes', nsTaxH2Paid: c.input.nsTaxH2Paid || 'yes' });
      window.__pdfs.length = 0;
      st.calcNetSheet();
      await tick(); await tick(); await tick();
      out.push({ pdfs: window.__pdfs.length, rec: window.__pdfs[window.__pdfs.length - 1] || null, lines: JSON.parse(JSON.stringify(st.ns.breakdown)), net: st.ns.result });
    }
    st.lstActiveProp = null;
    return out;
  }, { cases, base });

  console.log('1. Every recorded sheet: the page says what the calculator said');
  const got = await run(GOLD.map(g => ({ input: g.input })));
  const byJur = {};
  let pagesSeen = {};
  GOLD.forEach((g, i) => {
    // checked against the RECORDED lines and net, not against what the app returned just now
    const bad = got[i].pdfs === 1 ? check(got[i].rec, g.lines, g.input.salePrice, g.net) : ['Calculate drew ' + got[i].pdfs + ' PDFs'];
    const j = g.input.jurisdiction; (byJur[j] = byJur[j] || { n: 0, bad: [] }).n++;
    if (bad.length) byJur[j].bad.push({ case: g.name, problems: bad.slice(0, 4) });
    if (got[i].rec) pagesSeen[got[i].rec.pages] = (pagesSeen[got[i].rec.pages] || 0) + 1;
  });
  Object.keys(byJur).forEach(j => ok(byJur[j].bad.length === 0, j + ': ' + byJur[j].n + ' sheets, every line in its group, totals, summary and net to the penny, layout inside the page', byJur[j].bad[0]));
  ok(GOLD.length === 116 && Object.keys(byJur).length === 28, '116 sheets across 28 jurisdictions were checked', [GOLD.length, Object.keys(byJur).length]);

  console.log('2. Built here: the heaviest sheet, the lightest, a loss, cents, long text');
  const heavy = { jurisdiction: 'md-baltimoreco', salePrice: 2000000, closingDate: '2026-09-22', loan1: 1250000.55, loan2: 180000, sellerCompMode: 'pct', sellerCompVal: 2.5, buyerCompMode: 'flat', buyerCompVal: 45000, transactionFee: 495, concessionMode: 'pct', concessionVal: 1.5, hoaFreq: 'quarterly', hoaAmount: 900, hoaPaidCurrent: 'yes', hoaResaleCert: 330, hoaTransferFee: 250, propTaxAnnual: 25146.72, nsTaxH1Paid: 'no', nsTaxH2Paid: 'no', otherCosts: 7500,
    address: '1926 Ruxton Road, Towson, Baltimore County, Maryland 21204, United States of America, with a very long legal description', unit: 'Penthouse 12B' };
  const light = { jurisdiction: 'va-other', salePrice: 300000, closingDate: '' };
  const loss = { jurisdiction: 'dc', salePrice: 500000, closingDate: '2026-06-15', loan1: 520000, sellerCompMode: 'pct', sellerCompVal: 2.5, buyerCompMode: 'pct', buyerCompVal: 2.5 };
  const novaLabel = { jurisdiction: 'va-nova', salePrice: 725000, closingDate: '2026-10-31', loan1: 511000, sellerCompMode: 'pct', sellerCompVal: 3, buyerCompMode: 'pct', buyerCompVal: 2.5, transactionFee: 495, concessionMode: 'flat', concessionVal: 15000, hoaAmount: 629, hoaPaidCurrent: 'yes', hoaResaleCert: 330, propTaxAnnual: 10144, otherCosts: 50, address: '635 Slaters Ln, Alexandria, VA 22314', unit: '405' };
  const prop = { id: 'p-1', address: '635 Slaters Ln, Alexandria, VA 22314', seller_name: 'Jordan Sample', subfolder_drive_ids: { _co_seller: 'Riley Sample' } };
  const built = await run([
    { input: heavy }, { input: light }, { input: loss }, { input: novaLabel },
    { input: novaLabel, prop: prop, propId: 'p-1' },
    { input: novaLabel, prop: prop, propId: 'p-other' },
    { input: novaLabel, prop: Object.assign({}, prop, { seller_name: '635 slaters ln, alexandria, va 22314', subfolder_drive_ids: null }), propId: 'p-1' },
    { input: novaLabel, prop: Object.assign({}, prop, { subfolder_drive_ids: null }), propId: 'p-1' }
  ]);
  const chk = (i, inp) => built[i].pdfs === 1 ? check(built[i].rec, built[i].lines, inp.salePrice, built[i].net) : ['Calculate drew ' + built[i].pdfs + ' PDFs'];
  const strs = (i) => built[i].rec.texts.map(t => t.str);
  let b = chk(0, heavy);
  ok(b.length === 0, 'two loans, every optional cost, both tax halves unpaid, a long address: right and inside the page', b.slice(0, 4));
  ok(built[0].lines.length >= 14, 'that sheet carries at least 14 calculated lines (' + built[0].lines.length + ')', built[0].lines.map(l => l.label));
  ok(built[0].rec.pages === 2 && strs(0).indexOf('Page 2 of 2  |  Prepared with FORWARD OS') >= 0, 'it runs to a second page, and both pages carry the footer and a page number', built[0].rec.pages);
  ok(strs(0).indexOf('1st Loan Payoff') >= 0 && strs(0).indexOf('2nd Loan Payoff') >= 0 && strs(0).indexOf('($1,430,000.55)') >= 0, 'both loans and their total, to the cent, are beside the sale price', strs(0).filter(s => /Loan|Payoff|\(/.test(s)));
  b = chk(1, light);
  ok(b.length === 0, 'no loan, no credits, no closing date: Total Payoff is left out, credits says None, the summary shows a $0.00 payoff', b.slice(0, 4));
  ok(strs(1).indexOf('Not specified') >= 0 && built[1].rec.pages === 1, 'with no closing date the Settlement Date says Not specified', strs(1).slice(0, 14));
  b = chk(2, loss);
  ok(b.length === 0 && built[2].net < 0 && strs(2).indexOf(money(cents(built[2].net))) >= 0, 'a sale that nets less than zero prints the negative figure in the navy bar (' + money(cents(built[2].net)) + ')', b.slice(0, 4));
  b = chk(3, novaLabel);
  ok(b.length === 0 && built[3].net === 156356.48, 'the Alexandria condo Marc reviewed on Oct 11, 2026: net $156,356.48, unchanged by the new layout', [built[3].net, b.slice(0, 3)]);
  ok(strs(3).indexOf('10/31/2026') >= 0, 'the settlement date prints month/day/year', strs(3).slice(0, 14));
  ok(built[3].rec.pages === 1, 'an ordinary sheet is one page', built[3].rec.pages);

  // Lines handed straight to the PDF step (with no closing date it draws the sheet
  // it is given and does not recalculate): a label far too long for its row, and
  // enough rows for three pages. No real sheet is this long; the page must still hold.
  const longLabel = 'Property Tax Collection - 1st Half (unpaid, collected at settlement for the county treasurer office, second notice)';
  const fake = [{ label: '1st Loan Payoff', amount: 100000 }, { label: longLabel, amount: 1234567.89 }];
  for (let i = 1; i <= 78; i++) fake.push({ label: 'Made-up charge number ' + i, amount: 100 + i });
  fake.push({ label: 'Made-up credit', amount: -250.5 });
  const fakeNet = Math.round((5000000 - fake.reduce((s, l) => s + l.amount, 0)) * 100) / 100;
  const inj = await page.evaluate(async (a) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const tick = () => new Promise(r => setTimeout(r, 0));
    Object.assign(st.ns, a.base, { salePrice: 5000000, closingDate: '', jurisdiction: 'dc', _propId: null, breakdown: a.fake, result: a.net });
    await tick(); window.__pdfs.length = 0;
    st.nsDownloadPDF(); await tick();
    return { pdfs: window.__pdfs.length, rec: window.__pdfs[0] || null, lines: JSON.parse(JSON.stringify(st.ns.breakdown)) };
  }, { base, fake, net: fakeNet });
  b = inj.pdfs === 1 && JSON.stringify(inj.lines) === JSON.stringify(fake) ? check(inj.rec, fake, 5000000, fakeNet) : ['the PDF step did not draw the lines it was given'];
  ok(b.length === 0 && inj.rec.pages === 3, '80 rows run to three pages: every row once, nothing in a footer, the summary and net together on the last page', [inj.rec && inj.rec.pages, b.slice(0, 4)]);
  const ll = inj.rec.texts.filter(t => t.str === longLabel)[0];
  ok(ll && ll.size < 9.5 && ll.size >= 6.5, 'a label too long for its row is printed whole in smaller type (' + (ll && ll.size) + 'pt), never cut and never over its amount', ll);

  console.log('3. The summary box');
  ok(strs(3).indexOf('Seller') < 0, 'a standalone net sheet prints no Seller row', strs(3).slice(0, 14));
  ok(strs(4).indexOf('Seller') >= 0 && strs(4).indexOf('Jordan Sample & Riley Sample') >= 0, 'opened from a listing, it prints that listing\'s seller and co-seller', strs(4).slice(0, 14));
  ok(strs(5).indexOf('Seller') < 0 && !strs(5).some(s => /Jordan/.test(s)), 'a sheet stamped with another listing never prints this listing\'s seller', strs(5).slice(0, 14));
  ok(strs(6).indexOf('Seller') < 0, 'a seller name that is only the address is not printed as a seller', strs(6).slice(0, 14));
  ok(strs(7).indexOf('Jordan Sample') >= 0, 'one seller, no co-seller: the one name', strs(7).slice(0, 14));
  ok(chk(4, novaLabel).length === 0, 'the Seller row changes no figure and breaks no layout', chk(4, novaLabel).slice(0, 3));
  ok(built.every(x => !x.rec.texts.some(t => /gross equity/i.test(t.str))), 'no sheet prints Gross Equity', null);
  const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const a0 = src.indexOf('function nsSheetGroups('), a1 = src.indexOf('function nsRecalcSilent(');
  const pdfSrc = a0 >= 0 && a1 > a0 ? src.slice(a0, a1) : '';
  ok(pdfSrc.length > 0 && !/transferTax|settlementFee|nsHoaItems|TaxItems|MD_RATES|0\.003|0\.0145/.test(pdfSrc), 'the PDF code holds no rate, fee or tax rule', pdfSrc.length);
  ok(/ns\.result/.test(pdfSrc) && !/Gross Equity/.test(src.slice(a0, a1)), 'the net in the navy bar is the calculator\'s own (ns.result)', null);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
