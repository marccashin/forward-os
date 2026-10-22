#!/usr/bin/env node
/*
 * FORWARD OS: saved Meeting Prep briefs on a buyer or seller card.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium against a made-up meeting_briefs
 * table that behaves like the real one (sql/2026-10-22_meeting_briefs_move.sql), with
 * real clicks:
 *   - a saved brief says it opens ("Open full brief") and opening it shows the brief;
 *   - Move to another card: search, pick, confirm, ONE call to move_meeting_brief with
 *     the brief, the card and the signed-in agent; both cards then show the truth;
 *     a refused move says why and the brief stays; a move whose answer was lost is
 *     checked against the database before anything is said;
 *   - Remove: one call to remove_meeting_brief; the card stops listing it; a refused
 *     removal says why;
 *   - Brief for another person on this card: opens Meeting Prep with no name, says
 *     where the brief will be saved, and the new brief saves to the same card.
 * Built from the real case of Oct 21, 2026: Julie Chapman's brief saved to buyer
 * Julia Long instead of the Chapman seller card that holds Greg's.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/meeting-briefs-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');

const BJ = '57145b0e-4873-4cac-b29d-96bb4b408c3f', BP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S1 = '9e5a68fb-bb63-44b5-866c-bef99900cb3c', S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BUYERS = [
  { id: BJ, buyer_name: 'Julia Long', agent_name: 'Marc Cashin', created_at: '2026-10-01T00:00:00Z' },
  { id: BP, buyer_name: 'Pat Rivera', agent_name: 'Marc Cashin', created_at: '2026-09-01T00:00:00Z' }
];
const PROPS = [
  { id: S1, address: '219 N Pitt St, Alexandria VA 22314', seller_name: 'Julie and Greg Chapman', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: S2, address: '400 Delta Rd, Bethesda, MD 20814', seller_name: 'Seller Delta', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-01T00:00:00Z' }
];
const brief = (t, label, summary) => ({ disc: { type: t, label, description: 'd', confidence: 'medium', signals: 's' }, summary, talkingPoints: ['FULL BRIEF TALKING POINT'], dos: ['b'], donts: ['c'], opener: 'o', goal: 'g' });
const JULIE = '57fc8ddc-e5e0-467d-8a3e-7a66066d9024', GREG = '5a46122c-6cd2-4996-ab38-29aec3d88078';
let DB, calls, lists, rpcMode;
function reset() {
  DB = [
    { id: JULIE, person_type: 'buyer', person_id: BJ, person_name: 'Julia Long', subject_name: 'Julie Chapman', agent_name: 'Marc Cashin', brief: brief('I', 'Influential', 'Julie Chapman is a career cause-marketer.'), sources: {}, created_at: '2026-10-21T16:32:22Z', removed_at: null },
    { id: GREG, person_type: 'seller', person_id: S1, person_name: 'Julie and Greg Chapman', subject_name: 'Greg Chapman', agent_name: 'Marc Cashin', brief: brief('D', 'Dominant', 'Greg Chapman is a retired enterprise software sales executive.'), sources: {}, created_at: '2026-10-21T16:26:46Z', removed_at: null }
  ];
  calls = []; lists = []; rpcMode = 'ok';
}
const cardName = (t, id) => t === 'buyer' ? (BUYERS.find(b => b.id === id) || {}).buyer_name : (PROPS.find(p => p.id === id) || {}).seller_name;
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/api\.anthropic\.com/.test(u)) return J(route, 200, { content: [{ type: 'text', text: JSON.stringify(brief('S', 'Steady', 'NEW BRIEF for the second person.')) }], stop_reason: 'end_turn' });
  if (/\/api\/meeting-prep-research$/.test(u)) return J(route, 200, { found: false, sources: [] });
  if (m === 'GET' && /railway\.app\/buyers/.test(u)) return J(route, 200, BUYERS);
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/meeting_briefs\?/.test(u)) {
    lists.push(u);
    const t = (u.match(/person_type=eq\.(\w+)/) || [])[1], id = (u.match(/person_id=eq\.([\w-]+)/) || [])[1];
    const live = /removed_at=is\.null/.test(u);
    return J(route, 200, DB.filter(r => r.person_type === t && r.person_id === id && (!live || !r.removed_at)).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  if (m === 'POST' && /\/rest\/v1\/rpc\/(move|remove)_meeting_brief$/.test(u)) {
    const fn = u.match(/rpc\/(\w+)$/)[1], body = JSON.parse(req.postData() || '{}');
    calls.push({ fn, body });
    if (rpcMode === 'refuse') return J(route, 400, { code: 'P0001', message: 'that seller card was not found' });
    const r = DB.find(x => x.id === body.p_id);
    if (fn === 'move_meeting_brief') { r.person_type = body.p_to_type; r.person_id = body.p_to_id; r.person_name = cardName(body.p_to_type, body.p_to_id); }
    else { r.removed_at = new Date().toISOString(); r.removed_by = body.p_by; }
    if (rpcMode === 'lost') return route.abort('connectionreset');
    return J(route, 200, Object.assign({}, r));
  }
  if (m === 'POST' && /\/rest\/v1\/meeting_briefs$/.test(u)) {
    const row = JSON.parse(req.postData() || '{}');
    const saved = Object.assign({ id: 'new-' + DB.length, created_at: new Date().toISOString(), removed_at: null }, row);
    DB.push(saved); calls.push({ fn: 'insert', body: row });
    return J(route, 201, [saved]);
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
  const wait = (ms) => page.waitForTimeout(ms);
  const st = (fn, arg) => page.evaluate(fn, arg);

  // Open a card and its Meeting Prep panel with a real click on the panel header.
  async function openCard(type, id) {
    await st(async ({ type, id }) => {
      const s = document.querySelector('#app').__vue_app__._instance.setupState;
      if (type === 'buyer') {
        if (!s.byrBuyers.length) await s.byrFetchBuyers();
        s.go('buyer-package'); await new Promise(r => setTimeout(r, 100));
        s.byrOpenBuyer(s.byrBuyers.find(b => b.id === id));
        s.mbBuyerOpen = false;
      } else {
        if (!s.lstProperties.length) await s.lstFetchProperties();
        s.go('listings'); await new Promise(r => setTimeout(r, 100));
        await s.lstOpenProperty(s.lstProperties.find(p => p.id === id));
      }
    }, { type, id });
    await wait(250);
    const want = type === 'buyer' ? 'DISC brief for this buyer' : 'DISC brief for this seller';
    await page.locator('.subfolder-header', { hasText: want }).first().click();
    await wait(400);
  }
  const rows = () => st(() => Array.from(document.querySelectorAll('[data-mb-row]')).map(r => r.innerText));
  const panelText = () => st(() => { const h = Array.from(document.querySelectorAll('.subfolder-header')).find(x => /DISC brief for this/.test(x.innerText)); return h ? h.parentElement.innerText : ''; });
  const rowEl = (name) => page.locator('[data-mb-row]', { hasText: name }).first();

  reset();
  console.log('A saved brief says it opens, and opens');
  await openCard('seller', S1);
  let r = await rows();
  ok(r.length === 1 && /Greg Chapman/.test(r[0]) && /Open full brief/i.test(r[0]), 'the seller card lists Greg Chapman\'s brief with Open full brief', r);
  const cur = await st(() => getComputedStyle(document.querySelector('[data-mb-open]')).cursor);
  ok(cur === 'pointer', 'the brief shows a hand pointer', cur);
  ok(lists.length >= 1 && lists.every(u => /removed_at=is\.null/.test(u)), 'the list asks only for briefs that are on the card (removed_at is null)', lists);
  await rowEl('Greg Chapman').locator('[data-mb-open]').click(); await wait(300);
  let v = await st(() => ({ view: document.querySelector('#app').__vue_app__._instance.setupState.view, text: document.querySelector('#app').innerText }));
  ok(v.view === 'meeting-prep' && /FULL BRIEF TALKING POINT/.test(v.text) && /Saved brief from/.test(v.text), 'pressing it opens the whole saved brief', v.view);

  console.log('\nMove Julie Chapman\'s brief from buyer Julia Long to the Chapman seller card');
  await openCard('buyer', BJ);
  r = await rows();
  ok(r.length === 1 && /Julie Chapman/.test(r[0]), 'buyer Julia Long holds Julie Chapman\'s brief', r);
  await rowEl('Julie Chapman').locator('[data-mb-move]').click(); await wait(400);
  ok(await page.locator('[data-mb-move-panel]').count() === 1, 'Move to another card opens a search in the row');
  await page.locator('[data-mb-move-query]').fill('ju'); await wait(150);
  let picks = await st(() => Array.from(document.querySelectorAll('[data-mb-move-pick]')).map(x => x.innerText.replace(/\s+/g, ' ')));
  ok(picks.some(p => /Julie and Greg Chapman/i.test(p)) && !picks.some(p => /Julia Long/i.test(p)), 'the search offers the Chapman card and never the card the brief is on', picks);
  ok(calls.length === 0, 'nothing is sent while searching', calls);
  await page.locator('[data-mb-move-pick]', { hasText: 'Julie and Greg Chapman' }).click(); await wait(150);
  const conf = await st(() => (document.querySelector('[data-mb-move-confirm]') || {}).innerText || '');
  ok(/Julie Chapman's brief from Julia Long \(buyer\) to Julie and Greg Chapman \(seller\)/.test(conf.replace(/\s+/g, ' ')), 'it asks to confirm, naming the brief, where it is and where it goes', conf);
  ok(calls.length === 0, 'nothing is sent before Move it', calls);
  await page.locator('[data-mb-move-go]').click(); await wait(600);
  ok(calls.length === 1 && calls[0].fn === 'move_meeting_brief' && JSON.stringify(calls[0].body) === JSON.stringify({ p_id: JULIE, p_to_type: 'seller', p_to_id: S1, p_by: 'Marc Cashin' }), 'ONE call to move_meeting_brief with the brief, the card and the signed-in agent', calls);
  r = await rows(); let pt = await panelText();
  ok(r.length === 0 && /Julie Chapman's brief was moved to Julie and Greg Chapman \(seller\)/.test(pt), 'Julia Long\'s card no longer lists it and says where it went', { r, pt: pt.slice(0, 400) });
  await openCard('seller', S1);
  r = await rows();
  ok(r.length === 2 && r.some(x => /Julie Chapman/.test(x)) && r.some(x => /Greg Chapman/.test(x)), 'the Chapman card now lists both Greg and Julie', r);

  console.log('\nA refused move says why and leaves the brief where it is');
  rpcMode = 'refuse'; calls = [];
  await rowEl('Julie Chapman').locator('[data-mb-move]').click(); await wait(300);
  await page.locator('[data-mb-move-query]').fill('pat'); await wait(150);
  await page.locator('[data-mb-move-pick]', { hasText: 'Pat Rivera' }).click(); await wait(100);
  await page.locator('[data-mb-move-go]').click(); await wait(600);
  let err = await st(() => (document.querySelector('[data-mb-error]') || {}).innerText || '');
  r = await rows();
  ok(calls.length === 1 && /Not moved: that seller card was not found\. The brief is still on this card\./.test(err), 'the database\'s reason is shown', err);
  ok(r.length === 2 && !/was moved to Pat/.test(await panelText()), 'the brief is still listed and no success is claimed', r);
  await page.locator('[data-mb-move-panel] .mb-act', { hasText: 'Cancel' }).last().click(); await wait(100);

  console.log('\nA move whose answer was lost is checked before anything is said');
  rpcMode = 'lost'; calls = [];
  await rowEl('Julie Chapman').locator('[data-mb-move]').click(); await wait(300);
  await page.locator('[data-mb-move-query]').fill('pat'); await wait(150);
  await page.locator('[data-mb-move-pick]', { hasText: 'Pat Rivera' }).click(); await wait(100);
  const before = lists.length;
  await page.locator('[data-mb-move-go]').click(); await wait(800);
  r = await rows(); pt = await panelText();
  ok(lists.length > before && r.length === 1 && /moved to Pat Rivera \(buyer\)/.test(pt), 'the list is read again; the database shows it moved, so the card says so', { r, pt: pt.slice(0, 300) });
  rpcMode = 'ok';

  console.log('\nRemove takes a brief off the card and keeps it');
  calls = [];
  await rowEl('Greg Chapman').locator('[data-mb-remove]').click(); await wait(200);
  const remText = await st(() => (document.querySelector('[data-mb-remove-panel]') || {}).innerText || '');
  ok(/kept in the database/.test(remText) && calls.length === 0, 'it asks first and says the brief is kept', remText);
  await page.locator('[data-mb-remove-go]').click(); await wait(600);
  r = await rows(); pt = await panelText();
  ok(calls.length === 1 && calls[0].fn === 'remove_meeting_brief' && JSON.stringify(calls[0].body) === JSON.stringify({ p_id: GREG, p_by: 'Marc Cashin' }), 'ONE call to remove_meeting_brief with the brief and the signed-in agent', calls);
  ok(r.length === 0 && /taken off this card\. It is kept in the database/.test(pt) && DB.find(x => x.id === GREG).removed_at, 'the card stops listing it; the row is still in the table', r);

  console.log('\nA refused removal says why');
  reset(); rpcMode = 'refuse';
  await openCard('seller', S1);
  await rowEl('Greg Chapman').locator('[data-mb-remove]').click(); await wait(200);
  await page.locator('[data-mb-remove-go]').click(); await wait(600);
  err = await st(() => (document.querySelector('[data-mb-error]') || {}).innerText || '');
  r = await rows();
  ok(/Not removed: .*The brief is still on this card\./.test(err) && r.length === 1, 'the reason is shown and the brief is still listed', { err, r });
  rpcMode = 'ok';
  await page.locator('[data-mb-remove-panel] .mb-act', { hasText: 'Cancel' }).click(); await wait(100);

  console.log('\nA brief for another person on the same card');
  calls = [];
  await page.locator('[data-mb-another]').first().click(); await wait(400);
  v = await st(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { view: s.view, query: s.mp.query, target: s.mp.target, note: (document.querySelector('[data-mb-target-note]') || {}).innerText || '' }; });
  ok(v.view === 'meeting-prep' && v.query === '' && v.target && v.target.type === 'seller' && v.target.id === S1, 'it opens Meeting Prep with no name filled in, aimed at the same card', v);
  ok(/saved to Julie and Greg Chapman's seller file/.test(v.note), 'the screen says where the brief will be saved', v.note);
  await st(async () => {
    const s = document.querySelector('#app').__vue_app__._instance.setupState;
    s.mp.query = 'Julie Chapman'; s.mp.selectedPerson = { id: null, name: 'Julie Chapman' };
    await s.mpStart();
    if (s.mp.confirming) s.mpSkipResearch();
    for (let i = 0; i < 80 && !s.mp.brief && !s.mp.error; i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 400));
  });
  const ins = calls.filter(c => c.fn === 'insert');
  ok(ins.length === 1 && ins[0].body.person_type === 'seller' && ins[0].body.person_id === S1 && ins[0].body.subject_name === 'Julie Chapman', 'the new brief saves to the same seller card, under Julie Chapman', ins.map(c => c.body && { t: c.body.person_type, id: c.body.person_id, s: c.body.subject_name }));
  await openCard('seller', S1);
  r = await rows();
  ok(r.length === 2 && r.some(x => /Julie Chapman/i.test(x) && /Steady/i.test(x)) && r.some(x => /Greg Chapman/.test(x)), 'the card lists a brief for each person', r);

  console.log('\nOne card\'s notices and edits never show on another');
  await rowEl('Greg Chapman').locator('[data-mb-move]').click(); await wait(200);
  await openCard('seller', S2);
  ok(await page.locator('[data-mb-move-panel]').count() === 0 && (await rows()).length === 0, 'another card opens with no move panel and none of the Chapman briefs');

  console.log('\nPhone');
  await page.setViewportSize({ width: 390, height: 844 }); await wait(200);
  await openCard('seller', S1);
  await rowEl('Greg Chapman').locator('[data-mb-move]').click(); await wait(300);
  const sw = await st(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(sw <= 1, 'no sideways scroll with the move panel open on a phone', sw);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
