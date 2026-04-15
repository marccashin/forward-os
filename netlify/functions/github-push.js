const crypto = require('crypto');

function createJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: String(appId) };
  const b64url = (str) => Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${unsigned}.${signature}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const appId      = process.env.GITHUB_APP_ID;
  const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKeyB64) {
    return { statusCode: 500, body: 'GitHub App credentials not configured' };
  }

  const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { content, message, filename = 'index.html' } = body;
  if (!content || !message) return { statusCode: 400, body: 'Missing fields: content and message required' };

  try {
    // 1. Generate JWT
    const jwt = createJWT(appId, privateKey);
    const appHeaders = {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    // 2. Get installation ID
    const installations = await fetch('https://api.github.com/app/installations', { headers: appHeaders }).then(r => r.json());
    if (!Array.isArray(installations) || installations.length === 0) {
      return { statusCode: 500, body: JSON.stringify({ error: 'No installations found', detail: installations }) };
    }
    const installationId = installations[0].id;

    // 3. Get installation access token
    const tokenRes = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      { method: 'POST', headers: appHeaders }
    ).then(r => r.json());

    if (!tokenRes.token) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to get installation token', detail: tokenRes }) };
    }

    const repoHeaders = {
      'Authorization': `token ${tokenRes.token}`,
      'Content-Type': 'application/json'
    };

    const repo = 'marccashin/forward-os';

    // 4. Get current file SHA
    const meta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filename}`,
      { headers: repoHeaders }
    ).then(r => r.json());

    if (!meta.sha) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not get file SHA', detail: meta }) };
    }

    // 5. Push new content
    const result = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filename}`,
      {
        method: 'PUT',
        headers: repoHeaders,
        body: JSON.stringify({ message, content, sha: meta.sha })
      }
    ).then(r => r.json());

    return {
      statusCode: 200,
      body: JSON.stringify({
        sha: result.commit ? result.commit.sha : null,
        error: result.message || null
      })
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
