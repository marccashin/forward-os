#!/usr/bin/env node
/*
 * FORWARD OS: an address entered for the first time is shown on a map with a pin.
 * Run on every pull request.
 *
 * Opens the real index.html in headless Chromium with a made-up Google Maps (the page's
 * own Maps script is never loaded) and works the New Property window and the net sheet
 * the way an agent does, with real typing and clicks:
 *  - New Property: nothing is created until the address is checked on a map and
 *    confirmed; Google's answer is taken only for the same house number and street; the
 *    map is drawn at Google's point with Google's address under it; changing the address
 *    after confirming asks again; when Google cannot place it the agent must tick that
 *    they checked it themselves; with Google unreachable the reason is said.
 *  - Net sheet: picking a Google suggestion draws the map with the address under it;
 *    typing another address hides it; picking one of the agent's own listings shows none.
 *  - A map that cannot be drawn says so in its box.
 *
 * Why: Marc, Nov 14, 2026: "a map with a pin should show up anytime an agent needs to
 * enter an address to specifically make sure that it's the correct location".
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/address-map-pin-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const PROPS = [{ id: '11111111-1111-4111-8111-111111111111', address: '500 Own Listing St NW, Washington, DC 20001', seller_name: 'Seller One', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-01T00:00:00Z' }];
// A made-up Google Maps. window.__g records what the page asked for and drew.
const GOOGLE_STUB = `
window.__g = { preds: [], details: [], maps: [], markers: [], mapThrows: false, answers: {} };
window.google = { maps: {
  places: {
    AutocompleteService: function () { this.getPlacePredictions = function (req, cb) { window.__g.preds.push(req.input); var a = window.__g.answers.preds; setTimeout(function () { cb(a || [], a && a.length ? 'OK' : 'ZERO_RESULTS'); }, 10); }; },
    PlacesService: function () { this.getDetails = function (req, cb) { window.__g.details.push({ id: req.placeId, fields: req.fields }); var d = window.__g.answers.details && window.__g.answers.details[req.placeId]; setTimeout(function () { cb(d || null, d ? 'OK' : 'NOT_FOUND'); }, 10); }; }
  },
  Map: function (el, opts) { if (window.__g.mapThrows) throw new Error('map test failure'); var bx = el.getAttribute('data-pin-map') || (el.closest('[data-pin-check]') ? el.closest('[data-pin-check]').getAttribute('data-pin-check') : null); window.__g.maps.push({ box: bx, lat: opts.center.lat, lng: opts.center.lng }); this.setCenter = function (c) { window.__g.maps.push({ box: el.getAttribute('data-pin-map'), lat: c.lat, lng: c.lng, moved: true }); }; },
  Marker: function (o) { window.__g.markers.push(o.position); this.setPosition = function (p) { window.__g.markers.push(p); }; }
} };
`;
const place = (lat, lng, addr) => ({ geometry: { location: { lat: () => lat, lng: () => lng } }, formatted_address: addr, address_components: [
  { types: ['administrative_area_level_1'], short_name: 'DC', long_name: 'District of Columbia' }, { types: ['locality'], long_name: 'Washington', short_name: 'Washington' }, { types: ['postal_code'], short_name: '20003', long_name: '20003' }] });
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
let posts = [];
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'POST' && /\/rest\/v1\/properties/.test(u)) { const b = JSON.parse(req.postData() || '{}'); posts.push(b); return J(route, 201, [Object.assign({ id: '22222222-2222-4222-8222-22222222222' + posts.length }, b)]); }
  if (m === 'GET' && /\/rest\/v1\/properties\?.*address=eq\./.test(u)) return J(route, 200, []);
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : '')); } }
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

  async function openPage(withGoogle) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    await ctx.addInitScript(() => { localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key'); });
    if (withGoogle) await ctx.addInitScript(GOOGLE_STUB);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
    return { ctx, page };
  }
  const S = (page, fn, arg) => page.evaluate(fn, arg);
  const st = 'document.querySelector("#app").__vue_app__._instance.setupState';

  // ---------------- New Property ----------------
  let { ctx, page } = await openPage(true);
  const openNew = async (street, city, state, zip) => {
    await S(page, () => { const s = document.querySelector('#app').__vue_app__._instance.setupState; s.lstShowNewModal = true; });
    await page.waitForTimeout(150);
    const box = (ph) => page.locator('input[placeholder="' + ph + '"]').first();
    await box('e.g. 1234 Oak St NW').fill(street); await box('Washington').fill(city); await page.locator('[data-nl-state]').selectOption(state); await box('20010').fill(zip);
    await box('First Last').fill('Seller Pin');
  };
  await S(page, () => { window.__g.answers = { preds: [{ description: '1324 E St SE, Washington, DC 20003, USA', place_id: 'P1' }, { description: '1326 E St SE, Washington, DC, USA', place_id: 'P2' }], details: { P1: { geometry: { location: { lat: () => 38.8831, lng: () => -76.9874 } }, formatted_address: '1324 E St SE, Washington, DC 20003, USA' } } }; });
  await openNew('1324 E St SE', 'Washington', 'DC', '20003');
  ok(await page.locator('[data-nl-pin-check]').isVisible(), 'New Property: Check the address on a map is shown under the address');
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(300);
  let s = await S(page, () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; return { err: x.lstCreateError }; });
  ok(/Check the address on a map/.test(s.err) && posts.length === 0, 'New Property: Create before the map check is refused, nothing is sent', { s, posts });

  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(400);
  s = await S(page, () => ({ g: window.__g, label: (document.querySelector('[data-nl-pin]') || {}).innerText || '' }));
  ok(s.g.preds[0] === '1324 E St SE, Washington, DC 20003', 'New Property: Google is asked for exactly the typed address', s.g.preds);
  ok(s.g.details.length === 1 && s.g.details[0].id === 'P1' && s.g.details[0].fields.join() === 'geometry,formatted_address', 'New Property: the details asked are for the matching house number only, and only its point and address', s.g.details);
  s.made = s.g.maps.filter(m => !m.moved);
  ok(s.made.length === 1 && s.made[0].box === 'nl' && s.g.maps.every(m => m.lat === 38.8831 && m.lng === -76.9874), 'New Property: one map is made (one map load) in its box at Google\'s point, with its pin', s.g);
  ok(/1324 E St SE, Washington, DC 20003/.test(s.label) && !/USA/.test(s.label) && /building, not the unit/.test(s.label), 'New Property: Google\'s address is under the map, with the unit warning', s.label);
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(300);
  s = await S(page, () => document.querySelector('#app').__vue_app__._instance.setupState.lstCreateError);
  ok(/Confirm the address on the map/.test(s) && posts.length === 0, 'New Property: shown on the map but not confirmed is refused, nothing is sent', s);
  await page.locator('[data-nl-pin-yes]').click(); await page.waitForTimeout(150);
  ok(await page.locator('[data-nl-pin-ok]').isVisible(), 'New Property: Yes, this is the property shows it as confirmed');

  // Changing the address after confirming asks again.
  await page.locator('input[placeholder="20010"]').fill('20002'); await page.waitForTimeout(150);
  ok(await page.locator('[data-nl-pin-check]').isVisible() && !(await page.locator('[data-pin-map="nl"]').count()), 'New Property: changing the ZIP after confirming hides the map and asks for the check again');
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(300);
  ok(posts.length === 0, 'New Property: a confirmed check of an earlier address does not let a changed address through', posts);
  // Changed back to the confirmed address: the confirmation stands and the map is drawn again.
  await S(page, () => { window.__g.maps = []; });
  await page.locator('input[placeholder="20010"]').fill('20003'); await page.waitForTimeout(300);
  s = await S(page, () => window.__g.maps);
  ok(await page.locator('[data-nl-pin-ok]').isVisible() && s.filter(m => !m.moved).length === 1 && s[0].box === 'nl', 'New Property: changed back to the confirmed address, it shows confirmed and the map is drawn again (never a blank box)', s);
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(800);
  ok(posts.length === 1 && /1324 E St SE/.test(posts[0].address) && posts[0].market === 'DC', 'New Property: once confirmed on the map the property is created, once', posts);

  // Google only knows a different house number: not taken, the agent checks it themselves.
  await S(page, () => { window.__g.answers = { preds: [{ description: '1326 E St SE, Washington, DC, USA', place_id: 'P2' }], details: { P2: { geometry: { location: { lat: () => 1, lng: () => 2 } }, formatted_address: '1326 E St SE' } } }; window.__g.details = []; window.__g.maps = []; });
  await openNew('1324 E St SE', 'Washington', 'DC', '20003');
  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(400);
  s = await S(page, () => ({ g: window.__g, why: (document.querySelector('[data-nl-pin-why]') || {}).innerText || '' }));
  ok(s.g.details.length === 0 && s.g.maps.length === 0 && /did not find this exact street address/.test(s.why), 'New Property: Google\'s different house number is never taken; no map, and the reason is shown', s);
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(300);
  ok(posts.length === 1, 'New Property: not found and not ticked is refused', posts.length);
  await page.locator('[data-nl-pin-manual]').check(); await page.waitForTimeout(100);
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(800);
  ok(posts.length === 2, 'New Property: ticking that the agent checked it lets it be created', posts.length);

  // A map that cannot be drawn says so.
  await S(page, () => { window.__g.answers = { preds: [{ description: '77 Q St NW, Washington, DC, USA', place_id: 'P3' }], details: { P3: { geometry: { location: { lat: () => 3, lng: () => 4 } }, formatted_address: '77 Q St NW, Washington, DC 20001, USA' } } }; window.__g.mapThrows = true; });
  await openNew('77 Q St NW', 'Washington', 'DC', '20001');
  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(400);
  s = await page.locator('[data-pin-map="nl"]').innerText();
  ok(/could not be drawn/.test(s) && /map test failure/.test(s), 'New Property: a map that cannot be drawn says so in its box', s);
  await S(page, () => { window.__g.mapThrows = false; document.querySelector('#app').__vue_app__._instance.setupState.lstShowNewModal = false; });

  // One State dropdown, no second Market list (Marc, Nov 14, 2026).
  await S(page, () => { document.querySelector('#app').__vue_app__._instance.setupState.lstShowNewModal = true; }); await page.waitForTimeout(150);
  s = await page.evaluate(() => { const m = document.querySelector('input[placeholder="e.g. 1234 Oak St NW"]').closest('div[style*="position: fixed"]'); return { selects: m.querySelectorAll('select').length, opts: Array.from(m.querySelector('[data-nl-state]').options).map(o => o.value + '=' + o.text).join(','), labels: Array.from(m.querySelectorAll('label')).map(l => l.textContent.trim()), stateInputs: m.querySelectorAll('input[placeholder="DC"]').length }; });
  ok(s.selects === 1 && s.opts === '=Choose state,DC=DC,MD=Maryland,VA=Virginia' && !s.labels.some(l => /^Market/.test(l)) && s.stateInputs === 0, 'New Property: State is one dropdown (DC, Maryland, Virginia) and there is no Market list or typed State box', s);
  await S(page, () => { document.querySelector('#app').__vue_app__._instance.setupState.lstShowNewModal = false; });

  // No, this is not the property: no pin is dragged; fix the text or tick after checking the agreement.
  await S(page, () => { window.__g.answers = { preds: [{ description: '4 Wendslow Place, Lutherville, MD 21093, USA', place_id: 'P5' }], details: { P5: { geometry: { location: { lat: () => 39.4, lng: () => -76.6 } }, formatted_address: '4 Wendslow Place, Lutherville, MD 21093, USA' } } }; });
  await page.evaluate(() => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.view = 'listings'; });
  await page.waitForTimeout(300);
  await page.locator('button.btn-navy', { hasText: 'New Property' }).first().click(); await page.waitForTimeout(200);
  { const box = (ph) => page.locator('input[placeholder="' + ph + '"]').first();
    await box('e.g. 1234 Oak St NW').fill('4 Wendslow Place'); await box('Washington').fill('Lutherville'); await page.locator('[data-nl-state]').selectOption('MD'); await box('20010').fill('21093'); await box('First Last').fill('Seller No'); }
  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(400);
  ok(await page.locator('[data-nl-pin-no]').isVisible() && await page.locator('[data-nl-pin-yes]').isVisible(), 'No button: shown beside Yes under the map');
  const beforeNo = posts.length;
  await page.locator('[data-nl-pin-no]').click(); await page.waitForTimeout(150);
  s = { wrong: (await page.locator('[data-nl-pin-wrong]').count()) ? await page.locator('[data-nl-pin-wrong]').innerText() : '', map: await page.locator('[data-pin-map="nl"]').count(), yes: await page.locator('[data-nl-pin-yes]').count() };
  ok(/spelled wrong/.test(s.wrong) && /listing agreement/.test(s.wrong) && s.map === 0 && s.yes === 0, 'No button: the map goes, and the two ways forward are said (fix the spelling, or check the agreement and tick)', s);
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(300);
  ok(posts.length === beforeNo, 'No button: Create is refused after No', posts.length);
  await page.locator('[data-nl-pin-again]').click(); await page.waitForTimeout(400);
  ok(await page.locator('[data-nl-pin-yes]').isVisible() && await page.locator('[data-pin-map="nl"]').count() === 1, 'No button: Show the map again brings the map and Yes back');
  await page.locator('[data-nl-pin-yes]').click(); await page.waitForTimeout(150);
  await page.locator('[data-nl-pin-undo]').click(); await page.waitForTimeout(150);
  ok(await page.locator('[data-nl-pin-wrong]').isVisible() && !(await page.locator('[data-nl-pin-ok]').count()), 'No button: Not right? after confirming takes the confirmation back');
  await page.locator('[data-nl-pin-manual]').check(); await page.waitForTimeout(100);
  await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(800);
  ok(posts.length === beforeNo + 1 && posts[posts.length - 1].market === 'MD' && /4 Wendslow Place, Lutherville MD 21093/.test(posts[posts.length - 1].address), 'No button: ticked after checking the agreement, it is created with the typed address and market MD from the State dropdown', posts[posts.length - 1]);
  // Correcting the address after No asks for the map again.
  await page.evaluate(async () => { document.querySelector('#app').__vue_app__._instance.setupState.view = 'listings'; await new Promise(r => setTimeout(r, 300)); });
  await page.locator('button.btn-navy', { hasText: 'New Property' }).first().click(); await page.waitForTimeout(200);
  { const box = (ph) => page.locator('input[placeholder="' + ph + '"]').first();
    await box('e.g. 1234 Oak St NW').fill('4 Wendslow Place'); await box('Washington').fill('Lutherville'); await page.locator('[data-nl-state]').selectOption('MD'); await box('20010').fill('21093'); }
  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(400);
  await page.locator('[data-nl-pin-no]').click(); await page.waitForTimeout(150);
  await page.locator('input[placeholder="e.g. 1234 Oak St NW"]').fill('4 Wendslow Road'); await page.waitForTimeout(150);
  ok(await page.locator('[data-nl-pin-check]').isVisible() && !(await page.locator('[data-nl-pin-wrong]').count()), 'No button: correcting the street brings back Check the address on a map');
  await S(page, () => { document.querySelector('#app').__vue_app__._instance.setupState.lstShowNewModal = false; });

  // Closing the window and pressing New Property again starts blank (Marc, Nov 14, 2026:
  // the last address came back, already marked Confirmed on the map).
  await S(page, () => { window.__g.answers = { preds: [{ description: '4 Wendslow Pl, Lutherville, MD 21093, USA', place_id: 'P4' }], details: { P4: { geometry: { location: { lat: () => 39.4, lng: () => -76.6 } }, formatted_address: '4 Wendslow Pl, Lutherville, MD 21093, USA' } } }; });
  await openNew('4 Wendslow Pl', 'Lutherville', 'MD', '21093');
  await page.locator('input[placeholder="e.g. #4B"]').first().fill('2');
  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(400);
  await page.locator('[data-nl-pin-yes]').click(); await page.waitForTimeout(150);
  ok(await page.locator('[data-nl-pin-ok]').isVisible(), 'New Property again: confirmed before closing');
  await page.evaluate(() => { const m = document.querySelector('input[placeholder="e.g. 1234 Oak St NW"]').closest('div[style*="position: fixed"]'); Array.from(m.querySelectorAll('button')).find(b => b.textContent.trim() === '✕').click(); }); await page.waitForTimeout(200);
  await S(page, async () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.view = 'listings'; await new Promise(r => setTimeout(r, 400)); });
  const before = posts.length;
  await page.locator('button.btn-navy', { hasText: 'New Property' }).first().click(); await page.waitForTimeout(250);
  s = await page.evaluate(() => Array.from(document.querySelector('input[placeholder="e.g. 1234 Oak St NW"]').closest('div[style*="position: fixed"]').querySelectorAll('input')).filter(i => i.type !== 'checkbox').map(i => i.value));
  ok(s.length >= 6 && s.every(v => v === ''), 'New Property again: closing and pressing New Property opens a blank form (address, unit, city, state, ZIP, sellers)', s);
  ok(!(await page.locator('[data-nl-pin-ok]').count()) && !(await page.locator('[data-pin-map="nl"]').count()), 'New Property again: no map and no Confirmed carried over');
  s = await S(page, () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; return x.lstNewMarket + '|' + x.lstNewPin.state + '|' + x.lstNewPin.ok; });
  ok(s === '||false', 'New Property again: Market starts empty and the map check is cleared', s);
  ok(posts.length === before, 'New Property again: nothing was sent', posts.length);
  await S(page, () => { document.querySelector('#app').__vue_app__._instance.setupState.lstShowNewModal = false; });

  // ---------------- Net sheet ----------------
  await S(page, async () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.view = 'just-listed'; await new Promise(r => setTimeout(r, 300)); x.lpOpen('netsheet'); await new Promise(r => setTimeout(r, 400)); });
  await S(page, () => { window.__g.answers = { preds: [{ description: '1324 E St SE, Washington, DC 20003, USA', place_id: 'P1' }], details: { P1: Object.assign({}, { geometry: { location: { lat: () => 38.8831, lng: () => -76.9874 } }, formatted_address: '1324 E St SE, Washington, DC 20003, USA', address_components: [{ types: ['administrative_area_level_1'], short_name: 'DC', long_name: 'District of Columbia' }] }) } }; window.__g.maps = []; window.__g.details = []; });
  const nsBox = page.locator('#ns-address-input');
  await nsBox.click(); await nsBox.pressSequentially('1324 E St', { delay: 20 }); await page.waitForTimeout(600);
  ok(!(await page.locator('[data-ns-pin]').count()), 'Net sheet: no map while typing');
  await page.locator('div', { hasText: /^1324 E St SE, Washington, DC 20003, USA$/ }).first().dispatchEvent('mousedown'); await page.waitForTimeout(400);
  s = await S(page, () => ({ g: window.__g, pin: (document.querySelector('[data-ns-pin]') || {}).innerText || '', j: document.querySelector('#app').__vue_app__._instance.setupState.ns.jurisdiction }));
  ok(s.g.details.length === 1 && s.g.details[0].fields.join() === 'address_components,geometry,formatted_address', 'Net sheet: the pick asks Google for its parts plus its point and address, once', s.g.details);
  ok(s.g.maps.filter(m => !m.moved).length === 1 && s.g.maps.every(m => m.box === 'ns' && m.lat === 38.8831), 'Net sheet: one map is made, at Google\'s point', s.g.maps);
  ok(/1324 E St SE, Washington, DC 20003/.test(s.pin) && /building, not the unit/.test(s.pin) && s.j === 'dc', 'Net sheet: Google\'s address is under the map, and the jurisdiction is set as before', s);
  await nsBox.press('End'); await nsBox.pressSequentially('x'); await page.waitForTimeout(200);
  ok(!(await page.locator('[data-ns-pin]').count()), 'Net sheet: typing in the box hides the map');
  await S(page, () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.nsPickListing(x.lstProperties[0] || { address: '500 Own Listing St NW, Washington, DC 20001', market: 'DC' }); });
  await page.waitForTimeout(300);
  ok(!(await page.locator('[data-ns-pin]').count()), 'Net sheet: picking one of the agent\'s own listings shows no map');
  // The pin is part of the ns form: in its initializer and in the only reset (resetToolForm).
  { const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); const r = html.slice(html.indexOf("case 'net-sheet':"), html.indexOf("case 'cash-to-close':"));
    ok(/_pin:null/.test(r) && /_pickNote:'', _pin:null,\s*\n\s*_detectedCounty/.test(html), 'Net sheet: the pin is in the form\'s initializer and in resetToolForm(\'net-sheet\')'); }
  await ctx.close();

  // ---------------- Round 2: tour, Cash to Close, Offer Strategy ----------------
  // Check on a map is a check for the agent, not a gate: nothing is created from these boxes.
  const G = (addr, lat, lng, id) => ({ preds: [{ description: addr + ', USA', place_id: id }], details: { [id]: { geometry: { location: { lat: lat, lng: lng } }, formatted_address: addr + ', USA' } } });   // plain numbers: fosPinFromPlace takes either form
  const pinBox = (attr) => page.locator('[data-pin-check="' + attr + '"]').first();
  async function checkBox(attr, answers, label) {
    await S(page, (a) => { window.__g.answers = a; window.__g.preds = []; window.__g.details = []; window.__g.maps = []; }, answers);
    await pinBox(attr).locator('[data-pin-go]').click(); await page.waitForTimeout(400);
    const r = await S(page, () => ({ g: window.__g }));
    r.label = (await pinBox(attr).locator('[data-pin-label]').count()) ? await pinBox(attr).locator('[data-pin-label]').innerText() : '';
    r.why = (await pinBox(attr).locator('[data-pin-why]').count()) ? await pinBox(attr).locator('[data-pin-why]').innerText() : '';
    return r;
  }
  ({ ctx, page } = await openPage(true));
  const postsRound2 = posts.length;
  // Tour: homes, start and end.
  await S(page, async () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.go('tour-tracker'); await new Promise(r => setTimeout(r, 500)); x.tt.newTourName = 'Map tour'; x.ttCreateTour(); await new Promise(r => setTimeout(r, 200)); });
  await page.locator('input[placeholder="e.g. 1234 Q St NW"]').fill('1324 E St SE, Washington, DC 20003');
  await page.locator('button', { hasText: '+ Add' }).click(); await page.waitForTimeout(300);
  ok(await pinBox('tour-home').locator('[data-pin-go]').isVisible(), 'Tour: each home on the plan has Check on a map');
  let r = await checkBox('tour-home', G('1324 E St SE, Washington, DC 20003', 38.8831, -76.9874, 'T1'));
  ok(r.g.preds[0] === '1324 E St SE, Washington, DC 20003' && r.g.details.length === 1 && r.g.details[0].fields.join() === 'geometry,formatted_address', 'Tour home: Google is asked for exactly that address, and only its point and address', r.g);
  ok(r.g.maps.filter(m => !m.moved).length === 1 && r.g.maps[0].box === 'tour-home' && r.g.maps[0].lat === 38.8831, 'Tour home: one map in that home\'s box at Google\'s point', r.g.maps);
  ok(/1324 E St SE, Washington, DC 20003/.test(r.label) && !/USA/.test(r.label) && /not the unit/.test(r.label) && /correct the address/.test(r.label), 'Tour home: Google\'s address is under the map, with the unit warning and what to do if it is wrong', r.label);
  await page.locator('[data-tp-start-pick="typed"]').click(); await page.waitForTimeout(150);
  ok(await pinBox('tour-start').locator('[data-pin-go]').isDisabled(), 'Tour start: Check on a map is off while the box is empty');
  await page.locator('[data-tp-startaddr]').fill('77 Q St NW, Washington, DC 20001'); await page.waitForTimeout(100);
  r = await checkBox('tour-start', G('77 Q St NW, Washington, DC 20001', 38.91, -77.01, 'T2'));
  ok(r.g.preds[0] === '77 Q St NW, Washington, DC 20001' && r.g.maps.length === 1 && r.g.maps[0].box === 'tour-start' && /77 Q St NW/.test(r.label), 'Tour start: the typed start is shown on its own map', r);
  await page.locator('[data-tp-startaddr]').fill('79 Q St NW, Washington, DC 20001'); await page.waitForTimeout(150);
  ok(await pinBox('tour-start').locator('[data-pin-go]').isVisible() && !(await pinBox('tour-start').locator('[data-pin-map-box]').count()), 'Tour start: changing the address hides the map and offers the check again');
  await S(page, () => { window.__g.maps = []; });
  await page.locator('[data-tp-startaddr]').fill('77 Q St NW, Washington, DC 20001'); await page.waitForTimeout(300);
  r = await S(page, () => window.__g.maps);
  ok(r.filter(m => !m.moved).length === 1 && r[0].box === 'tour-start' && (await pinBox('tour-start').locator('[data-pin-label]').count()) === 1, 'Tour start: changed back, the map is drawn again (never a blank box) with no new lookup', r);
  await page.locator('[data-tp-end-pick="next"]').click(); await page.waitForTimeout(150);
  await page.locator('[data-tp-endaddr]').fill('1326 E St SE, Washington, DC 20003'); await page.waitForTimeout(100);
  r = await checkBox('tour-end', { preds: [{ description: '1328 E St SE, Washington, DC 20003, USA', place_id: 'T3' }], details: { T3: { geometry: { location: { lat: 1, lng: 2 } }, formatted_address: 'x' } } });
  ok(r.g.details.length === 0 && r.g.maps.length === 0 && /did not find this exact street address/.test(r.why) && /yourself/.test(r.why), 'Tour end: Google\'s different house number is never taken; no map and the reason is shown', r);
  r = await S(page, () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; return JSON.stringify(x.tt.tours) + JSON.stringify(x.tt.activeTour); });
  ok(!/38\.8831|38\.91|fosPin|"lat"/.test(r), 'Tour: no pin or map point is stored on the tour (kept in memory only)');
  // Cash to Close: a picked suggestion shows at once; a typed one has the button.
  await S(page, async () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.go('cash-to-close'); await new Promise(r => setTimeout(r, 400)); });
  await S(page, (a) => { window.__g.answers = a; window.__g.preds = []; window.__g.details = []; window.__g.maps = []; }, G('1324 E St SE, Washington, DC 20003', 38.8831, -76.9874, 'C1'));
  await page.locator('#ctc-address-input').click(); await page.locator('#ctc-address-input').pressSequentially('1324 E St', { delay: 20 }); await page.waitForTimeout(600);
  ok(await pinBox('ctc').locator('[data-pin-go]').isVisible() && !(await pinBox('ctc').locator('[data-pin-map-box]').count()), 'Cash to Close: no map while typing; Check on a map is there');
  await page.locator('div', { hasText: /^1324 E St SE, Washington, DC 20003, USA$/ }).last().dispatchEvent('mousedown'); await page.waitForTimeout(500);
  r = await S(page, () => ({ g: window.__g, j: document.querySelector('#app').__vue_app__._instance.setupState.ctc.jurisdiction }));
  r.label = (await pinBox('ctc').locator('[data-pin-label]').count()) ? await pinBox('ctc').locator('[data-pin-label]').innerText() : '';
  ok(r.g.maps.filter(m => !m.moved).length === 1 && r.g.maps[0].box === 'ctc' && /1324 E St SE/.test(r.label) && r.j === 'dc', 'Cash to Close: picking Google\'s suggestion shows it on the map at once, and the jurisdiction is set as before', r);
  await page.locator('#ctc-address-input').fill('9 Other St, Washington, DC 20001'); await page.waitForTimeout(150);
  ok(!(await pinBox('ctc').locator('[data-pin-map-box]').count()), 'Cash to Close: typing another address hides the map');
  // Offer Strategy
  await S(page, async () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; x.go('offer-strategy'); await new Promise(r => setTimeout(r, 400)); });
  await page.locator('input[placeholder="123 Main St, Arlington VA 22201"]').fill('4 Wendslow Place, Lutherville, MD 21093');
  r = await checkBox('osg', G('4 Wendslow Place, Lutherville, MD 21093', 39.4, -76.6, 'O1'));
  ok(r.g.preds[0] === '4 Wendslow Place, Lutherville, MD 21093' && r.g.maps.length === 1 && r.g.maps[0].box === 'osg' && /4 Wendslow Place, Lutherville, MD 21093/.test(r.label), 'Offer Strategy: the typed property is shown on a map with Google\'s address', r);
  r = await S(page, () => { const x = document.querySelector('#app').__vue_app__._instance.setupState; return x.osgAddress; });
  ok(r === '4 Wendslow Place, Lutherville, MD 21093', 'Offer Strategy: the check never changes what the agent typed', r);
  ok(posts.length === postsRound2, 'Round 2: no property is created by any of these checks', posts.length - postsRound2);
  await ctx.close();

  // ---------------- No Google at all ----------------
  ({ ctx, page } = await openPage(false));
  const beforeNoGoogle = posts.length;
  await openNew('1324 E St SE', 'Washington', 'DC', '20003');
  await page.locator('[data-nl-pin-check]').click(); await page.waitForTimeout(300);
  s = await page.locator('[data-nl-pin-why]').innerText().catch(() => '');
  ok(/could not be reached/.test(s), 'Google unreachable: New Property says the address cannot be shown on a map', s);
  await page.locator('[data-nl-pin-manual]').check(); await page.locator('button', { hasText: 'Create Property' }).click(); await page.waitForTimeout(800);
  ok(posts.length === beforeNoGoogle + 1, 'Google unreachable: the agent can still create the property after checking it themselves', posts.length);
  await ctx.close();

  ok(errors.length === 0, 'no page errors', errors);
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
