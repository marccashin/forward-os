// netlify/functions/github-push.js
// Pushes file content to GitHub using the Git Objects API (https module, no fetch).
// Includes safety guards against accidental index.html overwrites.

const crypto = require('crypto');
const https = require('https');

function makeJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (str) => Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: String(appId) }));
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  // DO NOT use b64url() here — sign.sign() returns base64, not a plain string.
  // b64url() would double-encode it. Convert directly to base64url instead.
  const signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${unsigned}.${signature}`;
}

function apiCall(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'forward-os/1.0',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getInstallationToken(appId, privateKey) {
  const jwt = makeJWT(appId, privateKey);
  const instRes = await apiCall('GET', '/app/installations', jwt);
  if (!Array.isArray(instRes.data) || instRes.data.length === 0) {
    throw new Error('No installations: ' + JSON.stringify(instRes.data));
  }
  const installationId = instRes.data[0].id;
  const tokenRes = await apiCall('POST', `/app/installations/${installationId}/access_tokens`, jwt);
  if (!tokenRes.data.token) throw new Error('No token: ' + JSON.stringify(tokenRes.data));
  return tokenRes.data.token;
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY || '';
  if (!appId || !rawKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'GitHub App credentials not configured' }) };
  }

  // Key is stored in Netlify env as base64-encoded PEM — decode it
  const privateKey = Buffer.from(rawKey, 'base64').toString('utf8');

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const { content, message, sha: bodySha, filename, repo = 'marccashin/forward-os', action = 'push' } = body;

  // SAFETY: filename is required — no silent default to index.html
  if (!filename) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'filename is required. Do not rely on defaults.' })
    };
  }

  // SAFETY: writing index.html requires valid HTML (>100KB decoded, starts with <!)
  if (filename === 'index.html' && content && action !== 'get-sha') {
    const decoded = Buffer.from(content, 'base64').toString('utf8');
    if (decoded.length < 100000) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: `SAFETY BLOCK: index.html too small (${decoded.length} chars). Refusing to prevent accidental overwrite.` })
      };
    }
    if (!decoded.trimStart().startsWith('<!')) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'SAFETY BLOCK: index.html does not start with <!DOCTYPE. Refusing write.' })
      };
    }
  }

  try {
    const token = await getInstallationToken(appId, privateKey);

    if (action === 'delete') {
      // Delete a file via the Contents API
      const metaRes = await apiCall('GET', `/repos/${repo}/contents/${filename}`, token);
      if (metaRes.status !== 200) throw new Error('File not found: ' + JSON.stringify(metaRes.data));
      const fileSha = metaRes.data.sha;
      const delRes = await apiCall('DELETE', `/repos/${repo}/contents/${filename}`, token, {
        message: message || `chore: delete ${filename}`,
        sha: fileSha
      });
      if (delRes.status !== 200) throw new Error('DELETE failed: ' + JSON.stringify(delRes.data));
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ deleted: filename, error: null }) };
    }

    if (action === 'get-sha') {
      // Get file SHA from the tree (works for files of any size)
      const refRes = await apiCall('GET', `/repos/${repo}/git/ref/heads/main`, token);
      if (refRes.status !== 200) throw new Error('Bad ref: ' + JSON.stringify(refRes.data));
      const commitSha = refRes.data.object.sha;

      const commitRes = await apiCall('GET', `/repos/${repo}/git/commits/${commitSha}`, token);
      if (commitRes.status !== 200) throw new Error('Bad commit: ' + JSON.stringify(commitRes.data));
      const treeSha = commitRes.data.tree.sha;

      const treeRes = await apiCall('GET', `/repos/${repo}/git/trees/${treeSha}?recursive=1`, token);
      if (treeRes.status !== 200) throw new Error('Bad tree: ' + JSON.stringify(treeRes.data));

      const entry = (treeRes.data.tree || []).find(f => f.path === filename);
      if (!entry) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: `${filename} not found in tree` }) };
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ sha: entry.sha, path: entry.path }) };
    }

    // push action
    if (!content || !message) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'content and message are required for push' }) };
    }

    let sha = bodySha;
    if (!sha) {
      // Get current file SHA via Contents API (small files only — use get-sha for large files)
      const metaRes = await apiCall('GET', `/repos/${repo}/contents/${filename}`, token);
      if (metaRes.status === 200) sha = metaRes.data.sha;
    }

    const putBody = { message, content };
    if (sha) putBody.sha = sha;

    const putRes = await apiCall('PUT', `/repos/${repo}/contents/${filename}`, token, putBody);
    if (putRes.status !== 200 && putRes.status !== 201) {
      throw new Error('PUT failed: ' + JSON.stringify(putRes.data));
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        sha: putRes.data.commit ? putRes.data.commit.sha : null,
        error: null
      })
    };

  } catch (e) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }
};
