#!/usr/bin/env node
/*
 * FORWARD OS: pressing a tool on a listing never sends the page somewhere else.
 * Run on every pull request.
 *
 * Marc, Nov 13, 2026: "opening up the CMA snapshot in the seller package jumps down to the
 * campaign generator settings". Only one tool panel is open at a time, so pressing a tool
 * closed the panel open above it; the page lost that height and the pressed header went off
 * the top of the screen. With real clicks in headless Chromium, on a computer and a phone:
 * every tool header below an open MLS Data panel stays where it was pressed and its panel
 * opens right under it; closing a panel with its own header leaves the header in place; and
 * when MLS Data is incomplete, Go to MLS Data brings the MLS Data panel into view.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/tool-panel-jump-test.js <dir-with-index.html>
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
const G = '77777777-7777-4777-8777-777777777777';   // no state at all: the badge must say so, never DC
const PROPS = [
  { id: A, address: '100 Alpha Ct, Unit G-127, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Ashling McGowan', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' },
  { id: C, address: '300 Charlie St NW, Washington, DC 20001', seller_name: 'Seller C', agent_name: 'Charlotte Lee', market: 'DC', status: 'draft', created_at: '2026-09-20T00:00:00Z' },
  { id: D, address: '211 Delta Vista Ln', seller_name: 'Seller D', agent_name: 'Marc Cashin', market: 'Maryland', status: 'draft', created_at: '2026-04-13T00:00:00Z' },
  { id: E, address: '500 Echo Rd', seller_name: 'Seller E', agent_name: 'Marc Cashin', market: 'Virginia', status: 'draft', created_at: '2026-04-12T00:00:00Z' },
  { id: F, address: '600 Foxtrot St, Bethesda, MD', seller_name: 'Seller F', agent_name: 'Marc Cashin', market: ' maryland ', status: 'draft', created_at: '2026-04-11T00:00:00Z' },
  { id: G, address: 'Golf Seller Name', seller_name: 'Seller G', agent_name: 'Marc Cashin', market: '', status: 'draft', created_at: '2026-04-10T00:00:00Z' }
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

  const st = (fn, arg) => page.evaluate(fn, arg);
  const openListing = (id) => st(async (id) => {
    const s = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!s.lstProperties.length) await s.lstFetchProperties();
    s.go('listings'); await new Promise(r => setTimeout(r, 50));
    await s.lstOpenProperty(s.lstProperties.find(p => p.id === id));
    await new Promise(r => setTimeout(r, 200));
  }, id);
  const hdr = (name) => page.locator('.subfolder-header', { hasText: name }).first();
  const top = (name) => st((name) => { const h = Array.from(document.querySelectorAll('.subfolder-header')).find(h => h.innerText.toLowerCase().includes(name.toLowerCase())); return h ? Math.round(h.getBoundingClientRect().top * 10) / 10 : null; }, name);
  const placeAt = (name, y) => st(([name, y]) => { const h = Array.from(document.querySelectorAll('.subfolder-header')).find(h => h.innerText.toLowerCase().includes(name.toLowerCase())); window.scrollTo({ top: window.scrollY + h.getBoundingClientRect().top - y, behavior: 'instant' }); }, [name, y]);
  const openTool = () => st(() => document.querySelector('#app').__vue_app__._instance.setupState.lstToolOpen);
  const bodyGap = (name) => st((name) => { const h = Array.from(document.querySelectorAll('.subfolder-header')).find(h => h.innerText.toLowerCase().includes(name.toLowerCase())); const b = h.parentElement.querySelector('.subfolder-body'); return b ? Math.round(b.getBoundingClientRect().top - h.getBoundingClientRect().bottom) : null; }, name);

  // Every listing tool below MLS Data, as an agent sees its name.
  const TOOLS = [['CMA Snapshot', 'cma'], ['Buyer Avatars', 'buyeravatars'], ['Listing Description', 'listingdesc'], ['Seller Prep Guide', 'sellerprep'],
    ['Seller Net Sheet', 'netsheet'], ['Price Reduction Planner', 'pricereduction'], ['Market Report', 'marketreport'], ['Listing Presentation', 'presentation']];

  for (const [device, size] of [['computer', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await page.setViewportSize(size);
    console.log('On a ' + device + ': a tool pressed below an open MLS Data panel stays where it was pressed');
    await openListing(A);
    for (const [name, key] of TOOLS) {
      await hdr('MLS Data').click(); await page.waitForTimeout(150);
      if ((await openTool()) !== 'mlsdata') await hdr('MLS Data').click(), await page.waitForTimeout(150);
      await placeAt(name, 160); await page.waitForTimeout(100);
      const before = await top(name);
      await hdr(name).click(); await page.waitForTimeout(250);
      const after = await top(name), open = await openTool(), gap = await bodyGap(name);
      ok(open === key && Math.abs(after - before) <= 1 && gap !== null && gap >= 0 && gap < 20, device + ': ' + name + ' stays at the same place on screen and its panel opens right under it', { before, after, open, gap });
    }
    console.log('On a ' + device + ': closing a panel with its own header leaves it in place');
    await placeAt('CMA Snapshot', 200); await page.waitForTimeout(100);
    if ((await openTool()) !== 'cma') await hdr('CMA Snapshot').click(), await page.waitForTimeout(200);
    await placeAt('CMA Snapshot', 200); await page.waitForTimeout(100);
    const b2 = await top('CMA Snapshot');
    await hdr('CMA Snapshot').click(); await page.waitForTimeout(250);
    ok((await openTool()) === null && Math.abs((await top('CMA Snapshot')) - b2) <= 1, device + ': CMA Snapshot closed, still in place');
  }

  console.log('MLS Data incomplete: Go to MLS Data shows the MLS Data panel');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openListing(G);
  await placeAt('CMA Snapshot', 300); await page.waitForTimeout(100);
  await hdr('CMA Snapshot').click(); await page.waitForTimeout(250);
  ok(await page.locator('[data-mls-gate-go]').count() === 1 && (await openTool()) === 'mlsdata', 'the gate opens and MLS Data is the open tool');
  await page.click('[data-mls-gate-go]'); await page.waitForTimeout(250);
  const mt = await top('MLS Data');
  ok(await page.locator('[data-mls-gate-go]').count() === 0 && mt >= 58 && mt < 200, 'Go to MLS Data closes the gate and brings the MLS Data header to the top, below the bar', mt);

  ok(errors.length === 0, 'no page errors', errors);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
