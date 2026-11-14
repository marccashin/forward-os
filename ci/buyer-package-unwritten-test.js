#!/usr/bin/env node
/*
 * FORWARD OS: the Buyer Package never fills a section the AI could not write.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium with a made-up buyer, presses
 * Generate Buyer Package the way an agent does, and answers the AI requests
 * itself: all written, one failed, all failed. A section the AI could not write
 * must be empty, unticked, marked in red with the reason, and none of the old
 * stock paragraphs may appear anywhere. A section ticked to include but empty
 * stops the package with a message that names it, and a PDF step that fails
 * reopens the panel with the reason.
 *
 * Why: until Nov 14, 2026 a failed AI call filled the letter, budget and
 * neighborhood sections with canned paragraphs (with market claims such as
 * "offers within 5-10 days"), which broke the no-demo-output rule, and a ticked
 * empty section was left out of the PDF without a word.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/buyer-package-unwritten-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const BUYER = { id: '12222222-2222-4222-8222-222222222222', buyer_name: 'Buyer Testone', agent_name: 'Marc Cashin', stage: 'Pipeline', budget_max: 900000, target_areas: 'Capitol Hill', pre_approval_amount: 950000 };
// Text of the stock paragraphs removed on Nov 14, 2026. None may ever reach the screen again.
const STOCK = ['Thank you for trusting FORWARD to guide you', 'offers within 5-10 days', 'you are competing in an active tier', 'most sought-after areas in the DMV', 'I will walk you through what each area offers'];
const KIND = (body) => /intro letter/.test(body) ? 'letter' : /What Your Budget Gets You/.test(body) ? 'budget' : /neighborhood intelligence/.test(body) ? 'neighborhoods' : 'other';
let failKinds = new Set();
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/api\.anthropic\.com\/v1\/messages/.test(u)) {
    const k = KIND(req.postData() || '');
    if (failKinds.has(k)) return J(route, 500, { error: { message: 'Overloaded (test)' } });
    return J(route, 200, { content: [{ type: 'text', text: 'Written by the AI: ' + k }], stop_reason: 'end_turn' });
  }
  if (m === 'GET' && /\/buyers(\?|$)/.test(u)) return J(route, 200, [BUYER]);
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
    if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
    // The PDF's fonts come from GitHub; a test cannot fetch them, so they fail plainly and the
    // PDF step stops there. This test is about what happens BEFORE the PDF is drawn.
    if (/\.ttf$/.test(u)) return route.fulfill({ status: 404, body: '' });
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
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
  const state = () => page.evaluate(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    return { open: st.byrShowPackageReview, problem: st.byrPackageReviewProblem, sections: (st.byrPackageSections || []).map(s => ({ id: s.id, included: s.included, content: s.content, notWritten: s.notWritten || '' })) };
  });
  const sec = (s, id) => s.sections.find(x => x.id === id) || {};

  async function generate(fails) {
    failKinds = new Set(fails);
    await page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.byrShowPackageReview = false; st.go('dashboard'); });
    await page.waitForTimeout(300);
    await page.locator('.prow').first().locator('.pname').click(); await page.waitForTimeout(500);
    await page.locator('button', { hasText: 'Generate Buyer Package' }).click();
    await page.waitForFunction(() => document.querySelector('#app').__vue_app__._instance.setupState.byrShowPackageReview === true, null, { timeout: 15000 });
    await page.waitForTimeout(300);
  }

  // 1. Everything written: nothing marked, every AI section is the AI's text and ticked.
  await generate([]);
  let s = await state();
  for (const id of ['letter', 'budget', 'neighborhoods']) ok(sec(s, id).content === 'Written by the AI: ' + id && sec(s, id).included === true && !sec(s, id).notWritten, 'all written: ' + id + ' is the AI\'s text and ticked', sec(s, id));
  ok(await page.locator('[data-bp-unwritten]').count() === 0, 'all written: no section is marked not written');

  // 2. The letter fails: empty, unticked, red with the reason, the rest untouched.
  await generate(['letter']);
  s = await state();
  ok(sec(s, 'letter').content === '' && sec(s, 'letter').included === false, 'letter failed: the letter is empty and unticked', sec(s, 'letter'));
  ok(/Overloaded \(test\)/.test(sec(s, 'letter').notWritten), 'letter failed: the reason is kept', sec(s, 'letter'));
  ok(await page.locator('[data-bp-unwritten]').count() === 1, 'letter failed: one section is marked in red');
  let red = await page.locator('[data-bp-unwritten]').first().innerText();
  ok(/NOT written/.test(red) && /Overloaded \(test\)/.test(red), 'letter failed: the red line says NOT written and why', red);
  ok(sec(s, 'budget').content === 'Written by the AI: budget' && sec(s, 'neighborhoods').content === 'Written by the AI: neighborhoods', 'letter failed: budget and neighborhoods are the AI\'s text');
  let body = await page.locator('body').innerText();
  ok(STOCK.every(t => !body.includes(t)) && STOCK.every(t => !JSON.stringify(s).includes(t)), 'letter failed: no stock paragraph anywhere', STOCK.filter(t => body.includes(t)));

  // Ticking the empty letter stops the package and names it.
  await page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.byrPackageSections.find(x => x.id === 'letter').included = true; });
  await page.locator('button', { hasText: 'Approve' }).first().click(); await page.waitForTimeout(400);
  s = await state();
  ok(s.open === true && /Letter to Buyer/.test(s.problem) && /empty/.test(s.problem), 'a ticked empty section stops the package and names it', s.problem);
  ok((await page.locator('[data-bp-problem]').innerText()).includes('Letter to Buyer'), 'the reason is on screen in the panel');
  // Typing the letter clears the red line; then approve goes ahead.
  await page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.byrPackageSections.find(x => x.id === 'letter').content = 'Dear Buyer, typed by the agent.'; });
  await page.waitForTimeout(200);
  ok(await page.locator('[data-bp-unwritten]').count() === 0, 'once the agent writes the letter it is no longer marked');
  await page.locator('button', { hasText: 'Approve' }).first().click(); await page.waitForTimeout(1500);
  s = await state();
  // The test cannot fetch the PDF's fonts, so the PDF step fails: that must be said, not hidden.
  ok(s.problem.indexOf('Letter to Buyer') < 0, 'with every ticked section written the package goes past the check', s.problem);
  ok(s.open === true && /The PDF was NOT made/.test(s.problem) && /Font fetch failed/.test(s.problem), 'a failed PDF step reopens the panel and says why', s.problem);
  ok(sec(s, 'letter').content === 'Dear Buyer, typed by the agent.', 'a failed PDF step keeps the agent\'s text', sec(s, 'letter'));

  // 3. All three fail: all three empty, unticked and marked; no stock text.
  await generate(['letter', 'budget', 'neighborhoods']);
  s = await state();
  ok(['letter', 'budget', 'neighborhoods'].every(id => sec(s, id).content === '' && sec(s, id).included === false && sec(s, id).notWritten), 'all failed: all three empty, unticked and marked', s.sections.slice(0, 3));
  ok(await page.locator('[data-bp-unwritten]').count() === 3, 'all failed: three red lines');
  ok(['difference', 'partners', 'how-we-work', 'scorecard', 'bio'].every(id => sec(s, id).included === true && (sec(s, id).content || '').length > 20), 'all failed: the fixed sections are as before');
  body = await page.locator('body').innerText();
  ok(STOCK.every(t => !body.includes(t)), 'all failed: no stock paragraph anywhere');
  ok(s.problem === '', 'a new Generate clears the last message');

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
