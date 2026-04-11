'use strict';
/**
 * prepare-lota-upload.js — Netlify Function
 *
 * Authenticates with Google Drive using a service account (credentials stored
 * as Netlify environment variables), then:
 *   1. Finds or creates the current month folder inside the LOTA parent folder
 *   2. Finds or creates the "Self-Shot" subfolder inside the month folder
 *   3. Finds or creates a topic folder inside Self-Shot
 *   4. Initialises a Google Drive resumable upload session for each video file
 *   5. Uploads the edit-notes.txt directly (small file, no resumable session needed)
 *   6. Returns the pre-authenticated upload URLs to the browser
 *
 * The browser then PUTs each video file directly to Google Drive using those
 * URLs — no additional auth required, full quality preserved, no size limit.
 *
 * Required Netlify env vars:
 *   GOOGLE_SA_EMAIL  — service account email
 *   GOOGLE_SA_KEY    — service account private key (PEM) or full JSON key file
 *
 * One-time Drive setup:
 *   Share the LOTA parent folder (129RwYEDPK0aC7hGJDTA8_QDX0XFDqD5e)
 *   with the service account email, Editor access.
 */

const https  = require('https');
const crypto = require('crypto');

const LOTA_FOLDER_ID = '129RwYEDPK0aC7hGJDTA8_QDX0XFDqD5e';

// ─── Low-level HTTPS helper ───────────────────────────────────────────────────
function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
      );
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── Service Account → Access Token ──────────────────────────────────────────
async function getAccessToken() {
  const email  = process.env.GOOGLE_SA_EMAIL;
  const rawKey = process.env.GOOGLE_SA_KEY;
  if (!email || !rawKey) throw new Error('GOOGLE_SA_EMAIL / GOOGLE_SA_KEY env vars not set');

  // Accept either a raw PEM key or a full JSON key file string
  let privateKey;
  try {
    const parsed = JSON.parse(rawKey);
    privateKey   = parsed.private_key.replace(/\\n/g, '\n');
  } catch {
    privateKey = rawKey.replace(/\\n/g, '\n');
  }

  const now       = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claimB64  = Buffer.from(JSON.stringify({
    iss:   email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  })).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${headerB64}.${claimB64}`);
  const sig = signer.sign(privateKey, 'base64url');
  const jwt = `${headerB64}.${claimB64}.${sig}`;

  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt;
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
  if (!data.access_token) throw new Error('SA auth failed: ' + resp.body.substring(0, 300));
  return data.access_token;
}

// ─── Drive GET ────────────────────────────────────────────────────────────────
async function driveGet(token, path) {
  const resp = await httpsReq({ hostname: 'www.googleapis.com', path: '/drive/v3' + path, method: 'GET', headers: { Authorization: 'Bearer ' + token } });
  if (resp.status >= 400) throw new Error('Drive GET ' + resp.status + ': ' + resp.body.substring(0, 300));
  return JSON.parse(resp.body);
}

// ─── Drive POST (JSON) ────────────────────────────────────────────────────────
async function drivePost(token, path, body) {
  const bodyStr = JSON.stringify(body);
  const resp = await httpsReq(
    { hostname: 'www.googleapis.com', path: '/drive/v3' + path, method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
    bodyStr
  );
  if (resp.status >= 400) throw new Error('Drive POST ' + resp.status + ': ' + resp.body.substring(0, 300));
  return JSON.parse(resp.body);
}

// ─── Find or create a folder ──────────────────────────────────────────────────
async function findOrCreateFolder(token, parentId, name) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and name='${escaped}' and trashed=false`
  );
  const result = await driveGet(
    token,
    `/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`
  );
  if (result.files && result.files.length > 0) return result.files[0].id;

  const created = await drivePost(token, '/files?supportsAllDrives=true', {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents:  [parentId],
  });
  return created.id;
}

