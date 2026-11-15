#!/usr/bin/env node
/*
 * FORWARD OS: Open House sign-in (Marc, Nov 15, 2026: replaces Spacio). Run on every PR.
 *
 * Opens the real index.html in headless Chromium, with a made-up Google Maps and a
 * made-up Follow Up Boss, and checks with real typing and clicks:
 * - Open House is in the menu; the setup screen always says to use the phone's hotspot
 *   when not on Wi-Fi; Launch stays off until the address is checked on the map, the
 *   main photo is uploaded and the code is set twice;
 * - the hosting agent's card shows their photo, name, FORWARD, Corcoran McEnearney,
 *   phone and email; Operations must choose the hosting agent;
 * - a sign-in is sent to Follow Up Boss as exactly one "Visited Open House" event:
 *   name, phone, email, assigned to the hosting agent's Follow Up Boss user, tagged
 *   FORWARD OS, Open House and the street address, with the property's address;
 * - with no connection the open house launches and runs the same: a pop-up the agent
 *   must acknowledge, sign-ins kept on the device, nothing lost on a reload, and each
 *   sent exactly once when the connection is back;
 * - Follow Up Boss refusing a lead (its lead flow archived, an error) or the agent
 *   having no Follow Up Boss user keeps the sign-in on the device and says why;
 * - leaving the sign-in screen needs the agent's code or the access code;
 * - on a phone the sign-in screen fits with no sideways scroll.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/open-house-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH). CHROMIUM_PATH optional.
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');

const GOOGLE_STUB = `
window.__g = { preds: [], answers: {} };
window.google = { maps: {
  places: {
    AutocompleteService: function () { this.getPlacePredictions = function (req, cb) { window.__g.preds.push(req.input); var a = window.__g.answers.preds; setTimeout(function () { cb(a || [], a && a.length ? 'OK' : 'ZERO_RESULTS'); }, 10); }; },
    PlacesService: function () { this.getDetails = function (req, cb) { var d = window.__g.answers.details && window.__g.answers.details[req.placeId]; setTimeout(function () { cb(d || null, d ? 'OK' : 'NOT_FOUND'); }, 10); }; }
  },
  Map: function (el, opts) { this.setCenter = function () {}; },
  Marker: function (o) { this.setPosition = function () {}; }
} };
window.__g.answers = { preds: [{ description: '1324 E St SE, Washington, DC 20003, USA', place_id: 'P1' }], details: { P1: { geometry: { location: { lat: function () { return 38.88; }, lng: function () { return -76.98; } } }, formatted_address: '1324 E St SE, Washington, DC 20003, USA' } } };
`;
// A 4 x 3 PNG (a real image the page can open and redraw).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAGElEQVQI12P4z8DwnwEJMDGgAEwOAwMDAA3pAQXmDiyLAAAAAElFTkSuQmCC', 'base64');

const FUB_USERS = [{ id: 7, name: 'Niki Lang', email: 'niki.lang@corcoranmce.com' }, { id: 3, name: 'Marc Cashin', email: 'marc.cashin@corcoranmce.com' }];
const fub = { events: [], mode: 'ok', users: FUB_USERS, userCalls: 0 };
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
function fubRoute(route) {
  const req = route.request(), u = req.url();
  if (/\/fub-api\/users/.test(u)) { fub.userCalls++; return J(route, 200, { users: fub.users }); }
  if (/\/fub-api\/events/.test(u) && req.method() === 'POST') {
    if (fub.mode === 'down') return route.abort('internetdisconnected');
    fub.events.push({ body: JSON.parse(req.postData() || '{}'), auth: req.headers()['authorization'] || '' });
    if (fub.mode === 'archived') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    if (fub.mode === 'error') return J(route, 400, { errorMessage: 'Invalid phone' });
    return J(route, 201, { id: 900 + fub.events.length, personId: 55 });
  }
  return J(route, 200, {});
}

let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 700) : '')); } }

(async () => {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(dir, decodeURIComponent(p));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = p.endsWith('.html') ? 'text/html' : p.endsWith('.jpg') ? 'image/jpeg' : 'text/javascript';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];

  async function open(agent, opts) {
    opts = opts || {};
    const ctx = await browser.newContext(opts.phone
      ? { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true }
      : { viewport: { width: 1180, height: 820 } });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) {
        if (u.includes('/fub-api/')) return fubRoute(route);
        return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      }
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    await ctx.addInitScript(({ a, users }) => {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        localStorage.setItem('fos_agent', a); localStorage.setItem('fos_key_' + a.replace(/ /g, '_'), 'test-key');
        localStorage.setItem('fos_fub_key', 'fub-test-key');
        if (users) localStorage.setItem('fos_fub_users', JSON.stringify(users));
      }
    }, { a: agent, users: opts.noUsers ? null : FUB_USERS });
    await ctx.addInitScript(GOOGLE_STUB);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(agent + ': ' + e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await dismiss(page);
    return { ctx, page };
  }
  async function dismiss(page) {
    await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
    await page.waitForTimeout(200);
  }
  const S = (page) => page.evaluate(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; return JSON.parse(JSON.stringify({ view: s.view, oh: Object.assign({}, s.oh, { hero: s.oh.hero ? s.oh.hero.slice(0, 30) : '', photo: Object.keys(s.oh.photo), kiosk: s.oh.kiosk ? Object.assign({}, s.oh.kiosk, { hero: (s.oh.kiosk.hero || '').slice(0, 30), card: Object.assign({}, s.oh.kiosk.card, { photo: (s.oh.kiosk.card.photo || '').slice(0, 20) }) }) : null }), problem: s.ohLaunchProblem, stored: localStorage.getItem('fos_oh_queue'), session: !!localStorage.getItem('fos_oh_session') })); });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  async function setUp(page, opts) {
    opts = opts || {};
    await page.locator('[data-nav-open-house]').click(); await page.waitForTimeout(600);
    await page.locator('[data-oh-street]').fill('1324 E St SE');
    await page.locator('[data-oh-unit]').fill('#208');
    await page.locator('[data-oh-city]').fill('Washington');
    await page.locator('[data-oh-state]').selectOption('DC');
    await page.locator('[data-oh-zip]').fill('20003');
    await page.locator('[data-oh-pin-check]').click(); await page.waitForTimeout(300);
    if (opts.manualPin) await page.locator('[data-oh-pin-manual]').check();
    else await page.locator('[data-oh-pin-yes]').click();
    await page.locator('[data-oh-hero]').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG }); await page.waitForTimeout(500);
    await page.locator('[data-oh-code]').fill('4321'); await page.locator('[data-oh-code2]').fill('4321');
    await page.waitForTimeout(150);
  }
  async function signIn(page, first, last, phone, email) {
    await page.locator('[data-oh-first]').fill(first); await page.locator('[data-oh-last]').fill(last);
    await page.locator('[data-oh-phone]').fill(phone); await page.locator('[data-oh-email]').fill(email);
    await page.locator('[data-oh-signin]').click(); await page.waitForTimeout(400);
  }
  async function next(page) { if (await page.locator('[data-oh-thanks-done]').count()) await page.locator('[data-oh-thanks-done]').click(); await page.waitForTimeout(150); }

  // ── 1. An agent, online ────────────────────────────────────────────────────
  let { ctx, page } = await open('Niki Lang');
  ok(await page.locator('[data-nav-open-house]').count() === 1, 'Open House is in the menu');
  await page.locator('[data-nav-open-house]').click(); await page.waitForTimeout(800);
  let s = await S(page);
  ok(s.view === 'open-house', 'the menu item opens the Open House screen', s.view);
  const hot = (await page.locator('[data-oh-hotspot]').innerText()).replace(/\s+/g, ' ');
  ok(/Not on Wi-Fi\? Use your phone's hotspot/.test(hot) && /Personal Hotspot on your phone/.test(hot) && /needs a connection to open/.test(hot), 'the setup screen always tells agents on an iPad or computer to use their phone\'s hotspot', hot);
  ok(await page.locator('[data-oh-launch]').isDisabled() && /street address/.test(s.problem), 'Launch is off until the form is filled, and says what is missing', s.problem);
  const card = (await page.locator('[data-oh-card-preview]').innerText()).replace(/\s+/g, ' ');
  const cardImg = await page.locator('[data-oh-card-preview] img').getAttribute('src').catch(() => '');
  ok(/Niki Lang/.test(card) && /FORWARD \| Corcoran McEnearney/.test(card) && /202\.905\.8828/.test(card) && /niki\.lang@corcoranmce\.com/.test(card) && /^data:image\/jpeg/.test(cardImg || ''), 'the card shows the agent\'s photo, name, FORWARD, Corcoran McEnearney, phone and email', { card, img: (cardImg || '').slice(0, 30) });
  ok(await page.locator('[data-oh-host]').count() === 0, 'an agent hosts as themselves (no hosting agent list)');
  await setUp(page);
  s = await S(page);
  ok(await page.evaluate(() => window.__g.preds[0]) === '1324 E St SE, Washington, DC 20003', 'Google is asked for exactly the typed address');
  ok(/^data:image\/jpeg/.test(s.oh.hero), 'the uploaded photo is kept as the main photo', s.oh.hero);
  ok(!s.problem && !(await page.locator('[data-oh-launch]').isDisabled()), 'with the map confirmed, the photo uploaded and the code set twice, Launch is on', s.problem);
  await page.locator('[data-oh-code2]').fill('4322'); await page.waitForTimeout(100);
  ok(/do not match/.test((await S(page)).problem), 'two different codes keep Launch off');
  await page.locator('[data-oh-code2]').fill('4321');
  await page.locator('[data-oh-street]').fill('1326 E St SE'); await page.waitForTimeout(100);
  ok(/Check the address on the map/.test((await S(page)).problem), 'changing the address after confirming asks for the map again');
  await page.locator('[data-oh-street]').fill('1324 E St SE'); await page.waitForTimeout(100);

  await page.locator('[data-oh-launch]').click(); await page.waitForTimeout(500);
  s = await S(page);
  const kTxt = (await page.locator('[data-oh-kiosk]').innerText()).replace(/\s+/g, ' ');
  ok(s.oh.kiosk && s.session && await page.locator('[data-oh-kiosk]').isVisible(), 'Launch opens the sign-in screen and keeps it on the device', s.oh.kiosk);
  ok(/1324 E St SE #208/.test(kTxt) && /Washington, DC 20003/.test(kTxt) && /Niki Lang/.test(kTxt) && /FORWARD \| Corcoran McEnearney/.test(kTxt), 'the sign-in screen shows the address and the agent\'s card', kTxt.slice(0, 300));
  ok(/^data:image\/jpeg/.test(await page.locator('[data-oh-kiosk-hero]').getAttribute('src')) && /^data:image\/jpeg/.test(await page.locator('[data-oh-kiosk-card] img').getAttribute('src')), 'the property photo and the agent\'s photo are on the sign-in screen');
  ok(s.oh.kiosk.fubUserId === 7, 'the hosting agent\'s Follow Up Boss user is found by email at launch', s.oh.kiosk.fubUserId);
  ok(!s.oh.offlinePopup, 'online, no connection pop-up');

  await signIn(page, 'Ann', 'Visitor', '202', 'ann@example');
  s = await S(page);
  ok(/10-digit phone/.test(s.oh.formError) && fub.events.length === 0 && s.oh.queue.length === 0, 'a short phone number is refused and nothing is saved or sent', s.oh.formError);
  await page.locator('[data-oh-phone]').fill('(202) 555-0101'); await page.locator('[data-oh-signin]').click(); await page.waitForTimeout(300);
  ok(/email/.test((await S(page)).oh.formError) && fub.events.length === 0, 'a bad email is refused and nothing is sent');
  await page.locator('[data-oh-email]').fill('ann.visitor@example.com'); await page.locator('[data-oh-signin]').click(); await page.waitForTimeout(800);
  s = await S(page);
  ok(fub.events.length === 1, 'one sign-in is one request to Follow Up Boss', fub.events.length);
  const ev = fub.events[0] && fub.events[0].body;
  const expect = {
    source: 'FORWARD OS Open House', system: 'FORWARD OS', type: 'Visited Open House',
    person: { firstName: 'Ann', lastName: 'Visitor', emails: [{ value: 'ann.visitor@example.com' }], phones: [{ value: '(202) 555-0101' }], tags: ['FORWARD OS', 'Open House', '1324 E St SE #208'], assignedUserId: 7 },
    property: { street: '1324 E St SE #208', city: 'Washington', state: 'DC', code: '20003' }
  };
  ok(ev && JSON.stringify({ source: ev.source, system: ev.system, type: ev.type, person: ev.person, property: ev.property }) === JSON.stringify(expect), 'the event is Visited Open House with the visitor\'s name, phone and email, assigned to the agent, tagged FORWARD OS, Open House and the street address, with the property', ev);
  ok(ev && !isNaN(Date.parse(ev.occurredAt)) && /1324 E St SE #208, Washington, DC 20003/.test(ev.description) && /Hosted by Niki Lang/.test(ev.description), 'the event carries when the visitor signed in and a plain description', ev && ev.description);
  ok(fub.events[0] && fub.events[0].auth === 'Basic ' + Buffer.from('fub-test-key:').toString('base64'), 'it is sent with the Follow Up Boss key, through the app\'s own Follow Up Boss route');
  ok(s.oh.queue.length === 0 && JSON.parse(s.stored).length === 0 && s.oh.kiosk.count === 1 && s.oh.kiosk.sent === 1, 'once Follow Up Boss took it, it leaves the device; 1 signed in, 1 sent', { q: s.oh.queue, k: s.oh.kiosk.count, sent: s.oh.kiosk.sent });
  ok(await page.locator('[data-oh-thanks]').isVisible() && /Thank you, Ann/.test(await page.locator('[data-oh-thanks]').innerText()), 'the visitor is thanked by name');
  ok(await page.locator('[data-oh-first]').count() === 0, 'the form is cleared for the next guest (no name left on screen)');
  await next(page);

  // ── 2. The connection drops ────────────────────────────────────────────────
  await ctx.setOffline(true); await page.waitForTimeout(400);
  ok(await page.locator('[data-oh-offline-popup]').isVisible(), 'when the connection drops a pop-up appears on the sign-in screen');
  const pop = (await page.locator('[data-oh-offline-popup]').innerText()).replace(/\s+/g, ' ');
  ok(/No internet connection/.test(pop) && /saved safely on this device/.test(pop) && /added to Follow Up Boss automatically once the connection is back/.test(pop) && /will not show in Follow Up Boss until then/.test(pop) && /Personal Hotspot on your phone/.test(pop), 'it says the sign-ins are saved, go to Follow Up Boss when the connection is back, not before, and to use the hotspot', pop);
  await page.waitForTimeout(1200);
  ok(await page.locator('[data-oh-offline-popup]').isVisible(), 'the pop-up stays until the agent acknowledges it');
  await page.locator('[data-oh-offline-ok]').click(); await page.waitForTimeout(200);
  ok(!(await page.locator('[data-oh-offline-popup]').count()), 'I understand closes it');
  const before = fub.events.length;
  await signIn(page, 'Bob', 'Offline', '202-555-0102', 'bob@example.com'); await next(page);
  await signIn(page, 'Cy', 'Offline', '2025550103', 'cy@example.com'); await next(page);
  s = await S(page);
  ok(fub.events.length === before, 'offline, nothing reaches Follow Up Boss', fub.events.length - before);
  ok(s.oh.queue.length === 2 && JSON.parse(s.stored).length === 2 && JSON.parse(s.stored).every(q => q.status === 'waiting'), 'offline, both sign-ins are saved on the device', s.stored);
  ok(/No internet connection/.test(await page.locator('[data-oh-status]').innerText()) && /2 waiting/.test(await page.locator('[data-oh-status]').innerText()), 'the sign-in screen says it is offline and 2 are waiting');
  ok(!(await page.locator('[data-oh-offline-popup]').count()), 'the pop-up does not come back for every sign-in during the same outage');

  // A reload while sign-ins are waiting (connection back but Follow Up Boss unreachable).
  fub.mode = 'down';
  await ctx.setOffline(false); await page.waitForTimeout(800);
  ok(fub.events.length === before && (await S(page)).oh.queue.length === 2, 'a request that never reached Follow Up Boss leaves the sign-ins on the device');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500); await dismiss(page);
  s = await S(page);
  ok(await page.locator('[data-oh-kiosk]').isVisible() && s.oh.queue.length === 2 && s.oh.kiosk.count === 3, 'after a reload the sign-in screen comes back with both sign-ins still waiting', { q: s.oh.queue.length, c: s.oh.kiosk && s.oh.kiosk.count });
  ok(await page.locator('[data-oh-offline-popup]').isVisible(), 'after the reload, Follow Up Boss still unreachable: the no-connection pop-up is shown (the browser saying online is not enough)');
  await page.locator('[data-oh-offline-ok]').click(); await page.waitForTimeout(150);
  // Follow Up Boss is reachable again: each waiting sign-in is sent once.
  fub.mode = 'ok';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.ohSync());
  await page.waitForTimeout(1200);
  s = await S(page);
  const sentNames = fub.events.slice(before).map(e => e.body.person.firstName);
  ok(sentNames.length === 2 && sentNames.join() === 'Bob,Cy', 'when the connection is back each waiting sign-in is sent exactly once, in order', sentNames);
  ok(fub.events.slice(before).every(e => e.body.person.assignedUserId === 7 && e.body.person.tags[2] === '1324 E St SE #208'), 'sign-ins taken offline are still assigned to the agent and tagged with the address');
  ok(s.oh.queue.length === 0 && JSON.parse(s.stored).length === 0 && s.oh.kiosk.sent === 3, 'they leave the device once sent; 3 sent', { q: s.oh.queue.length, sent: s.oh.kiosk.sent });
  ok(fub.events.slice(before).every(e => Date.parse(e.body.occurredAt) < Date.now() - 500), 'a late-sent sign-in carries the time the visitor signed in, not the time it was sent');

  // ── 3. Follow Up Boss refuses ──────────────────────────────────────────────
  fub.mode = 'archived';
  await signIn(page, 'Dee', 'Archived', '2025550104', 'dee@example.com'); await page.waitForTimeout(600); await next(page);
  s = await S(page);
  ok(s.oh.queue.length === 1 && s.oh.queue[0].status === 'held' && /lead flow/.test(s.oh.queue[0].error) && /archived/.test(s.oh.queue[0].error), 'an archived lead flow (204) keeps the sign-in on the device and says why', s.oh.queue[0]);
  ok(/1 need the agent/.test(await page.locator('[data-oh-status]').innerText()), 'the sign-in screen says one needs the agent');
  const n1 = fub.events.length;
  await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.ohSync()); await page.waitForTimeout(400);
  ok(fub.events.length === n1, 'a refused sign-in is not sent again by itself', fub.events.length - n1);

  // ── 4. Leaving needs the code ─────────────────────────────────────────────
  await page.locator('[data-oh-exit]').click(); await page.waitForTimeout(200);
  await page.locator('[data-oh-exit-code]').fill('1111'); await page.locator('[data-oh-exit-go]').click(); await page.waitForTimeout(300);
  ok(await page.locator('[data-oh-kiosk]').isVisible() && /not right/.test(await page.locator('[data-oh-exit-error]').innerText()), 'a wrong code does not leave the sign-in screen');
  await page.locator('[data-oh-exit-forgot]').click();
  await page.locator('[data-oh-exit-code]').fill('nope'); await page.locator('[data-oh-exit-go]').click(); await page.waitForTimeout(300);
  ok(await page.locator('[data-oh-kiosk]').isVisible(), 'a wrong access code does not leave it either');
  await page.locator('[data-oh-exit-forgot]').click();
  await page.locator('[data-oh-exit-code]').fill('4321'); await page.locator('[data-oh-exit-go]').click(); await page.waitForTimeout(500);
  s = await S(page);
  ok(!(await page.locator('[data-oh-kiosk]').count()) && !s.session && s.view === 'open-house', 'the agent\'s code ends the open house and returns to the Open House screen');
  ok(/4 sign-ins, 3 sent to Follow Up Boss/.test(s.oh.endNote) && /1 still on this device/.test(s.oh.endNote), 'ending says how many signed in, how many were sent and how many are still on the device', s.oh.endNote);
  ok(s.oh.queue.length === 1, 'ending the open house never removes a sign-in that was not sent');
  const qTxt = await page.locator('[data-oh-queue]').innerText();
  ok(/Dee Archived/.test(qTxt) && /archived/.test(qTxt), 'the Open House screen lists the sign-in still on the device with the reason', qTxt);
  fub.mode = 'ok';
  await page.locator('[data-oh-retry]').click(); await page.waitForTimeout(800);
  s = await S(page);
  ok(fub.events.length === n1 + 1 && fub.events[n1].body.person.firstName === 'Dee' && s.oh.queue.length === 0, 'Send again sends it once and it leaves the device', { sent: fub.events.length - n1, q: s.oh.queue.length });
  await ctx.close();

  // ── 5. Launched with no connection at all ─────────────────────────────────
  ({ ctx, page } = await open('Niki Lang'));
  await ctx.setOffline(true); await page.waitForTimeout(300);
  await page.locator('[data-nav-open-house]').click(); await page.waitForTimeout(500);
  ok(await page.locator('[data-oh-offline-inline]').isVisible(), 'offline, the setup screen says there is no connection and that it can still launch');
  await setUp(page, { manualPin: true });
  s = await S(page);
  ok(s.oh.pin.state === 'notfound' && /no internet connection/.test(s.oh.pin.why), 'offline, the map check says why it cannot show the map', s.oh.pin);
  ok(!s.problem, 'offline, ticking that the address was checked lets the agent launch', s.problem);
  await page.locator('[data-oh-launch]').click(); await page.waitForTimeout(500);
  ok(await page.locator('[data-oh-kiosk]').isVisible() && await page.locator('[data-oh-offline-popup]').isVisible(), 'launched offline: the sign-in screen opens with the no-connection pop-up');
  ok(/^data:image\/jpeg/.test(await page.locator('[data-oh-kiosk-card] img').getAttribute('src')), 'launched offline: the agent\'s photo kept on the device is on the card');
  await page.locator('[data-oh-offline-ok]').click();
  const n2 = fub.events.length;
  await signIn(page, 'Eve', 'Nonet', '2025550105', 'eve@example.com');
  ok(fub.events.length === n2 && JSON.parse((await S(page)).stored).length === 1, 'launched offline: the sign-in is saved on the device');
  await ctx.setOffline(false); await page.waitForTimeout(1200);
  ok(fub.events.length === n2 + 1 && fub.events[n2].body.person.firstName === 'Eve' && (await S(page)).oh.queue.length === 0, 'when the connection comes back it is sent once', fub.events.length - n2);
  await page.locator('[data-oh-exit]').click(); await page.waitForTimeout(200);
  await page.locator('[data-oh-exit-forgot]').click();
  await page.locator('[data-oh-exit-code]').fill('forward2026'); await page.locator('[data-oh-exit-go]').click(); await page.waitForTimeout(400);
  ok(!(await page.locator('[data-oh-kiosk]').count()) && !(await S(page)).session, 'Forgot the code: the FORWARD OS access code also ends the open house');
  await ctx.close();

  // ── 6. The agent has no Follow Up Boss user ───────────────────────────────
  fub.users = [{ id: 3, name: 'Marc Cashin', email: 'marc.cashin@corcoranmce.com' }];
  ({ ctx, page } = await open('Niki Lang', { noUsers: true }));
  await setUp(page);
  await page.locator('[data-oh-launch]').click(); await page.waitForTimeout(500);
  const n3 = fub.events.length;
  await signIn(page, 'Fay', 'Nouser', '2025550106', 'fay@example.com'); await page.waitForTimeout(600);
  s = await S(page);
  ok(fub.events.length === n3 && s.oh.queue.length === 1 && s.oh.queue[0].status === 'held' && /no user with Niki Lang's email/.test(s.oh.queue[0].error), 'with no Follow Up Boss user for the agent nothing is sent unassigned: it stays on the device and says why', s.oh.queue[0]);
  fub.users = FUB_USERS;
  await ctx.close();

  // ── 7. Operations chooses the hosting agent ───────────────────────────────
  ({ ctx, page } = await open('Operations'));
  await page.locator('[data-nav-open-house]').click(); await page.waitForTimeout(500);
  ok(await page.locator('[data-oh-host]').isVisible() && /Choose the agent hosting/.test((await S(page)).problem), 'Operations must choose the hosting agent before launching');
  await page.locator('[data-oh-host]').selectOption('Cesar Rivera'); await page.waitForTimeout(800);
  ok(/Cesar Rivera/.test(await page.locator('[data-oh-card-preview]').innerText()), 'the card is the chosen agent\'s');
  await ctx.close();

  // ── 8. Phone ──────────────────────────────────────────────────────────────
  ({ ctx, page } = await open('Marc Cashin', { phone: true }));
  await page.evaluate(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.go('open-house'); });
  await page.waitForTimeout(500);
  ok((await S(page)).oh.host === 'Marc Cashin', 'Marc hosts as himself by default and can choose another agent');
  await page.evaluate(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; Object.assign(s.oh, { street: '1324 E St SE', unit: '#208', city: 'Washington', state: 'DC', zip: '20003', hero: 'data:image/jpeg;base64,AAAA', code: '1234', code2: '1234' }); });
  await page.waitForTimeout(100);
  await page.evaluate(() => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.oh.pin.sig = [s.oh.street, s.oh.city, s.oh.state, s.oh.zip].map(v => String(v).trim().toLowerCase()).join('|'); s.oh.pin.state = 'notfound'; s.oh.pin.ok = true; });
  await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.ohLaunch()); await page.waitForTimeout(500);
  const wide = await page.evaluate(() => { const k = document.querySelector('[data-oh-kiosk]'); return { k: k ? k.scrollWidth : 0, w: window.innerWidth }; });
  ok(await page.locator('[data-oh-kiosk]').isVisible() && wide.k <= wide.w, 'on a phone the sign-in screen opens with no sideways scroll', wide);
  await ctx.close();

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
