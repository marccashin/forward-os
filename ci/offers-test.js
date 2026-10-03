#!/usr/bin/env node
/*
 * FORWARD OS: Offer Tracker test. Run on every pull request.
 *
 * Opens the real index.html in headless Chromium as several separate
 * "devices" (each with its own storage) that share one made-up buyer_offers
 * table, and checks the three promises the Offer Tracker makes:
 *   - a failed save is shown, and a retry never creates a second copy;
 *   - a removed offer never comes back, whichever device signs in next;
 *   - offers from the old device copy and the old os_settings rows are moved
 *     into the table once, with no duplicates.
 *
 * SAFETY: never touches production. Every request is intercepted and answered
 * by the mock in this file. The mock's answers for the read query, the
 * foreign key refusal (409 / 23503) and a PATCH that matches nothing (204)
 * were compared with the live database on Oct 3, 2026.
 *
 * Usage: node ci/offers-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path'), crypto = require('crypto');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const B1 = '11111111-1111-4111-8111-111111111111', B2 = '22222222-2222-4222-8222-222222222222', GONE = '99999999-9999-4999-8999-999999999999';
// INDEPENDENT statement of the id rule (Node crypto, not the app's code).
function legacyId(buyer, old) {
  const h = crypto.createHash('sha1').update('forward-os:buyer-offer:' + buyer.toLowerCase() + ':' + String(old)).digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20, 32)].join('-');
}
function newDb() {
  return { buyers: [{ id: B1, buyer_name: 'Buyer One', agent_name: 'Marc Cashin' }, { id: B2, buyer_name: 'Buyer Two', agent_name: 'Marc Cashin' }],
    offers: [], settings: {}, log: [], failOffers: false, failAfterApply: false, tableMissing: false, failSettings: false };
}
const allLog = [];
let db = newDb();
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
function handle(route) {
  const req = route.request(), url = new URL(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  const q = url.searchParams, prefer = req.headers()['prefer'] || '';
  if (url.pathname.endsWith('/rest/v1/buyer_offers')) {
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
    db.log.push({ m, q: url.search, prefer, body });
    allLog.push({ m, q: url.search, prefer, body });
    if (db.tableMissing) return J(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.buyer_offers' in the schema cache" });
    if (db.failOffers) return J(route, 500, { message: 'mock outage' });
    if (m === 'GET') {
      let rows = db.offers.filter(r => r.buyer_id === (q.get('buyer_id') || '').replace('eq.', ''));
      if (q.get('removed_at') === 'is.null') rows = rows.filter(r => r.removed_at == null);
      rows.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
      return J(route, 200, rows);
    }
    if (m === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      for (const r of rows) {
        if (!/^[0-9a-f-]{36}$/.test(r.buyer_id)) return J(route, 400, { code: '22P02', message: 'invalid input syntax for type uuid' });
        if (!db.buyers.some(b => b.id === r.buyer_id)) return J(route, 409, { code: '23503', message: 'violates foreign key constraint "buyer_offers_buyer_id_fkey"' });
        if (!r.address) return J(route, 400, { code: '23502', message: 'null value in column address' });
      }
      for (const r of rows) {
        const i = db.offers.findIndex(o => o.id === r.id);
        if (i < 0) db.offers.push(Object.assign({}, r));
        else if (/merge-duplicates/.test(prefer)) db.offers[i] = Object.assign({}, db.offers[i], r);
        else if (!/ignore-duplicates/.test(prefer)) return J(route, 409, { code: '23505', message: 'duplicate key' });
      }
      if (db.failAfterApply) return J(route, 500, { message: 'mock: applied, answer lost' });
      return J(route, 201);
    }
    if (m === 'PATCH') {
      const id = (q.get('id') || '').replace('eq.', '');
      db.offers.forEach(o => { if (o.id === id && (q.get('removed_at') !== 'is.null' || o.removed_at == null)) Object.assign(o, body); });
      if (db.failAfterApply) return J(route, 500, { message: 'mock: applied, answer lost' });
      return J(route, 204);
    }
    return J(route, 403, { message: 'not allowed' });
  }
  if (url.pathname.endsWith('/rest/v1/os_settings')) {
    if (db.failSettings) return J(route, 500, { message: 'mock outage' });
    if (m === 'GET') {
      const k = q.get('key') || '';
      if (k.startsWith('eq.')) { const key = k.slice(3); return J(route, 200, key in db.settings ? [{ key, value: db.settings[key] }] : []); }
      if (k.startsWith('like.')) { const pre = k.slice(5).replace(/\*$/, ''); return J(route, 200, Object.keys(db.settings).filter(x => x.startsWith(pre)).map(key => ({ key, value: db.settings[key] }))); }
      return J(route, 200, []);
    }
    const b = JSON.parse(req.postData() || '{}'); db.log.push({ m: 'SETTINGS-' + m, key: b.key }); db.settings[b.key] = b.value; return J(route, 201);
  }
  if (/\/buyers(\?|$)/.test(url.pathname + url.search)) return J(route, 200, db.buyers);
  return J(route, 200, []);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); } }
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
  async function device(name, storage) {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return handle(route);
    });
    // Seed once (not on every reload), so the device's storage behaves like a real one.
    await ctx.addInitScript((kv) => { if (localStorage.getItem('__seeded')) return; localStorage.setItem('__seeded', '1'); for (const k in kv) localStorage.setItem(k, kv[k]); },
      Object.assign({ fos_agent: 'Marc Cashin' }, storage || {}));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('[' + name + '] ' + e.message));
    page.on('dialog', d => d.accept().catch(() => {}));
    const d = {
      page, ctx,
      load: async () => { await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1200); },
      ev: (fn, arg) => page.evaluate(fn, arg),
      open: async (id) => { await page.evaluate(async (id) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; await st.byrOpenBuyer({ id, buyer_name: 'Buyer' }); }, id); await page.waitForTimeout(150); },
      add: (address, price) => page.evaluate(async ([a, p]) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.byrNewOffer.address = a; st.byrNewOffer.price = p || ''; await st.byrAddOffer(); }, [address, price]),
      status: (addr, s) => page.evaluate(async ([a, s]) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const o = st.byrGetOffers().find(x => x.address === a); await st.byrUpdateOfferStatus(o.id, s); }, [addr, s]),
      remove: (addr) => page.evaluate(async (a) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const o = st.byrGetOffers().find(x => x.address === a); await st.byrRemoveOffer(o.id); }, addr),
      retry: () => page.evaluate(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.byrRetryOfferSave(); }),
      shown: () => page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.byrGetOffers().map(o => o.address + ':' + o.status)),
      sync: () => page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.byrOfferSync.state),
      text: () => page.evaluate(() => document.querySelector('#app').innerText),
      ls: (k) => page.evaluate((k) => localStorage.getItem(k), k),
    };
    await d.load();
    return d;
  }
  const live = (b) => db.offers.filter(o => o.buyer_id === b && o.removed_at == null).map(o => o.address + ':' + o.status).sort();
  const all = (b) => db.offers.filter(o => o.buyer_id === b);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const legacy = (list) => JSON.stringify(list);
  const L1 = { id: 1759400000001, address: '1 Old St', price: '500,000', notes: 'n', status: 'Submitted', created_at: '2026-09-20T10:00:00.000Z' };
  const L2 = { id: 1759400000002, address: '2 Old St', price: '', notes: '', status: 'Preparing', created_at: '2026-09-21T10:00:00.000Z' };
  const L3 = { id: 1759400000003, address: '3 Old St', price: '', notes: '', status: 'Preparing', created_at: '2026-09-22T10:00:00.000Z' };

  console.log('T1 add, status, visible state');
  db = newDb();
  let A = await device('A');
  await A.open(B1); await A.add('10 New Rd', '700,000');
  ok(eq(live(B1), ['10 New Rd:Preparing']), 'one row saved', live(B1));
  ok(db.offers[0].created_by === 'Marc Cashin' && /^[0-9a-f-]{36}$/.test(db.offers[0].id), 'row has creator and a uuid id');
  ok(await A.sync() === 'saved' && /Saved to the cloud/.test(await A.text()), 'tracker says Saved to the cloud');
  await A.status('10 New Rd', 'Submitted');
  ok(eq(live(B1), ['10 New Rd:Submitted']), 'status saved', live(B1));
  A.ev(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const o = st.byrGetOffers()[0]; st.byrUpdateOfferStatus(o.id, 'Countered'); st.byrUpdateOfferStatus(o.id, 'Accepted'); });
  await A.page.waitForTimeout(500);
  ok(eq(live(B1), ['10 New Rd:Accepted']) && eq(await A.shown(), ['10 New Rd:Accepted']), 'two quick taps end on the last one', live(B1));

  console.log('T2 failed save is shown, retry never duplicates');
  db.failOffers = true;
  await A.add('11 New Rd');
  ok(await A.sync() === 'error' && /NOT saved to the cloud/.test(await A.text()), 'red notice on failure');
  ok(all(B1).length === 1, 'nothing written while failing');
  ok(eq(await A.shown(), ['10 New Rd:Accepted', '11 New Rd:Preparing']), 'unsaved offer stays on screen');
  db.failOffers = false; db.failAfterApply = true;
  await A.retry();
  ok(await A.sync() === 'error' && all(B1).length === 2, 'database applied it but the answer was lost: still shown as not saved');
  db.failAfterApply = false;
  await A.retry(); await A.retry();
  ok(all(B1).length === 2 && await A.sync() === 'saved', 'retry after a lost answer makes no second copy', all(B1).length);
  await A.load(); await A.open(B1);
  ok(all(B1).length === 2 && eq(await A.shown(), ['10 New Rd:Accepted', '11 New Rd:Preparing']), 'reload and reopen: still two');
  db.failOffers = true; await A.add('12 New Rd'); await A.load(); db.failOffers = false; await A.load(); await A.page.waitForTimeout(400);
  ok(all(B1).length === 3, 'an unsaved offer survives a reload and is sent at the next sign-in', all(B1).length);

  console.log('T3 two devices, same buyer');
  let B = await device('B');
  await B.open(B1); await A.open(B1);
  await A.add('20 A St'); await B.add('21 B St');
  ok(all(B1).length === 5, 'both adds kept (neither replaced the other)', all(B1).length);
  await A.open(B1);
  ok((await A.shown()).length === 5, 'device A sees device B\'s offer after reopening');

  console.log('T4 a removed offer never comes back');
  await B.open(B1);
  await A.remove('20 A St');
  const rm = all(B1).find(o => o.address === '20 A St');
  ok(rm && rm.removed_at, 'remove is a soft delete (row kept, removed_at set)');
  db.failOffers = true; await B.status('20 A St', 'Accepted'); db.failOffers = false;   // B holds an unsaved change to it
  await B.retry(); await B.open(B1);
  ok(all(B1).find(o => o.address === '20 A St').removed_at && !(await B.shown()).some(x => x.startsWith('20 A St')), 'stale device with an unsaved change does not bring it back');
  ok(all(B1).find(o => o.address === '20 A St').status === 'Preparing', 'and does not edit the removed row');
  await A.load(); await A.open(B1);
  ok(!(await A.shown()).some(x => x.startsWith('20 A St')), 'gone on device A after reload');

  console.log('T5 move offers from device storage (device that never reached the cloud)');
  db = newDb();
  let C = await device('C', { byrOfferMap: legacy({ [B1]: [L1, L2], [GONE]: [L3] }) });
  await C.page.waitForTimeout(500);
  ok(eq(all(B1).map(o => o.id).sort(), [legacyId(B1, L1.id), legacyId(B1, L2.id)].sort()), 'two rows, ids match the independent rule', all(B1).map(o => o.id));
  const r1 = all(B1).find(o => o.address === '1 Old St');
  ok(r1.status === 'Submitted' && r1.price === '500,000' && r1.created_at === L1.created_at && r1.removed_at === null, 'fields carried over exactly', r1);
  ok(db.offers.length === 2 && !/could not be saved/.test(await C.text()), 'offers of a deleted buyer are skipped without a failure');
  await C.load(); await C.page.waitForTimeout(400); await C.open(B1);
  ok(db.offers.length === 2 && (await C.shown()).length === 2, 'second sign-in adds nothing');
  let D = await device('D', { byrOfferMap: legacy({ [B1]: [L1, L2] }) });
  await D.page.waitForTimeout(500);
  ok(db.offers.length === 2, 'a second device with the same old offers adds nothing');
  ok(await C.ls('byrOfferMap') === legacy({ [B1]: [L1, L2], [GONE]: [L3] }), 'old device copy left untouched');

  console.log('T6 moved, then removed, then a third old device signs in');
  await C.remove('1 Old St');
  let E = await device('E', { byrOfferMap: legacy({ [B1]: [L1, L2] }) });
  await E.page.waitForTimeout(500); await E.open(B1);
  ok(eq(live(B1), ['2 Old St:Preparing']) && eq(await E.shown(), ['2 Old St:Preparing']), 'removed offer stays removed', [live(B1), await E.shown()]);
  ok(db.offers.length === 2, 'still two rows');

  console.log('T7 move offers from the os_settings row');
  db = newDb(); db.settings['buyer_offers:' + B1] = [L1, L2];
  let F = await device('F');
  await F.page.waitForTimeout(500);
  ok(eq(live(B1), ['1 Old St:Submitted', '2 Old St:Preparing']), 'device with nothing stored moves the cloud list', live(B1));
  let G = await device('G', { byrOfferMap: legacy({ [B1]: [L1, L2, L3] }) });    // L3 was removed on another device earlier
  await G.page.waitForTimeout(500); await G.open(B1);
  ok(db.offers.length === 2 && (await G.shown()).length === 2, 'an offer missing from the cloud list is not put back by a stale device', db.offers.length);
  ok(eq(db.settings['buyer_offers:' + B1], [L1, L2]) && !db.log.some(x => String(x.m).startsWith('SETTINGS') && /^buyer_offers:/.test(x.key)), 'os_settings row never written');

  console.log('T8 device with changes that never reached the cloud');
  db = newDb(); db.settings['buyer_offers:' + B1] = [L1, L2];
  let H = await device('H', { byrOfferMap: legacy({ [B1]: [L1] }), byrOfferUnsynced: JSON.stringify([B1]) });   // H removed L2, save failed
  await H.page.waitForTimeout(500);
  ok(eq(live(B1), ['1 Old St:Submitted']) && all(B1).length === 2 && all(B1).find(o => o.address === '2 Old St').removed_at, 'its removal is recorded as removed', all(B1));
  let I = await device('I');
  await I.page.waitForTimeout(500); await I.open(B1);
  ok(eq(live(B1), ['1 Old St:Submitted']) && eq(await I.shown(), ['1 Old St:Submitted']), 'a later device reading the cloud list does not bring it back', live(B1));
  db = newDb(); db.settings['buyer_offers:' + B1] = [L1, L2];
  I = await device('I2'); await I.page.waitForTimeout(500);
  H = await device('H2', { byrOfferMap: legacy({ [B1]: [L1] }), byrOfferUnsynced: JSON.stringify([B1]) });
  await H.page.waitForTimeout(500);
  ok(eq(live(B1), ['1 Old St:Submitted']) && all(B1).length === 2, 'same result in the other order', all(B1));

  console.log('T9 table missing');
  db = newDb(); db.tableMissing = true;
  let K = await device('K');
  await K.open(B1); await K.add('30 Q St');
  ok(await K.sync() === 'error' && /not switched on yet/.test(await K.text()), 'says storage is not switched on');
  ok(eq(await K.shown(), ['30 Q St:Preparing']), 'offer kept on the device');
  db.tableMissing = false; await K.retry();
  ok(eq(live(B1), ['30 Q St:Preparing']) && await K.sync() === 'saved', 'saves once the table is there');

  console.log('T10 cloud unreachable when opening a buyer with old offers');
  db = newDb(); db.failSettings = true; db.failOffers = true;
  let M = await device('M', { byrOfferMap: legacy({ [B1]: [L1, L2] }) });
  await M.page.waitForTimeout(500); await M.open(B1);
  ok((await M.shown()).length === 2 && await M.sync() === 'loaderror' && /Could not check the cloud/.test(await M.text()), 'old offers shown with a notice, not an empty tracker', [await M.shown(), await M.sync()]);
  await M.status('1 Old St', 'Rejected');
  ok(db.offers.length === 0 && (await M.shown())[0] === '1 Old St:Submitted', 'cannot be changed until moved');
  db.failSettings = false; db.failOffers = false; await M.open(B1);
  ok(db.offers.length === 2 && eq(await M.shown(), ['1 Old St:Submitted', '2 Old St:Preparing']), 'moved on the next open', db.offers.length);

  console.log('T11 what was never sent');
  ok(!allLog.some(x => x.m === 'DELETE'), 'no DELETE request');
  ok(!allLog.some(x => x.m === 'PATCH' && x.body && 'removed_at' in x.body && x.body.removed_at == null), 'no request clears removed_at');
  ok(!allLog.some(x => x.m === 'POST' && !/ignore-duplicates/.test(x.prefer)), 'every insert is insert-ignore-duplicates');
  ok(!allLog.some(x => x.m === 'PATCH' && !/removed_at=is\.null/.test(x.q)), 'every change is limited to rows that are not removed');
  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
