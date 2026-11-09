#!/usr/bin/env node
/*
 * FORWARD OS: every Offer Strategy is kept on the buyer (Marc, Nov 9, 2026). Run on every pull request.
 *
 * Opens the real index.html in headless Chromium against a made-up offer_strategies table that
 * behaves like the real one (sql/2026-11-09_offer_strategies.sql: insert ignore-duplicates, PATCH
 * only of rows not removed, no delete), with real clicks and typing where the agent would:
 *   - Generate on a buyer saves the strategy once, with the buyer, the agent, the inputs and the
 *     result, and the screen says it is saved;
 *   - an edit is sent as one update of that same row; Start Over asks nothing and loses nothing;
 *     a second Generate is a second row;
 *   - the buyer's page lists every strategy newest first with its figures; ticking two shows them
 *     side by side; another buyer's page shows none of them;
 *   - opening a saved one shows it exactly and sends nothing; the first change saves a NEW row
 *     (copied_from) and the saved one is untouched;
 *   - a failed save says NOT saved and keeps the strategy; Try again saves it;
 *   - an edit made just before switching buyer is still sent;
 *   - with no buyer open nothing is sent and the screen says it is not saved;
 *   - Remove hides a strategy and keeps the row; Offer Strategy PDFs show under Generated Reports.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/offer-strategies-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');

const BJ = '57145b0e-4873-4cac-b29d-96bb4b408c3f', BP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUYERS = [
  { id: BJ, buyer_name: 'Julia Long', agent_name: 'Marc Cashin', created_at: '2026-10-01T00:00:00Z' },
  { id: BP, buyer_name: 'Pat Rivera', agent_name: 'Marc Cashin', created_at: '2026-09-01T00:00:00Z' }
];
let DB, writes, writesFail, aiN;
function reset() { DB = []; writes = []; writesFail = false; aiN = 0; }
const strategy = (n) => ({ maxValue: '$64' + n + ',000', marketValue: '$61' + n + ',000', winningOffer: '$60' + n + ',000',
  appraisalGap: null, appraisalGapNote: null, valuationReasoning: 'REASONING ' + n, offerStructure: 'STRUCTURE ' + n,
  escalationClause: null, talkingPoints: '- point', justinNote: null });
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), raw = req.url(), u = decodeURIComponent(raw), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/api\.anthropic\.com/.test(u)) { aiN++; return J(route, 200, { content: [{ type: 'text', text: JSON.stringify(strategy(aiN)) }], stop_reason: 'end_turn' }); }
  if (m === 'GET' && /railway\.app\/buyers/.test(u)) return J(route, 200, BUYERS);
  if (m === 'GET' && /\/rest\/v1\/buyer_assets\?/.test(u)) {
    return J(route, 200, /buyer_id=eq\.57145b0e/.test(u) ? [{ id: 9, buyer_id: BJ, subfolder: 'offer_documents', file_name: 'Offer-Strategy-3-Old-Sound-Rd-Buyer.pdf', drive_link: 'https://drive.google.com/file/d/abc/view', created_at: '2026-11-08T00:00:00Z' }] : []);
  }
  if (/\/rest\/v1\/offer_strategies/.test(u)) {
    if (m === 'GET') {
      const id = (u.match(/buyer_id=eq\.([\w-]+)/) || [])[1];
      return J(route, 200, DB.filter(r => r.buyer_id === id && !r.removed_at).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(r => JSON.parse(JSON.stringify(r))));
    }
    const body = JSON.parse(req.postData() || '{}');
    writes.push({ m, u, body, prefer: req.headers()['prefer'] || '' });
    if (writesFail) return J(route, 503, { message: 'Service Unavailable' });
    if (m === 'POST') {
      if (!/on_conflict=id/.test(u) || !/ignore-duplicates/.test(req.headers()['prefer'] || '')) return J(route, 400, { message: 'expected insert-ignore-duplicates' });
      if (!DB.find(r => r.id === body.id)) DB.push(Object.assign({ created_at: new Date(Date.now() + DB.length * 1000).toISOString(), updated_at: new Date().toISOString(), removed_at: null }, body));
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (m === 'PATCH') {
      const id = (u.match(/id=eq\.([\w-]+)/) || [])[1];
      const r = DB.find(x => x.id === id && (!/removed_at=is\.null/.test(u) || !x.removed_at));
      if (!r) return J(route, 200, []);
      const keys = Object.keys(body);
      if (keys.some(k => k !== 'work' && k !== 'removed_at')) return J(route, 403, { message: 'permission denied' });
      Object.assign(r, body, { updated_at: new Date().toISOString() });
      return J(route, 200, [JSON.parse(JSON.stringify(r))]);
    }
    return J(route, 405, { message: 'no' });
  }
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
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
  const errors = [], dialogs = [];
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
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const wait = (ms) => page.waitForTimeout(ms);
  const st = (fn, arg) => page.evaluate(fn, arg);
  const S = 'document.querySelector("#app").__vue_app__._instance.setupState';

  async function openBuyer(id) {
    await st(async (id) => {
      const s = document.querySelector('#app').__vue_app__._instance.setupState;
      if (!s.byrBuyers.length) await s.byrFetchBuyers();
      s.go('buyer-package'); await new Promise(r => setTimeout(r, 100));
      s.byrOpenBuyer(s.byrBuyers.find(b => b.id === id));
    }, id);
    await wait(400);
  }
  // Fill steps 1 and 2 (the fields the agent types), then press Generate.
  async function generate(address, listPrice) {
    await st(({ address, listPrice }) => {
      const s = document.querySelector('#app').__vue_app__._instance.setupState;
      s.osgAddress = address; s.osgListPrice = listPrice;
      s.osgComps = [{ address: '5 Old Sound Rd', salePrice: '600000', sqft: '1800', status: 'closed' }];
      s.osgStep = 2;
    }, { address, listPrice });
    await wait(150);
    await page.locator('button', { hasText: 'Generate Offer Strategy' }).click();
    await page.waitForFunction(() => document.querySelector('[data-osg-store]'), null, { timeout: 15000 });
    await wait(500);
  }
  const banner = () => st(() => { const b = document.querySelector('[data-osg-store]'); return b ? { state: b.getAttribute('data-state'), text: b.innerText } : null; });
  const nWrites = (m) => writes.filter(w => !m || w.m === m).length;

  reset();
  console.log('Generate on a buyer saves the strategy, once');
  await openBuyer(BJ);
  await st(() => document.querySelector('#app').__vue_app__._instance.setupState.go('offer-strategy'));
  await wait(200);
  await generate('3 Old Sound Rd, Annapolis, MD 21403', '$625,000');
  await wait(1800);
  let b = await banner();
  ok(nWrites('POST') === 1 && DB.length === 1, 'one insert into offer_strategies', writes.map(w => w.m));
  const first = DB[0] || {};
  ok(first.buyer_id === BJ && first.buyer_name === 'Julia Long' && first.agent_name === 'Marc Cashin' && first.address === '3 Old Sound Rd, Annapolis, MD 21403', 'it carries the buyer, the signed-in agent and the address', first);
  ok(first.inputs && first.inputs.listPrice === '$625,000' && first.inputs.comps && first.inputs.comps.length === 1, 'it carries what the strategy was generated from', first.inputs);
  ok(first.work && first.work.result && first.work.result.marketValue === '$611,000' && first.copied_from === null, 'it carries the strategy itself, copied from nothing', first.work);
  ok(b && b.state === 'saved' && /Saved to Julia Long/.test(b.text), 'the screen says it is saved to Julia Long', b);
  ok(nWrites('PATCH') === 0, 'no extra update after the first save', writes.map(w => w.m));

  console.log('\nAn edit updates the same row; Start Over loses nothing');
  await page.locator('button', { hasText: 'Edit figures' }).click(); await wait(150);
  const winInput = page.locator('.form-row', { hasText: 'Winning Offer' }).locator('input').first();
  await winInput.fill('$608,500'); await wait(2200);
  const patches = writes.filter(w => w.m === 'PATCH');
  ok(patches.length === 1 && patches[0].u.includes('id=eq.' + first.id) && /removed_at=is\.null/.test(patches[0].u) && Object.keys(patches[0].body).join() === 'work', 'one PATCH of that row, work only, never a removed row', patches.map(p => [p.u, Object.keys(p.body)]));
  ok(DB[0].work.result.winningOffer === '$608,500' && DB.length === 1, 'the saved strategy holds the edit, still one row', DB[0].work.result);
  b = await banner();
  ok(b.state === 'saved', 'the screen says saved again', b);
  await page.locator('button', { hasText: 'Start Over' }).click(); await wait(400);
  ok(dialogs.length === 0, 'Start Over asks nothing: the strategy is kept', dialogs);
  ok(await st(() => document.querySelector('#app').__vue_app__._instance.setupState.osgStep) === 1 && DB.length === 1 && DB[0].work.result.winningOffer === '$608,500', 'back to step 1 and the saved strategy is untouched');
  await generate('7 Bay Ridge Ave, Annapolis, MD 21403', '$725,000');
  await wait(1800);
  ok(DB.length === 2 && DB[1].inputs.listPrice === '$725,000' && DB[1].id !== DB[0].id, 'a second Generate is a second strategy', DB.map(r => r.address));

  console.log('\nThe buyer\'s page lists them; compare side by side');
  await openBuyer(BJ);
  await page.locator('[data-osg-saved-toggle]').click(); await wait(600);
  let rows = await st(() => Array.from(document.querySelectorAll('[data-osg-saved-row]')).map(r => r.innerText.replace(/\s+/g, ' ')));
  ok(rows.length === 2 && /7 Bay Ridge/i.test(rows[0]) && /3 Old Sound/i.test(rows[1]), 'both are listed, newest first', rows);
  ok(/Market \$612,000/.test(rows[0]) && /Winning offer \$608,500/.test(rows[1]) && /Marc Cashin/.test(rows[1]), 'each shows its figures and agent', rows);
  const gen = await st(() => document.querySelector('#app').innerText);
  ok(/Offer-Strategy-3-Old-Sound-Rd-Buyer\.pdf/.test(gen) && /Generated Reports/i.test(gen), 'a PDF saved to the buyer folder shows under Generated Reports', null);
  await page.locator('[data-osg-cmp]').nth(0).check(); await wait(150);
  ok(await page.locator('[data-osg-compare]').count() === 0, 'one tick is not a comparison yet');
  await page.locator('[data-osg-cmp]').nth(1).check(); await wait(200);
  const cmp = await st(() => { const c = document.querySelector('[data-osg-compare]'); return c ? c.innerText : ''; });
  ok(/7 Bay Ridge/i.test(cmp) && /3 Old Sound/i.test(cmp) && /\$612,000/.test(cmp) && /\$611,000/.test(cmp) && /\$608,500/.test(cmp) && /STRUCTURE 1/.test(cmp) && /STRUCTURE 2/.test(cmp), 'side by side: both addresses, market values, winning offers and structures', cmp.slice(0, 600));
  await page.setViewportSize({ width: 390, height: 844 }); await wait(300);
  const sideways = await st(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(sideways <= 1, 'on a phone the page does not scroll sideways (the table scrolls in its box)', sideways);
  await page.setViewportSize({ width: 1280, height: 900 }); await wait(200);

  console.log('\nAnother buyer sees none of them');
  await openBuyer(BP);
  await page.locator('[data-osg-saved-toggle]').click(); await wait(500);
  rows = await st(() => document.querySelectorAll('[data-osg-saved-row]').length);
  const pt = await st(() => document.querySelector('[data-osg-saved]').innerText);
  ok(rows === 0 && /No strategies saved yet/.test(pt), 'Pat Rivera\'s page lists no strategy', pt.slice(0, 300));

  console.log('\nOpening a saved strategy changes nothing; the first change is a new strategy');
  await openBuyer(BJ);
  await page.locator('[data-osg-saved-toggle]').click(); await wait(500);
  let w0 = writes.length;
  await page.locator('[data-osg-saved-row]', { hasText: '3 Old Sound' }).locator('[data-osg-open]').click(); await wait(2200);
  let v = await st(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { view: s.view, step: s.osgStep, win: s.osgResult && s.osgResult.winningOffer, addr: s.osgAddress, lp: s.osgListPrice }; });
  b = await banner();
  ok(v.view === 'offer-strategy' && v.step === 3 && v.win === '$608,500' && v.addr === '3 Old Sound Rd, Annapolis, MD 21403' && v.lp === '$625,000', 'it opens on Step 3 exactly as saved', v);
  ok(b.state === 'viewing' && /stays exactly as it was/.test(b.text), 'the screen says it stays as it was and changes save as new', b);
  ok(writes.length === w0, 'opening it sends nothing', writes.slice(w0));
  await page.locator('button', { hasText: 'Edit figures' }).click(); await wait(150);
  await page.locator('.form-row', { hasText: 'Market Value' }).locator('input').first().fill('$615,000'); await wait(2200);
  const old = DB.find(r => r.address.startsWith('3 Old Sound') && !r.copied_from);
  const copy = DB.find(r => r.copied_from === (old && old.id));
  ok(DB.length === 3 && copy && copy.work.result.marketValue === '$615,000' && copy.work.result.winningOffer === '$608,500' && copy.inputs.listPrice === '$625,000', 'a new row, copied_from the opened one, with the change and everything else', copy);
  ok(old && old.work.result.marketValue === '$611,000', 'the opened strategy is untouched', old && old.work.result);
  ok(writes.slice(w0).every(w => w.m === 'POST' || !w.u.includes(old.id)), 'no request ever touched the opened row', writes.slice(w0).map(w => [w.m, w.u]));
  b = await banner();
  ok(b.state === 'saved' && /new strategy/.test(b.text), 'the screen says it was saved as a new strategy', b);

  console.log('\nA failed save says so, keeps the strategy, and Try again saves it');
  await page.locator('button', { hasText: 'Start Over' }).click(); await wait(300);
  writesFail = true;
  const before = DB.length;
  await generate('9 Harbor Ct, Annapolis, MD 21403', '$900,000');
  await wait(1500);
  b = await banner();
  ok(b.state === 'error' && /NOT saved to Julia Long/.test(b.text) && /Service Unavailable/.test(b.text) && DB.length === before, 'NOT saved, with the reason; nothing in the table', b);
  ok(await st(() => !!document.querySelector('#app').__vue_app__._instance.setupState.osgResult), 'the strategy stays on screen');
  writesFail = false;
  await page.locator('[data-osg-store-retry]').click(); await wait(1500);
  b = await banner();
  ok(b.state === 'saved' && DB.length === before + 1 && DB[DB.length - 1].address.startsWith('9 Harbor'), 'Try again saves it', b);
  ok(DB.filter(r => r.address.startsWith('9 Harbor')).length === 1, 'and only once');

  console.log('\nAn edit made just before switching buyer is still sent');
  await page.locator('button', { hasText: 'Edit figures' }).click(); await wait(150);
  await page.locator('.form-row', { hasText: 'Max Value' }).locator('input').first().fill('$955,000');
  await openBuyer(BP);
  await wait(1500);
  const harbor = DB.find(r => r.address.startsWith('9 Harbor'));
  ok(harbor.work.result.maxValue === '$955,000', 'the last edit reached the saved strategy', harbor.work.result);

  console.log('\nWith no buyer open nothing is sent, and the screen says so');
  await st(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.byrActiveBuyer = null; s.go('offer-strategy'); });
  await wait(200);
  w0 = writes.length;
  await generate('1 Nowhere Ln, Annapolis, MD 21403', '$500,000');
  await wait(1800);
  b = await banner();
  ok(b.state === 'off' && /NOT saved in the OS/.test(b.text) && writes.length === w0, 'not saved, said plainly, nothing sent', { b, sent: writes.slice(w0) });
  dialogs.length = 0;
  await page.locator('button', { hasText: 'Edit figures' }).click(); await wait(100);
  await page.locator('.form-row', { hasText: 'Max Value' }).locator('input').first().fill('$1');
  await page.locator('button', { hasText: 'Start Over' }).click(); await wait(300);
  ok(dialogs.length === 1 && /NOT saved/.test(dialogs[0]), 'Start Over on an unsaved, edited strategy still asks first', dialogs);

  console.log('\nRemove hides a strategy and keeps the row');
  await openBuyer(BJ);
  await page.locator('[data-osg-saved-toggle]').click(); await wait(500);
  const n0 = await st(() => document.querySelectorAll('[data-osg-saved-row]').length);
  dialogs.length = 0;
  await page.locator('[data-osg-saved-row]', { hasText: '7 Bay Ridge' }).locator('[data-osg-remove]').click(); await wait(800);
  const n1 = await st(() => document.querySelectorAll('[data-osg-saved-row]').length);
  const bay = DB.find(r => r.address.startsWith('7 Bay Ridge'));
  const rm = writes.filter(w => w.m === 'PATCH' && w.body.removed_at);
  ok(dialogs.length === 1 && rm.length === 1 && Object.keys(rm[0].body).join() === 'removed_at' && rm[0].u.includes(bay.id), 'one PATCH setting removed_at on that row, after a confirm', { dialogs, rm });
  ok(n1 === n0 - 1 && bay.removed_at && DB.includes(bay), 'gone from the list, kept in the table', { n0, n1 });
  ok(!writes.some(w => w.m === 'DELETE'), 'nothing is ever deleted');

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
