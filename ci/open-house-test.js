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
// A made-up open_house_signins / open_house_reports pair that behaves like the SQL in
// sql/2026-11-15_open_house.sql: a retried insert is ignored, only report and
// updated_by can be updated, no delete.
const db = { signins: [], reports: [], mode: 'ok', reportPatch: 'ok', reqs: [] };
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
function dbRoute(route) {
  const req = route.request(), u = new URL(req.url()), m = req.method(), table = u.pathname.split('/').pop();
  db.reqs.push({ m, table, q: decodeURIComponent(u.search) });
  if (db.mode === 'missing') return J(route, 404, { code: 'PGRST205', message: 'Could not find the table' });
  const rows = table === 'open_house_signins' ? db.signins : db.reports, key = table === 'open_house_signins' ? 'id' : 'open_house_id';
  const eq = (name) => { const v = u.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') {
    let out = rows.slice();
    if (eq('open_house_id')) out = out.filter(r => r.open_house_id === eq('open_house_id'));
    if (eq('agent_name')) out = out.filter(r => r.agent_name === eq('agent_name'));
    return J(route, 200, JSON.parse(JSON.stringify(out)));
  }
  if (m === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    (Array.isArray(body) ? body : [body]).forEach(r => { if (!rows.some(x => x[key] === r[key])) rows.push(Object.assign({}, r, { updated_at: new Date().toISOString() })); });
    return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
  }
  if (m === 'PATCH') {
    if (db.reportPatch === 'fail') return J(route, 500, { message: 'database is down' });
    const body = JSON.parse(req.postData() || '{}');
    if (Object.keys(body).some(k => k !== 'report' && k !== 'updated_by')) return J(route, 401, { message: 'permission denied' });
    const hit = rows.filter(r => r.open_house_id === eq('open_house_id'));
    hit.forEach(r => Object.assign(r, body, { updated_at: new Date().toISOString() }));
    return J(route, 200, JSON.parse(JSON.stringify(hit)));
  }
  return J(route, 405, { message: 'not allowed' });
}
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
      if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
      if (/\/rest\/v1\/open_house_(signins|reports)/.test(u)) return dbRoute(route);
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
  await page.locator('[data-oh-phone]').fill('(202) 555-0101'); await page.waitForTimeout(100);
  const shownPhone = await page.locator('[data-oh-phone]').inputValue();
  ok(shownPhone === '202.555.0101', 'a phone typed as (202) 555-0101 shows as 202.555.0101', shownPhone);
  await page.locator('[data-oh-signin]').click(); await page.waitForTimeout(300);
  ok(/email/.test((await S(page)).oh.formError) && fub.events.length === 0, 'a bad email is refused and nothing is sent');
  const qs = await page.locator('[data-oh-q] legend').allInnerTexts();
  ok(JSON.stringify(qs) === JSON.stringify(['At what point in the buying process are you?', 'When are you looking to move?', 'Are you mortgage pre-approved?', 'How well priced is this property?', 'Do you have any feedback about the property that would be helpful for the sellers to hear?']), 'the five questions are on the guest book, word for word, in order', qs);
  const opts = await page.locator('[data-oh-q="timeline"] .ohk-chip').allInnerTexts();
  ok(JSON.stringify(opts.map(x => x.trim())) === JSON.stringify(['As soon as possible', '3-6 months', '6-12 months', 'Other']), 'each question has its answers word for word', opts);
  await page.locator('[data-oh-q="stage"] .ohk-chip', { hasText: 'Actively looking' }).click();
  await page.locator('[data-oh-q="preapproved"] .ohk-chip', { hasText: 'No' }).click();
  await page.locator('[data-oh-q="preapproved"] .ohk-chip', { hasText: 'Yes' }).click();
  await page.locator('[data-oh-q-text="feedback"]').fill('Loved the light. The kitchen feels small.');
  ok(await page.locator('[data-oh-q="preapproved"] .ohk-chip.on').innerText() === 'Yes', 'a picked answer is marked, and picking another replaces it');
  await page.locator('[data-oh-email]').fill('ann.visitor@example.com'); await page.locator('[data-oh-signin]').click(); await page.waitForTimeout(800);
  s = await S(page);
  ok(fub.events.length === 1, 'one sign-in is one request to Follow Up Boss', fub.events.length);
  const ev = fub.events[0] && fub.events[0].body;
  const expect = {
    source: 'FORWARD OS Open House', system: 'FORWARD OS', type: 'Visited Open House',
    person: { firstName: 'Ann', lastName: 'Visitor', emails: [{ value: 'ann.visitor@example.com' }], phones: [{ value: '202.555.0101' }], tags: ['FORWARD OS', 'Open House', '1324 E St SE #208'], assignedUserId: 7 },
    property: { street: '1324 E St SE #208', city: 'Washington', state: 'DC', code: '20003' }
  };
  ok(ev && JSON.stringify({ source: ev.source, system: ev.system, type: ev.type, person: ev.person, property: ev.property }) === JSON.stringify(expect), 'the event is Visited Open House with the visitor\'s name, phone and email, assigned to the agent, tagged FORWARD OS, Open House and the street address, with the property', ev);
  ok(ev && !isNaN(Date.parse(ev.occurredAt)) && /1324 E St SE #208, Washington, DC 20003/.test(ev.description) && /Hosted by Niki Lang/.test(ev.description), 'the event carries when the visitor signed in and a plain description', ev && ev.description);
  ok(ev && ev.description.endsWith('\n\nAt what point in the buying process are you?\nActively looking\n\nAre you mortgage pre-approved?\nYes\n\nDo you have any feedback about the property that would be helpful for the sellers to hear?\nLoved the light. The kitchen feels small.'), 'the answers go to Follow Up Boss with each question, in order; unanswered questions are left out', ev && ev.description);
  ok(fub.events[0] && fub.events[0].auth === 'Basic ' + Buffer.from('fub-test-key:').toString('base64'), 'it is sent with the Follow Up Boss key, through the app\'s own Follow Up Boss route');
  const row0 = db.signins[0];
  ok(db.signins.length === 1 && row0.agent_name === 'Niki Lang' && row0.street === '1324 E St SE' && row0.unit === '#208' && row0.zip === '20003' && row0.open_house_id === s.oh.kiosk.id && JSON.stringify(row0.answers.map(a => a.id)) === '["stage","preapproved","feedback"]', 'the sign-in\'s answers are saved once for the seller report, with the open house and address', row0);
  ok(!/Ann|Visitor|ann\.visitor|555.0101|555-0101|first|last|phone|email/i.test(JSON.stringify(row0)), 'the saved row holds no name, phone or email', row0);
  ok(s.oh.queue.length === 0 && JSON.parse(s.stored).length === 0 && s.oh.kiosk.count === 1 && s.oh.kiosk.sent === 1, 'once Follow Up Boss took it, it leaves the device; 1 signed in, 1 sent', { q: s.oh.queue, k: s.oh.kiosk.count, sent: s.oh.kiosk.sent });
  ok(await page.locator('[data-oh-thanks]').isVisible() && /Thank you, Ann/.test(await page.locator('[data-oh-thanks]').innerText()), 'the visitor is thanked by name');
  await next(page);
  ok(await page.locator('[data-oh-first]').inputValue() === '' && await page.locator('[data-oh-q-text="feedback"]').inputValue() === '' && await page.locator('.ohk-chip.on').count() === 0, 'the next guest gets a clean page: no name, no answers left from the last visitor');

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
  await page.locator('[data-oh-q="pricing"] .ohk-chip', { hasText: 'Overpriced' }).click();
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
  ok(/How well priced is this property\?\nOverpriced$/.test(fub.events[before].body.description) && !/\?\n/.test(fub.events[before + 1].body.description), 'answers given offline are kept on the device and sent with the sign-in; a visitor who answered nothing sends no questions', [fub.events[before].body.description, fub.events[before + 1].body.description]);
  ok(fub.events.slice(before).every(e => e.body.person.assignedUserId === 7 && e.body.person.tags[2] === '1324 E St SE #208'), 'sign-ins taken offline are still assigned to the agent and tagged with the address');
  ok(s.oh.queue.length === 0 && JSON.parse(s.stored).length === 0 && s.oh.kiosk.sent === 3, 'they leave the device once sent; 3 sent', { q: s.oh.queue.length, sent: s.oh.kiosk.sent });
  ok(db.signins.length === 3 && new Set(db.signins.map(r => r.id)).size === 3, 'sign-ins taken offline reach the report table once each when the connection is back', db.signins.length);
  ok(fub.events.slice(before).every(e => Date.parse(e.body.occurredAt) < Date.now() - 500), 'a late-sent sign-in carries the time the visitor signed in, not the time it was sent');

  // ── 3. Follow Up Boss refuses ──────────────────────────────────────────────
  fub.mode = 'archived';
  await signIn(page, 'Dee', 'Archived', '2025550104', 'dee@example.com'); await page.waitForTimeout(600); await next(page);
  s = await S(page);
  ok(s.oh.queue.length === 1 && s.oh.queue[0].status === 'held' && /lead flow/.test(s.oh.queue[0].error) && /archived/.test(s.oh.queue[0].error), 'an archived lead flow (204) keeps the sign-in on the device and says why', s.oh.queue[0]);
  ok(/1 need the agent/.test(await page.locator('[data-oh-status]').innerText()), 'the sign-in screen says one needs the agent');
  ok(db.signins.length === 4 && s.oh.queue[0].dbDone === true, 'a sign-in Follow Up Boss refused is still saved for the seller report', db.signins.length);
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
  ok(db.signins.length === 4, 'Send again does not save the sign-in to the report table twice', db.signins.length);

  // ── 4b. The seller report ────────────────────────────────────────────────
  const houseId = db.signins[0].open_house_id;
  await page.locator('[data-oh-end-report]').click(); await page.waitForTimeout(800);
  s = await S(page);
  ok(await page.locator('[data-ohr]').isVisible() && (await page.locator('[data-ohr-count]').innerText()).replace(/\s+/g, ' ') === '4 guests signed in', 'Write the seller report opens this open house\'s report with every sign-in counted', await page.locator('[data-ohr-count]').innerText().catch(() => ''));
  const listReq = db.reqs.find(r => r.m === 'GET' && r.table === 'open_house_signins' && /signed_in_at=gte/.test(r.q));
  ok(listReq && /agent_name=eq\.Niki Lang/.test(listReq.q), 'an agent\'s list asks only for their own open houses', listReq && listReq.q);
  const tStage = (await page.locator('[data-ohr-tally="stage"]').innerText()).replace(/\s+/g, ' ');
  const tPrice = (await page.locator('[data-ohr-tally="pricing"]').innerText()).replace(/\s+/g, ' ');
  ok(/Actively looking 1/.test(tStage) && /Seeing what's out there 0/.test(tStage) && /1 of 4 guests answered/.test(tStage), 'the tallies are counted from the sign-ins', tStage);
  ok(/Overpriced 1/.test(tPrice) && /Just Right 0/.test(tPrice) && /1 of 4 guests answered/.test(tPrice), 'the price question is counted the same way', tPrice);
  ok(await page.locator('[data-ohr-tally] input[type=number], [data-ohr-tally] input[type=text]').count() === 0, 'the counts cannot be typed over');
  ok(await page.locator('[data-ohr-fb]').count() === 1 && await page.locator('[data-ohr-fb-text]').inputValue() === 'Loved the light. The kitchen feels small.', 'the guest\'s written feedback starts in the report word for word');
  ok(!/Ann|Visitor|Bob|Cy|Dee/.test(await page.locator('[data-ohr]').innerText()), 'no guest name is anywhere on the report screen');
  await page.locator('[data-ohr-fb-text]').fill('Loved the light.');
  ok(/Edited/.test(await page.locator('[data-ohr-fb]').innerText()), 'an edited comment is marked Edited, with a way back to the guest\'s words');
  await page.locator('[data-ohr-add]').click();
  await page.locator('[data-ohr-fb-text]').nth(1).fill('Two guests asked about the HOA fee.');
  await page.locator('[data-ohr-add]').click();
  await page.locator('[data-ohr-fb-text]').nth(2).fill('Throwaway line');
  await page.locator('[data-ohr-fb-delete]').nth(1).click();
  ok(await page.locator('[data-ohr-fb]').count() === 2, 'an added comment can be deleted');
  await page.locator('[data-ohr-note]').fill('Thank you for having us.');
  await page.locator('[data-ohr-show="preapproved"]').uncheck();
  ok(/Changes not saved yet/.test(await page.locator('[data-ohr-save-state]').innerText()), 'unsaved edits are said on screen');
  db.reportPatch = 'fail';
  await page.locator('[data-ohr-save]').click(); await page.waitForTimeout(500);
  ok(/NOT saved/.test(await page.locator('[data-ohr-save-state]').innerText()) && await page.locator('[data-ohr-note]').inputValue() === 'Thank you for having us.', 'a failed save says NOT saved and keeps every edit on screen');
  db.reportPatch = 'ok';
  await page.locator('[data-ohr-save]').click(); await page.waitForTimeout(500);
  const rep0 = db.reports.find(r => r.open_house_id === houseId);
  ok(/Saved/.test(await page.locator('[data-ohr-save-state]').innerText()) && rep0 && rep0.updated_by === 'Niki Lang' && rep0.report.note === 'Thank you for having us.' && rep0.report.show.preapproved === false && rep0.report.feedback.length === 2, 'Save report keeps the working copy with the agent\'s name', rep0);
  await page.locator('[data-ohr-back]').click(); await page.waitForTimeout(600);
  ok(/1324 E St SE #208/.test(await page.locator('[data-ohr-row]').first().innerText()) && /4 guests signed in/.test(await page.locator('[data-ohr-row]').first().innerText()), 'the list shows the open house with its address and count');
  await page.locator('[data-ohr-row]').first().click(); await page.waitForTimeout(700);
  ok(await page.locator('[data-ohr-note]').inputValue() === 'Thank you for having us.' && await page.locator('[data-ohr-fb]').count() === 2 && await page.locator('[data-ohr-fb-text]').first().inputValue() === 'Loved the light.', 'reopened, the report is exactly as saved (the guest comment is not added twice)');
  await page.locator('[data-ohr-fb-toggle]').first().click();
  await page.locator('[data-ohr-fb-toggle]').first().click();
  await page.locator('[data-ohr-send]').click(); await page.waitForTimeout(1500);
  const pdf = await page.evaluate(async () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; const b = s.pdfViewerBlob; if (!b) return null; const a = new Uint8Array(await b.arrayBuffer()); let out = ''; for (let i = 0; i < a.length; i++) out += String.fromCharCode(a[i]); return { name: s.pdfViewerName, text: out }; });
  ok(pdf && /^Open_House_Report_1324_E_St_SE_208_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdf.name) && pdf.text.startsWith('%PDF'), 'Send to seller makes the branded PDF on a computer, named for the address and date', pdf && pdf.name);
  // Only the text the PDF draws (the Tj strings), not the logo's image bytes.
  const P = pdf ? (pdf.text.match(/\((?:[^()\\]|\\.)*\)\s*Tj/g) || []).map(x => x.replace(/\)\s*Tj$/, '').slice(1).replace(/\\(.)/g, '$1')).join('\n') : '';
  ok(/OPEN HOUSE REPORT/.test(P) && /1324 E St SE #208/.test(P) && /Hosted by Niki Lang/.test(P) && /guests signed in/.test(P), 'the PDF carries the address, the host and the count');
  ok(/Loved the light\./.test(P) && /Two guests asked about the HOA fee\./.test(P) && /Thank you for having us\./.test(P), 'the PDF carries the edited and added feedback and the agent\'s note');
  ok(!/kitchen feels small/.test(P) && !/Throwaway line/.test(P), 'the guest\'s original wording that was edited out and the deleted comment are not in the PDF');
  ok(/How well priced is this property\?/.test(P) && !/Are you mortgage pre-approved\?/.test(P), 'an unticked tally is left out of the PDF');
  ok(!/Ann|Visitor|Bob|Dee|ann\.visitor|example\.com|555/.test(P), 'no guest name or contact detail is in the PDF');
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

  // ── 5b. The report table is not set up yet ─────────────────────────────────
  db.mode = 'missing';
  ({ ctx, page } = await open('Niki Lang'));
  await setUp(page);
  await page.locator('[data-oh-launch]').click(); await page.waitForTimeout(500);
  const n5 = fub.events.length;
  await signIn(page, 'Gus', 'Notable', '2025550107', 'gus@example.com'); await page.waitForTimeout(800);
  s = await S(page);
  ok(fub.events.length === n5 + 1 && s.oh.queue.length === 1 && s.oh.queue[0].fubDone && !s.oh.queue[0].dbDone && /not been added to the database/.test(s.oh.queue[0].dbError), 'with the report table not set up, the lead still reaches Follow Up Boss and the answers wait on the device with the reason', s.oh.queue[0]);
  await page.evaluate(() => document.querySelector('#app').__vue_app__._instance.setupState.ohSync()); await page.waitForTimeout(300);
  ok(fub.events.length === n5 + 1, 'Follow Up Boss is not sent the lead twice while the answers wait');
  db.mode = 'ok';
  const nS = db.signins.length;
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2500); await dismiss(page);
  s = await S(page);
  ok(db.signins.length === nS + 1 && s.oh.queue.length === 0 && fub.events.length === n5 + 1, 'once the table exists the answers are saved when FORWARD OS opens, and the lead is not sent again', { rows: db.signins.length - nS, q: s.oh.queue.length });
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
  db.reqs = [];
  await page.locator('[data-oh-tab="reports"]').click(); await page.waitForTimeout(700);
  const opsReq = db.reqs.find(r => r.m === 'GET' && r.table === 'open_house_signins');
  ok(opsReq && !/agent_name=/.test(opsReq.q) && await page.locator('[data-ohr-row]').count() >= 2, 'Operations sees every agent\'s open houses', opsReq && opsReq.q);
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
