#!/usr/bin/env node
/*
 * FORWARD OS: the showing tour plan in Tour Tracker (Nov 1, 2026; mockup approved by Marc Oct 30).
 *
 * Real index.html in headless Chromium, real clicks and typing, against a made-up backend for
 * /api/tour/route, /api/tour/lookup and /api/tour/compare and a made-up agent_tours table.
 * Covers: plan mode (the exact request, the order the backend chose, the suggested times, the map),
 * a changed tour marked out of date and refused for a PDF, a refused address said with its reason,
 * confirmed mode with a timing warning, the listing look-up (one request per home, sources shown,
 * two pages that disagree picked by the agent, a typed figure, a bad typed price refused), red notes
 * and overview problems that stop sending, comparisons written only from the confirmed figures and
 * lines with commentary or an unknown number refused, the buyer's PDF (what is on it and what is
 * not), the agent's PDF, sending on a computer (download and email draft) and on a phone (share menu,
 * after a reload, maps worked out again; a changed result sends nothing), an old tour with no plan,
 * the 8-home limit, the open tour still saving after Tour Tracker is reopened, and no sideways
 * scroll on a phone.
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const A = '101 Sample St, Alexandria, VA 22314', B = '202 Example Ave Unit 4, Alexandria, VA 22314', C = '303 Demo Ct, Arlington, VA 22201';
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }

const S = (url, v) => ({ display: v, source_url: url });
const LOOK = {
  [A]: { address: A, found: true, matched_address: '101 Sample St, Alexandria, VA 22314', status: 'Active', problems: [], dropped_without_source: 0, looked_up_at: '2026-11-01T14:00:00Z',
    fields: {
      list_price: { display: '$1,150,000', sources: [{ display: '$1,150,000', number: 1150000, source_url: 'https://www.realtor.com/a' }, { display: '$1,150,000', number: 1150000, source_url: 'https://www.homes.com/a' }], conflict: false, values: ['$1,150,000'] },
      beds: { display: '4', sources: [{ display: '4', number: 4, source_url: 'https://www.realtor.com/a' }], conflict: false, values: ['4'] },
      baths_full: { display: '3', sources: [{ display: '3', number: 3, source_url: 'https://www.realtor.com/a' }], conflict: false, values: ['3'] },
      baths_half: { display: '1', sources: [{ display: '1', number: 1, source_url: 'https://www.realtor.com/a' }], conflict: false, values: ['1'] },
      sqft: { display: '1,840', sources: [{ display: '1,840', number: 1840, source_url: 'https://www.realtor.com/a' }, { display: '1,792', number: 1792, source_url: 'https://www.redfin.com/a' }], conflict: true, values: ['1,840', '1,792'] },
      days_on_market: { display: '6', sources: [{ display: '6', number: 6, source_url: 'https://www.homes.com/a' }], conflict: false, values: ['6'] } },
    overview: { text: 'A renovated brick colonial with a fenced garden and a two-car garage.', source_url: 'https://www.realtor.com/a', issues: [] } },
  [B]: { address: B, found: true, matched_address: '202 Example Ave #2, Alexandria, VA 22314', status: 'Active', dropped_without_source: 0, looked_up_at: '2026-11-01T14:00:00Z',
    problems: ['Check the address: the listing found is 202 Example Ave #2, Alexandria, VA 22314, not unit 4', 'Not found on any page: Half baths. Fill these in yourself'],
    fields: {
      list_price: { display: '$1,095,000', sources: [{ display: '$1,095,000', number: 1095000, source_url: 'https://www.homes.com/b' }], conflict: false, values: ['$1,095,000'] },
      beds: { display: '3', sources: [{ display: '3', number: 3, source_url: 'https://www.homes.com/b' }], conflict: false, values: ['3'] },
      baths_full: { display: '2', sources: [{ display: '2', number: 2, source_url: 'https://www.homes.com/b' }], conflict: false, values: ['2'] },
      sqft: { display: '2,105', sources: [{ display: '2,105', number: 2105, source_url: 'https://www.homes.com/b' }], conflict: false, values: ['2,105'] },
      days_on_market: { display: '22', sources: [{ display: '22', number: 22, source_url: 'https://www.homes.com/b' }], conflict: false, values: ['22'] } },
    overview: { text: 'A three-level townhouse with a rooftop deck.', source_url: 'https://www.homes.com/b', issues: [] } },
  [C]: { address: C, found: true, matched_address: '303 Demo Ct, Arlington, VA 22201', status: 'Active', problems: [], dropped_without_source: 0, looked_up_at: '2026-11-01T14:00:00Z',
    fields: {
      list_price: { display: '$985,000', sources: [{ display: '$985,000', number: 985000, source_url: 'https://www.redfin.com/c' }], conflict: false, values: ['$985,000'] },
      beds: { display: '3', sources: [{ display: '3', number: 3, source_url: 'https://www.redfin.com/c' }], conflict: false, values: ['3'] },
      baths_full: { display: '2', sources: [{ display: '2', number: 2, source_url: 'https://www.redfin.com/c' }], conflict: false, values: ['2'] },
      baths_half: { display: '1', sources: [{ display: '1', number: 1, source_url: 'https://www.redfin.com/c' }], conflict: false, values: ['1'] },
      sqft: { display: '1,610', sources: [{ display: '1,610', number: 1610, source_url: 'https://www.redfin.com/c' }], conflict: false, values: ['1,610'] },
      days_on_market: { display: '14', sources: [{ display: '14', number: 14, source_url: 'https://www.redfin.com/c' }], conflict: false, values: ['14'] } },
    overview: { text: 'A stunning corner home with a balcony.', source_url: 'https://www.redfin.com/c', issues: ['uses "stunning"'] } },
};

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
  const B_ = { route: [], lookup: [], compare: [], upserts: [] };
  let toursJson = null;           // what the made-up agent_tours table holds
  let routeShift = 0;             // minutes added to confirmed times by the made-up route (a changed result)
  let compareAnswer = null;

  function routeAnswer(body) {
    if (body.stops.some(s => /Nowhere/.test(s.address))) return [422, { detail: 'Google could only place 9 Nowhere Ln approximately (it matched Virginia, USA). Check the spelling, city and ZIP' }];
    if (body.stops.length > 8) return [422, { detail: 'A tour needs 1 to 8 homes' }];
    let stops;
    if (body.mode === 'plan') {
      const order = body.stops.slice().sort((a, b) => b.address.localeCompare(a.address));     // the made-up best order
      let t = 600;
      stops = order.map((s, i) => { const st = t; t = st + s.minutes + 15; return { stop: i + 1, address: s.address, start: hm(st), end: hm(st + s.minutes), minutes: s.minutes, lat: 38.8, lng: -77.1, google_address: s.address + ', USA' }; });
    } else {
      const sorted = body.stops.slice().sort((a, b) => a.start.localeCompare(b.start));
      stops = sorted.map((s, i) => ({ stop: i + 1, address: s.address, start: hm(mins(s.start) + routeShift), end: hm(mins(s.end) + routeShift), minutes: mins(s.end) - mins(s.start), lat: 38.8, lng: -77.1, google_address: s.address + ', USA' }));
    }
    const legs = stops.slice(1).map((s, i) => ({ from: i + 1, to: i + 2, drive_min: 12, gap_min: mins(s.start) - mins(stops[i].end),
      warning: body.mode === 'confirmed' && mins(s.start) - mins(stops[i].end) < 17 ? 'Leaving stop ' + (i + 1) + ' at ' + stops[i].end + ', the drive is about 12 min, so you reach stop ' + (i + 2) + ' around ' + hm(mins(stops[i].end) + 12) + '; its showing starts at ' + s.start : '' }));
    return [200, { mode: body.mode, date: body.date, buffer_minutes: 5, stops, legs, warnings: legs.filter(l => l.warning).map(l => l.warning), traffic: true, maps: { agent: PNG, client: PNG } }];
  }
  function hm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  function mins(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

  async function ctxFor(device) {
    const ctx = await browser.newContext(device === 'phone' ? { userAgent: IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true } : { viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await ctx.route('**/*', async (route) => {
      const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      if (/\/api\/tour\/route/.test(u)) { const b = JSON.parse(req.postData()); B_.route.push(b); const [st, body] = routeAnswer(b); return J(route, st, body); }
      if (/\/api\/tour\/lookup/.test(u)) { const b = JSON.parse(req.postData()); B_.lookup.push(b); await new Promise(r => setTimeout(r, 50)); return LOOK[b.address] ? J(route, 200, LOOK[b.address]) : J(route, 502, { detail: 'The listing search did not finish' }); }
      if (/\/api\/tour\/compare/.test(u)) { const b = JSON.parse(req.postData()); B_.compare.push(b); return J(route, 200, compareAnswer ? compareAnswer(b) : { homes: [] }); }
      if (/\/rest\/v1\/agent_tours/.test(u) && m === 'GET') return J(route, 200, toursJson ? [{ tours_json: toursJson }] : []);
      if (/\/rest\/v1\/agent_tours/.test(u)) { const b = JSON.parse(req.postData()); B_.upserts.push(b); toursJson = b.tours_json; return J(route, 201, [b]); }
      const t = req.resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      if (m === 'GET') return J(route, 200, []);
      return J(route, 200, [{ id: 1 }]);
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('fos_agent', 'Charlotte Lee'); localStorage.setItem('fos_key_Charlotte_Lee', 'test-key');
      window.__shared = []; window.__anchors = [];
      Object.defineProperty(navigator, 'canShare', { value: (d) => !!(d && d.files && d.files.length), configurable: true });
      Object.defineProperty(navigator, 'share', { value: async (d) => { window.__shared.push({ name: d.files[0].name, type: d.files[0].type, raw: await d.files[0].text() }); }, configurable: true });
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (/^mailto:/.test(this.href) || this.download) { window.__anchors.push({ href: this.href, download: this.download }); return; }
        return click.call(this);
      };
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(device + ': ' + e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1200);
    return { ctx, page };
  }
  const st = (page, fn, arg) => page.evaluate(new Function('arg', 'const st = document.querySelector("#app").__vue_app__._instance.setupState; return (async () => {' + fn + '})();'), arg);
  const wait = (page, ms) => page.waitForTimeout(ms || 150);
  // The text jsPDF draws, line by line, joined with spaces (a wrapped sentence reads whole).
  function drawn(raw) {
    const out = [];
    raw.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (m, x) => { out.push(x.replace(/\\([()\\])/g, '$1')); return m; });
    return out.join(' ').replace(/\s+/g, ' ');
  }
  async function pdfText(page, src) {
    return drawn(await page.evaluate(async (src) => {
      const st = document.querySelector('#app').__vue_app__._instance.setupState;
      const blob = src === 'viewer' ? st.pdfViewerBlob : await (await fetch(src)).blob();
      return blob ? await blob.text() : '';
    }, src));
  }

  // ── Computer ──
  let { ctx, page } = await ctxFor('computer');
  await st(page, `st.go('tour-tracker'); await new Promise(r => setTimeout(r, 300));
    st.tt.newTourName = 'Saturday Showings'; st.tt.newTourBuyer = 'Pat Doe'; st.ttCreateTour();
    for (const a of arg) { st.tt.newPropAddr = a; st.ttAddProperty(); }`, [A, B, C]);
  await wait(page, 300);
  console.log('Plan the route');
  ok(await page.locator('[data-tp]').count() === 1 && await page.locator('[data-tp-home]').count() === 3, 'the tour shows the Showing Tour Plan with its 3 homes');
  await page.click('[data-tp-run]'); await wait(page);
  ok(B_.route.length === 0 && /Pick the date/.test(await page.locator('[data-tp-error]').innerText()), 'with no date, Find the best order sends nothing and says to pick the date');
  await page.fill('[data-tp-date]', '2026-11-07'); await page.fill('[data-tp-first]', '10:00');
  const sel = page.locator('[data-tp-minutes]');
  await sel.nth(0).selectOption('30'); await sel.nth(1).selectOption('15');
  await page.click('[data-tp-run]'); await wait(page);
  ok(B_.route.length === 0 && /Pick the time at home 3/.test(await page.locator('[data-tp-error]').innerText()), 'a home with no time picked: nothing is sent and the home is named');
  await sel.nth(2).selectOption('45');
  await page.click('[data-tp-run]'); await wait(page, 300);
  ok(B_.route.length === 1 && JSON.stringify(B_.route[0]) === JSON.stringify({ mode: 'plan', date: '2026-11-07', buffer_minutes: 5, stops: [{ address: A, minutes: 30 }, { address: B, minutes: 15 }, { address: C, minutes: 45 }], start_time: '10:00' }), 'one request with the date, the first time, each home and its own time, the 5 minute buffer', B_.route[0]);
  let addrs = await page.locator('[data-tp-home] .tp-addr').allInnerTexts();
  ok(JSON.stringify(addrs) === JSON.stringify([C, B, A]), 'the homes follow the order the route chose', addrs);
  let planned = await page.locator('[data-tp-planned]').allInnerTexts();
  ok(JSON.stringify(planned) === JSON.stringify(['10:00 am to 10:45 am', '11:00 am to 11:15 am', '11:30 am to 12:00 pm']), 'each home shows its suggested times, the time picked staying with its home', planned);
  ok(await page.locator('[data-tp-leg]').count() === 2 && await page.locator('[data-tp-map]').count() === 1, 'the drives and the route map show');
  await page.locator('[data-tp-minutes]').nth(0).selectOption('60'); await wait(page);
  ok(await page.locator('[data-tp-stale]').count() === 1 && await page.locator('[data-tp-planned]').count() === 0, 'changing a time marks the route out of date and hides the old times');
  await page.click('[data-tp-agentpdf]'); await wait(page);
  ok(/changed since the route/.test(await page.locator('[data-tp-pdferr]').innerText()) && !(await st(page, 'return !!st.pdfViewerSrc')), 'an out-of-date route makes no PDF and says why');
  await page.click('[data-tp-run]'); await wait(page, 300);
  ok(B_.route.length === 2 && await page.locator('[data-tp-stale]').count() === 0, 'pressing again brings it up to date');
  await page.click('[data-tp-agentpdf]'); await wait(page, 500);
  let t = await pdfText(page, 'viewer');
  ok(/AGENT COPY/.test(t) && /PLANNED times, not yet confirmed/.test(t) && /Add showing instructions here/.test(t) && t.includes('303 Demo Ct') && t.includes('Tour for Pat Doe') && /12 min drive/.test(t), 'your copy: agent copy, planned times marked, notes box, homes and drives', t.length);
  await st(page, 'st.closePDFViewer()');
  ok(await page.locator('[data-tp-send]').isDisabled() && /Times confirmed/.test(await page.locator('[data-tp-sendwhy]').innerText()), 'Send to buyer is off with planned times, and says to enter the confirmed ones');

  console.log('A refused address');
  await st(page, 'st.tt.newPropAddr = "9 Nowhere Ln, VA"; st.ttAddProperty();');
  await page.locator('[data-tp-minutes]').nth(3).selectOption('15');
  await page.click('[data-tp-run]'); await wait(page, 300);
  addrs = await page.locator('[data-tp-home] .tp-addr').allInnerTexts();
  ok(/NOT worked out: Google could only place 9 Nowhere Ln approximately/.test(await page.locator('[data-tp-error]').innerText()) && addrs[0] === C && addrs[3] === '9 Nowhere Ln, VA', 'the reason Google gave is shown and nothing moves', addrs);
  await st(page, 'st.ttRemoveProperty(st.tt.activeTour.properties[3].id)');
  await st(page, 'for (let i = 0; i < 6; i++) { st.tt.newPropAddr = (i + 1) + "00 Extra Rd, Arlington, VA 22201"; st.ttAddProperty(); }');
  const nRoute = B_.route.length;
  await page.click('[data-tp-run]'); await wait(page);
  ok(B_.route.length === nRoute && /up to 8 homes, and this tour has 9\. Remove 1/.test(await page.locator('[data-tp-error]').innerText()), 'a ninth home: nothing is sent and the limit is said');
  await st(page, 'st.tt.activeTour.properties.splice(3); st.ttSaveTours();');

  console.log('Times confirmed');
  await page.click('[data-tp-mode="confirmed"]'); await wait(page);
  const sIn = page.locator('[data-tp-start]'), eIn = page.locator('[data-tp-end]');
  // On screen: C, B, A. Confirmed: A first, then C, then B.
  await sIn.nth(2).fill('10:00'); await eIn.nth(2).fill('10:30');
  await sIn.nth(0).fill('10:35'); await eIn.nth(0).fill('11:00');
  await sIn.nth(1).fill('11:30'); await eIn.nth(1).fill('12:00');
  await page.click('[data-tp-run]'); await wait(page, 300);
  const rb = B_.route[B_.route.length - 1];
  ok(rb.mode === 'confirmed' && !rb.start_time && JSON.stringify(rb.stops) === JSON.stringify([{ address: C, start: '10:35', end: '11:00' }, { address: B, start: '11:30', end: '12:00' }, { address: A, start: '10:00', end: '10:30' }]), 'Check the times sends each home with its confirmed start and end', rb);
  addrs = await page.locator('[data-tp-home] .tp-addr').allInnerTexts();
  ok(JSON.stringify(addrs) === JSON.stringify([A, C, B]), 'the homes follow the clock', addrs);
  const legs = await page.locator('[data-tp-leg]').allInnerTexts();
  ok(/12 min drive/.test(legs[0]) && /Leaving stop 1 at 10:30 am, the drive is about 12 min, so you reach stop 2 around 10:42 am; its showing starts at 10:35 am/.test(legs[0]) && !/reach/.test(legs[1]), 'a drive that does not fit is said on its line, and one that fits is not', legs);

  console.log('Check the figures');
  ok(/0 of 18/.test(await page.locator('[data-tp-progress]').innerText()), 'nothing is confirmed before the look-up');
  await page.click('[data-tp-lookall]'); await wait(page, 600);
  ok(B_.lookup.length === 3 && JSON.stringify(B_.lookup.map(x => x.address).sort()) === JSON.stringify([A, B, C].sort()) && B_.lookup.every(x => Object.keys(x).length === 1), 'Look up the listings sends one request per home with only its address', B_.lookup);
  const boxA = page.locator('[data-tp-figs]').nth(0), boxB = page.locator('[data-tp-figs]').nth(2), boxC = page.locator('[data-tp-figs]').nth(1);
  const hrefs = await boxA.locator('[data-tp-fig="list_price"] a').evaluateAll(as => as.map(a => a.href));
  ok(JSON.stringify(hrefs) === JSON.stringify(['https://www.realtor.com/a', 'https://www.homes.com/a']), 'a figure shows the pages it came from, as links', hrefs);
  ok(await boxA.locator('[data-tp-conflict] [data-tp-pickone]').count() === 2 && await boxA.locator('[data-tp-fig="sqft"] [data-tp-tick]').count() === 0, 'two pages that disagree: both shown, no tick, the agent picks');
  ok(/not unit 4/.test(await boxB.locator('[data-tp-flag]').innerText()), 'a wrong unit is a red note on that home');
  for (const k of ['list_price', 'beds', 'baths_full', 'baths_half', 'days_on_market']) await boxA.locator('[data-tp-fig="' + k + '"] [data-tp-tick]').click();
  await boxA.locator('[data-tp-pickone]').nth(1).click(); await wait(page);
  ok(/6 of 18/.test(await page.locator('[data-tp-progress]').innerText()) && /1,792/.test(await boxA.locator('[data-tp-fig="sqft"] [data-tp-confirmed]').innerText()), 'ticks and the pick count, and the picked figure is the one kept');
  await boxC.locator('[data-tp-type="list_price"]').fill('1.2M'); await boxC.locator('[data-tp-type="list_price"]').press('Enter'); await wait(page);
  ok(await boxC.locator('[data-tp-fig="list_price"] [data-tp-confirmed]').count() === 0 && /price in dollars/.test(await boxC.locator('[data-tp-figerr]').innerText()), 'a price typed as 1.2M is refused, not read as $1');
  for (const k of ['list_price', 'beds', 'baths_full', 'baths_half', 'sqft', 'days_on_market']) await boxC.locator('[data-tp-fig="' + k + '"] [data-tp-tick]').click();
  for (const k of ['list_price', 'beds', 'baths_full', 'sqft', 'days_on_market']) await boxB.locator('[data-tp-fig="' + k + '"] [data-tp-tick]').click();
  await boxB.locator('[data-tp-type="baths_half"]').fill('0'); await boxB.locator('[data-tp-type="baths_half"]').press('Enter'); await wait(page);
  ok(/typed by Charlotte Lee/.test(await boxB.locator('[data-tp-fig="baths_half"]').innerText()) && /18 of 18/.test(await page.locator('[data-tp-progress]').innerText()), 'a typed figure is confirmed in the agent\'s name; every figure counted');
  ok(/stunning/.test(await boxC.locator('[data-tp-ovissue]').innerText()) && await boxC.locator('[data-tp-ovok]').count() === 0, 'an overview with a word FORWARD does not use is quoted in red and cannot be ticked');
  await page.click('[data-tp-compare]'); await wait(page);
  ok(B_.compare.length === 0 && /Home 1 still needs: tick the overview/.test(await page.locator('[data-tp-cmperr]').innerText()), 'Write the comparisons sends nothing while a home is not signed off, and names it');
  await boxC.locator('[data-tp-overview]').fill('A corner home with a balcony.'); await boxC.locator('[data-tp-ovok]').check();
  await boxA.locator('[data-tp-ovok]').check();
  await boxB.locator('[data-tp-ovok]').check();
  await page.click('[data-tp-compare]'); await wait(page);
  ok(B_.compare.length === 0 && /red note/.test(await page.locator('[data-tp-cmperr]').innerText()), 'the red note on home 3 still stops it');
  await boxB.locator('[data-tp-flagok]').check();
  compareAnswer = (b) => ({ homes: b.homes.map(h => ({ stop: h.stop, issues: [], comparison: h.stop === 2 ? 'A corner home that may leave room to negotiate.' : h.stop === 3 ? 'A townhouse with 999 square feet more than the others.' : 'A brick colonial, the largest at 1,792 square feet.' })) });
  await page.click('[data-tp-compare]'); await wait(page, 300);
  const cb = B_.compare[0];
  ok(B_.compare.length === 1 && JSON.stringify(cb.homes) === JSON.stringify([
    { stop: 1, address: A, overview: 'A renovated brick colonial with a fenced garden and a two-car garage.', list_price: '$1,150,000', beds: '4', baths_full: '3', baths_half: '1', sqft: '1,792', days_on_market: '6' },
    { stop: 2, address: C, overview: 'A corner home with a balcony.', list_price: '$985,000', beds: '3', baths_full: '2', baths_half: '1', sqft: '1,610', days_on_market: '14' },
    { stop: 3, address: B, overview: 'A three-level townhouse with a rooftop deck.', list_price: '$1,095,000', beds: '3', baths_full: '2', baths_half: '0', sqft: '2,105', days_on_market: '22' }]), 'the comparison request carries exactly the confirmed figures and overviews, in tour order', cb && cb.homes);
  const issues = await page.locator('[data-tp-cmpissue]').allInnerTexts();
  ok(issues.length === 2 && /negotiat/.test(issues[0]) && /999/.test(issues[1]), 'a line with negotiating commentary and a line with a number not in the figures are both refused', issues);
  ok(await page.locator('[data-tp-send]').isDisabled() && /Fix the comparison for home 2/.test(await page.locator('[data-tp-sendwhy]').innerText()), 'Send to buyer stays off and says which line to fix');
  await page.locator('[data-tp-cmp]').nth(1).fill('A corner condo with a balcony, the lowest price on the tour at $985,000.');
  await page.locator('[data-tp-cmp]').nth(2).fill('A three-level townhouse with a rooftop deck and the most space, 2,105 square feet.');
  await page.fill('[data-tp-notes]', 'Lockbox on the side door, code 4417.'); await wait(page);
  ok(await page.locator('[data-tp-cmpissue]').count() === 0 && !(await page.locator('[data-tp-send]').isDisabled()), 'with the lines fixed, Send to buyer turns on');

  console.log('Send on a computer');
  await page.click('[data-tp-send]'); await wait(page, 600);
  const an = await page.evaluate(() => window.__anchors);
  const dl = an.find(a => a.download), mail = an.find(a => /^mailto:/.test(a.href));
  ok(dl && /^Showing-Tour-2026-11-07-Pat-Doe\.pdf$/.test(dl.download) && mail && /subject=Your%20showing%20tour%2C%20Saturday%2C%20November%207%2C%202026/.test(mail.href), 'the PDF downloads under the tour\'s name and an email draft opens', an);
  t = await pdfText(page, dl.href);
  const must = ['Your Saturday Tour', '3 homes, in the order we will see them', '101 Sample St', '303 Demo Ct', '202 Example Ave', '10:00 am to 10:30 am', '10:35 am to 11:00 am', '$1,150,000', '1,792', '$985,000', '2,105', '22 days', '3 full, 1 half', '2 full', 'lowest price on the tour', 'Listing details from public listing pages as of November 1, 2026, checked by your agent', 'FORWARD | Corcoran McEnearney'];
  const missing = must.filter(x => !t.includes(x.replace(/\(/g, '\\(').replace(/\)/g, '\\)')) && !t.includes(x));
  ok(missing.length === 0, 'the buyer\'s copy has the homes in order, the times, every confirmed figure, the comparisons and the source line', missing);
  const never = ['AGENT COPY', 'min drive', 'Lockbox', 'Timing', 'NOTES', '1,840', 'room to negotiate', 'Prepared by'];
  ok(never.filter(x => t.includes(x)).length === 0, 'the buyer\'s copy has no route, drives, warnings, notes, the figure not picked, or the refused line', never.filter(x => t.includes(x)));
  await page.click('[data-tp-agentpdf]'); await wait(page, 500);
  t = await pdfText(page, 'viewer');
  ok(/AGENT COPY/.test(t) && t.includes('Lockbox on the side door, code 4417.') && t.includes('you reach stop 2 around 10:42 am') && t.includes('Timing') && t.includes('Figures confirmed by Charlotte Lee in FORWARD OS') && !/PLANNED/.test(t), 'your copy: the warning, your notes, who confirmed the figures; no PLANNED once times are confirmed');
  await st(page, 'st.closePDFViewer()');
  ok(B_.upserts.length > 0 && /"compareSig"/.test(toursJson) && /"how":"typed"/.test(toursJson) && /Lockbox/.test(toursJson) && !/base64/.test(toursJson), 'the plan, the confirmations and the notes are saved to the cloud, the map images are not');

  console.log('A changed figure');
  await boxA.locator('[data-tp-fig="sqft"] [data-tp-untick]').click(); await boxA.locator('[data-tp-pickone]').nth(0).click(); await wait(page);
  ok(await page.locator('[data-tp-cmpstale]').count() === 1 && await page.locator('[data-tp-send]').isDisabled(), 'a figure changed after the comparisons: they are out of date and Send is off');
  await boxA.locator('[data-tp-fig="sqft"] [data-tp-untick]').click(); await boxA.locator('[data-tp-pickone]').nth(1).click(); await wait(page);
  ok(await page.locator('[data-tp-cmpstale]').count() === 0 && !(await page.locator('[data-tp-send]').isDisabled()), 'putting it back makes them current again');

  console.log('Reopening Tour Tracker');
  await st(page, `st.go('buyer-package'); await new Promise(r => setTimeout(r, 200)); st.go('tour-tracker'); await new Promise(r => setTimeout(r, 400));`);
  await page.fill('[data-tp-notes]', 'Lockbox on the side door, code 4417. Park on the street.'); await wait(page, 300);
  ok(/Park on the street/.test(toursJson), 'after leaving and reopening Tour Tracker, a change to the open tour is still saved');
  const saved = toursJson;
  await ctx.close();

  // ── Phone: after a reload; the maps are worked out again ──
  console.log('Send on a phone');
  ({ ctx, page } = await ctxFor('phone'));
  await st(page, `st.go('tour-tracker'); await new Promise(r => setTimeout(r, 600)); st.ttOpenTour(st.tt.tours[0]);`); await wait(page, 300);
  const before = B_.route.length;
  ok(!(await page.locator('[data-tp-send]').isDisabled()), 'the tour reopens on another device ready to send');
  const sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
  ok(sw <= 390, 'no sideways scroll on a phone', sw);
  await page.click('[data-tp-send]'); await wait(page, 800);
  let sh = await page.evaluate(() => window.__shared);
  ok(B_.route.length === before + 1 && sh.length === 0 && /Press Send to buyer again/.test(await st(page, 'return st.goldToast.msg')), 'after a reload the route is worked out again for the maps, and the agent is asked to press once more (a phone opens its share menu only straight from a press)');
  await page.click('[data-tp-send]'); await wait(page, 800);
  sh = (await page.evaluate(() => window.__shared)).map(x => Object.assign(x, { text: drawn(x.raw) }));
  ok(B_.route.length === before + 1 && sh.length === 1 && sh[0].name === 'Showing-Tour-2026-11-07-Pat-Doe.pdf' && sh[0].type === 'application/pdf' && sh[0].text.includes('Your Saturday Tour') && !sh[0].text.includes('AGENT COPY'), 'the second press opens the share menu with the buyer\'s PDF and asks for no route again', { route: B_.route.length - before, sh: sh.map(x => x.name) });
  await ctx.close();
  ({ ctx, page } = await ctxFor('phone'));
  routeShift = 5;
  await st(page, `st.go('tour-tracker'); await new Promise(r => setTimeout(r, 600)); st.ttOpenTour(st.tt.tours[0]);`); await wait(page, 300);
  await page.click('[data-tp-send]'); await wait(page, 800);
  sh = await page.evaluate(() => window.__shared);
  ok(sh.length === 0 && /order or times changed/.test(await page.locator('[data-tp-pdferr]').innerText()), 'when the route worked out again differs from the one on screen, nothing is sent and the agent is told');
  routeShift = 0;
  await ctx.close();
  toursJson = saved;

  console.log('An old tour');
  ({ ctx, page } = await ctxFor('computer'));
  const r = await st(page, `st.go('tour-tracker'); await new Promise(r => setTimeout(r, 300));
    const old = { id: 'old1', name: 'Old tour', buyer: '', createdAt: '2026-09-01T00:00:00Z', properties: [{ id: 'p1', address: '1 Old Rd, Bethesda, MD 20814', price: '$900,000', scores: { location: 4 }, notes: 'kept', pros: '', cons: '' }] };
    st.tt.tours.unshift(old); st.ttOpenTour(st.tt.tours[0]); await new Promise(r => setTimeout(r, 200));
    const h = st.tt.activeTour.properties[0];
    return { card: !!document.querySelector('[data-tp]'), mode: st.tt.activeTour.plan.mode, notes: h.notes, score: h.scores.location, confirm: typeof h.confirm };`);
  ok(r.card && r.mode === 'plan' && r.notes === 'kept' && r.score === 4 && r.confirm === 'object', 'a tour saved before the plan opens with an empty plan and keeps its scores and notes', r);
  await ctx.close();

  const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok(!/staticmap/.test(src) && !/GOOGLE_MAPS_SERVER_KEY/.test(src), 'no Google server key or map image address is in the app');
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
