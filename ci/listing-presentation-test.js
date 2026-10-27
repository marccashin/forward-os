#!/usr/bin/env node
/*
 * FORWARD OS: each agent downloads their OWN listing presentation from the OS.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium as every login, with a
 * made-up backend, and presses Download PDF in the tool inside a listing:
 *   - the request names exactly the signed-in agent, and the file opened is
 *     the one the backend returned for that agent;
 *   - an answer for another agent is never opened;
 *   - a failed download is said on screen and opens nothing;
 *   - Operations and Concierge get a plain message and send no request;
 *   - no Canva link is left anywhere in the app;
 *   - the real page count and the "Updated from Canva" time are shown;
 *   - only Marc sees Refresh from Canva, inside the listing, and it reports the result;
 *   - Meet Your Advisor (was Seller Guide): each agent's own file, named to match;
 *     on a phone it opens inside the OS with Back and Share and never replaces the app.
 *   - Meet Your Advisor for BUYERS (Oct 27, 2026): the card on a buyer, real clicks.
 *     A computer downloads the agent's own buyer PDF under a Meet Your Advisor name;
 *     a phone opens it inside the OS; a login with no guide gets a message, no file.
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

  async function open(login, mode, phone) {
    const seen = { downloads: [], refresh: 0, status: 0 };
    const state = { running: false, lastRun: null };
    const ctx = await browser.newContext(phone
      ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', hasTouch: true, isMobile: true }
      : { viewport: { width: 1440, height: 900 } });
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
      // The listing has MLS Data, like a real one: without it every tool click goes to MLS Data first.
      if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, [{ id: 'n1', property_id: PROP.id, subfolder: 'mls_data', content: 'List Price: $900,000', updated_at: '2026-10-01T00:00:00Z' }]);
      if (m === 'GET') return J(route, 200, []);
      return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
    });
    await ctx.addInitScript((who) => {
      localStorage.setItem('fos_agent', who); localStorage.setItem('fos_key_' + who.replace(/ /g, '_'), 'test-key');
      window.__tabs = [];
      window.open = function () { const tab = { closed: false, location: { href: '' }, close() { this.closed = true; } }; window.__tabs.push(tab); return tab; };
    }, login);
    if (phone) await ctx.addInitScript((reader) => {
      // A stand-in for pdf.js (the CDN is blanked here): it reads the real PDF's
      // bytes, counts its pages from the bytes, and draws a blank page each.
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared.push({ name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, head: await d.files[0].slice(0, 5).text() }); };
      if (!reader) return;
      window.pdfjsLib = { GlobalWorkerOptions: { workerSrc: 'x' }, getDocument: ({ data }) => ({ promise: (async () => {
        const text = new TextDecoder('latin1').decode(data);
        if (!text.startsWith('%PDF-')) throw new Error('not a PDF');
        const n = Math.max(1, (text.match(/\/Type\s*\/Page[^s]/g) || []).length);
        return { numPages: n, getPage: async () => ({ getViewport: ({ scale }) => ({ width: 612 * scale, height: 792 * scale }), render: () => ({ promise: Promise.resolve() }) }) };
      })() }) };
    }, phone === 'noreader' ? false : true);
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

  // ── Refresh from Canva, inside a listing: the path Marc actually has ──
  // Until Oct 13, 2026 the button lived only in the old Listing Package panel,
  // which the app's navigation no longer opens (go('just-listed') goes to the
  // listings grid). This test reached it by setting the view directly, so it
  // passed while Marc could not see the button. Now: real clicks only.
  async function openInListing(page) {
    await st(page, () => (async function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('listings'); await new Promise(r => setTimeout(r, 400)); await s.lstOpenProperty(s.lstProperties[0]); })());
    // The listing opens MLS Data by itself once its notes load; wait for that
    // so it does not land after the click and close the tool again.
    await page.waitForFunction(() => document.querySelector('#app').__vue_app__._instance.setupState.lstToolOpen === 'mlsdata', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.locator('.subfolder-header', { hasText: 'Listing Presentation' }).first().click();
    await page.waitForTimeout(400);
  }

  // ── Refresh from Canva is Marc's only ──
  for (const login of ['Niki Lang', 'Operations']) {
    const w = await open(login);
    await openInListing(w.page);
    ok(await w.page.locator('button', { hasText: 'Refresh from Canva' }).count() === 0, login + ': Refresh from Canva is not shown');
    await w.ctx.close();
  }

  // ── Marc's Refresh from Canva, inside a listing ──
  {
    const w = await open('Marc Cashin');
    await openInListing(w.page);
    ok(await w.page.locator('button', { hasText: 'Download PDF' }).count() === 1, 'inside a listing Marc sees Download PDF');
    ok(await w.page.locator('button', { hasText: 'Refresh from Canva' }).isVisible(), 'inside a listing Marc sees Refresh from Canva');
    await w.page.locator('button', { hasText: 'Refresh from Canva' }).click();
    await w.page.waitForTimeout(6500);
    const text = await w.page.locator('body').innerText();
    ok(w.seen.refresh === 1, 'Refresh sends one request', w.seen.refresh);
    ok(/All five decks are up to date with Canva/.test(text), 'Refresh reports the result when the run finishes');
    ok(w.errors.length === 0, 'Refresh: no page errors', w.errors);
    await w.ctx.close();
  }

  // ── Meet Your Advisor (was Seller Guide), Oct 13, 2026 ──
  // On the phone home-screen app a link to a PDF on the OS's own site replaced
  // the app with no way back. Phones now open it in the OS with Back and Share.
  async function openAdvisor(page) {
    await st(page, () => (async function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('listings'); await new Promise(r => setTimeout(r, 400)); await s.lstOpenProperty(s.lstProperties[0]); })());
    // The listing opens MLS Data by itself once its notes load; wait for that
    // so it does not land after the click and close the tool again.
    await page.waitForFunction(() => document.querySelector('#app').__vue_app__._instance.setupState.lstToolOpen === 'mlsdata', null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.locator('.subfolder-header', { hasText: 'Meet Your Advisor' }).first().click();
    await page.waitForTimeout(300);
  }
  {
    const html2 = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    ok(!/subfolder-tool-name">Seller Guide</.test(html2) && !/lp-label">Seller Guide</.test(html2), 'the name Seller Guide is gone from Listing Tools and the Listing Package');
  }
  for (const login of HAS) {   // computer: a named download of the agent's own file, no viewer
    const w = await open(login);
    await openAdvisor(w.page);
    const a = w.page.locator('.subfolder-body a', { hasText: 'Download PDF' });
    const href = await a.getAttribute('href'), dl = await a.getAttribute('download');
    ok(href === '/seller-guides/' + login.replace(/ /g, '_') + '_Seller_Guide.pdf', login + ': computer link is their own file', href);
    ok(dl === login.replace(/ /g, '_') + '_Meet_Your_Advisor.pdf', login + ': the file is named Meet Your Advisor', dl);
    ok(fs.existsSync(path.join(dir, href)), login + ': the file exists in the site');
    await a.click({ modifiers: [] }).catch(() => {});
    await w.page.waitForTimeout(300);
    ok(await w.page.locator('.pdf-view').count() === 0, login + ': a computer does not open the in-app viewer');
    await w.ctx.close();
  }
  for (const login of ['Niki Lang', 'Marc Cashin']) {   // phone: stays in the OS, Back returns, Share sends the right file
    const w = await open(login, null, 'reader');
    await openAdvisor(w.page);
    const before = w.page.url();
    await w.page.locator('.subfolder-body a', { hasText: 'Download PDF' }).click();
    await w.page.waitForTimeout(1200);
    ok(w.page.url() === before, login + ' phone: the app is not replaced by the PDF', w.page.url());
    ok(await w.page.locator('.pdf-view').isVisible(), login + ' phone: the PDF opens inside the OS');
    ok(await w.page.locator('.pdf-view-btn', { hasText: 'Back' }).isVisible(), login + ' phone: a Back button is on screen');
    const title = await w.page.locator('.pdf-view-title').innerText();
    ok(title === 'Meet Your Advisor: ' + login, login + ' phone: the viewer names the agent', title);
    const pages = await w.page.locator('.pdf-view-page').count();
    ok(pages === 2, login + ' phone: both pages are shown', pages);
    await w.page.locator('.pdf-view-btn', { hasText: 'Share' }).click();
    await w.page.waitForTimeout(300);
    const shared = await w.page.evaluate(() => window.__shared);
    const own = fs.statSync(path.join(dir, 'seller-guides', login.replace(/ /g, '_') + '_Seller_Guide.pdf')).size;
    ok(shared.length === 1 && shared[0].name === login.replace(/ /g, '_') + '_Meet_Your_Advisor.pdf' && shared[0].type === 'application/pdf' && shared[0].head === '%PDF-' && shared[0].size === own,
       login + ' phone: Share hands over their own PDF, named Meet Your Advisor', shared);
    await w.page.locator('.pdf-view-btn', { hasText: 'Back' }).click();
    await w.page.waitForTimeout(300);
    ok(await w.page.locator('.pdf-view').count() === 0, login + ' phone: Back closes the viewer');
    ok(await w.page.locator('.subfolder-header', { hasText: 'Meet Your Advisor' }).first().isVisible(), login + ' phone: Back returns to the listing');
    ok(w.errors.length === 0, login + ' phone: no page errors', w.errors);
    await w.ctx.close();
  }
  {   // phone with no PDF reader: says so, still never leaves the OS, Share still works
    const w = await open('Cesar Rivera', null, 'noreader');
    await openAdvisor(w.page);
    const before = w.page.url();
    await w.page.locator('.subfolder-body a', { hasText: 'Download PDF' }).click();
    await w.page.waitForTimeout(1200);
    const note = await w.page.locator('.pdf-view-body').innerText();
    ok(w.page.url() === before && /could not be shown: .*Share/.test(note), 'phone, no reader: stays in the OS and says to use Share', note);
    await w.page.locator('.pdf-view-btn', { hasText: 'Share' }).click();
    await w.page.waitForTimeout(300);
    ok((await w.page.evaluate(() => window.__shared)).length === 1, 'phone, no reader: Share still works');
    await w.ctx.close();
  }
  {   // Operations on a phone: no file, no viewer
    const w = await open('Operations', null, 'reader');
    await openAdvisor(w.page);
    const t = await w.page.locator('.subfolder-body').first().innerText();
    ok(/Meet Your Advisor is made for each agent/.test(t) && await w.page.locator('.subfolder-body a', { hasText: 'Download PDF' }).count() === 0, 'Operations: a plain message, no file');
    await w.ctx.close();
  }

  // ── Meet Your Advisor for BUYERS (Marc, Oct 27, 2026) ──
  // A card on the buyer, next to Consultation Kit. The card is the only way in, so
  // every case below clicks it; nothing is reached by setting state.
  const BUYER = { id: 'b1111111-1111-4111-8111-111111111111', buyer_name: 'Test Buyer', agent_name: 'Marc Cashin', status: 'active' };
  const buyerFile = login => '/buyer-guides/' + login.replace(/ /g, '_') + '_Buyer_Guide.pdf';
  const buyerName = login => login.replace(/ /g, '_') + '_Meet_Your_Advisor_Buyers.pdf';
  async function openBuyerCard(page) {
    await page.evaluate((b) => (async function(){ const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('buyer-package'); await new Promise(r => setTimeout(r, 300)); await s.byrOpenBuyer(b); })(), BUYER);
    await page.waitForTimeout(500);
    const card = page.locator('[data-myab]:visible');
    ok(await card.count() === 1, 'buyer: exactly one Meet Your Advisor card is on screen', await card.count());
    return card;
  }
  {
    const html3 = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    ok((html3.match(/data-myab="1"/g) || []).length === 2, 'buyer: the card is in both the computer and the phone grid');
    for (const login of HAS) {
      const f = path.join(dir, buyerFile(login));
      const head = fs.existsSync(f) ? fs.readFileSync(f).slice(0, 5).toString('latin1') : '';
      ok(head === '%PDF-', login + ': their buyer guide exists in the site and is a PDF', f);
    }
  }
  for (const login of HAS) {   // computer: a named download of the agent's own buyer file, no viewer
    const w = await open(login);
    const card = await openBuyerCard(w.page);
    const [dl] = await Promise.all([w.page.waitForEvent('download', { timeout: 5000 }).catch(() => null), card.click()]);
    ok(!!dl && new URL(dl.url()).pathname === buyerFile(login), login + ': the buyer card downloads their own file', dl && dl.url());
    ok(!!dl && dl.suggestedFilename() === buyerName(login), login + ': named Meet Your Advisor (Buyers)', dl && dl.suggestedFilename());
    ok(await w.page.locator('.pdf-view').count() === 0, login + ': a computer does not open the in-app viewer');
    ok(w.errors.length === 0, login + ' buyer card: no page errors', w.errors);
    await w.ctx.close();
  }
  {   // phone: stays in the OS, both pages, Back returns to the buyer, Share sends the right file
    const login = 'Niki Lang';
    const w = await open(login, null, 'reader');
    const card = await openBuyerCard(w.page);
    const before = w.page.url();
    await card.click(); await w.page.waitForTimeout(1200);
    ok(w.page.url() === before, 'buyer phone: the app is not replaced by the PDF', w.page.url());
    ok(await w.page.locator('.pdf-view').isVisible(), 'buyer phone: the PDF opens inside the OS');
    ok(await w.page.locator('.pdf-view-page').count() === 2, 'buyer phone: both pages are shown');
    await w.page.locator('.pdf-view-btn', { hasText: 'Share' }).click(); await w.page.waitForTimeout(300);
    const shared = await w.page.evaluate(() => window.__shared);
    const own = fs.statSync(path.join(dir, buyerFile(login))).size;
    ok(shared.length === 1 && shared[0].name === buyerName(login) && shared[0].head === '%PDF-' && shared[0].size === own, 'buyer phone: Share hands over their own buyer PDF', shared);
    await w.page.locator('.pdf-view-btn', { hasText: 'Back' }).click(); await w.page.waitForTimeout(300);
    ok(await w.page.locator('.pdf-view').count() === 0 && await w.page.locator('[data-myab]:visible').count() === 1, 'buyer phone: Back returns to the buyer');
    ok(w.errors.length === 0, 'buyer phone: no page errors', w.errors);
    await w.ctx.close();
  }
  for (const login of ['Operations', 'Concierge']) {   // no guide: a message, no file, no viewer
    const w = await open(login);
    const card = await openBuyerCard(w.page);
    const [dl] = await Promise.all([w.page.waitForEvent('download', { timeout: 1500 }).catch(() => null), card.click()]);
    await w.page.waitForTimeout(300);
    const text = await w.page.locator('body').innerText();
    ok(!dl && await w.page.locator('.pdf-view').count() === 0 && /Meet Your Advisor is made for each agent/.test(text), login + ': buyer card gives a plain message and no file');
    await w.ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
