// netlify/functions/git-restore.js
const crypto = require('crypto');
const https = require('https');

const GOOD_COMMIT = '4dbc02672b907ffe2b893311b399a3308529830b';
const OWNER = 'marccashin';
const REPO = 'forward-os';

function makeJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: String(appId) })).toString('base64url');
  const signing = header + '.' + payload;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signing);
  return signing + '.' + sign.sign(privateKey, 'base64url');
}

function apiCall(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: 'api.github.com',
      path, method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'forward-os-restore/1.0',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch(e) { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

exports.handler = async (event) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: h, body: '' };
  try {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!appId || !privateKey) throw new Error('Missing env vars');
    const jwt = makeJWT(appId, privateKey);
    const instRes = await apiCall('GET', '/repos/' + OWNER + '/' + REPO + '/installation', jwt);
    if (instRes.status !== 200) throw new Error('Get installation failed: ' + JSON.stringify(instRes.data));
    const installId = instRes.data.id;
    const tokRes = await apiCall('POST', '/app/installations/' + installId + '/access_tokens', jwt);
    if (tokRes.status !== 201) throw new Error('Get token failed: ' + JSON.stringify(tokRes.data));
    const tok = tokRes.data.token;
    const gcRes = await apiCall('GET', '/repos/' + OWNER + '/' + REPO + '/git/commits/' + GOOD_COMMIT, tok);
    if (gcRes.status !== 200) throw new Error('Get good commit failed: ' + JSON.stringify(gcRes.data));
    const goodTree = gcRes.data.tree.sha;
    const refRes = await apiCall('GET', '/repos/' + OWNER + '/' + REPO + '/git/ref/heads/main', tok);
    if (refRes.status !== 200) throw new Error('Get ref failed: ' + JSON.stringify(refRes.data));
    const headSha = refRes.data.object.sha;
    const ncRes = await apiCall('POST', '/repos/' + OWNER + '/' + REPO + '/git/commits', tok, {
      message: 'Restore index.html - revert accidental overwrite (restores tree from 4dbc026)',
      tree: goodTree,
      parents: [headSha],
      author: { name: 'forward-os-deployer[bot]', email: 'forward-os-deployer[bot]@users.noreply.github.com', date: new Date().toISOString() }
    });
    if (ncRes.status !== 201) throw new Error('Create commit failed: ' + JSON.stringify(ncRes.data));
    const newSha = ncRes.data.sha;
    const prRes = await apiCall('PATCH', '/repos/' + OWNER + '/' + REPO + '/git/refs/heads/main', tok, { sha: newSha, force: false });
    if (prRes.status !== 200) throw new Error('Update ref failed: ' + JSON.stringify(prRes.data));
    return { statusCode: 200, headers: h, body: JSON.stringify({ success: true, newCommit: newSha, restoredTree: goodTree }) };
  } catch(e) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: e.message }) };
  }
};
