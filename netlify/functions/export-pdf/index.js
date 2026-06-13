// export-pdf — Netlify Function
// Accepts POST { pkg: Object, siteUrl?: string }
// Returns PDF binary of campaign-print.html rendered with headless Chrome.

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
  try {
    pkg = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: 'Invalid JSON body' };
  }

  // Site URL: Netlify injects process.env.URL on production, DEPLOY_URL on previews.
  const siteUrl = pkg._siteUrl || process.env.DEPLOY_URL || process.env.URL || 'https://forward-os.netlify.app';
  delete pkg._siteUrl; // don't pass this through to the print page

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

    // Inject pkg into sessionStorage before the page's own JS runs.
    await page.evaluateOnNewDocument((pkgData) => {
      try {
        sessionStorage.setItem('fos_campPkg', JSON.stringify(pkgData));
      } catch (e) { /* ignore */ }
    }, pkg);

    // Load the chrome-free print page. window.print() is a no-op in headless.
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 20000 });

    // Wait for fonts (Vue renders synchronously after fonts.ready resolves).
    await page.evaluate(() =>
      document.fonts.ready.catch(() => {})
    );

    // Small buffer for final Vue tick.
    await new Promise((r) => setTimeout(r, 400));

    // Render to PDF — exact flags from the campaign-package handoff spec.
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      // No margin override — @page { margin: 0 } in campaign-print.css handles it.
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
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};
