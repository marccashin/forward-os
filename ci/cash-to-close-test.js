#!/usr/bin/env node
/*
 * FORWARD OS: Cash to Close, the down payment and the loan (Oct 30, 2026).
 *
 * Until then a Cash (No Loan) purchase still counted only the 20% down payment,
 * so a $1,000,000 cash buyer was shown about $229,000 to bring, and a 0% down
 * payment (a VA loan) could not be entered: 0 turned back into 20.
 *
 * On the real index.html in headless Chromium, calcCashToClose() is run and every
 * expectation is worked out HERE, not read from the app:
 *   - cash: the first line is the whole price; no loan, lender, interest, mortgage
 *     insurance or escrow line; insurance is the first year's premium; the total is
 *     the sum of the lines; across all six jurisdictions.
 *   - VA with 0 down: no down payment, the loan is the price, funding fee 2.3%.
 *   - a blank percent means 20%, 0 means 0, a typed dollar amount wins.
 *   - conventional below 20% down has mortgage insurance, at 20% none.
 *   - the form hides the down payment boxes and escrow months for cash.
 *
 * Usage: node ci/cash-to-close-test.js <dir with index.html> [<base dir to compare>]
 * With a base dir, every FINANCED case with a percent other than 0 or blank must
 * give byte-identical lines and total on both (the regression proof).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2], baseDir = process.argv[3];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }

const JURS = ['dc', 'va-nova', 'va-other', 'md-montgomery', 'md-pgcounty', 'md-other'];
const LOANS = [['conventional', '20'], ['conventional', '10'], ['fha', '3.5'], ['va', '5'], ['va', '10'], ['usda', '20']];

async function runAll(appDir, browser, cases) {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(appDir, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
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
  await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); window.open = () => null; window.scrollTo = () => {}; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const out = await page.evaluate(async (cases) => {
    const app = document.querySelector('#app').__vue_app__;
    const st = app._instance.setupState;
    const tick = () => new Promise(r => setTimeout(r, 0));
    const res = [];
    for (const c of cases) {
      Object.assign(st.ctc, st.ctcBlank ? st.ctcBlank() : {}, { address: '1 Test St, Washington, DC 20001', purchasePrice: '1,000,000', closingDate: '', result: null, breakdown: [], sections: [] }, c.input);
      await tick();
      st.calcCashToClose(); await tick();
      res.push({ name: c.name, result: st.ctc.result, sections: JSON.parse(JSON.stringify(st.ctc.sections || [])) });
    }
    return res;
  }, cases);
  const form = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const tick = () => new Promise(r => setTimeout(r, 0));
    if (!st.go) return null;
    st.go('cash-to-close'); await tick(); await tick();
    st.ctc._showPrepaids = true; st.ctc.loanType = 'conventional'; await tick(); await tick();
    const fin = { downBox: !!Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === 'Down Payment %'), months: Array.from(document.querySelectorAll('label')).filter(l => /Months to Escrow/.test(l.textContent)).length, note: !!document.querySelector('[data-ctc-cash-note]') };
    st.ctc.loanType = 'cash'; await tick(); await tick();
    const cash = { downBox: !!Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === 'Down Payment %'), months: Array.from(document.querySelectorAll('label')).filter(l => /Months to Escrow/.test(l.textContent)).length, note: !!document.querySelector('[data-ctc-cash-note]') };
    return { fin, cash };
  });
  await ctx.close(); srv.close();
  return { out, form, errors };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const cases = [];
  for (const j of JURS) for (const cd of ['', '2026-12-15']) {
    cases.push({ name: 'cash ' + j + ' ' + (cd || 'no date'), kind: 'cash', input: { jurisdiction: j, loanType: 'cash', downPct: '20', closingDate: cd, homeInsurance: '4,800', propTax: '12,000', hoaDues: '450', earnestMoney: '25,000' } });
    for (const [lt, pct] of LOANS) cases.push({ name: lt + ' ' + pct + '% ' + j + ' ' + (cd || 'no date'), kind: 'fin', input: { jurisdiction: j, loanType: lt, downPct: pct, closingDate: cd, homeInsurance: '4,800', propTax: '12,000', hoaDues: '450', earnestMoney: '25,000' } });
  }
  cases.push({ name: 'va zero down dc', kind: 'va0', input: { jurisdiction: 'dc', loanType: 'va', downPct: '0', downAmt: '0' } });
  cases.push({ name: 'va zero down va-nova dated', kind: 'va0', input: { jurisdiction: 'va-nova', loanType: 'va', downPct: '0', downAmt: '', closingDate: '2026-12-15' } });
  cases.push({ name: 'blank percent conventional', kind: 'blank', input: { jurisdiction: 'dc', loanType: 'conventional', downPct: '', downAmt: '' } });
  cases.push({ name: 'typed dollars win', kind: 'typed', input: { jurisdiction: 'dc', loanType: 'conventional', downPct: '20', downAmt: '150,000' } });
  cases.push({ name: 'cash with a typed down payment left over', kind: 'cashTyped', input: { jurisdiction: 'dc', loanType: 'cash', downPct: '20', downAmt: '200,000' } });

  const head = await runAll(dir, browser, cases);
  const by = {}; head.out.forEach(r => { by[r.name] = r; });
  const lines = (r) => r.sections.flatMap(s => s.items);
  const sum = (r) => Math.round(lines(r).reduce((t, i) => t + i.amount, 0) * 100) / 100;
  const LOANY = /lender|loan|mortgage|interest|escrow|funding|guarantee|MIP|appraisal|underwriting|origination|credit report|flood|tax service|processing/i;

  console.log('1. Cash (No Loan): the whole price, no loan lines');
  const cashCases = cases.filter(c => c.kind === 'cash');
  const cashBad = cashCases.map(c => by[c.name]).filter(r => {
    const L = lines(r);
    return !(L[0].amount === 1000000 && /Purchase Price/.test(L[0].label) && r.sections[0].subtotal === 1000000
      && !L.slice(1).some(i => LOANY.test(i.label)) && L.some(i => /Homeowner's Insurance/.test(i.label) && i.amount === 4800)
      && r.result === sum(r));
  });
  ok(cashBad.length === 0, 'all 12 cash cases (6 jurisdictions, with and without a closing date): first line $1,000,000, no loan, lender, interest or escrow line, insurance $4,800 for the year, total = the lines', cashBad.map(r => ({ n: r.name, l: lines(r).slice(0, 3), t: r.result })).slice(0, 2));
  const dcCash = by['cash dc no date'];
  ok(dcCash && dcCash.result > 1000000 && dcCash.result < 1030000, 'a $1,000,000 cash purchase in DC shows more than $1,000,000 to bring (' + (dcCash && dcCash.result) + '), never about $229,000', dcCash && dcCash.result);
  const ct = by['cash with a typed down payment left over'];
  ok(ct && lines(ct)[0].amount === 1000000, 'a $200,000 down payment typed before switching to cash is ignored: the whole price counts', ct && lines(ct)[0]);

  console.log('2. The down payment');
  const v0 = by['va zero down dc'], v0n = by['va zero down va-nova dated'];
  const ff = (r) => (lines(r).find(i => /VA Funding Fee/.test(i.label)) || {});
  ok(v0 && lines(v0)[0].amount === 0 && /\(0%\)/.test(lines(v0)[0].label) && ff(v0).amount === Math.round(1000000 * 0.023), 'VA with 0 down: no down payment, the loan is the price, funding fee 2.3% = $23,000', v0 && [lines(v0)[0], ff(v0)]);
  ok(v0n && lines(v0n)[0].amount === 0 && ff(v0n).amount === 23000, 'the same in Northern Virginia with a closing date', v0n && [lines(v0n)[0], ff(v0n)]);
  const bl = by['blank percent conventional'];
  ok(bl && lines(bl)[0].amount === 200000 && /\(20%\)/.test(lines(bl)[0].label) && !lines(bl).some(i => /Mortgage Insurance/.test(i.label)), 'a blank percent is 20%, and at 20% conventional has no mortgage insurance', bl && [lines(bl)[0], lines(bl).filter(i => /Mortgage Insurance/.test(i.label))]);
  const ty = by['typed dollars win'];
  ok(ty && lines(ty)[0].amount === 150000 && /\(15%\)/.test(lines(ty)[0].label) && lines(ty).some(i => /Mortgage Insurance/.test(i.label)), 'a typed $150,000 wins over the 20% box, the label says 15%, and below 20% conventional has mortgage insurance', ty && lines(ty)[0]);
  const c10 = by['conventional 10% dc no date'], c20 = by['conventional 20% dc no date'];
  ok(c10 && lines(c10).some(i => /Mortgage Insurance/.test(i.label)) && c20 && !lines(c20).some(i => /Mortgage Insurance/.test(i.label)), 'conventional at 10% has mortgage insurance, at 20% none', null);

  console.log('3. The form');
  ok(head.form && head.form.fin.downBox && !head.form.fin.note && head.form.fin.months === 2, 'a loan shows the down payment boxes and both escrow months', head.form && head.form.fin);
  ok(head.form && !head.form.cash.downBox && head.form.cash.note && head.form.cash.months === 0, 'cash hides the down payment boxes and the escrow months and says the whole price is counted', head.form && head.form.cash);
  ok(head.errors.length === 0, 'no page errors', head.errors.slice(0, 3));

  if (baseDir) {
    console.log('4. Regression: every financed case with a down payment percent is unchanged from ' + baseDir);
    const base = await runAll(baseDir, browser, cases.filter(c => c.kind === 'fin'));
    const diff = base.out.filter(b => JSON.stringify({ r: b.result, s: b.sections }) !== JSON.stringify({ r: by[b.name].result, s: by[b.name].sections }));
    ok(base.out.length === 72 && diff.length === 0, base.out.length + ' financed cases (6 jurisdictions x 6 loans x with and without a date): lines, labels and totals byte-identical', diff.slice(0, 2).map(d => d.name));
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
