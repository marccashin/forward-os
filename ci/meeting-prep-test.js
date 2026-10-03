#!/usr/bin/env node
/*
 * FORWARD OS: Meeting Prep tells the agent what the brief is built on.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium and generates briefs with
 * the online research service answering in each way it can: found something,
 * an error, "not configured", found nothing, and slow (33 seconds: longer
 * than the old 30 second limit, shorter than the backend's 45). It reads what
 * the agent would see on the brief. It also checks the built-in example brief
 * shown on a device with no AI key: labelled as a sample, never saved.
 *
 * SAFETY: never touches production. Every request is intercepted.
 * One case waits 33 seconds on purpose.
 *
 * Usage: node ci/meeting-prep-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const BRIEF = { disc: { type: 'C', label: 'Conscientious', description: 'd', confidence: 'medium', signals: 's' }, summary: 'REAL BRIEF SUMMARY for the contact.', talkingPoints: ['a'], dos: ['b'], donts: ['c'], opener: 'o', goal: 'g' };
const FOUND = { found: true, background: 'Partner at a law firm.', title: 'Partner', company: 'Firm LLP', personalitySignals: 'precise', discHints: 'C', sources: ['Company bio'] };
let research = 'found';      // found | http500 | notconfigured | nothing | slow33
let writes = [];
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
async function api(route) {
  const req = route.request(), u = req.url(), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/\/api\/meeting-prep-research$/.test(u)) {
    if (research === 'http500') return J(route, 500, { detail: 'boom' });
    if (research === 'notconfigured') return J(route, 200, { found: false, error: 'API key not configured' });
    if (research === 'nothing') return J(route, 200, { found: false, sources: [] });
    if (research === 'slow33') { await new Promise(r => setTimeout(r, 33000)); return J(route, 200, FOUND).catch(() => {}); }
    return J(route, 200, FOUND);
  }
  if (/api\.anthropic\.com/.test(u)) return J(route, 200, { content: [{ type: 'text', text: JSON.stringify(BRIEF) }], stop_reason: 'end_turn' });
  if (m === 'GET') return J(route, 200, []);
  writes.push({ m, u, body: req.postData() || '' });
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
  async function device(withKey) {
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
    await ctx.addInitScript((k) => { localStorage.setItem('fos_agent', 'Marc Cashin'); if (k) localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); }, withKey);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    return page;
  }
  // Generate a brief for "Greg Test" and return what is on screen. step: what to do if research is offered.
  async function brief(page, mode, step) {
    research = mode; writes = [];
    return page.evaluate(async (step) => {
      const st = document.querySelector('#app').__vue_app__._instance.setupState;
      st.mpReset(); st.view = 'meeting-prep';
      st.mp.query = 'Greg Test'; st.mp.selectedPerson = { id: null, name: 'Greg Test' };
      await st.mpStart();
      const offered = st.mp.confirming;
      if (offered && step === 'use') { st.mpConfirmResearch(); }
      if (offered && step === 'skip') { st.mpSkipResearch(); }
      for (let i = 0; i < 100 && (st.mp.loading || !st.mp.brief) && !st.mp.error; i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 150));
      return { offered, kind: st.mp.researchKind, note: st.mp.researchNote, sample: st.mp.isSample, error: st.mp.error, text: document.querySelector('#app').innerText };
    }, step || 'use');
  }
  const NO_RESEARCH = /Online research did not run/;
  const page = await device(true);

  console.log('Research found something and the agent used it');
  let r = await brief(page, 'found', 'use');
  ok(r.offered && /REAL BRIEF SUMMARY/.test(r.text) && /Web research used/i.test(r.text) && !NO_RESEARCH.test(r.text) && !/found nothing|was skipped/.test(r.text), 'brief shows Web research used and no warning', [r.kind, r.error]);

  console.log('Research found something and the agent skipped it');
  r = await brief(page, 'found', 'skip');
  ok(/REAL BRIEF SUMMARY/.test(r.text) && /Online research was skipped/.test(r.text) && !/Web research used/i.test(r.text), 'brief says research was skipped', [r.kind, r.error]);

  console.log('Research service answers with an error');
  r = await brief(page, 'http500');
  ok(/REAL BRIEF SUMMARY/.test(r.text) && NO_RESEARCH.test(r.text) && /error \(500\)/.test(r.text), 'brief is written and says research did not run, with the reason', [r.kind, r.note, r.error]);

  console.log('Research service says it is not set up');
  r = await brief(page, 'notconfigured');
  ok(NO_RESEARCH.test(r.text) && /API key not configured/.test(r.text), 'brief says research did not run, with the service\'s own reason', [r.kind, r.note]);

  console.log('Research ran and found nothing');
  r = await brief(page, 'nothing');
  ok(/ran and found nothing/.test(r.text) && !NO_RESEARCH.test(r.text), 'brief says it found nothing, which is different from did not run', [r.kind, r.note]);

  console.log('A brief saved to a buyer records what happened with research');
  research = 'http500'; writes = [];
  await page.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.mpReset(); st.mp.target = { type: 'buyer', id: 'b-1', name: 'Buyer One' };
    st.mp.query = 'Greg Test'; st.mp.selectedPerson = { id: null, name: 'Greg Test' };
    await st.mpStart(); await new Promise(r => setTimeout(r, 500));
  });
  const saved = writes.filter(w => /\/rest\/v1\/meeting_briefs/.test(w.u)).map(w => JSON.parse(w.body));
  ok(saved.length === 1 && saved[0].sources && saved[0].sources.web === false && saved[0].sources.research === 'failed' && /500/.test(saved[0].sources.research_note), 'saved brief carries research: failed and the reason', saved.map(x => x.sources));
  const reopened = await page.evaluate((row) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.mbOpenSaved({ subject_name: 'Greg Test', brief: row.brief, sources: row.sources, created_at: new Date().toISOString(), agent_name: 'Marc Cashin' }, 'buyer', { id: 'b-1', buyer_name: 'Buyer One' });
    return new Promise(r => setTimeout(() => r(document.querySelector('#app').innerText), 200));
  }, saved[0] || { brief: BRIEF, sources: {} });
  ok(NO_RESEARCH.test(reopened), 'reopening that saved brief shows the same warning');

  console.log('Slow research (33 seconds: past the old 30 second limit, inside the backend\'s 45)');
  r = await brief(page, 'slow33', 'use');
  ok(r.offered && /Web research used/i.test(r.text) && !NO_RESEARCH.test(r.text), 'research that arrives at 33 seconds is used, not thrown away', [r.offered, r.kind, r.note]);

  console.log('Device with no AI key: the built-in example brief');
  const noKey = await device(false);
  r = await brief(noKey, 'found');
  ok(r.sample === true && /SAMPLE BRIEF/.test(r.text) && /NOT ABOUT GREG TEST/.test(r.text), 'labelled SAMPLE BRIEF, and says it is not about the contact', r.text.slice(0, 200));
  ok(!NO_RESEARCH.test(r.text) && !/Web research used/i.test(r.text), 'no research line on a sample (there was no research either way)');
  writes = [];
  const sv = await noKey.evaluate(async () => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    st.mbAssignTo({ type: 'buyer', id: 'b-1', name: 'Buyer One' });
    await new Promise(r => setTimeout(r, 400));
    return st.mbAssign.error;
  });
  ok(!writes.some(w => /meeting_briefs/.test(w.u)) && /sample brief/i.test(sv), 'a sample brief cannot be saved to a buyer or seller', [sv, writes.length]);

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
