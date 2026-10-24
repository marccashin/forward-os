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

let notes, hist, hid, mode, sent, ai;
function reset() {
  hid = 0; sent = []; mode = { saveFails: false, campFails: false }; ai = { calls: [], answers: [] };
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
