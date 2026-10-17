#!/usr/bin/env node
/*
 * FORWARD OS: the Deal Progress tab inside a listing (Oct 17, 2026).
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium against made-up Command Center and
 * Open To Close tables and uses the tab the way an agent does (real clicks):
 * - the stage, the agent's own items, Concierge's list with who and when, Transactions'
 *   next four open items and See all, the automations for the stage, earlier stages;
 * - the Command Center listing is found by its hand link first, else by street address;
 * - Open To Close's newest file at an address is the one shown;
 * - an agent tick sends exactly that item, only an agent row, and the agent's name, and
 *   shows the stamp the database returns; a failed tick is put back and says why;
 * - one listing's progress never shows on another, and the tab starts on Listing Tools;
 * - a failed load is said on screen; on a phone nothing scrolls sideways.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/deal-progress-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');

const DAY = 86400000, NOW = Date.now();
const ago = d => new Date(NOW - d * DAY - 3600000).toISOString();
const P1 = { id: '11111111-1111-4111-8111-111111111111', address: '138 U Street Northeast, Washington, DC 20002', seller_name: 'Seller One', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-08T00:00:00Z' };
const P2 = { id: '22222222-2222-4222-8222-222222222222', address: '9 Nowhere Road, Bethesda, MD 20814', seller_name: 'Seller Two', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-10-07T00:00:00Z' };
const P3 = { id: '33333333-3333-4333-8333-333333333333', address: '500 Linked Lane, Arlington, VA 22201', seller_name: 'Seller Three', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-10-06T00:00:00Z' };
const CC = [
  { id: 'cc000001-0000-4000-8000-000000000001', address: '138 U St NE', stage: 'Listed', status: 'active', agent: 'Marc Cashin', os_property_id: null },
  { id: 'cc000003-0000-4000-8000-000000000003', address: 'Something else entirely 1', stage: 'Pending', status: 'active', agent: 'Marc Cashin', os_property_id: P3.id },
  { id: 'cc000004-0000-4000-8000-000000000004', address: '500 Linked Lane', stage: 'Coming Soon', status: 'active', agent: 'Marc Cashin', os_property_id: null }
];
function items() {
  const L = CC[0].id, L3 = CC[1].id;
  return [
    { id: 'c1', listing_id: L, owner: 'concierge', title: 'Confirm listing is live on MLS, Zillow, and Realtor.com', sort_order: 0, completed: true, completed_at: '2026-10-03T18:14:00Z', completed_by: 'Abby Lee', created_at: ago(5) },
    { id: 'c2', listing_id: L, owner: 'concierge', title: 'Post Active listing content on social media', sort_order: 1, completed: true, completed_at: null, completed_by: null, created_at: ago(5) },
    { id: 'c3', listing_id: L, owner: 'concierge', title: 'EVERY MONDAY — Ensure agent has sent Weekly Status Report to seller', sort_order: 2, completed: false, completed_at: null, completed_by: null, created_at: ago(5) },
    { id: 'a1', listing_id: L, owner: 'agent', title: 'Make sure the showing instructions in ShowingTime are set up and clear.', sort_order: 0, completed: true, completed_at: '2026-10-04T13:00:00Z', completed_by: 'Marc Cashin', created_at: ago(5) },
    { id: 'a2', listing_id: L, owner: 'agent', title: 'Every Monday: send the Weekly Status Report to your seller. Concierge checks that it went out.', sort_order: 1, completed: false, completed_at: null, completed_by: null, created_at: ago(5) },
    { id: 'a3', listing_id: L, owner: 'agent', title: 'Once under contract: update the price, commission and close date on the Follow Up Boss deal card, slide it to Pending, and change the Follow Up Boss lead stage to Listing Pending.', sort_order: 2, completed: false, created_at: ago(5) },
    { id: 'a4', listing_id: L, owner: 'agent', title: 'Send the ratified contract to Transactions: FORWARD OS, Agent Tools, Contract to Close (Listing Agent).', sort_order: 3, completed: false, created_at: ago(5) },
    { id: 'p1', listing_id: L3, owner: 'concierge', title: 'LINKED LISTING ITEM', sort_order: 0, completed: false, created_at: ago(1) }
  ];
}
const HISTORY = [
  { parent_id: CC[0].id, source: 'listing_checklist_items', owner: 'concierge', stage: 'Listing Agreement Signed', title: 'Order Sign Install', completed: true, completed_at: '2026-10-02T15:00:00Z', completed_by: 'Abby Lee', removed_at: ago(5) },
  { parent_id: CC[0].id, source: 'listing_checklist_items', owner: 'agent', stage: 'Listing Agreement Signed', title: 'Set open house dates for your first weekend live with Transactions.', completed: false, removed_at: ago(5) }
];
const OTC_PROPS = [
  { id: 1471360, address: '138 U Street Northeast, Washington, DC, 20002', status: 'Listing - Under Contract' },
  { id: 1471375, address: '138 U Street Northeast, Washington, DC, 20002', status: 'Listing - Under Contract' },
  { id: 1471364, address: '138 U Street Northeast, Washington, DC, 20002', status: 'Listing- Active' },
  { id: 1438421, address: '1926 Ruxton Road, Towson, MD, 21204', status: 'Closed' }
];
const OTC_TASKS = [
  ...['Send client portal invite to sellers', '(If condo) Send the Condo Questionnaire', 'Request TOPA documents', 'Upload executed listing agreement to SkySlope', 'Fifth open item'].map((t, i) =>
    ({ property_id: 1471375, task_id: 100 + i, title: t, position: i + 2, completed: false, otc_created: ago(8), removed_at: null })),
  { property_id: 1471375, task_id: 90, title: 'Check for contract completion', position: 0, completed: true, completed_before_tracking: true, completed_seen_at: null, otc_created: ago(9), removed_at: null },
  { property_id: 1471375, task_id: 91, title: 'Add Google Drive folder link to FUB deal', position: 1, completed: true, completed_before_tracking: false, completed_seen_at: '2026-10-17T13:15:00Z', otc_created: ago(9), removed_at: null }
];

const seen = [];
let mode = { ccFail: false, tickFail: false };
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function q(u, k) { const m = u.match(new RegExp('[?&]' + k + '=([^&]*)')); return m ? m[1] : null; }
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/\/rest\/v1\/(listings|listing_checklist_items|task_history|otc_)/.test(u)) seen.push({ m, u, body: req.postData() });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, [P1, P2, P3]);
  if (m === 'GET' && /\/rest\/v1\/listings\?/.test(u)) {
    if (mode.ccFail) return J(route, 500, { message: 'database is down' });
    const link = q(u, 'os_property_id');
    if (link) return J(route, 200, CC.filter(l => 'eq.' + l.os_property_id === link));
    return J(route, 200, CC.filter(l => l.status === 'active'));
  }
  if (m === 'GET' && /\/rest\/v1\/listing_checklist_items\?/.test(u)) { const id = (q(u, 'listing_id') || '').slice(3); return J(route, 200, items().filter(i => i.listing_id === id)); }
  if (m === 'GET' && /\/rest\/v1\/task_history\?/.test(u)) { const id = (q(u, 'parent_id') || '').slice(3); return J(route, 200, HISTORY.filter(h => h.parent_id === id)); }
  if (m === 'GET' && /\/rest\/v1\/otc_properties/.test(u)) return J(route, 200, OTC_PROPS);
  if (m === 'GET' && /\/rest\/v1\/otc_tasks/.test(u)) { const id = Number((q(u, 'property_id') || '').slice(3)); return J(route, 200, OTC_TASKS.filter(t => t.property_id === id).sort((a, b) => a.position - b.position)); }
  if (m === 'PATCH' && /\/rest\/v1\/listing_checklist_items\?/.test(u)) {
    if (mode.tickFail) return J(route, 500, { message: 'permission denied for table listing_checklist_items' });
    const id = (q(u, 'id') || '').slice(3); const b = JSON.parse(req.postData() || '{}');
    const row = items().find(i => i.id === id);
    if (!row || q(u, 'owner') !== 'eq.agent' || row.owner !== 'agent') return J(route, 200, []);
    return J(route, 200, [{ ...row, completed: b.completed, completed_at: b.completed ? '2026-10-17T14:05:00Z' : null, completed_by: b.completed ? b.completed_by : null }]);
  }
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : '')); } }

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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });
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
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });

  const open = async (p) => { await page.evaluate((p) => document.querySelector('#app').__vue_app__._instance.setupState.lstOpenProperty(p), p); await page.waitForTimeout(400); };
  const text = () => page.locator('.dp-wrap').innerText();
  const progress = async () => { await page.getByRole('tab', { name: 'Deal Progress' }).click(); await page.waitForFunction(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return st.dp && !st.dp.loading; }); await page.waitForTimeout(200); };

  // ── 138 U St: found by street address ──
  await open(P1);
  ok(await page.getByRole('tab', { name: 'Listing Tools' }).getAttribute('aria-selected') === 'true' && await page.locator('.dp-wrap').count() === 0, 'a listing opens on Listing Tools');
  seen.length = 0;
  await progress();
  let t = await text();
  ok(/Stage now\s*Listed/i.test(t) && t.includes('You are here'), 'stage now and the strip', t.slice(0, 300));
  ok(t.includes('In Listed since'), 'says since when (from when the stage\'s lists were opened)');
  ok(await page.locator('.dp-agent .dp-row-tick').count() === 4 && t.includes('1 of 4 done'), 'agent box: the four agent items, one done');
  ok(t.includes('Done Oct 3, 2:14 PM · Abby Lee'), 'Concierge item: who and when', t);
  ok(/Post Active listing content on social media\s*Done\s*\n/.test(t + '\n') && !/Post Active listing content on social media\s*Done (Oct|by)/.test(t), 'Concierge item ticked before stamps: Done with no invented date');
  ok(t.includes('Open 5 days'), 'open Concierge item: how long');
  ok(!t.includes('LINKED LISTING ITEM'), 'another Command Center listing\'s items never show');
  const otcReq = seen.filter(s => /otc_tasks/.test(s.u));
  ok(otcReq.length === 1 && /property_id=eq\.1471375/.test(otcReq[0].u) && /removed_at=is\.null/.test(otcReq[0].u), 'Open To Close: only the newest file\'s tasks are read', otcReq.map(s => s.u));
  ok(t.includes('has this address 3 times; showing the newest'), 'says Open To Close has the address more than once');
  ok(t.includes('2 of 7 done'), 'Transactions count');
  const next = await page.locator('.dp-lane').filter({ has: page.locator('.dp-lane-name', { hasText: /^Transactions$/ }) }).locator('.dp-row').allInnerTexts();
  ok(next.length === 4 && next[0].startsWith('Send client portal invite') && next[3].startsWith('Upload executed listing agreement') && next.every(x => x.includes('Open 8 days')), 'Next up: four open items in Open To Close\'s order, with days open', next);
  ok(t.includes('Last checked off: Add Google Drive folder link to FUB deal · by Oct 17, 9:15 AM'), 'last checked off, with the time it was first seen');
  await page.getByRole('button', { name: /^See all 7: 2 done, 5 left$/ }).click(); await page.waitForTimeout(200);
  t = await text();
  ok(t.includes('Fifth open item') && /Done · 2/i.test(t) && t.includes('Done before tracking began') && t.includes('Checked off by Oct 17, 9:15 AM'), 'See all: the rest, and done items say when first seen or that tracking began later');
  ok(t.includes('Open To Close does not record when or by whom'), 'says what the time means');
  ok(t.includes('Email to Transactions: “Please send Just Listed Active Pipe”.') && t.includes('Follow Up Boss starts your “Seller Listing Active on MLS” action plan.'), 'automations for Listed, word for word from the guide');
  ok(t.includes('Earlier stages') && /Listing Agreement Signed\s*1 of 2 done/.test(t), 'earlier stage with its count');

  // ── an agent tick ──
  seen.length = 0;
  await page.locator('.dp-row-tick', { hasText: 'Every Monday: send the Weekly Status Report' }).locator('input').check(); await page.waitForTimeout(400);
  const patches = seen.filter(s => s.m === 'PATCH');
  ok(patches.length === 1 && /id=eq\.a2/.test(patches[0].u) && /owner=eq\.agent/.test(patches[0].u), 'a tick sends one request, for that agent row only', patches.map(p => p.u));
  ok(patches.length === 1 && JSON.stringify(JSON.parse(patches[0].body)) === JSON.stringify({ completed: true, completed_by: 'Marc Cashin' }), 'with completed and the signed-in agent\'s name, nothing else', patches[0] && patches[0].body);
  t = await text();
  ok(t.includes('2 of 4 done') && t.includes('Done Oct 17, 10:05 AM · Marc Cashin'), 'the stamp the database returned is shown', t.slice(0, 1200));
  // untick
  seen.length = 0;
  await page.locator('.dp-row-tick', { hasText: 'Every Monday: send the Weekly Status Report' }).locator('input').uncheck(); await page.waitForTimeout(400);
  ok(seen.filter(s => s.m === 'PATCH').length === 1 && JSON.parse(seen.find(s => s.m === 'PATCH').body).completed === false, 'an untick sends completed false');
  // failed tick
  mode.tickFail = true;
  await page.locator('.dp-row-tick', { hasText: 'Send the ratified contract' }).locator('input').click(); await page.waitForTimeout(400);
  const box = page.locator('.dp-row-tick', { hasText: 'Send the ratified contract' });
  ok(!(await box.locator('input').isChecked()) && (await box.innerText()).includes('Your tick was not saved: permission denied'), 'a failed tick is put back and says why', await box.innerText());
  mode.tickFail = false;
  ok(!seen.some(s => s.m === 'PATCH' && !/owner=eq\.agent/.test(s.u)), 'never writes a Concierge row');

  // ── Listing Tools tab again ──
  await page.getByRole('tab', { name: 'Listing Tools' }).click(); await page.waitForTimeout(200);
  ok(await page.locator('.dp-wrap').count() === 0, 'Listing Tools hides Deal Progress');

  // ── another listing: nothing carries over ──
  await open(P2);
  ok(await page.getByRole('tab', { name: 'Listing Tools' }).getAttribute('aria-selected') === 'true', 'the next listing opens on Listing Tools');
  await progress();
  t = await text();
  ok(t.includes('not in the Command Center yet') && t.includes('No Open To Close file found') && !t.includes('Abby Lee') && !t.includes('138 U'), 'a listing with no Command Center or Open To Close match shows nothing of the last one', t.slice(0, 500));

  // ── hand link wins over the address ──
  await open(P3); await progress();
  t = await text();
  ok(/Stage now\s*Pending/i.test(t) && t.includes('LINKED LISTING ITEM'), 'the Command Center listing linked by hand is used, not the one at the same address', t.slice(0, 400));

  // ── failed load ──
  mode.ccFail = true;
  await open(P1); await progress();
  t = await text();
  ok(t.includes('Deal Progress could not be loaded') && t.includes('database is down'), 'a failed load is said on screen with the reason', t.slice(0, 300));
  mode.ccFail = false;

  // ── phone ──
  await page.setViewportSize({ width: 390, height: 844 });
  await open(P1); await progress();
  const sideways = await page.evaluate(() => { const w = document.querySelector('.dp-wrap'); return { scroll: document.documentElement.scrollWidth, view: window.innerWidth, wrap: w.scrollWidth, wrapView: w.clientWidth }; });
  ok(sideways.wrap <= sideways.wrapView + 1, 'on a phone the Deal Progress tab does not scroll sideways', sideways);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
