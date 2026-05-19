'use strict';
/**
 * prepare-lota-upload.js — Netlify Function
 *
 * Authenticates with Google Drive using OAuth2, then:
 *   1. Finds or creates an Agent Name folder inside the LOTA parent folder
 *   2. Finds or creates a Topic folder inside the Agent folder
 *   3. Initialises a Google Drive resumable upload session for each video file
 *   4. Uploads edit-notes.txt directly (small file)
 *   5. Sends an email notification to Operations via Resend
 *   6. Returns the pre-authenticated upload URLs to the browser
 *
 * Folder structure: LOTA Parent → [Agent Name] → [Topic]
 *
 * Required Netlify env vars:
 *   GOOGLE_CLIENT_ID      — OAuth2 client ID
 *   GOOGLE_CLIENT_SECRET  — OAuth2 client secret
 *   GOOGLE_REFRESH_TOKEN  — long-lived refresh token for marc@marccashin.com
 *   RESEND_API_KEY        — Resend API key for email notifications
 */

const https = require('https');

const LOTA_FOLDER_ID = '129RwYEDPK0aC7hGJDTA8_QDX0XFDqD5e';
const OPS_EMAIL      = 'operations@fwrdrealestate.com';
const FROM_EMAIL     = 'FORWARD OS <digest@marccashin.com>';

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

// ─── OAuth2 Refresh Token → Access Token ─────────────────────────────────────
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

// ─── Send Resend email to Operations ─────────────────────────────────────────
async function notifyOperations(agent, topic, files, editNotes, refUrl, folderUrl) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { console.warn('[lota-upload] RESEND_API_KEY not set — skipping email'); return; }

  const fileLines = files.map(f => `• ${f.name} (${fmtBytes(f.size)})`).join('\n');
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  const html = `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a2744;">
      <div style="background:#1a2744;padding:20px 28px;border-radius:6px 6px 0 0;">
        <div style="font-size:10px;font-weight:800;letter-spacing:3px;color:rgba(255,255,255,0.4);margin-bottom:4px;">FORWARD OS</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">📹 New Video Submission</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px 28px;border-radius:0 0 6px 6px;">
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;width:110px;">Agent</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1a2744;font-weight:600;">${agent}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;">Topic</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1a2744;font-weight:600;">${topic}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;">Files</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1a2744;">${files.length} file${files.length !== 1 ? 's' : ''} · ${fmtBytes(totalSize)} total</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;">Submitted</td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1a2744;">${new Date().toLocaleString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td></tr>
        </table>
        ${editNotes ? `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:6px;">Edit Direction</div><div style="background:#f8fafc;border-left:3px solid #c9a84c;padding:12px 16px;border-radius:0 4px 4px 0;font-size:13px;line-height:1.6;color:#374151;">${editNotes.replace(/\n/g,'<br>')}</div></div>` : ''}
        ${refUrl ? `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:6px;">Reference Video</div><div style="font-size:13px;"><a href="${refUrl}" style="color:#2563eb;">${refUrl}</a></div></div>` : ''}
        <div style="margin-bottom:20px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:8px;">Files Uploaded</div><div style="background:#f8fafc;border-radius:4px;padding:12px 16px;font-size:13px;color:#374151;line-height:1.8;">${files.map(f=>`${f.name} <span style="color:#9ca3af;">(${fmtBytes(f.size)})</span>`).join('<br>')}</div></div>
        <a href="${folderUrl}" style="display:inline-block;background:#1a2744;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:700;">📂 Open in Google Drive</a>
      </div>
    </div>`;

  const emailPayload = JSON.stringify({
    from:    FROM_EMAIL,
    to:      [OPS_EMAIL],
    subject: `📹 New Video — ${agent}: ${topic}`,
    html,
  });

  try {
    const resp = await httpsReq(
      {
        hostname: 'api.resend.com',
        path:     '/emails',
        method:   'POST',
        headers:  {
          Authorization:  'Bearer ' + resendKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(emailPayload),
        },
      },
      emailPayload
    );
    if (resp.status >= 300) console.warn('[lota-upload] Resend responded', resp.status, resp.body.substring(0, 200));
    else console.log('[lota-upload] Ops email sent OK');
  } catch(e) {
    console.warn('[lota-upload] Email send failed (non-fatal):', e.message);
  }
}

function fmtBytes(b) {
  if (!b) return '?';
  if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

// ─── Build edit-notes.txt content ────────────────────────────────────────────
function buildEditNotes(topic, agent, notes, refUrl) {
  const sep   = '-'.repeat(32);
  const lines = [
    'VIDEO SUBMISSION — FORWARD OS',
    '='.repeat(32),
    `Topic:  ${topic}`,
    `Agent:  ${agent}`,
    `Date:   ${new Date().toDateString()}`,
    '',
  ];
  if (notes)  lines.push('EDIT DIRECTION:', sep, notes, '');
  if (refUrl) lines.push('REFERENCE VIDEO:', sep, refUrl, '');
  return lines.join('\n');
}

// ─── CORS headers ─────────────────────────────────────────────────────────────
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

    const agent = agentName || 'Agent';

    // Authenticate with Google
    const token = await getAccessToken();

    // Folder structure: LOTA Parent → Agent Name → Topic
    const agentFolderId = await findOrCreateFolder(token, LOTA_FOLDER_ID, agent);
    const topicId       = await findOrCreateFolder(token, agentFolderId,   topic);

    // Initialise one resumable upload session per video file (run in parallel)
    const uploads = await Promise.all(
      files.map(f => initResumableUpload(token, topicId, f.name, f.type, f.size))
    );

    // Upload edit-notes.txt if the agent provided any direction
    if (editNotes || refUrl) {
      const noteContent = buildEditNotes(topic, agent, editNotes || '', refUrl || '');
      await uploadTextFile(token, topicId, 'edit-notes.txt', noteContent);
    }

    // Notify Operations via email (non-blocking — failure won't break the upload)
    const folderUrl = `https://drive.google.com/drive/folders/${topicId}`;
    notifyOperations(agent, topic, files, editNotes || '', refUrl || '', folderUrl).catch(e =>
      console.warn('[lota-upload] notifyOperations error (non-fatal):', e.message)
    );

    return {
      statusCode: 200,
      headers:    CORS,
      body: JSON.stringify({
        topicFolderId: topicId,
        folderUrl,
        uploads,
      }),
    };

  } catch (err) {
    console.error('[prepare-lota-upload]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
