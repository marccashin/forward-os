#!/usr/bin/env node
/*
 * FORWARD OS: your own deals come first, everyone else's stay one scroll away.
 * Run on every pull request.
 *
 * Marc, Oct 25, 2026: "My deals should be top on my dashboard. I don't want
 * to scroll through everyone else to see mine. I do need to keep access to
 * them all though."
 *
 * Opens the real index.html in headless Chromium with made-up listings and
 * buyers from four agents, signed in as Marc, Ashling, Operations and Niki,
 * and checks:
 *   - My Listings and Buyer Package (the grouped view admins get): the
 *     signed-in agent's group is first, the rest follow A to Z, and every
 *     listing and buyer is still on the page.
 *   - Operations and Concierge own no deals: plain A to Z, as before.
 *   - Dashboard Active Listings and Buyer Pipeline (first four rows): the
 *     signed-in agent's deals first, a deal they co-list counts as theirs,
 *     each part keeps the order it had (newest first), and others fill any
 *     room left.
 *   - The arrow on a group header folds and unfolds that group, and only
 *     that group.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/mine-first-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');

// Newest first, the way the app asks for them (order=created_at.desc).
// Marc's own deals are deliberately NOT the newest, so "first four" on main
// shows other agents' deals.
const AG = ['Ashling McGowan', 'Charlotte Lee', 'Marc Cashin', 'Niki Lang'];
const SPEC = [
  ['Ashling McGowan', 1], ['Niki Lang', 2], ['Charlotte Lee', 3], ['Ashling McGowan', 4],
  ['Niki Lang', 5], ['Marc Cashin', 6], ['Charlotte Lee', 7], ['Marc Cashin', 8],
  ['Ashling McGowan', 9], ['Niki Lang', 10, ['Marc Cashin']], ['Marc Cashin', 11],
];
const pad = n => String(n).padStart(2, '0');
const PROPS = SPEC.map(([a, n, co], i) => ({
  id: 'aaaaaaaa-0000-4000-8000-0000000000' + pad(n), address: 'Unit ' + n + ' Test St, Washington, DC 20001', // "Unit 1 Test" is not inside "Unit 11 Test"
  seller_name: 'Seller ' + n, agent_name: a, market: 'DC', status: 'draft',
  created_at: '2026-10-' + pad(25 - i) + 'T00:00:00Z', subfolder_drive_ids: co ? { _co_agents: co } : {},
}));
const BUYERS = SPEC.map(([a, n, co]) => ({
  id: 'bbbbbbbb-0000-4000-8000-0000000000' + pad(n), buyer_name: 'Buyer Number' + n,
  agent_name: a, stage: 'Pipeline', subfolder_drive_ids: co ? { _co_agents: co } : {},
}));

const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) {
    // Answer the way PostgREST would: the agent filter and the co-agent filter.
    const own = /agent_name=eq\.([^&]+)/.exec(u), co = /_co_agents":\["([^"]+)"/.exec(u);
    if (co) return J(route, 200, PROPS.filter(p => ((p.subfolder_drive_ids || {})._co_agents || []).includes(co[1])));
    return J(route, 200, own ? PROPS.filter(p => p.agent_name === own[1]) : PROPS);
  }
  if (m === 'GET' && /\/buyers(\?|$)/.test(u)) {
    const own = /agent_name=([^&]+)/.exec(u);
    return J(route, 200, own ? BUYERS.filter(b => b.agent_name === own[1]) : BUYERS);
  }
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 600) : '')); } }

// Independent of the app: what each screen should show.
const mine = (who, r) => r.agent_name === who || ((r.subfolder_drive_ids || {})._co_agents || []).includes(who);
const expectRows = (who, list) => list.filter(r => mine(who, r)).concat(list.filter(r => !mine(who, r))).slice(0, 4);
const expectGroups = who => {
  const names = [...new Set(PROPS.map(p => p.agent_name))].sort((a, b) => a.localeCompare(b));
  return names.includes(who) ? [who].concat(names.filter(n => n !== who)) : names;
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

  async function as(who) {
    const errors = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    await ctx.addInitScript((w) => { localStorage.setItem('fos_agent', w); localStorage.setItem('fos_key_' + w.replace(/ /g, '_'), 'test-key'); }, who);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    await page.evaluate(async () => { const st = document.querySelector('#app').__vue_app__._instance.setupState; if (st.updatesModal && st.updatesModal.show) await st.dismissUpdates(); st.taskModalShow = false; });
    const go = async v => { await page.evaluate(v => document.querySelector('#app').__vue_app__._instance.setupState.go(v), v); await page.waitForTimeout(400); };
    return { page, ctx, errors, go };
  }
  const groupNames = page => page.locator('.agent-group-name').allInnerTexts();

  for (const who of ['Marc Cashin', 'Ashling McGowan']) {
    console.log('\n-- signed in as ' + who);
    const { page, ctx, errors, go } = await as(who);

    await go('dashboard');
    const lrows = await page.locator('.lrow .laddr').allInnerTexts();
    const prows = await page.locator('.prow .pname').allInnerTexts();
    const wantL = expectRows(who, PROPS).map(p => p.address), wantB = expectRows(who, BUYERS).map(b => b.buyer_name);
    ok(JSON.stringify(lrows) === JSON.stringify(wantL), 'Dashboard Active Listings: ' + who + "'s listings first, newest first", { got: lrows, want: wantL });
    ok(JSON.stringify(prows) === JSON.stringify(wantB), 'Dashboard Buyer Pipeline: ' + who + "'s buyers first, newest first", { got: prows, want: wantB });

    await go('listings');
    const g = (await groupNames(page)).map(s => s.trim());
    ok(JSON.stringify(g) === JSON.stringify(expectGroups(who).map(n => n.toUpperCase())) || JSON.stringify(g) === JSON.stringify(expectGroups(who)),
      'My Listings: ' + who + "'s group is first, the others follow A to Z", { got: g, want: expectGroups(who) });
    const body = await page.locator('body').innerText();
    ok(PROPS.every(p => body.includes(p.address)), 'My Listings: every agent\'s listings are still on the page');

    // Fold the second group (someone else's) and unfold it again.
    const second = page.locator('.agent-group-header').nth(1);
    const otherName = (await second.locator('.agent-group-name').innerText()).trim();
    const otherAddr = PROPS.find(p => p.agent_name.toLowerCase() === otherName.toLowerCase()).address;
    const firstAddr = PROPS.find(p => p.agent_name === who).address;
    await second.click(); await page.waitForTimeout(300);
    let txt = await page.locator('body').innerText();
    ok(!txt.includes(otherAddr) && txt.includes(firstAddr), 'the arrow folds that group (' + otherName + ') and leaves the others open', { hidden: !txt.includes(otherAddr), firstShown: txt.includes(firstAddr) });
    await second.click(); await page.waitForTimeout(300);
    txt = await page.locator('body').innerText();
    ok(txt.includes(otherAddr), 'a second press unfolds it again');

    await go('buyer-package');
    const bg = (await groupNames(page)).map(s => s.trim());
    ok(JSON.stringify(bg.map(s => s.toLowerCase())) === JSON.stringify(expectGroups(who).map(s => s.toLowerCase())),
      'Buyer Package: ' + who + "'s group is first, the others follow A to Z", { got: bg, want: expectGroups(who) });
    const btxt = await page.locator('body').innerText();
    ok(BUYERS.every(b => btxt.includes(b.buyer_name)), 'Buyer Package: every agent\'s buyers are still on the page');

    ok(errors.length === 0, 'no page errors', errors);
    await ctx.close();
  }

  {
    console.log('\n-- signed in as Operations (owns no deals)');
    const { page, ctx, errors, go } = await as('Operations');
    await go('dashboard');
    const lrows = await page.locator('.lrow .laddr').allInnerTexts();
    ok(JSON.stringify(lrows) === JSON.stringify(PROPS.slice(0, 4).map(p => p.address)), 'Dashboard: the newest four, as before', lrows);
    await go('listings');
    const g = (await groupNames(page)).map(s => s.trim().toLowerCase());
    ok(JSON.stringify(g) === JSON.stringify(expectGroups('Operations').map(s => s.toLowerCase())), 'My Listings: A to Z, as before', g);
    ok(errors.length === 0, 'no page errors', errors);
    await ctx.close();
  }

  {
    console.log('\n-- signed in as Niki Lang (an agent: sees only her own and co-listed deals)');
    const { page, ctx, errors, go } = await as('Niki Lang');
    await go('dashboard');
    const lrows = await page.locator('.lrow .laddr').allInnerTexts();
    const want = PROPS.filter(p => p.agent_name === 'Niki Lang').slice(0, 4).map(p => p.address);
    ok(JSON.stringify(lrows) === JSON.stringify(want), 'Dashboard: her own listings, newest first, unchanged', { got: lrows, want });
    ok(errors.length === 0, 'no page errors', errors);
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
