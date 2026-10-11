#!/usr/bin/env node
/*
 * FORWARD OS: a row on the Dashboard opens that listing or that buyer.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium with made-up listings and
 * buyers and clicks the rows under Active Listings and Buyer Pipeline the way
 * an agent does. Each row must open its own record, View all must still open
 * the full list, and Prep must still start Meeting Prep.
 *
 * Why: until Oct 11, 2026 every row opened the full list (go('listings') /
 * go('buyer-package')) and the agent had to find the card again.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/dashboard-rows-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const PROPS = [1, 2, 3].map(n => ({ id: n + '1111111-1111-4111-8111-111111111111', address: n + '00 Test St, Washington DC 2000' + n, seller_name: 'Seller ' + n, agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-0' + (4 - n) + 'T00:00:00Z' }));
const BUYERS = [1, 2, 3].map(n => ({ id: n + '2222222-2222-4222-8222-222222222222', buyer_name: 'Buyer Number' + n, agent_name: 'Marc Cashin', stage: 'Pipeline' }));
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/buyers(\?|$)/.test(u)) return J(route, 200, BUYERS);
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
    if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    const t = route.request().resourceType();
    if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
    return api(route);
  });
  await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);

  const see = () => page.evaluate(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    return { view: st.view, listing: st.lstActiveProp && st.lstActiveProp.id, buyer: st.byrActiveBuyer && st.byrActiveBuyer.id, prep: st.mp.target && st.mp.target.id };
  });
  const home = async () => { await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.go('dashboard')); await page.waitForTimeout(300); };
  // The updates popup and the daily task popup cover the page on a first visit: close both.
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
  await page.waitForTimeout(200);
  await home();
  ok(await page.locator('.lrow').count() === 3 && await page.locator('.prow').count() === 3, 'the Dashboard shows the listings and the buyers', await see());

  for (const i of [1, 0, 2]) {
    await home();
    await page.locator('.lrow').nth(i).locator('.laddr').click(); await page.waitForTimeout(400);
    const s = await see();
    ok(s.view === 'listing-detail' && s.listing === PROPS[i].id, 'listing row ' + (i + 1) + ' opens that listing', s);
    ok((await page.locator('body').innerText()).includes(PROPS[i].address), 'listing row ' + (i + 1) + ': its address is on screen');
  }
  for (const i of [2, 0, 1]) {
    await home();
    await page.locator('.prow').nth(i).locator('.pname').click(); await page.waitForTimeout(400);
    const s = await see();
    ok(s.view === 'buyer-detail' && s.buyer === BUYERS[i].id, 'buyer row ' + (i + 1) + ' opens that buyer', s);
    ok((await page.locator('body').innerText()).includes(BUYERS[i].buyer_name), 'buyer row ' + (i + 1) + ': the name is on screen');
  }

  await home();
  await page.locator('.panel', { hasText: 'Active Listings' }).locator('.panel-link').click(); await page.waitForTimeout(300);
  ok((await see()).view === 'listings', 'View all under Active Listings still opens the full list', await see());
  await home();
  await page.locator('.panel', { hasText: 'Buyer Pipeline' }).locator('.panel-link').click(); await page.waitForTimeout(300);
  ok((await see()).view === 'buyer-package', 'View all under Buyer Pipeline still opens the full list', await see());

  await home();
  await page.locator('.lrow').nth(1).locator('.lbtn').click(); await page.waitForTimeout(300);
  let s = await see();
  ok(s.view === 'meeting-prep' && s.prep === PROPS[1].id, 'Prep on a listing row still starts Meeting Prep and does not open the listing', s);
  await home();
  await page.locator('.prow').nth(1).locator('.lbtn').click(); await page.waitForTimeout(300);
  s = await see();
  ok(s.view === 'meeting-prep' && s.prep === BUYERS[1].id, 'Prep on a buyer row still starts Meeting Prep and does not open the buyer', s);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
