#!/usr/bin/env node
/*
 * FORWARD OS: Preferred Vendors (Marc, Nov 16, 2026). Run on every PR.
 *
 * Part 1, the reader (netlify/functions/vendor-list.js), on a made-up sheet laid out like
 * Marc's (ci/fixtures/vendor-list.csv: regions, categories with trailing hyphens, empty
 * slots, a quoted comma, a note over two lines, websites typed in the Company, Email and
 * Notes columns, invisible marks pasted around phone numbers). Every expectation below is
 * written out by hand, not taken from the code under test:
 * - regions and categories in the sheet's order; rank = order within a region and category;
 * - empty slots are not vendors; values copied as written, two display clean-ups only;
 * - a sheet that is not shared, a refusal and no answer each fail with the reason.
 *
 * Part 2, the app, in headless Chromium with the reader's real answer served:
 * - Preferred Vendors is in the menu and on the Agent Tools card; the page shows the
 *   regions, each category's vendors ranked 1, 2, 3 in the sheet's order, tap to call,
 *   email and website links, the categories not filled in yet, and when it was read;
 * - search keeps each vendor's rank; only Marc, Operations and Concierge see the edit link;
 * - a failed read says why; with an earlier copy on the device it shows that copy and says
 *   when it was read; with none it shows nothing;
 * - FORWARD Voice: the prompt carries the whole ranked list and the rules (choice 1, 2, 3,
 *   only vendors on the list, the region), never the March copy; when the list cannot be
 *   read the prompt says so and to name nobody; the answer's source opens this page;
 * - on a phone, no sideways scroll.
 *
 * SAFETY: never touches production or Google. Every request is intercepted.
 *
 * Usage: node ci/vendor-list-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH). CHROMIUM_PATH optional.
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const fn = require(path.resolve(dir, 'netlify/functions/vendor-list.js'));
const CSV = fs.readFileSync(path.resolve(dir, 'ci/fixtures/vendor-list.csv'), 'utf8');

let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function runHandler(fetchImpl) {
  const real = global.fetch;
  global.fetch = fetchImpl;
  try { const r = await fn.handler({}); return { status: r.statusCode, body: JSON.parse(r.body) }; }
  finally { global.fetch = real; }
}

(async () => {
  // ── Part 1. The reader ──────────────────────────────────────────────────────────────────
  console.log('Part 1: the reader');
  const regions = fn.parseVendorCsv(CSV);
  ok(JSON.stringify(regions.map(g => g.name)) === JSON.stringify(['Washington, DC', 'Maryland', 'Virginia']), 'three regions, in the sheet\'s order', regions.map(g => g.name));
  const dc = regions[0], md = regions[1], va = regions[2];
  const catsDC = dc.categories.map(c => c.name);
  ok(JSON.stringify(catsDC) === JSON.stringify(['Architects', 'Barber/Haircut', 'Electrician', 'General Contractor', 'Home Inspector', 'House Cleaning', 'Movers', 'Mortgage', 'Title', 'Home Staging', 'HVAC']),
    'DC categories in the sheet\'s order, trailing hyphens dropped, the empty HVAC slots kept as a category', catsDC);
  const cat = (g, n) => g.categories.find(c => c.name === n);
  const names = (g, n) => cat(g, n).vendors.map(v => v.rank + '.' + (v.name || v.company));
  ok(JSON.stringify(names(dc, 'Electrician')) === JSON.stringify(['1.John Adeyemi', '2.William Wells']), 'DC electricians ranked 1, 2 in the sheet\'s order; the empty third slot is not a vendor', names(dc, 'Electrician'));
  ok(JSON.stringify(names(dc, 'Title')) === JSON.stringify(['1.Smart Settlements', '2.Blake Motter', '3.Kelly Greenberg']), 'DC title ranked 1, 2, 3', names(dc, 'Title'));
  ok(JSON.stringify(names(md, 'Electrician')) === JSON.stringify(['1.Walt Myer', '2.William Wells']), 'Maryland electricians ranked on their own, 1 and 2', names(md, 'Electrician'));
  ok(JSON.stringify(names(va, 'Electrician')) === JSON.stringify(['1.Test Vendor A', '2.Test Vendor B', '3.Test Vendor C']), 'three Virginia electricians ranked 1, 2, 3', names(va, 'Electrician'));
  ok(cat(dc, 'HVAC').vendors.length === 0, 'a category with only empty slots has no vendor');
  const ww = cat(dc, 'Electrician').vendors[1];
  ok(ww.company === 'CroppMetcalfe Services,' && ww.phone === '(202) 635-0780', 'a company with a comma inside quotes is read whole, as written', ww);
  const mv = cat(dc, 'Movers').vendors[0];
  ok(mv.name === 'Bookstore Movers' && mv.company === '' && mv.website === 'https://www.bookstoremovers.com/' && mv.email === 'email@bookstoremovers.com', 'a web address typed in Company is the website, not the company', mv);
  const ag = cat(dc, 'Home Inspector').vendors[0];
  ok(ag.email === '' && ag.website === 'https://enlighteninspections.com/', 'a web address typed in Email is the website, not an email', ag);
  const hl = cat(dc, 'Home Staging').vendors[0];
  ok(hl.notes === '' && hl.website === 'https://www.eurostaging.com/' && hl.email === 'team@eurostaging.com', 'a note that is only a web address is the website', hl);
  const sc = cat(dc, 'Home Inspector').vendors[2];
  ok(sc.rank === 3 && sc.notes === 'Scott is the person that picks up the phone, "my go to"\nfor inspections.', 'a note with quotes and a line break is copied exactly', sc.notes);
  const ch = cat(dc, 'House Cleaning').vendors[0], jk = cat(dc, 'Mortgage').vendors[0];
  ok(ch.phone === '(703) 862-5904' && jk.phone === '+1 (202) 669-5197', 'invisible marks pasted around phone numbers are removed, nothing else', [ch.phone, jk.phone]);
  ok(jk.email === 'Justin.Kraeger@neohomeloans.com' && cat(dc, 'Title').vendors[2].phone === '240.235.3008', 'spaces at the ends of a value are trimmed');
  ok(cat(md, 'Architects').vendors[0].name === 'TJ Monahah', 'a name is copied as the sheet has it, typos included (nothing corrected silently)');
  const barber = cat(dc, 'Barber/Haircut').vendors[0];
  ok(barber.name === '' && barber.company === "Barber of Hell's Bottom" && barber.rank === 1, 'a vendor with a company and no name is still a vendor', barber);
  ok(!JSON.stringify(regions).includes('NAME') && !JSON.stringify(regions).includes('"COMPANY"'), 'the header row is not a vendor');
  const hv = cat(va, 'HVAC').vendors[0];
  ok(hv.name === '' && hv.company === '' && hv.phone === '703.777.9211' && hv.website === 'https://mannixhvac.com/', 'a vendor with only a phone and a website is kept as written', hv);
  ok(cat(va, 'Title').vendors[0].email === 'Steve@monarchtitle.net ; Erin@monarchtitle.net', 'a cell with two emails is copied as written (the app splits it)');

  let r = await runHandler(async (u) => { ok(u === fn.CSV_URL && /18940w5PMmi8lEUNbYKJnTl3YVUEqB0gCKEqeqcysNqo/.test(u), 'the reader asks Google for the real list (Marc\'s sheet), as CSV', u); return { ok: true, status: 200, text: async () => CSV }; });
  ok(r.status === 200 && r.body.count === 26 && r.body.regions.length === 3 && !!r.body.readAt && /18940w5P/.test(r.body.sheetUrl), 'the reader answers with every vendor (26), the time read and the sheet\'s address', { s: r.status, c: r.body.count });
  r = await runHandler(async () => ({ ok: true, status: 200, text: async () => '<!DOCTYPE html><html>Sign in</html>' }));
  ok(r.status === 502 && /no longer shared/.test(r.body.error), 'a sheet that is no longer shared fails with that reason', r);
  r = await runHandler(async () => ({ ok: false, status: 404, text: async () => 'nope' }));
  ok(r.status === 502 && /error 404/.test(r.body.error), 'Google refusing the list fails with its error number', r);
  r = await runHandler(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
  ok(r.status === 502 && /did not answer/.test(r.body.error), 'no answer from Google fails with the reason', r);
  r = await runHandler(async () => ({ ok: true, status: 200, text: async () => ',NAME,COMPANY,PHONE,EMAIL,NOTES\r\n\"Washington, DC\",,,,,\r\nHVAC,,,,,\r\n' }));
  ok(r.status === 502 && /no vendor rows/.test(r.body.error), 'a list with no vendor in it fails instead of showing an empty page as the list', r);


  // ── Part 2. The app ─────────────────────────────────────────────────────────────────────
  console.log('Part 2: the app');
  const good = await runHandler(async () => ({ ok: true, status: 200, text: async () => CSV }));
  const svc = { mode: 'ok', calls: 0, googleCalls: [] };
  // A made-up vendor_notes table that behaves like sql/2026-11-16_vendor_notes.sql: a retried
  // insert is ignored, the database stamps created_at, remove_vendor_note keeps the row and
  // lets only the writer, Marc or Operations remove it.
  const notes = { rows: [], mode: 'ok', posts: [], rpcs: [], reads: 0 };
  let clock = Date.parse('2026-11-16T15:00:00Z');
  function notesRoute(route) {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.endsWith('/rpc/remove_vendor_note')) {
      const b = JSON.parse(req.postData() || '{}'); notes.rpcs.push(b);
      if (notes.mode === 'fail') return J(route, 500, { message: 'database is down' });
      const r = notes.rows.find(x => x.id === b.p_id);
      if (!r) return J(route, 400, { message: 'that note was not found' });
      if (r.removed_at) return J(route, 400, { message: 'that note was already removed' });
      if (b.p_by !== r.agent_name && ['Marc Cashin', 'Operations'].indexOf(b.p_by) === -1) return J(route, 400, { message: 'only the agent who wrote a note, Marc or Operations can remove it' });
      r.removed_at = new Date(clock++).toISOString(); r.removed_by = b.p_by;
      return J(route, 200, r);
    }
    if (m === 'GET') {
      notes.reads++;
      if (notes.mode === 'fail' || notes.mode === 'readfail') return J(route, 500, { message: 'database is down' });
      const out = notes.rows.filter(r => !r.removed_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return J(route, 200, JSON.parse(JSON.stringify(out)));
    }
    if (m === 'POST') {
      const b = JSON.parse(req.postData() || '{}'); notes.posts.push(b);
      if (notes.mode === 'fail') return J(route, 500, { message: 'database is down' });
      if (!notes.rows.some(r => r.id === b.id)) notes.rows.push(Object.assign({}, b, { created_at: new Date(clock += 60000).toISOString(), removed_at: null }));
      return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    return J(route, 405, { message: 'not allowed' });
  }
  const ai = { systems: [], reply: 'For Maryland, here are your electricians:\nChoice 1: Walt Myer, Myer Electrical, 301-941-1400\nChoice 2: William Wells, CroppMetcalfe Services, (301) 313-0700\n[SOURCE: Preferred Vendor List]' };
  function sse(text) {
    const ev = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
    return ev({ type: 'message_start', message: { id: 'm', role: 'assistant', content: [] } })
      + ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      + ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
      + ev({ type: 'content_block_stop', index: 0 })
      + ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
      + ev({ type: 'message_stop' });
  }

  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(dir, decodeURIComponent(p));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(rs => srv.listen(0, '127.0.0.1', rs));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];

  async function open(agent, opts) {
    opts = opts || {};
    const ctx = await browser.newContext(opts.phone
      ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', (route) => {
      const req = route.request(), u = req.url();
      if (/docs\.google\.com/.test(u)) { svc.googleCalls.push(u); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); }
      if (u.startsWith(origin)) {
        if (u.includes('/.netlify/functions/vendor-list')) {
          svc.calls++;
          if (svc.mode === 'down') return route.abort('internetdisconnected');
          if (svc.mode === 'fail') return J(route, 502, { error: 'Google Drive asked for a sign-in: the list is no longer shared with "anyone with the link"' });
          return J(route, 200, good.body);
        }
        return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      }
      if (/\/rest\/v1\/(vendor_notes|rpc\/remove_vendor_note)/.test(u)) return notesRoute(route);
      if (/api\.anthropic\.com/.test(u)) {
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
        const body = JSON.parse(req.postData() || '{}');
        ai.systems.push(String(body.system || ''));
        if (body.stream) return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: sse(ai.reply) });
        return J(route, 200, { content: [{ type: 'text', text: '{"tool":"general-question","fields":{},"missing":[]}' }], stop_reason: 'end_turn' });
      }
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = req.resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (req.method() === 'GET') return J(route, 200, []);
      return J(route, 200, [{ id: 1 }]);
    });
    await ctx.addInitScript(({ a }) => {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('fos_agent', a); localStorage.setItem('fos_key_' + a.replace(/ /g, '_'), 'test-key');
      }
    }, { a: agent });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(agent + ': ' + e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.evaluate(async () => { window.__st = document.querySelector('#app').__vue_app__._instance.setupState; const st = window.__st; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
    await page.waitForTimeout(200);
    return { ctx, page };
  }
  const text = (page, sel) => page.locator(sel).first().innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const first = (page) => text(page, '[data-fv-first] [data-fv-name]');
  const rest = (page) => page.locator('.fv-row').evaluateAll(els => els.map(e => e.getAttribute('data-fv-rank') + '.' + e.querySelector('[data-fv-name]').textContent.trim()));
  const trade = async (page, t) => { await page.locator('[data-fv-trade="' + t + '"]').click(); await page.waitForTimeout(150); };

  // An agent opens the page from the menu.
  let { ctx, page } = await open('Niki Lang');
  ok(await page.locator('[data-nav-vendors]').count() === 1, 'Preferred Vendors is in the menu');
  const before = svc.calls;
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(svc.calls === before + 1 && notes.reads >= 1, 'opening the page reads the list (one request) and the team notes', { list: svc.calls - before, notes: notes.reads });
  const tabs = await page.locator('[data-fv-region]').allInnerTexts();
  ok(JSON.stringify(tabs.map(t => t.trim())) === JSON.stringify(['Washington, DC', 'Maryland', 'Virginia']), 'the regions are the sheet\'s, in order', tabs);
  ok(await page.locator('[data-fv-region="Washington, DC"]').getAttribute('aria-selected') === 'true', 'Washington, DC is shown first');
  const trades = await page.locator('[data-fv-trade]').evaluateAll(els => els.map(e => e.getAttribute('data-fv-trade') + ':' + e.querySelector('.n').textContent.trim()));
  ok(JSON.stringify(trades) === JSON.stringify(['Architects:1', 'Barber/Haircut:1', 'Electrician:2', 'General Contractor:2', 'Home Inspector:3', 'House Cleaning:1', 'Movers:1', 'Mortgage:2', 'Title:3', 'Home Staging:1', 'HVAC:None yet']), 'the trades in the sheet\'s order with how many vendors each has', trades);
  ok(await text(page, '[data-fv-trade-title]') === 'Architects' && await first(page) === 'TJ Monahan', 'the first trade with a vendor opens, its choice 1 as the First call');
  await trade(page, 'Electrician');
  ok(await first(page) === 'John Adeyemi' && /First call/.test(await text(page, '[data-fv-first]')) && await page.locator('[data-fv-first] .fv-big').getAttribute('aria-label') === 'Choice 1', 'Electrician: John Adeyemi is the First call, choice 1');
  ok(JSON.stringify(await rest(page)) === JSON.stringify(['2.William Wells']), 'then William Wells as choice 2, under If they cannot take it');
  ok(await page.locator('[data-fv-first] [data-fv-phone]').getAttribute('href') === 'tel:2024874544' && /Call\s*202-487-4544/.test(await text(page, '[data-fv-first] [data-fv-phone]')), 'the First call button dials the number and reads Call 202-487-4544');
  await trade(page, 'Home Inspector');
  ok(JSON.stringify(await rest(page)) === JSON.stringify(['2.Jordan Bird', '3.Scott']), 'three home inspectors in order, Scott is 3');
  ok(!/my go to|picks up the phone/.test(await text(page, '[data-fv]')), 'the sheet\'s Notes column is not shown');
  await trade(page, 'General Contractor');
  ok(!/would not use him on luxury/.test(await text(page, '[data-fv]')), 'no sheet note on any vendor');
  await trade(page, 'Mortgage');
  ok(await page.locator('[data-fv-first] [data-fv-phone]').getAttribute('href') === 'tel:+12026695197', 'a phone with marks pasted around it dials cleanly');
  await trade(page, 'Movers');
  ok(await page.locator('[data-fv-first] [data-fv-web]').getAttribute('href') === 'https://www.bookstoremovers.com/' && await text(page, '[data-fv-first] [data-fv-web]') === 'bookstoremovers.com', 'a website shows as its name and opens');
  await trade(page, 'HVAC');
  ok(/No hvac on the list for Washington, DC yet/.test(await text(page, '[data-fv-empty-trade]')) && /Virginia: mannixhvac.com/.test(await text(page, '[data-fv-empty-trade]')), 'an empty trade says so and offers the regions that have one, named by its website when it has no name');
  await page.locator('[data-fv-empty-trade] button', { hasText: 'Virginia' }).click(); await page.waitForTimeout(200);
  ok(await page.locator('[data-fv-region="Virginia"]').getAttribute('aria-selected') === 'true' && await first(page) === 'mannixhvac.com', 'one tap opens Virginia HVAC: mannixhvac.com is choice 1');
  await trade(page, 'Title');
  const mails = await page.locator('[data-fv-first] [data-fv-email]').evaluateAll(els => els.map(e => e.getAttribute('href')));
  ok(JSON.stringify(mails) === JSON.stringify(['mailto:Steve@monarchtitle.net', 'mailto:Erin@monarchtitle.net']), 'two emails in one cell are two links', mails);
  await page.locator('[data-fv-region="Maryland"]').click(); await page.waitForTimeout(200);
  ok(await text(page, '[data-fv-trade-title]') === 'Architects', 'a trade the region does not have is replaced by its first trade with a vendor');
  await trade(page, 'Electrician');
  ok(await first(page) === 'Walt Myer' && JSON.stringify(await rest(page)) === JSON.stringify(['2.William Wells']), 'Maryland electricians: Walt Myer 1, William Wells 2');
  await page.locator('[data-fv-region="Washington, DC"]').click();
  await page.locator('[data-fv-search]').fill('kraeger'); await page.waitForTimeout(200);
  ok(JSON.stringify(await page.locator('[data-fv-trade]').evaluateAll(els => els.map(e => e.getAttribute('data-fv-trade')))) === JSON.stringify(['Mortgage']), 'searching a name finds its trade');
  await page.locator('[data-fv-search]').fill('submarine'); await page.waitForTimeout(150);
  ok(/No trade or vendor matches "submarine"/.test(await text(page, '[data-fv-none]')), 'no match says so');
  await page.locator('[data-fv-search]').fill('');
  ok(/Read from Google Drive at .+ ET/.test(await text(page, '[data-fv-read]')) && /Not filled in yet for Washington, DC: HVAC\./.test(await text(page, '[data-fv-empty]')), 'the page says when it was read and which trades are not filled in');
  ok(await page.locator('[data-fv-edit]').count() === 0, 'an agent does not see the edit link');

  // A pick made far down the trade list brings its First call into view (Marc, Nov 16, 2026).
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.locator('[data-fv-trade="Home Staging"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  const before2 = await page.locator('[data-fv-trade-title]').evaluate(e => e.getBoundingClientRect().top);
  await page.locator('[data-fv-trade="Home Staging"]').click(); await page.waitForTimeout(900);
  const after2 = await page.locator('[data-fv-trade-title]').evaluate(e => e.getBoundingClientRect().top);
  const firstTop = await page.locator('[data-fv-first]').evaluate(e => e.getBoundingClientRect().top);
  ok(before2 < 0 && after2 >= 0 && after2 < 200 && firstTop < 500, 'picking a trade far down the list jumps back up to its heading and First call', { before2, after2, firstTop });
  const y0 = await page.evaluate(() => { const m = document.scrollingElement; return [window.scrollY, m.scrollTop]; });
  await page.evaluate(() => document.querySelector('[data-fv-trade="Title"]').click()); await page.waitForTimeout(400);
  const y1 = await page.evaluate(() => { const m = document.scrollingElement; return [window.scrollY, m.scrollTop]; });
  ok(JSON.stringify(y0) === JSON.stringify(y1), 'a pick made with the heading in view does not move the page', { y0, y1 });
  await page.setViewportSize({ width: 1440, height: 900 });

  // From the team.
  await trade(page, 'Electrician');
  ok(/No notes on these vendors yet/.test(await text(page, '[data-fv-notes-none]')), 'with no notes it says so');
  ok(await page.locator('[data-fv-post]').isDisabled(), 'Post is off until something is written');
  await page.locator('[data-fv-fb-vendor]').selectOption('William Wells');
  await page.locator('[data-fv-bad]').click();
  await page.locator('[data-fv-fb-text]').fill('Did not call back for three days.');
  notes.mode = 'fail';
  await page.locator('[data-fv-post]').click(); await page.waitForTimeout(400);
  ok(/NOT posted: .*database is down/.test(await text(page, '[data-fv-fb-error]')) && await page.locator('[data-fv-fb-text]').inputValue() === 'Did not call back for three days.', 'a failed post says NOT posted with the reason and keeps the text');
  notes.mode = 'ok';
  const p0 = notes.posts.length;
  await page.locator('[data-fv-post]').click(); await page.waitForTimeout(500);
  const sent = notes.posts.slice(p0);
  ok(sent.length === 1 && sent[0].vendor === 'William Wells' && sent[0].trade === 'Electrician' && sent[0].region === 'Washington, DC' && sent[0].good === false && sent[0].body === 'Did not call back for three days.' && sent[0].agent_name === 'Niki Lang' && /^[0-9a-f-]{36}$/.test(sent[0].id) && !('created_at' in sent[0]), 'one post: the vendor, trade, region, did not go well, the text, the agent and an id, no date', sent);
  ok(/Posted for the team/.test(await text(page, '[data-fv-fb-done]')) && await page.locator('[data-fv-fb-text]').inputValue() === '', 'posted is said only after the database took it, and the box is cleared');
  ok(await page.locator('[data-fv-note]').count() === 1 && /Niki Lang on William Wells/.test(await text(page, '[data-fv-note]')) && await page.locator('[data-fv-note] .fv-tone').getAttribute('aria-label') === 'Did not go well', 'the note shows with the agent, the vendor and Did not go well');
  ok(/1 note from the team below/.test(await text(page, '.fv-row[data-fv-rank="2"]')), 'the vendor\'s card says it has a note');
  notes.rows.push({ id: '9f1d2c3b-0000-4000-8000-000000000001', vendor: 'John Adeyemi', trade: 'Electrician', region: 'Washington, DC', good: true, body: 'Same-day fix.', agent_name: 'Cesar Rivera', created_at: new Date(clock += 60000).toISOString(), removed_at: null });
  await page.evaluate(() => window.__st.fosVendorNotesLoad()); await page.waitForTimeout(300);
  const order = await page.locator('[data-fv-note] .fv-tn-meta strong').allInnerTexts();
  ok(JSON.stringify(order) === JSON.stringify(['Cesar Rivera', 'Niki Lang']), 'notes are newest first', order);
  ok(await page.locator('[data-fv-note="9f1d2c3b-0000-4000-8000-000000000001"] [data-fv-rm]').count() === 0, 'an agent cannot remove another agent\'s note');
  const mine = page.locator('[data-fv-note]', { hasText: 'Niki Lang' });
  await mine.locator('[data-fv-rm]').click(); await page.waitForTimeout(100);
  ok(notes.rpcs.length === 0 && /Remove this note for everyone\?/.test(await mine.innerText()), 'Remove asks first and sends nothing yet');
  notes.mode = 'fail';
  await mine.locator('[data-fv-rm-yes]').click(); await page.waitForTimeout(400);
  ok(/NOT removed: .*database is down/.test(await text(page, '[data-fv-rm-error]')) && await page.locator('[data-fv-note]').count() === 2, 'a failed removal says NOT removed with the reason and the note stays');
  notes.mode = 'ok';
  await mine.locator('[data-fv-rm-yes]').click(); await page.waitForTimeout(500);
  const rpc = notes.rpcs[notes.rpcs.length - 1];
  ok(rpc && rpc.p_by === 'Niki Lang' && notes.rows.find(r => r.vendor === 'William Wells').removed_at && await page.locator('[data-fv-note]').count() === 1, 'the writer removes their own note through the database; it leaves the list and the row is kept', rpc);

  // FORWARD Voice.
  ai.systems.length = 0;
  await page.evaluate(() => { const voiceModal = window.__st.voiceModal; voiceModal.show = true; voiceModal.transcript = 'who is our electrician in Maryland?'; voiceModal.answerQuestion = 'who is our electrician in Maryland?'; voiceModal.pendingAnswer = true; voiceModal.phase = 'answer-loading'; });
  await page.waitForTimeout(1500);
  const sys = ai.systems.find(s => /PREFERRED VENDOR LIST/.test(s)) || '';
  ok(!!sys, 'Voice\'s prompt carries the Preferred Vendor List', ai.systems.length);
  ok(/Choice 1: Walt Myer, Myer Electrical\. Phone: 301-941-1400/.test(sys) && /Choice 2: William Wells, CroppMetcalfe Services,\. Phone: \(301\) 313-0700/.test(sys), 'the list in the prompt is ranked, Choice 1 and Choice 2, with phones as written');
  ok(/Choice 3: Test Vendor C, Made-up Co Three/.test(sys) && /Choice 3: Kelly Greenberg, KVS TITLE/.test(sys), 'every region and every vendor is in the prompt, not a slice');
  ok(/Choice 1: mannixhvac\.com\. Phone: 703\.777\.9211\. Website: https:\/\/mannixhvac\.com\//.test(sys) && /Email: Steve@monarchtitle\.net and Erin@monarchtitle\.net/.test(sys), 'a vendor with no name is named by its website, and two emails are both given');
  ok(!/my go to|would not use him/.test(sys), 'the sheet\'s Notes column is not in the prompt');
  ok(/The regions are: Washington, DC; Maryland; Virginia\./.test(sys) && /Use ONLY this list/.test(sys) && /"Choice 1", "Choice 2", "Choice 3"/.test(sys) && /No vendor listed yet for: HVAC/.test(sys), 'the prompt names the sheet\'s regions and the rules: only the list, choices in order, what is empty');
  ok(/TEAM NOTES ON THESE VENDORS/.test(sys) && /- John Adeyemi \(Electrician\): went well, Cesar Rivera, Nov 16, 2026: Same-day fix\./.test(sys) && !/Did not call back/.test(sys) && /"Agents report:"/.test(sys), 'Voice gets the team notes (not removed ones) with the rule to say them as Agents report', sys.slice(sys.indexOf('TEAM NOTES'), sys.indexOf('TEAM NOTES') + 300));
  ok(!/1vQ7Oa5e3xscm-RioS0mZtVtNdxhlLodPb2WOWnPvvKI/.test(await page.content()) && !svc.googleCalls.some(u => /1vQ7Oa5e/.test(u)), 'the March copy of the list is no longer read');
  const srcLink = page.locator('a.btn-navy', { hasText: 'Preferred Vendors' });
  ok(await srcLink.count() === 1, 'the answer\'s source button is Preferred Vendors');
  await page.evaluate(() => { window.__st.view = 'dashboard'; });
  await srcLink.click(); await page.waitForTimeout(400);
  const st1 = await page.evaluate(() => ({ view: window.__st.view, show: window.__st.voiceModal.show }));
  ok(st1.view === 'vendors' && st1.show === false, 'the source button closes Voice and opens Preferred Vendors in the OS', st1);

  // The team notes cannot be read: the list still answers, and Voice is told not to describe opinions.
  notes.mode = 'readfail'; ai.systems.length = 0;
  await page.evaluate(() => { window.__st.fosVendorNotes.readAt = 0; });
  await page.evaluate(() => { const v = window.__st.voiceModal; v.show = true; v.transcript = 'who is our plumber?'; v.answerQuestion = 'who is our plumber?'; v.pendingAnswer = true; v.phase = 'answer-loading'; });
  await page.waitForTimeout(1500);
  const sysN = ai.systems.find(s => /PREFERRED VENDOR LIST/.test(s)) || '';
  ok(/Choice 1: Walt Myer/.test(sysN) && /team notes could not be read just now/.test(sysN) && /Do not say what agents think/.test(sysN), 'when the team notes cannot be read, the list is still given and Voice is told so');
  await page.evaluate(() => { window.__st.voiceModal.show = false; });
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(600);
  await trade(page, 'Electrician');
  ok(/The team notes could not be loaded/.test(await text(page, '[data-fv-notes-error]')) && await page.locator('[data-fv-notes-none]').count() === 0, 'the page says the team notes could not be loaded, never "no notes"');
  notes.mode = 'ok';

  // The list cannot be read: Voice says so and names nobody.
  svc.mode = 'fail'; ai.systems.length = 0;
  await page.evaluate(() => { window.__st.fosVendors.readAt = '2000-01-01T00:00:00Z'; });
  await page.evaluate(() => { const v = window.__st.voiceModal; v.show = true; v.transcript = 'who is our plumber?'; v.answerQuestion = 'who is our plumber?'; v.pendingAnswer = true; v.phase = 'answer-loading'; });
  await page.waitForTimeout(1500);
  const sys2 = ai.systems.find(s => /PREFERRED VENDOR LIST/.test(s)) || '';
  ok(/could NOT be read from Google Drive just now \(Google Drive asked for a sign-in/.test(sys2) && /do not name any vendor/.test(sys2) && !/Walt Myer/.test(sys2), 'when the list cannot be read, the prompt says why, says to name nobody, and holds no older copy', sys2.slice(0, 300));
  await page.evaluate(() => { window.__st.voiceModal.show = false; });
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(/could not be read from Google Drive\. Google Drive asked for a sign-in/.test(await text(page, '[data-fv-error]')) && /copy this device read at .+ ET; it may be out of date/.test(await text(page, '[data-fv-error]')), 'a failed read says why and that the earlier copy shown may be out of date');
  ok(await page.locator('[data-fv-first]').count() === 1 && /earlier copy/.test(await text(page, '[data-fv-read]')), 'the earlier copy is shown and marked as such');
  svc.mode = 'ok';
  await page.locator('[data-fv-retry]').click(); await page.waitForTimeout(500);
  ok(await page.locator('[data-fv-error]').count() === 0 && !/earlier copy/.test(await text(page, '[data-fv-read]')), 'Try again reads it and the notice goes away');
  await ctx.close();

  // A device that never read the list, with Google Drive refusing.
  svc.mode = 'down';
  ({ ctx, page } = await open('Cesar Rivera'));
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(/Nothing can be shown until it is read/.test(await text(page, '[data-fv-error]')) && await page.locator('[data-fv-first]').count() === 0, 'with no earlier copy, a failed read shows no list and says so');
  await ctx.close();
  svc.mode = 'ok';

  // Marc: the edit link, the Agent Tools card, removing anyone's note.
  ({ ctx, page } = await open('Marc Cashin'));
  await page.evaluate(() => { window.__st.go('agent-tools'); }); await page.waitForTimeout(500);
  const card = page.locator('[data-at-view="vendors"]');
  ok(await card.count() === 1 && (await card.textContent()).trim() === 'View the List', 'the Agent Tools card has View the List');
  await card.click(); await page.waitForTimeout(700);
  ok(await page.locator('[data-fv]').isVisible(), 'View the List opens Preferred Vendors in the OS');
  ok(/18940w5PMmi8lEUNbYKJnTl3YVUEqB0gCKEqeqcysNqo/.test(await page.locator('[data-fv-edit]').getAttribute('href') || ''), 'Marc sees Edit the list in Google Drive, to the real list');
  await trade(page, 'Electrician');
  const ces = page.locator('[data-fv-note]', { hasText: 'Cesar Rivera' });
  ok(await ces.locator('[data-fv-rm]').count() === 1, 'Marc can remove another agent\'s note');
  await ctx.close();

  // A phone.
  ({ ctx, page } = await open('Niki Lang', { phone: true }));
  await page.evaluate(() => { window.__st.go('vendors'); }); await page.waitForTimeout(800);
  ok(await page.locator('[data-fv-region-select]').isVisible() && await page.locator('[data-fv-trade-select]').isVisible() && !(await page.locator('.fv-side').isVisible()) && !(await page.locator('.fv-regions').isVisible()), 'on a phone, region and trade are two dropdowns; the side list and pills are hidden');
  await page.locator('[data-fv-region-select]').selectOption('Maryland');
  await page.locator('[data-fv-trade-select]').selectOption('Electrician'); await page.waitForTimeout(200);
  ok(await first(page) === 'Walt Myer', 'picking Maryland and Electrician shows Walt Myer as the First call');
  const box = await page.locator('[data-fv-first] [data-fv-phone]').boundingBox();
  const wide = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  ok(box && box.height >= 44 && box.width > 250 && wide.s <= wide.w, 'the Call button is full width and at least 44 px tall; no sideways scroll', { box, wide });
  await page.locator('[data-fv-region-select]').selectOption('Washington, DC'); await page.waitForTimeout(150);
  const opt = await page.locator('[data-fv-trade-select] option', { hasText: 'HVAC' }).textContent();
  ok(/HVAC \(none yet\)/.test(opt), 'the trade dropdown says which trades have nobody yet', opt);
  await ctx.close();

  ok(!errors.length, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
