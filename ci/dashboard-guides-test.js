#!/usr/bin/env node
/*
 * FORWARD OS: Guides & SOPs on the Dashboard. Run on every pull request.
 *
 * Opens the real index.html in headless Chromium and checks, with real clicks:
 * - every login (agents, Marc, Operations, Concierge) sees the Guides & SOPs panel
 *   on the Dashboard, right under the Deal Cards & SOP Tasks card, with every guide in
 *   FOS_GUIDES and its date;
 * - every guide's file is in the repo and is a PDF (a guide pointing at a missing
 *   file would open a blank tab);
 * - on a computer a guide opens in a new tab at its own address and the OS stays on
 *   the Dashboard;
 * - on a phone a guide opens in the in-app viewer: no new tab, the app is not
 *   replaced, the viewer is titled with the guide, and the page has no sideways scroll.
 *
 * Why: Marc, Nov 13, 2026: the If This, Then That guide moves from the listing's
 * Deal Progress tab to the Dashboard, in a folder that will hold every guide, SOP and
 * memo agents reference.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/dashboard-guides-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// The list as written in index.html, read independently of the app.
const m = html.match(/\nconst FOS_GUIDES = (\[[\s\S]*?\n\]);\n/);
const GUIDES = m ? Function('"use strict"; return (' + m[1] + ');')() : [];

const PROPS = [1, 2].map(n => ({ id: n + '1111111-1111-4111-8111-111111111111', address: n + '00 Test St, Washington DC 2000' + n, seller_name: 'Seller ' + n, agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-0' + n + 'T00:00:00Z' }));
const BUYERS = [1, 2].map(n => ({ id: n + '2222222-2222-4222-8222-222222222222', buyer_name: 'Buyer Number' + n, agent_name: 'Marc Cashin', stage: 'Pipeline' }));
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), mt = req.method();
  if (mt === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (mt === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (mt === 'GET' && /\/buyers(\?|$)/.test(u)) return J(route, 200, BUYERS);
  if (mt === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 500) : '')); } }

(async () => {
  ok(GUIDES.length >= 1, 'FOS_GUIDES is in index.html and lists at least one guide', GUIDES.length);
  ok(GUIDES.some(g => g.url === '/guides/FORWARD_If_This_Then_That.pdf' && g.title === 'If This, Then That'), 'the If This, Then That guide is in the list');
  ok(new Set(GUIDES.map(g => g.id)).size === GUIDES.length, 'every guide has its own id');
  for (const g of GUIDES) {
    const f = path.join(dir, g.url);
    const isPdf = fs.existsSync(f) && fs.readFileSync(f).slice(0, 5).toString() === '%PDF-';
    ok(/^\/guides\/[^/]+\.pdf$/.test(g.url) && isPdf, g.title + ': its file is in guides/ and is a PDF', g.url);
    ok(g.file === path.basename(g.url), g.title + ': the download name is the file name', g.file);
    ok(['id', 'title', 'sub', 'url', 'file', 'dated'].every(k => typeof g[k] === 'string' && g[k].trim()), g.title + ': every field is filled');
    ok(!/[–—]/.test(g.title + g.sub), g.title + ': no long dash in the wording');
  }

  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(dir, decodeURIComponent(p));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = p.endsWith('.html') ? 'text/html' : p.endsWith('.pdf') ? 'application/pdf' : 'text/javascript';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function open(agent, phone) {
    const opts = phone
      ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } };
    const ctx = await browser.newContext(opts);
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    await ctx.addInitScript((a) => { localStorage.setItem('fos_agent', a); localStorage.setItem('fos_key_' + a.replace(/ /g, '_'), 'test-key'); }, agent);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; st.go('dashboard'); });
    await page.waitForTimeout(400);
    return { ctx, page, errors };
  }
  const state = (page) => page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; return { view: st.view, pdfShow: st.pdfView.show, pdfTitle: st.pdfView.title, pdfFile: st.pdfView.fileName }; });

  // Every login sees the panel and every guide.
  for (const agent of ['Marc Cashin', 'Niki Lang', 'Ashling McGowan', 'Operations', 'Concierge']) {
    const { ctx, page, errors } = await open(agent, false);
    const panel = page.locator('[data-guides]');
    ok(await panel.count() === 1 && await panel.isVisible(), agent + ': the Guides & SOPs panel is on the Dashboard');
    const txt = (await panel.count()) ? await panel.innerText() : '';
    ok(/Guides & SOPs/i.test(txt), agent + ': the panel is titled Guides & SOPs', txt.slice(0, 80));
    ok(await page.locator('[data-guide]').count() === GUIDES.length, agent + ': one button per guide', await page.locator('[data-guide]').count());
    for (const g of GUIDES) {
      const b = page.locator('[data-guide="' + g.id + '"]');
      const label = ((await b.innerText()) || '').trim(), tip = (await b.getAttribute('title')) || '';
      ok(label.toLowerCase() === g.title.toLowerCase() && tip.includes(g.sub) && tip.includes(g.dated), agent + ': ' + g.title + ' is a button with its name, and its description and date on hover', { label, tip });
    }
    // Marc, Nov 13, 2026: right under the Deal Cards & SOP Tasks card, above the stat cards.
    const place = await page.evaluate(() => {
      const g = document.querySelector('[data-guides]');
      const fub = document.querySelector('[data-fub-reminder]');
      if (fub && !/Deal Cards & SOP Tasks/i.test(fub.textContent)) return { right: false, beforeStats: false, why: 'marker not on the Deal Cards card' };
      const stats = document.querySelector('.stat-grid');
      return { right: !!(g && fub && fub.nextElementSibling === g), beforeStats: !!(g && stats && (g.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING)) };
    });
    ok(place.right && place.beforeStats, agent + ': the panel is right under Deal Cards & SOP Tasks and above the stat cards', place);
    ok(errors.length === 0, agent + ': no page errors', errors);
    await ctx.close();
  }

  // Computer: a new tab at the guide's own address; the OS stays on the Dashboard.
  {
    const { ctx, page, errors } = await open('Charlotte Lee', false);
    for (const g of GUIDES) {
      // Headless Chromium hands a PDF to a download, so the new tab's address can stay
      // blank: read the request the new tab made for the file instead.
      const asked = [];
      const onReq = (r) => { if (r.isNavigationRequest()) asked.push(new URL(r.url()).pathname); };
      ctx.on('request', onReq);
      const [tab] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.locator('[data-guide="' + g.id + '"]').click()]);
      await page.waitForTimeout(1200);
      ctx.off('request', onReq);
      ok(!!tab && asked.includes(g.url), 'computer: ' + g.title + ' opens in a new tab at its own file', asked);
      ok(page.url() === origin + '/index.html', 'computer: the OS tab itself did not leave the app', page.url());
      const s = await state(page);
      ok(s.view === 'dashboard' && !s.pdfShow, 'computer: the OS stays on the Dashboard, no viewer', s);
      if (tab) await tab.close();
    }
    ok(errors.length === 0, 'computer: no page errors', errors);
    await ctx.close();
  }

  // Phone: the in-app viewer, never a new tab, never replacing the app.
  {
    const { ctx, page, errors } = await open('Cesar Rivera', true);
    const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(width <= 0, 'phone: the Dashboard has no sideways scroll with the panel', width);
    for (const g of GUIDES) {
      const before = page.url();
      let newTab = null; const h = (p) => { newTab = p; }; ctx.on('page', h);
      await page.locator('[data-guide="' + g.id + '"]').tap(); await page.waitForTimeout(800);
      ctx.off('page', h);
      const s = await state(page);
      ok(!newTab, 'phone: ' + g.title + ' opens no new tab', newTab && newTab.url());
      ok(page.url() === before, 'phone: the app is not replaced', page.url());
      ok(s.pdfShow && s.pdfTitle === g.title && s.pdfFile === g.file, 'phone: ' + g.title + ' opens in the in-app viewer with its title and file name', s);
      await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.pdfViewClose()); await page.waitForTimeout(200);
      ok((await state(page)).view === 'dashboard', 'phone: closing the viewer is back on the Dashboard');
    }
    ok(errors.length === 0, 'phone: no page errors', errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
