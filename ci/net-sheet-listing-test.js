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
// The market written out in full, on an address that names no state (Oct 12, 2026: 211 Arbor Vista Ln,
// market "Maryland", opened its net sheet as DC). D and E must follow the market, not the form's default.
const D = '44444444-4444-4444-8444-444444444444', E = '55555555-5555-4555-8555-555555555555', F = '66666666-6666-4666-8666-666666666666';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Unit G-127, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Ashling McGowan', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' },
  { id: C, address: '300 Charlie St NW, Washington, DC 20001', seller_name: 'Seller C', agent_name: 'Charlotte Lee', market: 'DC', status: 'draft', created_at: '2026-09-20T00:00:00Z' },
  { id: D, address: '211 Delta Vista Ln', seller_name: 'Seller D', agent_name: 'Marc Cashin', market: 'Maryland', status: 'draft', created_at: '2026-04-13T00:00:00Z' },
  { id: E, address: '500 Echo Rd', seller_name: 'Seller E', agent_name: 'Marc Cashin', market: 'Virginia', status: 'draft', created_at: '2026-04-12T00:00:00Z' },
  { id: F, address: '600 Foxtrot St, Bethesda, MD', seller_name: 'Seller F', agent_name: 'Marc Cashin', market: ' maryland ', status: 'draft', created_at: '2026-04-11T00:00:00Z' }
];
const mls = (addr, price, hoa) => ['=== MLS DATA ===', 'Property Address : ' + addr, 'List Price       : ' + price, 'Bedrooms         : 3', 'Bathrooms        : 2', 'Square Footage   : 1,800 sq ft', 'Year Built       : 1990', 'HOA Fee          : ' + hoa, 'Property Type    : Condo', 'Parking          : 1', '', '--- Key Features ---', '1. One'].join('\n');
const NOTES = [
  { id: 1, property_id: A, subfolder: 'mls_data', content: mls(PROPS[0].address, '$425,000', '$310/month'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 2, property_id: B, subfolder: 'mls_data', content: mls(PROPS[1].address, '500000', 'None'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 3, property_id: C, subfolder: 'mls_data', content: mls(PROPS[2].address, '1.2M', '$807'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 4, property_id: D, subfolder: 'mls_data', content: mls(PROPS[3].address, '$410,000', '87'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 5, property_id: E, subfolder: 'mls_data', content: mls(PROPS[4].address, '$650,000', 'None'), updated_at: '2026-10-01T00:00:00Z' },
  { id: 6, property_id: F, subfolder: 'mls_data', content: mls(PROPS[5].address, '$900,000', 'None'), updated_at: '2026-10-01T00:00:00Z' }
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

  console.log('A market written out in full ("Maryland", "Virginia") is read as MD and VA');
  await run(() => { document.querySelector('#app').__vue_app__._instance.setupState.go('listings'); });
  await openListing(D); await clickNetSheet();
  s = await see();
  ok(s.box === PROPS[3].address && s.jur.indexOf('md-') === 0, 'D: market "Maryland", address with no state: the net sheet is Maryland, not DC', s.jur);
  ok(s.salePrice === '410000' && s.hoa === '87', 'D: still fills from its own MLS Data', s);
  await openListing(E); await clickNetSheet();
  s = await see();
  ok(s.box === PROPS[4].address && s.jur.indexOf('va-') === 0, 'E: market "Virginia", address with no state: the net sheet is Virginia, not DC', s.jur);
  await openListing(F); await clickNetSheet();
  s = await see();
  ok(s.jur === 'md-montgomery', 'F: market " maryland " keeps the county the address names (Bethesda: Montgomery)', s.jur);
  const badges = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.go('listings'); await new Promise(r => setTimeout(r, 400));
    return { list: Array.from(document.querySelectorAll('.market-badge')).map(b => b.textContent.trim()),
      code: ['Maryland', 'Virginia', 'Washington, DC', 'District of Columbia', 'MD', 'va', 'Delaware', '', null].map(v => st.fosMarketCode(v)) };
  });
  ok(badges.list.indexOf('Maryland') === -1 && badges.list.indexOf('Virginia') === -1 && badges.list.filter(t => t === 'MD').length >= 3, 'listing badges show MD and VA, never the written-out name', badges.list);
  ok(JSON.stringify(badges.code) === JSON.stringify(['MD', 'VA', 'DC', 'DC', 'MD', 'VA', '', '', '']), 'fosMarketCode: full names and codes to DC / MD / VA; anything else is blank, never a guess', badges.code);

  console.log('No net sheet without a full address, and never in the wrong state (Marc, Oct 12, 2026)');
  const tryAll = () => run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.ns.result = null; st.ns.breakdown = []; st.ns.salePrice = st.ns.salePrice || '410000'; st.ns.closingDate = '2026-11-20';
    let saves = 0; const realSave = st.nsSaveToProperty;
    st.calcNetSheet(); await new Promise(r => setTimeout(r, 150));
    const afterCalc = st.ns.result;
    const pdfBefore = st.pdfViewerSrc; st.nsDownloadPDF(); const pdfAfter = st.pdfViewerSrc;
    const box = document.querySelector('[data-ns-addr-problem]');
    return { result: afterCalc, pdfMade: pdfAfter !== pdfBefore, problem: st.nsAddrProblem, shown: box && box.offsetParent ? box.innerText : null };
  });
  await openListing(D); await clickNetSheet();
  s = await tryAll();
  ok(s.result === null && !s.pdfMade, 'D (address "211 Delta Vista Ln"): Calculate and Download PDF make nothing', s);
  ok(/missing the state and ZIP code/.test(s.shown || ''), 'D: the reason is on screen above Calculate', s.shown);
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ns.address = '211 Delta Vista Ln, Upper Marlboro, MD 20774'; await new Promise(r => setTimeout(r, 50)); });
  s = await tryAll();
  ok(s.result !== null && s.problem === '' && s.shown === null, 'D: with the full Maryland address typed in, it calculates and the notice is gone', s);
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ns.address = '1300 Army Navy Dr #518, Arlington, VA 22202'; st.ns.jurisdiction = 'va-nova'; await new Promise(r => setTimeout(r, 50)); });
  s = await tryAll();
  ok(s.result === null && /in Virginia but this listing is marked Maryland/.test(s.shown || ''), 'D: a Virginia address on a listing marked Maryland is refused, and both states are named', s);
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ns.address = '211 Delta Vista Ln, Upper Marlboro, MD 20774'; st.ns.jurisdiction = 'dc'; await new Promise(r => setTimeout(r, 50)); });
  s = await tryAll();
  ok(s.result === null && /in Maryland but the net sheet is set to DC/.test(s.shown || ''), 'D: a Maryland address with the state picker on DC is refused', s);
  const saveTry = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.ns.result = 1; st.ns.breakdown = [{ label: 'x', amount: 1 }];
    const n0 = (window.__nsSaves = 0); await st.nsSaveToProperty(); return { note: st.lstNotes.seller_net_sheet || '' };
  });
  ok(saveTry.note === '', 'D: Save to Property refuses too while the state does not match', saveTry);
  console.log('The standalone net sheet follows the same rule');
  s = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.view = 'just-listed'; await new Promise(r => setTimeout(r, 200)); st.lpOpen('netsheet'); await new Promise(r => setTimeout(r, 200));
    st.ns.address = '9 Typed Rd, Bethesda, MD'; st.ns.jurisdiction = 'md-montgomery'; st.ns.salePrice = '900000'; st.ns.closingDate = '2026-11-20'; st.ns.result = null;
    st.calcNetSheet(); await new Promise(r => setTimeout(r, 150)); const r1 = st.ns.result;
    const box = document.querySelector('[data-ns-addr-problem]'); const shown = box && box.offsetParent ? box.innerText : null;
    st.ns.address = '9 Typed Rd, Bethesda, MD 20814'; st.calcNetSheet(); await new Promise(r => setTimeout(r, 150));
    return { r1, shown, r2: st.ns.result };
  });
  ok(s.r1 === null && /missing the ZIP code/.test(s.shown || '') && s.r2 !== null, 'standalone: no ZIP, no sheet and the reason shown; with the ZIP it calculates', s);
  console.log('New Listing: no default state, and Market must agree with the State box');
  s = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const posts = []; const f0 = window.fetch;
    window.fetch = (u, o) => {
      if (o && o.method === 'POST' && /\/rest\/v1\/properties/.test(String(u))) posts.push(JSON.parse(o.body));
      if (/\/rest\/v1\/properties\?.*address=eq\./.test(String(u))) return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));   // the duplicate check: no such listing yet
      return f0(u, o);
    };
    const fill = (state, market) => { st.lstNewStreet = '1300 Army Navy Dr'; st.lstNewUnit = '518'; st.lstNewCity = 'Arlington'; st.lstNewState = state; st.lstNewZip = '22202'; st.lstNewSeller = 'Seller Z'; st.lstNewMarket = market; st.lstCreateError = ''; };
    const start = st.lstNewMarket;
    fill('VA', 'DC'); await st.lstCreateProperty(); const clash = st.lstCreateError, clashPosts = posts.length;
    fill('', ''); st.lstNewAddress = ''; await st.lstCreateProperty(); const none = st.lstCreateError, nonePosts = posts.length;
    fill('VA', ''); await st.lstCreateProperty(); await new Promise(r => setTimeout(r, 200));
    window.fetch = f0;
    return { start, clash, clashPosts, none, nonePosts, sent: posts.map(p => p.market) };
  });
  ok(s.start === '', 'New Listing: Market starts empty, not DC', s.start);
  ok(/State box says VA but Market says DC/.test(s.clash) && s.clashPosts === 0, 'New Listing: State VA with Market DC is refused and nothing is created', s);
  ok(/Choose the listing's state/.test(s.none) && s.nonePosts === 0, 'New Listing: no state anywhere is refused and nothing is created', s);
  ok(s.sent.length === 1 && s.sent[0] === 'VA', 'New Listing: State VA with Market left empty creates the listing as VA', s.sent);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
