#!/usr/bin/env node
/*
 * FORWARD OS: MLS Data and the listing's address (Oct 30, 2026). Real clicks on the
 * real index.html in headless Chromium against made-up tables.
 *
 * 1. List price: '1.2M', '1.2 million' and '850k' are read as prices (they became
 *    $1 and $850); something that is not a price stays as typed, is shown in red,
 *    and MLS Data is NOT saved with it.
 * 2. The gate (Marc: "Five figures required"): the other tools open only once list
 *    price, beds, baths, square footage and property type are saved. A note saved
 *    with blanks keeps them closed and the popup names what is missing. A complete
 *    note opens them. Saving a half-filled form works and says what is still missing.
 * 3. The address: "Address updated." only when the server accepted it; a refusal
 *    says NOT saved and the old address stays on screen and in the list. Enter in
 *    the MLS Data address box saves the typed address (it saved a stale one).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const PROPS = [
  { id: A, address: '100 Alpha Ct NW, Washington, DC 20001', seller_name: 'Seller A', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo St NW, Washington, DC 20001', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-30T00:00:00Z' }
];
const note = (o) => ['=== MLS DATA ===', 'Property Address : x', 'List Price       : ' + o.p, 'Bedrooms         : ' + o.b, 'Bathrooms        : ' + o.ba, 'Square Footage   : ' + o.s + ' sq ft', 'Year Built       : —', 'HOA Fee          : None', 'Property Type    : ' + o.t, 'Parking          : —', '', '--- Key Features ---'].join('\n');
const NOTES = {
  [A]: note({ p: '—', b: '3', ba: '—', s: '—', t: 'Condo' }),             // saved half empty
  [B]: note({ p: '$950,000', b: '3', ba: '2', s: '1,600', t: 'Condo' })   // complete
};
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const mode = { patchFails: false };
const sent = [];
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m !== 'GET') sent.push({ m, u, body: req.postData() || '' });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, Object.keys(NOTES).filter(id => u.includes(id)).map((id, i) => ({ id: i + 1, property_id: id, subfolder: 'mls_data', content: NOTES[id], updated_at: '2026-10-01T00:00:00Z' })));
  if (m === 'PATCH' && /\/properties\//.test(u)) return mode.patchFails ? J(route, 500, { detail: 'database unavailable' }) : J(route, 200, { ok: true });
  if (/rpc\/save_property_note/.test(u)) {
    const b = JSON.parse(req.postData() || '{}');
    if (b.p_subfolder === 'mls_data') NOTES[b.p_property_id] = b.p_content;
    return J(route, 200, [{ id: 99, property_id: b.p_property_id, subfolder: b.p_subfolder, content: b.p_content, updated_at: new Date().toISOString() }]);
  }
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
  await ctx.addInitScript(() => {
    localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key');
    window.__toasts = [];
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const run = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const openListing = (id) => run(async (id) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!st.lstProperties.length) await st.lstFetchProperties();
    await st.lstOpenProperty(st.lstProperties.find(p => p.id === id));
    await new Promise(r => setTimeout(r, 200));
  }, id);
  const clickTool = (name) => run(async (name) => {
    const hdr = Array.from(document.querySelectorAll('.subfolder-header')).find(h => h.innerText.toLowerCase().indexOf(name.toLowerCase()) >= 0);
    if (!hdr) return 'no header';
    hdr.click(); await new Promise(r => setTimeout(r, 200));
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const miss = document.querySelector('[data-mls-gate-missing]');
    return { open: st.lstToolOpen, gate: st.mlsGate, missing: miss ? miss.innerText : '' };
  }, name);
  const toastText = () => run(() => Array.from(document.querySelectorAll('.toast, .gold-toast, [class*="toast"]')).map(e => e.innerText).join(' | '));

  console.log('1. The gate');
  await openListing(A);
  let g = await clickTool('Seller Net Sheet');
  ok(g.gate === true && g.open === 'mlsdata' && /list price, baths, square footage/.test(g.missing) && !/beds|property type/.test(g.missing), 'A (saved with blanks): Seller Net Sheet does not open; MLS Data opens and the popup says list price, baths and square footage are still missing', g);
  await run(() => { document.querySelector('#app').__vue_app__._instance.setupState.mlsGate = false; });
  await openListing(B);
  g = await clickTool('Seller Net Sheet');
  ok(g.gate === false && g.open === 'netsheet', 'B (all five saved): Seller Net Sheet opens', g);

  console.log('2. List price');
  await openListing(A);
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.lstToolOpen = 'mlsdata'; await new Promise(r => setTimeout(r, 100)); });
  const price = async (typed) => run(async (typed) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const inp = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === '$1,850,000' && i.offsetParent);
    if (!inp) return { err: 'no box' };
    inp.focus(); inp.value = typed; inp.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 30));
    inp.dispatchEvent(new Event('blur')); await new Promise(r => setTimeout(r, 60));
    const red = document.querySelector('[data-mls-price-problem]');
    return { value: st.mlsForm.listPrice, red: red ? red.innerText : '' };
  }, typed);
  const cases = [['1.2M', '$1,200,000'], ['1.2 million', '$1,200,000'], ['850k', '$850,000'], ['$1,850,000', '$1,850,000'], ['1850000', '$1,850,000']];
  const got = [];
  for (const [t, want] of cases) { const r = await price(t); got.push([t, r.value, r.red]); }
  ok(got.every((x, i) => x[1] === cases[i][1] && x[2] === ''), "'1.2M', '1.2 million' and '850k' become $1,200,000 and $850,000; full prices stay right", got);
  let r = await price('12');
  ok(r.value === '12' && /not a list price/.test(r.red), "'12' is left as typed and shown in red, never turned into $12", r);
  sent.length = 0;
  await run(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.mlsSaveManual(); });
  await wait(200);
  ok(!sent.some(x => /save_property_note/.test(x.u)), 'with that price MLS Data is NOT saved', sent.map(x => x.u));

  console.log('3. A half-filled save works and says what is missing; a full one opens the tools');
  await price('1.2M');
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; Object.assign(st.mlsForm, { beds: '3', baths: '', sqft: '', propType: 'Condo' }); });
  sent.length = 0;
  await run(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.mlsSaveManual(); });
  await wait(250);
  let t = await toastText();
  ok(sent.some(x => /save_property_note/.test(x.u)) && /saved/i.test(t) && /baths and square footage/.test(t), 'saved, and the message says the tools open once baths and square footage are filled in', t);
  g = await clickTool('Seller Net Sheet');
  ok(g.gate === true && /baths, square footage/.test(g.missing), 'still closed after that save', g);
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.mlsGate = false; st.lstToolOpen = 'mlsdata'; Object.assign(st.mlsForm, { baths: '2', sqft: '1,400' }); await st.mlsSaveManual(); });
  await wait(250);
  g = await clickTool('Seller Net Sheet');
  ok(g.gate === false && g.open === 'netsheet' && /List Price\s*:\s*\$1,200,000/.test(NOTES[A]), 'with all five saved the tools open, and the note holds $1,200,000', [g, NOTES[A].split('\n')[2]]);

  console.log('4. The address');
  mode.patchFails = true;
  r = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.lstEditAddressVal = '999 Wrong Way NW, Washington, DC 20001';
    await st.lstSaveAddress(); await new Promise(r => setTimeout(r, 100));
    return { header: st.lstActiveProp.address, list: st.lstProperties.find(p => p.id === st.lstActiveProp.id).address };
  });
  t = await toastText();
  ok(r.header === PROPS[0].address && r.list === PROPS[0].address && /NOT saved/.test(t) && !/Address updated/.test(t), 'the server refuses: the screen and the list keep the old address and say NOT saved', [r, t]);
  mode.patchFails = false;
  await wait(4500);
  r = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.lstEditAddressVal = '101 Alpha Ct NW, Washington, DC 20001';
    await st.lstSaveAddress(); await new Promise(r => setTimeout(r, 100));
    return { header: st.lstActiveProp.address };
  });
  t = await toastText();
  ok(/^101 Alpha Ct NW/.test(r.header) && /Address updated/.test(t), 'the server accepts: the new address shows and the message says updated', [r, t]);
  // Enter in the MLS Data address box
  sent.length = 0;
  r = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.lstToolOpen = 'mlsdata'; st.lstEditAddressVal = 'STALE VALUE'; st.mlsEditingAddress = true; st.mlsEditAddressVal = '102 Alpha Ct NW, Washington, DC 20001';
    await new Promise(r => setTimeout(r, 100));
    const inp = Array.from(document.querySelectorAll('input')).find(i => i.offsetParent && i.value === '102 Alpha Ct NW, Washington, DC 20001');
    if (!inp) return { err: 'no box' };
    inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return { header: st.lstActiveProp.address };
  });
  const body = (sent.find(x => /\/properties\//.test(x.u)) || {}).body || '';
  ok(/102 Alpha Ct NW/.test(body) && !/STALE/.test(body) && /^102 Alpha Ct NW/.test(r.header || ''), 'Enter in the MLS Data address box saves the address typed there', [r, body]);

  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
