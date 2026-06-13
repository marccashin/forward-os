const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }
  let pkg;
  try { pkg = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: CORS, body: 'Invalid JSON body' }; }

  const siteUrl = pkg._siteUrl || process.env.DEPLOY_URL || process.env.URL || 'https://forward-os.netlify.app';
  delete pkg._siteUrl;
  const printUrl = siteUrl + '/campaign-print.html';

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    // Pre-populate sessionStorage before page scripts run
    await page.evaluateOnNewDocument((pkgData) => {
      try { sessionStorage.setItem('fos_campPkg', JSON.stringify(pkgData)); } catch (e) {}
    }, pkg);

    // 'load' fires faster than 'networkidle0' — Vue renders on DOMContentLoaded
    await page.goto(printUrl, { waitUntil: 'load', timeout: 18000 });

    // Wait for Vue's first element to confirm rendering complete
    await page.waitForSelector('.fwd-cover', { timeout: 6000 }).catch(() => {});

    // Wait for web fonts
    await page.evaluate(() => document.fonts.ready.catch(() => {}));

    // Minimal settle
    await new Promise((r) => setTimeout(r, 150));

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="campaign-package.pdf"',
      },
      body: pdf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('export-pdf error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};
