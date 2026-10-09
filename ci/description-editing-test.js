#!/usr/bin/env node
/*
 * FORWARD OS: the "editing now" marker for the Listing Description Writer.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium against a made-up database whose
 * three marker functions behave like the real ones (the real SQL is tested in
 * ci/description-approval-db-test.js). The page's clock is driven by the test, so
 * "leave it open two minutes" takes no time.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/description-editing-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || '.');
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Ashling McGowan', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD', seller_name: 'Seller B', agent_name: 'Charlotte Lee', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' },
  { id: C, address: '300 Charlie St NW, Washington, DC', seller_name: 'Seller C', agent_name: 'Niki Lang', market: 'DC', status: 'draft', created_at: '2026-09-20T00:00:00Z' }
];
let notes, editing, calls, sent, mode, tick;
function reset() {
  tick = 0; calls = []; sent = []; mode = { fail: 0, hang: false };
  notes = [
    { id: 'n1', property_id: A, subfolder: 'listing_remarks', content: 'A DESCRIPTION', updated_at: '2026-10-02T00:00:00Z' },
    { id: 'n2', property_id: B, subfolder: 'listing_remarks', content: 'B DESCRIPTION', updated_at: '2026-10-04T00:00:00Z' },
    { id: 'n3', property_id: C, subfolder: 'mls_data', content: '=== MLS DATA ===\nList Price : $500,000', updated_at: '2026-10-01T00:00:00Z' }
  ];
  editing = [];
}
const hasDesc = (pid) => notes.some(n => n.property_id === pid && n.subfolder === 'listing_remarks' && String(n.content || '').trim());
function marker(fn, b) {   // what the three database functions do
  const pid = b.p_property_id, who = String(b.p_editor || '').trim(), now = ++tick;
  if (fn === 'stop') { const n = editing.length; editing = editing.filter(e => !(e.property_id === pid && e.editor === who)); return editing.length < n; }
  if (!who) return null;
  if (!hasDesc(pid)) { editing = editing.filter(e => e.property_id !== pid); return null; }
  const cur = editing.find(e => e.property_id === pid);
  if (!cur) { const r = { property_id: pid, editor: who, started_at: now, last_active_at: now }; editing.push(r); return r; }
  if (fn === 'start' || cur.editor !== who) cur.started_at = now;
  cur.editor = who; cur.last_active_at = now; return cur;
}
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method(), base = u.split('?')[0];
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m !== 'GET') sent.push({ m, u: base, body: req.postData() || '' });
  const mk = base.match(/\/rpc\/listing_description_editing_(start|touch|stop)$/);
  if (mk) {
    const b = JSON.parse(req.postData());
    calls.push({ fn: mk[1], pid: b.p_property_id, who: b.p_editor, keys: Object.keys(b).sort().join(',') });
    if (mode.hang) return;                                   // never answers
    if (mode.fail === 404) return J(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
    if (mode.fail) return J(route, mode.fail, { message: 'made-up marker outage' });
    return J(route, 200, marker(mk[1], b));
  }
  if (/\/rest\/v1\/listing_description_editing/.test(base)) return J(route, m === 'GET' ? 200 : 401, m === 'GET' ? editing : { code: '42501', message: 'permission denied' });
  if (/\/rpc\/save_property_note(_by)?$/.test(base)) {
    const b = JSON.parse(req.postData());
    notes = notes.filter(n => !(n.property_id === b.p_property_id && n.subfolder === b.p_subfolder));
    const row = { id: 'n' + (++tick), property_id: b.p_property_id, subfolder: b.p_subfolder, content: b.p_content, updated_by: b.p_saved_by, updated_at: new Date().toISOString() };
    notes.push(row); return J(route, 200, row);
  }
  if (m === 'GET' && /\/rest\/v1\/properties/.test(base)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(base)) return J(route, 200, notes.filter(n => u.includes(n.property_id)).sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1)));
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 900) : '')); } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fns = () => calls.map(c => c.fn + ':' + (c.pid === A ? 'A' : c.pid === B ? 'B' : c.pid === C ? 'C' : c.pid));

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
  const errors = []; let warns = [];
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
  await ctx.addInitScript(() => {
    localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key');
    // The test decides whether the tab is visible.
    window.__vis = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__vis !== 'visible' });
  });
  const page = await ctx.newPage();
  await page.clock.install();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/editing marker/.test(m.text())) warns.push(m.type() + ': ' + m.text()); });
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);

  const settle = () => page.waitForTimeout(350);
  const run = async (fn, arg) => { await page.evaluate(async ([src, a]) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (!st.lstProperties.length) await st.lstFetchProperties(); const f = new Function('st', 'arg', 'return (' + src + ')(st, arg)'); await f(st, a); }, [fn.toString(), arg]); await settle(); };
  const openListing = (id) => run(async (st, id2) => { await st.lstOpenProperty(st.lstProperties.find(p => p.id === id2)); }, id);
  const openWriter = () => run((st) => { st.ldOpenWriter(); });
  const leaveWriter = () => run((st) => { st.view = 'listing-detail'; });
  const minutes = async (n) => { for (let i = 0; i < n * 2; i++) { await page.clock.fastForward(30000); await page.waitForTimeout(60); } await settle(); };
  const visible = async (v) => { await page.evaluate((v2) => { window.__vis = v2 ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }, v); await settle(); };
  const toast = () => page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return (st.toast.show ? st.toast.msg : '') + '|' + (st.goldToast.show ? st.goldToast.msg : ''); });

  console.log('Open the writer on a listing with a saved description');
  await openListing(B);
  ok(calls.length === 0 && editing.length === 0, 'opening the listing itself writes no marker', fns());
  await openWriter();
  ok(same(fns(), ['start:B']) && calls[0].who === 'Marc Cashin' && calls[0].keys === 'p_editor,p_property_id', 'one request: start, this listing, the signed-in agent', calls);
  ok(editing.length === 1 && editing[0].property_id === B && editing[0].editor === 'Marc Cashin' && editing[0].started_at === editing[0].last_active_at, 'the row is there: editor, started_at = last_active_at', editing);
  ok(sent.filter(x => /\/rest\/v1\/listing_description_editing/.test(x.u)).length === 0, 'the app never writes to the table itself');

  console.log('\nLeave it open two minutes');
  const started = editing[0].started_at, active0 = editing[0].last_active_at;
  await minutes(2);
  ok(same(fns(), ['start:B', 'touch:B', 'touch:B']), 'two refreshes in two minutes, about one a minute', fns());
  ok(editing.length === 1 && editing[0].last_active_at > active0 && editing[0].started_at === started, 'last_active_at has moved, started_at has not, still one row', editing);

  console.log('\nThe tab is not visible');
  calls = []; await visible(false); await minutes(3);
  ok(calls.length === 0, 'three minutes hidden: no refresh is sent, so the Command Center stops trusting the row', fns());
  await visible(true);
  ok(same(fns(), ['touch:B']), 'back on the tab: one refresh at once, without waiting for the next minute', fns());
  calls = []; await minutes(1);
  ok(same(fns(), ['touch:B']), 'and the once-a-minute refresh carries on', fns());

  console.log('\nSave from the writer');
  calls = [];
  await run(async (st) => { st.ldStarted = true; st.ldOutput = 'B DESCRIPTION, REWRITTEN'; await st.ldSaveToProperty(); });
  ok(same(fns(), ['stop:B']) && editing.length === 0, 'saving removes the row', { calls: fns(), editing });
  ok(notes.some(n => n.property_id === B && n.subfolder === 'listing_remarks' && n.content === 'B DESCRIPTION, REWRITTEN'), 'and the description was saved');
  await page.clock.fastForward(1000); await settle();
  calls = []; await minutes(3);
  ok(calls.length === 0 && editing.length === 0, 'after the save and the return to the listing, nothing more is sent', fns());

  console.log('\nLeave the writer without saving');
  await openWriter();
  ok(same(fns(), ['start:B']) && editing.length === 1, 'opening it again writes the row again', fns());
  calls = []; await leaveWriter();
  ok(same(fns(), ['stop:B']) && editing.length === 0, 'leaving the writer removes the row', fns());
  calls = []; await minutes(2);
  ok(calls.length === 0, 'and the refresh has stopped', fns());

  console.log('\nSwitch listing');
  await openListing(B); await openWriter(); calls = [];
  await openListing(A);
  ok(same(fns(), ['stop:B']) && editing.length === 0, 'opening another listing removes the first listing\'s row and writes none for the new one', { calls: fns(), editing });
  await openWriter();
  ok(same(fns(), ['stop:B', 'start:A']) && editing.length === 1 && editing[0].property_id === A, 'opening the writer there writes that listing\'s row', { calls: fns(), editing });

  console.log('\nClose the tab');
  calls = [];
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await settle();
  ok(same(fns(), ['stop:A']) && editing.length === 0, 'closing the tab sends the removal', fns());
  calls = []; await minutes(2);
  ok(calls.length === 0, 'and no refresh follows it', fns());
  await visible(true);
  ok(same(fns(), ['start:A']) && editing.length === 1, 'if the page was only put away and comes back, still in the writer, the row is written again', fns());
  await leaveWriter();

  console.log('\nA listing with no saved description');
  calls = []; await openListing(C); await openWriter(); await minutes(2);
  ok(calls.length === 0 && editing.length === 0, 'no row, and no request at all, while the writer is open', fns());
  await run(async (st) => { st.ldStarted = true; st.ldOutput = 'C FIRST DESCRIPTION'; await st.ldSaveToProperty(); });
  await page.clock.fastForward(1000); await settle();
  ok(calls.every(c => c.fn !== 'start' && c.fn !== 'touch') && editing.length === 0, 'saving its first description does not start a marker', fns());

  console.log('\nThe writer with no listing open');
  calls = [];
  await run((st) => { st.lstActiveProp = null; st.view = 'listing-desc'; }); await minutes(2);
  ok(calls.length === 0, 'no request', fns());
  await run((st) => { st.view = 'dashboard'; });

  console.log('\nThe marker cannot be written');
  for (const [name, set] of [['the database answers with an error', () => { mode.fail = 500; }], ['the database never answers', () => { mode.hang = true; }]]) {
    reset(); notes.find(n => n.property_id === B).content = 'B TEXT'; set(); warns = [];
    await openListing(B); await openWriter(); await minutes(1);
    const t1 = await toast();
    const before = Date.now();
    await run(async (st) => { st.ldStarted = true; st.ldOutput = 'B SAVED WHILE THE MARKER IS DOWN'; await st.ldSaveToProperty(); });
    const t2 = await toast();
    ok(notes.some(n => n.property_id === B && n.content === 'B SAVED WHILE THE MARKER IS DOWN') && Date.now() - before < 5000, name + ': the description still saves, and is not held up', Date.now() - before);
    ok(t1 === '|' && /^\|Listing Description saved to /.test(t2), name + ': the agent sees no warning, only the normal saved message', { t1, t2 });
    ok(calls.some(c => c.fn === 'start') && calls.some(c => c.fn === 'touch'), name + ': it kept trying quietly', fns());
    if (mode.fail) ok(warns.length >= 2 && warns.every(w => /^warning: \[editing marker\]/.test(w)), name + ': each failure is written to the browser log', warns);
    await page.clock.fastForward(1000); await settle();
  }
  reset(); mode.fail = 404; warns = [];
  await openListing(B); await openWriter(); await minutes(3); await leaveWriter();
  ok(same(fns(), ['start:B']) && warns.length === 1 && /not set up/.test(warns[0]), 'the database setup has not been run: one attempt, one log line, then it stops asking', { calls: fns(), warns });
  ok((await toast()) === '|', 'and the agent sees nothing');

  ok(errors.length === 0, 'no page errors during the whole run', errors.slice(0, 5));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL the test itself stopped: ' + (e && e.stack || e)); process.exit(1); });
