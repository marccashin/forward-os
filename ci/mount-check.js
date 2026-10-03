#!/usr/bin/env node
/*
 * FORWARD OS: load the real app in a real browser, as every login, and open
 * every view. Run on every pull request.
 *
 * WHY THIS EXISTS
 * The static checks prove names line up. They cannot prove the page actually
 * mounts. This opens index.html in headless Chromium, logged out and logged
 * in as each agent, switches to every view the template defines, and fails
 * on any JavaScript error or any Vue "not defined" warning that main does
 * not already produce. It also loads cma-tool.html.
 *
 * SAFETY: this never touches production. Every request that is not the page
 * itself is intercepted. Supabase, Railway, the AI service, Google and
 * Netlify functions all get an empty canned answer. Vue and jsPDF are served
 * from npm copies of the exact versions the page asks for (the development
 * build of Vue, so it reports names used in a render that do not exist).
 *
 * Usage: node ci/mount-check.js <head-dir> <base-dir>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const [headDir, baseDir] = process.argv.slice(2);
if (!headDir || !baseDir) {
  console.error('usage: node ci/mount-check.js <head-dir> <base-dir>');
  process.exit(2);
}

const VUE_DEV = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const root = path.resolve(dir);
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function wire(context, origin) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(origin)) {
      // The app's own Netlify functions do not exist on this static server.
      if (url.includes('/.netlify/functions/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.continue();
    }
    if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/vue\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE_DEV });
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
    const type = req.resourceType();
    if (type === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stubbed by ci/mount-check.js */' });
    if (type === 'stylesheet') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (type === 'image' || type === 'font' || type === 'media') return route.fulfill({ status: 200, body: '' });
    // Everything else is an API call: Supabase, Railway, the AI service, Google.
    // Answer with an empty list so no test ever reads or writes real data.
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: '[]' });
  });
}

// Keep the part of a message that identifies the problem, not the instance.
function norm(msg) {
  return String(msg).replace(/\s+/g, ' ').replace(/https?:\/\/127\.0\.0\.1:\d+/g, '').replace(/\bat <[^>]*>.*$/, '').trim().slice(0, 300);
}
const SERIOUS_WARN = /was accessed during render but is not defined|Unhandled error|is not a function|Failed to resolve|Maximum recursive updates|Extraneous non-/;

async function probe(dir) {
  const srv = await serve(dir);
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const agentsMatch = html.match(/const AGENTS\s*=\s*\[([^\]]*)\]/);
  const agents = agentsMatch ? [...agentsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  const tplStart = html.indexOf('<div id="app">');
  const tpl = html.slice(tplStart, html.indexOf('<script', tplStart));
  // Detail views need a selected record (a buyer, a listing) that this check
  // does not have, so opening them directly throws on main too. They are
  // skipped rather than allowed to break the views that follow.
  const views = [...new Set([...tpl.matchAll(/\bview\s*===?\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))]
    .filter((v) => !/-detail$/.test(v)).sort();

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const problems = new Set();
  const facts = { agents: agents.length, views: views.length, pages: 0 };

  async function open(label, file, storage, afterLoad) {
    const context = await browser.newContext();
    await wire(context, origin);
    if (storage) await context.addInitScript((kv) => { for (const k in kv) localStorage.setItem(k, kv[k]); }, storage);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.add(`[${label}] page error: ${norm(e.message)}`));
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'warning' && /^\[Vue warn\]/.test(t) && SERIOUS_WARN.test(t)) problems.add(`[${label}] ${norm(t)}`);
    });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(origin + '/' + file, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(1500);
      if (afterLoad) await afterLoad(page);
    } catch (e) {
      problems.add(`[${label}] could not finish: ${norm(e.message)}`);
    }
    facts.pages += 1;
    await context.close();
  }

  const appChecks = (expectLoggedIn) => async (page) => {
    const state = await page.evaluate(() => {
      const el = document.querySelector('#app');
      const app = el && el.__vue_app__;
      return {
        mounted: !!app,
        children: el ? el.children.length : 0,
        rawBraces: el ? /\{\{[^}]*\}\}/.test(el.innerText) : false,
        loggedIn: !!(app && app._instance && app._instance.setupState && app._instance.setupState.loggedIn),
      };
    });
    if (!state.mounted) throw new Error('Vue app did not mount on #app (blank page)');
    if (!state.children) throw new Error('#app rendered nothing (blank page)');
    if (state.rawBraces) throw new Error('raw {{ }} is visible on the page: the template did not compile');
    if (state.loggedIn !== expectLoggedIn) throw new Error(`expected loggedIn=${expectLoggedIn}, got ${state.loggedIn}`);
    if (!expectLoggedIn) return;
    for (const v of views) {
      const err = await page.evaluate(async (name) => {
        try {
          const st = document.querySelector('#app').__vue_app__._instance.setupState;
          st.view = name;
          await new Promise((r) => setTimeout(r, 120));
          return document.querySelector('#app').children.length ? null : 'rendered nothing';
        } catch (e) { return String(e && e.message || e); }
      }, v);
      if (err) problems.add(`[view ${v}] ${norm(err)}`);
    }
  };

  await open('logged out', 'index.html', null, appChecks(false));
  for (const a of agents) await open('login: ' + a, 'index.html', { fos_agent: a }, appChecks(true));
  if (fs.existsSync(path.join(dir, 'cma-tool.html'))) {
    await open('cma-tool.html', 'cma-tool.html', { fos_agent: agents[0] || 'Marc Cashin' }, null);
  }

  await browser.close();
  srv.close();
  if (!agents.length) problems.add('could not read the AGENTS list from index.html');
  if (!views.length) problems.add('could not find any views in the template');
  return { problems, facts };
}

(async () => {
  const head = await probe(headDir);
  const base = await probe(baseDir);
  const fresh = [...head.problems].filter((p) => !base.problems.has(p)).sort();
  console.log('FORWARD OS mount check');
  console.log(`  · opened ${head.facts.pages} pages: logged out, ${head.facts.agents} logins, cma-tool.html; ${head.facts.views} views each`);
  console.log(`  · problems: main ${base.problems.size}, this PR ${head.problems.size}`);
  if (base.problems.size) {
    console.log('  · already on main (not counted against this PR):');
    [...base.problems].sort().slice(0, 15).forEach((p) => console.log('      ' + p));
  }
  if (fresh.length) {
    console.log('\nFAILED (' + fresh.length + ' new)');
    fresh.forEach((p) => console.log('  ✗ ' + p));
    process.exit(1);
  }
  console.log('\nPASSED');
})().catch((e) => { console.error('mount check crashed:', e); process.exit(2); });