// ─── Initialise a resumable upload session ────────────────────────────────────
// Returns a pre-authenticated upload URL the browser can PUT the file to directly.
async function initResumableUpload(token, folderId, fileName, mimeType, fileSize) {
  const metadata    = JSON.stringify({ name: fileName, parents: [folderId] });
  const metaBuf     = Buffer.from(metadata, 'utf8');
  const contentType = mimeType || 'video/mp4';

  const resp = await httpsReq(
    {
      hostname: 'www.googleapis.com',
      path:     '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      method:   'POST',
      headers:  {
        Authorization:            'Bearer ' + token,
        'Content-Type':           'application/json',
        'Content-Length':          metaBuf.length,
        'X-Upload-Content-Type':   contentType,
        'X-Upload-Content-Length': fileSize,
      },
    },
    metadata
  );

  if (resp.status !== 200) throw new Error('Upload init failed ' + resp.status + ': ' + resp.body.substring(0, 300));
  const location = resp.headers['location'];
  if (!location) throw new Error('Google Drive did not return an upload Location header');
  return location;
}

// ─── Upload a small text file directly ───────────────────────────────────────
async function uploadTextFile(token, folderId, fileName, content) {
  const meta     = JSON.stringify({ name: fileName, parents: [folderId] });
  const boundary = 'fos_lota_boundary';
  const body     = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    meta + '\r\n',
    `--${boundary}\r\n`,
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n',
    content + '\r\n',
    `--${boundary}--`,
  ].join('');
  const bodyBuf = Buffer.from(body, 'utf8');

  const resp = await httpsReq(
    {
      hostname: 'www.googleapis.com',
      path:     '/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
      method:   'POST',
      headers:  {
        Authorization:  'Bearer ' + token,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
    },
    body
  );
  if (resp.status >= 300) throw new Error('Text file upload failed: ' + resp.status);
  return JSON.parse(resp.body);
}

// ─── Month folder name ────────────────────────────────────────────────────────
function getMonthFolder() {
  const now    = new Date();
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')} ${MONTHS[now.getMonth()]}`;
}

// ─── Build edit-notes.txt content ────────────────────────────────────────────
function buildEditNotes(topic, month, agent, notes, refUrl) {
  const sep  = '-'.repeat(32);
  const lines = [
    'VIDEO SUBMISSION — FORWARD OS',
    '='.repeat(32),
    `Topic:  ${topic}`,
    `Month:  ${month}`,
    `Agent:  ${agent}`,
    `Date:   ${new Date().toDateString()}`,
    '',
  ];
  if (notes)  lines.push('EDIT DIRECTION:', sep, notes, '');
  if (refUrl) lines.push('REFERENCE VIDEO:', sep, refUrl, '');
  return lines.join('\n');
}

// ─── CORS headers (same Netlify site = same origin, but added for safety) ────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ─── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { topic, agentName, editNotes, refUrl, files } = JSON.parse(event.body || '{}');
    if (!topic || !files || !files.length)
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'topic and files are required' }) };

    // Authenticate with Google
    const token      = await getAccessToken();
    const monthFolder = getMonthFolder();

    // Build folder hierarchy: LOTA Parent → Month → Self-Shot → Topic
    const monthId    = await findOrCreateFolder(token, LOTA_FOLDER_ID, monthFolder);
    const selfShotId = await findOrCreateFolder(token, monthId,         'Self-Shot');
    const topicId    = await findOrCreateFolder(token, selfShotId,       topic);

    // Initialise one resumable upload session per video file (run in parallel)
    const uploads = await Promise.all(
      files.map(f => initResumableUpload(token, topicId, f.name, f.type, f.size))
    );

    // Upload edit-notes.txt if the agent provided any direction
    if (editNotes || refUrl) {
      const noteContent = buildEditNotes(topic, monthFolder, agentName || 'Agent', editNotes || '', refUrl || '');
      await uploadTextFile(token, topicId, 'edit-notes.txt', noteContent);
    }

    return {
      statusCode: 200,
      headers:    CORS,
      body: JSON.stringify({
        topicFolderId: topicId,
        folderUrl:     `https://drive.google.com/drive/folders/${topicId}`,
        monthFolder,
        uploads,   // array of pre-authenticated upload URLs, one per file
      }),
    };

  } catch (err) {
    console.error('[prepare-lota-upload]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
