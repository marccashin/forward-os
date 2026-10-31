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
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', BUY = '33333333-3333-4333-8333-333333333333';
const PROPS = [
  { id: A, address: '100 Alpha Ct NW, Washington, DC 20001', seller_name: 'Seller A', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo St NW, Washington, DC 20001', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-30T00:00:00Z' }
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
    const after = { picker: st.showSaveToProp, direct: !!(st.saveToPropData && st.saveToPropData.direct), sentNow: 0 };
    return { after, noteA, activeProp: st.lstActiveProp && st.lstActiveProp.id, buyer: !!buyer, pfCount: pf.length };
  }, FILL);
  ok(r2.after.picker === true && r2.after.direct === true && !sent.some(x => /save_property_note|listing-files|upload-file/.test(x.u)), 'with listing A (and a buyer) opened earlier, Save opens the which-listing window and sends nothing', [r2, sent.map(x => x.u)]);
  const r3 = await run(async (B) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    if (!(st.supaProperties || []).some(p => p.id === B)) st.supaProperties = st.lstProperties.slice();
    st.saveToPropSelected = B; await w(50);
    await st.confirmSaveToPropDrive(); await w(400);
    return { picker: st.showSaveToProp, noteOnScreen: st.lstNotes.seller_net_sheet || '', gold: st.goldToast.show ? st.goldToast.msg : '', toast: st.toast.show ? st.toast.msg : '' };
  }, B);
  const toB = sent.filter(x => /save_property_note/.test(x.u)).map(x => JSON.parse(x.body));
  const pdfB = sent.filter(x => /\/storage\/v1\/object\/listing-files\//.test(x.u));
  ok(toB.length === 1 && toB[0].p_property_id === B && toB[0].p_subfolder === 'seller_net_sheet' && /Marc Cashin/.test(JSON.stringify(toB[0])), 'picking B saves the net sheet note to B with the agent\'s name', toB);
  ok(pdfB.length === 1 && pdfB[0].u.indexOf('/listing-files/' + B + '/') >= 0 && !sent.some(x => /upload-file|googleapis/.test(x.u)), 'and files the PDF in B\'s own folder, not through the old Drive route', sent.map(x => x.m + ' ' + x.u));
  ok(r3.noteOnScreen === r2.noteA && r3.picker === false, 'listing A\'s note on screen is untouched and the window closes', r3);

  console.log('3. Tax wording');
  const words = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const w = (ms) => new Promise(r => setTimeout(r, ms));
    st.showSaveToProp = false; st.view = 'just-listed'; await w(100); st.lpOpen('netsheet'); await w(150);
    st.ns._showTax = true;
    const read = () => {
      const scope = document.body.innerText;
      const opts = Array.from(document.querySelectorAll('select option')).filter(o => o.value === 'no' && o.parentElement && o.parentElement.offsetParent).map(o => o.textContent.trim());
      return { hint: (scope.match(/auto-prorated based on closing date and ([^.]+)/) || [])[1] || '', opts, va: /Virginia bills each half/.test(scope), md: /Maryland bills the 1st half/.test(scope) };
    };
    // Virginia: closing Jun 10, 1st half still due Jul 28, marked paid by hand -> warning
    Object.assign(st.ns, { address: '1 Test St, Arlington, VA 22201', jurisdiction: 'va-nova', propTaxAnnual: '8000', closingDate: '2026-06-10' }); await w(100);
    st.ns.nsTaxH1Paid = 'yes'; st.ns.nsTaxH1Touched = true; await w(100);
    const va = read();
    Object.assign(st.ns, { address: '1 Test St, Rockville, MD 20850', jurisdiction: 'md-montgomery', closingDate: '2026-09-10', nsTaxH1Touched: true, nsTaxH1Paid: 'yes' }); await w(100);
    const md = read();
    return { va, md, fthb: Object.prototype.hasOwnProperty.call(st.ns, 'firstTimeHomebuyerDC') };
  });
  ok(/Virginia calendar year \(Jan 1 – Dec 31\)/.test(words.va.hint) && !/Jul 1/.test(words.va.hint), 'Virginia: the hint says the calendar year, not Jul 1 to Jun 30', words.va.hint);
  ok(words.va.opts.length >= 1 && words.va.opts.every(t => /charge the seller.s days/.test(t)), 'Virginia: the unpaid answer says the seller\'s days are charged, not "collect at closing"', words.va.opts);
  ok(words.va.va && !words.va.md, 'Virginia: the warning names Virginia\'s bills, not Maryland\'s', words.va);
  ok(/Maryland fiscal year \(Jul 1 – Jun 30\)/.test(words.md.hint) && words.md.opts.length >= 1 && words.md.opts.every(t => /collect at closing/.test(t)) && words.md.md && !words.md.va, 'Maryland keeps its own hint, answer and warning', words.md);
  ok(words.fthb === false && !/firstTimeHomebuyerDC/.test(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')), 'no first-time buyer field is left in the net sheet (the reduced rate is the buyer\'s recordation tax, never the seller\'s)', words.fthb);

  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
