#!/usr/bin/env node
/*
 * FORWARD OS: the Deal Progress tab inside a buyer (Nov 16, 2026), the listing tab mirrored.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium against a made-up backend (the buyer's
 * Follow Up Boss stage), made-up Command Center tables (deals, deal_tasks, task_history,
 * buyer_post_closing) and made-up Open To Close tables, and uses the tab with real clicks:
 * - a buyer opens on Buyer Tools, with the listing folder's two tabs (same classes);
 *   Deal Progress hides the tools and Buyer Tools brings them back unchanged;
 * - at BA Signed or later: the stage, the four-stage bar, the agent's column of the guide
 *   word for word, Concierge's items with who and when, Transactions' Open To Close file
 *   found by the deal card's address (newest file, never the seller's file), the
 *   automations for the stage and the next one, earlier stages;
 * - before BA Signed: the Follow Up Boss stage and the guide for it, word for word;
 * - a buyer with no Follow Up Boss deal is told to create the lead in Follow Up Boss;
 *   two deals, a failed read and a closed deal each say so;
 * - at Pending with a deal card named after a person, the rename reminder;
 * - READ ONLY: no write of any kind leaves the page; no box to tick;
 * - Check Open To Close now runs the shared check and reloads this buyer;
 * - one buyer's progress never shows on another; on a phone nothing scrolls sideways.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/buyer-deal-progress-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
if (!dir) { console.error('Usage: node ci/buyer-deal-progress-test.js <dir-with-index.html>'); process.exit(2); }
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');

const DAY = 86400000, NOW = Date.now();
const ago = d => new Date(NOW - d * DAY - 3600000).toISOString();
const B = (id, name) => ({ id, buyer_name: name, agent_name: 'Marc Cashin', email: '', phone: '', status: 'active', created_at: '2026-10-01T00:00:00Z', subfolder_drive_ids: {} });
const B1 = B('b1', 'Buyer Pending'), B2 = B('b2', 'Buyer Prequal'), B3 = B('b3', 'Buyer Unlinked'), B4 = B('b4', 'Buyer Twice'),
  B5 = B('b5', 'Buyer Broken'), B6 = B('b6', 'Buyer Closed'), B7 = B('b7', 'Buyer Showing'), B8 = B('b8', 'Buyer Renamelater'),
  B9 = B('b9', 'Buyer Consult'), B10 = B('b10', 'Buyer Closedearlier');
const BUYERS = [B1, B2, B3, B4, B5, B6, B7, B8, B9, B10];
const FUB = {
  b1: { status: 200, body: { found: true, how: 'linked', deal_id: 501, pipeline: 'Buyers', stage: 'Pending', entered_stage_at: '2026-11-12T14:05:00Z', name_is_address: true, address: '4410 Garrison St NW' } },
  b2: { status: 200, body: { found: true, how: 'name', deal_id: 502, pipeline: 'Buyers', stage: '15 Min Pre-Qual Complete', entered_stage_at: '2026-11-05T14:00:00Z', name_is_address: false } },
  b3: { status: 200, body: { found: false, how: 'none', count: 0 } },
  b4: { status: 200, body: { found: false, how: 'ambiguous', count: 2 } },
  b5: { status: 502, body: { detail: 'Follow Up Boss could not be read: 401 Unauthorized' } },
  b6: { status: 200, body: { found: true, how: 'linked', deal_id: 506, pipeline: 'Buyers', stage: 'Closed This Quarter', entered_stage_at: '2026-10-01T00:00:00Z', name_is_address: true, address: '9 Sold Ct NW' } },
  b7: { status: 200, body: { found: true, how: 'linked', deal_id: 507, pipeline: 'Buyers', stage: 'Actively Showing', entered_stage_at: '2026-11-11T19:40:00Z', name_is_address: false } },
  b8: { status: 200, body: { found: true, how: 'linked', deal_id: 508, pipeline: 'Buyers', stage: 'Pending', entered_stage_at: '2026-11-14T15:00:00Z', name_is_address: false } },
  b10: { status: 200, body: { found: true, how: 'name', deal_id: 510, pipeline: 'Buyers', stage: 'Total Closed This Year', entered_stage_at: '2026-07-01T00:00:00Z', name_is_address: true, address: '7 Earlier Way NE' } },
  b9: { status: 200, body: { found: true, how: 'linked', deal_id: 509, pipeline: 'Buyers', stage: 'Buyer Consult Complete', entered_stage_at: '2026-11-09T15:00:00Z', name_is_address: false } }
};
const DEALS = [
  { id: 'd1', fub_deal_id: '501', stage: 'Pending', stage_changed_at: '2026-11-12T14:05:00Z', pipeline: 'buyer' },
  { id: 'd6', fub_deal_id: '506', stage: 'Closed This Quarter', stage_changed_at: '2026-10-01T00:00:00Z', pipeline: 'buyer' },
  { id: 'd7', fub_deal_id: '507', stage: 'Actively Showing', stage_changed_at: '2026-11-11T19:40:00Z', pipeline: 'buyer' },
  { id: 'd10', fub_deal_id: '510', stage: 'Total Closed This Year', stage_changed_at: '2026-07-01T00:00:00Z', pipeline: 'buyer' },
  { id: 'd8', fub_deal_id: '508', stage: 'Pending', stage_changed_at: '2026-11-14T15:00:00Z', pipeline: 'buyer' }
];
const TASKS = [
  { id: 't1', deal_id: 'd1', owner: 'concierge', title: 'Post buyer Under Contract announcement on social media', sort_order: 4, completed: true, completed_at: '2026-11-12T20:10:00Z', completed_by: 'Abby Lee', created_at: ago(4) },
  { id: 't2', deal_id: 'd1', owner: 'concierge', title: 'Closing gift ready in office', sort_order: 2, completed: false, created_at: ago(4) },
  { id: 't3', deal_id: 'd1', owner: 'concierge', title: 'Remind agent to think about adding a personalized gift in addition to the team provided items', sort_order: 3, completed: false, created_at: ago(4) },
  { id: 't4', deal_id: 'd1', owner: 'agent', title: 'CC AGENT ROW WORDING', sort_order: 1, completed: false, created_at: ago(4) },
  { id: 't9', deal_id: 'd7', owner: 'agent', title: 'OTHER BUYER ROW', sort_order: 1, completed: false, created_at: ago(1) }
];
const HISTORY = [
  { parent_id: 'd1', source: 'deal_tasks', owner: 'concierge', stage: 'BA Signed', title: 'Verify Buyer Needs Assessment is on file in FORWARD OS', completed: true, completed_at: '2026-11-10T16:02:00Z', completed_by: 'Abby Lee', removed_at: ago(5) },
  { parent_id: 'd1', source: 'deal_tasks', owner: 'concierge', stage: 'BA Signed', title: 'Send Welcome to the FORWARD Client Experience email', completed: false, removed_at: ago(5) }
];
const PC = [{ id: 'pc6', fub_deal_id: '506', closing_date: '2026-10-30', created_at: '2026-10-30T12:00:00Z' }];
const OTC_PROPS = [
  { id: 2000, address: '4410 Garrison St NW, Washington, DC 20015', status: 'Buyer - Under Contract', client_type: 'Buyer' },
  { id: 2001, address: '4410 Garrison Street Northwest, Washington, DC, 20015', status: 'Buyer - Under Contract', client_type: 'Buyer' },
  { id: 2005, address: '4410 Garrison St NW, Washington, DC 20015', status: 'Listing - Under Contract', client_type: 'Seller' },
  { id: 3000, address: '12 Other Pl NW', status: 'Buyer - Under Contract', client_type: 'Buyer' }
];
const OTC_TASKS = [
  ...['Add settlement date and location', 'Inspection contingency removed', 'Appraisal received', 'Loan commitment received', 'Clear to close'].map((t, i) =>
    ({ property_id: 2001, task_id: 10 + i, title: t, position: i + 2, completed: false, otc_created: ago(3), removed_at: null })),
  { property_id: 2001, task_id: 1, title: 'Send Commissions Summary email', position: 0, completed: true, completed_before_tracking: false, completed_seen_at: '2026-11-12T15:15:00Z', otc_created: ago(4), removed_at: null },
  { property_id: 2005, task_id: 99, title: 'SELLER FILE TASK', position: 0, completed: false, otc_created: ago(3), removed_at: null }
];

const seen = [];
const OTCNOW = { waitAt: 0, posts: 0 };
const otcWait = () => Math.max(0, Math.ceil((OTCNOW.waitAt - Date.now()) / 1000));
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function q(u, k) { const m = u.match(new RegExp('[?&]' + k + '=([^&]*)')); return m ? m[1] : null; }
const DP_TABLES = /\/rest\/v1\/(deals|deal_tasks|task_history|buyer_post_closing|otc_)/;
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  seen.push({ m, u, body: req.postData() });
  if (m === 'GET' && /\/rest\/v1\/buyers/.test(u)) return J(route, 200, BUYERS);
  if (m === 'GET' && /\/api\/otc\/poll\/status/.test(u)) return J(route, 200, { running: false, fail_streak: 0, last_run: { ok: true, ran_at: '2026-11-16T22:30:00+00:00' }, manual_wait_seconds: otcWait(), manual_gap_seconds: 60 });
  if (m === 'POST' && /\/api\/otc\/poll$/.test(u)) {
    OTCNOW.posts++;
    if (otcWait() > 0) return J(route, 429, { detail: 'Open To Close was checked less than a minute ago. Next check in ' + otcWait() + ' seconds.' });
    OTCNOW.waitAt = Date.now() + 60000;
    const t = OTC_TASKS.find(x => x.task_id === 10); t.completed = true; t.completed_seen_at = new Date().toISOString();
    return J(route, 200, { ok: true, ran_at: new Date().toISOString(), read: [2001], changes: [], manual_wait_seconds: 60 });
  }
  if (m === 'GET' && /\/api\/fub\/buyer-stage\?/.test(u)) { const r = FUB[q(u, 'buyer_id')] || { status: 404, body: { detail: 'No FORWARD OS buyer with that id.' } }; return J(route, r.status, r.body); }
  if (m === 'GET' && /\/rest\/v1\/deals\?/.test(u)) { const f = q(u, 'fub_deal_id'); return J(route, 200, DEALS.filter(d => 'eq.' + d.fub_deal_id === f)); }
  if (m === 'GET' && /\/rest\/v1\/buyer_post_closing\?/.test(u)) { const f = q(u, 'fub_deal_id'); return J(route, 200, PC.filter(p => 'eq.' + p.fub_deal_id === f)); }
  if (m === 'GET' && /\/rest\/v1\/deal_tasks\?/.test(u)) { const id = (q(u, 'deal_id') || '').slice(3); return J(route, 200, TASKS.filter(i => i.deal_id === id).sort((a, b) => a.sort_order - b.sort_order)); }
  if (m === 'GET' && /\/rest\/v1\/task_history\?/.test(u)) { const id = (q(u, 'parent_id') || '').slice(3); return J(route, 200, HISTORY.filter(h => h.parent_id === id && 'eq.' + h.source === q(u, 'source'))); }
  if (m === 'GET' && /\/rest\/v1\/otc_properties/.test(u)) return J(route, 200, OTC_PROPS);
  if (m === 'GET' && /\/rest\/v1\/otc_tasks/.test(u)) { const id = Number((q(u, 'property_id') || '').slice(3)); return J(route, 200, OTC_TASKS.filter(t => t.property_id === id).sort((a, b) => a.position - b.position)); }
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }

// The guide's words, read from index.html itself is what the app shows; these copies are
// typed from FORWARD_If_This_Then_That.pdf (October 2026) so a drift in either is caught.
const GUIDE = {
  pendingFirst: 'Change the Follow Up Boss lead stage to Pending.',
  pendingInspection: 'Schedule the home inspection and copy transactions@fwrdrealestate.com once it is confirmed. FORWARD OS can recommend inspectors.',
  pendingLast: 'Once closed: confirm price, settlement date and commission on the Follow Up Boss deal card, then slide it to Closed This Quarter. This starts post-closing.',
  showingOffer: 'Offer accepted: rename the Follow Up Boss deal card to the property address, update price, closing date and commission to match the contract, then slide it to Pending.',
  showingSend: "Send the ratified offer to Transactions: FORWARD OS, Agent Tools, Contract to Close (Buyer's Agent).",
  pendingAuto1: 'Email to Concierge and Operations: “New Buyer Under Contract Post Needed”.',
  closedAuto3: 'The Command Center starts the 365 day buyer post-closing program, with due dates counted from closing. Concierge is emailed that the deal moved.',
  prequalAuto: 'Follow Up Boss starts your “Buyer 15 Min Pre-Qual Complete” action plan.',
  prequalLender: 'Lender: working with our Financial Team? Select the lender under Details. An independent lender? Type the name in the custom field *Lender Name. Undecided? Skip this for now.',
  consultTx: 'Sends you the PDF of the Buyer Agreement and buyer disclosures to review and approve. Nothing goes to your buyer before you approve.'
};

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

  const open = async (b) => { await page.evaluate((b) => document.querySelector('#app').__vue_app__._instance.setupState.byrOpenBuyer(b), b); await page.waitForTimeout(500); };
  const text = () => page.locator('[data-bdp]').innerText();
  const progress = async () => {
    await page.getByRole('tab', { name: 'Deal Progress' }).click();
    await page.waitForFunction(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return st.bdp && st.bdp.forId && !st.bdp.loading; });
    await page.waitForTimeout(200);
  };
  const tools = () => page.locator('.card', { hasText: 'Offer Strategies' }).first();
  const writes = () => seen.filter(s => s.m !== 'GET' && s.m !== 'OPTIONS' && !/\/api\/otc\/poll$/.test(s.u));

  // ── tabs ──
  await open(B1);
  ok(await page.locator('[data-bdp-tabs]').count() === 1, 'the buyer folder has the two tabs');
  ok(await page.getByRole('tab', { name: 'Buyer Tools' }).getAttribute('aria-selected') === 'true' && await page.locator('[data-bdp]').count() === 0, 'a buyer opens on Buyer Tools with nothing loaded');
  ok(await tools().isVisible(), 'Buyer Tools shows everything that was there before');
  {
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-bdp-tabs] .dp-tab')].map(b => { const c = getComputedStyle(b); return { cls: b.className, h: b.getBoundingClientRect().height, bg: c.backgroundColor, on: b.classList.contains('dp-tab-on') }; }));
    ok(tabs.length === 2 && tabs.every(x => /\bdp-tab\b/.test(x.cls) && x.h >= 44) && tabs.filter(x => x.on).length === 1 && tabs[0].bg !== tabs[1].bg, 'the same tab buttons as the listing folder (dp-tab, 44px, the open one filled)', tabs);
  }
  seen.length = 0;
  await progress();
  ok(!(await tools().isVisible()), 'Deal Progress hides the tools');
  ok(!(await page.locator('.card', { hasText: 'Client Files' }).first().isVisible()), 'and the client files and Offer Tracker card');
  let t = await text();

  // ── B1: Pending, Command Center file, Open To Close ──
  ok(/Stage now\s*Pending/i.test(t) && t.includes('You are here'), 'stage now and the bar', t.slice(0, 400));
  ok(t.includes('In Pending since Nov 12, 9:05 AM'), 'since when (the Command Center\'s stage change time)', t.slice(0, 400));
  {
    const labels = await page.locator('[data-bdp-stage] .dp-strip-label').allInnerTexts();
    const now = await page.locator('[data-bdp-stage] .dp-strip li.dp-now .dp-strip-label').innerText();
    ok(JSON.stringify(labels) === JSON.stringify(['Agreement Signed', 'Showing', 'Pending', 'Closed']) && now === 'Pending', 'four stages, Pending is here', labels);
  }
  {
    const rows = await page.locator('[data-bdp-agent] .dp-row .dp-tt').allInnerTexts();
    ok(rows.length === 9 && rows[0].trim() === GUIDE.pendingFirst && rows[1].trim() === GUIDE.pendingInspection && rows[8].trim() === GUIDE.pendingLast, 'Agent Responsibility: the guide\'s nine Pending steps, word for word, in order', rows);
    ok(!t.includes('CC AGENT ROW WORDING'), 'the Command Center\'s own agent wording is not shown to the agent');
  }
  ok(await page.locator('[data-bdp] input').count() === 0, 'read only: nothing to tick');
  {
    const c = await page.locator('[data-bdp-concierge]').innerText();
    ok(c.includes('1 of 3 done') && c.includes('Done Nov 12, 3:10 PM · Abby Lee') && /Closing gift ready in office\s*Waiting/.test(c) && c.includes('Open 4 days'), 'Concierge: its Pending items, who and when, waiting and days open', c);
  }
  {
    const otcReq = seen.filter(s => /otc_tasks/.test(s.u));
    ok(otcReq.length === 1 && /property_id=eq\.2001/.test(otcReq[0].u), 'Open To Close: the newest buyer file at the deal card\'s address, never the seller\'s file', otcReq.map(s => s.u));
    const o = await page.locator('[data-bdp-otc]').innerText();
    ok(o.includes('1 of 6 done') && o.includes('has this address 2 times; showing the newest') && !o.includes('SELLER FILE TASK'), 'Transactions: count, the duplicate note, no seller task', o);
    const next = await page.locator('[data-bdp-otc] .dp-row').allInnerTexts();
    ok(next.length === 4 && next[0].startsWith('Add settlement date and location') && next.every(x => x.includes('Open 3 days')), 'Next up: four open items in Open To Close\'s order', next);
  }
  {
    const lane = page.locator('[data-bdp-auto]');
    const now = await lane.locator('.dp-row:not(.dp-row-next) .dp-tt').allInnerTexts();
    const nxt = await lane.locator('.dp-row-next .dp-tt').allInnerTexts();
    ok(now.length === 3 && now[0].trim() === GUIDE.pendingAuto1, 'This stage: the three Pending automations, word for word', now);
    ok(nxt.length === 4 && nxt[2].trim() === GUIDE.closedAuto3 && (await lane.innerText()).includes('When you move the Follow Up Boss deal card to Closed:'), 'Next stage: Closed, word for word', nxt);
  }
  ok(/Earlier stages[\s\S]*BA Signed\s*1 of 2 done/.test(t), 'earlier stage from the Command Center history', t.slice(-500));
  {
    const urls = seen.map(s => s.u);
    ok(urls.some(u => /\/api\/fub\/buyer-stage\?buyer_id=b1$/.test(u)) && urls.some(u => /\/rest\/v1\/deals\?select=\*&fub_deal_id=eq\.501$/.test(u)) && urls.some(u => /deal_tasks\?select=\*&deal_id=eq\.d1&order=sort_order\.asc/.test(u)) && urls.some(u => /task_history\?.*source=eq\.deal_tasks&parent_id=eq\.d1/.test(u)) && urls.some(u => /buyer_post_closing\?.*fub_deal_id=eq\.501/.test(u)), 'reads the buyer\'s stage, then the Command Center file by that deal id', urls.filter(u => /buyer-stage|deals|deal_tasks|task_history|buyer_post/.test(u)));
  }
  ok(!/Rename the deal card/i.test(t), 'no rename reminder when the deal card is named with the address');

  // ── Check Open To Close now ──
  seen.length = 0;
  await page.locator('[data-bdp-otc] .dp-otcnow-btn').click();
  await page.waitForFunction(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return !st.otcNow.busy && !st.bdp.loading; });
  await page.waitForTimeout(300);
  {
    const o = await page.locator('[data-bdp-otc]').innerText();
    ok(OTCNOW.posts === 1 && seen.some(s => /buyer-stage\?buyer_id=b1/.test(s.u)) && o.includes('2 of 6 done') && o.includes('Checked Open To Close just now.'), 'Check Open To Close now runs the shared check and reloads this buyer', o.slice(0, 500));
    ok(/Available again in/.test(o), 'and shows the shared countdown');
  }

  // ── Buyer Tools comes back unchanged ──
  await page.getByRole('tab', { name: 'Buyer Tools' }).click(); await page.waitForTimeout(200);
  ok(await tools().isVisible() && await page.locator('[data-bdp]').count() === 0, 'Buyer Tools brings the tools back');
  ok(await page.locator('.card', { hasText: 'Client Files' }).first().isVisible(), 'and the client files card');

  // ── B7: Actively Showing, deal card not yet an address ──
  await open(B7); seen.length = 0; await progress(); t = await text();
  {
    const rows = await page.locator('[data-bdp-agent] .dp-row .dp-tt').allInnerTexts();
    ok(rows.length === 2 && rows[0].trim() === GUIDE.showingOffer && rows[1].trim() === GUIDE.showingSend, 'Actively Showing: the guide\'s two steps, word for word', rows);
    ok(t.includes('FORWARD OS finds the Open To Close file by the property address on the Follow Up Boss deal card') && !seen.some(s => /otc_/.test(s.u)), 'no address on the deal card yet: says how the file is found, reads nothing from Open To Close', t);
    ok(!t.includes('OTHER BUYER ROW') && !t.includes('Post buyer Under Contract'), 'only this buyer\'s Command Center rows');
    ok(!/Rename the deal card/i.test(t), 'no rename reminder before Pending');
  }

  // ── B8: Pending, deal card still named after a person ──
  await open(B8); await progress(); t = await text();
  ok(/Rename the deal card/i.test(t) && t.includes('FORWARD OS finds Transactions\' Open To Close file by that address.'), 'Pending with a person\'s name on the deal card: the rename reminder', t.slice(0, 700));

  // ── B2: before BA Signed ──
  await open(B2); await progress(); t = await text();
  ok(/Stage in Follow Up Boss\s*15 Min Pre-Qual Complete/i.test(t) && t.includes('In 15 Min Pre-Qual Complete since Nov 5'), 'the stage in Follow Up Boss and since when', t.slice(0, 400));
  {
    const steps = await page.locator('[data-bdp] .dp-agent .dp-row .dp-tt').allInnerTexts();
    ok(steps.length === 9 && steps[0].trim() === GUIDE.prequalLender, 'Your Next Steps: the guide\'s nine steps, word for word', steps);
    ok(t.includes(GUIDE.prequalAuto) && t.includes('You slide the Follow Up Boss deal card to 15 Min Pre-Qual Complete:'), 'automations for the stage, word for word');
    ok(t.includes("Concierge's tasks and Transactions' Open To Close file start when the deal card reaches BA Signed."), 'says when the team\'s lists start');
    ok(await page.locator('[data-bdp-stage]').count() === 0, 'no Command Center bar before BA Signed');
  }
  await open(B9); await progress(); t = await text();
  ok(t.includes(GUIDE.consultTx) && t.includes('You add the tag FWRD Buyer Onboarding to the Follow Up Boss lead record:'), 'Buyer Consult Complete: section 4 of the guide, Transactions included', t.slice(0, 900));

  // ── B3, B4, B5: not linked, two deals, a failed read ──
  await open(B3); await progress(); t = await text();
  ok(t.includes('This buyer is not linked to a Follow Up Boss deal. Create the lead in Follow Up Boss under your name'), 'no deal: tells the agent to create the lead in Follow Up Boss', t.slice(0, 600));
  await open(B4); await progress(); t = await text();
  ok(t.includes('Follow Up Boss has 2 Buyers deals for this buyer') && !t.includes('not linked'), 'two deals: says so, never guesses');
  await open(B5); await progress(); t = await text();
  ok(t.includes("This buyer's stage in Follow Up Boss could not be read:") && t.includes('401 Unauthorized'), 'a failed read is said with the reason', t.slice(0, 600));

  // ── B6: closed ──
  await open(B6); seen.length = 0; await progress(); t = await text();
  ok(/Closed · Oct 30, 2026/i.test(t) && t.includes('It is now safe to archive this buyer card in FORWARD OS.') && await page.locator('[data-bdp-stage]').count() === 0, 'closed: the post-closing note and the closing date as written', t.slice(0, 600));
  ok(!seen.some(s => /deal_tasks|otc_/.test(s.u)), 'a closed buyer reads no tasks');
  await open(B10); await progress(); t = await text();
  ok(/Stage in Follow Up Boss\s*Total Closed This Year/i.test(t) && t.includes('The Command Center has no post-closing program for this buyer. Ask Concierge.') && await page.locator('[data-bdp-stage]').count() === 0 && await page.locator('[data-bdp-agent]').count() === 0, 'a deal moved on past Closed with no post-closing record: its stage and the ask-Concierge note, no empty bar', t.slice(0, 700));

  // ── one buyer never shows another's ──
  await open(B1); await progress();
  await open(B2);
  ok(await page.getByRole('tab', { name: 'Buyer Tools' }).getAttribute('aria-selected') === 'true' && await page.locator('[data-bdp]').count() === 0, 'opening another buyer starts on Buyer Tools');
  await progress(); t = await text();
  ok(!t.includes('Add settlement date') && !t.includes('Stage now'), 'and shows none of the last buyer\'s progress');

  // ── read only ──
  ok(writes().length === 0, 'read only: no write left the page for Deal Progress', writes().map(w => w.m + ' ' + w.u));

  // ── phone ──
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  await open(B1); await progress();
  {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(sw <= 0, 'on a phone the Deal Progress tab does not scroll sideways', sw);
  }

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
