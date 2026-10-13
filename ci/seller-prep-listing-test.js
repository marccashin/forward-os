#!/usr/bin/env node
/*
 * FORWARD OS: every listing opens its own Seller Prep checklist.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium with made-up listings and walks
 * from one to the next the way an agent does. Items removed or added on one
 * listing must never show on another; a listing with a saved checklist opens
 * with exactly that checklist; the standalone guide always starts standard.
 *
 * Why: until Oct 13, 2026 the two checklists were single shared lists that
 * nothing reset, so one listing's removed and added items followed the agent to
 * the next listing, and Save, Send to Seller or the campaign package could hand
 * a seller another seller's checklist.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/seller-prep-listing-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Alexandria, VA 22306', seller_name: 'Seller A', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave, Baltimore, MD 21201', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' },
  { id: C, address: '300 Charlie St NW, Washington, DC 20001', seller_name: 'Seller C', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-09-20T00:00:00Z' }
];
// Every listing has MLS Data: the listing's tools stay closed until it does.
const mls = (addr) => ['=== MLS DATA ===', 'Property Address : ' + addr, 'List Price       : $500,000', 'Property Type    : Condo'].join('\n');
const NOTES = [
  { id: 11, property_id: A, subfolder: 'mls_data', content: mls(PROPS[0].address), updated_at: '2026-10-01T00:00:00Z' },
  { id: 12, property_id: B, subfolder: 'mls_data', content: mls(PROPS[1].address), updated_at: '2026-10-01T00:00:00Z' },
  { id: 13, property_id: C, subfolder: 'mls_data', content: mls(PROPS[2].address), updated_at: '2026-10-01T00:00:00Z' },
  // C's checklist was rewritten by hand in the campaign editor: it cannot be placed item by item.
  { id: 3, property_id: C, subfolder: 'seller_prep', content: 'Prep list for Charlie St\n- Paint the front door\n- Clear the garage', updated_at: '2026-10-01T00:00:00Z' }
];
const posts = [];
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, NOTES.filter(n => u.includes(n.property_id)));
  if (m === 'GET') return J(route, 200, []);
  posts.push({ url: u, body: req.postData() || '' });
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : '')); } }

// The saved text, written here from scratch in the format the guide saves, so the
// test does not lean on the app's own writer to say what B's checklist is.
function savedText(kind, sections) {
  let t = 'SELLER PREP GUIDE (' + (kind === 'condo' ? 'Condo/Co-op' : 'Single Family/Townhome') + ')\n\n';
  sections.forEach(s => { if (s.labels.length) { t += s.title + ':\n'; s.labels.forEach(l => { t += '• ' + l + '\n'; }); t += '\n'; } });
  return t.trim();
}

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
  // The text Save sends, rebuilt here from what is on the list (same format as savedText above).
  const SUM = "(st) => { let t = 'SELLER PREP GUIDE (' + (st.sellerPrepType === 'condo' ? 'Condo/Co-op' : 'Single Family/Townhome') + ')\\n\\n'; st.sellerPrepSections.forEach(s => { const v = s.items.filter(i => !i.removed); if (v.length) { t += s.title + ':\\n'; v.forEach(i => { t += '\\u2022 ' + i.label + '\\n'; }); t += '\\n'; } }); return t.trim(); }";
  await run((src) => { window.__prepSum = eval(src); }, SUM);

  // What the agent sees in the open checklist: type, the items on screen, the summary that Save sends.
  const see = () => run(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const note = document.querySelector('[data-prep-note]');
    return { open: st.lstToolOpen, panel: st.lpActivePanel, type: st.sellerPrepType, removed: st.sellerPrepRemovedCount,
      sections: st.sellerPrepSections.map(s => ({ title: s.title, labels: s.items.filter(i => !i.removed).map(i => i.label) })),
      summary: window.__prepSum(st), note: note ? note.innerText : '',
      onScreen: Array.from(document.querySelectorAll('.subfolder-body span')).map(x => x.innerText) };
  });
  const openListing = (id) => run(async (id) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!st.lstProperties.length) await st.lstFetchProperties();
    await st.lstOpenProperty(st.lstProperties.find(p => p.id === id));
    await new Promise(r => setTimeout(r, 150));
  }, id);
  const clickPrep = () => run(async () => {
    const hdr = Array.from(document.querySelectorAll('.subfolder-header')).find(h => { const n = h.querySelector('.subfolder-tool-name'); return n && n.innerText.trim().toLowerCase() === 'seller prep guide'; });
    hdr.click(); await new Promise(r => setTimeout(r, 150));
  });
  // Remove the first item on screen with its x button, and add one item to section 0, the way the agent does.
  const removeFirstAndAdd = (label) => run(async (label) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const btn = document.querySelector('.subfolder-body button[title="Remove"]');
    btn.click(); await new Promise(r => setTimeout(r, 50));
    st.sellerPrepAddingSi = 0; st.sellerPrepNewLabel = label; st.sellerPrepAddItem(0);
    await new Promise(r => setTimeout(r, 100));
  }, label);

  console.log('The standard lists, read from the standalone guide before anything changes them');
  const std = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.view = 'just-listed'; await new Promise(r => setTimeout(r, 200));
    st.lpOpen('sellerprep'); await new Promise(r => setTimeout(r, 100));
    const read = () => st.sellerPrepSections.map(s => ({ title: s.title, labels: s.items.map(i => i.label) }));
    const sfh = read(); st.sellerPrepType = 'condo'; const condo = read(); st.sellerPrepType = 'sfh';
    return { sfh, condo };
  });
  ok(std.sfh.length > 2 && std.condo.length > 2 && std.condo[0].title !== std.sfh[0].title, 'two different standard lists', [std.sfh.length, std.condo.length]);
  const stdSfhText = savedText('sfh', std.sfh);

  // B saved a condo checklist: the first item of every section taken out, one item of its own added.
  const bSections = std.condo.map((s, i) => ({ title: s.title, labels: s.labels.slice(1).concat(i === 1 ? ['Book the elevator for move-out with the front desk'] : []) }));
  bSections[2].labels = [];   // a whole section taken out
  const bText = savedText('condo', bSections);
  NOTES.push({ id: 2, property_id: B, subfolder: 'seller_prep', content: bText, updated_at: '2026-10-02T00:00:00Z' });

  console.log('Listing A (nothing saved): standard list; the agent removes one item and adds one, does not save');
  await openListing(A); await clickPrep();
  let s = await see();
  ok(s.open === 'sellerprep' && s.type === 'sfh' && s.removed === 0, 'A: opens on the standard single family list', s);
  ok(s.summary === stdSfhText, 'A: the checklist is the standard one, item for item', s.summary.slice(0, 200));
  await removeFirstAndAdd('A only: fix the Alpha Ct mailbox');
  s = await see();
  ok(s.removed === 1 && s.summary.includes('A only: fix the Alpha Ct mailbox') && !s.summary.includes(std.sfh[0].labels[0]), 'A: the change shows on A', s.summary.slice(0, 300));
  await clickPrep(); await clickPrep();
  s = await see();
  ok(s.removed === 1 && s.summary.includes('A only'), 'A: closing and reopening the panel on A keeps what the agent did', s.removed);

  console.log('Open B (saved condo checklist) without clicking anything, then open its Seller Prep');
  await openListing(B);
  s = await see();
  ok(s.open === null, 'B: opens with no tool panel open', s.open);
  await clickPrep();
  s = await see();
  ok(s.type === 'condo', 'B: opens on condo, the type B saved', s.type);
  ok(s.summary === bText, 'B: the checklist is exactly B\'s saved one (same items, same order, same text Save would send)', { got: s.summary.slice(0, 400), want: bText.slice(0, 400) });
  ok(!s.summary.includes('A only') && !s.onScreen.some(t => /A only/.test(t)), 'B: nothing A added is in the list or on screen');
  ok(s.onScreen.some(t => t === 'Book the elevator for move-out with the front desk'), 'B: B\'s own added item is on screen');
  ok(!s.onScreen.some(t => t === std.condo[0].labels[0]), 'B: an item B took out is not on screen');
  ok(s.note === '', 'B: no warning (its checklist was read item by item)', s.note);
  ok(s.sections[2].labels.length === 0 && !s.summary.includes(std.condo[2].title + ':'), 'B: a section B emptied stays empty and is left out of the text');

  console.log('Save on B sends B\'s checklist');
  posts.length = 0;
  await run(async () => { const b = Array.from(document.querySelectorAll('.subfolder-body button')).find(x => /^\s*save\s*$/i.test(x.innerText) && x.className.includes('btn-navy')); b.click(); await new Promise(r => setTimeout(r, 600)); });
  const prepPosts = posts.filter(p => p.body.includes('SELLER PREP GUIDE'));
  ok(prepPosts.length >= 1, 'B: Save sent the checklist text', posts.map(p => p.url));
  ok(prepPosts.every(p => p.body.includes(B) && !p.body.includes(A) && !p.body.includes('A only')), 'B: the save names B and carries nothing of A\'s', prepPosts.map(p => p.body.slice(0, 300)));
  ok(prepPosts.some(p => p.body.includes(JSON.stringify(bText).slice(1, -1).slice(0, 200))), 'B: the text saved is B\'s checklist');

  console.log('Back to A: A never saved, so A opens standard again (unsaved changes belong to the visit)');
  await openListing(A); await clickPrep();
  s = await see();
  ok(s.type === 'sfh' && s.summary === stdSfhText && s.removed === 0, 'A: standard single family list, nothing of B\'s', s.summary.slice(0, 200));
  ok(await run(() => window.__prepSum(document.querySelector('#app').__vue_app__._instance.setupState)) === stdSfhText, 'A: the text the campaign package falls back to is A\'s standard list, not B\'s');

  console.log('C: saved checklist was rewritten by hand, so it cannot be shown item by item');
  await openListing(C); await clickPrep();
  s = await see();
  ok(s.type === 'sfh' && s.summary === stdSfhText, 'C: shows the standard list, never a guess', s.summary.slice(0, 120));
  ok(/edited as text/.test(s.note) && /unchanged unless you press Save/.test(s.note), 'C: says so on screen', s.note);
  ok(await run(() => document.querySelector('#app').__vue_app__._instance.setupState.lstNotes.seller_prep) === NOTES.find(n => n.property_id === C && n.subfolder === 'seller_prep').content, 'C: the saved text itself is untouched');

  console.log('From B, the standalone guide starts standard; back in B the saved list returns');
  await openListing(B); await clickPrep();
  s = await see();
  ok(s.type === 'condo' && s.summary === bText, 'B again: B\'s saved checklist', s.type);
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.view = 'just-listed'; await new Promise(r => setTimeout(r, 200)); st.lpOpen('sellerprep'); await new Promise(r => setTimeout(r, 100)); });
  s = await see();
  ok(s.panel === 'sellerprep' && s.type === 'sfh' && s.summary === stdSfhText, 'standalone: standard list, nothing of B\'s', s.summary.slice(0, 160));
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.sellerPrepType = 'condo'; st.sellerPrepSections[0].items[0].removed = true; });
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.go('listings'); await new Promise(r => setTimeout(r, 200)); });
  await openListing(B); await clickPrep();
  s = await see();
  ok(s.type === 'condo' && s.summary === bText, 'B: after the standalone guide, B\'s own saved checklist again', s.summary.slice(0, 160));
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.view = 'just-listed'; await new Promise(r => setTimeout(r, 200)); st.lpOpen('sellerprep'); await new Promise(r => setTimeout(r, 100)); });
  s = await see();
  ok(s.type === 'sfh' && s.removed === 0, 'standalone: what was changed there earlier is gone too', s);

  console.log('A checklist rewritten in the campaign editor shows in the guide on its next open');
  await openListing(A); await clickPrep();
  const campText = savedText('sfh', std.sfh.map((x, i) => ({ title: x.title, labels: i === 0 ? [x.labels[1], 'Campaign editor item'] : [] })));
  await run(async (t) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.campPrepEditVal = t; await st.campSaveNow('prep', 'prep'); await new Promise(r => setTimeout(r, 200)); }, campText);
  await clickPrep(); await clickPrep();
  s = await see();
  ok(s.summary === campText && s.note === '', 'A: the guide shows what the campaign editor saved', s.summary.slice(0, 200));
  await run(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.campPrepEditVal = 'Typed by hand in the campaign editor'; await st.campSaveNow('prep', 'prep'); await new Promise(r => setTimeout(r, 200)); });
  await clickPrep(); await clickPrep();
  s = await see();
  ok(s.summary === stdSfhText && /edited as text/.test(s.note), 'A: hand-typed text there gives the standard list and the notice', s.note);

  console.log('Every standard item round-trips: save text, reopen, same checklist');
  const trips = await run(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const bad = [];
    for (const kind of ['sfh', 'condo']) {
      for (let k = 0; k < 6; k++) {
        st.lpOpen('netsheet'); st.lpOpen('sellerprep'); st.sellerPrepType = kind;
        st.sellerPrepSections.forEach((sec, si) => sec.items.forEach((it, ii) => { if ((si + ii + k) % (k + 2) === 0) it.removed = true; }));
        if (k % 2) st.sellerPrepSections[k % st.sellerPrepSections.length].items.push({ label: 'Own item ' + k + ': with a colon', done: false, removed: false, custom: true });
        const before = window.__prepSum(st);
        st.lpOpen('netsheet');
        // Load it the way a listing does
        const owner = 'trip-' + kind + k;
        st.lstActiveProp = { id: owner, address: 'x' }; st.lstNotes.mls_data = 'x'; st.lstNotes.seller_prep = before; st.lstOpenTool('sellerprep'); st.lstOpenTool('sellerprep');
        const after = window.__prepSum(st);
        if (after !== before || st.sellerPrepType !== kind) bad.push({ kind, k, before: before.slice(0, 200), after: after.slice(0, 200) });
      }
    }
    return bad;
  });
  ok(trips.length === 0, '12 checklists (both types, items removed, own items added) come back exactly as saved', trips);

  ok(errors.length === 0, 'no errors in the page', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
