#!/usr/bin/env node
/*
 * FORWARD OS: each agent downloads their OWN listing presentation from the OS.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium as every login, with a
 * made-up backend, and presses Download PDF in the tool inside a listing (the
 * old Listing Package panel, now only reachable for Marc's Refresh, too):
 *   - the request names exactly the signed-in agent, and the file opened is
 *     the one the backend returned for that agent;
 *   - an answer for another agent is never opened;
 *   - a failed download is said on screen and opens nothing;
 *   - Operations and Concierge get a plain message and send no request;
 *   - no Canva link is left anywhere in the app;
 *   - the real page count and the "Updated from Canva" time are shown;
 *   - only Marc sees Refresh from Canva, and it reports the result.
 *
 * Why (Marc, Oct 12, 2026): agents were sent to each deck's Canva edit link
 * and Canva refused anyone not signed in to the team account. The backend
 * now exports the decks and hands out the PDF.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/listing-presentation-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const LOGINS = ['Marc Cashin', 'Ashling McGowan', 'Niki Lang', 'Cesar Rivera', 'Charlotte Lee', 'Operations', 'Concierge'];
const HAS = LOGINS.slice(0, 5);
const PAGES = { 'Marc Cashin': 37 };
const PROP = { id: '31111111-1111-4111-8111-111111111111', address: '100 Test St, Washington, DC 20001', seller_name: 'Seller', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-01T00:00:00Z' };
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const fileUrl = a => 'https://store.example/signed/' + a.replace(/ /g, '_') + '.pdf?token=t&download=' + a.replace(/ /g, '_') + '_Listing_Presentation.pdf';

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
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok(!/canva\.com\/design\//.test(html), 'no Canva design link is left in the app');
  ok(!/listingPresentationUrl/.test(html), 'the old Canva link (listingPresentationUrl) is gone');

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function open(login, mode) {
    const seen = { downloads: [], refresh: 0, status: 0 };
    const state = { running: false, lastRun: null };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', (route) => {
      const req = route.request(), u = req.url(), m = req.method();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = req.resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (/\/api\/listing-presentation\?/.test(u)) {
        const asked = new URL(u).searchParams.get('agent');
        seen.downloads.push(asked);
        if (mode === 'fail') return J(route, 502, { detail: 'The presentation could not be fetched: store down' });
        if (mode === 'other') return J(route, 200, { agent: 'Cesar Rivera', url: fileUrl('Cesar Rivera'), file_name: 'Cesar_Rivera_Listing_Presentation.pdf', pages: 33 });
        if (!HAS.includes(asked)) return J(route, 404, { detail: 'There is no listing presentation for this login.' });
        return J(route, 200, { agent: asked, url: fileUrl(asked), file_name: asked.replace(/ /g, '_') + '_Listing_Presentation.pdf', pages: PAGES[asked] || 33, exported_at: '2026-10-12T22:07:00+00:00', expires_in: 300 });
      }
      if (/\/api\/listing-presentations\/status/.test(u)) {
        seen.status++;
        const agents = {};
        HAS.forEach(a => { agents[a] = { pages: PAGES[a] || 33, exported_at: '2026-10-12T22:07:00+00:00', has_file: true, last_error: null }; });
        return J(route, 200, { running: state.running, last_run: state.lastRun, agents });
      }
      if (/\/api\/listing-presentations\/refresh/.test(u) && m === 'POST') {
        seen.refresh++;
        state.lastRun = { ok: true, trigger: 'manual', at: new Date().toISOString(), results: HAS.map(a => ({ agent: a, result: 'updated' })) };
        return J(route, 200, { status: 'started' });
      }
      if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, [PROP]);
      if (m === 'GET') return J(route, 200, []);
      return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
    });
    await ctx.addInitScript((who) => {
      localStorage.setItem('fos_agent', who); localStorage.setItem('fos_key_' + who.replace(/ /g, '_'), 'test-key');
      window.__tabs = [];
      window.open = function () { const tab = { closed: false, location: { href: '' }, close() { this.closed = true; } }; window.__tabs.push(tab); return tab; };
    }, login);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
    return { ctx, page, seen, errors, state };
  }
  const st = (page, fn) => page.evaluate(fn);

  // ── the tool inside a listing, every login ──
  for (const login of LOGINS) {
    const w = await open(login);
    await st(w.page, () => (async function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('listings'); await new Promise(r => setTimeout(r, 400)); await s.lstOpenProperty(s.lstProperties[0]); await new Promise(r => setTimeout(r, 300)); s.lstToolOpen = 'presentation'; })());
    await w.page.waitForTimeout(700);
    const text = await w.page.locator('body').innerText();
    const btn = w.page.locator('.subfolder-body button', { hasText: 'Download PDF' });
    if (HAS.includes(login)) {
      ok(await btn.count() === 1, login + ': Download PDF is shown');
      ok(text.includes((PAGES[login] || 33) + ' pages'), login + ': the real page count is shown', text.match(/\d+ pages/));
      ok(/Updated from Canva/.test(text), login + ': the Updated from Canva time is shown');
      await btn.click(); await w.page.waitForTimeout(600);
      const tabs = await st(w.page, () => window.__tabs.map(t => ({ href: t.location.href, closed: t.closed })));
      ok(w.seen.downloads.length === 1 && w.seen.downloads[0] === login, login + ': the request names exactly the signed-in agent', w.seen.downloads);
      ok(tabs.length === 1 && tabs[0].href === fileUrl(login) && !tabs[0].closed, login + ': the file opened is that agent\'s own', tabs);
    } else {
      ok(await btn.count() === 0 && /no listing presentation for this login/.test(text), login + ': a plain message and no button');
      ok(w.seen.downloads.length === 0, login + ': no request is sent');
    }
    ok(w.errors.length === 0, login + ': no page errors', w.errors);
    await w.ctx.close();
  }

  // ── an answer for someone else is never opened ──
  {
    const w = await open('Niki Lang', 'other');
    await st(w.page, () => (async function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('listings'); await new Promise(r => setTimeout(r, 400)); await s.lstOpenProperty(s.lstProperties[0]); await new Promise(r => setTimeout(r, 300)); s.lstToolOpen = 'presentation'; })());
    await w.page.waitForTimeout(400);
    await w.page.locator('button', { hasText: 'Download PDF' }).click(); await w.page.waitForTimeout(600);
    const tabs = await st(w.page, () => window.__tabs.map(t => ({ href: t.location.href, closed: t.closed })));
    const text = await w.page.locator('body').innerText();
    ok(tabs.every(t => t.href === '' && t.closed), 'an answer naming another agent opens nothing', tabs);
    ok(/could not be downloaded/.test(text) && /someone else/.test(text), 'and it is said on screen');
    await w.ctx.close();
  }

  // ── a failed download is said and opens nothing ──
  {
    const w = await open('Charlotte Lee', 'fail');
    await st(w.page, () => (async function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('listings'); await new Promise(r => setTimeout(r, 400)); await s.lstOpenProperty(s.lstProperties[0]); await new Promise(r => setTimeout(r, 300)); s.lstToolOpen = 'presentation'; })());
    await w.page.waitForTimeout(400);
    await w.page.locator('button', { hasText: 'Download PDF' }).click(); await w.page.waitForTimeout(600);
    const tabs = await st(w.page, () => window.__tabs.map(t => ({ href: t.location.href, closed: t.closed })));
    const text = await w.page.locator('body').innerText();
    ok(tabs.every(t => t.href === '' && t.closed), 'a failed download opens nothing and closes the waiting tab', tabs);
    ok(/could not be downloaded: The presentation could not be fetched: store down/.test(text), 'a failed download is said on screen with the reason');
    await w.ctx.close();
  }

  // ── Refresh from Canva is Marc's only ──
  for (const login of ['Niki Lang', 'Operations']) {
    const w = await open(login);
    await st(w.page, () => (function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.view = 'just-listed'; s.lpOpen('presentation'); })());
    await w.page.waitForTimeout(400);
    ok(await w.page.locator('button', { hasText: 'Refresh from Canva' }).count() === 0, login + ': Refresh from Canva is not shown');
    await w.ctx.close();
  }

  // ── Marc's Refresh from Canva (old Listing Package panel; only Marc sees it) ──
  {
    const w = await open('Marc Cashin');
    await st(w.page, () => (function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.view = 'just-listed'; s.lpOpen('presentation'); })());
    await w.page.waitForTimeout(400);
    ok(await w.page.locator('button', { hasText: 'Download PDF' }).count() === 1, 'the old Listing Package panel shows Download PDF too');
    await w.page.locator('button', { hasText: 'Refresh from Canva' }).click();
    await w.page.waitForTimeout(6500);
    const text = await w.page.locator('body').innerText();
    ok(w.seen.refresh === 1, 'Refresh sends one request', w.seen.refresh);
    ok(/All five decks are up to date with Canva/.test(text), 'Refresh reports the result when the run finishes');
    ok(w.errors.length === 0, 'Refresh: no page errors', w.errors);
    await w.ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
