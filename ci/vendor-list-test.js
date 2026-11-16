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

  let r = await runHandler(async (u) => { ok(u === fn.CSV_URL && /18940w5PMmi8lEUNbYKJnTl3YVUEqB0gCKEqeqcysNqo/.test(u), 'the reader asks Google for the real list (Marc\'s sheet), as CSV', u); return { ok: true, status: 200, text: async () => CSV }; });
  ok(r.status === 200 && r.body.count === 24 && r.body.regions.length === 3 && !!r.body.readAt && /18940w5P/.test(r.body.sheetUrl), 'the reader answers with every vendor (24), the time read and the sheet\'s address', { s: r.status, c: r.body.count });
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
      : { viewport: { width: 1280, height: 860 } });
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
  const ranks = (page, cat) => page.locator('[data-fv-cat="' + cat + '"] .fv-vendor').evaluateAll(els => els.map(e => e.querySelector('.fv-rank').textContent.trim() + '.' + e.querySelector('.fv-name').textContent.trim()));

  // An agent opens the page from the menu.
  let { ctx, page } = await open('Niki Lang');
  ok(await page.locator('[data-nav-vendors]').count() === 1, 'Preferred Vendors is in the menu');
  const before = svc.calls;
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(svc.calls === before + 1, 'opening the page reads the list (one request)', svc.calls - before);
  ok(await page.locator('[data-fv]').isVisible(), 'the Preferred Vendors page opens');
  const tabs = await page.locator('[data-fv-region]').allInnerTexts();
  ok(JSON.stringify(tabs.map(t => t.trim())) === JSON.stringify(['Washington, DC', 'Maryland', 'Virginia']), 'the regions are the sheet\'s, in order', tabs);
  ok(await page.locator('[data-fv-region="Washington, DC"]').getAttribute('aria-selected') === 'true', 'Washington, DC is shown first');
  const cats = await page.locator('[data-fv-cat]').evaluateAll(els => els.map(e => e.getAttribute('data-fv-cat')));
  ok(JSON.stringify(cats) === JSON.stringify(['Architects', 'Barber/Haircut', 'Electrician', 'General Contractor', 'Home Inspector', 'House Cleaning', 'Movers', 'Mortgage', 'Title', 'Home Staging']), 'categories with vendors, in the sheet\'s order (HVAC has none)', cats);
  ok(JSON.stringify(await ranks(page, 'Electrician')) === JSON.stringify(['1.John Adeyemi', '2.William Wells']), 'the electricians are numbered 1 and 2 in the sheet\'s order');
  ok(JSON.stringify(await ranks(page, 'Home Inspector')) === JSON.stringify(['1.Adam Grate', '2.Jordan Bird', '3.Scott']), 'three home inspectors numbered 1, 2, 3');
  ok(await page.locator('[data-fv-cat="Electrician"] [data-fv-rank="1"] .fv-rank').getAttribute('aria-label') === 'Choice 1', 'the number reads as Choice 1 to a screen reader');
  ok(await page.locator('[data-fv-cat="Mortgage"] [data-fv-rank="1"] [data-fv-phone]').getAttribute('href') === 'tel:+12026695197', 'a phone number calls on a tap (digits only)');
  ok(await page.locator('[data-fv-cat="Mortgage"] [data-fv-rank="1"] [data-fv-email]').getAttribute('href') === 'mailto:Justin.Kraeger@neohomeloans.com', 'an email opens a new email');
  ok(await page.locator('[data-fv-cat="Movers"] [data-fv-web]').getAttribute('href') === 'https://www.bookstoremovers.com/', 'a website opens the website');
  ok(/would not use him on luxury properties/.test(await text(page, '[data-fv-cat="General Contractor"] [data-fv-rank="1"]')), 'a vendor\'s note is shown');
  ok(/Not filled in yet for Washington, DC: HVAC\./.test(await text(page, '[data-fv-empty]')), 'the categories not filled in yet are named');
  ok(/Read from Google Drive at .+ ET/.test(await text(page, '[data-fv-read]')), 'the page says when the list was read');
  ok(await page.locator('[data-fv-edit]').count() === 0, 'an agent does not see the edit link');
  await page.locator('[data-fv-region="Maryland"]').click(); await page.waitForTimeout(200);
  ok(JSON.stringify(await ranks(page, 'Electrician')) === JSON.stringify(['1.Walt Myer', '2.William Wells']), 'Maryland shows its own electricians, numbered 1 and 2');
  await page.locator('[data-fv-region="Washington, DC"]').click();
  await page.locator('[data-fv-search]').fill('scott'); await page.waitForTimeout(200);
  ok(JSON.stringify(await ranks(page, 'Home Inspector')) === JSON.stringify(['3.Scott']) && await page.locator('[data-fv-cat]').count() === 1, 'a search keeps the vendor\'s rank (Scott is still 3)');
  await page.locator('[data-fv-search]').fill('electric'); await page.waitForTimeout(200);
  ok(JSON.stringify(await ranks(page, 'Electrician')) === JSON.stringify(['1.John Adeyemi', '2.William Wells']), 'searching a trade finds the category');
  await page.locator('[data-fv-search]').fill('submarine'); await page.waitForTimeout(200);
  ok(/No vendor in Washington, DC matches "submarine"/.test(await text(page, '[data-fv-none]')), 'no match says so');
  await page.locator('[data-fv-search]').fill('');
  ok(!svc.googleCalls.length, 'the app itself never reads Google Drive (the reader does)', svc.googleCalls);

  // FORWARD Voice.
  ai.systems.length = 0;
  await page.evaluate(() => { const voiceModal = window.__st.voiceModal; voiceModal.show = true; voiceModal.transcript = 'who is our electrician in Maryland?'; voiceModal.answerQuestion = 'who is our electrician in Maryland?'; voiceModal.pendingAnswer = true; voiceModal.phase = 'answer-loading'; });
  await page.waitForTimeout(1500);
  const sys = ai.systems.find(s => /PREFERRED VENDOR LIST/.test(s)) || '';
  ok(!!sys, 'Voice\'s prompt carries the Preferred Vendor List', ai.systems.length);
  ok(/Choice 1: Walt Myer, Myer Electrical\. Phone: 301-941-1400/.test(sys) && /Choice 2: William Wells, CroppMetcalfe Services,\. Phone: \(301\) 313-0700/.test(sys), 'the list in the prompt is ranked, Choice 1 and Choice 2, with phones as written', sys.slice(sys.indexOf('Maryland'), sys.indexOf('Maryland') + 400));
  ok(/Choice 3: Test Vendor C, Made-up Co Three/.test(sys) && /Choice 3: Kelly Greenberg, KVS TITLE/.test(sys), 'every region and every vendor is in the prompt, not a slice');
  ok(/Note: Scott is the person that picks up the phone, "my go to" for inspections\./.test(sys), 'a note is in the prompt on one line, word for word');
  ok(/Use ONLY this list\. Never name anyone who is not on it/.test(sys) && /as "Choice 1", "Choice 2", "Choice 3"/.test(sys) && /Say which region/.test(sys) && /No vendor listed yet for: HVAC/.test(sys), 'the prompt tells Voice to name choices 1, 2, 3, only from the list, by region, and what is not filled in');
  ok(!/1vQ7Oa5e3xscm-RioS0mZtVtNdxhlLodPb2WOWnPvvKI/.test(await page.content()) && !svc.googleCalls.some(u => /1vQ7Oa5e/.test(u)), 'the March copy of the list is no longer read');
  const srcLink = page.locator('a.btn-navy', { hasText: 'Preferred Vendors' });
  ok(await srcLink.count() === 1, 'the answer\'s source button is Preferred Vendors');
  await page.locator('[data-nav-vendors]').evaluate(() => {}); // keep the page warm
  await page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.view = 'dashboard'; });
  await srcLink.click(); await page.waitForTimeout(400);
  const st1 = await page.evaluate(() => ({ view: document.querySelector('#app').__vue_app__._instance.setupState.view, show: window.__st.voiceModal.show }));
  ok(st1.view === 'vendors' && st1.show === false, 'the source button closes Voice and opens Preferred Vendors in the OS', st1);

  // The list cannot be read: Voice says so and names nobody.
  svc.mode = 'fail'; ai.systems.length = 0;
  await page.evaluate(() => { window.__st.fosVendors.readAt = '2000-01-01T00:00:00Z'; });
  await page.evaluate(() => { const voiceModal = window.__st.voiceModal; voiceModal.show = true; voiceModal.transcript = 'who is our plumber?'; voiceModal.answerQuestion = 'who is our plumber?'; voiceModal.pendingAnswer = true; voiceModal.phase = 'answer-loading'; });
  await page.waitForTimeout(1500);
  const sys2 = ai.systems.find(s => /PREFERRED VENDOR LIST/.test(s)) || '';
  ok(/could NOT be read from Google Drive just now \(Google Drive asked for a sign-in/.test(sys2) && /do not name any vendor/.test(sys2) && !/Walt Myer/.test(sys2), 'when the list cannot be read, the prompt says why, says to name nobody, and holds no older copy', sys2.slice(0, 300));
  await page.evaluate(() => { window.__st.voiceModal.show = false; });

  // The page with a failed read and an earlier copy on the device.
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(/could not be read from Google Drive\. Google Drive asked for a sign-in/.test(await text(page, '[data-fv-error]')) && /copy this device read at .+ ET; it may be out of date/.test(await text(page, '[data-fv-error]')), 'a failed read says why and that the earlier copy shown may be out of date');
  ok(await page.locator('[data-fv-cat="Electrician"]').count() === 1 && /earlier copy/.test(await text(page, '[data-fv-read]')), 'the earlier copy is shown and marked as such');
  svc.mode = 'ok';
  await page.locator('[data-fv-retry]').click(); await page.waitForTimeout(500);
  ok(await page.locator('[data-fv-error]').count() === 0 && !/earlier copy/.test(await text(page, '[data-fv-read]')), 'Try again reads it and the notice goes away');
  await ctx.close();

  // A device that never read the list, with Google Drive refusing.
  svc.mode = 'down';
  ({ ctx, page } = await open('Cesar Rivera'));
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(/could not be read from Google Drive/.test(await text(page, '[data-fv-error]')) && /Nothing can be shown until it is read/.test(await text(page, '[data-fv-error]')) && await page.locator('[data-fv-cat]').count() === 0, 'with no earlier copy, a failed read shows no list and says so');
  await ctx.close();
  svc.mode = 'ok';

  // Marc: the edit link, and the Agent Tools card.
  ({ ctx, page } = await open('Marc Cashin'));
  await page.evaluate(() => { document.querySelector('#app').__vue_app__._instance.setupState.go('agent-tools'); }); await page.waitForTimeout(500);
  const card = page.locator('[data-at-view="vendors"]');
  ok(await card.count() === 1 && (await card.textContent()).trim() === 'View the List', 'the Agent Tools card has View the List');
  await card.click(); await page.waitForTimeout(700);
  ok(await page.locator('[data-fv]').isVisible(), 'View the List opens Preferred Vendors in the OS');
  ok(/18940w5PMmi8lEUNbYKJnTl3YVUEqB0gCKEqeqcysNqo/.test(await page.locator('[data-fv-edit]').getAttribute('href') || ''), 'Marc sees Edit the list in Google Drive, to the real list');
  await ctx.close();
  ({ ctx, page } = await open('Operations'));
  await page.locator('[data-nav-vendors]').click(); await page.waitForTimeout(700);
  ok(await page.locator('[data-fv-edit]').count() === 1, 'Operations sees the edit link');
  await ctx.close();

  // A phone.
  ({ ctx, page } = await open('Niki Lang', { phone: true }));
  await page.evaluate(() => { document.querySelector('#app').__vue_app__._instance.setupState.go('vendors'); }); await page.waitForTimeout(800);
  const wide = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  ok(await page.locator('[data-fv-cat]').count() > 0 && wide.s <= wide.w, 'on a phone the page has no sideways scroll', wide);
  await ctx.close();

  ok(!errors.length, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
