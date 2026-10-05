#!/usr/bin/env node
/*
 * FORWARD OS: every listing opens its own net sheet.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium with three made-up listings,
 * each with its own MLS Data note, and walks from one to the next the way an
 * agent does. A net sheet left open on one listing must never show on another,
 * and the form must fill from the MLS Data of the listing it is opened in.
 *
 * Why: until Oct 5, 2026 a net sheet panel left open on one listing stayed
 * open on the next listing, still holding the first listing's address and
 * figures (7532 Coxton Ct showed on 1415 Riverside Ave).
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/net-sheet-listing-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Unit G-127, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Ashling McGowan', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' },
  { id: C, address: '300 Charlie St NW, Washington, DC 20001', seller_name: 'Seller C', agent_name: 'Charlotte Lee', market: 'DC', status: 'draft', created_at: '2026-09-20T00:00:00Z' }
];
const mls = (addr, price, hoa) => ['=== MLS DATA ===', 'Property Address : ' + addr, 'List Price       : ' + price, 'Bedrooms         : 3', 'Bathrooms        : 2', 'Square Footage   : 1,800 sq ft', 'Year Built       : 1990', 'HOA Fee          : ' + hoa, 'Property Type    : Condo', 'Parking          : 1', '', '--- Key Features ---', '1. One'].join('\n');
const NOTES = [
  { id: 1, property_id: A, subfolder: 'mls_data', content: mls(PROPS[0].address, '$425,000', '$310/month'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 2, property_id: B, subfolder: 'mls_data', content: mls(PROPS[1].address, '500000', 'None'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 3, property_id: C, subfolder: 'mls_data', content: mls(PROPS[2].address, '1.2M', '$807'), updated_at: '2026-10-01T00:00:00Z' }
];
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, NOTES.filter(n => u.includes(n.property_id)));
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 500) : '')); } }
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
    return api(route);
  });
  await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);

  // Runs steps inside the page. Each step returns what the agent would see.
  const run = (fn, arg) => page.evaluate(fn, arg);
  const see = () => run(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const box = document.getElementById('ns-address-input-detail');
    return { open: st.lstToolOpen, header: st.lstActiveProp && st.lstActiveProp.address, boxOnScreen: !!box, box: box ? box.value : null,
      address: st.ns.address, salePrice: String(st.ns.salePrice), loan1: String(st.ns.loan1), hoa: String(st.ns.hoaAmount), jur: st.ns.jurisdiction,
      propId: st.ns._propId, result: st.ns.result, prDate: st.pr.listDate, prPrice: String(st.pr.price) };
  });
  const openListing = (id) => run(async (id) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!st.lstProperties.length) await st.lstFetchProperties();
    await st.lstOpenProperty(st.lstProperties.find(p => p.id === id));
    await new Promise(r => setTimeout(r, 150));
  }, id);
  const clickNetSheet = () => run(async () => {
    const hdr = Array.from(document.querySelectorAll('.subfolder-header')).find(h => /Seller Net Sheet/i.test(h.innerText));
    hdr.click(); await new Promise(r => setTimeout(r, 150));
  });

  console.log('Listing A: its own net sheet, filled from its own MLS Data');
  await openListing(A); await clickNetSheet();
  let s = await see();
  ok(s.open === 'netsheet' && s.box === PROPS[0].address, 'A: the form shows A\'s address', s);
  ok(s.salePrice === '425000', 'A: sale price starts at A\'s MLS list price ($425,000)', s.salePrice);
  ok(s.hoa === '310', 'A: HOA dues come from A\'s MLS Data', s.hoa);
  ok(s.jur === 'va-nova' || s.jur === 'va-other', 'A: Virginia', s.jur);

  console.log('Agent types figures on A, calculates, and leaves the panel open');
  await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ns.salePrice = '431000'; st.ns.loan1 = '300000'; st.ns.closingDate = '2026-10-31'; st.calcNetSheet(); st.pr.listDate = '2026-09-01'; st.pr.price = '431000'; });
  s = await see();
  ok(s.result !== null && s.loan1 === '300000', 'A: sheet calculated with the typed figures', s);
  await clickNetSheet(); await clickNetSheet();
  s = await see();
  ok(s.salePrice === '431000' && s.loan1 === '300000', 'A: closing and reopening the panel keeps what the agent typed (MLS price does not replace it)', s);

  console.log('Back to All Listings, open B without clicking anything');
  await run(() => { document.querySelector('#app').__vue_app__._instance.setupState.go('listings'); });
  await openListing(B);
  s = await see();
  ok(s.header === PROPS[1].address, 'B: header says B', s.header);
  ok(s.open === null && !s.boxOnScreen, 'B: opens with no tool panel open', s);
  ok(s.address !== PROPS[0].address && s.loan1 === '' && s.result === null && s.propId !== A, 'B: nothing of A\'s net sheet is left in the form', s);
  ok(s.prDate === '' && s.prPrice === '', 'B: Price Reduction Planner starts blank', s);

  console.log('Click Seller Net Sheet on B, once');
  await clickNetSheet();
  s = await see();
  ok(s.open === 'netsheet' && s.box === PROPS[1].address, 'B: one click opens the form with B\'s address', s);
  ok(s.salePrice === '500000', 'B: sale price starts at B\'s MLS list price', s.salePrice);
  ok(s.loan1 === '' && s.hoa === '' && s.result === null, 'B: no loan, no HOA (B has none), nothing calculated', s);
  ok(s.jur.indexOf('md-') === 0 && s.propId === B, 'B: Maryland, and the form belongs to B', s);

  console.log('Straight from B (panel open) to C, then back to A');
  await openListing(C);
  s = await see();
  ok(s.open === null && s.address !== PROPS[1].address, 'C: opens closed, B\'s form is gone', s);
  await clickNetSheet();
  s = await see();
  ok(s.box === PROPS[2].address && s.jur === 'dc', 'C: its own address, DC', s);
  ok(s.salePrice === '', 'C: a list price that is not a plain dollar figure ("1.2M") leaves the sale price blank', s.salePrice);
  ok(s.hoa === '807', 'C: HOA from C\'s MLS Data', s.hoa);
  await openListing(A); await clickNetSheet();
  s = await see();
  ok(s.box === PROPS[0].address && s.salePrice === '425000' && s.loan1 === '' && s.hoa === '310', 'A again: a fresh form from A\'s MLS Data, nothing of C\'s', s);

  console.log('The standalone net sheet never shows a listing\'s form');
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.view = 'just-listed'; await new Promise(r => setTimeout(r, 300)); st.lpOpen('netsheet'); await new Promise(r => setTimeout(r, 400)); });
  s = await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const b = document.getElementById('ns-address-input'); return { box: b ? b.value : null, address: st.ns.address, salePrice: String(st.ns.salePrice), propId: st.ns._propId }; });
  ok(s.box === '' && s.salePrice === '' && s.propId === null, 'standalone net sheet opens blank after a listing\'s net sheet', s);
  await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ns.address = '9 Typed Rd, Bethesda, MD'; st.ns.salePrice = '900000'; });
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.lpOpen('checklist'); st.lpOpen('netsheet'); await new Promise(r => setTimeout(r, 100)); });
  s = await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return { address: st.ns.address, salePrice: String(st.ns.salePrice) }; });
  ok(s.address === '9 Typed Rd, Bethesda, MD' && s.salePrice === '900000', 'standalone net sheet keeps its own typed form when reopened', s);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
