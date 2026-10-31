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
 *    A price changed after Calculate, or figures typed with a third decimal,
 *    still print a summary that adds up, read back off the page itself.
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

// The figures PRINTED in the summary, read back off the page, must add up to the
// figure printed in the navy bar. Uses nothing but the page.
function foots(rec) {
  furniture(rec);
  const T = rec.texts, pos = (t) => t.page * 10000 + t.y;
  const hS = T.filter(t => t.str === HEAD.summary)[0];
  if (!hS) return ['no settlement summary on the page'];
  const amt = (label, tol) => { const l = T.filter(t => t.str === label && pos(t) > pos(hS))[0]; if (!l) return NaN; const a = T.filter(x => x !== l && !x.footer && x.page === l.page && x.align === 'right' && Math.abs(x.y - l.y) <= (tol || 0.01)); return a.length === 1 ? unmoney(a[0].str) : NaN; };
  const p = amt('Sale Price'), m = amt('Mortgage Payoff'), c = amt('Charges to Seller'), k = amt('Credits to Seller'), n = amt('Net Proceeds to the Seller', 1.5);
  if ([p, m, c, k, n].some(isNaN)) return ['a summary figure could not be read off the page: ' + [p, m, c, k, n].join(' ')];
  // payoff and charges print in parentheses (negative), except a zero
  return p + m + c + k === n ? [] : ['the printed summary does not add up: ' + [p, m, c, k].join(' + ') + ' is not ' + n];
}

// Checks one recorded PDF. Returns a list of problems; empty means right.
// Page furniture: the footer's three texts and a later page's heading. Named
// exactly, so body text that strays into the footer band is never excused.
const CONT = "Seller's Estimated Net Sheet, continued";
function furniture(rec) {
  rec.texts.forEach(t => {
    const foot = t.y > FOOT_TOP && (t.str === 'FORWARD Real Estate' || t.str === 'Corcoran McEnearney  |  fwrdrealestate.com' || /^(Page \d+ of \d+  \|  )?Prepared with FORWARD OS$/.test(t.str));
    const head = t.page > 1 && Math.abs(t.y - 44) < 0.01;
    t.footer = foot || head; t.head = head;
  });
}
// A printed amount back to cents: "$1,234.50", "($1,234.50)", "-$1,234.50".
const unmoney = (str) => { const m = /^(\()?(-)?\$([\d,]+)\.(\d\d)\)?$/.exec(str); if (!m) return NaN; const c = Number(m[3].replace(/,/g, '')) * 100 + Number(m[4]); return (m[1] || m[2]) ? -c : c; };

