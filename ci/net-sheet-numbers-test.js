#!/usr/bin/env node
/*
 * FORWARD OS: the seller net sheet's numbers. Run on every pull request.
 *
 * Three things, on the real index.html in headless Chromium:
 *
 * 1. EXECUTED DOCUMENTS. The tax and HOA lines must match two settlement
 *    statements to the penny:
 *    - KVS Title, DC, 4200 Massachusetts Ave NW #106, $1,100,000, annual tax
 *      $10,526.64, HOA $5,176 a month. Closing 6/15/2026 (before the second-half
 *      due date): tax prorated $2,191.85, HOA credit $2,588.00, net $272,236.15.
 *      Closing 9/30/2026 with the second half unpaid: $5,263.32 collected, net
 *      $266,576.68; with it paid: no tax line.
 *      The loan ($755,500), 2.5% + 2.5% and the $495 fee are NOT read from the
 *      KVS sheet: they are the one set of round inputs that reproduces both KVS
 *      nets. The tax and HOA lines are the evidence; the nets are arithmetic.
 *    - Universal Title, Greater Baltimore, file 43-2026-10055, 1926 Ruxton Rd,
 *      $2,000,000, annual tax $25,146.72, settlement 9/22/2026: first-half bill
 *      $12,573.36 debited, $6,901.68 credited back for the buyer's 101 of 184 days.
 *
 * 2. EVERY JURISDICTION, LOCKED. ci/net-sheet-golden.json holds 116 cases (the
 *    four above plus four for each of the 28 jurisdictions) with every line and
 *    the net, recorded on Oct 5, 2026 from the app BEFORE the two calculators
 *    were merged into one. The app must reproduce every line and every net
 *    exactly. If a rate or rule is changed on purpose, the cases it moves must
 *    be re-recorded in the same pull request, and the PR must say why.
 *
 * 3. ONE CALCULATOR. The Calculate button and the PDF step give the same
 *    sheet, and the source holds the math once.
 *
 * SAFETY: never touches production. Every request is intercepted.
 * Usage: node ci/net-sheet-numbers-test.js <dir-with-index.html>
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
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }
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

  // Each case: fill the form, press Calculate, read the sheet at once, after the
  // PDF step has run, and after the PDF step is run once more by hand.
  const got = await page.evaluate(async (cases) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const tick = () => new Promise(r => setTimeout(r, 0));
    const snap = () => JSON.parse(JSON.stringify({ lines: st.ns.breakdown, net: st.ns.result }));
    const out = [];
    for (const c of cases) {
      Object.assign(st.ns, c.input, { result: null, breakdown: [], _propId: null });
      await tick(); await tick();
      Object.assign(st.ns, { nsTaxH1Paid: c.input.nsTaxH1Paid, nsTaxH2Paid: c.input.nsTaxH2Paid });
      st.calcNetSheet();
      const atOnce = snap();
      await tick(); await tick(); await tick();
      const afterPdf = snap();
      out.push({ atOnce, afterPdf });
    }
    return out;
  }, GOLD.map(g => ({ input: g.input })));

  const line = (r, re) => (r.lines.find(l => re.test(l.label)) || {}).amount;
  const taxLines = (r) => r.lines.filter(l => /tax/i.test(l.label) && !/transfer|grantor|recordation/i.test(l.label));

  console.log('1. Executed settlement statements');
  let r = got[0].afterPdf;
  ok(line(r, /Prorated Property Taxes/) === 2191.85, 'KVS 6/15: property tax prorated $2,191.85', taxLines(r));
  ok(line(r, /HOA/) === -2588, 'KVS 6/15: HOA credit to the seller $2,588.00', r.lines.filter(l => /HOA/.test(l.label)));
  ok(r.net === 272236.15, 'KVS 6/15: net $272,236.15', r.net);
  r = got[1].afterPdf;
  ok(line(r, /2nd Half \(unpaid\)/) === 5263.32 && taxLines(r).length === 1, 'KVS 9/30 unpaid: the full second half, $5,263.32, collected and nothing else', taxLines(r));
  ok(r.net === 266576.68, 'KVS 9/30 unpaid: net $266,576.68', r.net);
  r = got[2].afterPdf;
  ok(taxLines(r).length === 0, 'KVS 9/30 paid: no property tax line', taxLines(r));
  r = got[3].afterPdf;
  ok(line(r, /Collection - 1st Half/) === 12573.36, 'Universal Title 9/22: first-half bill $12,573.36 debited', taxLines(r));
  ok(line(r, /Proration - 1st Half/) === -6901.68, 'Universal Title 9/22: $6,901.68 credited back (buyer 101 of 184 days)', taxLines(r));
  ok(taxLines(r).length === 2 && Math.round((12573.36 - 6901.68) * 100) / 100 === 5671.68, 'Universal Title 9/22: two tax lines, seller cost $5,671.68', taxLines(r));

  console.log('2. Every jurisdiction reproduces its recorded sheet');
  const byJur = {};
  GOLD.forEach((g, i) => {
    const same = JSON.stringify(got[i].afterPdf.lines) === JSON.stringify(g.lines) && got[i].afterPdf.net === g.net;
    const j = g.input.jurisdiction; (byJur[j] = byJur[j] || { n: 0, bad: [] }).n++;
    if (!same) byJur[j].bad.push({ case: g.name, recorded: { net: g.net, lines: g.lines }, now: got[i].afterPdf });
  });
  Object.keys(byJur).forEach(j => ok(byJur[j].bad.length === 0, j + ': ' + byJur[j].n + ' cases, every line and net as recorded', byJur[j].bad[0]));
  ok(GOLD.length === 116 && Object.keys(byJur).length === 28, '116 cases across 28 jurisdictions were checked', [GOLD.length, Object.keys(byJur).length]);

  console.log('3. One calculator');
  const moved = got.filter(x => JSON.stringify(x.atOnce) !== JSON.stringify(x.afterPdf)).length;
  ok(moved === 0, 'the sheet shown the moment Calculate is pressed is the sheet the PDF step leaves (all 116 cases)', moved);
  const nodate = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState; const tick = () => new Promise(r => setTimeout(r, 0));
    Object.assign(st.ns, { salePrice: 800000, closingDate: '', jurisdiction: 'va-nova', loan1: 400000, sellerCompMode: 'flat', sellerCompVal: 20000, buyerCompMode: 'pct', buyerCompVal: 2.5, concessionMode: 'pct', concessionVal: 1, transactionFee: '', hoaAmount: '', propTaxAnnual: '', otherCosts: '', hoaResaleCert: '', hoaTransferFee: '', loan2: '', result: null, breakdown: [] });
    await tick(); st.calcNetSheet(); const a = JSON.stringify({ l: st.ns.breakdown, n: st.ns.result }); await tick(); await tick();
    return { same: a === JSON.stringify({ l: st.ns.breakdown, n: st.ns.result }), net: st.ns.result };
  });
  ok(nodate.same && nodate.net === 800000 - 2400 - 1400 - 400000 - 20000 - 20000 - 8000, 'with no closing date the sheet still calculates, and is right: $348,200', nodate);
  const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const fn = (name) => { const a = src.indexOf('function ' + name + '('); const b = src.indexOf('\n    }\n', a); return a < 0 ? '' : src.slice(a, b); };
  ok((src.match(/function nsCompute\(/g) || []).length === 1, 'the math is defined once (nsCompute)', null);
  ok(/nsCompute\(\)/.test(fn('calcNetSheet')) && !/transferTax|settlementFee|nsHoaItems|TaxItems/.test(fn('calcNetSheet')), 'the Calculate button calls it and holds no math of its own', fn('calcNetSheet').slice(0, 300));
  ok(/nsCompute\(\)/.test(fn('nsRecalcSilent')) && !/transferTax|settlementFee|nsHoaItems|TaxItems/.test(fn('nsRecalcSilent')), 'the PDF step calls it and holds no math of its own', fn('nsRecalcSilent').slice(0, 300));

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
