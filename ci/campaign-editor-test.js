#!/usr/bin/env node
/*
 * FORWARD OS: the campaign editor. Run on every pull request.
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
const LONG = (w, n) => Array.from({ length: n }, (_, k) => w + ' paragraph ' + (k + 1) + ': ' + 'The campaign captures the renovation weekly, banks the footage and releases it across the launch window, so every channel has something true to show. '.repeat(3)).join('\n\n');
const PREP = 'SELLER PREP GUIDE (Single Family/Townhome)\n\nCurb Appeal & First Impressions\n- [ ] Power wash the front steps and walkway\n- [ ] Replace the porch light bulbs\n\nInterior\n- [ ] Declutter every surface\n- [ ] Touch up scuffed paint';
const EDITED_PREP = PREP + '\n- [ ] Agent added in the campaign: repaint the front door';
const SOCIAL = { title: 'SOCIAL MEDIA COPY', content: LONG('Social', 2), included: true };
const CAMP_A = [SOCIAL, { title: 'Seller Prep Guide', content: PREP, included: true }, { title: 'CMA Summary', content: 'ESTIMATED VALUE: $1,825,000 Range: $1,588,200 to $2,292,800 with six closed sales nearby and long enough to keep.', included: false }];
const CAMP_B = [SOCIAL, { title: 'Seller Prep Guide', content: EDITED_PREP, included: false }];
const CAMP_C = [SOCIAL, { title: 'CAMPAIGN PLAN', content: LONG('Plan', 24), included: true }];
const NOTE = 'Note for Charlotte and the Chapmans: Every caption below is fully editable. All pricing references are placeholders only.';
const CAMP_D = [{ title: 'SOCIAL MEDIA COPY', content: NOTE + '\n\n' + LONG('Post', 2), included: true }, { title: 'FLYER COPY', content: LONG('Flyer', 2), included: false }, { title: 'CAMPAIGN PLAN', content: LONG('Plan', 2), included: true }];

let notes, hist, hid, mode, sent, ai, rs;
function reset() {
  hid = 0; sent = []; mode = { saveFails: false, campFails: false }; ai = { calls: [], answers: [] }; rs = { calls: [], fail: false, delay: 0 };
  notes = [];
  const add = (p, sf, c) => notes.push({ id: 'n' + notes.length, property_id: p, subfolder: sf, content: c, updated_at: '2026-10-02T00:00:00Z' });
  [A, B, C, D].forEach((p, k) => { add(p, 'mls_data', MLS(PROPS[k].address)); add(p, 'listing_remarks', 'A description of the residence that is saved on the listing.'); });
  add(A, 'campaign_sections', JSON.stringify(CAMP_A)); add(A, 'seller_prep', PREP);
  add(B, 'campaign_sections', JSON.stringify(CAMP_B)); add(B, 'seller_prep', PREP);
  add(C, 'campaign_sections', JSON.stringify(CAMP_C));
  add(D, 'campaign_sections', JSON.stringify(CAMP_D)); add(D, 'seller_prep', PREP);
  hist = [];
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
    const answer = () => rs.fail ? J(route, 502, { detail: 'made-up research outage' }) : J(route, 502, { detail: 'no research in this test' });
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
  await page.setViewportSize({ width: 1280, height: 800 });
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

  const st = (f, a) => page.evaluate(f, a);
  const openPanel = async (id) => { await open(page, id, null); await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campOpenPreview()); await page.waitForTimeout(1200); };
  // Card titles in the open Campaign Package panel: leaf elements whose whole text is a title.
  const cards = () => st(() => { const panel = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim().startsWith('Campaign Package') && d.querySelector('textarea, input[type=checkbox]')); if (!panel) return ['NO PANEL']; return Array.from(panel.querySelectorAll('div')).filter(d => d.childElementCount === 0 && /^(seller prep guide|social media copy|cma summary|campaign plan|letter to seller|listing description)$/i.test(d.textContent.trim())).map(d => d.textContent.trim()); });

  console.log('The Seller Prep Guide shows once: the panel\'s own card');
  await openPanel(A);
  const c1 = await cards();
  ok(c1.filter(t => /seller prep/i.test(t)).length === 1, 'one Seller Prep card', c1);
  const parsedA = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campParsed.map(x => x.title));
  ok(!parsedA.some(t => /prep/i.test(t)) && parsedA.includes('SOCIAL MEDIA COPY') && parsedA.includes('CMA Summary'), 'the copy is gone from the sections, the others stay', parsedA);
  await page.waitForTimeout(1500);
  const secSaves = writes('campaign_sections');
  ok(secSaves.length >= 1 && !JSON.parse(secSaves[secSaves.length - 1].p_content).some(x => /prep/i.test(x.title)), 'the campaign is saved without the copy');
  ok(writes('seller_prep').length === 0, 'an unedited copy changes nothing on the listing\'s guide');

  console.log('An edited copy is kept: it becomes the card\'s text, never lost');
  sent.length = 0;
  await openPanel(B);
  const prepB = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campPrepEditVal);
  ok(prepB === EDITED_PREP, 'the edited words are in the Seller Prep card', prepB.slice(0, 80));
  await page.waitForTimeout(1500);
  const ps = writes('seller_prep');
  ok(ps.length === 1 && ps[0].p_property_id === B && ps[0].p_content === EDITED_PREP, 'and saved as the listing\'s guide (the earlier one stays in Previous versions)');
  ok(await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campPrepIncluded) === false, 'an unticked copy leaves the card unticked');

  console.log('A new campaign does not copy the guide in as a section');
  ai.calls = []; ai.answers = ['---SECTION: SOCIAL MEDIA COPY---\n' + 'A social media post of real length that the model wrote for this property. '.repeat(4)];
  await open(page, A, null);
  await st(async () => { const s2 = document.querySelector('#app').__vue_app__._instance.setupState; s2.campIncludes.seller_prep = true; s2.campSections.buyerAvatars = false; await s2.lstGenerateCampaignInApp(); });
  await page.waitForTimeout(1200);
  const gen = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campParsed.map(x => x.title));
  ok(gen.length && !gen.some(t => /prep/i.test(t)), 'no Seller Prep section in the generated campaign', gen);

  console.log('Typing and clicking in a section never moves the panel');
  await openPanel(C);
  const idx = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campParsed.findIndex(x => x.title === 'CAMPAIGN PLAN'));
  await st((i) => { document.querySelector('#app').__vue_app__._instance.setupState.campOpenSection = i; }, idx);
  await page.waitForTimeout(600);
  const geo = () => st(() => {
    const ta = document.querySelector('textarea.camp-section-ta'); let sc = ta.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    const r = ta.getBoundingClientRect();
    return { top: Math.round(r.top), scroll: sc ? Math.round(sc.scrollTop) : -1, inner: ta.scrollHeight - ta.clientHeight, taH: Math.round(r.height), caret: ta.selectionStart };
  });
  ok((await geo()).inner <= 2, 'the open box fits its text (no scrolling inside it)', await geo());
  // scroll the panel so the middle of the box is on screen, then click there
  await st(() => { const ta = document.querySelector('textarea.camp-section-ta'); let sc = ta.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement; sc.scrollTop = sc.scrollTop + ta.getBoundingClientRect().top - 120 + Math.round(ta.getBoundingClientRect().height / 2); });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const r = document.querySelector('textarea.camp-section-ta').getBoundingClientRect(); return { x: r.left + 200, y: 300 }; });
  const g0 = await geo();
  await page.mouse.click(box.x, box.y); await page.waitForTimeout(300);
  const g1 = await geo();
  ok(Math.abs(g1.top - g0.top) <= 1 && Math.abs(g1.scroll - g0.scroll) <= 1, 'a click in the middle of the text moves nothing', [g0, g1]);
  await page.keyboard.type(' typed here');
  await page.waitForTimeout(400);
  const g2 = await geo();
  ok(Math.abs(g2.top - g1.top) <= 1 && Math.abs(g2.scroll - g1.scroll) <= 1, 'typing moves nothing while it saves', [g1, g2]);
  await page.waitForTimeout(3500);
  const g3 = await geo();
  ok(Math.abs(g3.top - g1.top) <= 1 && Math.abs(g3.scroll - g1.scroll) <= 1, 'nor when the Saved note goes away', [g1, g3]);
  const typed = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campParsed.find(x => x.title === 'CAMPAIGN PLAN').content);
  ok(typed.includes(' typed here') && !typed.startsWith(' typed here'), 'the words went where the click put the cursor, not to the top');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('New paragraph.');
  await page.waitForTimeout(500);
  const g4 = await geo();
  ok(Math.abs(g4.top - g1.top) <= 1 && Math.abs(g4.scroll - g1.scroll) <= 1 && g4.inner <= 2 && g4.taH > g1.taH, 'new lines grow the box without moving the place you are typing', [g1, g4]);

  console.log('No notes to the agent or the seller reach the PDF');
  await openPanel(D);
  const warn = await st(() => (document.querySelector('[data-camp="note-warn"]') || {}).innerText || '');
  ok(/note to the agent or the seller/.test(warn) && /Note for Charlotte and the Chapmans/.test(warn), 'the section names the note it holds', warn.slice(0, 160));
  await st(() => { try { localStorage.removeItem('fos_campPkg'); sessionStorage.removeItem('fos_campPkg'); } catch (e) {} });
  const toasts0 = await st(() => document.body.innerText);
  await st(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.campExportPDF(); });
  await page.waitForTimeout(500);
  ok(/The PDF was NOT made: SOCIAL MEDIA COPY has a note/.test(await st(() => document.body.innerText)) && !(await st(() => localStorage.getItem('fos_campPkg'))), 'the PDF step refuses and says which section, and makes nothing');
  sent.length = 0;
  await page.click('[data-camp="note-remove"]'); await page.waitForTimeout(1500);
  const after = await st(() => document.querySelector('#app').__vue_app__._instance.setupState.campParsed[0].content);
  ok(!after.includes('Note for Charlotte') && after === LONG('Post', 2), 'Remove the note takes out only the note; every other word stays');
  ok(writes('campaign_sections').length >= 1 && !writes('campaign_sections').some(w => w.p_content.includes('Note for Charlotte')), 'and the campaign is saved without it');
  ok(!(await st(() => !!document.querySelector('[data-camp="note-warn"]'))), 'the warning goes away');

  console.log('Unticked means not in the PDF');
  await st(() => { const s2 = document.querySelector('#app').__vue_app__._instance.setupState; s2.campPrepIncluded = false; s2.campLdIncluded = false; window.open = function () { return null; }; });
  await st(async () => { await document.querySelector('#app').__vue_app__._instance.setupState.campExportPDF(); });
  await page.waitForTimeout(800);
  const pkg = JSON.parse((await st(() => localStorage.getItem('fos_campPkg'))) || '{}');
  ok(pkg.prep && pkg.prep._skip === true, 'an unticked Seller Prep Guide is marked to stay out');
  ok(pkg.listing && pkg.listing._skip === true, 'an unticked listing description is marked to stay out');
  ok(pkg.flyer && pkg.flyer._skip === true, 'an unticked Flyer Copy section is marked to stay out (no flyer made up from the MLS facts)');
  ok(pkg.campaign && pkg.campaign.phases && pkg.campaign.phases.length > 0, 'a ticked section still goes in');
  const tpl = require('fs').readFileSync(require('path').join(dir, 'campaign-print.html'), 'utf8');
  ok(/<template v-if="!pkg\.prep\._skip && pkg\.prep\.sections && pkg\.prep\.sections\.length">\s*<FwdDivider index="Section Nine"/.test(tpl), 'the print page draws Seller Preparation only with a guide in it (no blank page)');
  ok(/<template v-if="!pkg\.flyer\._skip">\s*<FwdDivider index="Section Seven"/.test(tpl) && /<template v-if="!pkg\.listing\._skip">\s*<FwdDivider index="Section Two"/.test(tpl) && /<template v-if="pkg\.campaign && pkg\.campaign\.phases && pkg\.campaign\.phases\.length">\s*<FwdDivider index="Section Four"/.test(tpl), 'and Flyer, The Residence and the 30-Day Campaign the same way');
  ok(/\.fwd-social-card \{[^}]*break-inside: avoid;[^}]*\}/.test(tpl) && /\.fwd-social-card__head \{ break-after: avoid;/.test(tpl), 'a social card stays on one page when it fits, and its heading never sits alone at the bottom of a page');
  const camp = await st(() => document.querySelector('#app').__vue_app__._instance.setupState);
  ok(/Never write a note, comment or instruction to the agent, the seller or anyone else/.test(require('fs').readFileSync(require('path').join(dir, 'index.html'), 'utf8')), 'the campaign writer is told never to write notes');

  ok(errors.length === 0, 'no JavaScript errors on the page', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\ncampaign editor test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