function check(rec, lines, salePrice, net) {
  const bad = [];
  if (!rec || !rec.texts || !rec.texts.length) return ['no PDF was drawn'];
  furniture(rec);
  const e = expected(lines, salePrice, net);
  const T = rec.texts, pos = (t) => t.page * 10000 + t.y;
  const find = (s) => T.filter(t => t.str === s);
  const one = (s) => { const f = find(s); if (f.length !== 1) bad.push('"' + s + '" is on the page ' + f.length + ' times'); return f[0]; };
  // the amount drawn on the same row as a label
  const amountOn = (t) => { const r = T.filter(x => x !== t && !x.footer && x.page === t.page && Math.abs(x.y - t.y) < 0.01 && x.align === 'right'); return r.length === 1 ? r[0] : null; };
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
  if (e.price - e.payoff - e.totCharges + e.totCredits !== e.net) bad.push('the recorded lines do not add up to the recorded net: ' + [e.price, e.payoff, e.totCharges, e.totCredits, e.net].join(' '));
  bad.push.apply(bad, foots(rec));
  // a total sits on the page of the last row of its group, never alone at the top of the next
  [[hC, tC, 'charges'], [hK, tK, 'credits']].forEach(g => {
    const rows = T.filter(t => t.align !== 'right' && !t.footer && pos(t) > pos(g[0]) && pos(t) < pos(g[1]));
    if (rows.length && rows[rows.length - 1].page !== g[1].page) bad.push('the ' + g[2] + ' total opens a page alone');
  });
  for (let pg = 2; pg <= rec.pages; pg++) if (T.filter(t => t.page === pg && t.head && t.str === CONT).length !== 1) bad.push('page ' + pg + ' does not say whose sheet it is');
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
          rec.texts.push({ str: String(s), page: doc.internal.getCurrentPageInfo().pageNumber, x: x, y: yy, align: align, left: left, right: left + w, size: size });
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
    const st = document.querySelector('#app').__vue_app__._instance.setupState; const __full = (j) => j === 'dc' ? '1 Test St NW, Washington, DC 20001' : String(j).indexOf('md-') === 0 ? '1 Test St, Rockville, MD 20850' : '1 Test St, Arlington, VA 22201'; const __addr = () => { if (!/\d{5}\s*$/.test(String(st.ns.address || ''))) st.ns.address = __full(st.ns.jurisdiction); };
    const tick = () => new Promise(r => setTimeout(r, 0));
    const out = [];
    for (const c of a.cases) {
      st.lstActiveProp = c.prop || null;
      Object.assign(st.ns, a.base, c.input, { result: null, breakdown: [], _propId: c.propId || null });
      await tick(); await tick();
      Object.assign(st.ns, { nsTaxH1Paid: c.input.nsTaxH1Paid || 'yes', nsTaxH2Paid: c.input.nsTaxH2Paid || 'yes' });
      __addr();   // since Oct 12, 2026 a sheet needs a full address in its own state; the address is not in the math
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
    address: '1926 Ruxton Road, Lot 7 Block C of the Ruxton Crossing Subdivision as recorded in Plat Book 14 Folio 2, Towson, Maryland 21204', unit: 'Penthouse 12B' };
  const light = { jurisdiction: 'va-other', salePrice: 300000, closingDate: '2026-12-15' };   // a closing date is required since Oct 30, 2026
  const loss = { jurisdiction: 'dc', salePrice: 500000, closingDate: '2026-06-15', loan1: 520000, sellerCompMode: 'pct', sellerCompVal: 2.5, buyerCompMode: 'pct', buyerCompVal: 2.5 };
  const novaLabel = { jurisdiction: 'va-nova', salePrice: 725000, closingDate: '2026-10-31', loan1: 511000, sellerCompMode: 'pct', sellerCompVal: 3, buyerCompMode: 'pct', buyerCompVal: 2.5, transactionFee: 495, concessionMode: 'flat', concessionVal: 15000, hoaAmount: 629, hoaPaidCurrent: 'yes', hoaResaleCert: 330, propTaxAnnual: 10144, otherCosts: 50, address: '635 Slaters Ln, Alexandria, VA 22314', unit: '405' };
  const prop = { id: 'p-1', address: '635 Slaters Ln, Alexandria, VA 22314', market: 'VA', seller_name: 'Jordan Sample', subfolder_drive_ids: { _co_seller: 'Riley Sample' } };
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
  ok(b.length === 0, 'no loan, no credits, no tax or HOA: Total Payoff is left out, credits says None, the summary shows a $0.00 payoff', b.slice(0, 4));
  ok(strs(1).indexOf('Not specified') < 0 && strs(1).some(x => /December 15, 2026|12\/15\/2026|Dec(ember)? 15, 2026/.test(x)) && built[1].rec.pages === 1, 'the Settlement Date prints the closing date (a sheet with none cannot be made since Oct 30, 2026)', strs(1).slice(0, 14));
  b = chk(2, loss);
  ok(b.length === 0 && built[2].net < 0 && strs(2).indexOf(money(cents(built[2].net))) >= 0, 'a sale that nets less than zero prints the negative figure in the navy bar (' + money(cents(built[2].net)) + ')', b.slice(0, 4));
  b = chk(3, novaLabel);
  ok(b.length === 0 && built[3].net === 156356.48, 'the Alexandria condo Marc reviewed on Oct 11, 2026: net $156,356.48, unchanged by the new layout', [built[3].net, b.slice(0, 3)]);
  ok(strs(3).indexOf('10/31/2026') >= 0, 'the settlement date prints month/day/year', strs(3).slice(0, 14));
  ok(built[3].rec.pages === 1, 'an ordinary sheet is one page', built[3].rec.pages);

  // Lines handed straight to the drawing step (nsGeneratePDFDoc, which draws the
  // sheet it is given and never calculates): a label far too long for its row, and
  // enough rows for three pages. No real sheet is this long; the page must still hold.
  // Since Oct 30, 2026 every sheet has a closing date, so the PDF step always
  // calculates again: change the price and a loan after Calculate and download,
  // and the page must be the sheet for the NEW figures, and must add up.
  const stale = await page.evaluate(async (a) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState; const __full = (j) => j === 'dc' ? '1 Test St NW, Washington, DC 20001' : String(j).indexOf('md-') === 0 ? '1 Test St, Rockville, MD 20850' : '1 Test St, Arlington, VA 22201'; const __addr = () => { if (!/\d{5}\s*$/.test(String(st.ns.address || ''))) st.ns.address = __full(st.ns.jurisdiction); };
    const tick = () => new Promise(r => setTimeout(r, 0));
    Object.assign(st.ns, a.base, { jurisdiction: 'va-nova', salePrice: 725000, closingDate: '2026-12-15', loan1: 511000, sellerCompMode: 'pct', sellerCompVal: 3, buyerCompMode: 'pct', buyerCompVal: 2.5, result: null, breakdown: [], _propId: null });
    await tick(); __addr(); st.calcNetSheet(); await tick(); await tick(); await tick();
    const net0 = st.ns.result;
    st.ns.salePrice = '800000'; st.ns.loan1 = '1'; await tick();
    window.__pdfs.length = 0; st.nsDownloadPDF(); await tick();
    const lines = JSON.parse(JSON.stringify(st.ns.breakdown)), net = st.ns.result;
    st.calcNetSheet(); await tick(); await tick(); await tick();
    return { rec: window.__pdfs[0] || null, lines, net, net0, fresh: st.ns.result };
  }, { base });
  b = stale.rec ? check(stale.rec, stale.lines, 800000, stale.net) : ['no PDF'];
  ok(b.length === 0 && stale.net !== stale.net0 && stale.net === stale.fresh && !stale.rec.texts.some(t => /725,000/.test(t.str)), 'a price and a loan changed after Calculate, then Download: the page is the $800,000 sheet, the same as Calculate gives, and adds up; $725,000 is nowhere on it', [stale.net0, stale.net, stale.fresh, b.slice(0, 4)]);

  // Figures typed with a third decimal, and a price typed with a dollar sign and
  // commas. Whatever is typed, the figures printed must add up to the net printed.
  const odd = await run([
    { input: Object.assign({}, novaLabel, { loan1: '100000.004', loan2: '50000.004' }) },
    { input: Object.assign({}, novaLabel, { salePrice: '725000.005' }) },
    { input: Object.assign({}, novaLabel, { salePrice: '$725,000' }) },
    { input: Object.assign({}, novaLabel, { salePrice: '725000.37', loan1: '511000.61', otherCosts: '50.19', hoaResaleCert: '330.45' }) }
  ]);
  ok(odd.every(x => x.pdfs === 1 && foots(x.rec).length === 0), 'loans or a price typed with a third decimal: the printed summary still adds up to the printed net', odd.map(x => foots(x.rec)));
  ok(odd.slice(0, 2).every(x => x.rec.texts.some(t => t.str === money(cents(x.net)))), 'and the net printed is the calculator\'s', odd.slice(0, 2).map(x => x.net));
  b = check(odd[2].rec, odd[2].lines, 725000, odd[2].net);
  ok(b.length === 0 && odd[2].net === 156356.48, 'a price typed as $725,000 prints as $725,000.00 and nets the same $156,356.48', [odd[2].net, b.slice(0, 3)]);
  b = check(odd[3].rec, odd[3].lines, 725000.37, odd[3].net);
  ok(b.length === 0, 'a price, a loan and two costs with cents: every figure to the cent, and it adds up', b.slice(0, 4));

  const longLabel = 'Property Tax Collection - 1st Half (unpaid, collected at settlement for the county treasurer office, second notice)';
  const fake = [{ label: '1st Loan Payoff', amount: 100000 }, { label: longLabel, amount: 1234567.89 }];
  for (let i = 1; i <= 78; i++) fake.push({ label: 'Made-up charge number ' + i, amount: 100 + i });
  fake.push({ label: 'Made-up credit', amount: -250.5 });
  const fakeNet = Math.round((5000000 - fake.reduce((s, l) => s + l.amount, 0)) * 100) / 100;
  const inj = await page.evaluate(async (a) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState; const __full = (j) => j === 'dc' ? '1 Test St NW, Washington, DC 20001' : String(j).indexOf('md-') === 0 ? '1 Test St, Rockville, MD 20850' : '1 Test St, Arlington, VA 22201'; const __addr = () => { if (!/\d{5}\s*$/.test(String(st.ns.address || ''))) st.ns.address = __full(st.ns.jurisdiction); };
    const tick = () => new Promise(r => setTimeout(r, 0));
    Object.assign(st.ns, a.base, { salePrice: 5000000, closingDate: '', jurisdiction: 'dc', _propId: null, breakdown: a.fake, result: a.net });
    await tick(); window.__pdfs.length = 0;
    __addr(); st.nsGeneratePDFDoc(); await tick();   // the drawing step itself: a made-up sheet is never calculated
    return { pdfs: window.__pdfs.length, rec: window.__pdfs[0] || null, lines: JSON.parse(JSON.stringify(st.ns.breakdown)) };
  }, { base, fake, net: fakeNet });
  b = inj.pdfs === 1 && JSON.stringify(inj.lines) === JSON.stringify(fake) ? check(inj.rec, fake, 5000000, fakeNet) : ['the PDF step did not draw the lines it was given'];
  ok(b.length === 0 && inj.rec.pages === 3, '80 rows run to three pages: every row once, nothing in a footer, the summary and net together on the last page', [inj.rec && inj.rec.pages, b.slice(0, 4)]);
  // Every length from 18 to 70 rows, so a page break falls on every possible row:
  // the last row and its total, a heading, the summary.
  const sweep = await page.evaluate(async (a) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState; const __full = (j) => j === 'dc' ? '1 Test St NW, Washington, DC 20001' : String(j).indexOf('md-') === 0 ? '1 Test St, Rockville, MD 20850' : '1 Test St, Arlington, VA 22201'; const __addr = () => { if (!/\d{5}\s*$/.test(String(st.ns.address || ''))) st.ns.address = __full(st.ns.jurisdiction); };
    const tick = () => new Promise(r => setTimeout(r, 0));
    const out = [];
    for (let n = 18; n <= 70; n++) for (const k of [0, 1, 3]) {
      const lines = [{ label: '1st Loan Payoff', amount: 100000 }];
      for (let i = 1; i <= n; i++) lines.push({ label: 'Made-up charge number ' + i, amount: 100 + i + 0.25 });
      for (let i = 1; i <= k; i++) lines.push({ label: 'Made-up credit number ' + i, amount: -(50 + i + 0.5) });
      const net = Math.round((5000000 - lines.reduce((s, l) => s + l.amount, 0)) * 100) / 100;
      Object.assign(st.ns, a.base, { salePrice: 5000000, closingDate: '', jurisdiction: 'dc', _propId: null, breakdown: lines, result: net });
      await tick(); window.__pdfs.length = 0; __addr(); st.nsGeneratePDFDoc(); await tick();
      out.push({ n, k, lines, net, rec: window.__pdfs[0] || null });
    }
    return out;
  }, { base });
  const sweepBad = sweep.map(x => ({ n: x.n, k: x.k, bad: x.rec ? check(x.rec, x.lines, 5000000, x.net) : ['no PDF'] })).filter(x => x.bad.length);
  ok(sweep.length === 159 && sweepBad.length === 0, '159 sheets of 18 to 70 rows with 0, 1 or 3 credits: wherever the page breaks, no total opens a page alone, nothing reaches the footer, every later page names the property', sweepBad.slice(0, 2));
  ok(new Set(sweep.map(x => x.rec.pages)).size >= 2, 'those sheets run to one, two and three pages (' + Array.from(new Set(sweep.map(x => x.rec.pages))).sort().join(', ') + ')', null);

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
  ok(/doc\.text\(nsMoney2\(ns\.result\), R, y \+ 29/.test(pdfSrc) && !/Gross Equity/.test(pdfSrc), 'the figure drawn in the navy bar is ns.result itself', null);
  ok(!/ns\.salePrice/.test(pdfSrc.replace(/\/\/[^\n]*/g, '')), 'the PDF code never reads the sale price box: it prints the price the sheet was calculated for', null);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
