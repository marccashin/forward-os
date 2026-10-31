#!/usr/bin/env node
/*
 * FORWARD OS: Seller Prep Guide, Send to Seller (Marc, Oct 31, 2026).
 *
 * On a phone the button opens the phone's own share menu with the guide's PDF
 * attached (the agent picks the seller in Messages or Mail). Cancelling the menu
 * does nothing else. A phone that cannot share a file, and a computer, open the PDF
 * in the viewer with a message that says what to do. Until then the button opened
 * the viewer and said "opened in new tab", and a send window nothing opened sat in
 * the code (removed). Real index.html, headless Chromium, made-up listing.
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = process.argv[2];
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const PROPS = [{ id: A, address: '100 Alpha Ct NW, Washington, DC 20001', seller_name: 'Seller A', agent_name: 'Marc Cashin', market: 'DC', status: 'draft', created_at: '2026-10-01T00:00:00Z' }];
const MLS = ['=== MLS DATA ===', 'Property Address : x', 'List Price       : $950,000', 'Bedrooms         : 3', 'Bathrooms        : 2', 'Square Footage   : 1,600 sq ft', 'Property Type    : Single Family'].join('\n');
const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m === 'GET' && /\/rest\/v1\/properties/.test(u)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(u)) return J(route, 200, [{ id: 1, property_id: A, subfolder: 'mls_data', content: MLS, updated_at: '2026-10-01T00:00:00Z' }]);
  if (m === 'GET') return J(route, 200, []);
  return J(route, 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 500) : '')); } }
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

  // share: 'ok' | 'cancel' | 'none'
  async function press(device, share) {
    const ctx = await browser.newContext(device === 'phone' ? { userAgent: IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    await ctx.addInitScript((share) => {
      localStorage.setItem('fos_agent', 'Marc Cashin'); localStorage.setItem('fos_key_Marc_Cashin', 'test-key');
      window.__shared = [];
      if (share === 'none') {
        Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      } else {
        Object.defineProperty(navigator, 'canShare', { value: (d) => !!(d && d.files && d.files.length), configurable: true });
        Object.defineProperty(navigator, 'share', { value: async (d) => {
          window.__shared.push({ files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })), title: d.title });
          if (share === 'cancel') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
        }, configurable: true });
      }
    }, share);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(device + '/' + share + ': ' + e.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const st = document.querySelector('#app').__vue_app__._instance.setupState;
      if (!st.lstProperties.length) await st.lstFetchProperties();
      await st.lstOpenProperty(st.lstProperties[0]); await new Promise(r => setTimeout(r, 200));
      st.lstOpenTool('sellerprep'); await new Promise(r => setTimeout(r, 200));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /Send to Seller/i.test(b.innerText));
      if (!btn) return { err: 'no Send to Seller button', open: st.lstToolOpen };
      btn.click(); await new Promise(r => setTimeout(r, 400));
      return { shared: window.__shared, viewer: !!st.pdfViewerSrc, gold: st.goldToast.show ? st.goldToast.msg : '', toast: st.toast.show ? st.toast.msg : '', phone: st.fosIsPhone ? st.fosIsPhone() : null };
    });
    await ctx.close();
    return r;
  }

  console.log('Send to Seller');
  let r = await press('phone', 'ok');
  ok(r.shared && r.shared.length === 1 && r.shared[0].files.length === 1 && r.shared[0].files[0].name === 'Seller-Prep-Guide.pdf' && r.shared[0].files[0].type === 'application/pdf' && r.shared[0].files[0].size > 1000 && !r.viewer && !/new tab/.test(r.gold), 'on a phone: the share menu opens once with the guide PDF attached, and nothing else opens', r);
  r = await press('phone', 'cancel');
  ok(r.shared && r.shared.length === 1 && !r.viewer && !r.gold && !r.toast, 'on a phone, cancelling the share menu does nothing else', r);
  r = await press('phone', 'none');
  ok(r.viewer && /Tap Download, then send the PDF to the seller/.test(r.gold), 'a phone that cannot share a file opens the PDF and says to download and send it', r);
  r = await press('computer', 'ok');
  ok(r.shared && r.shared.length === 0 && r.viewer && /attach it to your email to the seller/.test(r.gold) && !/new tab/.test(r.gold), 'on a computer: the PDF opens and the message says to download it and attach it to an email; never "new tab"', r);

  const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok(!/sellerPrepSendModal|sellerPrepGenerateAndSend|sellerPrepRecipient/.test(src), 'the send window nothing opened is gone', null);
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
