'use strict';
/**
 * prepare-lota-upload.js — Netlify Function
 *
 * Authenticates with Google Drive using OAuth2, then:
 *   1. Renames each video to:  Agent Name - Topic - Month Year.ext
 *      (multiple files get a numbered suffix: " (2)", " (3)", etc.)
 *   2. Uploads all files directly into the LOTA root folder — no subfolders
 *   3. Sends a blocking email notification to Operations via Resend
 *   4. Returns the pre-authenticated upload URLs to the browser
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

function fmtBytes(b) {
  if (!b) return '?';
  if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

// ─── Send Resend email to Operations ─────────────────────────────────────────
async function notifyOperations(agent, topic, month, files, editNotes, refUrl, folderUrl) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error('RESEND_API_KEY not configured — cannot notify Operations');

  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  const fileRows = files.map(f =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1a2744;">${f.renamedAs}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#6b7280;text-align:right;white-space:nowrap;">${fmtBytes(f.size)}</td>
    </tr>`
  ).join('');

  const html = `
    <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a2744;">
      <div style="background:#0A2342;padding:22px 28px;">
        <div style="font-size:9px;font-weight:800;letter-spacing:3px;color:#C8A96E;text-transform:uppercase;margin-bottom:6px;">FORWARD OS</div>
        <div style="font-size:22px;font-weight:400;color:#F7F4EF;font-family:Georgia,serif;">New Video Upload</div>
        <div style="font-size:12px;color:rgba(247,244,239,0.55);margin-top:4px;">Ready for categorization in Google Drive</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px 28px;">

        <div style="display:flex;gap:0;margin-bottom:24px;">
          <div style="flex:1;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-right:none;">
            <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">Agent</div>
            <div style="font-size:14px;font-weight:600;color:#1a2744;">${agent}</div>
          </div>
          <div style="flex:1;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-right:none;">
            <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">Video topic</div>
            <div style="font-size:14px;font-weight:600;color:#1a2744;">${topic}</div>
          </div>
          <div style="flex:1;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">Month</div>
            <div style="font-size:14px;font-weight:600;color:#1a2744;">${month}</div>
          </div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Files uploaded · ${files.length} file${files.length !== 1 ? 's' : ''} · ${fmtBytes(totalSize)} total</div>
          <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;border-bottom:1px solid #e2e8f0;">File name</th>
                <th style="padding:8px 12px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;border-bottom:1px solid #e2e8f0;">Size</th>
              </tr>
            </thead>
            <tbody>${fileRows}</tbody>
          </table>
        </div>

        ${editNotes ? `
        <div style="margin-bottom:20px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Edit direction</div>
          <div style="border-left:3px solid #C8A96E;padding:12px 16px;background:#fdfbf7;font-size:13px;line-height:1.65;color:#374151;">${editNotes.replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        ${refUrl ? `
        <div style="margin-bottom:24px;">
          <div style="font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Reference video</div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:10px 14px;font-size:13px;">
            <a href="${refUrl}" style="color:#0A2342;">${refUrl}</a>
          </div>
        </div>` : ''}

        <a href="${folderUrl}" style="display:inline-block;background:#0A2342;color:#F7F4EF;text-decoration:none;padding:11px 22px;font-size:12px;font-weight:700;letter-spacing:.08em;">View in Google Drive &rarr;</a>

        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f1f5f9;font-size:11px;color:#9ca3af;">
          Sent automatically by FORWARD OS &middot; Please move files into the correct month folder
        </div>
      </div>
    </div>`;

  const emailPayload = JSON.stringify({
    from:    FROM_EMAIL,
    to:      [OPS_EMAIL],
    subject: `New Video — ${agent}: ${topic} (${month})`,
    html,
  });

  const resp = await httpsReq(
    {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers:  {
        Authorization:    'Bearer ' + resendKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(emailPayload),
      },
    },
    emailPayload
  );
  if (resp.status >= 300) throw new Error('Operations email failed (' + resp.status + '): ' + resp.body.substring(0, 200));
  console.log('[lota-upload] Ops email sent OK');
}

// ─── Build a renamed file name: Agent - Topic - Month Year.ext ───────────────
// Multiple files get suffix " (2)", " (3)", etc. on all but the first.
function buildFileName(agent, topic, monthYear, ext, index, total) {
  const base = `${agent} - ${topic} - ${monthYear}`;
  const suffix = total > 1 && index > 0 ? ` (${index + 1})` : '';
  return ext ? `${base}${suffix}.${ext}` : `${base}${suffix}`;
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

    const agent     = agentName || 'Agent';
    const monthYear = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }); // e.g. "May 2026"

    // Build renamed file list
    const renamedFiles = files.map((f, i) => {
      const ext        = (f.name || '').split('.').pop().toLowerCase();
      const renamedAs  = buildFileName(agent, topic, monthYear, ext, i, files.length);
      return { ...f, renamedAs };
    });

    // Authenticate with Google
    const token = await getAccessToken();

    // Initialise one resumable upload session per video — straight into LOTA root folder
    const uploads = await Promise.all(
      renamedFiles.map(f => initResumableUpload(token, LOTA_FOLDER_ID, f.renamedAs, f.type, f.size))
    );

    // Upload edit-notes.txt alongside the videos in the LOTA root folder
    if (editNotes || refUrl) {
      const noteFileName = buildFileName(agent, topic, monthYear, 'txt', 0, 1).replace(/\.txt$/, '') + ' - Edit Notes.txt';
      const noteContent  = [
        'VIDEO SUBMISSION — FORWARD OS',
        '='.repeat(32),
        `Topic:     ${topic}`,
        `Agent:     ${agent}`,
        `Month:     ${monthYear}`,
        `Submitted: ${new Date().toDateString()}`,
        '',
        ...(editNotes ? ['EDIT DIRECTION:', '-'.repeat(32), editNotes, ''] : []),
        ...(refUrl    ? ['REFERENCE VIDEO:', '-'.repeat(32), refUrl, ''] : []),
      ].join('\n');
      await uploadTextFile(token, LOTA_FOLDER_ID, noteFileName, noteContent);
    }

    // Notify Operations — required; throws on failure
    const folderUrl = `https://drive.google.com/drive/folders/${LOTA_FOLDER_ID}`;
    await notifyOperations(agent, topic, monthYear, renamedFiles, editNotes || '', refUrl || '', folderUrl);

    return {
      statusCode: 200,
      headers:    CORS,
      body: JSON.stringify({
        folderUrl,
        uploads,
        renamedFiles: renamedFiles.map(f => f.renamedAs),
      }),
    };

  } catch (err) {
    console.error('[prepare-lota-upload]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
