#!/usr/bin/env node
/*
 * FORWARD OS: Offer Strategy tells the AI everything the MLS sheets said.
 * Run on every pull request.
 *
 * Why (Marc, Nov 4, 2026, 3 Old Sound Rd, Joppa MD): the strategy said the
 * sheet printed no water access and valued a waterfront home off the two
 * dry comps on its street. The sheet printed Waterfront: Yes, 30 ft of
 * frontage, a deeded slip, 500 sf finished below grade and a long public
 * description; the comp sheet printed Waterfront Yes on the Neptune sales and
 * No on the Old Sound ones. The backend read none of it, and the page dropped
 * what the comp reader did return (beds, baths, below-grade space). Backend
 * #81 reads it; this test holds the page to passing it on.
 *
 * Opens the real index.html in headless Chromium. The subject sheet and the
 * comp sheets go in through the page's own file inputs; the backend's answers
 * are made up (a waterfront subject, a waterfront comp, a dry comp with a
 * finished basement) and a comp is typed in by hand. Generate and the chat are
 * pressed, and the exact prompts sent to the AI are read.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/offer-strategy-sheet-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');

const REMARKS = 'Welcome to a beautifully updated WATERFRONT home. The pier was replaced in 2025 and has water and electric. Rear yard hardscaping was completed in 2025.';
const SUBJECT = {
  success: true, ok: true, file: 'subject.pdf', properties_found: 1,
  unverified: ['dockType'], dropped_notes: 0, dropped_remark_sentences: 1,
  subject: {
    status: 'active', status_raw: 'Active', mlsNumber: 'MDTEST0000001', address: '9 Test Cove Rd', city: 'Joppa', state: 'MD', zip: '21085',
    propType: 'Single Family', beds: '3', fullBaths: '2', halfBaths: '1', gla: '1836', assessorGla: '1236', belowGradeFin: '500', totalFinSqft: '2336',
    yearBuilt: '1975', renoYear: '2021', listPrice: '630000', originalListPrice: '660000', dom: '59', cdom: '250',
    basement: 'Connecting Stairway, Fully Finished, Heated, Walkout Level', waterfront: 'Yes', views: 'Canal, Water',
    waterfrontFeatures: 'Boat/Launch Ramp - Private', waterAccess: 'Yes; Boat - Powered, Canoe/Kayak', navigableWater: 'Yes', tidalWater: 'Yes',
    waterFrontage: '30', dockType: '', dockSlip: 'Deeded', riparianRights: 'Yes', publicRemarks: REMARKS, offerNotes: []
  }
};
const COMPS = { success: true, results: [
  { ok: true, file: 'comps.pdf', status: 'closed', address: '1 Test Water Dr', city: 'Joppa', state: 'MD', zip: '21085', mlsNumber: 'MDTEST0000010',
    salePrice: '780000', listPrice: '780000', soldDate: '2026-05-26', dom: '4', gla: '2534', assessorGla: '2114', concessions: '0',
    beds: '3', fullBaths: '2', halfBaths: '1', below: '', totalFin: '2534', basement: 'No', yearBuilt: '1968', renoYear: '2016',
    lotSize: '16097', garageSpaces: '2', waterfront: 'Yes', waterFrontage: '62', views: 'Trees/Woods, Water', dockSlip: 'Deeded', flags: {} },
  { ok: true, file: 'comps.pdf', status: 'closed', address: '2 Test Dry Rd', city: 'Joppa', state: 'MD', zip: '21085', mlsNumber: 'MDTEST0000020',
    salePrice: '415000', listPrice: '415000', soldDate: '2025-12-04', dom: '3', gla: '1824', assessorGla: '1824',
    beds: '3', fullBaths: '2', halfBaths: '1', below: '', totalFin: '1824', basement: 'Connecting Stairway, Daylight, Full, Fully Finished, Walkout Level',
    yearBuilt: '1976', renoYear: '', lotSize: '10881', garageSpaces: 0, waterfront: 'No', waterFrontage: '', views: '', dockSlip: '', flags: {} }
] };
const STRATEGY = { maxValue: '$600,000', marketValue: '$580,000', winningOffer: '$585,000', appraisalGap: null, appraisalGapNote: null,
  valuationReasoning: 'Test reasoning.', offerStructure: 'Test structure.', escalationClause: null, talkingPoints: 'Test points.', justinNote: null };

const prompts = [];
// Nov 5, 2026: replies cut off by the AI's safety filter (stop_reason
// "refusal", text ending mid-answer). Seen live on 1111 23rd St NW #PH1C.
let refuseNext = 0, aiCalls = 0;
const CUT = { content: [{ type: 'text', text: '{"reasoning": "We start with closed sales, because only a completed sale tells us what someone act' }], stop_reason: 'refusal' };
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (/\/api\/osg\/parse-subject/.test(u)) return J(route, 200, SUBJECT);
  if (/\/api\/osg\/parse-comps/.test(u)) return J(route, 200, COMPS);
  if (/api\.anthropic\.com/.test(u)) {
    const body = JSON.parse(req.postData() || '{}');
    const p = body.messages[0].content;
    prompts.push(p); aiCalls++;
    if (refuseNext > 0) { refuseNext--; return J(route, 200, CUT); }
    const isChat = /AGENT REQUEST:/.test(p);
    const client = p.match(/Return ONLY a JSON object with the keys ([a-z, ]+), each a string/);
    let text;
    if (client) { const o = {}; client[1].split(', ').forEach(k => { o[k] = 'Client wording for ' + k + '.'; }); text = JSON.stringify(o); }
    else text = JSON.stringify(isChat ? { reply: 'Unchanged.', strategy: STRATEGY } : STRATEGY);
    return J(route, 200, { content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  }
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : '')); } }
const has = (s, t) => String(s || '').includes(t);
function compLine(prompt, addr) { return (String(prompt).split('\n').find(l => l.includes(addr)) || ''); }

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
    const t = route.request().resourceType();
    if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
    return api(route);
  });
  await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const st = (fn, arg) => page.evaluate(fn, arg);
  await st(async () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; if (s.updatesModal && s.updatesModal.show) await s.dismissUpdates(); s.taskModalShow = false; s.go('offer-strategy'); });
  await page.waitForTimeout(400);
  const pdf = (name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });

  // Step 1: the subject's sheet through the page's own file input.
  await page.locator('input[type=file][accept="application/pdf"]').first().setInputFiles(pdf('subject.pdf'));
  await page.waitForTimeout(600);
  const shot1 = await page.locator('body').innerText();
  ok(has(shot1, 'Water frontage') && has(shot1, '30 ft') && has(shot1, 'Below-grade finished') && has(shot1, '500 sq ft'),
    'Step 1 shows the water frontage and the below-grade finished space');
  ok(has(shot1, '1,836 on the sheet; the assessor has 1,236'), 'Step 1 shows the sheet and assessor square footage side by side');
  ok(has(shot1, 'Public remarks') && has(shot1, 'pier was replaced in 2025'), 'Step 1 shows the public remarks');
  const status = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.osgSheetStatus);
  ok(has(status, 'dock') && has(status, 'Check these by eye'), 'a field the backend could not match is named for the agent', status);
  ok(has(status, '1 sentence of the public remarks was left out'), 'a dropped remark sentence is said', status);

  // Step 2: comp sheets through the page's own file input, then Add Ticked Comps.
  await st(() => document.querySelector('#app').__vue_app__._instance.setupState.osgGoToComps());
  await page.waitForTimeout(300);
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(pdf('comps.pdf'));
  await page.waitForTimeout(600);
  ok(has(await page.locator('body').innerText(), 'waterfront: Yes'), 'the import list shows each comp\'s waterfront');
  await page.getByText('Add Ticked Comps').click(); await page.waitForTimeout(300);
  // A comp typed in by hand, the way the Add Comp form pushes it.
  await st(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState;
    s.osgComps.push({ address: '3 Test Hand Ln', salePrice: '500000', sqft: '2000', ppsf: '250', dom: '10', soldDate: '2026-01-01', spLp: '', concessions: '', notes: '', status: 'closed', editing: false, _src: 'manual' }); });
  await page.waitForTimeout(300);
  const feats = await page.locator('[data-osg-comp-features]').allInnerTexts();
  ok(feats.length === 2, 'each comp from a sheet shows its features on its card, a hand-typed one shows none', feats);
  ok(feats.some(t => has(t, 'Waterfront: Yes, 62 ft frontage')) && feats.some(t => has(t, 'Waterfront: No')), 'the cards say which comp is waterfront', feats);

  // Generate: the exact prompt the AI receives.
  await page.getByText('Generate Offer Strategy').click();
  for (let i = 0; i < 40 && !prompts.length; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  const a = prompts[0] || '';
  ok(a.length > 0, 'Generate sent one request to the AI');
  for (const [t, why] of [
    ['- Waterfront: Yes', 'subject waterfront'], ['- Water frontage: 30 ft', 'subject frontage'], ['- Dock slip: Deeded', 'subject dock slip'],
    ['- Navigable / tidal: Yes / Yes', 'subject navigable and tidal'], ['- Riparian rights: Yes', 'subject riparian rights'],
    ['- Below-grade finished: 500 sq ft', 'subject below-grade finished'], ['- Total finished: 2,336 sq ft', 'subject total finished'],
    ['- Above-grade square footage: 1,836 on the sheet; the assessor has 1,236', 'subject assessor gap'], ['- Renovated: 2021', 'subject renovation year'],
    [REMARKS, 'public remarks word for word']]) ok(has(a, t), 'the strategy is told the ' + why, t);
  const wet = compLine(a, '1 Test Water Dr'), dry = compLine(a, '2 Test Dry Rd'), hand = compLine(a, '3 Test Hand Ln');
  ok(has(wet, 'Waterfront: Yes, 62 ft frontage, views Trees/Woods, Water, dock slip Deeded'), 'the waterfront comp is described as waterfront', wet);
  ok(has(wet, 'Assessor above-grade sqft: 2,114 (the sheet says 2,534)'), 'a comp\'s assessor square footage gap is passed on', wet);
  ok(has(wet, 'Year: built 1968, renovated 2016') && has(wet, 'Garage spaces: 2'), 'the comp\'s year, renovation and garage are passed on', wet);
  ok(has(dry, 'Waterfront: No') && has(dry, 'Basement: Connecting Stairway, Daylight, Full, Fully Finished, Walkout Level'), 'the dry comp is described as not waterfront with its finished basement', dry);
  ok(has(dry, 'Beds/baths: 3 bed / 2 full, 1 half bath') && has(dry, 'Below-grade finished sqft: not given') && has(dry, 'Garage spaces: 0'), 'the dry comp\'s beds, baths, unknown below-grade size and garage 0 are passed on', dry);
  ok(has(hand, 'Waterfront: not given') && has(hand, 'Basement: not given') && has(hand, 'Beds/baths: not given'), 'a hand-typed comp says its features were not given', hand);
  ok(has(a, 'Never say the MLS sheet or the listing does not mention it'), 'the strategy may not blame the listing for a fact it was not given');
  ok(has(a, 'valued from waterfront closed sales first') && has(a, 'Never treat a comp as the closest evidence only because it is on the same street'), 'the strategy compares waterfront with waterfront');
  ok(has(a, 'Finished space below grade is listed separately: value it separately'), 'the strategy values below-grade space separately');
  ok(has(a, 'say how the value changes on the assessor\'s figure'), 'the strategy addresses the assessor square footage');

  // The chat: the same facts and rules.
  await st(async () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.osgChatInput = 'Did you count the water?'; await s.osgChatSend(); });
  await page.waitForTimeout(300);
  const c = prompts[1] || '';
  ok(c.length > 0 && has(c, 'AGENT REQUEST:'), 'the chat sent one request to the AI');
  ok(has(c, '- Water frontage: 30 ft') && has(c, REMARKS) && has(c, '- Below-grade finished: 500 sq ft'), 'the chat is told the same subject facts');
  ok(compLine(c, '1 Test Water Dr') === wet && compLine(c, '2 Test Dry Rd') === dry, 'the chat describes each comp exactly as the analysis did');
  ok(has(c, 'Never say the MLS sheet or the listing does not mention it'), 'the chat carries the same rule');

  // Typing another address takes the sheet away: none of its facts are sent.
  await st(async () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.osgAddress = '77 Other St, Joppa, MD 21085'; s.osgChatInput = 'Again?'; await s.osgChatSend(); });
  await page.waitForTimeout(300);
  const d = prompts[2] || '';
  ok(d.length > 0 && !has(d, 'Water frontage') && !has(d, REMARKS), 'with another address the sheet\'s facts are not sent', d.slice(0, 200));

  // Cut-off replies (Nov 5, 2026). The page must never use part of an answer.
  {
    const S = (fn) => page.evaluate(fn);
    const cs = () => S(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { busy: s.osgClientBusy, err: s.osgClientError, txt: JSON.stringify(s.osgClient) }; });
    const rd = await S(() => {
      const t = (d) => { try { return 'ok:' + claudeText(d); } catch (e) { return 'threw:' + e.message; } };
      return { cut: t({ content: [{ type: 'text', text: 'Half a sent' }], stop_reason: 'refusal' }),
               full: t({ content: [{ type: 'text', text: 'Whole answer.' }], stop_reason: 'end_turn' }) };
    });
    ok(rd.cut === 'threw:the AI stopped partway through its answer, so nothing from it was used' && rd.full === 'ok:Whole answer.',
      'the shared reader never hands on a cut-off reply, and passes a whole one unchanged', rd);
    const rl = await S(() => { try { return 'ok:' + claudeText({ content: [{ type: 'text', text: 'Too lo' }], stop_reason: 'max_tokens' }); } catch (e) { return 'threw:' + e.message; } });
    ok(rl === "threw:the AI's answer ran past its length limit and was cut off, so nothing from it was used",
      'the shared reader never hands on a reply cut off for length', rl);
    // Streaming readers: the same check once the stream ends. fetch is
    // replaced for this check only with a stream that ends each way.
    const sr = await S(async () => {
      const f0 = window.fetch;
      const sse = (reason) => new Response(
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Half"}}\n\n' +
        'data: {"type":"message_delta","delta":{"stop_reason":"' + reason + '"}}\n\n', { status: 200 });
      const out = {};
      for (const reason of ['end_turn', 'max_tokens', 'refusal']) {
        window.fetch = async () => sse(reason);
        for (const fn of ['claudeStream', 'claudeChatStream']) {
          let seen = '';
          try {
            const arg = fn === 'claudeStream' ? 'q' : [{ role: 'user', content: 'q' }];
            const r = await window[fn](arg, null, (c, full) => { seen = full; });
            out[fn + ':' + reason] = 'ok:' + r;
          } catch (e) { out[fn + ':' + reason] = 'threw:' + e.message + '|seen:' + seen; }
        }
      }
      window.fetch = f0;
      return out;
    });
    ok(sr['claudeStream:end_turn'] === 'ok:Half' && sr['claudeChatStream:end_turn'] === 'ok:Half',
      'a streamed reply that finished is returned unchanged', sr);
    ok(['claudeStream', 'claudeChatStream'].every(f => /^threw:the AI's answer ran past its length limit and was cut off, so it is not complete: ask again/.test(sr[f + ':max_tokens'])
      && /^threw:the AI stopped partway through its answer, so it is not complete: ask again/.test(sr[f + ':refusal'])),
      'a streamed reply cut off for length or by the filter ends in a clear error', sr);
    refuseNext = 2; aiCalls = 0;
    await S(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.osgClientWrite(); });
    let c = await cs();
    ok(aiCalls === 3 && c.err === '' && has(c.txt, 'Client wording for reasoning.') && !has(c.txt, 'what someone act'),
      'client wording: two cut-off replies are retried and the third, complete one is used', { aiCalls, c });
    const before = c.txt;
    refuseNext = 3; aiCalls = 0;
    await S(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.osgClientWrite(); });
    c = await cs();
    ok(aiCalls === 3 && has(c.err, 'the AI stopped partway through its answer, so nothing from it was used') && c.txt === before,
      'client wording: three cut-off replies fail with a clear reason and leave the last wording alone', { aiCalls, c });
    refuseNext = 1; aiCalls = 0;
    await S(async () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.osgChatInput = 'Any change?'; await s.osgChatSend(); });
    const ch = await S(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { err: s.osgChatError, last: s.osgChatMsgs[s.osgChatMsgs.length - 1] }; });
    ok(aiCalls === 2 && ch.err === '' && ch.last && ch.last.role === 'bot', 'chat: a cut-off reply is retried and the next one used', { aiCalls, ch });
    refuseNext = 1; aiCalls = 0;
    await S(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.osgAnalyze(); });
    const g = await S(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { err: s.osgAnalyzeError, step: s.osgStep, mv: s.osgResult && s.osgResult.marketValue }; });
    ok(aiCalls === 2 && g.err === '' && g.step === 3 && g.mv === '$580,000', 'Generate: a cut-off reply is retried and the next one used', { aiCalls, g });
  }

  ok(errors.length === 0, 'no page errors', errors);

  // Waiting (Nov 5, 2026): the panel counts the seconds, and a reply that
  // never comes stops the press after 3 minutes; one that comes late is
  // ignored. The page's clock is driven by the test.
  {
    let release = null; const held = [];
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx2.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      if (/api\.anthropic\.com/.test(u)) { held.push(route); return; }   // never answered until released
      return api(route);
    });
    await ctx2.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); });
    const p2 = await ctx2.newPage();
    const err2 = []; p2.on('pageerror', e => err2.push(e.message));
    await p2.clock.install();
    await p2.goto(origin + '/index.html', { waitUntil: 'load' });
    await p2.clock.runFor(1500);
    const st2 = (fn) => p2.evaluate(fn);
    await st2(async () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; if (s.updatesModal && s.updatesModal.show) await s.dismissUpdates(); s.taskModalShow = false; s.go('offer-strategy'); s.osgGoToComps();
      s.osgComps.push({ address: '3 Test Hand Ln', salePrice: '500000', sqft: '2000', ppsf: '250', dom: '10', soldDate: '2026-01-01', spLp: '', concessions: '', notes: '', status: 'closed', editing: false, _src: 'manual' }); });
    await p2.clock.runFor(300);
    await p2.getByText('Generate Offer Strategy').click();
    await p2.clock.runFor(65000);
    const wait = await p2.locator('[data-osg-wait]').innerText().catch(() => '');
    ok(/^6[45] seconds so far\.$/.test(wait.trim()), 'while it works the panel counts the seconds', wait);
    ok(has(await p2.locator('body').innerText(), 'This usually takes about a minute, sometimes two.'), 'the panel says it usually takes about a minute');
    await p2.clock.runFor(116000);   // 181 s in total
    const s1 = await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { busy: s.osgAnalyzing, err: s.osgAnalyzeError, step: s.osgStep }; });
    ok(s1.busy === false && has(s1.err, 'did not finish within 3 minutes') && has(s1.err, 'Nothing was changed') && s1.step === 2, 'after 3 minutes the press stops and says nothing was changed', s1);
    // The reply arrives late: it must not replace anything.
    for (const r of held) await J(r, 200, { content: [{ type: 'text', text: JSON.stringify(STRATEGY) }], stop_reason: 'end_turn' });
    await p2.clock.runFor(2000);
    const s2 = await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { step: s.osgStep, result: !!s.osgResult, busy: s.osgAnalyzing }; });
    ok(s2.step === 2 && s2.result === false && s2.busy === false, 'a reply arriving after the stop is ignored', s2);
    // The chat has the same 3-minute stop (Nov 5, 2026). Needs a strategy on
    // screen: give it one, then send a question whose reply never comes.
    held.length = 0;
    await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState;
      s.osgResult = { maxValue: '$600,000', marketValue: '$580,000', winningOffer: '$585,000', appraisalGap: null, appraisalGapNote: null,
        valuationReasoning: 'R.', offerStructure: 'O.', escalationClause: null, talkingPoints: 'T.', justinNote: null };
      s.osgStep = 3; s.osgChatInput = 'Raise it?'; s.osgChatSend(); });
    await p2.clock.runFor(30000);
    const cw = await p2.locator('[data-osg-chat-wait]').innerText().catch(() => '');
    ok(/^\((29|30) seconds; usually about a minute\)$/.test(cw.trim()), 'while the chat works it counts the seconds', cw);
    await p2.clock.runFor(151000);   // 181 s
    const c1 = await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState;
      return { busy: s.osgChatBusy, err: s.osgChatError, input: s.osgChatInput, mv: s.osgResult.marketValue, msgs: s.osgChatMsgs.length }; });
    ok(c1.busy === false && c1.err === 'Nothing was changed: the AI did not finish within 3 minutes, so it was stopped. Try sending it again.'
      && c1.input === 'Raise it?' && c1.mv === '$580,000' && c1.msgs === 0,
      'after 3 minutes the chat stops, changes nothing and puts the question back in the box', c1);
    for (const r of held) await J(r, 200, { content: [{ type: 'text', text: JSON.stringify({ reply: 'Raised.', strategy: Object.assign({}, STRATEGY, { marketValue: '$999,000' }) }) }], stop_reason: 'end_turn' });
    await p2.clock.runFor(2000);
    const c2 = await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { mv: s.osgResult.marketValue, msgs: s.osgChatMsgs.length }; });
    ok(c2.mv === '$580,000' && c2.msgs === 0, 'a chat reply arriving after the stop changes nothing', c2);
    await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.osgResult = null; s.osgStep = 2; });

    // A normal press afterwards still works and the count starts again at 0.
    held.length = 0;
    await p2.getByText('Generate Offer Strategy').click();
    await p2.clock.runFor(3000);
    for (const r of held) await J(r, 200, { content: [{ type: 'text', text: JSON.stringify(STRATEGY) }], stop_reason: 'end_turn' });
    await p2.clock.runFor(2000);
    const s3 = await st2(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return { step: s.osgStep, result: !!s.osgResult, err: s.osgAnalyzeError, secs: s.osgAnalyzeSecs }; });
    ok(s3.step === 3 && s3.result && s3.err === '' && s3.secs < 10, 'the next press works and the count started again', s3);
    ok(err2.length === 0, 'no page errors while waiting', err2);
    await ctx2.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
