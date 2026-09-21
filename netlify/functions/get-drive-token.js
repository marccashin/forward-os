'use strict';
/**
 * get-drive-token.js — Netlify Function
 *
 * Returns a short-lived Google OAuth2 access token.
 * The browser uses it to upload/delete files directly via the Drive API,
 * then calls the Railway backend with only metadata (drive_file_id, drive_link).
 *
 * Required Netlify env vars:
 *   GOOGLE_CLIENT_ID      — OAuth2 client ID
 *   GOOGLE_CLIENT_SECRET  — OAuth2 client secret
 *   GOOGLE_REFRESH_TOKEN  — long-lived refresh token for marc@marccashin.com
 */

const https = require('https');

function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN env vars not set');

  const body = [
    'client_id='     + encodeURIComponent(clientId),
    'client_secret=' + encodeURIComponent(clientSecret),
    'refresh_token=' + encodeURIComponent(refreshToken),
    'grant_type=refresh_token',
  ].join('&');

  const resp = await httpsReq(
    {
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    },
    body
  );

  const data = JSON.parse(resp.body);
  if (!data.access_token) throw new Error('OAuth2 refresh failed: ' + resp.body.substring(0, 300));
  return data.access_token;
}

// ── Who may ask for a token ────────────────────────────────────────────────
// This returns a live Google Drive access token, so it answers only requests
// made by the OS itself. Agents notice nothing: the OS calls this with a
// same-site POST, which browsers always label with Sec-Fetch-Site and Origin,
// headers a web page's own JavaScript cannot forge. Requests typed into an
// address bar, sent by scripts, or made from other websites are refused.
// (A determined attacker with a raw HTTP client can fake headers. This closes
// the door to anyone who merely finds the URL; it is not a login.)
const ALLOWED_ORIGINS = [
  'https://forward-os.netlify.app',
  'https://forward-os-staging.netlify.app',
];
const DEPLOY_PREVIEW = /^https:\/\/[a-z0-9-]+--forward-os(-staging)?\.netlify\.app$/;

function originAllowed(o) {
  return !!o && (ALLOWED_ORIGINS.includes(o) || DEPLOY_PREVIEW.test(o));
}

function requestAllowed(headers) {
  const h = {};
  for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = headers[k];
  const origin = h['origin'] || '';
  const site   = h['sec-fetch-site'] || '';
  let refOrigin = '';
  try { refOrigin = h['referer'] ? new URL(h['referer']).origin : ''; } catch (e) {}
  // A different site is refused even if another header looks right.
  if (site === 'cross-site') return false;
  if (origin) return originAllowed(origin);
  if (site === 'same-origin') return true;
  return originAllowed(refOrigin);
}

function corsFor(headers) {
  const o = (headers && (headers.origin || headers.Origin)) || '';
  return {
    // Never '*': a token must not be readable by other websites.
    'Access-Control-Allow-Origin':  originAllowed(o) ? o : 'https://forward-os.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary':                         'Origin',
    'Content-Type':                 'application/json',
  };
}

exports.handler = async (event) => {
  const CORS = corsFor(event.headers);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (!requestAllowed(event.headers)) {
    const h = event.headers || {};
    console.warn('[get-drive-token] refused', JSON.stringify({
      method: event.httpMethod, origin: h.origin || '', site: h['sec-fetch-site'] || '',
      referer: (h.referer || '').slice(0, 120) }));
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Not available.' }) };
  }
  try {
    const token = await getAccessToken();
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ access_token: token }) };
  } catch (err) {
    console.error('[get-drive-token]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

exports._test = { requestAllowed, originAllowed, corsFor };
