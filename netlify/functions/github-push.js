const crypto = require('crypto');

function createJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: String(appId) };
  const b64url = (str) => Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${unsigned}.${signature}`;
}

async function getInstallationToken(appId, privateKey) {
  const jwt = createJWT(appId, privateKey);
  const headers = {
    'Authorization': `Bearer ${jwt}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
  const installations = await fetch('https://api.github.com/app/installations', { headers }).then(r => r.json());
  if (!Array.isArray(installations) || installations.length === 0) {
    throw new Error('No installations: ' + JSON.stringify(installations));
  }
  const installationId = installations[0].id;
  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: 'POST', headers }
  ).then(r => r.json());
  if (!tokenRes.token) throw new Error('No token: ' + JSON.stringify(tokenRes));
  return tokenRes.token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const appId = process.env.GITHUB_APP_ID;
  const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyB64) return { statusCode: 500, body: 'GitHub App credentials not configured' };

  const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { content, message, sha: bodySha, filename = 'index.html', repo = 'marccashin/forward-os', action = 'push' } = body;

  if (action === 'get-sha') {
    try {
      const token = await getInstallationToken(appId, privateKey);
      const h = { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' };
      const ref = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers: h }).then(r => r.json());
      const commitSha = ref.object && ref.object.sha;
      if (!commitSha) throw new Error('No commit SHA: ' + JSON.stringify(ref));
      const commit = await fetch(`https://api.github.com/repos/${repo}/git/commits/${commitSha}`, { headers: h }).then(r => r.json());
      const treeSha = commit.tree && commit.tree.sha;
      if (!treeSha) throw new Error('No tree SHA');
      const tree = await fetch(`https://api.github.com/repos/${repo}/git/trees/${treeSha}?recursive=1`, { headers: h }).then(r => r.json());
      const fileEntry = (tree.tree || []).find(f => f.path === filename);
      if (!fileEntry) return { statusCode: 404, body: JSON.stringify({ error: `${filename} not found in tree` }) };
      return { statusCode: 200, body: JSON.stringify({ sha: fileEntry.sha, path: fileEntry.path }) };
    } catch(e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
  }

  if (!content || !message) return { statusCode: 400, body: 'Missing: content and message required' };

  try {
    const token = await getInstallationToken(appId, privateKey);
    const h = { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' };

    let sha = bodySha;
    if (!sha) {
      const meta = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, { headers: h }).then(r => r.json());
      sha = meta.sha;
    }

    const putBody = { message, content };
    if (sha) putBody.sha = sha;

    const result = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filename}`,
      { method: 'PUT', headers: h, body: JSON.stringify(putBody) }
    ).then(r => r.json());

    return {
      statusCode: 200,
      body: JSON.stringify({ sha: result.commit ? result.commit.sha : null, error: result.message || null })
    };
  } catch(e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};
