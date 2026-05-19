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

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  try {
    const token = await getAccessToken();
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ access_token: token }) };
  } catch (err) {
    console.error('[get-drive-token]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
