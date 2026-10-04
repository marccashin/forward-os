#!/usr/bin/env node
/*
 * FORWARD OS: the CMA Builder (cma-tool.html). Run on every pull request.
 *
 * Until Oct 3, 2026 the builder was only checked for loading. This opens the real
 * cma-tool.html (and the real index.html for the way back) in headless Chromium
 * against a made-up cma_sessions table and checks three things.
 *
 * WHICH SAVED CMA OPENS
 *   - the newest draft for the listing opens, whoever saved it;
 *   - an empty draft never beats one with properties in it (Charlotte's blank
 *     draft on 4202 Woodland Dr hid Marc's six comps from her);
 *   - the CMA carries the name of the agent whose listing it is, whoever is signed in;
 *   - changes still save under the agent's own name, never over a teammate's row;
 *   - a failed load still blocks every save (the Sept 22 wipe guard).
 *
 * REVIEW HIGHLIGHTS
 *   - the number in the banner equals the number of orange boxes on the page;
 *   - clicking an orange box, or changing it, turns it green, then clears it;
 *   - what was reviewed is saved with the draft and stays clear after a reload;
 *   - reviewing a box changes no value and no adjusted price.
 *
 * COMP FEES (HOA and condo fee)
 *   - an imported comp gets its monthly fee from the MLS sheet: HOA fee plus condo
 *     fee, the same sum the subject uses. Until Oct 4, 2026 a comp took the HOA fee
 *     only, so every condo comp came in blank and counted as $0, and the subject's
 *     whole fee times the multiplier was added to each comp (+$86,500 on all three
 *     comps of 601 Pennsylvania Ave NW #1103N);
 *   - a closed sale whose fee is still blank, when the subject has one, is orange
 *     until the agent types the fee or clicks the box. That covers comps typed by
 *     hand and CMAs saved before the fix.
 *
 * BACK TO LISTING
 *   - with the FORWARD OS tab still open: that tab is told which listing to show
 *     and the builder closes;
 *   - without it: the builder opens FORWARD OS at /?listing=<id>, and FORWARD OS
 *     opens that listing, for the agents allowed to see it.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/cma-builder-test.js <dir-with-cma-tool.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');

const SUPA = 'https://mock-project.supabase.co';
const LISTING = '4202 Woodland Dr Fairfax, VA';
const STREET = '4202 Woodland Dr Fairfax';
const PROP_ID = '11111111-2222-4333-8444-555555555555';
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// ── the made-up cloud ──
let table = [];        // cma_sessions rows
let writes = [];       // every write the page attempted
let loadFails = false; // cma_sessions reads answer 500
let properties = [];   // rows of the properties table (for the way back)
let parseResults = []; // what the MLS sheet reader answers

function inList(u) {
  const m = /property_address=in\.([^&]+)/.exec(u);
  if (!m) return null;
  return [...decodeURIComponent(m[1]).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\(.)/g, '$1'));
}
const eq = (u, col) => { const m = new RegExp('[?&]' + col + '=eq\\.([^&]*)').exec(u); return m ? decodeURIComponent(m[1]) : null; };
function match(u) {
  const list = inList(u), agent = eq(u, 'agent_name'), addr = eq(u, 'property_address');
  return table.filter((r) => (!list || list.includes(r.property_address)) && (agent === null || r.agent_name === agent) && (addr === null || r.property_address === addr));
}
function api(route) {
  const req = route.request(), u = req.url(), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'POST' && /\/api\/cma\/parse-listings/.test(u)) return J(route, 200, { success: true, results: parseResults });
  if (/\/rest\/v1\/cma_sessions/.test(u)) {
    if (m === 'GET') {
      if (loadFails) return J(route, 500, { message: 'mock outage' });
      let rows = match(u).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      const lim = /[?&]limit=(\d+)/.exec(u); if (lim) rows = rows.slice(0, +lim[1]);
      return J(route, 200, rows);
    }
    let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (e) {}
    writes.push({ m, u, body });
    if (m === 'POST') { table.push(Object.assign({ id: 'new-' + table.length }, body)); return J(route, 201, []); }
    if (m === 'PATCH') { match(u).forEach((r) => Object.assign(r, body)); return J(route, 204, []); }
    if (m === 'DELETE') { const gone = match(u); table = table.filter((r) => !gone.includes(r)); return J(route, 204, []); }
  }
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) {
    const id = eq(u, 'id');
    return J(route, 200, id ? properties.filter((p) => p.id === id) : properties);
  }
  if (m === 'GET') return J(route, 200, []);
  writes.push({ m, u });
  return J(route, 200, []);
}

let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : '')); } }

// ── test data ──
const comp = (address, extra) => Object.assign({ address, soldDate: '2026-08-01', salePrice: 700000, gla: 2000, lotSize: '', beds: 4, fullBaths: 2, halfBaths: 1, below: 0, garageSpaces: 2, drivewaySpaces: '', condition: 'C', hoaMonthly: 0, concessions: 0, proximity: '0.4 mi', dom: 9 }, extra || {});
const subject = (agentName) => ({ address: STREET, city: 'Fairfax', state: 'VA', zip: '22030', propType: 'Single Family', beds: '4', fullBaths: '2', halfBaths: '1', gla: '2100', below: '0', yearBuilt: '1985', condition: 'B', parkingType: 'Attached Garage', parkingSpaces: '2', agentName, notes: '' });
const draft = (agentName, comps, more) => Object.assign({ subject: subject(agentName), comps, activeComps: [], pendingComps: [], adjustments: {}, agentNotes: '' }, more || {});
const row = (agent, key, when, d) => ({ id: agent + '|' + key, agent_name: agent, property_address: key, updated_at: when, prefill_data: { address: STREET, agentName: agent, sessionKey: LISTING }, draft_data: d });

(async () => {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    if (p === '/opener.html') {
      // Stands in for the FORWARD OS tab: opens the builder the way openCMABuilder does, and records what it is told.
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>opener</title><script>window.__msgs=[];window.addEventListener("message",function(e){window.__msgs.push({origin:e.origin,data:e.data});});function openBuilder(){window.__child=window.open("/cma-tool.html","_blank");}</script>');
    }
    const f = path.join(dir, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];

  async function context(agent, prefill) {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      if (/jspdf/i.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    await ctx.addInitScript(([a, pf, supa, listing]) => {
      if (a) localStorage.setItem('fos_agent', a);
      localStorage.setItem('fos_supa_url', supa);
      localStorage.setItem('fos_supa_key', 'test-anon-key');
      if (pf) { localStorage.setItem('cma_voice_prefill', JSON.stringify(pf)); localStorage.setItem('fos_cma_address', listing); }
      window.__toasts = [];
      new MutationObserver((muts) => muts.forEach((mu) => mu.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.style && n.style.position === 'fixed' && n.textContent) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true });
    }, [agent, prefill, SUPA, LISTING]);
    return ctx;
  }
  // What openCMABuilder writes. The listing here is Charlotte's, whoever is signed in.
const PREFILL = (agent, extra) => Object.assign({ address: STREET, city: 'VA', state: '', zip: '', agentName: 'Charlotte Lee', listingAgent: 'Charlotte Lee', propId: PROP_ID, sessionKey: LISTING }, extra || {});
  async function builder(agent, prefill) {
    const ctx = await context(agent, prefill === undefined ? PREFILL(agent) : prefill);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await page.goto(origin + '/cma-tool.html', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    return page;
  }
  // Top-level `let` variables of the page are reachable by bare name, not as window properties.
  const state = (page) => page.evaluate(() => ({
    comps: comps.map((c) => c.address), n: comps.length,
    agentName: document.getElementById('s_agentName').value,
    notes: document.getElementById('agentNotes').value,
    toasts: window.__toasts.join(' || '),
  }));

  // ════════════════ WHICH SAVED CMA OPENS ════════════════
  console.log('Which saved CMA opens');
  const six = ['1 A St', '2 B St', '3 C St', '4 D St', '5 E St', '6 F St'].map((a) => comp(a));

  table = [row('Charlotte Lee', LISTING, '2026-09-30T14:31:00Z', draft('Charlotte Lee', [])),
           row('Marc Cashin', STREET, '2026-09-23T01:43:00Z', draft('Marc Cashin', six))];
  writes = [];
  let page = await builder('Charlotte Lee');
  let s = await state(page);
  ok(s.n === 6, 'her own draft is empty and newer, his has six comps and is older: his opens', s);
  ok(/Marc Cashin/.test(s.toasts), 'the message says whose version opened', s.toasts);
  ok(s.agentName === 'Charlotte Lee', 'the agent name on the CMA is hers (her listing), not his', s.agentName);
  await page.waitForTimeout(2600);
  ok(writes.length === 0, 'opening a teammate\'s version writes nothing by itself', writes.map((w) => w.m));
  await page.evaluate(() => { const el = document.getElementById('agentNotes'); el.value = 'Charlotte was here'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2800);
  const mine = table.find((r) => r.agent_name === 'Charlotte Lee'), his = table.find((r) => r.agent_name === 'Marc Cashin');
  ok(mine && mine.draft_data.agentNotes === 'Charlotte was here' && mine.draft_data.comps.length === 6, 'her change saves under her own name, with the six comps');
  ok(his && his.draft_data.agentNotes === '' && his.property_address === STREET, 'his saved version is not touched');
  ok(table.length === 2, 'no extra row was created', table.length);
  await page.context().close();

  table = [row('Charlotte Lee', LISTING, '2026-10-01T10:00:00Z', draft('Charlotte Lee', [comp('HERS 1')])),
           row('Marc Cashin', LISTING, '2026-10-02T10:00:00Z', draft('Marc Cashin', [comp('HIS 1'), comp('HIS 2')]))];
  page = await builder('Charlotte Lee'); s = await state(page);
  ok(s.n === 2 && s.comps[0] === 'HIS 1', 'both have comps, his is newer: his opens', s.comps);
  await page.context().close();

  table = [row('Charlotte Lee', LISTING, '2026-10-03T10:00:00Z', draft('Charlotte Lee', [comp('HERS 1')])),
           row('Marc Cashin', LISTING, '2026-10-02T10:00:00Z', draft('Marc Cashin', [comp('HIS 1'), comp('HIS 2')]))];
  page = await builder('Charlotte Lee'); s = await state(page);
  ok(s.n === 1 && s.comps[0] === 'HERS 1', 'both have comps, hers is newer: hers opens', s.comps);
  ok(/Loaded your saved CMA/.test(s.toasts) && !/Marc Cashin/.test(s.toasts), 'the message says it is her own', s.toasts);
  await page.context().close();

  // Marc signed in, working inside Charlotte's deal card.
  table = [row('Marc Cashin', LISTING, '2026-10-03T10:00:00Z', draft('Marc Cashin', [comp('HIS 1')]))];
  writes = [];
  page = await builder('Marc Cashin'); s = await state(page);
  ok(s.n === 1 && s.agentName === 'Charlotte Lee', 'Marc in her deal card, his own saved draft says Marc: the CMA still names Charlotte', s.agentName);
  await page.evaluate(() => { const el = document.getElementById('agentNotes'); el.value = 'Marc helping'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2800);
  ok(table.length === 1 && table[0].agent_name === 'Marc Cashin' && table[0].draft_data.subject.agentName === 'Charlotte Lee', 'his work saves under his login, with her name on the CMA', [table.length, table[0].agent_name, table[0].draft_data.subject.agentName]);
  await page.context().close();
  table = [];
  page = await builder('Marc Cashin'); s = await state(page);
  ok(s.agentName === 'Charlotte Lee', 'a brand new CMA on her listing started by Marc names Charlotte', s.agentName);
  await page.context().close();
  // Not opened from a listing (no listing agent): unchanged behaviour.
  table = [row('Marc Cashin', STREET, '2026-10-03T10:00:00Z', draft('Marc Cashin', [comp('HIS 1')]))];
  page = await builder('Niki Lang', { address: STREET, agentName: 'Niki Lang' }); s = await state(page);
  ok(s.n === 1 && s.agentName === 'Niki Lang', 'a CMA not opened from a listing: a teammate\'s draft takes the name of who has it open', s.agentName);
  await page.context().close();

  table = [row('Marc Cashin', LISTING, '2026-10-02T10:00:00Z', draft('Marc Cashin', [], { agentNotes: 'his notes' })),
           row('Charlotte Lee', LISTING, '2026-10-01T10:00:00Z', draft('Charlotte Lee', [], { agentNotes: 'her notes' }))];
  page = await builder('Charlotte Lee'); s = await state(page);
  ok(s.notes === 'her notes', 'nobody has comps: her own draft opens, not a teammate\'s newer empty one', s.notes);
  await page.context().close();

  table = [row('Marc Cashin', LISTING, '2026-10-02T10:00:00Z', draft('Marc Cashin', [comp('', { salePrice: '', gla: '' })])),
           row('Charlotte Lee', LISTING, '2026-10-01T10:00:00Z', draft('Charlotte Lee', [comp('HERS 1')]))];
  page = await builder('Charlotte Lee'); s = await state(page);
  ok(s.comps[0] === 'HERS 1', 'a newer draft holding only a blank row counts as empty', s.comps);
  await page.context().close();

  table = [row('Charlotte Lee', LISTING, '2026-10-01T10:00:00Z', draft('Charlotte Lee', six))];
  loadFails = true; writes = [];
  page = await builder('Charlotte Lee');
  await page.evaluate(() => { const el = document.getElementById('agentNotes'); el.value = 'typed after a failed load'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2800);
  s = await state(page);
  ok(/Could not load your saved CMA/.test(s.toasts), 'a failed load is shown', s.toasts);
  ok(writes.length === 0 && table[0].draft_data.comps.length === 6, 'and nothing is saved over the draft that could not be read', writes.map((w) => w.m));
  loadFails = false;
  await page.context().close();

  // ════════════════ REVIEW HIGHLIGHTS ════════════════
  console.log('Review highlights');
  const flagged = () => [
    comp('10 Imported Ln', { _src: { address: 'mls', salePrice: 'mls', gla: 'check', fullBaths: 'check', condition: 'needs', proximity: 'mls' } }),
    comp('11 Imported Ln', { condition: 'A', _src: { address: 'mls', gla: 'mls', condition: 'needs' } }),
    comp('12 Typed By Hand Rd'),
    comp('', { salePrice: '', gla: '' }),
  ];
  table = [row('Charlotte Lee', LISTING, '2026-10-03T10:00:00Z', draft('Charlotte Lee', flagged(), { subjectFlags: { s_gla: 'check', s_condition: 'needs', s_beds: 'mls' } }))];
  writes = [];
  page = await builder('Charlotte Lee');
  const hl = (page) => page.evaluate(() => {
    const cell = (r, label) => { const td = document.querySelector('#comp-row-' + r + ' td[data-label="' + label + '"]'); return td ? ['f-needs', 'f-check', 'f-mls', 'f-ok'].filter((c) => td.classList.contains(c)).join(',') : 'NO CELL'; };
    const sub = (id) => { const w = document.getElementById(id).closest('.field'); return ['f-needs', 'f-check', 'f-mls', 'f-ok'].filter((c) => w.classList.contains(c)).join(','); };
    const b = document.getElementById('needsBanner');
    const m = /(\d+) field/.exec(b.textContent || '');
    return {
      cond0: cell(0, 'Condition'), gla0: cell(0, 'Sq Ft'), bd0: cell(0, 'Bd / Fb / Hb'), addr0: cell(0, 'Address'),
      cond1: cell(1, 'Condition'), cond2: cell(2, 'Condition'), cond3: cell(3, 'Condition'),
      sGla: sub('s_gla'), sCond: sub('s_condition'), sBeds: sub('s_beds'),
      orange: document.querySelectorAll('.f-needs, .f-check').length,
      count: b.style.display === 'none' ? 0 : (m ? +m[1] : -1),
      bannerShown: b.style.display !== 'none',
      reviewedText: document.querySelectorAll('.fieldflag.ok').length,
    };
  });
  const money = (page) => page.evaluate(() => JSON.stringify({ adj: comps.map((c) => c._adj), vals: comps.map((c) => [c.condition, c.gla, c.salePrice, c.fullBaths]), sum: _buildCmaSummary(), cells: [0, 1, 2].map((i) => document.getElementById('c' + i + '_adjPrice').textContent) }));
  let h = await hl(page);
  const before = await money(page);
  ok(h.cond0 === 'f-needs' && h.gla0 === 'f-check' && h.addr0 === 'f-mls', 'an imported comp shows Condition and the unsure Sq Ft in orange, MLS values in blue', h);
  ok(h.bd0 === 'f-check', 'a flag on full baths shows on the Bd / Fb / Hb box (it was counted but never shown)', h.bd0);
  ok(h.cond1 === '', 'a Condition already moved off C is not flagged', h.cond1);
  ok(h.cond2 === 'f-needs', 'Condition is flagged on a comp typed in by hand too', h.cond2);
  ok(h.cond3 === '', 'a blank row is not flagged', h.cond3);
  ok(h.sGla === 'f-check' && h.sCond === 'f-needs' && h.sBeds === 'f-mls', 'the subject\'s flags come back from the saved draft', [h.sGla, h.sCond, h.sBeds]);
  ok(h.count === h.orange && h.count === 6, 'the number in the banner equals the orange boxes on the page (6)', [h.count, h.orange]);

  await page.click('#comp-row-0 td[data-label="Condition"] select');
  h = await hl(page);
  ok(h.cond0 === 'f-ok' && h.reviewedText === 1, 'clicking Condition turns the box green and says REVIEWED', h.cond0);
  ok(h.count === 5 && h.count === h.orange, 'the count drops by one at once', [h.count, h.orange]);
  await page.waitForTimeout(1900);
  h = await hl(page);
  ok(h.cond0 === '' && h.reviewedText === 0, 'then the highlight clears by itself', h.cond0);
  ok((await money(page)) === before, 'reviewing a box changed no value, no adjusted price and no summary');

  await page.fill('#comp-row-0 td[data-label="Sq Ft"] input', '2050');
  h = await hl(page);
  ok(h.gla0 === 'f-ok', 'correcting the flagged Sq Ft turns it green', h.gla0);
  await page.waitForTimeout(1900);
  h = await hl(page);
  ok(h.gla0 === '' && (await page.evaluate(() => comps[0].gla)) === 2050, 'and it clears, with the new value kept', h.gla0);

  await page.selectOption('#comp-row-1 td[data-label="Condition"] select', 'C');
  await page.evaluate(() => { buildCompsTable(); recalcAll(); });
  await page.waitForTimeout(150);
  h = await hl(page);
  ok(h.cond1 === '' && (await page.evaluate(() => comps[1].condition)) === 'C', 'a Condition changed back to C by the agent is not flagged again', h.cond1);
  ok(h.cond0 === '' && h.gla0 === '', 'reviewed boxes stay clear when the table is redrawn', [h.cond0, h.gla0]);
  ok(h.count === h.orange, 'the count still equals the orange boxes', [h.count, h.orange]);

  await page.click('#s_condition');
  h = await hl(page);
  ok(h.sCond === 'f-ok', 'clicking the subject\'s Condition turns it green', h.sCond);

  await page.waitForTimeout(2800);
  const saved = table[0].draft_data;
  ok(saved.comps[0]._rev && saved.comps[0]._rev.condition === true && saved.comps[0]._rev.gla === true, 'what was reviewed is saved with the draft', saved.comps[0]._rev);
  ok(saved.subjectFlags && !('s_condition' in saved.subjectFlags) && saved.subjectFlags.s_gla === 'check', 'so are the subject flags still open', saved.subjectFlags);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  h = await hl(page);
  ok(h.cond0 === '' && h.gla0 === '' && h.sCond === '', 'after a reload the reviewed boxes are still clear', [h.cond0, h.gla0, h.sCond]);
  ok(h.bd0 === 'f-check' && h.sGla === 'f-check' && h.count === h.orange && h.count === 3, 'and the ones not yet reviewed are still orange (3)', [h.bd0, h.sGla, h.count, h.orange]);

  await page.click('#comp-row-0 td[data-label="Bd / Fb / Hb"] input');
  await page.click('#comp-row-2 td[data-label="Condition"] select');
  await page.click('#s_gla');
  h = await hl(page);
  ok(h.count === 0 && !h.bannerShown, 'when every box has been reviewed the notice goes away', [h.count, h.orange]);
  await page.context().close();

  // ════════════════ COMP FEES ════════════════
  console.log('Comp fees (HOA and condo fee)');
  const fees = (page) => page.evaluate(() => {
    const cls = (td) => (td ? ['f-needs', 'f-check', 'f-mls', 'f-ok'].filter((c) => td.classList.contains(c)).join(',') : 'NO CELL');
    const b = document.getElementById('needsBanner');
    const m = /(\d+) field/.exec(b.textContent || '');
    return {
      hoa: comps.map((c, i) => cls(document.querySelector('#comp-row-' + i + ' td[data-label="HOA/Mo"]'))),
      active: Array.prototype.map.call(document.querySelectorAll('#activeBody tr'), (tr) => cls(tr.querySelector('td[data-label="HOA/Mo"]'))),
      vals: comps.map((c) => c.hoaMonthly),
      activeVals: activeComps.map((c) => c.hoaMonthly),
      adj: comps.map((c) => (c._adj ? c._adj.hoa : null)),
      orange: document.querySelectorAll('.f-needs, .f-check').length,
      count: b.style.display === 'none' ? 0 : (m ? +m[1] : -1),
    };
  });
  const condo = (agentName, comps, active) => Object.assign(draft(agentName, comps), { subject: Object.assign(subject(agentName), { propType: 'Condo', hoaMonthly: '', condoFee: '865' }), activeComps: active || [] });
  const blankFee = (a) => comp(a, { hoaMonthly: '', condition: 'A' });

  // A CMA saved before the fix: the subject has a condo fee, the three comps have none.
  table = [row('Charlotte Lee', LISTING, '2026-10-03T10:00:00Z', condo('Charlotte Lee', [blankFee('601 Penn #612'), blankFee('601 Penn #100'), blankFee('601 Penn #111')],
    [{ address: '9 Active St', date: '2026-09-01', listPrice: 500000, gla: 800, lotSize: '', beds: 1, fullBaths: 1, halfBaths: 0, below: 0, garageSpaces: 0, condition: 'A', hoaMonthly: '', proximity: '0.1 mi', dom: 5 }]))];
  writes = [];
  page = await builder('Charlotte Lee');
  let f = await fees(page);
  ok(f.hoa.join('|') === 'f-needs|f-needs|f-needs', 'a saved CMA whose subject has a fee and whose comps have none shows HOA/Mo in orange on every closed sale', f.hoa);
  ok(f.adj.every((a) => a === 86500), 'that is the case where the subject\'s whole fee lands on each comp (865 x 100)', f.adj);
  ok(f.active.join('|') === '', 'an active listing is not flagged: it is not adjusted', f.active);
  ok(f.count === f.orange && f.count === 3, 'the number in the banner equals the orange boxes (3)', [f.count, f.orange]);

  const feeMoney = (page) => page.evaluate(() => JSON.stringify({ adj: comps.map((c) => c._adj), vals: comps.map((c) => c.hoaMonthly) }));
  const feeBefore = await feeMoney(page);
  await page.click('#comp-row-0 td[data-label="HOA/Mo"] input');
  f = await fees(page);
  ok(f.hoa[0] === 'f-ok' && f.count === 2, 'clicking the box (this comp really has no fee) marks it reviewed', [f.hoa[0], f.count]);
  ok((await feeMoney(page)) === feeBefore, 'and changes no value and no adjustment');
  await page.fill('#comp-row-1 td[data-label="HOA/Mo"] input', '917');
  await page.waitForTimeout(1900);
  f = await fees(page);
  ok(f.vals[1] === 917 && f.hoa[1] === '' && Math.abs(f.adj[1]) === 5200, 'typing the comp\'s fee clears the box and the adjustment is the difference, not the whole fee', [f.vals[1], f.hoa[1], f.adj[1]]);
  ok(f.hoa[0] === '' && f.hoa[2] === 'f-needs' && f.count === f.orange && f.count === 1, 'the one not looked at yet is still orange', [f.hoa, f.count, f.orange]);

  await page.fill('#s_condoFee', '');
  await page.waitForTimeout(150);
  f = await fees(page);
  ok(f.hoa[2] === '' && f.count === 0, 'with no fee on the subject a blank comp fee is not flagged (nothing is added)', [f.hoa, f.count, f.adj[2]]);
  await page.fill('#s_condoFee', '865');
  await page.waitForTimeout(150);
  f = await fees(page);
  ok(f.hoa[2] === 'f-needs' && f.hoa[0] === '' && f.hoa[1] === '', 'typing the subject\'s fee flags the blank comp at once, and not the ones already reviewed', f.hoa);
  await page.waitForTimeout(2800);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  f = await fees(page);
  ok(f.hoa.join('|') === '||f-needs' && f.count === f.orange && f.count === 1, 'after a reload the reviewed boxes stay clear and the open one stays orange', [f.hoa, f.count, f.orange]);
  await page.context().close();

  // Importing MLS sheets.
  table = []; writes = [];
  const sheet = (address, status, extra) => Object.assign({ ok: true, file: 'sheets.pdf', status, status_raw: status, address, city: 'Washington', state: 'DC', zip: '20004', propType: 'Condo', beds: '1', fullBaths: '1', halfBaths: '0', gla: '861', below: '', lotSize: '', yearBuilt: '1991', garageSpaces: '0', drivewaySpaces: '0', hoaMonthly: '', condoFee: '', listPrice: '500000', salePrice: status === 'closed' ? '500000' : '', soldDate: status === 'closed' ? '2026-09-10' : '', listDate: '2026-08-01', dom: '14', concessions: '0', flags: {} }, extra || {});
  parseResults = [
    sheet('601 Penn #612', 'closed', { condoFee: '917' }),
    sheet('20 House Ln', 'closed', { hoaMonthly: '300' }),
    sheet('30 Both Ct', 'closed', { hoaMonthly: '50', condoFee: '700' }),
    sheet('40 Nothing Printed Rd', 'closed'),
    sheet('50 Printed Zero Way', 'closed', { hoaMonthly: '0' }),
    sheet('60 Active Condo St', 'active', { condoFee: '640' }),
  ];
  page = await builder('Charlotte Lee');
  await page.fill('#s_condoFee', '865');
  const doImport = async () => {
    await page.evaluate(() => cmaUploadPDFs([new File(['x'], 'sheets.pdf', { type: 'application/pdf' })]));
    await page.waitForFunction(() => document.getElementById('cmaImportModal').style.display === 'flex', null, { timeout: 5000 });
    await page.evaluate(() => cmaApplyImport());
    await page.waitForTimeout(400);
  };
  await doImport();
  f = await fees(page);
  ok(f.vals[0] === '917', 'a condo comp gets its condo fee from the sheet (it came in blank before)', f.vals);
  ok(f.vals[1] === '300', 'a comp with an HOA fee still gets it', f.vals);
  ok(f.vals[2] === '750', 'a comp with both gets the two added, as the subject does', f.vals);
  ok(f.vals[4] === '0' && f.hoa[4] === 'f-mls', 'a fee printed as 0 comes in as 0, in blue, not flagged', [f.vals[4], f.hoa[4]]);
  ok(f.activeVals[0] === '640', 'active listings get the fee too', f.activeVals);
  ok(f.hoa[0] === 'f-mls' && f.hoa[1] === 'f-mls' && f.hoa[2] === 'f-mls', 'fees read from the sheet show in blue', f.hoa);
  ok(Math.abs(f.adj[0]) === 5200 && Math.abs(f.adj[1]) === 56500 && Math.abs(f.adj[2]) === 11500, 'each adjustment is the difference from the subject\'s fee', f.adj);
  ok(f.vals[3] === '' && f.hoa[3] === 'f-needs', 'a sheet that prints no fee leaves the box blank and orange', [f.vals[3], f.hoa[3]]);
  ok(f.count === f.orange, 'the number in the banner equals the orange boxes', [f.count, f.orange]);
  await page.fill('#comp-row-3 td[data-label="HOA/Mo"] input', '700');
  await doImport();
  f = await fees(page);
  ok(f.vals.length === 5 && String(f.vals[3]) === '700' && f.hoa[3] !== 'f-needs', 'reading the same sheets again keeps the fee the agent typed and adds no duplicate', [f.vals, f.hoa[3]]);
  ok(errors.length === 0, 'no script errors', errors);
  await page.context().close();
  parseResults = [];

  // ════════════════ BACK TO LISTING ════════════════
  console.log('Back to Listing');
  table = []; writes = [];
  let ctx = await context('Charlotte Lee', PREFILL('Charlotte Lee'));
  const opener = await ctx.newPage();
  await opener.goto(origin + '/opener.html', { waitUntil: 'load' });
  let [child] = await Promise.all([ctx.waitForEvent('page'), opener.evaluate(() => openBuilder())]);
  child.on('dialog', (d) => d.accept().catch(() => {}));
  await child.waitForLoadState('load'); await child.waitForTimeout(600);
  const closed = new Promise((r) => child.on('close', () => r(true)));
  await child.click('text=Back to Listing').catch(() => {});
  const didClose = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 3000))]);
  // The message is delivered on the opener's next turn, which can be after the builder has closed.
  await opener.waitForFunction(() => window.__msgs.length > 0, null, { timeout: 3000 }).catch(() => {});
  const msgs = await opener.evaluate(() => window.__msgs);
  ok(didClose, 'with the FORWARD OS tab still open, Back closes the builder');
  ok(msgs.length === 1 && msgs[0].data && msgs[0].data.type === 'fos-open-listing' && msgs[0].data.id === PROP_ID && msgs[0].origin === origin, 'and tells that tab which listing to show', msgs);
  await ctx.close();

  page = await builder('Charlotte Lee');
  // FORWARD OS removes ?listing= from the address bar once it has read it, so watch the request itself.
  const [nav] = await Promise.all([page.waitForRequest((r) => r.isNavigationRequest() && !/cma-tool/.test(r.url()), { timeout: 5000 }).catch(() => null), page.click('text=Back to Listing')]);
  ok(!!nav && nav.url() === origin + '/?listing=' + PROP_ID, 'with no FORWARD OS tab, Back opens FORWARD OS on that listing', nav && nav.url().replace(origin, ''));
  await page.context().close();

  page = await builder('Charlotte Lee', PREFILL('Charlotte Lee', { propId: '' }));
  await Promise.all([page.waitForURL((u) => !/cma-tool/.test(String(u)), { timeout: 5000 }).catch(() => {}), page.click('text=Back to Listing')]);
  ok(page.url() === origin + '/', 'a CMA not opened from a listing goes to the front page', page.url().replace(origin, ''));
  await page.context().close();

  // FORWARD OS side: the real index.html opens the listing it is given.
  const prop = (agent, extra) => Object.assign({ id: PROP_ID, address: LISTING, agent_name: agent, market: 'VA', created_at: '2026-09-01T00:00:00Z', subfolder_drive_ids: {} }, extra || {});
  async function os(agent, url) {
    const c = await context(agent, null);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(origin + url, { waitUntil: 'load' }); await p.waitForTimeout(1800);
    return p;
  }
  const osState = (p) => p.evaluate(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    return { view: st.view, active: st.lstActiveProp ? st.lstActiveProp.id : null, url: location.pathname + location.search, text: document.body.innerText };
  });

  properties = [prop('Charlotte Lee')];
  page = await os('Charlotte Lee', '/?listing=' + PROP_ID);
  let o = await osState(page);
  ok(o.view === 'listing-detail' && o.active === PROP_ID, 'FORWARD OS opened with ?listing= shows that listing, not the dashboard', [o.view, o.active]);
  ok(o.url === '/', 'and the address bar is cleaned up', o.url);
  await page.context().close();

  page = await os('Charlotte Lee', '/');
  o = await osState(page);
  ok(o.view === 'dashboard', 'FORWARD OS opened normally still starts on the dashboard', o.view);
  await page.evaluate(([id, org]) => window.postMessage({ type: 'fos-open-listing', id }, org), [PROP_ID, origin]);
  await page.waitForTimeout(900);
  o = await osState(page);
  ok(o.view === 'listing-detail' && o.active === PROP_ID, 'the builder\'s message brings the FORWARD OS tab to the listing', [o.view, o.active]);
  await page.evaluate(() => { document.querySelector('#app').__vue_app__._instance.setupState.lstActiveProp.__marker = 'left as it was'; });
  await page.evaluate(([id, org]) => window.postMessage({ type: 'fos-open-listing', id }, org), [PROP_ID, origin]);
  await page.waitForTimeout(600);
  ok((await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.lstActiveProp.__marker)) === 'left as it was', 'a tab already on that listing is left exactly as it was');
  await page.context().close();

  // Coming back by a full load must not show the sign-in screen while the app starts.
  // The app's own script is held back so the page can be looked at before it has started.
  {
    properties = [prop('Charlotte Lee')];
    const c = await context('Charlotte Lee', null);
    await c.route(/cdnjs.*\/vue\//, async (route) => { await new Promise((r) => setTimeout(r, 1500)); route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE }); });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.goto(origin + '/?listing=' + PROP_ID).catch(() => {});
    await p.waitForFunction(() => !!document.querySelector('#app') && document.querySelector('#app').children.length > 0, null, { timeout: 5000 }).catch(() => {});
    const early = await p.evaluate(() => ({ started: !!document.querySelector('#app').__vue_app__, shown: document.querySelector('#app').innerText.trim().length }));
    ok(!early.started && early.shown === 0, 'before the app has started, nothing is shown: no sign-in screen flash', early);
    await p.waitForTimeout(3200);
    const late = await osState(p);
    ok(late.view === 'listing-detail' && late.text.trim().length > 0, 'once it has started, the listing is shown', late.view);
    await c.close();
  }

  properties = [prop('Ash McGowan')];
  page = await os('Marc Cashin', '/?listing=' + PROP_ID);
  const pf = await page.evaluate(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    let opened = null; window.open = (u) => { opened = u; return null; };
    st.openCMABuilder();
    return { opened, pf: JSON.parse(localStorage.getItem('cma_voice_prefill') || 'null') };
  });
  ok(pf.opened === '/cma-tool.html' && pf.pf && pf.pf.agentName === 'Ashling McGowan' && pf.pf.listingAgent === 'Ashling McGowan' && pf.pf.propId === PROP_ID, 'FORWARD OS hands the builder the listing\'s agent, not the signed-in one (Marc on Ashling\'s listing)', pf.pf && [pf.pf.agentName, pf.pf.listingAgent]);
  await page.context().close();

  properties = [prop('Niki Lang')];
  page = await os('Charlotte Lee', '/?listing=' + PROP_ID);
  o = await osState(page);
  ok(o.view !== 'listing-detail' && o.active !== PROP_ID, 'an agent cannot open another agent\'s listing this way', [o.view, o.active]);
  await page.context().close();
  properties = [prop('Niki Lang', { subfolder_drive_ids: { _co_agents: ['Charlotte Lee'] } })];
  page = await os('Charlotte Lee', '/?listing=' + PROP_ID);
  o = await osState(page);
  ok(o.view === 'listing-detail' && o.active === PROP_ID, 'a co-agent can', [o.view, o.active]);
  await page.context().close();
  properties = [prop('Niki Lang')];
  page = await os('Marc Cashin', '/?listing=' + PROP_ID);
  o = await osState(page);
  ok(o.view === 'listing-detail' && o.active === PROP_ID, 'Marc can open any listing', [o.view, o.active]);
  await page.context().close();
  properties = [];
  page = await os('Charlotte Lee', '/?listing=' + PROP_ID);
  o = await osState(page);
  ok(o.view === 'dashboard', 'a listing that no longer exists leaves the agent on the dashboard', o.view);
  await page.context().close();
  page = await os('', '/?listing=' + PROP_ID);
  ok(await page.evaluate(() => !document.querySelector('#app').__vue_app__._instance.setupState.loggedIn), 'signed out: nothing opens');
  await page.context().close();

  ok(errors.length === 0, 'no page errors in any case', errors.slice(0, 5));
  await browser.close(); srv.close();
  console.log('\nFORWARD OS CMA Builder test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CMA Builder test crashed:', e); process.exit(2); });
