#!/usr/bin/env node
/*
 * FORWARD OS: the Buyer Avatars tool. Run on every pull request.
 *
 * Marc, Oct 24, 2026: avatars redone in the description writer's chat never reached the
 * campaign. They are now their own tool on the listing, saved as the note `buyer_avatars`,
 * and three things read that one note: the Listing Description Writer, the campaign's
 * generator and its Buyer Avatars page.
 *
 * Opens the real index.html in headless Chromium, with real clicks, against a made-up
 * property_notes table that behaves like the real one. SAFETY: never touches production;
 * every request is intercepted.
 *
 * Usage: node ci/buyer-avatars-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333', D = '44444444-4444-4444-8444-444444444444';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-10-04T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD 21201', seller_name: 'Seller B', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-10-03T00:00:00Z' },
  { id: C, address: '300 Charlie Ln, Bethesda MD 20814', seller_name: 'Seller C', agent_name: 'Marc Cashin', market: 'MD', status: 'draft', created_at: '2026-10-02T00:00:00Z' },
  { id: D, address: '400 Delta Dr, Arlington VA 22201', seller_name: 'Seller D', agent_name: 'Marc Cashin', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' }
];
const MLS = (addr) => '=== MLS DATA ===\nProperty Address : ' + addr + '\nList Price       : $2,000,000\nBeds             : 3\nBaths            : 2.5\nYear Built       : 1800';
const NAMES = ['Margaret and Theodore Hale', 'Dr. Priya Raghunathan', 'Alexander and Noor Behzadi', 'Daniel Okafor', 'Claire and James Whitmore'];
const AGES = ['59 and 62', '45', '48 and 46', '52', '41 and 43'];
// The layout the tool asks the AI for.
const labeled = (tag) => NAMES.map((n, i) => (i + 1) + '. ' + n + ', ' + AGES[i] + '\nOccupation: Job ' + i + ' ' + tag + '\nHousehold: Two adults ' + i + '\nNet Worth: $' + (i + 2) + 'M to $' + (i + 4) + 'M\nLeaving Behind: old life ' + i + '\nMoving Toward: new life ' + i + '\nAfraid Of: worry ' + i + '\nWhy this residence now: reason number ' + i + ' ' + tag + '.\nHook: hook number ' + i + ' ' + tag + '.').join('\n\n');
// The writer chat's layout, as Marc pasted it.
const chat = 'Here are the five revised avatars.\n\n---\n\n' + NAMES.map((n, i) => '**' + (i + 1) + '. ' + n + ', ' + AGES[i] + '**\n*Role line ' + i + '.*\nStory ' + i + ' goes here. **Why this residence now:** Why ' + i + ' goes here. **Hook:** Hook ' + i + ' goes here.').join('\n\n');
const GOOD = labeled('good');
const SAVED_V1 = labeled('first'), SAVED_V2 = labeled('second');
const DESC = 'A description of Alpha Court that is saved on the listing.';
const CAMP = [{ title: 'BUYER AVATARS', content: 'OLD AVATAR TEXT IN THE CAMPAIGN', included: true }, { title: 'SOCIAL MEDIA COPY', content: 'SOCIAL TEXT STAYS EXACTLY AS IT WAS AND IS LONG ENOUGH TO KEEP', included: true }];

let notes, hist, hid, mode, sent, ai, rs;
// What the backend's /api/avatar-research answers (made up, same shape as forward-os-backend avatar_research.py).
const RES_PROMPT = (zip) => 'RESEARCH FOR THESE AVATARS (gathered by FORWARD OS; use these figures exactly as written, never round, widen or invent one):\nCensus, U.S. Census Bureau, American Community Survey 2020-2024 5-year estimates, ZIP Code Tabulation Area ' + zip + ':\n- Median household income: $148,451\n- Pay: Physicians: $239,200 median (2024) [https://www.bls.gov/oes/x]';
const RES_FOR = (prop, when) => { const zip = (prop.address.match(/(\d{5})(?!.*\d{5})/) || [])[1] || ''; return { address: prop.address, zip, ok: true,
  census: { year: 2024, zip, source: 'U.S. Census Bureau, American Community Survey 2020-2024 5-year estimates, ZIP Code Tabulation Area ' + zip, source_url: 'https://data.census.gov/profile?g=860XX00US' + zip, note: 'Shares are worked out by FORWARD OS from two Census counts; the counts are the Census\'s.', figures: [{ key: 'median_income', label: 'Median household income', value: 148451, display: '$148,451' }] },
  jobs: { error: 'Job clusters were NOT pulled: api.census.gov answered 500' },
  web: { employers: [{ name: 'Inova Alexandria Hospital', what: 'hospital', where: 'Alexandria', source_url: 'https://example.org/inova' }], moving: [], salaries: [{ occupation: 'Physicians', range: '$239,200 median', year: '2024', source_url: 'https://www.bls.gov/oes/x' }], dropped_without_source: 1 },
  prompt: RES_PROMPT(zip), researched_at: when || new Date().toISOString() }; };
function reset() {
  hid = 0; sent = []; mode = { saveFails: false, campFails: false }; ai = { calls: [], answers: [] }; rs = { calls: [], fail: false, delay: 0 };
  notes = [
    { id: 'n1', property_id: A, subfolder: 'mls_data', content: MLS(PROPS[0].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n2', property_id: A, subfolder: 'listing_remarks', content: DESC, updated_at: '2026-10-02T00:00:00Z' },
    { id: 'n3', property_id: A, subfolder: 'campaign_sections', content: JSON.stringify(CAMP), updated_at: '2026-10-02T00:00:00Z' },
    { id: 'n4', property_id: B, subfolder: 'mls_data', content: MLS(PROPS[1].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n9', property_id: B, subfolder: 'listing_remarks', content: DESC, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n5', property_id: C, subfolder: 'mls_data', content: MLS(PROPS[2].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n6', property_id: C, subfolder: 'listing_remarks', content: DESC, updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n8', property_id: D, subfolder: 'mls_data', content: ' ', updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n7', property_id: C, subfolder: 'buyer_avatars', content: SAVED_V2, updated_at: '2026-10-05T00:00:00Z' }
  ];
  hist = [];
  const add = (p, sf, c, by, at) => hist.push({ id: ++hid, property_id: p, subfolder: sf, content: c, saved_by: by, saved_at: at });
  add(C, 'buyer_avatars', SAVED_V1, 'Charlotte Lee', '2026-10-03T00:00:00Z');
  add(C, 'buyer_avatars', SAVED_V2, 'Marc Cashin', '2026-10-05T00:00:00Z');
}
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function saveNote(b) {
  if (!b.p_content || !String(b.p_content).trim()) return { status: 400, body: { code: 'P0001', message: 'refusing to replace a note with blank text' } };
  if (mode.saveFails && b.p_subfolder === 'buyer_avatars') return { status: 500, body: { message: 'made-up database outage' } };
  if (mode.campFails && b.p_subfolder === 'campaign_sections') return { status: 500, body: { message: 'made-up campaign outage' } };
  notes = notes.filter(n => !(n.property_id === b.p_property_id && n.subfolder === b.p_subfolder));
  const row = { id: 'n' + Date.now() + Math.random(), property_id: b.p_property_id, subfolder: b.p_subfolder, content: b.p_content, updated_by: b.p_saved_by || null, updated_at: new Date().toISOString() };
  notes.push(row);
  const last = hist.filter(h => h.property_id === row.property_id && h.subfolder === row.subfolder).sort((x, y) => y.id - x.id)[0];
  if (!last || last.content !== row.content) hist.push({ id: ++hid, property_id: row.property_id, subfolder: row.subfolder, content: row.content, saved_by: row.updated_by, saved_at: row.updated_at });
  return { status: 200, body: row };
}
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method(), base = u.split('?')[0];
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m !== 'GET') sent.push({ m, u: base, body: req.postData() || '' });
  if (/up\.railway\.app\/api\/avatar-research$/.test(base)) {
    const b = JSON.parse(req.postData()); rs.calls.push(b);
    const prop = PROPS.find(p => p.id === b.property_id);
    const answer = () => rs.fail ? J(route, 502, { detail: 'made-up research outage' }) : J(route, 200, RES_FOR(prop));
    if (rs.delay) return new Promise(r => setTimeout(r, rs.delay)).then(answer);
    return answer();
  }
  if (/api\.anthropic\.com\/v1\/messages/.test(base)) {
    const b = JSON.parse(req.postData());
    ai.calls.push({ system: b.system || '', prompt: b.messages.map(x => x.content).join('\n'), stream: !!b.stream });
    const text = ai.answers.length ? ai.answers.shift() : 'NO ANSWER QUEUED';
    if (b.stream) return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: 'data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + '\n\ndata: [DONE]\n\n' });
    return J(route, 200, { content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  }
  if (/\/rest\/v1\/property_note_history/.test(base)) return J(route, 200, hist.filter(h => u.includes(h.property_id)).sort((x, y) => (y.saved_at > x.saved_at ? 1 : -1)));
  if (/\/rpc\/save_property_note_by$/.test(base)) { const r = saveNote(JSON.parse(req.postData())); return J(route, r.status, r.body); }
  if (/\/rpc\/save_property_note$/.test(base)) { const r = saveNote(JSON.parse(req.postData())); return J(route, r.status, r.body); }
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, notes.filter(n => u.includes(n.property_id)).sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1)));
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }
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
  reset();
  async function newPage(withKey) {
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
    page.on('pageerror', e => errors.push(e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ')));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    return page;
  }
  const page = await newPage(true);
  const open = (pg, id, tool) => pg.evaluate(async ([id, tool]) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!st.lstProperties.length) await st.lstFetchProperties();
    await st.lstOpenProperty(st.lstProperties.find(p => p.id === id));
    await new Promise(r => setTimeout(r, 900));
    if (tool) {
      // Every tool but MLS Data needs saved MLS Data (the gate), so each test listing has some. Open ours by a real click.
      for (let i = 0; i < 3 && st.lstToolOpen !== 'buyeravatars'; i++) {
        const hdr = Array.from(document.querySelectorAll('.subfolder-header')).find(h => new RegExp(tool, 'i').test(h.querySelector('.subfolder-tool-name') ? h.querySelector('.subfolder-tool-name').textContent : h.innerText));
        hdr.click(); await new Promise(r => setTimeout(r, 400));
      }
    }
  }, [id, tool]);
  const dbg = (pg) => pg.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return { tool: st.lstToolOpen, prop: st.lstActiveProp && st.lstActiveProp.id, av: !!document.querySelector('[data-av]'), n: document.querySelectorAll('[data-av]').length, hdrs: Array.from(document.querySelectorAll('.subfolder-header')).length }; });
  const click = async (pg, sel) => { await pg.click('[data-av="' + sel + '"]'); await pg.waitForTimeout(700); };
  const has = (pg, sel) => pg.evaluate((s) => !!document.querySelector('[data-av="' + s + '"]'), sel);
  const txt = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector('[data-av="' + s + '"]'); return e ? (e.value !== undefined && e.tagName === 'TEXTAREA' ? e.value : e.innerText) : null; }, sel);
  const fill = async (pg, v) => { await pg.fill('[data-av="textarea"]', v); await pg.waitForTimeout(300); };
  const writes = (sf) => sent.filter(x => /save_property_note/.test(x.u) && JSON.parse(x.body).p_subfolder === sf).map(x => JSON.parse(x.body));

  console.log('The tool sits above the Listing Description tool, and starts empty on a listing with no avatars');
  await open(page, A, 'Buyer Avatars');
  const order = await page.evaluate(() => { const h = Array.from(document.querySelectorAll('.subfolder-header')).map(x => x.innerText.trim().split('\n')[0]); return { av: h.findIndex(x => /Buyer Avatars/i.test(x)), ld: h.findIndex(x => /Listing Description/i.test(x)) }; });
  ok(order.av >= 0 && order.ld >= 0 && order.av < order.ld, 'Buyer Avatars is listed above Listing Description', order);
  ok(await has(page, 'none') && await has(page, 'write') && await has(page, 'self'), 'no avatars yet: says so and offers Write with AI and Paste my own');
  ok(!(await has(page, 'saved-badge')), 'no Saved badge before anything is saved');

  console.log('Pasting the writer chat\'s avatars: the tool says what the campaign will read, and saves once');
  await click(page, 'self');
  await fill(page, chat);
  const rb = await txt(page, 'readback-names');
  ok(/reads 5 avatars/.test(rb || '') && NAMES.every(n => (rb || '').includes(n)), 'read-back names all five avatars', rb);
  ok(!(await has(page, 'readback-warn')), 'five avatars read: no warning');
  sent.length = 0;
  await click(page, 'save');
  const w1 = writes('buyer_avatars');
  ok(w1.length === 1 && w1[0].p_property_id === A && w1[0].p_saved_by === 'Marc Cashin', 'one save, to this listing, with the signed-in agent', w1.map(x => [x.p_property_id, x.p_saved_by]));
  ok(w1[0] && w1[0].p_content === chat.trim(), 'the saved text is exactly what was pasted');
  ok(await has(page, 'saved-badge') && !(await has(page, 'textarea')), 'badge shows Saved and the editor closes');
  const wc = writes('campaign_sections');
  const camp = wc[0] ? JSON.parse(wc[0].p_content) : [];
  ok(wc.length === 1 && camp.length === 2, 'the campaign was saved once with its two sections', camp.map(x => x.title));
  ok(camp[0] && camp[0].title === 'BUYER AVATARS' && camp[0].content === chat.trim(), 'the campaign\'s Buyer Avatars section now holds the saved avatars');
  ok(camp[1] && camp[1].content === CAMP[1].content, 'the other campaign section is untouched');
  ok(/campaign.s Buyer Avatars page now uses them/.test(await page.evaluate(() => document.body.innerText)), 'the agent is told the campaign page was updated');

  console.log('A listing with no campaign yet: saving writes the avatars and nothing to the campaign');
  await open(page, B, 'Buyer Avatars');
  await click(page, 'self'); await fill(page, GOOD);
  sent.length = 0; await click(page, 'save');
  ok(writes('buyer_avatars').length === 1 && writes('campaign_sections').length === 0, 'one avatars save, no campaign write', sent.map(x => x.u));

  console.log('A failed save is said, and the text stays');
  await open(page, D, 'Buyer Avatars');
  mode.saveFails = true;
  await click(page, 'self'); await fill(page, GOOD);
  sent.length = 0; await click(page, 'save');
  const er = await txt(page, 'error');
  ok(/NOT saved/.test(er || '') && /made-up database outage/.test(er || ''), 'the error says NOT saved and why', er);
  ok((await txt(page, 'textarea')) === GOOD, 'the agent\'s text is still in the box');
  ok(!(await has(page, 'saved-badge')) && writes('campaign_sections').length === 0, 'no Saved badge and nothing sent to the campaign');
  mode.saveFails = false;
  await click(page, 'save');
  ok(await has(page, 'saved-badge') && !(await has(page, 'error')), 'saving again works and clears the error');

  console.log('A campaign that cannot be updated is said, with the avatars still saved');
  reset();
  await open(page, A, 'Buyer Avatars');
  mode.campFails = true;
  await click(page, 'self'); await fill(page, GOOD);
  await click(page, 'save');
  const er2 = await txt(page, 'error');
  ok(await has(page, 'saved-badge'), 'the avatars are saved');
  ok(/saved, but the campaign.s Buyer Avatars page was NOT updated/.test(er2 || ''), 'it says the campaign page was NOT updated', er2);
  mode.campFails = false;

  console.log('Text the campaign cannot split is flagged before it is saved');
  await open(page, B, 'Buyer Avatars');
  await click(page, 'self'); await fill(page, 'A long avatar paragraph with no numbers and no headers at all. '.repeat(14));
  ok(/reads as ONE avatar/.test((await txt(page, 'readback-warn')) || ''), 'warns that it reads as one avatar');
  await fill(page, GOOD.split('\n\n').slice(0, 4).join('\n\n'));
  ok(/4 avatars read/.test((await txt(page, 'readback-warn')) || ''), 'warns when it reads fewer than five');

  console.log('Writing with AI: nothing is saved until the agent presses Save; a bad answer is sent back with the reason');
  reset();
  await open(page, A, 'Buyer Avatars');
  const FOUR = GOOD.split('\n\n').slice(0, 4).join('\n\n').replace('good.', 'good — and charming.');
  ai.answers = [FOUR, GOOD]; sent.length = 0;
  await click(page, 'write'); await page.waitForSelector('[data-av="textarea"]', { timeout: 15000 });
  ok(ai.calls.length === 2, 'two AI calls: the first answer was rejected', ai.calls.length);
  ok(/REJECTED/.test(ai.calls[1] && ai.calls[1].prompt) && /exactly 5/.test(ai.calls[1].prompt) && /long dash/.test(ai.calls[1].prompt) && /charming/.test(ai.calls[1].prompt), 'the retry says why: wrong count, long dash, banned word');
  ok(ai.calls[0].prompt.includes('MLS DATA') && ai.calls[0].prompt.includes(DESC) && ai.calls[0].prompt.includes('100 Alpha Ct'), 'the request carries this listing\'s address, MLS Data and description');
  ok(/exactly 5 avatars/.test(ai.calls[0].system) && /FAIR HOUSING/.test(ai.calls[0].system) && /Never mention children/.test(ai.calls[0].system) && /Hook: one sentence this buyer would stop scrolling for/.test(ai.calls[0].system), 'the rules carry the layout and the fair housing rule');
  ok((await txt(page, 'textarea')) === GOOD, 'the good answer is in the editor');
  ok(await has(page, 'ai-note') && /Nothing is saved yet/.test(await txt(page, 'ai-note')), 'it says nothing is saved yet');
  ok(writes('buyer_avatars').length === 0, 'no save was sent', sent.map(x => x.u));
  await click(page, 'cancel');
  ok(!(await has(page, 'saved-badge')) && (await has(page, 'none')), 'Cancel leaves the listing without avatars');

  console.log('Three bad answers: nothing written, said on screen');
  ai.calls = []; ai.answers = [FOUR, FOUR, FOUR];
  await click(page, 'write'); await page.waitForTimeout(1500);
  ok(ai.calls.length === 3, 'three tries', ai.calls.length);
  ok(/NOT written/.test((await txt(page, 'error')) || '') && !(await has(page, 'textarea')), 'it says the avatars were NOT written and no draft opens');
  ok(writes('buyer_avatars').length === 0, 'nothing was saved');

  console.log('Rewrite with AI on a listing that has saved avatars keeps the saved ones until Save');
  await open(page, C, 'Buyer Avatars');
  ai.answers = [GOOD]; await click(page, 'rewrite'); await page.waitForSelector('[data-av="textarea"]', { timeout: 15000 });
  ok((await txt(page, 'textarea')) === GOOD && notes.find(n => n.property_id === C && n.subfolder === 'buyer_avatars').content === SAVED_V2, 'the draft is the new text; the saved note is still the old one');
  await click(page, 'cancel');
  ok((await txt(page, 'text')) === SAVED_V2, 'Cancel shows the saved avatars again');

  console.log('Your own ideas: typed words go to the AI exactly, the AI still researches, nothing is saved by typing them');
  ok(!/OWN IDEAS/.test(ai.calls[0] ? ai.calls[0].prompt : '') , 'with no ideas typed, the request carries no ideas block');
  await open(page, A, 'Buyer Avatars');
  ok(await has(page, 'ideas'), 'the ideas box is on screen when the listing has no avatars');
  await open(page, C, 'Buyer Avatars');
  ok(await has(page, 'ideas'), 'the ideas box is on screen when avatars are saved (for Rewrite)');
  const IDEAS = 'A surgeon relocating to Walter Reed who wants a quiet street\nA couple who entertain every weekend';
  await page.fill('[data-av="ideas"]', IDEAS); await page.waitForTimeout(200);
  sent.length = 0; ai.calls = []; ai.answers = [FOUR, GOOD];
  await click(page, 'rewrite'); await page.waitForSelector('[data-av="textarea"]', { timeout: 15000 });
  ok(ai.calls.length === 2 && ai.calls.every(c => c.prompt.includes(IDEAS) && /THE AGENT'S OWN IDEAS/.test(c.prompt)), 'both tries carry the agent\'s words exactly, so a retry never loses them', ai.calls.map(c => c.prompt.slice(0, 80)));
  ok(/Build one avatar around EACH idea/.test(ai.calls[0].prompt) && /Fair housing still applies/.test(ai.calls[0].prompt) && /remaining avatars yourself/.test(ai.calls[0].prompt), 'the AI is told to build on each idea, fill the rest itself and keep fair housing');
  ok(ai.calls[0].prompt.includes('MLS DATA') && ai.calls[0].prompt.includes(DESC), 'the AI still gets the listing\'s own facts to research from');
  ok(writes('buyer_avatars').length === 0, 'nothing was saved by writing with ideas');
  await click(page, 'cancel');
  await open(page, D, 'Buyer Avatars');
  ok((await page.inputValue('[data-av="ideas"]')) === '', 'ideas typed on one listing do not follow the agent to the next');

  console.log('Nothing to write from: said, no AI call');
  await open(page, D, 'Buyer Avatars');
  ai.calls = [];
  await click(page, 'write');
  ok(/nothing to write the avatars from/.test((await txt(page, 'error')) || '') && ai.calls.length === 0, 'a listing with no MLS Data and no description is refused with the reason');

  console.log('No AI key: refuses and sends nothing');
  const page2 = await newPage(false);
  await open(page2, A, 'Buyer Avatars');
  ai.calls = [];
  await click(page2, 'write');
  ok(/AI key|API key|key/i.test((await txt(page2, 'error')) || '') && ai.calls.length === 0, 'the notice names the missing key and no request goes out', await txt(page2, 'error'));

  console.log('One listing\'s avatars never show on another, and earlier versions are kept');
  await open(page, C, 'Buyer Avatars');
  ok((await txt(page, 'text')) === SAVED_V2 && /Saved .* by Marc Cashin/.test(await page.evaluate(() => (document.querySelector('[data-hist-current="buyer_avatars"]') || {}).innerText || '')), 'listing C shows its saved avatars and who saved them');
  const hv = await page.evaluate(async () => { const b = document.querySelector('[data-hist="buyer_avatars"]'); if (!b) return null; b.querySelector('[data-hist-toggle]').click(); await new Promise(r => setTimeout(r, 200)); const row = b.querySelector('[data-hist-row]'); row.firstElementChild.click(); await new Promise(r => setTimeout(r, 200)); return { n: b.querySelectorAll('[data-hist-row]').length, text: b.querySelector('[data-hist-text]').innerText }; });
  ok(hv && hv.n === 1 && hv.text === SAVED_V1, 'Previous versions lists the earlier save and opens its text', hv);
  await open(page, D, 'Buyer Avatars');
  ok(!(await has(page, 'saved-badge')) && (await has(page, 'none')) && !((await page.evaluate(() => document.body.innerText)).includes('Job 0 second')), 'the next listing starts empty');
  await click(page, 'self'); await fill(page, 'half typed');
  await open(page, C, 'Buyer Avatars');
  ok(!(await has(page, 'textarea')), 'an unsaved draft does not follow the agent to another listing');

  console.log('The Listing Description Writer uses saved avatars, and is unchanged without them');
  await open(page, C, null);
  ai.calls = []; ai.answers = ['Understood.'];
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ldOpenWriter(); await new Promise(r => setTimeout(r, 1500)); await st.ldSend('The property address is: 300 Charlie Ln, Bethesda MD 20814.'); });
  await page.waitForTimeout(4000); // let the writer's typing animation finish before the next listing opens
  const wc1 = ai.calls.find(c => c.stream);
  ok(wc1 && wc1.system.includes('SAVED BUYER AVATARS') && wc1.system.includes(SAVED_V2) && /do not ask whether the personas have been developed/.test(wc1.system), 'with saved avatars the writer is told to use them and not ask for personas', wc1 && wc1.system.slice(-300));
  ok(wc1 && /Never name, quote or describe an avatar in the description/.test(wc1.system), 'it is told never to name or describe an avatar in the description (fair housing)');
  ok(/Using the 5 buyer avatars saved on this listing/.test(await page.evaluate(() => document.body.innerText)), 'the writer screen says it is using the saved avatars');
  await open(page, B, null);
  ai.calls = []; ai.answers = ['Understood.'];
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ldStartFresh(); st.ldOpenWriter(); await new Promise(r => setTimeout(r, 1500)); await st.ldSend('The property address is: 200 Bravo Ave. Baltimore, MD 21201.'); });
  await page.waitForTimeout(4000); // let the writer's typing animation finish before the next listing opens
  const wc2 = ai.calls.find(c => c.stream);
  ok(wc2 && !wc2.system.includes('SAVED BUYER AVATARS') && /Have you already developed the 5 buyer personas/.test(wc2.system), 'a listing with no saved avatars gets the writer\'s prompt as it always was');
  ok(/No buyer avatars are saved on this listing/.test(await page.evaluate(() => document.body.innerText)), 'the writer screen says so and offers the tool');

  console.log('Avatars the writer creates in its chat can be saved to Buyer Avatars');
  reset();
  await open(page, B, null);
  const WRAP = (t) => 'Here are the five buyer avatars.\n[FWRD_AVATARS_START]\n' + t + '\n[FWRD_AVATARS_END]\nWould you like to change any of them before I write the description?';
  ai.calls = []; ai.answers = [WRAP(GOOD)]; sent.length = 0;
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.ldStartFresh(); st.ldOpenWriter(); await new Promise(r => setTimeout(r, 1500)); await st.ldSend('The property address is: 200 Bravo Ave. Baltimore, MD 21201.'); });
  await page.waitForTimeout(4000);
  const ws = ai.calls.find(c => c.stream);
  ok(ws && ws.system.includes('Hook: one sentence this buyer would stop scrolling for') && ws.system.includes('Afraid Of: what worries them about this purchase') && ws.system.includes('[FWRD_AVATARS_START]'), 'with no saved avatars, the writer is given the Buyer Avatars layout and the markers for step 5');
  ok(ws && /never mention children or the absence of children/.test(ws.system) && /ages appear only in the header line/.test(ws.system) && /Never write "carried over"/.test(ws.system), 'and the same fair housing and wording rules as the tool');
  const bubble = await page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const m = st.ldMessages.filter(x => x.role === 'assistant'); return m[m.length - 1].content; });
  ok(!/FWRD_/.test(bubble) && bubble.includes('Margaret and Theodore Hale'), 'the chat shows the avatars without the markers');
  ok(await page.evaluate(() => !!document.querySelector('[data-avc="pending"]')), 'a card says the writer created avatars that are not saved yet');
  ok(/Margaret and Theodore Hale/.test(await page.evaluate(() => document.querySelector('[data-avc="pending"]').innerText)) && /^Save to Buyer Avatars$/.test(await page.evaluate(() => document.querySelector('[data-avc="save"]').textContent.trim())), 'it names them and offers Save to Buyer Avatars', await page.evaluate(() => (document.querySelector('[data-avc="card"]') || {}).innerText));
  ok(writes('buyer_avatars').length === 0, 'nothing is saved until the agent presses it');
  await page.click('[data-avc="save"]'); await page.waitForTimeout(800);
  const wsv = writes('buyer_avatars');
  ok(wsv.length === 1 && wsv[0].p_property_id === B && wsv[0].p_content === GOOD.trim() && wsv[0].p_saved_by === 'Marc Cashin', 'one save to this listing with exactly the avatars, under the agent\'s name', wsv.map(x => [x.p_property_id, x.p_content.slice(0, 30)]));
  ok(await page.evaluate(() => !!document.querySelector('[data-avc="saved"]')) && notes.find(n => n.property_id === B && n.subfolder === 'buyer_avatars'), 'the card says saved and the listing holds them');
  ai.calls = []; ai.answers = [WRAP(GOOD.replace('Household: Two adults 0', 'Household: Two adults 0, no children'))]; sent.length = 0;
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; await st.ldSend('Please change avatar 1.'); });
  await page.waitForTimeout(4000);
  const ws2 = ai.calls.find(c => c.stream);
  ok(ws2 && ws2.system.includes('SAVED BUYER AVATARS') && /If the agent asks you to change the avatars, write all five again/.test(ws2.system) && ws2.system.includes('[FWRD_AVATARS_START]'), 'once saved, the writer uses them and is told how to hand back changed avatars');
  ok(/^Replace the saved Buyer Avatars with these$/.test(await page.evaluate(() => document.querySelector('[data-avc="save"]').textContent.trim())), 'changed avatars offer to replace the saved ones');
  await page.click('[data-avc="save"]'); await page.waitForTimeout(600);
  ok(/NOT saved to Buyer Avatars/.test(await page.evaluate(() => (document.querySelector('[data-avc="error"]') || {}).innerText || '')) && /children/.test(await page.evaluate(() => document.querySelector('[data-avc="error"]').innerText)) && writes('buyer_avatars').length === 0, 'avatars that mention children are refused with the reason and nothing is sent');
  mode.saveFails = true;
  ai.answers = [WRAP(GOOD.replace('Job 0 good', 'Job 0 better'))];
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; await st.ldSend('Try again without that.'); });
  await page.waitForTimeout(4000);
  await page.click('[data-avc="save"]'); await page.waitForTimeout(600);
  ok(/were NOT saved to Buyer Avatars: .*made-up database outage/.test(await page.evaluate(() => (document.querySelector('[data-avc="error"]') || {}).innerText || '')) && await page.evaluate(() => !!document.querySelector('[data-avc="save"]')), 'a failed save is said with the reason and the button stays');
  mode.saveFails = false;
  await open(page, D, null);
  ok(await page.evaluate(() => !document.querySelector('[data-avc="card"]')), 'the card never follows the agent to another listing');
  reset();
  reset();
  reset();

  console.log('Research behind the avatars: started when the tool opens, added to the same request, never instead of it');
  reset();
  const st = (pg, f) => pg.evaluate(f);
  await open(page, A, 'Buyer Avatars'); await page.waitForTimeout(600);
  ok(rs.calls.length === 1 && rs.calls[0].property_id === A && Object.keys(rs.calls[0]).join() === 'property_id', 'opening Buyer Avatars starts the research at once, sending only the listing id', rs.calls);
  const rsave = writes('avatar_research');
  ok(rsave.length === 1 && rsave[0].p_property_id === A && JSON.parse(rsave[0].p_content).prompt === RES_PROMPT('22306'), 'the research is saved on the listing as it came back');
  ok(/^Researched /.test((await txt(page, 'when')) || '') || await page.evaluate(() => /Researched /.test((document.querySelector('[data-avr="when"]') || {}).innerText || '')), 'the panel says when it was researched');
  await page.click('[data-avr="toggle"]'); await page.waitForTimeout(300);
  const body = await page.evaluate(() => { const b = document.querySelector('[data-avr="body"]'); return b ? { text: b.innerText, links: Array.from(b.querySelectorAll('a')).map(x => x.href) } : null; });
  ok(body && /Median household income: \$148,451/.test(body.text) && /Inova Alexandria Hospital/.test(body.text) && /Physicians: \$239,200 median \(2024\)/.test(body.text), 'the agent sees the figures and findings', body && body.text.slice(0, 300));
  ok(body && /Job clusters were NOT pulled: api\.census\.gov answered 500/.test(body.text) && /1 finding was left out because no source was given/.test(body.text), 'a part that failed is said in the panel, and dropped findings are counted');
  ok(body && body.links.includes('https://www.bls.gov/oes/x') && body.links.includes('https://data.census.gov/profile?g=860XX00US22306'), 'every finding links to its source');
  ai.calls = []; ai.answers = [GOOD]; sent.length = 0;
  await click(page, 'write'); await page.waitForSelector('[data-av="textarea"]', { timeout: 15000 });
  const P1 = ai.calls[0].prompt, S1 = ai.calls[0].system;
  ok(rs.calls.length === 1, 'Write with AI reuses the research already done, no second request');
  ok(P1.includes(RES_PROMPT('22306')) && /Use the research above IN ADDITION to every rule and instruction/.test(P1) && /never quote a statistic, count, percentage, wage, salary figure, date or source from it in an avatar/.test(P1), 'the request carries the research and the rule that it shapes the avatars but is never quoted in them');
  ok(P1.includes('MLS DATA') && P1.includes(DESC), 'and still everything it carried before');
  ok(!(await has(page, 'no-research')), 'no warning when the research was used');
  await click(page, 'cancel');
  // The same request without research: identical apart from the research block.
  rs.fail = true;
  await page.evaluate(() => { document.querySelector('#app').__vue_app__._instance.setupState.lstNotes.avatar_research = ''; });
  ai.calls = []; ai.answers = [GOOD];
  await click(page, 'write'); await page.waitForSelector('[data-av="textarea"]', { timeout: 15000 });
  const P2 = ai.calls[0].prompt, S2 = ai.calls[0].system, rule = (P1.match(/Use the research above IN ADDITION[^\n]*/) || [''])[0];
  ok(rs.calls.length === 2 && P2 === P1.replace(RES_PROMPT('22306') + '\n\n' + rule + '\n\n', '') && S2 === S1, 'without research the request is the same, word for word, minus the research block; the rules are unchanged', [P1.length, P2.length]);
  ok(/Written WITHOUT research\. The research did NOT run: made-up research outage/.test((await txt(page, 'no-research')) || ''), 'avatars written without research say so, with the reason', await txt(page, 'no-research'));
  await click(page, 'cancel');
  ok(/The research did NOT run: made-up research outage/.test((await page.evaluate(() => (document.querySelector('[data-avr="error"]') || {}).innerText || ''))) && await page.evaluate(() => !!document.querySelector('[data-avr="retry"]')), 'the panel says the research did not run and offers to try again');
  rs.fail = false;
  await page.click('[data-avr="retry"]'); await page.waitForTimeout(800);
  ok(rs.calls.length === 3 && await page.evaluate(() => !!document.querySelector('[data-avr="when"]')), 'trying again runs it and shows it');

  // On a phone the research panel and its long source names stay inside the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, 'Buyer Avatars'); await page.waitForTimeout(500);
  if (!(await page.evaluate(() => !!document.querySelector('[data-avr="body"]')))) { await page.click('[data-avr="toggle"]'); await page.waitForTimeout(300); }
  const phone = await page.evaluate(() => { const p = document.querySelector('[data-avr="panel"]'), b = document.querySelector('[data-avr="body"]'); const r = p.getBoundingClientRect(); return { open: !!b, pageScroll: document.documentElement.scrollWidth, view: window.innerWidth, panelScroll: p.scrollWidth, panelView: p.clientWidth, right: Math.round(r.right) }; });
  ok(phone.open && phone.panelScroll <= phone.panelView + 1 && phone.right <= phone.view && phone.pageScroll <= phone.view + 1, 'on a phone the research panel fits the screen with no sideways scroll', phone);
  await page.setViewportSize({ width: 1280, height: 720 });

  console.log('Research data is never quoted in an avatar, and the campaign says how the profiles were formed');
  // Marc's first live set (Oct 24, 2026) quoted an hourly wage, mover counts and an employment count.
  const QUOTED = GOOD.replace('Why this residence now: reason number 1 good.', 'Why this residence now: Legal occupations carry a mean hourly wage of $91.10 here.').replace('Leaving Behind: old life 2', 'Leaving Behind: a move made by 3,533 of the 7,389 residents');
  ai.calls = []; ai.answers = [QUOTED, GOOD];
  await click(page, 'write'); await page.waitForSelector('[data-av="textarea"]', { timeout: 15000 });
  ok(ai.calls.length === 2 && /REJECTED/.test(ai.calls[1].prompt) && /it quotes research data \("mean hourly wage"\)/.test(ai.calls[1].prompt), 'an answer that quotes research figures is sent back with the reason', ai.calls.length > 1 && ai.calls[1].prompt.slice(-400));
  ok((await txt(page, 'textarea')) === GOOD, 'only the clean answer reaches the editor');
  await click(page, 'cancel');
  const method = await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.lstAvMethodNote());
  ok(/^How these profiles were formed: FORWARD built these buyer profiles from the residence's own details and from research into the area around it: U\.S\. Census Bureau data for ZIP code 22306 on household income, home values, homeownership and where new residents are moving from; the largest employers and recent relocations nearby; and regional pay data from the U\.S\. Bureau of Labor Statistics\. The profiles are illustrative, not real people\./.test(method), 'the method note names the sources the research reached', method);
  ok(!/Census employment by industry/.test(method), 'a part that failed (job clusters here) is not named');
  ok(!/\d{2,}[,.]\d|\$|%/.test(method.replace('22306', '')), 'and holds no figures');
  ok(/never who should live there\.$/.test(method), 'and ends with the fair housing line');
  const noRes = await page.evaluate(() => { const s2 = document.querySelector('#app').__vue_app__._instance.setupState; const keep = s2.lstNotes.avatar_research; s2.lstNotes.avatar_research = ''; const m = s2.lstAvMethodNote(); s2.lstNotes.avatar_research = keep; return m; });
  ok(noRes === "How these profiles were formed: FORWARD built these buyer profiles from the residence's own details and our knowledge of this market. The profiles are illustrative, not real people. They describe who this residence is likely to appeal to and how it lives, never who should live there.", 'with no research it says the profiles come from the residence and FORWARD\'s knowledge', noRes);
  const tpl = require('fs').readFileSync(require('path').join(dir, 'campaign-print.html'), 'utf8');
  ok(/<p class="fwd-avatars__method" v-if="pkg\.buyerMethod">\{\{ pkg\.buyerMethod \}\}<\/p>\s*<\/section>/.test(tpl), 'the campaign page prints the note under the profiles');
  ok(/if \(pkg\.buyerProfiles && pkg\.buyerProfiles\.length\) pkg\.buyerMethod = lstAvMethodNote\(\);/.test(require('fs').readFileSync(require('path').join(dir, 'index.html'), 'utf8')), 'and the campaign package carries it whenever it has profiles');

  console.log('Saved research is reused for 30 days at the same address, then done again');
  reset();
  const fresh = JSON.stringify(RES_FOR(PROPS[2], new Date(Date.now() - 5 * 864e5).toISOString()));
  notes.push({ id: 'nr', property_id: C, subfolder: 'avatar_research', content: fresh, updated_at: '2026-10-20T00:00:00Z' });
  await open(page, C, 'Buyer Avatars'); await page.waitForTimeout(500);
  ok(rs.calls.length === 0, 'fresh saved research: no request');
  notes.find(n => n.id === 'nr').content = JSON.stringify(RES_FOR(PROPS[2], new Date(Date.now() - 40 * 864e5).toISOString()));
  await open(page, C, 'Buyer Avatars'); await page.waitForTimeout(500);
  ok(rs.calls.length === 1, 'research older than 30 days is done again');
  notes.find(n => n.property_id === C && n.subfolder === 'avatar_research').content = JSON.stringify(Object.assign(RES_FOR(PROPS[2]), { address: '1 Old Address Rd, Bethesda MD 20814' }));
  rs.calls = [];
  await open(page, C, 'Buyer Avatars'); await page.waitForTimeout(500);
  ok(rs.calls.length === 1, 'research for an address the listing no longer has is done again');

  console.log('The writer starts the research when it opens, and uses it at step 5 only when no avatars are saved');
  reset(); rs.calls = [];
  await open(page, B, null);
  await page.evaluate(() => { const s2 = document.querySelector('#app').__vue_app__._instance.setupState; s2.ldStartFresh(); s2.ldOpenWriter(); });
  await page.waitForTimeout(600);
  ok(rs.calls.length === 1 && rs.calls[0].property_id === B && ai.calls.length === 0, 'opening the writer on a listing with no avatars starts the research before anything is asked');
  ai.calls = []; ai.answers = ['Understood.'];
  await page.evaluate(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.ldSend('The property address is: 200 Bravo Ave. Baltimore, MD 21201.'); });
  await page.waitForTimeout(4000);
  const wsr = ai.calls.find(c => c.stream);
  ok(wsr && wsr.system.includes('RESEARCH FOR THE BUYER AVATARS') && wsr.system.includes(RES_PROMPT('21201')) && /IN ADDITION to every instruction above/.test(wsr.system) && /Never quote the research in the listing description/.test(wsr.system), 'the writer gets the research for step 5, in addition to its instructions');
  ok(wsr && /Have you already developed the 5 buyer personas/.test(wsr.system) && wsr.system.includes('[FWRD_AVATARS_START]'), 'and its own step 5 is unchanged');
  rs.calls = [];
  await open(page, C, null);
  ai.calls = []; ai.answers = ['Understood.'];
  await page.evaluate(async () => { const s2 = document.querySelector('#app').__vue_app__._instance.setupState; s2.ldStartFresh(); s2.ldOpenWriter(); await new Promise(r => setTimeout(r, 1500)); await s2.ldSend('The property address is: 300 Charlie Ln, Bethesda MD 20814.'); });
  await page.waitForTimeout(4000);
  const wsc = ai.calls.find(c => c.stream);
  ok(rs.calls.length === 0 && wsc && !wsc.system.includes('RESEARCH FOR THE BUYER AVATARS'), 'a listing with saved avatars: no research request and no research block (the avatars already exist)');

  console.log('Research that lands after the agent moved on stays with its own listing');
  reset(); rs.delay = 2500;
  await open(page, A, 'Buyer Avatars');
  await open(page, D, 'Buyer Avatars');
  await page.waitForTimeout(3500);
  const dState = await page.evaluate(() => { const s2 = document.querySelector('#app').__vue_app__._instance.setupState; return { note: s2.lstNotes.avatar_research, fresh: !!s2.lstAvResFresh() }; });
  const aSaved = writes('avatar_research').filter(w => w.p_property_id === A);
  ok(aSaved.length === 1 && JSON.parse(aSaved[0].p_content).address === PROPS[0].address, 'listing A\'s research is saved on listing A');
  ok(!dState.note.includes(PROPS[0].address), 'and never appears on listing D', dState);
  rs.delay = 0;
  reset();

  console.log('The campaign uses the saved avatars instead of inventing new ones');
  const SECTION = '---SECTION: SOCIAL MEDIA COPY---\n' + 'A social media post of real length that the model wrote for this property. '.repeat(4);
  await open(page, C, null);
  ai.calls = []; ai.answers = [SECTION]; sent.length = 0;
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.campSections.buyerAvatars = true; await st.lstGenerateCampaignInApp(); });
  await page.waitForTimeout(1200);
  ok(ai.calls.length === 1 && !/SECTION: BUYER AVATARS/.test(ai.calls[0].prompt), 'the AI is not asked to write buyer avatars');
  const cs = await page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__._instance.setupState.campParsed)));
  ok(cs.length && cs[0].title === 'Buyer Avatars' && cs[0].content === SAVED_V2, 'the campaign\'s first section is the saved avatars, word for word', cs.map(x => x.title));
  const cw = writes('campaign_sections');
  ok(cw.length >= 1 && JSON.parse(cw[cw.length - 1].p_content)[0].content === SAVED_V2, 'the campaign was saved with them');
  ai.calls = []; ai.answers = [SECTION];
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.campSections.buyerAvatars = false; await st.lstGenerateCampaignInApp(); });
  await page.waitForTimeout(1200);
  const cs2 = await page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('#app').__vue_app__._instance.setupState.campParsed)));
  ok(!cs2.some(x => /avatar/i.test(x.title)), 'with Buyer Avatars unticked the campaign has none');
  await open(page, B, null);
  ai.calls = []; ai.answers = ['---SECTION: BUYER AVATARS---\n' + labeled('ai') + '\n' + SECTION];
  await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.campSections.buyerAvatars = true; await st.lstGenerateCampaignInApp(); });
  await page.waitForTimeout(1200);
  ok(ai.calls.length === 1 && /SECTION: BUYER AVATARS/.test(ai.calls[0].prompt), 'a listing with no saved avatars still has the AI write them, as before');

  ok(errors.length === 0, 'no JavaScript errors on the page', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\nbuyer avatars test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
