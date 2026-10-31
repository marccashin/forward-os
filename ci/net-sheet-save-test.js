#!/usr/bin/env node
/*
 * FORWARD OS: the net sheet's Save to Listing and its tax wording (Oct 31, 2026).
 * Real index.html, headless Chromium, made-up listings A and B.
 *
 * 1. Save on a sheet opened from listing A saves what is on screen: a price changed
 *    after Calculate is calculated again before saving (it used to save the old one).
 * 2. A sheet NOT opened from a listing (the standalone panel), with listing A and a
 *    buyer opened earlier, never files itself anywhere: the "which listing" window
 *    opens and nothing is sent. Picking B files the note to B (with the agent's
 *    name) and the PDF in B's own folder, and A's note on screen is untouched.
 * 3. Wording: Virginia's tax hint says the calendar year; its paid/unpaid answer
 *    says the seller's days are charged; its warning names Virginia, not Maryland.
 *    Maryland keeps its own wording.
 * 4. No first-time buyer field is left in the net sheet.
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const H = '88888888-8888-4888-8888-888888888888', I = '99999999-9999-4999-8999-999999999999', K = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C = '44444444-4444-4444-8444-444444444444', D = '55555555-5555-4555-8555-555555555555', E = '66666666-6666-4666-8666-666666666666', G = '77777777-7777-4777-8777-777777777777';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', BUY = '33333333-3333-4333-8333-333333333333';
const PROPS = [
  { id: A, address: '100 Alpha Ct NW, Washington, DC 20001', seller_name: 'Seller A', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo St NW, Washington, DC 20001', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-30T00:00:00Z' },
  { id: C, address: '300 Charlie St NW, Unit 4, Washington, DC 20001', seller_name: 'Seller C', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-29T00:00:00Z' },
  { id: D, address: '300 Charlie St NW, Unit #5, Washington, DC 20001', seller_name: 'Seller D', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-28T00:00:00Z' },
  { id: E, address: '2326 Fort Dr, Alexandria, VA, 22303', seller_name: 'Seller E', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-09-27T00:00:00Z' },
  { id: G, address: '500 Echo St NW, Washington, DC 20001', seller_name: 'Seller G', agent_name: 'Ashling McGowan', market: 'DC', status: 'draft', created_at: '2026-09-26T00:00:00Z' },
  // Saved without a ZIP, as 11 real listings were (Oct 31, 2026)
  { id: H, address: '4101 Albemarle Street NW #612', seller_name: 'Seller H', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-20T00:00:00Z' },
  { id: I, address: '9124 Potomac Ridge Rd', seller_name: 'Seller I', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-09-19T00:00:00Z' },
  { id: K, address: '1415 Riverside Ave. Baltimore, MD', seller_name: 'Seller K', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-18T00:00:00Z' }
];
const MLS = ['=== MLS DATA ===', 'Property Address : x', 'List Price       : $900,000', 'Bedrooms         : 3', 'Bathrooms        : 2', 'Square Footage   : 1,600 sq ft', 'Property Type    : Condo'].join('\n');
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const sent = [];
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m !== 'GET') sent.push({ m, u, body: req.postData() || '' });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/buyers/.test(u)) return J(route, 200, [{ id: BUY, buyer_name: 'Buyer One', agent_name: 'Marc Cashin', created_at: '2026-10-01T00:00:00Z' }]);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, PROPS.filter(p => u.includes(p.id)).map((p, i) => ({ id: i + 1, property_id: p.id, subfolder: 'mls_data', content: MLS, updated_at: '2026-10-01T00:00:00Z' })));
  if (/rpc\/save_property_note/.test(u)) { const b = JSON.parse(req.postData() || '{}'); return J(route, 200, [{ id: 9, property_id: b.p_property_id, subfolder: b.p_subfolder, content: b.p_content, updated_at: new Date().toISOString() }]); }
  if (/\/storage\/v1\/object\/listing-files\//.test(u)) return J(route, 200, { Key: 'x' });
  if (m === 'GET') return J(route, 200, []);
  return J(route, 200, [{ id: 1 }]);
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
  // A stand-in for Google Places that answers like the real one for three addresses.
  // Potomac Ridge only has a Court, never the Road: an answer for another street must be refused.
  await ctx.addInitScript(() => {
    const comp = (n, t) => ({ long_name: n, short_name: n, types: t });
    const PRED = {
      '4101 albemarle': [{ description: '4101 Albemarle St NW, Washington, DC, USA', place_id: 'pH' }],
      '9124 potomac': [{ description: '9124 Potomac Ridge Ct, Great Falls, VA, USA', place_id: 'pI' }],
      '1415 riverside': [{ description: '1415 Riverside Ave, Baltimore, MD, USA', place_id: 'pK' }]
    };
    const DET = {
      pH: [comp('4101', ['street_number']), comp('Washington', ['locality']), comp('District of Columbia', ['administrative_area_level_2']), Object.assign(comp('District of Columbia', ['administrative_area_level_1']), { short_name: 'DC' }), comp('20016', ['postal_code'])],
      pI: [comp('9124', ['street_number']), comp('Great Falls', ['locality']), comp('Fairfax County', ['administrative_area_level_2']), Object.assign(comp('Virginia', ['administrative_area_level_1']), { short_name: 'VA' }), comp('22066', ['postal_code'])],
      pK: [comp('1415', ['street_number']), comp('Baltimore', ['locality']), comp('Baltimore City', ['administrative_area_level_2']), Object.assign(comp('Maryland', ['administrative_area_level_1']), { short_name: 'MD' }), comp('21230', ['postal_code'])]
    };
    window.__gAsked = [];
    window.google = { maps: { places: {
      AutocompleteService: function () { this.getPlacePredictions = (q, cb) => { window.__gAsked.push(q.input); const k = Object.keys(PRED).find(k => q.input.toLowerCase().indexOf(k) === 0); setTimeout(() => cb(k ? PRED[k] : [], k ? 'OK' : 'ZERO_RESULTS'), 20); }; },
      PlacesService: function () { this.getDetails = (r, cb) => setTimeout(() => cb(DET[r.placeId] ? { address_components: DET[r.placeId] } : null, DET[r.placeId] ? 'OK' : 'NOT_FOUND'), 20); }
    } } };
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const run = (fn, arg) => page.evaluate(fn, arg);
  const FILL = { salePrice: '900000', closingDate: '2026-12-15', propTaxAnnual: '6000', loan1: '400000', sellerCompMode: 'pct', sellerCompVal: '2.5', buyerCompMode: 'pct', buyerCompVal: '2.5' };

  console.log('1. Save on a listing saves what is on screen');
  const r1 = await run(async (FILL) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    await st.lstFetchProperties(); await st.lstOpenProperty(st.lstProperties.find(p => p.address.startsWith('100'))); await w(200);
    st.lstOpenTool('netsheet'); await w(200);
    Object.assign(st.ns, FILL); await w(50);
    st.calcNetSheet(); await w(100);
    const netOld = st.ns.result;
    st.ns.salePrice = '950000'; await w(50);
    await st.nsSaveToProperty(); await w(300);
    const savedNet = st.ns.result;
    st.calcNetSheet(); await w(100);
    return { netOld, savedNet, fresh: st.ns.result, note: st.lstNotes.seller_net_sheet || '', picker: st.showSaveToProp };
  }, FILL);
  const saved1 = sent.filter(x => /save_property_note/.test(x.u)).map(x => JSON.parse(x.body));
  const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  ok(r1.savedNet === r1.fresh && r1.savedNet !== r1.netOld && saved1.length === 1 && saved1[0].p_property_id === A && saved1[0].p_content.indexOf('Net Proceeds: ' + fmt(r1.fresh)) >= 0 && !r1.picker,
    'price changed after Calculate: the note saved to A carries the recalculated net (' + fmt(r1.fresh) + '), not the old one (' + fmt(r1.netOld) + ')', [r1, saved1.map(x => x.p_content.slice(-40))]);

  console.log('2. A standalone sheet always asks which listing');
  sent.length = 0;
  const r2 = await run(async (FILL) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    if (st.byrFetchBuyers) { await st.byrFetchBuyers(); }
    const buyer = (st.byrBuyers || []).find(b => b.buyer_name === 'Buyer One');
    if (buyer) st.byrActiveBuyer = buyer;
    // a client file on both A and the buyer, as earlier sessions created them
    const pf = (st.propFiles || []);
    st.view = 'just-listed'; await w(200); st.lpOpen('netsheet'); await w(200);
    Object.assign(st.ns, FILL, { address: '200 Bravo St NW, Washington, DC 20001', jurisdiction: 'dc' }); await w(50);
    st.calcNetSheet(); await w(150);
    const noteA = st.lstNotes.seller_net_sheet || '';
    await st.nsSaveToProperty(); await w(300);
    const after = { picker: st.showSaveToProp, direct: !!(st.saveToPropData && st.saveToPropData.direct), picked: st.saveToPropSelected, offered: (st.saveToPropMatches || []).map(p => p.id), rows: Array.from(document.querySelectorAll('[data-save-match-row]')).map(e => e.textContent.trim()), createBox: /Or create a new property file/i.test(document.body.innerText) };
    return { after, noteA, activeProp: st.lstActiveProp && st.lstActiveProp.id, buyer: !!buyer, pfCount: pf.length };
  }, FILL);
  ok(r2.after.picker === true && r2.after.direct === true && !sent.some(x => /save_property_note|listing-files|upload-file/.test(x.u)), 'with listing A (and a buyer) opened earlier, Save opens the which-listing window and sends nothing', [r2, sent.map(x => x.u)]);
  ok(r2.after.offered.length === 1 && r2.after.offered[0] === B && r2.after.picked === B && r2.after.rows.length === 1 && /200 Bravo/.test(r2.after.rows[0]) && !r2.after.createBox, 'the window offers only the listing at the sheet\'s address (B), already picked, and no "create a new property file" box', r2.after);
  const r3 = await run(async (B) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    const btn = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent && /^\s*Save to Property\s*$/.test(b.textContent)).pop();
    btn.click(); await w(500);
    return { picker: st.showSaveToProp, noteOnScreen: st.lstNotes.seller_net_sheet || '', gold: st.goldToast.show ? st.goldToast.msg : '', toast: st.toast.show ? st.toast.msg : '' };
  }, B);
  const toB = sent.filter(x => /save_property_note/.test(x.u)).map(x => JSON.parse(x.body));
  const pdfB = sent.filter(x => /\/storage\/v1\/object\/listing-files\//.test(x.u));
  ok(toB.length === 1 && toB[0].p_property_id === B && toB[0].p_subfolder === 'seller_net_sheet' && /Marc Cashin/.test(JSON.stringify(toB[0])), 'picking B saves the net sheet note to B with the agent\'s name', toB);
  ok(pdfB.length === 1 && pdfB[0].u.indexOf('/listing-files/' + B + '/') >= 0 && !sent.some(x => /upload-file|googleapis/.test(x.u)), 'and files the PDF in B\'s own folder, not through the old Drive route', sent.map(x => x.m + ' ' + x.u));
  ok(r3.noteOnScreen === r2.noteA && r3.picker === false, 'listing A\'s note on screen is untouched and the window closes', r3);

  console.log('2b. Which listings match a sheet (hand-written answers)');
  const CASES = [
    ['200 Bravo St NW, Washington, DC 20001', '', 'DC', '200 Bravo St NW, Washington, DC 20001', 'DC', true, 'same address'],
    ['200 Bravo Street Northwest, Washington, DC 20001', '', 'DC', '200 Bravo St NW, Washington, DC 20001', 'DC', true, 'Street/Northwest written out'],
    ['200 Bravo St NW, Washington, DC 20002', '', 'DC', '200 Bravo St NW, Washington, DC 20001', 'DC', false, 'different ZIP'],
    ['201 Bravo St NW, Washington, DC 20001', '', 'DC', '200 Bravo St NW, Washington, DC 20001', 'DC', false, 'different house number'],
    ['300 Charlie St NW, Washington, DC 20001', '4', 'DC', '300 Charlie St NW, Unit 4, Washington, DC 20001', 'DC', true, 'unit in the Unit box'],
    ['300 Charlie St NW, Washington, DC 20001', '4', 'DC', '300 Charlie St NW, Unit #5, Washington, DC 20001', 'DC', false, 'unit 4 is not unit 5'],
    ['300 Charlie St NW Apt 4, Washington, DC 20001', '', 'DC', '300 Charlie St NW, Unit 4, Washington, DC 20001', 'DC', true, 'Apt 4 in the street = Unit 4'],
    ['300 Charlie St NW #5, Washington, DC 20001', '', 'DC', '300 Charlie St NW, Unit #5, Washington, DC 20001', 'DC', true, '#5 = Unit #5'],
    ['300 Charlie St NW, Washington, DC 20001', '', 'DC', '300 Charlie St NW, Unit 4, Washington, DC 20001', 'DC', false, 'no unit on the sheet, unit 4 on the listing'],
    ['2326 Fort Dr, Washington, DC 20001', '', 'DC', '2326 Fort Dr, Alexandria, VA, 22303', 'VA', false, 'a DC sheet on a Virginia listing (the staging test)'],
    ['2326 Fort Dr, Alexandria, VA 22303', '', 'VA', '2326 Fort Dr, Alexandria, VA, 22303', 'VA', true, 'Virginia, commas differ'],
    ['400 Delta St NE, Washington, DC 20002', '', 'DC', '400 Delta St, Washington, DC 20002', 'DC', true, 'quadrant missing on the listing'],
    ['400 Delta St SE, Washington, DC 20002', '', 'DC', '400 Delta St NE, Washington, DC 20002', 'DC', false, 'SE is not NE'],
    ['400 Delta St NE, Washington, DC 20002', '', 'DC', 'Joseph Abbatiello', 'DC', false, 'a listing named for its seller'],
    ['123 Main St, Bethesda, MD 20814', '', 'MD', '123 Main St', '', false, 'a listing with no state or ZIP'],
    ['123 Main St, Bethesda, MD 20814', '', 'MD', '123 Main St', 'Maryland', true, 'state from the listing\'s market'],
    ['123 Main St, Bethesda, MD 20814', '', 'MD', '123 Main St', 'Virginia', false, 'market in another state']
  ];
  const got = await run((cases) => cases.map(c => (window.fosSheetListingMatch ? window.fosSheetListingMatch(c[0], c[1], c[2], { address: c[3], market: c[4] }) : { ok: null })), CASES);
  CASES.forEach((c, i) => ok(got[i].ok === c[5], (c[5] ? 'matches: ' : 'refuses: ') + c[6], got[i]));

  console.log('4. Typing in the address box suggests the agent\'s own listings');
  sent.length = 0;
  await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    try { st.closePDFViewer(); } catch (e) {} try { st.pdfViewClose(); } catch (e) {}
    st.showSaveToProp = false; st.view = 'just-listed'; await w(150); st.lpOpen('netsheet'); await w(150);
    Object.assign(st.ns, { address: '', unit: '', result: null }); await w(100);
  });
  await page.click('#ns-address-input'); await page.waitForTimeout(200);
  const onFocus = await page.$$eval('[data-ns-listing-sug]', els => els.map(e => e.textContent.trim()));
  ok(onFocus.some(t => /100 Alpha/.test(t)) && onFocus.some(t => /2326 Fort/.test(t)) && !onFocus.some(t => /500 Echo/.test(t)), 'clicking the empty box lists Marc\'s own listings and not another agent\'s', onFocus);
  await page.type('#ns-address-input', '300 char', { delay: 20 }); await page.waitForTimeout(200);
  const typed = await page.$$eval('[data-ns-listing-sug]', els => els.map(e => e.textContent.trim()));
  ok(typed.length === 2 && typed.every(t => /300 Charlie/.test(t)), 'typing "300 char" narrows it to the two Charlie St units', typed);
  await page.click('[data-ns-listing-sug]:has-text("Unit 4")'); await page.waitForTimeout(200);
  const picked = await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return { address: st.ns.address, unit: st.ns.unit, j: st.ns.jurisdiction, open: document.querySelectorAll('[data-ns-listing-sug]').length }; });
  ok(picked.address === '300 Charlie St NW, Washington, DC 20001' && picked.unit === '4' && picked.j === 'dc' && picked.open === 0, 'picking it fills the address and Unit 4 exactly and closes the list', picked);
  await page.fill('#ns-address-input', ''); await page.type('#ns-address-input', 'echo', { delay: 20 }); await page.waitForTimeout(200);
  const typedEcho = await page.$$eval('[data-ns-listing-sug]', els => els.map(e => e.textContent.trim()));
  ok(typedEcho.length === 1 && /500 Echo/.test(typedEcho[0]), 'Marc can still find a teammate\'s listing by typing it', typedEcho);
  await page.click('[data-ns-listing-sug]'); await page.waitForTimeout(100);
  await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ns._listingSugs = []; });
  await page.click('#ns-address-input'); await page.fill('#ns-address-input', ''); await page.type('#ns-address-input', '300 char', { delay: 10 }); await page.waitForTimeout(150);
  await page.click('[data-ns-listing-sug]:has-text("Unit 4")'); await page.waitForTimeout(150);
  const r4 = await run(async (FILL) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    Object.assign(st.ns, FILL); await w(50); st.calcNetSheet(); await w(150);
    await st.nsSaveToProperty(); await w(300);
    const o = { picked: st.saveToPropSelected, offered: (st.saveToPropMatches || []).map(p => p.id) };
    const btn = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent && /^\s*Save to Property\s*$/.test(b.textContent)).pop();
    btn.click(); await w(500);
    return o;
  }, FILL);
  const toC = sent.filter(x => /save_property_note/.test(x.u)).map(x => JSON.parse(x.body));
  ok(r4.offered.length === 1 && r4.picked === C && toC.length === 1 && toC[0].p_property_id === C && sent.some(x => x.u.indexOf('/listing-files/' + C + '/') >= 0), 'a sheet filled by picking Unit 4 offers only Unit 4, and Save files it there', [r4, toC.map(x => x.p_property_id)]);

  console.log('4b. A listing saved without a ZIP gets it from Google, and only for its own street');
  const pickNoZip = async (typed, label) => {
    await run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; try { st.closePDFViewer(); } catch (e) {} st.showSaveToProp = false; Object.assign(st.ns, { address: '', unit: '', result: null, _pickNote: '' }); });
    await page.click('#ns-address-input'); await page.fill('#ns-address-input', ''); await page.type('#ns-address-input', typed, { delay: 10 }); await page.waitForTimeout(150);
    await page.click('[data-ns-listing-sug]:has-text("' + label + '")'); await page.waitForTimeout(400);
    return run(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const n = document.querySelector('[data-ns-pick-note]'); return { address: st.ns.address, unit: st.ns.unit, j: st.ns.jurisdiction, note: n ? n.textContent.trim() : '', problem: st.nsAddrProblem }; });
  };
  const h = await pickNoZip('4101', '4101 Albemarle');
  ok(h.address === '4101 Albemarle Street NW, Washington, DC 20016' && h.unit === '612' && h.j === 'dc' && /ZIP code 20016 added from Google/.test(h.note) && !/address/i.test(h.problem), 'Albemarle (no ZIP saved): the box gets Washington, DC 20016 from Google, Unit 612 kept, the agent is told, and the address check is satisfied', h);
  sent.length = 0;
  const rh = await run(async (FILL) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const w = (ms) => new Promise(r => setTimeout(r, ms));
    Object.assign(st.ns, FILL); st.calcNetSheet(); await w(150); try { st.closePDFViewer(); } catch (e) {} await st.nsSaveToProperty(); await w(300);
    const o = { picked: st.saveToPropSelected, offered: (st.saveToPropMatches || []).map(p => p.id) }; st.showSaveToProp = false; return o; }, FILL);
  ok(rh.offered.length === 1 && rh.picked === H, 'and Save offers that listing (ZIP compared only where both have one)', rh);
  const i9 = await pickNoZip('9124', '9124 Potomac');
  ok(i9.address === '9124 Potomac Ridge Rd, VA' && /no city or ZIP code\. Type it/.test(i9.note), 'Potomac Ridge Rd: Google only knows Potomac Ridge Ct, so nothing is filled from it and the agent is told to type the city and ZIP', i9);
  const k = await pickNoZip('1415', '1415 Riverside');
  ok(k.address === '1415 Riverside Ave., Baltimore, MD 21230' && /^md-/.test(k.j) && k.j !== 'md-other' && /ZIP code 21230/.test(k.note), 'Riverside Ave, Baltimore: the ZIP comes from Google and the Maryland county from Google too (' + k.j + ')', k);
  const asked = await run(() => window.__gAsked.filter(q => /^(4101|9124|1415) [A-Z]/.test(q)));
  ok(asked.indexOf('4101 Albemarle Street NW, DC') > -1 && asked.indexOf('9124 Potomac Ridge Rd, VA') > -1 && asked.indexOf('1415 Riverside Ave., Baltimore, MD') > -1, 'Google is asked with the listing\'s own street, city and state', asked);
  const a1 = await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const w = (ms) => new Promise(r => setTimeout(r, ms)); const n0 = window.__gAsked.length; st.nsPickListing(st.lstProperties.find(p => p.address.startsWith('100 Alpha'))); await w(200); return { asked: window.__gAsked.length - n0, address: st.ns.address, note: st.ns._pickNote }; });
  ok(a1.asked === 0 && a1.address === '100 Alpha Ct NW, Washington, DC 20001' && a1.note === '', 'a listing saved with its ZIP is filled as saved, with no Google lookup and no note', a1);

  console.log('5. No listing at the address: nothing is saved');
  sent.length = 0;
  const r5 = await run(async (args) => {
    const [FILL, A] = args;
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    Object.assign(st.ns, FILL, { address: '999 Nowhere St NW, Washington, DC 20001', unit: '', jurisdiction: 'dc' }); await w(50);
    st.calcNetSheet(); await w(150);
    await st.nsSaveToProperty(); await w(300);
    const btn = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent && /^\s*Save to Property\s*$/.test(b.textContent)).pop();
    const o = { picker: st.showSaveToProp, none: !!document.querySelector('[data-save-match-none]'), rows: document.querySelectorAll('[data-save-match-row]').length, disabled: btn.disabled };
    st.saveToPropSelected = A; await st.confirmSaveToPropDrive(); await w(300);
    o.toast = st.toast.msg; st.showSaveToProp = false;  // the message itself: an earlier toast's timer can hide it within a second (CI, Oct 31, 2026)
    return o;
  }, [FILL, A]);
  ok(r5.picker && r5.none && r5.rows === 0 && r5.disabled && /^Not saved\. Pick the listing at this net sheet's address/.test(r5.toast) && !sent.some(x => /save_property_note|listing-files\/[0-9a-f]/.test(x.u)), 'the window says no listing has this address, Save is off, and forcing listing A still saves nothing', [r5, sent.map(x => x.u)]);

  console.log('6. Inside a listing, a sheet changed to another address is not saved');
  sent.length = 0;
  const r6 = await run(async (FILL) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    st.view = 'listing-detail'; await st.lstOpenProperty(st.lstProperties.find(p => p.address.startsWith('100'))); await w(200);
    st.lstOpenTool('netsheet'); await w(200);
    Object.assign(st.ns, FILL); st.calcNetSheet(); await w(100);
    const okBefore = st.ns._propId === st.lstActiveProp.id;
    st.ns.address = '200 Bravo St NW, Washington, DC 20001'; await w(50);
    await st.nsSaveToProperty(); await w(300);
    return { okBefore, toast: st.toast.show ? st.toast.msg : '', lastMsg: st.toast.msg, picker: st.showSaveToProp, view: st.view, addr: st.ns.address, res: st.ns.result, saved: st.nsSaved };
  }, FILL);
  ok(r6.okBefore && /^Not saved\. This net sheet's address is not this listing's address\. The street address is different/.test(r6.lastMsg) && r6.saved === false && !r6.picker && !sent.some(x => /save_property_note|listing-files\/[0-9a-f]/.test(x.u)), 'listing A\'s sheet typed over with B\'s address saves nothing and says why', [r6, sent.map(x => x.u)]);

  console.log('3. Tax wording');
  const words = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    st.showSaveToProp = false; st.view = 'just-listed'; await w(100); st.lpOpen('netsheet'); await w(150);
    st.ns._showTax = true;
    const read = () => {
      const scope = document.body.innerText;
      const opts = Array.from(document.querySelectorAll('select option')).filter(o => o.value === 'no' && o.parentElement && o.parentElement.offsetParent).map(o => o.textContent.trim());
      return { hint: (scope.match(/auto-prorated based on closing date and ([^.]+)/) || [])[1] || '', opts, va: /Virginia bills each half/.test(scope), md: /Maryland bills the 1st half/.test(scope), esc: scope.match(/[^\n]{0,40}\\u[0-9a-fA-F]{4}[^\n]{0,10}/g) || [] };
    };
    // Virginia: closing Jun 10, 1st half still due Jul 28, marked paid by hand -> warning
    Object.assign(st.ns, { address: '1 Test St, Arlington, VA 22201', jurisdiction: 'va-nova', propTaxAnnual: '8000', closingDate: '2026-06-10' }); await w(100);
    st.ns.nsTaxH1Paid = 'yes'; st.ns.nsTaxH1Touched = true; await w(100);
    const va = read();
    Object.assign(st.ns, { address: '1 Test St, Rockville, MD 20850', jurisdiction: 'md-montgomery', closingDate: '2026-09-10', nsTaxH1Touched: true, nsTaxH1Paid: 'yes' }); await w(100);
    const md = read();
    return { va, md, escaped: va.esc.concat(md.esc), fthb: Object.prototype.hasOwnProperty.call(st.ns, 'firstTimeHomebuyerDC') };
  });
  ok(/Virginia calendar year \(Jan 1 – Dec 31\)/.test(words.va.hint) && !/Jul 1/.test(words.va.hint), 'Virginia: the hint says the calendar year, not Jul 1 to Jun 30', words.va.hint);
  ok(words.va.opts.length >= 1 && words.va.opts.every(t => /charge the seller.s days/.test(t)), 'Virginia: the unpaid answer says the seller\'s days are charged, not "collect at closing"', words.va.opts);
  ok(words.va.va && !words.va.md, 'Virginia: the warning names Virginia\'s bills, not Maryland\'s', words.va);
  ok(/Maryland fiscal year \(Jul 1 – Jun 30\)/.test(words.md.hint) && words.md.opts.length >= 1 && words.md.opts.every(t => /collect at closing/.test(t)) && words.md.md && !words.md.va, 'Maryland keeps its own hint, answer and warning', words.md);
  ok(words.escaped.length === 0, 'no escape code like \\u2019 printed on the net sheet (Maryland\'s warning printed "buyer\\u2019s" in production)', words.escaped);
  ok(words.fthb === false && !/firstTimeHomebuyerDC/.test(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')), 'no first-time buyer field is left in the net sheet (the reduced rate is the buyer\'s recordation tax, never the seller\'s)', words.fthb);

  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
