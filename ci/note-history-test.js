#!/usr/bin/env node
/*
 * FORWARD OS: a listing shows every saved version of its net sheet, CMA and
 * description. Run on every pull request.
 *
 * Opens the real index.html in headless Chromium against a made-up
 * property_notes table and a made-up property_note_history table that behaves
 * like the real one (the database adds a version on every save, skips an
 * identical re-save, and the app can only read it).
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/note-history-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Ashling McGowan', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' }
];
const MLS = (addr) => '=== MLS DATA ===\nProperty Address : ' + addr + '\nList Price       : $500,000\nHOA Fee          : None';
let notes, hist, hid, mode, sent;
function reset() {
  hid = 0; sent = []; mode = { histFails: false, noByFn: false };
  notes = [
    { id: 'n1', property_id: A, subfolder: 'mls_data', content: MLS(PROPS[0].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n2', property_id: A, subfolder: 'seller_net_sheet', content: 'A SHEET ONLY VERSION', updated_at: '2026-10-02T00:00:00Z' },
    { id: 'n3', property_id: B, subfolder: 'mls_data', content: MLS(PROPS[1].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n4', property_id: B, subfolder: 'seller_net_sheet', content: 'B SHEET V2 CURRENT', updated_at: '2026-10-05T23:00:00Z' },
    { id: 'n5', property_id: B, subfolder: 'cma', content: 'B CMA CURRENT', updated_at: '2026-10-04T00:00:00Z' },
    { id: 'n6', property_id: B, subfolder: 'listing_remarks', content: 'B DESCRIPTION CURRENT', updated_at: '2026-10-04T00:00:00Z' }
  ];
  hist = [];
  const add = (p, sf, c, by, at) => hist.push({ id: ++hid, property_id: p, subfolder: sf, content: c, saved_by: by, saved_at: at });
  add(A, 'seller_net_sheet', 'A SHEET ONLY VERSION', null, '2026-10-02T00:00:00Z');
  add(B, 'seller_net_sheet', 'B SHEET V0 OLDEST', null, '2026-09-30T15:00:00Z');
  add(B, 'seller_net_sheet', 'B SHEET V1 MIDDLE', 'Charlotte Lee', '2026-10-03T15:00:00Z');
  add(B, 'seller_net_sheet', 'B SHEET V2 CURRENT', 'Marc Cashin', '2026-10-05T23:00:00Z');
  add(B, 'cma', 'B CMA EARLIER', 'Niki Lang', '2026-10-01T00:00:00Z');
  add(B, 'cma', 'B CMA CURRENT', 'Marc Cashin', '2026-10-04T00:00:00Z');
  add(B, 'listing_remarks', 'B DESCRIPTION CURRENT', null, '2026-10-04T00:00:00Z');
}
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function saveNote(b) {   // what the database function plus its history trigger do
  if (!b.p_content || !String(b.p_content).trim()) return { status: 400, body: { code: 'P0001', message: 'refusing to replace a note with blank text' } };
  notes = notes.filter(n => !(n.property_id === b.p_property_id && n.subfolder === b.p_subfolder));
  const row = { id: 'n' + Date.now(), property_id: b.p_property_id, subfolder: b.p_subfolder, content: b.p_content, updated_by: b.p_saved_by || null, updated_at: new Date().toISOString() };
  notes.push(row);
  const last = hist.filter(h => h.property_id === row.property_id && h.subfolder === row.subfolder).sort((x, y) => y.id - x.id)[0];
  if (!last || last.content !== row.content) hist.push({ id: ++hid, property_id: row.property_id, subfolder: row.subfolder, content: row.content, saved_by: row.updated_by, saved_at: row.updated_at });
  return { status: 200, body: row };
}
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m !== 'GET') sent.push({ m, u: u.split('?')[0], body: req.postData() || '' });
  if (/\/rest\/v1\/property_note_history/.test(u)) {
    if (m !== 'GET') return J(route, 401, { code: '42501', message: 'permission denied for table property_note_history' });
    if (mode.histFails) return J(route, 500, { message: 'made-up outage' });
    return J(route, 200, hist.filter(h => u.includes(h.property_id)).sort((x, y) => (y.saved_at > x.saved_at ? 1 : y.saved_at < x.saved_at ? -1 : y.id - x.id)));
  }
  if (/\/rpc\/save_property_note_by$/.test(u.split('?')[0])) {
    if (mode.noByFn) return J(route, 404, { code: 'PGRST202', message: 'Could not find the function public.save_property_note_by' });
    const r = saveNote(JSON.parse(req.postData())); return J(route, r.status, r.body);
  }
  if (/\/rpc\/save_property_note$/.test(u.split('?')[0])) { const r = saveNote(JSON.parse(req.postData())); return J(route, r.status, r.body); }
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, notes.filter(n => u.includes(n.property_id)).sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1)));
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
  reset();
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

  const open = (id, tool) => page.evaluate(async ([id, tool]) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!st.lstProperties.length) await st.lstFetchProperties();
    await st.lstOpenProperty(st.lstProperties.find(p => p.id === id));
    await new Promise(r => setTimeout(r, 250));
    const hdr = Array.from(document.querySelectorAll('.subfolder-header')).find(h => new RegExp(tool, 'i').test(h.innerText));
    hdr.click(); await new Promise(r => setTimeout(r, 250));
  }, [id, tool]);
  // What the agent sees for one item: the current-version line, the list, and its rows.
  const see = (key, expand, openRow) => page.evaluate(async ([key, expand, openRow]) => {
    const wait = () => new Promise(r => setTimeout(r, 150));
    const box = document.querySelector('[data-hist="' + key + '"]');
    if (box && expand && !box.querySelector('[data-hist-row]')) { box.querySelector('[data-hist-toggle]').click(); await wait(); }
    const rows = box ? Array.from(box.querySelectorAll('[data-hist-row]')) : [];
    if (openRow !== null && rows[openRow]) { rows[openRow].firstElementChild.click(); await wait(); }
    const cur = document.querySelector('[data-hist-current="' + key + '"]'), err = document.querySelector('[data-hist-error="' + key + '"]');
    const b2 = document.querySelector('[data-hist="' + key + '"]');
    return { listOnScreen: !!b2, toggle: b2 ? b2.querySelector('[data-hist-toggle]').innerText : '', rows: b2 ? Array.from(b2.querySelectorAll('[data-hist-row]')).map(r => r.firstElementChild.innerText.replace(/\s+/g, ' ')) : [],
      openText: b2 && b2.querySelector('[data-hist-text]') ? b2.querySelector('[data-hist-text]').innerText : null, current: cur ? cur.innerText : '', error: err ? err.innerText : '', page: document.querySelector('#app').innerText };
  }, [key, expand || false, openRow === undefined ? null : openRow]);

  console.log('Listing B: net sheet with two earlier versions');
  await open(B, 'Seller Net Sheet');
  let s = await see('seller_net_sheet', true, 0);
  ok(/B SHEET V2 CURRENT/.test(s.page), 'the saved net sheet on screen is the newest', null);
  ok(/^Saved .*2026.* by Marc Cashin$/.test(s.current), 'under it: when it was saved and by whom', s.current);
  ok(/Previous versions \(2\)/i.test(s.toggle), 'Previous versions (2): the current one is not counted', s.toggle);
  ok(s.rows.length === 2 && /Charlotte Lee/.test(s.rows[0]) && /agent not recorded/.test(s.rows[1]), 'rows newest first, each with date and agent; a save from before names were kept says so', s.rows);
  ok(s.openText === 'B SHEET V1 MIDDLE', 'clicking a row opens that version\'s full text', s.openText);
  ok(!s.error, 'no error shown', s.error);

  console.log('Same listing: CMA and description');
  await open(B, 'CMA');
  s = await see('cma', true, 0);
  ok(/Previous versions \(1\)/i.test(s.toggle) && s.openText === 'B CMA EARLIER' && /Niki Lang/.test(s.rows[0]), 'CMA: one earlier version, opens, names the agent', s);
  await open(B, 'Listing Description');
  s = await see('listing_remarks', false);
  ok(!s.listOnScreen && /^Saved /.test(s.current), 'description saved once: a saved line, and no Previous versions list', s);

  console.log('Save a new net sheet on B');
  await open(B, 'Seller Net Sheet');
  sent = [];
  const saved = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.ns.salePrice = '480000'; st.ns.closingDate = '2026-11-14'; st.ns.loan1 = '200000';
    st.calcNetSheet();
    await st.nsSaveToProperty();
    await new Promise(r => setTimeout(r, 600));
    return { note: st.lstNotes.seller_net_sheet, result: st.ns.result };
  });
  const w = sent.filter(x => /\/rpc\/save_property_note/.test(x.u));
  ok(w.length === 1 && /save_property_note_by$/.test(w[0].u), 'one save request, to the function that records the agent', sent.map(x => x.m + ' ' + x.u));
  ok(w.length === 1 && JSON.parse(w[0].body).p_saved_by === 'Marc Cashin' && JSON.parse(w[0].body).p_subfolder === 'seller_net_sheet', 'it carries the signed-in agent\'s name', w[0] && w[0].body.slice(0, 200));
  ok(sent.filter(x => /property_note_history/.test(x.u)).length === 0, 'the app never writes to the history table itself', sent.map(x => x.m + ' ' + x.u));
  s = await see('seller_net_sheet', true, 0);
  ok(/Net Proceeds/.test(saved.note || '') && /by Marc Cashin$/.test(s.current), 'the new sheet is the one on screen, saved by Marc Cashin', { n: (saved.note || '').slice(-60), c: s.current });
  ok(/Previous versions \(3\)/i.test(s.toggle) && s.openText === 'B SHEET V2 CURRENT', 'the list grew to 3 without reopening the listing, and the sheet it replaced is first', s);

  console.log('Saving the same text again adds no version');
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; await st.nsSaveToProperty(); await new Promise(r => setTimeout(r, 500)); });
  s = await see('seller_net_sheet', false);
  ok(/Previous versions \(3\)/i.test(s.toggle), 'still 3', s.toggle);

  console.log('Listing A: one save only, and none of B\'s versions');
  await open(A, 'Seller Net Sheet');
  s = await see('seller_net_sheet', false);
  ok(/A SHEET ONLY VERSION/.test(s.page) && !s.listOnScreen, 'A shows its own sheet and no Previous versions list', s.toggle);
  ok(!/B SHEET/.test(s.page), 'nothing of B\'s on A', null);

  console.log('History cannot be loaded');
  mode.histFails = true;
  await open(B, 'Seller Net Sheet');
  s = await see('seller_net_sheet', false);
  ok(/Net Proceeds/.test(s.page), 'the current net sheet still shows', null);
  ok(/could not be loaded/i.test(s.error) && !s.listOnScreen, 'a plain message says earlier versions could not be loaded', s.error);
  mode.histFails = false;

  console.log('The newer save function is missing');
  mode.noByFn = true; sent = [];
  const fb = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.ns.salePrice = '470000'; st.calcNetSheet(); await st.nsSaveToProperty(); await new Promise(r => setTimeout(r, 500));
    return (st.lstNotes.seller_net_sheet || '').length > 0;
  });
  ok(fb && sent.some(x => /\/rpc\/save_property_note$/.test(x.u)), 'the save falls back to the older function and the note is saved', sent.map(x => x.m + ' ' + x.u));
  mode.noByFn = false;

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
