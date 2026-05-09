// Netlify function: proxies Railway API calls server-side to avoid CORS/network issues
const https = require('https');
const http = require('http');

const RAILWAY_URL = 'https://forward-command-center-production.up.railway.app';

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const apiPath = event.queryStringParameters?.endpoint || '/api/analyze-offers';
  const targetUrl = RAILWAY_URL + apiPath;
  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || 'application/json';

  try {
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const response = await new Promise((resolve, reject) => {
      const url = new URL(targetUrl);
      const options = {
        hostname: url.hostname, port: url.port || 443, path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': bodyBuffer.length },
      };
      const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.setTimeout(100000, () => { req.destroy(); reject(new Error('Railway timeout')); });
      req.write(bodyBuffer);
      req.end();
    });

    return { statusCode: response.status, headers: { ...headers, 'Content-Type': 'application/json' }, body: response.body };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};
