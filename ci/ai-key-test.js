#!/usr/bin/env node
/*
 * FORWARD OS: the AI key check, and "no demo output, ever".
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium and checks:
 *   - a device with a key, or whose key the cloud supplies, shows NO notice;
 *   - with no key anywhere, a red notice is on every screen, with the right
 *     instructions for Marc and for everyone else;
 *   - when the cloud cannot be asked, the notice says that instead, and
 *     Check again clears it once the cloud answers;
 *   - with no key, Meeting Prep, the voice assistant and the Listing
 *     Description Writer produce NOTHING and say why. Until Oct 3, 2026 each
 *     of them showed made-up demo output;
 *   - the made-up demo text is gone from the file.
 *
 * SAFETY: never touches production. Every request is intercepted. The sign-in
 * case uses the page's own access code inside this local test page and never
 * prints it.
 *
 * Usage: node ci/ai-key-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const SRC = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
let cloud = 'has';     // has | none | fail   (what agent_config answers for the AI key)
let aiCalls = 0, writes = [];
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = req.url(), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/api\.anthropic\.com/.test(u)) { aiCalls++; return J(route, 200, { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }); }
  if (m === 'GET' && /\/rest\/v1\/agent_config/.test(u) && /claude_api_key/.test(u) && !/__global__/.test(u)) {
    if (cloud === 'fail') return J(route, 500, { message: 'mock outage' });
    return J(route, 200, cloud === 'has' ? [{ claude_api_key: 'cloud-test-key' }] : []);
  }
  if (m === 'GET') return J(route, 200, []);
  writes.push({ m, u });
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
  // agent: who is already signed in on this device ('' = signed out). deviceKey: is a key stored on the device.
  async function device(agent, deviceKey, cloudMode) {
    cloud = cloudMode;
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
    await ctx.addInitScript(([a, k]) => { if (a) localStorage.setItem('fos_agent', a); if (a && k) localStorage.setItem('fos_key_' + a.replace(/\s+/g, '_'), 'device-test-key'); }, [agent, deviceKey]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    return page;
  }
  const NOTICE = /NO AI KEY FOR|COULD NOT CHECK FOR YOUR AI KEY/;
  const look = (page, view) => page.evaluate(async (view) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (view) { st.view = view; await new Promise(r => setTimeout(r, 150)); }
    return { text: document.querySelector('#app').innerText, state: st.aiKey ? st.aiKey.state : null, keySet: st.apiKeySet, stored: localStorage.getItem('fos_key_' + (st.agentName || '').replace(/\s+/g, '_')) };
  }, view);

  console.log('A key is there: say nothing');
  let page = await device('Niki Lang', true, 'has');
  let r = await look(page);
  ok(!NOTICE.test(r.text) && r.keySet === true, 'key on the device and in the cloud: no notice');
  ok(r.stored === 'cloud-test-key', 'the cloud key replaces the device copy');
  page = await device('Niki Lang', false, 'has');
  r = await look(page);
  ok(!NOTICE.test(r.text) && r.keySet === true && r.stored === 'cloud-test-key', 'no key on the device, key in the cloud: fetched, no notice', [r.state, r.stored]);
  page = await device('Niki Lang', true, 'fail');
  r = await look(page);
  ok(!NOTICE.test(r.text) && r.keySet === true, 'key on the device, cloud unreachable: still works, no notice', r.state);

  console.log('No key anywhere: a notice on every screen');
  page = await device('Niki Lang', false, 'none');
  for (const v of ['dashboard', 'listings', 'meeting-prep', 'listing-desc', 'buyer-package', 'settings']) {
    r = await look(page, v);
    ok(/NO AI KEY FOR NIKI LANG/.test(r.text), 'notice is on the ' + v + ' screen');
  }
  ok(/cannot add the key yourself/.test(r.text) && /Manage Team API Keys/.test(r.text) && !/paste the key into/.test(r.text), 'an agent is told Marc adds it, and where');
  ok(/Manage Team API Keys/.test(SRC.replace(/NO AI KEY[\s\S]*?Check again/, '')), 'that Settings heading really exists in the app');
  page = await device('Marc Cashin', false, 'none');
  r = await look(page, 'listings');
  ok(/NO AI KEY FOR MARC CASHIN/.test(r.text) && /paste the key into the Claude API Key box/.test(r.text) && /Save API Key/.test(r.text) && !/cannot add the key yourself/.test(r.text), 'Marc is told how to add it himself');

  console.log('The cloud cannot be asked');
  page = await device('Niki Lang', false, 'fail');
  r = await look(page, 'listings');
  ok(/COULD NOT CHECK FOR YOUR AI KEY/.test(r.text) && /mock outage|500/.test(r.text) && !/NO AI KEY FOR/.test(r.text), 'says it could not check, with the reason, and does not claim the key is missing', r.state);
  cloud = 'has';
  await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.fosCheckAiKey());
  r = await look(page, 'listings');
  ok(!NOTICE.test(r.text) && r.keySet === true, 'Check again clears the notice once the cloud answers');

  console.log('Sign-in runs the check before anything else');
  page = await device('', false, 'none');
  const signedIn = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    let code = null; try { code = ACCESS_CODE; } catch (e) {}
    if (!code) return 'no-code';
    st.loginAgent = 'Cesar Rivera'; st.loginCode = code;
    await st.doLogin();
    await new Promise(r => setTimeout(r, 300));
    return st.loggedIn ? st.aiKey.state : 'not-signed-in';
  });
  r = await look(page);
  ok(signedIn === 'missing' && /NO AI KEY FOR CESAR RIVERA/.test(r.text), 'signing in with no key anywhere shows the notice at once', signedIn);
  page = await device('', false, 'has');
  const signedIn2 = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.loginAgent = 'Cesar Rivera'; st.loginCode = ACCESS_CODE; await st.doLogin(); await new Promise(r => setTimeout(r, 300));
    return [st.loggedIn, st.aiKey.state, st.apiKeySet];
  });
  r = await look(page);
  ok(signedIn2[0] === true && signedIn2[1] === 'ok' && signedIn2[2] === true && !NOTICE.test(r.text), 'signing in with a key in the cloud: no notice', signedIn2);

  console.log('No key: the tools produce nothing and say why');
  page = await device('Niki Lang', false, 'none'); aiCalls = 0; writes = [];
  const mp = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.mpReset(); st.view = 'meeting-prep'; st.mp.query = 'Greg Test'; st.mp.target = { type: 'buyer', id: 'b-1', name: 'Buyer One' };
    await st.mpSearch(); const afterSearch = { results: st.mp.searchResults.length, notice: st.mp.notice };
    await st.mpStart(); await new Promise(r => setTimeout(r, 300));
    return { afterSearch, brief: st.mp.brief, error: st.mp.error, text: document.querySelector('#app').innerText };
  });
  ok(mp.brief === null && /No AI key on this device/.test(mp.error) && /No AI key on this device/.test(mp.text), 'Meeting Prep: no brief, and the screen says there is no AI key', [mp.brief && mp.brief.summary, mp.error]);
  ok(mp.afterSearch.results === 0 && /Follow Up Boss is not connected/.test(mp.afterSearch.notice) && !/Jane/.test(mp.text), 'Meeting Prep: no made-up contact when Follow Up Boss is not connected', mp.afterSearch);
  ok(!writes.some(w => /meeting_briefs/.test(w.u)), 'Meeting Prep: nothing saved to the buyer');
  const vo = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (typeof st.voiceParse !== 'function') return 'no-function';
    st.voiceModal.transcript = 'net sheet for 9 Real Street at 600 thousand'; st.voiceModal.imageData = null;
    await st.voiceParse(); await new Promise(r => setTimeout(r, 200));
    return { phase: st.voiceModal.phase, err: st.voiceModal.errorMsg, fields: JSON.stringify(st.voiceModal.extractedFields || {}), nsAddress: st.ns ? st.ns.address : null };
  });
  ok(vo !== 'no-function' && vo.phase === 'error' && /No AI key on this device/.test(vo.err) && !/Demo Street|750000/.test(vo.fields + vo.nsAddress), 'Voice assistant: an error, and no made-up net sheet', vo);
  const ldr = await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.view = 'listing-desc'; await st.ldBegin(); await new Promise(r => setTimeout(r, 400));
    const first = JSON.stringify(st.ldMessages);
    st.ldInput = '9 Real Street, Washington DC'; if (typeof st.ldSend === 'function') { await st.ldSend('9 Real Street, Washington DC'); await new Promise(r => setTimeout(r, 400)); }
    return { first, all: JSON.stringify(st.ldMessages), output: st.ldOutput, text: document.querySelector('#app').innerText };
  });
  ok(/No AI key on this device/.test(ldr.first) && !/Welcome! I'm the FORWARD listing description writer/.test(ldr.all), 'Listing Description Writer: says there is no AI key instead of starting a scripted chat', ldr.first.slice(0, 200));
  ok(ldr.output === '' && !/Ritz-Carlton Residences/.test(ldr.all) && !/>Demo</.test(ldr.text), 'Listing Description Writer: no ready-made description', ldr.output.slice(0, 80));
  ok(aiCalls === 0, 'no AI call was attempted without a key', aiCalls);

  console.log('The demo text is gone from the app');
  for (const [what, re] of [['the sample Meeting Prep brief', /MP_MOCK_BRIEF|Jane is a move-up buyer/], ['the demo contact', /Jane Doe \(Demo\)|jane@example\.com/], ['the demo voice command', /VOICE_MOCK_RESPONSE|address: '123 Demo Street/], ['the demo listing description', /MOCK_DESCRIPTION|MOCK_RESPONSES|MOCK_PERSONAS|getMockReply/]]) {
    ok(!re.test(SRC), 'index.html no longer contains ' + what);
  }
  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
