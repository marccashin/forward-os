#!/usr/bin/env node
/*
 * FORWARD OS: "never say saved when it did not save". Run on every pull request.
 *
 * Opens the real index.html in headless Chromium and runs each save twice:
 * once with the cloud answering normally, once with every write answered by
 * an error (HTTP 500, which fetch() does NOT throw on). For each save it
 * reads the message the agent would see.
 *   - cloud working: the usual success message;
 *   - cloud failing: NO success message, and a message that says it did not
 *     save.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/save-failure-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B1 = '11111111-1111-4111-8111-111111111111';
// failWrites: every write answers 500. failPipeline: only the pipeline webhook does. failListings: the listings read does.
// failNotes: only the writes that put text on a listing do (Drive and everything else work).
let mode = { failWrites: false, failPipeline: false, failListings: false, failNotes: false };
let sent = [];   // every write the page made: method, address, body text
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = req.url(), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/\/trigger$/.test(u.split('?')[0])) return (mode.failPipeline || mode.failWrites) ? J(route, 500, { detail: 'mock outage' }) : J(route, 200, { ok: true });
  if (m === 'GET') {
    if (mode.failListings && /\/rest\/v1\/properties/.test(u)) return J(route, 500, { message: 'mock outage' });
    return J(route, 200, []);
  }
  sent.push({ m, u, body: req.postData() || '' });
  if (mode.failWrites) return J(route, 500, { message: 'mock outage', detail: 'mock outage' });
  if (mode.failNotes && (/\/rest\/v1\/property_notes/.test(u) || /\/save-property-note$/.test(u))) return J(route, 500, { message: 'mock outage', detail: 'mock outage' });
  if (/googleapis\.com\/upload\/drive/.test(u)) return J(route, 200, { id: 'drive-file-1', webViewLink: 'https://drive.example/f1' });
  if (/\/rest\/v1\//.test(u)) return J(route, m === 'POST' ? 201 : 200, [{ id: 1 }]);
  return J(route, 200, { ok: true });
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
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, { access_token: 'mock-token' }) : route.continue();
    if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
    const t = route.request().resourceType();
    if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
    return api(route);
  });
  await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);

  // Runs one save in the page and returns every message shown while it ran.
  async function run(m, body, arg) {
    mode = Object.assign({ failWrites: false, failPipeline: false, failListings: false, failNotes: false }, m);
    sent = [];
    return page.evaluate(async ([src, arg]) => {
      const st = document.querySelector('#app').__vue_app__._instance.setupState;
      const seen = [];
      st.toast.msg = ''; st.toast.show = false; st.goldToast.msg = ''; st.goldToast.show = false;
      const iv = setInterval(() => { [st.toast.msg, st.goldToast.msg].forEach(x => { if (x && !seen.includes(x)) seen.push(x); }); }, 5);
      let ret, extra;
      try { ret = await (new Function('st', 'arg', 'return (async () => {' + src + '})()'))(st, arg); } catch (e) { extra = 'threw: ' + e.message; }
      await new Promise(r => setTimeout(r, 250));
      clearInterval(iv);
      [st.toast.msg, st.goldToast.msg].forEach(x => { if (x && !seen.includes(x)) seen.push(x); });
      return { msgs: seen, ret: ret === undefined ? null : ret, extra: extra || null };
    }, [body, arg]);
  }
  const SAID_SAVED = /(^|[^T] )saved[ !.]|✅|cleared\.$|cleared for|removed\.$|Deleted\.|File deleted/i;
  const SAID_FAILED = /NOT |THIS DEVICE ONLY|failed|could not/i;
  // name, code to run, pattern the success message must match
  const cases = [
    ['FUB key save', "st.settFubKey = 'fub-test'; await st.saveFubKey();", /FUB key saved!/],
    ['API key save', "st.settKey = 'key-test'; await st.saveKey();", /API key saved!/],
    ['Branding save', "await st.saveBranding();", /Branding saved!/],
    ['FUB key clear', "await st.clearFubKey();", /FUB key cleared\./],
    ['API key clear', "await st.clearKey();", /API key cleared\./],
    ['Admin API key clear', "st.adminKeyAgent = 'Niki Lang'; await st.adminClearKey();", /API key cleared for Niki Lang/],
    ['Brand PDF remove', "st.settBrandPdfs = [{ id: 1, name: 'x.pdf', content: 'c' }]; await st.bpRemove(1);", /Brand PDF removed\./],
    ['Listing description save', "st.lstActiveProp = { id: arg.P1, address: '1 Test St', market: 'DC' }; st.lstDescEditVal = 'A description.'; await st.lstDescSave();", /Listing description saved\./],
    ['Save to listing (text, no Drive folder)', "st.lstActiveProp = { id: arg.P1, address: '1 Test St' }; st.view = 'listing-detail'; return await st.saveToPropertyFromTool('Seller Net Sheet', 'Net Sheet', 'Net to seller: 1', null);", /Seller Net Sheet saved to 1 Test St/],
    ['Saved Library add', "await st.saveOut('social-post', 'T', 'C');", /Saved to library!/],
    ['Saved Library delete', "await st.delItem(5);", /Deleted\./],
  ];
  for (const [name, code, good] of cases) {
    console.log(name);
    const a = await run({}, code, { P1, B1 });
    // (The FUB team sync that follows a key save talks to FUB itself, which this test does not imitate.)
    ok(a.msgs.some(x => good.test(x)) && !a.msgs.some(x => SAID_FAILED.test(x) && !/FUB sync/.test(x)), 'cloud working: says it saved', a);
    const b = await run({ failWrites: true }, code, { P1, B1 });
    ok(!b.msgs.some(x => good.test(x)) && !b.msgs.some(x => SAID_SAVED.test(x) && !SAID_FAILED.test(x)), 'cloud failing: does not say it saved', b);
    ok(b.msgs.some(x => SAID_FAILED.test(x)), 'cloud failing: says it did not save', b);
  }
  console.log('Save to listing returns the truth');
  const st1 = "st.lstActiveProp = { id: arg.P1, address: '1 Test St' }; st.view = 'listing-detail'; return await st.saveToPropertyFromTool('Seller Net Sheet', 'Net Sheet', 'Net to seller: 1', null);";
  ok((await run({}, st1, { P1 })).ret === true, 'true when it saved');
  ok((await run({ failWrites: true }, st1, { P1 })).ret === false, 'false when it did not (callers show their Saved badge only on true)');

  console.log('Seller Prep Guide save (its text now goes through the same checked save as the PDF)');
  const spFolder = "st.lstActiveProp = { id: arg.P1, address: '1 Test St', subfolder_drive_ids: { seller_prep: 'folder-1' } }; st.view = 'listing-detail'; st.lstNotes.seller_prep = ''; st.sellerPrepSaved = false; await st.sellerPrepSaveToProperty(); return [st.sellerPrepSaved, st.lstNotes.seller_prep.length > 0];";
  const spNoFolder = spFolder.replace("{ seller_prep: 'folder-1' }", '{}');
  const noteWrites = () => sent.filter(x => /\/save-property-note$/.test(x.u)).map(x => JSON.parse(x.body));
  let r = await run({}, spFolder, { P1 });
  ok(r.ret[0] === true && r.ret[1] === true && r.msgs.some(x => /Seller Prep Guide saved to 1 Test St/.test(x)) && !r.msgs.some(x => SAID_FAILED.test(x)), 'everything working: says saved, badge on', r);
  let nw = noteWrites();
  ok(nw.length === 1 && nw[0].subfolder === 'seller_prep' && nw[0].property_id === P1 && nw[0].content.length > 50, 'the checklist text is written to the listing exactly once', nw.map(x => [x.subfolder, (x.content || '').length]));
  ok(sent.some(x => /googleapis\.com\/upload\/drive/.test(x.u)) && sent.some(x => /\/upload-file$/.test(x.u)), 'the PDF is uploaded to Drive and recorded');
  r = await run({ failNotes: true }, spFolder, { P1 });
  ok(r.msgs.some(x => /PDF saved to the Drive folder, but the text was NOT saved/.test(x)) && !r.msgs.some(x => /Seller Prep Guide saved to 1 Test St/.test(x)) && r.ret[1] === false, 'text write fails: says exactly that, no plain saved message', r);
  r = await run({}, spNoFolder, { P1 });
  ok(r.ret[0] === true && r.ret[1] === true && r.msgs.some(x => /Seller Prep Guide saved to 1 Test St/.test(x)) && noteWrites().length === 1, 'listing with no Drive folder: the text still saves', r);
  r = await run({ failNotes: true }, spNoFolder, { P1 });
  ok(r.ret[0] === false && r.msgs.some(x => /was NOT saved/.test(x)) && !r.msgs.some(x => /Seller Prep Guide saved to/.test(x)), 'no Drive folder and the text write fails: NOT saved, badge off', r);
  r = await run({ failWrites: true }, spFolder, { P1 });
  ok(r.ret[0] === false && r.msgs.some(x => /was NOT saved/.test(x)), 'everything fails: NOT saved, badge off', r);

  console.log('Pick-a-listing save window (a tool saved from outside a listing)');
  const pick = "st.supaProperties = [{ id: arg.P1, address: '1 Test St', subfolder_drive_ids: { seller_net_sheet: 'folder-2' } }]; st.saveToPropData = { type: 'net-sheet-x', label: 'Net Sheet', data: 'Net to seller: 1', pdfData: null, toolName: 'Seller Net Sheet' }; st.saveToPropSelected = arg.P1; st.showSaveToProp = true; await st.confirmSaveToPropDrive(); return st.showSaveToProp;";
  r = await run({}, pick, { P1 });
  ok(r.msgs.some(x => /Seller Net Sheet saved to 1 Test St/.test(x)) && !r.msgs.some(x => SAID_FAILED.test(x)) && r.ret === false, 'everything working: says saved and closes', r);
  ok(sent.some(x => /\/rest\/v1\/property_notes/.test(x.u) && /Net to seller: 1/.test(x.body)), 'the text is written to the listing');
  r = await run({ failNotes: true }, pick, { P1 });
  ok(r.msgs.some(x => /text was NOT saved to the listing/.test(x)) && !r.msgs.some(x => /Seller Net Sheet saved to 1 Test St/.test(x)), 'text write fails: says so, no plain saved message', r);
  r = await run({ failWrites: true }, pick, { P1 });
  ok(r.msgs.some(x => /Save failed/.test(x)) && !r.msgs.some(x => /saved to 1 Test St/.test(x)) && r.ret === true, 'everything fails: says Save failed and the window stays open', r);

  console.log('Listing state badge');
  const mk = "const p = { id: arg.P1, market: 'DC' }; await st.lstSetMarket(p, 'MD'); return p.market;";
  ok((await run({}, mk, { P1 })).ret === 'MD', 'cloud working: badge changes');
  const mkF = await run({ failWrites: true }, mk, { P1 });
  ok(mkF.ret === 'DC' && mkF.msgs.some(x => /NOT changed/.test(x)), 'cloud failing: badge goes back and says so', mkF);

  console.log('Buyer profile field');
  const bp = "st.byrActiveBuyer = { id: arg.B1, buyer_name: 'B', phone: '1' }; await st.byrUpdateProfile('phone', '2'); return st.byrActiveBuyer.phone;";
  ok((await run({}, bp, { B1 })).ret === '2', 'cloud working: value kept');
  const bpF = await run({ failWrites: true }, bp, { B1 });
  ok(bpF.ret === '1' && bpF.msgs.some(x => /NOT saved/.test(x)), 'cloud failing: value not kept and says so', bpF);

  console.log('Tour Tracker');
  const tt = "st.byrActiveBuyer = { id: arg.B1, buyer_name: 'B' }; await st.ttSaveTours(); await st.ttSaveTours();";
  ok((await run({}, tt, { B1 })).msgs.length === 0, 'cloud working: silent');
  const ttF = await run({ failWrites: true }, tt, { B1 });
  ok(ttF.msgs.filter(x => /NOT saving to the cloud/.test(x)).length === 1, 'cloud failing: says so', ttF);

  console.log('Revision request (in a listing)');
  const rv = "st.lstActiveProp = { id: arg.P1, address: '1 Test St' }; st.lstRevNotes = 'Please change the headline on the flyer.'; st.lstRevActiveStatus = ''; await st.lstSubmitRevisionRequest(); return [st.lstRevActiveStatus, st.lstRevNotes];";
  const rvOk = await run({}, rv, { P1 });
  // (The status shown afterwards is re-read from the revision list, which this mock returns empty.)
  ok(rvOk.ret[1] === '' && rvOk.msgs.length === 0, 'everything working: accepted, form cleared, no warning', rvOk);
  const rvP = await run({ failPipeline: true }, rv, { P1 });
  ok(rvP.ret[0] !== 'running' && rvP.ret[1] !== '' && rvP.msgs.some(x => /did NOT start/.test(x)), 'pipeline did not start: not shown as running, says so, notes kept', rvP);
  const rvF = await run({ failWrites: true }, rv, { P1 });
  ok(rvF.ret[0] !== 'running' && rvF.msgs.some(x => /Revision submit failed/.test(x)), 'request not recorded: says so', rvF);

  console.log('Listings that do not load');
  const lf = "st.lstProperties = []; st.view = 'listings'; await st.lstFetchProperties(); await new Promise(r => setTimeout(r, 100)); return [st.lstLoadError, document.querySelector('#app').innerText];";
  const lfOk = await run({}, lf);
  ok(lfOk.ret[0] === '' && /No listings yet/.test(lfOk.ret[1]) && !/could not be loaded/.test(lfOk.ret[1]), 'load works, none exist: says No listings yet');
  const lfF = await run({ failListings: true }, lf);
  ok(lfF.ret[0] !== '' && /could not be loaded/.test(lfF.ret[1]) && !/No listings yet/.test(lfF.ret[1]), 'load fails: says so, and does NOT say No listings yet', lfF.ret[0]);
  const lfBack = await run({}, lf);
  ok(lfBack.ret[0] === '' && !/could not be loaded/.test(lfBack.ret[1]), 'notice clears when the load works again');

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
