#!/usr/bin/env node
// Build "FORWARD: If This, Then That" to PDF with headless Chromium (Playwright).
// Usage: node build.js --edition original|corrected --out <file.pdf> [--html <file.html>]
// Env:   FONT_DIR   folder holding node_modules/@fontsource* (default /tmp/tools/ittt/node_modules)
//        PLAYWRIGHT_BROWSERS_PATH, NODE_PATH (to find the playwright module)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { render, footerTemplate } = require('./template');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
}

function loadContent(edition) {
  const content = JSON.parse(JSON.stringify(require('./content')));
  if (edition === 'original') return content;
  if (edition === 'corrected') return require('./changes-2026-10-18').apply(content);
  throw new Error('unknown edition ' + edition);
}

(async () => {
  const edition = arg('edition', 'corrected');
  const out = path.resolve(arg('out', 'out.pdf'));
  const fontDir = process.env.FONT_DIR || '/tmp/tools/ittt/node_modules';
  const content = loadContent(edition);
  const html = render(content, { fontDir, extraCss: process.env.EXTRA_CSS || '' }); // EXTRA_CSS: tuning aid only
  const htmlOut = arg('html', out.replace(/\.pdf$/, '.html'));
  fs.writeFileSync(htmlOut, html);

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.goto('file://' + htmlOut, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family + ' ' + f.status));
  if (missing.length) console.warn('fonts not loaded:', missing.join(', '));
  await page.pdf({
    path: out,
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: footerTemplate(content),
  });
  await browser.close();
  console.log('wrote', out);
})().catch((e) => { console.error(e); process.exit(1); });
