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
 *   - a comp with a higher fee than the subject is adjusted up, a lower fee down
 *     (until Oct 4, 2026 it was the other way round);
 *   - when the HOA adjustment on a closed sale is more than 5% of its sale price, a
 *     notice under the table names that comp; it changes no value;
 *   - a blank comp fee means "not known yet" and gets no HOA adjustment; a typed 0
 *     means the comp has no fee and is adjusted in full, and stays shown as 0;
 *   - a closed sale whose fee is still blank, when the subject has one, is orange
 *     until the agent types a number. A click does not clear it. The box says to
 *     type 0 when there is no monthly fee. That covers comps typed by hand and
 *     CMAs saved before the fix.
 *
 * LAYOUT ON A COMPUTER
 *   - at 1280, 1440 and 1920 wide the three comps tables fit their cards: nothing
 *     scrolls sideways, no header is cut off, no box spills out of its cell;
 *   - the Parking cell labels its two boxes Garage and Driveway;
 *   - every orange box except a blank fee has a Confirm button, and pressing it
 *     clears the box.
 *
 * INDICATED VALUE (what used to be called Adjusted Price)
 *   - the number beside each comp is labelled Indicated Value on the screen and in
 *     the PDF, with a plain sentence saying it is what that sale says the listing is
 *     worth, and what plus and minus mean. Agents read 'Adjusted Price' as the
 *     comp's own new value and could not explain why a worse comp went up;
 *   - the longer note does not push the Adjustment Grid off its page.
 *
 * WHAT THE PDF SAYS ABOUT ITS METHOD
 *   - it says the structure follows the Fannie Mae sales comparison approach and that
 *     the dollar amounts are FORWARD's estimates; it no longer says 'per Fannie Mae
 *     UAD standards';
 *   - the cover and the method paragraph mention the agent's own price only when it
 *     differs from what the builder recommends;
 *   - it says what the range is built on: the median indicated value, or the agent's
 *     own price when they entered one. Never a 'weighted average';
 *   - the footer fits the page.
 *
 * A NUMBER THAT CANNOT BE RIGHT (audit of Oct 6, 2026)
 *   - a garage count above 4 is orange and asks whether it is right; only Confirm or a
 *     different number clears it, never a click in the box;
 *   - a notice names any closed sale whose total adjustment is more than 15% of its
 *     sale price, with the total and the line that contributes most;
 *   - neither changes a value.
 *   - the listing's own garage is read from its MLS Data line ("2 car garage and 8
 *     car driveway" opened as Street / None), and Parking Type is marked to check
 *     when the line does not settle it. A saved CMA keeps what was saved.
 *   - a blank Garage box on a closed sale means "not known yet": no parking
 *     adjustment, orange until a number is typed (0 for no garage). A click does not
 *     clear it. A stored 0 is shown as 0 and an emptied box is stored as blank.
 *
 * CONDITION GRADES (Marc, Oct 5 and 6, 2026)
 *   - a new CMA values condition as a percent of each comp's sale price against a
 *     standard home: A+ +16%, A +8%, B 0, C -9%, D -18%, checked against an
 *     independent calculation of comp price x (1 + listing %) / (1 + comp %) - price;
 *   - the listing and new rows start on B, and the key (grade, appraiser rating,
 *     meaning, percent) is on screen before a grade is picked;
 *   - the PDF carries the key and its source note, inside the page;
 *   - a CMA saved before the change keeps its dollar grades, its letters, its old
 *     key and its numbers, on screen, in the PDF and after another save.
 *
 * EARLIER VERSIONS, AND RESET / NEW CMA
 *   - a copy of the CMA is kept when a PDF goes out, before Reset, before an earlier
 *     version is opened, and before an agent's edit of a teammate's newer CMA
 *     replaces their own older draft; identical copies are not kept twice running;
 *   - Reset from a listing starts from the listing's details with no comps, deletes
 *     nothing, and a teammate's OLDER draft no longer reopens over it;
 *   - an earlier version reopens with the grades it was built with;
 *   - with no versions table everything else works and the list says so; a real
 *     failure to keep a copy is said out loud; a kept copy is never changed.
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
let snaps = [];        // cma_snapshots rows (earlier versions)
let snapMode = 'ok';   // 'ok' | 'missing' (table not created yet) | 'fail'
let snapBadWrites = []; // any PATCH or DELETE the page tried on a version

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
  if (/\/rest\/v1\/cma_snapshots/.test(u)) {
    // Earlier versions. Only ever added to and read. Not counted in `writes` (those are the draft's own saves).
    if (snapMode === 'missing') return J(route, 404, { code: 'PGRST205', message: 'Could not find the table' });
    if (m === 'GET') {
      if (snapMode === 'fail') return J(route, 500, { message: 'mock outage' });
      const list = inList(u), id = eq(u, 'id');
      const rows = snaps.filter((r) => (!list || list.includes(r.property_address)) && (id === null || r.id === id)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return J(route, 200, rows);
    }
    if (m === 'POST') {
      if (snapMode === 'fail') return J(route, 500, { message: 'mock outage' });
      const b = JSON.parse(req.postData() || '{}');
      snaps.push(Object.assign({ id: 'snap-' + (snaps.length + 1), created_at: new Date(Date.now() + snaps.length).toISOString() }, b));
      return J(route, 201, []);
    }
    snapBadWrites.push(m);   // the app must never change or delete a version
    return J(route, 403, {});
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
      warn: (() => { const w = document.getElementById('hoaWarn'); return !w || w.style.display === 'none' ? [] : Array.prototype.map.call(w.querySelectorAll('li'), (li) => li.textContent); })(),
      warnText: (document.getElementById('hoaWarn') || {}).textContent || '',
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
  ok(f.adj.every((a) => a === 0), 'a blank fee means not known yet: no HOA adjustment (it used to move each comp by 865 x 100)', f.adj);
  const flagText = await page.evaluate(() => { const td = document.querySelector('#comp-row-0 td[data-label="HOA/Mo"]'); return { text: td.querySelector('.fieldflag').textContent, btn: !!td.querySelector('button.fieldok'), shown: td.querySelector('input').value }; });
  ok(/YOU FILL IN/.test(flagText.text) && /No monthly fee\? Type 0/.test(flagText.text) && !flagText.btn, 'the orange fee box says to type 0 when there is no monthly fee, and has no Confirm button', flagText);
  ok(f.active.join('|') === '', 'an active listing is not flagged: it is not adjusted', f.active);
  ok(f.count === f.orange && f.count === 3, 'the number in the banner equals the orange boxes (3)', [f.count, f.orange]);
  ok(f.warn.length === 0, 'no large-adjustment notice for blank fees: nothing is being adjusted', f.warn);

  const feeMoney = (page) => page.evaluate(() => JSON.stringify({ adj: comps.map((c) => c._adj), vals: comps.map((c) => c.hoaMonthly) }));
  const feeBefore = await feeMoney(page);
  await page.click('#comp-row-0 td[data-label="HOA/Mo"] input');
  f = await fees(page);
  ok(f.hoa[0] === 'f-needs' && f.count === 3, 'clicking a blank fee box does not clear it: only a number does', [f.hoa[0], f.count]);
  ok((await feeMoney(page)) === feeBefore, 'and changes no value and no adjustment');
  await page.fill('#comp-row-0 td[data-label="HOA/Mo"] input', '0');
  await page.waitForTimeout(150);
  f = await fees(page);
  ok(f.vals[0] === 0 && f.hoa[0] === '' && f.adj[0] === -86500, 'typing 0 says the comp has no fee: the box clears and the comp is adjusted in full', [f.vals[0], f.hoa[0], f.adj[0]]);
  ok(f.warn.length === 1 && /601 Penn #612: -\$86,500/.test(f.warn[0]), 'and the large-adjustment notice names it (more than 5% of its price)', f.warn);
  ok(f.adj[1] === 0 && f.adj[2] === 0 && f.count === f.orange && f.count === 2, 'the other two are still blank, orange and unadjusted', [f.adj, f.count, f.orange]);
  await page.fill('#comp-row-1 td[data-label="HOA/Mo"] input', '917');
  await page.waitForTimeout(150);
  f = await fees(page);
  ok(f.vals[1] === 917 && f.hoa[1] === '' && f.adj[1] === 5200, 'typing the comp\'s fee clears the box and the adjustment is the difference, not the whole fee', [f.vals[1], f.hoa[1], f.adj[1]]);
  ok(f.adj[1] > 0, 'a comp with a HIGHER fee than the subject is adjusted UP (it is the inferior one)', f.adj[1]);
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
  ok(f.hoa.join('|') === '||f-needs' && f.count === f.orange && f.count === 1, 'after a reload the filled boxes stay clear and the blank one stays orange', [f.hoa, f.count, f.orange]);
  const shown = await page.evaluate(() => [0, 1, 2].map((i) => document.querySelector('#comp-row-' + i + ' td[data-label="HOA/Mo"] input').value));
  ok(shown.join('|') === '0|917|' && f.adj[0] === -86500 && f.adj[1] === 5200 && f.adj[2] === 0, 'a typed 0 is still shown as 0 after a reload (it used to show as an empty box), and the adjustments are the same', [shown, f.adj]);
  await page.fill('#comp-row-1 td[data-label="HOA/Mo"] input', '');
  await page.waitForTimeout(150);
  f = await fees(page);
  ok(f.vals[1] === '' && f.adj[1] === 0 && f.hoa[1] === 'f-needs', 'emptying a fee box makes it blank again, not 0: no adjustment, and orange', [f.vals[1], f.adj[1], f.hoa[1]]);
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
  ok(f.adj[0] === 5200 && f.adj[1] === -56500 && f.adj[2] === -11500, 'each adjustment is the difference from the subject\'s fee: up for a higher fee (917), down for a lower one (300, 750)', f.adj);
  const net = await page.evaluate(() => comps.slice(0, 3).map((c) => [c._adj.net, c._adj.adjusted - parseFloat(c.salePrice)]));
  ok(net.every((n) => n[0] === n[1]), 'and it carries into the net adjustment and the adjusted price', net);
  ok(f.vals[3] === '' && f.hoa[3] === 'f-needs' && f.adj[3] === 0, 'a sheet that prints no fee leaves the box blank, orange and unadjusted', [f.vals[3], f.hoa[3], f.adj[3]]);
  ok(f.count === f.orange, 'the number in the banner equals the orange boxes', [f.count, f.orange]);

  // The notice: sale price 500,000, so the line is 25,000.
  ok(f.warn.length === 2 && /20 House Ln: -\$56,500/.test(f.warn[0]) && /50 Printed Zero Way: -\$86,500/.test(f.warn[1]), 'the notice names the two comps whose HOA adjustment is over 5% of the sale price', f.warn);
  ok(/Check the HOA adjustment/.test(f.warnText) && /Confirm what each fee includes/.test(f.warnText) && /Step 2/.test(f.warnText), 'and says what to check and where to change it', f.warnText);
  ok(!/601 Penn|30 Both Ct|40 Nothing/.test(f.warn.join(' ')), 'small adjustments (5,200 and 11,500) and the comp still waiting for its fee are not named', f.warn);
  const warnBefore = await feeMoney(page);
  await page.fill('#comp-row-1 td[data-label="HOA/Mo"] input', '615');
  f = await fees(page);
  ok(f.adj[1] === -25000 && !/20 House Ln/.test(f.warn.join(' ')), 'exactly 5% (25,000 on 500,000) is not named', [f.adj[1], f.warn]);
  await page.fill('#comp-row-1 td[data-label="HOA/Mo"] input', '614');
  f = await fees(page);
  ok(f.adj[1] === -25100 && /20 House Ln: -\$25,100/.test(f.warn.join(' ')), 'one dollar a month past it is', [f.adj[1], f.warn]);
  await page.fill('#adj_hoa', '0');
  f = await fees(page);
  ok(f.warn.length === 0, 'with the HOA multiplier set to 0 the notice goes away', f.warn);
  await page.fill('#adj_hoa', '100');
  await page.fill('#comp-row-1 td[data-label="HOA/Mo"] input', '300');
  await page.waitForTimeout(1900);
  f = await fees(page);
  ok(f.warn.length === 2, 'and comes back when the multiplier and the fee are put back', f.warn);
  ok((await page.evaluate(() => JSON.stringify(comps.map((c) => c._adj)))) === JSON.stringify(JSON.parse(warnBefore).adj), 'showing the notice changed no adjustment', null);
  await page.fill('#comp-row-3 td[data-label="HOA/Mo"] input', '700');
  await doImport();
  f = await fees(page);
  ok(f.vals.length === 5 && String(f.vals[3]) === '700' && f.hoa[3] !== 'f-needs', 'reading the same sheets again keeps the fee the agent typed and adds no duplicate', [f.vals, f.hoa[3]]);
  ok(errors.length === 0, 'no script errors', errors);

  // ════════════════ LAYOUT ON A COMPUTER ════════════════
  console.log('Layout on a computer');
  await page.evaluate(() => { comps[0].address = '601 Pennsylvania Ave NW #1003'; comps[1]._src = Object.assign({}, comps[1]._src, { gla: 'check', garageSpaces: 'check' }); if (comps[1]._rev) { delete comps[1]._rev.gla; delete comps[1]._rev.garageSpaces; delete comps[1]._rev.drivewaySpaces; } buildCompsTable(); recalcAll(); });
  const layout = (page) => page.evaluate(() => {
    const r = {};
    r.wrappers = Array.prototype.map.call(document.querySelectorAll('.comps-wrapper'), (w) => w.scrollWidth - w.clientWidth);
    r.pageScroll = document.documentElement.scrollWidth - window.innerWidth;
    r.cutHeaders = Array.prototype.filter.call(document.querySelectorAll('.comps-table th'), (th) => th.scrollWidth > th.clientWidth + 2).map((th) => th.textContent);
    r.spill = [];
    document.querySelectorAll('#compsBody td, #activeBody td').forEach((td) => { const t = td.getBoundingClientRect(); td.querySelectorAll('input, select, button, label').forEach((el) => { const e = el.getBoundingClientRect(); if (e.right > t.right + 0.5 || e.left < t.left - 0.5) r.spill.push((td.getAttribute('data-label') || 'remove') + ':' + el.tagName); }); });
    const a = document.querySelector('#comp-row-0 td[data-label="Address"] input');
    r.addrBox = a.clientWidth; r.addrTitle = a.title;
    r.tableWidth = document.getElementById('compsTable').getBoundingClientRect().width;
    r.cardWidth = document.getElementById('compsTable').closest('.card').getBoundingClientRect().width;
    return r;
  });
  for (const w of [1280, 1440, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    const L = await layout(page);
    ok(L.wrappers.every((d) => d <= 0) && L.pageScroll <= 0, 'at ' + w + ' wide nothing scrolls sideways', [L.wrappers, L.pageScroll]);
    ok(L.cutHeaders.length === 0, 'at ' + w + ' wide no column header is cut off', L.cutHeaders);
    ok(L.spill.length === 0, 'at ' + w + ' wide no box spills out of its cell', L.spill);
    // Box widths, not text widths: how wide the text is depends on the fonts installed on the machine running this.
    ok(L.addrBox >= (w >= 1440 ? 170 : 148), 'at ' + w + ' wide the Address box is wide enough for a condo address with its unit number (it was 148 at every width)', L.addrBox);
    if (w === 1920) ok(L.cardWidth > 1400 && L.tableWidth > 1350, 'at 1920 wide the table uses the screen (it stopped at about 1100 before)', [L.cardWidth, L.tableWidth]);
    if (w === 1280) ok(L.addrTitle === '601 Pennsylvania Ave NW #1003', 'the full address shows when you point at the box', L.addrTitle);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const pk = await page.evaluate(() => { const td = document.querySelector('#comp-row-1 td[data-label="Parking"]'); return { labels: Array.prototype.map.call(td.querySelectorAll('label'), (l) => l.childNodes[0].textContent), placeholders: Array.prototype.map.call(td.querySelectorAll('input'), (i) => i.placeholder), header: Array.prototype.map.call(document.querySelectorAll('#compsTable th'), (th) => th.textContent).filter((t) => /Parking/.test(t)), btn: (td.querySelector('button.fieldok') || {}).textContent || '', cls: td.className }; });
  ok(pk.labels.join('|') === 'Garage|Driveway' && pk.header.join('') === 'Parking spaces' && !/gar|dw/.test(pk.placeholders.join('')), 'the Parking cell labels its two boxes Garage and Driveway, under a header that reads Parking spaces', pk);
  ok(/Confirm/.test(pk.btn) && /f-check/.test(pk.cls), 'an orange CHECK THIS box has a Confirm button', pk);
  const layoutMoney = await feeMoney(page);
  await page.click('#comp-row-1 td[data-label="Parking"] button.fieldok');
  let pkAfter = await page.evaluate(() => { const td = document.querySelector('#comp-row-1 td[data-label="Parking"]'); return { cls: td.className, text: td.textContent }; });
  ok(/f-ok/.test(pkAfter.cls) && /REVIEWED/.test(pkAfter.text), 'pressing Confirm turns the box green and says REVIEWED', pkAfter);
  await page.waitForTimeout(1900);
  pkAfter = await page.evaluate(() => { const td = document.querySelector('#comp-row-1 td[data-label="Parking"]'); return { cls: td.className, btn: !!td.querySelector('button.fieldok') }; });
  ok(!/f-check|f-needs|f-ok/.test(pkAfter.cls) && !pkAfter.btn, 'then the box clears and the button goes', pkAfter);
  ok((await feeMoney(page)) === layoutMoney, 'pressing Confirm changed no value and no adjustment');
  const bannerText = await page.evaluate(() => document.getElementById('needsBanner').textContent);
  ok(/Press Confirm on a box/.test(bannerText), 'the notice at the top says to press Confirm', bannerText);

  // ════════════════ WHAT THE PDF SAYS ABOUT ITS METHOD ════════════════
  console.log('What the PDF says about its method');
  // Draws the real PDF with the real jsPDF and records every piece of text put on a page.
  const pdfText = (page) => page.evaluate(() => {
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const out = [], wide = [], rates = [];
    const orig = doc.text.bind(doc);
    doc.text = function (t, x, y, o) {
      if (/Adjustment Rates Used/.test(String([].concat(t)[0]))) rates.push([doc.internal.getCurrentPageInfo().pageNumber, y]);
      [].concat(t).forEach((line) => { out.push(String(line)); if (/Fannie Mae sales comparison structure/.test(String(line))) wide.push([doc.getTextWidth(String(line)), doc.getFontSize(), x]); });
      return orig(t, x, y, o);
    };
    _fillPDFDoc(doc);
    return { text: out.join(' ').replace(/\s+/g, ' '), wide, rates, pages: doc.getNumberOfPages() };
  });
  await page.fill('#agentPriceOverride', '');
  await page.fill('#s_state', 'DC');   // a DC CMA has two more grid rows (driveway): the tallest grid there is
  await page.waitForTimeout(100);
  let pdf = await pdfText(page);
  ok(/Indicated Value/.test(pdf.text) && /INDICATED VALUE/.test(pdf.text) && /Lowest Indicated Value/i.test(pdf.text) && /Median Indicated Value/i.test(pdf.text), 'the PDF calls the number beside each comp Indicated Value', null);
  ok(!/Adjusted Price|ADJUSTED PRICE|Adjusted Low|Avg Adjusted|comp is inferior|comp is superior/.test(pdf.text), 'and no longer says Adjusted Price, or that a comp is inferior or superior', null);
  ok(/A plus \(\+\) means this property is better on that feature\. A minus \(\u2013\) means the comparable is better\./.test(pdf.text) && /Indicated Value, is what that sale says this property is worth\./.test(pdf.text), 'the Adjustment Grid explains plus, minus and Indicated Value in plain words', null);
  ok(pdf.rates.length === 1 && pdf.rates[0][1] < 740, 'with five comps on a DC CMA the grid and its rates line still end above the page footer', pdf.rates);
  const scr = await page.evaluate(() => ({ th: Array.prototype.map.call(document.querySelectorAll('#compsTable th'), (t) => t.textContent).join('|'), intro: document.getElementById('compsTable').closest('.card').textContent, all: document.body.innerText, mobile: document.querySelector('#comp-row-0 td.calc[id$="_adjPrice"]').getAttribute('data-label') }));
  ok(/\|Indicated Value\|/.test(scr.th) && !/Adj Price/.test(scr.all) && scr.mobile === 'Indicated Value', 'on the screen the column is Indicated Value, and Adj Price is gone', scr.th);
  ok(/Indicated Value is what each sale says your listing is worth/.test(scr.intro) && /A plus \(\+\) means your listing is better than the comp on that feature/.test(scr.all), 'the screen says what Indicated Value is and what plus and minus mean', null);
  ok(/follows the structure of the Fannie Mae sales comparison approach/.test(pdf.text) && /in line with the ANSI measuring standard, counts above-grade living area separately/.test(pdf.text), 'the method paragraph says the STRUCTURE follows Fannie Mae and ANSI', pdf.text.slice(-900));
  ok(/The dollar amount of each adjustment is FORWARD\u2019s estimate/.test(pdf.text), 'and that the dollar amounts are FORWARD\'s', null);
  ok(!/per Fannie Mae UAD standards/.test(pdf.text) && !/appraiser-grade/.test(pdf.text) && !/weighted average/.test(pdf.text), 'the old claims are gone: per Fannie Mae UAD standards, appraiser-grade, weighted average', null);
  ok(/range is 3% above and below the median indicated value\./.test(pdf.text), 'with no agent price, the range is described as built on the median indicated value', null);
  ok(/Based on 5 adjusted comparable sales/.test(pdf.text) && !/agent\u2019s recommended price/.test(pdf.text), 'and the cover says Based on 5 adjusted comparable sales, with no mention of an agent price', null);
  const auto = await page.evaluate(() => parseInt(document.getElementById('vRecommended').textContent.replace(/[^0-9]/g, ''), 10));
  await page.fill('#agentPriceOverride', String(auto));
  pdf = await pdfText(page);
  ok(auto > 0 && /Based on 5 adjusted comparable sales/.test(pdf.text) && /the median indicated value\./.test(pdf.text) && !/agent\u2019s recommended price/.test(pdf.text), 'an agent price equal to the builder\'s own figure changes nothing, so the PDF says nothing about it', auto);
  ok(pdf.wide.length === 1 && pdf.wide[0][0] + pdf.wide[0][2] <= 612 - 50, 'the new Adjustment Grid footer fits inside the page margins (real jsPDF width)', pdf.wide);
  ok(/Adjustments are applied to each comparable sale to normalize differences in gross living area, bedroom and bathroom count, parking spaces, below-grade finished area, condition, and HOA burden\./.test(pdf.text) && /seller objectives\./.test(pdf.text), 'the rest of the paragraph is unchanged', null);
  ok(/The comparable sales were selected by the agent as the recent sales most relevant to this property, based on location, property type and features\./.test(pdf.text) && !/market-appropriate radius/.test(pdf.text), 'the paragraph says the agent selected the comps; it no longer claims a property type and radius the builder does not check', null);
  const pagesBefore = pdf.pages;
  await page.fill('#agentPriceOverride', '450000');
  pdf = await pdfText(page);
  ok(/Based on the agent\u2019s recommended price, informed by 5 comparable sales/.test(pdf.text) && !/Based on 5 adjusted comparable sales/.test(pdf.text), 'with a different agent price, the cover says the range is based on the agent\'s price, informed by the sales', null);
  ok(/range is 3% above and below the agent\u2019s recommended price\./.test(pdf.text) && !/median indicated value\./.test(pdf.text), 'with an agent price entered, the range is described as built on the agent\'s price', null);
  ok(pdf.pages === pagesBefore, 'the page count is the same either way', [pagesBefore, pdf.pages]);
  ok(errors.length === 0, 'no script errors drawing the PDF', errors);
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

  // ════════════════ A NUMBER THAT CANNOT BE RIGHT ════════════════
  console.log('Large adjustments and impossible garage counts');
  // The audit of Oct 6, 2026: a saved CMA held 32 in a comp's garage box (-$600,000) and nothing questioned it.
  table = [row('Charlotte Lee', LISTING, '2026-10-05T10:00:00Z', draft('Charlotte Lee', [comp('9201 Bad Garage Way', { salePrice: 1645000, garageSpaces: 32 }), comp('2 Normal St'), comp('3 Smaller St', { gla: 600 })]))];
  writes = [];
  page = await builder('Charlotte Lee');
  const big = (page) => page.evaluate(() => {
    const cls = (td) => (td ? ['f-needs', 'f-check', 'f-mls', 'f-ok'].filter((c) => td.classList.contains(c)).join(',') : 'NO CELL');
    const b = document.getElementById('needsBanner'); const m = /(\d+) field/.exec(b.textContent || '');
    const w = document.getElementById('adjWarn');
    return {
      park: comps.map((c, i) => cls(document.querySelector('#comp-row-' + i + ' td[data-label="Parking"]'))),
      flag: comps.map((c, i) => { const f = document.querySelector('#comp-row-' + i + ' td[data-label="Parking"] .fieldflag'); return f ? f.textContent : ''; }),
      net: comps.map((c) => (c._adj ? c._adj.net : null)),
      warn: !w || w.style.display === 'none' ? [] : Array.prototype.map.call(w.querySelectorAll('li'), (li) => li.textContent),
      warnText: w ? w.textContent : '',
      orange: document.querySelectorAll('.f-needs, .f-check').length,
      count: b.style.display === 'none' ? 0 : (m ? +m[1] : -1),
      rec: document.getElementById('vRecommended').textContent,
    };
  });
  let g = await big(page);
  ok(g.net[0] === -590000 && g.net[1] === 10000 && g.net[2] === 80000, 'the arithmetic is unchanged: 32 garage spaces still count as typed (-590,000 in total)', g.net);
  ok(g.park[0] === 'f-check' && /32 GARAGE SPACES\?/.test(g.flag[0]) && /Confirm/.test(g.flag[0]), 'a garage count of 32 is orange and asks whether it is right', [g.park[0], g.flag[0]]);
  ok(g.park[1] === '' && g.park[2] === '', 'a believable count (2) is not flagged', g.park);
  ok(g.warn.length === 1 && /9201 Bad Garage Way: -\$590,000 in total, 36% of its sale price/.test(g.warn[0]) && /Largest line: Parking -\$600,000/.test(g.warn[0]) && /garage box holds 32/.test(g.warn[0]), 'a notice names the comp whose total adjustment is over 15% of its price, the total, and the line that caused it', g.warn);
  ok(!/Normal St|Smaller St/.test(g.warn.join(' ')), 'a comp at 11% (80,000 on 700,000) is not named', g.warn);
  ok(/Correct the box, or remove the comp/.test(g.warnText), 'and it says what to do', g.warnText);
  ok(g.count === g.orange, 'the number in the banner equals the orange boxes', [g.count, g.orange]);
  const recBefore = g.rec, netBefore = JSON.stringify(g.net);

  await page.click('#comp-row-0 td[data-label="Parking"] input');
  g = await big(page);
  ok(g.park[0] === 'f-check', 'clicking into the box does not clear it', g.park[0]);
  await page.click('#comp-row-0 td[data-label="Parking"] .fieldok');
  g = await big(page);
  ok(g.park[0] === 'f-ok', 'pressing Confirm turns it green', g.park[0]);
  await page.waitForTimeout(1900);
  g = await big(page);
  ok(g.park[0] === '' && g.count === g.orange, 'then it clears, and the count still equals the orange boxes', [g.park[0], g.count, g.orange]);
  ok(g.rec === recBefore && JSON.stringify(g.net) === netBefore, 'confirming changed no value', [g.rec, g.net]);
  ok(g.warn.length === 1, 'the notice stays while the total is still that large', g.warn);
  await page.waitForTimeout(2800);
  ok(table[0].draft_data.comps[0]._garageOk === 32, 'the confirmed number is saved with the draft', table[0].draft_data.comps[0]._garageOk);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  g = await big(page);
  ok(g.park[0] === '' && g.warn.length === 1, 'after a reload the confirmed box stays clear and the notice is still there', [g.park[0], g.warn.length]);

  await page.fill('#comp-row-0 td[data-label="Parking"] .pk2 label:first-child input', '2');
  await page.waitForTimeout(150);
  g = await big(page);
  ok(g.net[0] === 10000 && g.warn.length === 0 && g.warnText === '', 'typing the real count (2) corrects the adjustment and the notice goes away', [g.net[0], g.warn]);
  await page.fill('#comp-row-1 td[data-label="Parking"] .pk2 label:first-child input', '9');
  await page.waitForTimeout(150);
  g = await big(page);
  ok(g.park[1] === 'f-check' && /9 GARAGE SPACES\?/.test(g.flag[1]), 'a count typed past 4 turns orange as it is typed', [g.park[1], g.flag[1]]);
  ok(g.warn.length === 1 && /2 Normal St: -\$130,000 in total, 19%/.test(g.warn[0]), 'and the notice names that comp', g.warn);
  await page.fill('#comp-row-0 td[data-label="Parking"] .pk2 label:first-child input', '32');
  await page.waitForTimeout(150);
  g = await big(page);
  ok(g.park[0] === '' && g.warn.length === 2, 'a count the agent already confirmed (32) is not questioned a second time, but the notice names both comps', [g.park[0], g.warn.length]);
  await page.context().close();

  // A blank Garage box is "not known yet", not "no garage" (Marc, Oct 6, 2026).
  console.log('A blank garage box');
  table = [row('Charlotte Lee', LISTING, '2026-10-05T10:00:00Z', draft('Charlotte Lee', [comp('1 Blank Garage Ct', { garageSpaces: '' }), comp('2 Zero Garage Ct', { garageSpaces: 0 }), comp('3 Two Garage Ct')],
    { activeComps: [{ address: '9 Active St', date: '2026-09-01', listPrice: 500000, gla: 800, lotSize: '', beds: 1, fullBaths: 1, halfBaths: 0, below: 0, garageSpaces: '', condition: 'A', hoaMonthly: '', proximity: '0.1 mi', dom: 5 }] }))];
  writes = [];
  page = await builder('Charlotte Lee');
  const gar = (page) => page.evaluate(() => {
    const cls = (td) => (td ? ['f-needs', 'f-check', 'f-mls', 'f-ok'].filter((c) => td.classList.contains(c)).join(',') : 'NO CELL');
    const b = document.getElementById('needsBanner'); const m = /(\d+) field/.exec(b.textContent || '');
    return {
      park: comps.map((c, i) => cls(document.querySelector('#comp-row-' + i + ' td[data-label="Parking"]'))),
      flag: comps.map((c, i) => { const f = document.querySelector('#comp-row-' + i + ' td[data-label="Parking"] .fieldflag'); return f ? f.textContent : ''; }),
      shown: comps.map((c, i) => document.querySelector('#comp-row-' + i + ' td[data-label="Parking"] .pk2 label:first-child input').value),
      active: Array.prototype.map.call(document.querySelectorAll('#activeBody tr'), (tr) => cls(tr.querySelector('td[data-label="Parking"]'))),
      adj: comps.map((c) => (c._adj ? c._adj.garage : null)),
      vals: comps.map((c) => c.garageSpaces),
      orange: document.querySelectorAll('.f-needs, .f-check').length,
      count: b.style.display === 'none' ? 0 : (m ? +m[1] : -1),
    };
  });
  let q = await gar(page);
  ok(q.adj[0] === 0 && q.adj[1] === 40000 && q.adj[2] === 0, 'a blank garage gets no parking adjustment; a typed 0 is adjusted in full (the listing has 2: +40,000); 2 against 2 is 0', q.adj);
  ok(q.park[0] === 'f-needs' && /No garage\? Type 0/.test(q.flag[0]) && !/Confirm/.test(q.flag[0]), 'the blank box is orange, says to type 0 for no garage, and has no Confirm button', [q.park[0], q.flag[0]]);
  ok(q.shown[1] === '0' && q.park[1] === '', 'a stored 0 is shown as 0 (it used to show as an empty box) and is not flagged', [q.shown[1], q.park[1]]);
  ok(q.active[0] === '' , 'an active listing with a blank garage is not flagged: it is not adjusted', q.active);
  ok(q.count === q.orange, 'the number in the banner equals the orange boxes', [q.count, q.orange]);
  await page.click('#comp-row-0 td[data-label="Parking"] .pk2 label:first-child input');
  q = await gar(page);
  ok(q.park[0] === 'f-needs', 'a click does not clear it', q.park[0]);
  const gridOf = async () => (await pdfText(page)).text;
  ok(/unknown/.test(await gridOf()), 'the PDF grid prints the blank count as unknown, not as 0 spaces');
  await page.fill('#comp-row-0 td[data-label="Parking"] .pk2 label:first-child input', '0');
  await page.waitForTimeout(150);
  q = await gar(page);
  ok(q.vals[0] === 0 && q.adj[0] === 40000 && q.park[0] === '', 'typing 0 stores 0, applies the adjustment and clears the box', [q.vals[0], q.adj[0], q.park[0]]);
  await page.fill('#comp-row-0 td[data-label="Parking"] .pk2 label:first-child input', '');
  await page.waitForTimeout(150);
  q = await gar(page);
  ok(q.vals[0] === '' && q.adj[0] === 0 && q.park[0] === 'f-needs', 'emptying the box stores a blank (it used to store 0), removes the adjustment and turns it orange again', [q.vals[0], q.adj[0], q.park[0]]);
  await page.context().close();

  // The listing's own parking, read from its MLS Data when the builder opens.
  console.log('The listing\'s garage');
  page = await os('Marc Cashin', '/');
  const park = await page.evaluate(() => ['2 car garage and 8 car driveway', '1-car garage parking, 2 driveway parking', '2 car detached garage', '8 driveway spaces', 'street', '2', '3 garage spaces'].map((t) => fosParkingFromMls(t)));
  ok(park[0].parkingType === 'Attached Garage' && park[0].parkingSpaces === '2' && park[0].drivewaySpaces === '8' && park[0].unsure === true, '"2 car garage and 8 car driveway" is a garage with 2 spaces and 8 driveway spaces, marked to check (it opened as Street / None: 1926 Ruxton Rd)', park[0]);
  ok(park[1].parkingType === 'Attached Garage' && park[1].parkingSpaces === '1' && park[1].drivewaySpaces === '2', '"1-car garage parking, 2 driveway parking" is 1 garage space and 2 driveway (it opened as a driveway with 1)', park[1]);
  ok(park[2].parkingType === 'Detached Garage' && park[2].parkingSpaces === '2' && park[2].unsure === false, 'a garage called detached is not marked to check', park[2]);
  ok(park[3].parkingType === 'Driveway' && park[3].parkingSpaces === '8' && park[3].unsure === false, 'a driveway only is still a driveway', park[3]);
  ok(park[4].parkingType === 'None' && park[4].unsure === false, '"street" is Street / None and is not questioned', park[4]);
  ok(park[5].parkingType === 'None' && park[5].parkingSpaces === '2' && park[5].unsure === true, 'a bare number is not guessed at: Street / None, marked to check', park[5]);
  ok(park[6].parkingType === 'Attached Garage' && park[6].parkingSpaces === '3', '"3 garage spaces" is a garage with 3', park[6]);
  await page.context().close();

  table = []; writes = [];
  page = await builder('Charlotte Lee', PREFILL('Charlotte Lee', { parkingType: 'Attached Garage', parkingSpaces: '2', drivewaySpaces: '8', parkingUnsure: true }));
  let lpk = await page.evaluate(() => ({ type: document.getElementById('s_parkingType').value, spaces: document.getElementById('s_parkingSpaces').value, drive: document.getElementById('s_drivewaySpaces').value,
    cls: document.getElementById('s_parkingType').closest('.field').className, flag: (document.getElementById('s_parkingType').closest('.field').querySelector('.fieldflag') || {}).textContent || '' }));
  ok(lpk.type === 'Attached Garage' && lpk.spaces === '2' && lpk.drive === '8', 'a new CMA opens with the listing\'s garage type, garage count and driveway count', lpk);
  ok(/f-check/.test(lpk.cls) && /CHECK THIS/.test(lpk.flag), 'and Parking Type is marked CHECK THIS when the MLS Data did not settle it', lpk);
  await page.context().close();
  page = await builder('Charlotte Lee', PREFILL('Charlotte Lee', { parkingType: 'Detached Garage', parkingSpaces: '2', parkingUnsure: false }));
  lpk = await page.evaluate(() => document.getElementById('s_parkingType').closest('.field').className);
  ok(!/f-check/.test(lpk), 'it is not marked when the MLS Data was clear', lpk);
  await page.context().close();
  // A saved CMA keeps what was saved, whatever the listing's MLS Data now says.
  table = [row('Charlotte Lee', LISTING, '2026-10-05T10:00:00Z', draft('Charlotte Lee', [comp('1 A St')], { subject: Object.assign(subject('Charlotte Lee'), { parkingType: 'None', parkingSpaces: '2' }) }))];
  page = await builder('Charlotte Lee', PREFILL('Charlotte Lee', { parkingType: 'Attached Garage', parkingSpaces: '2', drivewaySpaces: '8', parkingUnsure: true }));
  lpk = await page.evaluate(() => ({ type: document.getElementById('s_parkingType').value, cls: document.getElementById('s_parkingType').closest('.field').className }));
  ok(lpk.type === 'None' && !/f-check/.test(lpk.cls), 'a CMA saved earlier keeps the parking type that was saved', lpk);
  await page.context().close();

  // ════════════════ CONDITION GRADES ════════════════
  console.log('Condition grades: percent for a new CMA, dollars kept on a saved one');
  const expectPct = (price, subj, cmp) => { const P = { 'A+': 16, A: 8, B: 0, C: -9, D: -18 }; return Math.round(price * (1 + P[subj] / 100) / (1 + P[cmp] / 100) - price); };
  const gradeState = (page) => page.evaluate(() => ({
    flat: document.body.classList.contains('cma-flat'),
    sCond: document.getElementById('s_condition').value,
    sLabel: document.getElementById('s_condition').selectedOptions[0].textContent,
    sFlag: document.getElementById('s_condition').closest('.field').className,
    keyRows: Array.prototype.map.call(document.querySelectorAll('#gradeKeySubject tbody tr'), (tr) => tr.innerText.replace(/\s+/g, ' ').trim()),
    keyShown: !!document.getElementById('gradeKeySubject').offsetParent,
    key2Shown: !!document.getElementById('gradeKeyComps').offsetParent,
    flatNotice: !!document.getElementById('flatNotice').offsetParent,
    flatBoxes: !!document.getElementById('adj_condAplus').offsetParent,
    cond: comps.map((c) => (c._adj ? c._adj.condition : null)),
    grades: comps.map((c) => c.condition),
    rec: document.getElementById('vRecommended').textContent,
  }));

  // A new CMA, opened from a listing whose prefill still carries the old letter C.
  table = []; writes = []; snaps = []; snapMode = 'ok';
  page = await builder('Charlotte Lee', PREFILL('Charlotte Lee', { condition: 'C', state: 'VA', city: 'Fairfax', zip: '22030', gla: '2100', beds: '4', fullBaths: '2', halfBaths: '1' }));
  let gs = await gradeState(page);
  ok(!gs.flat && gs.sCond === 'B', 'a new CMA uses the percent grades and the listing starts on B, the standard home (the old C from the listing is not used)', gs);
  ok(/^B: Standard \(C3\)$/.test(gs.sLabel), 'the grade names the appraiser rating it stands for', gs.sLabel);
  ok(/f-needs/.test(gs.sFlag), 'the listing\'s Condition is marked YOU FILL IN: B has to be the agent\'s decision', gs.sFlag);
  ok(gs.keyShown && gs.key2Shown && gs.keyRows.length === 5, 'the key is on screen before any grade is picked, in Step 1 and again above the comps', [gs.keyShown, gs.key2Shown, gs.keyRows.length]);
  ok(/^A\+ C1 .*\+16%$/.test(gs.keyRows[0]) && /^A C2 .*\+8%$/.test(gs.keyRows[1]) && /^B C3 .*Standard: 0%$/.test(gs.keyRows[2]) && /^C C4 .*9%$/.test(gs.keyRows[3]) && /^D C5 or C6 .*18%$/.test(gs.keyRows[4]), 'the key shows each grade, its rating and its percent: +16, +8, 0, -9, -18', gs.keyRows);
  ok(!gs.flatNotice && !gs.flatBoxes, 'the dollar grade boxes are not shown on a new CMA', [gs.flatNotice, gs.flatBoxes]);
  await page.evaluate(() => { addComp(); addComp(); addComp(); });
  ok((await page.evaluate(() => comps.map((c) => c.condition).join(','))) === 'B,B,B', 'a new comp row starts on B');
  await page.evaluate(() => {
    Object.assign(comps[0], { address: '1 Renovated Rd', salePrice: 800000, gla: 2100, beds: 4, fullBaths: 2, halfBaths: 1, garageSpaces: 0, condition: 'A', hoaMonthly: 0 });
    Object.assign(comps[1], { address: '2 Dated Dr', salePrice: 500000, gla: 2100, beds: 4, fullBaths: 2, halfBaths: 1, garageSpaces: 0, condition: 'C', hoaMonthly: 0 });
    Object.assign(comps[2], { address: '3 Same St', salePrice: 650000, gla: 2100, beds: 4, fullBaths: 2, halfBaths: 1, garageSpaces: 0, condition: 'B', hoaMonthly: 0 });
    document.getElementById('s_parkingType').value = 'None';
    buildCompsTable(); recalcAll();
  });
  gs = await gradeState(page);
  ok(gs.cond[0] === expectPct(800000, 'B', 'A') && gs.cond[0] === -59259, 'a B listing against an A comp that sold for 800,000: -59,259 (800,000 x 1.00 / 1.08 - 800,000)', gs.cond);
  ok(gs.cond[1] === expectPct(500000, 'B', 'C') && gs.cond[1] === 49451, 'against a C comp that sold for 500,000: +49,451 (500,000 x 1.00 / 0.91 - 500,000)', gs.cond);
  ok(gs.cond[2] === 0, 'same grade: no adjustment', gs.cond);
  const nets = await page.evaluate(() => comps.map((c) => [c._adj.net, c._adj.condition, c._adj.adjusted - c.salePrice]));
  ok(nets.every((n) => n[0] === n[1] && n[0] === n[2]), 'it is the whole net adjustment here and carries into the Indicated Value', nets);
  await page.selectOption('#s_condition', 'A+');
  await page.evaluate(() => { comps[1].condition = 'D'; buildCompsTable(); recalcAll(); });
  gs = await gradeState(page);
  ok(gs.cond[0] === expectPct(800000, 'A+', 'A') && gs.cond[1] === expectPct(500000, 'A+', 'D') && gs.cond[1] === 207317 && gs.cond[2] === expectPct(650000, 'A+', 'B') && gs.cond[2] === 104000, 'an A+ listing: every comp is checked against an independent calculation of the formula', gs.cond);
  await page.selectOption('#s_condition', 'B');
  await page.evaluate(() => { comps[1].condition = 'C'; buildCompsTable(); recalcAll(); });
  await page.waitForTimeout(2800);
  ok(table.length === 1 && table[0].draft_data.gradeMethod === 'pct1', 'the CMA is saved with its method (percent)', table[0] && table[0].draft_data.gradeMethod);

  // The PDF: grades with their ratings, the key and its source.
  await page.fill('#s_state', 'DC');
  await page.evaluate(() => { for (let i = 0; i < 3; i++) { addComp(); Object.assign(comps[3 + i], { address: (4 + i) + ' More St', salePrice: 700000, gla: 2000, beds: 4, fullBaths: 2, halfBaths: 1, garageSpaces: 0, condition: 'B', hoaMonthly: 0 }); } buildCompsTable(); recalcAll(); });
  const keyPdf = await page.evaluate(() => {
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const out = [], onKeyPage = []; let keyPage = 0; const orig = doc.text.bind(doc);
    doc.text = function (t, x, y, o) {
      const pg = doc.internal.getCurrentPageInfo().pageNumber;
      [].concat(t).forEach((line, i) => { out.push(String(line)); if (/How Condition Is Valued/.test(String(line))) keyPage = pg; onKeyPage.push([pg, y + i * 9, x + doc.getTextWidth(String(line)) * ((o && o.align === 'right') ? 0 : 1), String(line).slice(0, 30)]); });
      return orig(t, x, y, o);
    };
    _fillPDFDoc(doc);
    const mine = onKeyPage.filter((e) => e[0] === keyPage && !/Confidential|Page \d/.test(e[3]));
    const foot = onKeyPage.filter((e) => e[0] === keyPage && /Confidential/.test(e[3])).map((e) => e[1]);
    return { text: out.join(' ').replace(/\s+/g, ' '), keyPage, maxY: Math.max.apply(null, mine.map((e) => e[1])), maxX: Math.max.apply(null, mine.map((e) => e[2])), footY: Math.min.apply(null, foot), pages: doc.getNumberOfPages(), w: doc.internal.pageSize.getWidth() };
  });
  ok(/How Condition Is Valued/.test(keyPdf.text) && /A\+ C1 New \+16% of the comparable.s sale price/.test(keyPdf.text) && /B C3 Standard, well maintained Standard home: no adjustment/.test(keyPdf.text) && /D C5 or C6 Needs major work .18% of the comparable.s sale price/.test(keyPdf.text), 'the PDF carries the condition key: grade, appraiser rating, name and weight', keyPdf.text.slice(keyPdf.text.indexOf('How Condition'), keyPdf.text.indexOf('How Condition') + 420));
  ok(/more than 37,000 home appraisals/.test(keyPdf.text) && /Federal Housing Finance Agency/.test(keyPdf.text) && /This analysis is not an appraisal/.test(keyPdf.text), 'and the note saying where the percents come from and that it is not an appraisal');
  ok(/B \(C3\)/.test(keyPdf.text) && /C \(C4\)/.test(keyPdf.text), 'the grid shows each grade with its rating');
  ok(keyPdf.maxY < keyPdf.footY - 6 && keyPdf.maxX <= keyPdf.w - 40, 'with six comps and the two DC rows, the key and its note end above the page footer and inside the margins (measured with real jsPDF)', [keyPdf.maxY, keyPdf.footY, keyPdf.maxX, keyPdf.w]);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  gs = await gradeState(page);
  ok(!gs.flat && gs.cond[0] === -59259 && gs.sCond === 'B', 'reopened, it is still a percent CMA with the same numbers', gs);
  await page.context().close();

  // A CMA saved before the change: nothing about it moves.
  const oldDraft = draft('Charlotte Lee', [comp('1 Old St', { condition: 'A' }), comp('2 Old St'), comp('3 Old St', { condition: 'D' })]);
  table = [row('Charlotte Lee', LISTING, '2026-10-03T10:00:00Z', JSON.parse(JSON.stringify(oldDraft)))];
  writes = []; snaps = [];
  page = await builder('Charlotte Lee');
  gs = await gradeState(page);
  ok(gs.flat && gs.sCond === 'B' && gs.grades.join(',') === 'A,C,D', 'a CMA saved before Oct 6, 2026 opens with its own letters', gs);
  ok(gs.cond.join(',') === '-5000,5000,15000', 'and its own dollar grades: B against A is -5,000, against C +5,000, against D +15,000, at any price', gs.cond);
  ok(gs.flatNotice && gs.flatBoxes && !gs.keyShown && !gs.key2Shown, 'it shows the dollar grade boxes and a notice that it keeps them, not the new key', [gs.flatNotice, gs.flatBoxes, gs.keyShown]);
  ok(/^B . Good$/.test(gs.sLabel), 'its grade names are the ones it was graded under', gs.sLabel);
  const oldPdf = await pdfText(page);
  ok(!/How Condition Is Valued|37,000|\(C3\)|percent of sale price/.test(oldPdf.text), 'its PDF has no key, no source note and no ratings: it prints what it printed before');
  await page.evaluate(() => addComp());
  ok((await page.evaluate(() => comps[3].condition)) === 'C', 'a row added to it starts on C, its own standard');
  await page.evaluate(() => { const el = document.getElementById('agentNotes'); el.value = 'edited'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2800);
  ok(table[0].draft_data.gradeMethod === 'flat' && table[0].draft_data.comps[0]._adj.condition === -5000, 'saved again, it is marked as a dollar-grade CMA and stays one', table[0].draft_data.gradeMethod);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  gs = await gradeState(page);
  ok(gs.flat && gs.cond.slice(0, 3).join(',') === '-5000,5000,15000', 'and reopens the same way', gs.cond);
  await page.context().close();

  // A draft saved before the change with nothing in it: no grades to protect.
  table = [row('Charlotte Lee', LISTING, '2026-10-03T10:00:00Z', draft('Charlotte Lee', [], { subject: Object.assign(subject('Charlotte Lee'), { condition: 'C' }) }))];
  page = await builder('Charlotte Lee');
  gs = await gradeState(page);
  ok(!gs.flat && gs.sCond === 'B', 'an old draft with no properties becomes a percent CMA, and its unchosen C is not carried over as a C', gs);
  await page.context().close();

  // ════════════════ EARLIER VERSIONS ════════════════
  console.log('Earlier versions, and Reset / New CMA');
  const snapList = (page) => page.evaluate(() => ({ text: document.getElementById('snapList').innerText.replace(/\s+/g, ' ').trim(), rows: document.querySelectorAll('#snapList .snap-row').length }));
  table = [row('Charlotte Lee', LISTING, '2026-10-05T10:00:00Z', draft('Charlotte Lee', [comp('1 Mine St'), comp('2 Mine St')], { gradeMethod: 'pct1' }))];
  writes = []; snaps = []; snapMode = 'ok'; snapBadWrites = [];
  page = await builder('Charlotte Lee');
  const dialogs = []; page.on('dialog', (d) => dialogs.push(d.message()));
  let sl = await snapList(page);
  ok(sl.rows === 0 && /No earlier versions yet/.test(sl.text), 'a CMA with no kept copies says so', sl);
  await page.evaluate(() => exportPDF()); await page.waitForTimeout(500);
  ok(snaps.length === 1 && snaps[0].reason === 'PDF exported' && snaps[0].agent_name === 'Charlotte Lee' && snaps[0].property_address === LISTING && snaps[0].draft_data.comps.length === 2 && /\$\d/.test(snaps[0].value_text), 'exporting the PDF keeps a copy of the whole CMA, with who, why and the value', snaps.map((x) => [x.reason, x.agent_name, x.value_text]));
  await page.evaluate(() => exportPDF()); await page.waitForTimeout(500);
  ok(snaps.length === 1, 'exporting again with nothing changed does not keep a second identical copy', snaps.length);
  sl = await snapList(page);
  ok(sl.rows === 1 && /PDF exported, by Charlotte Lee/.test(sl.text) && /Open this version/.test(sl.text), 'the copy is listed with its date, reason and agent', sl.text);

  // Reset / New CMA from a listing. A teammate has an older draft with comps.
  table.push(row('Marc Cashin', LISTING, '2026-10-04T10:00:00Z', draft('Marc Cashin', [comp('HIS OLD 1')])));
  writes = [];
  await page.evaluate(() => { document.getElementById('agentNotes').value = 'changed since the PDF'; });
  await page.evaluate(() => clearPrefill()); await page.waitForTimeout(700);
  ok(/Start a new CMA for this listing/.test(dialogs.join(' ')) && /MLS Data/.test(dialogs.join(' ')) && /kept under Earlier Versions/.test(dialogs.join(' ')), 'Reset says what it will do', dialogs);
  ok(snaps.length === 2 && snaps[1].reason === 'Before starting a new CMA' && snaps[1].draft_data.comps.length === 2 && snaps[1].draft_data.agentNotes === 'changed since the PDF', 'the CMA on screen is kept first, as it stood', snaps.map((x) => x.reason));
  let st = await page.evaluate(() => ({ n: comps.length, addr: document.getElementById('s_address').value, agent: document.getElementById('s_agentName').value, flat: document.body.classList.contains('cma-flat'), cond: document.getElementById('s_condition').value, notes: document.getElementById('agentNotes').value }));
  ok(st.n === 0 && st.addr === STREET && st.agent === 'Charlotte Lee' && !st.flat && st.cond === 'B', 'the new CMA has no comps and starts from the listing\'s own details, on the current grades', st);
  const mineRow = table.find((r) => r.agent_name === 'Charlotte Lee');
  ok(mineRow.draft_data.comps.length === 0 && !!mineRow.draft_data.startedFresh && mineRow.draft_data.gradeMethod === 'pct1', 'it is saved at once as her current CMA', [mineRow.draft_data.comps.length, mineRow.draft_data.startedFresh]);
  ok(!writes.some((w) => w.m === 'DELETE') && table.length === 2, 'nothing was deleted, and the teammate\'s draft is untouched', writes.map((w) => w.m));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  st = await state(page);
  ok(st.n === 0, 'reopened, it is still her new CMA: the teammate\'s older draft does not come back over it (it used to)', st.comps);
  sl = await snapList(page);
  ok(sl.rows === 2, 'both kept copies are listed', sl.text);

  // Open an earlier version.
  await page.evaluate(() => { addComp(); Object.assign(comps[0], { address: '9 New Try St', salePrice: 600000 }); buildCompsTable(); recalcAll(); });
  await page.click('#snapList .snap-row:last-child button'); await page.waitForTimeout(900);
  st = await state(page);
  ok(st.n === 2 && st.comps[0] === '1 Mine St', 'opening an earlier version puts its comps back on screen', st.comps);
  ok(snaps.length === 3 && snaps[2].reason === 'Before opening an earlier version' && snaps[2].draft_data.comps[0].address === '9 New Try St', 'what was on screen is kept first', snaps.map((x) => x.reason));
  ok(table.find((r) => r.agent_name === 'Charlotte Lee').draft_data.comps.length === 2, 'and the opened version is saved as her current CMA');
  ok(snapBadWrites.length === 0, 'the builder never tried to change or delete a kept copy', snapBadWrites);
  // A teammate saves after her reset: newest wins again.
  table.find((r) => r.agent_name === 'Marc Cashin').updated_at = new Date(Date.now() + 60000).toISOString();
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  st = await state(page);
  ok(st.n === 1 && st.comps[0] === 'HIS OLD 1', 'a teammate who saves AFTER her reset is new work on the listing, and opens', st.comps);
  await page.context().close();

  // A version saved under the dollar grades reopens under the dollar grades.
  table = [row('Charlotte Lee', LISTING, '2026-10-06T10:00:00Z', draft('Charlotte Lee', [comp('1 New St', { condition: 'B' })], { gradeMethod: 'pct1' }))];
  snaps = [{ id: 'snap-old', property_address: LISTING, agent_name: 'Charlotte Lee', reason: 'PDF exported', value_text: '$700,000', created_at: '2026-10-01T10:00:00.000Z', draft_data: JSON.parse(JSON.stringify(oldDraft)) }];
  page = await builder('Charlotte Lee');
  await page.click('#snapList .snap-row button'); await page.waitForTimeout(900);
  gs = await gradeState(page);
  ok(gs.flat && gs.cond.join(',') === '-5000,5000,15000', 'an earlier version built with dollar grades opens with its dollar grades and its own numbers: never converted', gs.cond);
  await page.context().close();

  // The one cost of "newest wins": her own older draft, replaced when she edits his newer one.
  table = [row('Charlotte Lee', LISTING, '2026-10-01T10:00:00Z', draft('Charlotte Lee', [comp('HERS OLD')])),
           row('Marc Cashin', LISTING, '2026-10-02T10:00:00Z', draft('Marc Cashin', [comp('HIS 1'), comp('HIS 2')]))];
  snaps = []; writes = [];
  page = await builder('Charlotte Lee');
  await page.waitForTimeout(2600);
  ok(snaps.length === 0 && writes.length === 0, 'opening his newer version keeps nothing and writes nothing by itself', [snaps.length, writes.length]);
  await page.evaluate(() => { const el = document.getElementById('agentNotes'); el.value = 'her edit'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2900);
  ok(snaps.length === 1 && /Your earlier draft/.test(snaps[0].reason) && /Marc Cashin/.test(snaps[0].reason) && snaps[0].draft_data.comps[0].address === 'HERS OLD', 'her own older draft is kept before her edit replaces it (it used to be lost)', snaps.map((x) => [x.reason, x.draft_data.comps[0].address]));
  ok(table.find((r) => r.agent_name === 'Charlotte Lee').draft_data.comps.length === 2, 'and her edit of his version is saved under her name');
  await page.context().close();

  // The table has not been created yet: everything else works and nothing is hidden.
  table = [row('Charlotte Lee', LISTING, '2026-10-05T10:00:00Z', draft('Charlotte Lee', [comp('1 Mine St')], { gradeMethod: 'pct1' }))];
  snaps = []; snapMode = 'missing';
  page = await builder('Charlotte Lee');
  const dialogs2 = []; page.on('dialog', (d) => dialogs2.push(d.message()));
  sl = await snapList(page);
  ok(/not switched on yet/.test(sl.text), 'with no versions table the list says earlier versions are not switched on yet', sl.text);
  await page.evaluate(() => { window.__toasts.length = 0; exportPDF(); }); await page.waitForTimeout(500);
  ok(!/could NOT be kept/.test(await page.evaluate(() => window.__toasts.join(' '))), 'the PDF still exports, with no repeated warning');
  await page.evaluate(() => clearPrefill()); await page.waitForTimeout(700);
  ok(dialogs2.some((d) => /could NOT be kept/.test(d) && /will be gone/.test(d)), 'Reset warns that the CMA on screen cannot be kept, and asks again before going on', dialogs2);
  await page.context().close();
  snapMode = 'fail';
  page = await builder('Charlotte Lee', PREFILL('Charlotte Lee'));
  await page.evaluate(() => { addComp(); Object.assign(comps[0], { address: '5 Fail St', salePrice: 500000 }); buildCompsTable(); recalcAll(); window.__toasts.length = 0; exportPDF(); }); await page.waitForTimeout(600);
  ok(/could NOT be kept under Earlier Versions/.test(await page.evaluate(() => window.__toasts.join(' '))), 'when keeping a copy fails for a real reason, the agent is told');
  sl = await snapList(page);
  await page.context().close();
  snapMode = 'ok';

  // Not opened from a listing: Reset gives a blank builder, as before, after keeping a copy.
  table = [{ id: 'x', agent_name: 'Charlotte Lee', property_address: '77 Typed Ave', updated_at: '2026-10-05T10:00:00Z', prefill_data: {}, draft_data: Object.assign(draft('Charlotte Lee', [comp('1 Typed Comp')], { gradeMethod: 'pct1' }), { subject: Object.assign(subject('Charlotte Lee'), { address: '77 Typed Ave' }) }) }];
  snaps = []; writes = [];
  const ctxT = await context('Charlotte Lee', null);
  await ctxT.addInitScript(() => { localStorage.setItem('fos_cma_address', '77 Typed Ave'); });
  page = await ctxT.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(origin + '/cma-tool.html', { waitUntil: 'load' }); await page.waitForTimeout(700);
  ok((await state(page)).n === 1, 'a CMA typed in without a listing opens');
  await page.evaluate(() => clearPrefill()); await page.waitForTimeout(1200);
  ok(snaps.length === 1 && snaps[0].reason === 'Before starting a new CMA' && table.length === 0 && (await state(page)).n === 0, 'Reset keeps a copy, then gives a blank builder', [snaps.length, table.length]);
  await page.context().close();

  ok(errors.length === 0, 'no page errors in any case', errors.slice(0, 5));
  await browser.close(); srv.close();
  console.log('\nFORWARD OS CMA Builder test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CMA Builder test crashed:', e); process.exit(2); });
