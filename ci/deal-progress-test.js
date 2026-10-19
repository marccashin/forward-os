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
const P4 = { id: '44444444-4444-4444-8444-444444444444', address: '1926 Ruxton Rd, Baltimore MD 21204', seller_name: 'Seller Four', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-05-23T00:00:00Z' };
const day = d => ago(d).slice(0, 10);
// Listings the Command Center does not have: their Follow Up Boss stage comes from the
// backend (GET /api/fub/listing-stage). P2 is at Listing App. Scheduled; P5 has no deal;
// P6 is at Listed (so the Command Center should have it); P7's read fails.
const P5 = { id: '55555555-5555-4555-8555-555555555555', address: '77 No Deal Ave, Silver Spring, MD 20910', seller_name: 'Seller Five', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-10-05T00:00:00Z' };
const P6 = { id: '66666666-6666-4666-8666-666666666666', address: '88 Listed Ln, Rockville, MD 20850', seller_name: 'Seller Six', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-10-04T00:00:00Z' };
const P7 = { id: '77777777-7777-4777-8777-777777777777', address: '99 Broken Blvd, Arlington, VA 22201', seller_name: 'Seller Seven', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-10-03T00:00:00Z' };
const FUB_STAGE = {
  '22222222-2222-4222-8222-222222222222': { status: 200, body: { found: true, how: 'linked', deal_id: 940, pipeline: 'Sellers', stage: 'Listing App. Scheduled', entered_stage_at: '2026-10-09T15:00:00Z', name_is_address: false } },
  '11111111-1111-4111-8111-111111111111': { status: 200, body: { found: true, how: 'address', deal_id: 899, pipeline: 'Sellers', stage: 'Listed', entered_stage_at: '2026-10-01T15:00:00Z', name_is_address: true } },
  '33333333-3333-4333-8333-333333333333': { status: 200, body: { found: true, how: 'linked', deal_id: 777, pipeline: 'Sellers', stage: 'Pending', entered_stage_at: '2026-10-01T15:00:00Z', name_is_address: false } },
  '55555555-5555-4555-8555-555555555555': { status: 200, body: { found: false, how: 'none', count: 0 } },
  '66666666-6666-4666-8666-666666666666': { status: 200, body: { found: true, how: 'address', deal_id: 941, pipeline: 'Sellers', stage: 'Listed', entered_stage_at: '2026-10-01T15:00:00Z', name_is_address: true } },
  '77777777-7777-4777-8777-777777777777': { status: 502, body: { detail: 'Follow Up Boss could not be read: 401 Unauthorized' } }
};
// Seller post-closing records: Ruxton closed 60 days ago (its Command Center listing is
// archived, so only the address ties them); 9 Nowhere Road closed two years ago, an older
// deal at that address, which must not mark today's listing closed.
const PC = [
  { id: 'pc1', address: '1926 Ruxton Rd, Baltimore, MD 21204', closing_date: day(60), listing_id: 'cc-archived-ruxton', created_at: ago(60) },
  { id: 'pc2', address: '9 Nowhere Rd, Bethesda, MD 20814', closing_date: day(730), listing_id: null, created_at: ago(730) }
];
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
    { id: 'c4', listing_id: L, owner: 'concierge', title: 'Clear to close received from Transactions', sort_order: 3, completed: false, completed_at: null, completed_by: null, created_at: ago(9) },
    { id: 'a1', listing_id: L, owner: 'agent', title: 'Make sure the showing instructions in ShowingTime are set up and clear.', sort_order: 0, completed: true, completed_at: '2026-10-04T13:00:00Z', completed_by: 'Marc Cashin', created_at: ago(5) },
    { id: 'a4', listing_id: L, owner: 'agent', title: 'Send the ratified contract to Transactions: FORWARD OS, Agent Tools, Contract to Close (Listing Agent).', sort_order: 1, completed: false, completed_at: null, completed_by: null, created_at: ago(5) },
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
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, [P1, P2, P3, P4, P5, P6, P7]);
  if (m === 'GET' && /\/api\/fub\/listing-stage\?/.test(u)) { seen.push({ m, u }); const r = FUB_STAGE[q(u, 'property_id')] || { status: 404, body: { detail: 'No FORWARD OS listing with that id.' } }; return J(route, r.status, r.body); }
  if (m === 'GET' && /\/rest\/v1\/seller_post_closing\?/.test(u)) return J(route, 200, PC);
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
  ok(await page.locator('.dp-agent .dp-row-tick').count() === 2 && t.includes('1 of 2 done'), 'agent box: the two agent tasks, one done');
  const rem = await page.locator('.dp-agent .dp-reminder').allInnerTexts();
  ok(/Keep in mind/i.test(t) && rem.length === 2 && rem[0].includes('Every Monday: send the Weekly Status Report to your seller. Concierge checks that it went out.') && rem[1].includes('Once under contract: update the price') && await page.locator('.dp-agent .dp-reminder input').count() === 0, 'Listed reminders shown word for word under Keep in mind, with no box', rem);
  ok(t.includes('Done Oct 3, 2:14 PM · Abby Lee'), 'Concierge item: who and when', t);
  ok(/Post Active listing content on social media\s*Done\s*\n/.test(t + '\n') && !/Post Active listing content on social media\s*Done (Oct|by)/.test(t), 'Concierge item ticked before stamps: Done with no invented date');
  ok(t.includes('Open 5 days'), 'open Concierge item: how long');
  {
    const w = await page.locator('.dp-row', { hasText: 'Clear to close received from Transactions' }).innerText();
    ok(/Waiting/.test(w) && !/Open \d+ day/.test(w), 'an item waiting on an event says Waiting, not days open', w);
  }
  ok(!t.includes('LINKED LISTING ITEM'), 'another Command Center listing\'s items never show');
  const otcReq = seen.filter(s => /otc_tasks/.test(s.u));
  ok(otcReq.length === 1 && /property_id=eq\.1471375/.test(otcReq[0].u) && /removed_at=is\.null/.test(otcReq[0].u), 'Open To Close: only the newest file\'s tasks are read', otcReq.map(s => s.u));
  ok(t.includes('has this address 3 times; showing the newest'), 'says Open To Close has the address more than once');
  ok(t.includes('2 of 7 done'), 'Transactions count');
  ok(t.includes('Open To Close starts every file with the same standard task list, so some tasks may not apply to your deal. Transactions deletes the ones that do not as the file moves along.'), 'Transactions: says some Open To Close tasks may not apply and Transactions deletes them (Marc, Oct 19, 2026)');
  {
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.dp-tab')].map(b => { const c = getComputedStyle(b); return { on: b.classList.contains('dp-tab-on'), bg: c.backgroundColor, border: c.borderTopWidth, h: b.getBoundingClientRect().height, fs: parseFloat(c.fontSize) }; }));
    ok(tabs.length === 2 && tabs.every(x => parseFloat(x.border) >= 1 && x.h >= 44 && x.fs >= 14) && tabs.filter(x => x.on).length === 1 && tabs.find(x => x.on).bg !== tabs.find(x => !x.on).bg, 'Listing Tools and Deal Progress are bordered buttons, 44px or taller, the open one filled (Marc, Oct 19, 2026)', tabs);
  }
  const next = await page.locator('.dp-lane').filter({ has: page.locator('.dp-lane-name', { hasText: /^Transactions$/ }) }).locator('.dp-row').allInnerTexts();
  ok(next.length === 4 && next[0].startsWith('Send client portal invite') && next[3].startsWith('Upload executed listing agreement') && next.every(x => x.includes('Open 8 days')), 'Next up: four open items in Open To Close\'s order, with days open', next);
  ok(t.includes('Last checked off: Add Google Drive folder link to FUB deal · by Oct 17, 9:15 AM'), 'last checked off, with the time it was first seen');
  await page.getByRole('button', { name: /^See all 7: 2 done, 5 left$/ }).click(); await page.waitForTimeout(200);
  t = await text();
  ok(t.includes('Fifth open item') && /Done · 2/i.test(t) && t.includes('Done before tracking began') && t.includes('Checked off by Oct 17, 9:15 AM'), 'See all: the rest, and done items say when first seen or that tracking began later');
  ok(t.includes('Open To Close does not record when or by whom'), 'says what the time means');
  ok(t.includes('Email to Transactions: “Please send Just Listed Active Pipe”.') && t.includes('Follow Up Boss starts your “Seller Listing Active on MLS” action plan.'), 'automations for Listed, word for word from the guide');
  {
    // Automations box: this stage, then what the next move (Listed -> Pending) will set off (Marc, Oct 19, 2026)
    const lane = page.locator('.dp-lane').filter({ has: page.locator('.dp-lane-name', { hasText: /^Automations$/ }) });
    const now = await lane.locator('.dp-row:not(.dp-row-next)').allInnerTexts();
    const nxt = await lane.locator('.dp-row-next').allInnerTexts();
    const lt = await lane.innerText();
    ok(now.length === 5 && now[0].includes('Please send Just Listed Active Pipe') && !now.some(x => /Under Contract Post Needed/.test(x)), 'This stage: the five Listed automations and nothing from the next stage', now);
    ok(/This stage[\s\S]*Next stage/i.test(lt) && lt.includes('When you move the Follow Up Boss deal card to Pending:'), 'Next stage comes after This stage and names Pending', lt.slice(0, 600));
    ok(nxt.length === 4 && nxt[0].includes('Email to Concierge and Operations: “New Listing Under Contract Post Needed”.') && nxt[3].includes('Follow Up Boss gives Transactions a task: update Bright and mark the listing Active Under Contract.'), 'Next stage: the four Pending automations, word for word from the guide, in order', nxt);
  }
  ok(t.includes('Earlier stages') && /Listing Agreement Signed\s*1 of 2 done/.test(t), 'earlier stage with its count');

  // ── an agent tick ──
  seen.length = 0;
  await page.locator('.dp-row-tick', { hasText: 'Send the ratified contract' }).locator('input').check(); await page.waitForTimeout(400);
  const patches = seen.filter(s => s.m === 'PATCH');
  ok(patches.length === 1 && /id=eq\.a4/.test(patches[0].u) && /owner=eq\.agent/.test(patches[0].u), 'a tick sends one request, for that agent row only', patches.map(p => p.u));
  ok(patches.length === 1 && JSON.stringify(JSON.parse(patches[0].body)) === JSON.stringify({ completed: true, completed_by: 'Marc Cashin' }), 'with completed and the signed-in agent\'s name, nothing else', patches[0] && patches[0].body);
  t = await text();
  ok(t.includes('2 of 2 done') && t.includes('Done Oct 17, 10:05 AM · Marc Cashin'), 'the stamp the database returned is shown', t.slice(0, 1200));
  // untick
  seen.length = 0;
  await page.locator('.dp-row-tick', { hasText: 'Send the ratified contract' }).locator('input').uncheck(); await page.waitForTimeout(400);
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
  ok(!t.includes('138 U') && !t.includes('Done Oct 3') && !t.includes('Send the ratified contract') && !t.includes('Send client portal invite'), 'a listing with no Command Center or Open To Close match shows nothing of the last one', t.slice(0, 500));
  // Not in the Command Center: its stage in Follow Up Boss and the guide for that stage
  ok(seen.some(s => /\/api\/fub\/listing-stage\?property_id=22222222-2222-4222-8222-222222222222/.test(s.u)), 'asks the backend for the listing\'s Follow Up Boss stage by its id');
  ok(/Stage in Follow Up Boss\s*Listing App\. Scheduled/i.test(t) && t.includes('In Listing App. Scheduled since Oct 9'), 'says the Follow Up Boss stage and since when', t.slice(0, 400));
  ok(t.includes("Concierge's checklist and Transactions' Open To Close file start when the deal card reaches Listing Agreement Signed."), 'says what starts the next lists');
  ok(t.includes('Review the sample Listing Agreement from Transactions before the appointment, so you can walk the seller through it.') && t.includes('When the seller is ready to move forward: add the tag FWRD Seller Onboarding to the Follow Up Boss lead record. This starts onboarding.') && await page.locator('.dp-agent input').count() === 0, 'your next steps word for word from the guide, with no tick boxes');
  ok(t.includes('Drafts a sample Listing Agreement PDF and sends it to you to review with the seller at the appointment.') && t.includes('The Open To Close file starts once the listing agreement is signed.') && /Concierge[\s\S]*Nothing for this team at this step\./.test(t), 'Transactions and Concierge for this stage, from the guide');
  ok(t.includes('Email to Transactions: “Listing Agreement Needed”.') && !t.includes('not in the Command Center yet') && !t.includes('No Open To Close file found'), 'the automations for this stage, and none of the old empty notes', t.slice(0, 800));
  await open(P5); await progress(); t = await text();
  ok(t.includes('No Follow Up Boss Sellers deal was found for this listing. Create the deal card in the Sellers pipeline at Seller Engaged, with the property address as its name.') && await page.locator('.dp-agent').count() === 0, 'a listing with no Follow Up Boss deal says so and what to do', t.slice(0, 400));
  await open(P6); await progress(); t = await text();
  ok(/Stage in Follow Up Boss\s*Listed/i.test(t) && t.includes('The Command Center has no active listing at this address. Concierge can link it by hand'), 'a listing past the agreement but missing from the Command Center is flagged', t.slice(0, 400));
  await open(P7); await progress(); t = await text();
  ok(t.includes('its stage in Follow Up Boss could not be read') && t.includes('401 Unauthorized'), 'a failed Follow Up Boss read is said with its reason', t.slice(0, 400));
  ok(!seen.some(s => /listing-stage\?property_id=44444444/.test(s.u)), 'never asks Follow Up Boss for a closed listing');
  // Rename reminder: a deal card named after a person, on any open listing
  await open(P2); await progress(); t = await text();
  ok(t.includes("This Follow Up Boss deal card is named after a person, not the property. Put the property address in the Follow Up Boss deal card's name field, not the seller's name. FORWARD OS uses it as the listing's address.") && await page.locator('.dp-rename').count() === 1, 'a deal named after a person gets the rename reminder, in the guide\'s words', t.slice(0, 500));
  await open(P6); await progress();
  ok(await page.locator('.dp-rename').count() === 0, 'a deal named with its address gets no reminder');
  await open(P7); await progress();
  ok(await page.locator('.dp-rename').count() === 0, 'a failed Follow Up Boss read shows no reminder');
  await open(P3); await progress(); t = await text();
  ok(await page.locator('.dp-rename').count() === 1 && /Stage now\s*Pending/i.test(t) && !/Stage in Follow Up Boss/.test(t), 'a Command Center listing whose deal is named after a person also gets the reminder; its stage still comes from the Command Center', t.slice(0, 400));
  await open(P1); await progress();
  ok(await page.locator('.dp-rename').count() === 0, 'a Command Center listing named with its address gets none');

  // ── a closed deal: only that Concierge runs post-closing, and it is safe to archive ──
  await open(P4); await progress();
  t = await text();
  {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day(60));
    const want = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
    ok(/Closed/i.test(t) && t.toLowerCase().includes(want.toLowerCase()) && t.includes('Concierge is running the 365 day post-closing program and will notify you when you need to connect with your client.') && t.includes('It is now safe to archive this listing card in FORWARD OS.'), 'a closed deal says Concierge runs post-closing and it is safe to archive, with the closing date as written', t.slice(0, 500));
    ok(!/Stage in Follow Up Boss|No Follow Up Boss Sellers deal/.test(t) && await page.locator('.dp-lane').count() === 0 && await page.locator('.dp-agent').count() === 0 && await page.locator('.dp-rename').count() === 0, 'a closed deal shows no checklists, no Transactions lane, no Follow Up Boss stage and no rename reminder');
  }
  await open(P2); await progress();
  t = await text();
  ok(/Stage in Follow Up Boss\s*Listing App\. Scheduled/i.test(t) && !/post-closing program/.test(t), 'an old closing at the same address does not mark a new listing closed');

  // ── hand link wins over the address ──
  await open(P3); await progress();
  t = await text();
  ok(/Stage now\s*Pending/i.test(t) && t.includes('LINKED LISTING ITEM'), 'the Command Center listing linked by hand is used, not the one at the same address', t.slice(0, 400));
  {
    const lane = page.locator('.dp-lane').filter({ has: page.locator('.dp-lane-name', { hasText: /^Automations$/ }) });
    const nxt = await lane.locator('.dp-row-next').allInnerTexts();
    const lt = await lane.innerText();
    ok(lt.includes('When you move the Follow Up Boss deal card to Closed:') && nxt.length === 5 && nxt[0].includes('Email to Concierge: “Sign Removal”.') && !lt.includes('Back on the Market'), 'from Pending, Next stage shows Closed only (not Back on the Market)', lt.slice(0, 800));
  }

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
