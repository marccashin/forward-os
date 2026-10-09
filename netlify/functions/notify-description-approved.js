'use strict';
/**
 * notify-description-approved.js: Netlify Function
 *
 * Tells Concierge that a listing description was approved for marketing. The OS calls
 * this right after an approval is written. It posts one JSON message to a Zapier catch
 * hook; the Zap (built in the Command Center session) emails concierge@fwrdrealestate.com.
 *
 * The browser sends only the listing's id. This function reads the approval and the
 * listing from the database itself and sends what is stored there, so the message can
 * only ever describe a real approval, in the exact approved text.
 *
 * Required Netlify env var:
 *   ZAPIER_DESCRIPTION_APPROVED_HOOK   the Zapier catch hook address (https://hooks.zapier.com/...)
 * Optional (default to the OS's own public values):
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * The hook address never leaves this function: it is not in index.html, not in any
 * answer, and not in any log line.
 *
 * Answers (always JSON):
 *   200 { ok: true }                       Zapier accepted the message
 *   4xx / 5xx { ok: false, code, error }   nothing was delivered; `error` is plain English
 */

const DEFAULT_SUPABASE_URL = 'https://ewedrgopezogifzysusn.supabase.co';
// The public (anon) key, the same one index.html ships to every browser.
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3ZWRyZ29wZXpvZ2lmenlzdXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTkwNzIsImV4cCI6MjA4OTY5NTA3Mn0.MA6lym5AATU1fe_tlIaL7YdUrpzVxHeD0lFXGAOceD4';

// Netlify stops a function at 10 seconds. Two reads and one send must fit inside that.
const HOOK_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 2000;

// Who may ask: the OS itself. Same rule as get-drive-token.js.
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
  if (site === 'cross-site') return false;
  if (origin) return originAllowed(origin);
  if (site === 'same-origin') return true;
  return originAllowed(refOrigin);
}

function corsFor(headers) {
  const o = (headers && (headers.origin || headers.Origin)) || '';
  return {
    'Access-Control-Allow-Origin':  originAllowed(o) ? o : 'https://forward-os.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary':                         'Origin',
    'Content-Type':                 'application/json',
  };
}

function hookUrl(env) {
  const u = String((env && env.ZAPIER_DESCRIPTION_APPROVED_HOOK) || '').trim();
  if (!u) return { error: 'not_configured' };
  let p;
  try { p = new URL(u); } catch (e) { return { error: 'bad_address' }; }
  if (p.protocol !== 'https:') return { error: 'bad_address' };
  return { url: u };
}

// "Oct 9, 2026, 9:42 AM ET": the approval time as Concierge should read it.
function displayTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  }) + ' ET';
}

// The one place the message is shaped. The Command Center builds its Zap against this.
function buildPayload(approval, property) {
  return {
    event:               'listing_description_approved',
    source:              'forward-os',
    property_id:         approval.property_id,
    address:             (property && property.address) || '',
    agent_name:          (property && property.agent_name) || '',
    approved_by:         approval.approved_by,
    approved_at:         approval.approved_at,
    approved_at_display: displayTime(approval.approved_at),
    content:             approval.content,
  };
}

async function timedFetch(fetchImpl, url, options, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetchImpl(url, Object.assign({}, options, { signal: ctl.signal })); }
  finally { clearTimeout(t); }
}

async function readRow(fetchImpl, env, table, query) {
  const base = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key  = env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  const res = await timedFetch(fetchImpl, base + '/rest/v1/' + table + '?' + query, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  }, READ_TIMEOUT_MS);
  if (!res.ok) {
    let detail = 'error ' + res.status;
    try { const j = await res.json(); detail = j.message || detail; } catch (e) {}
    const err = new Error(detail); err.status = res.status; throw err;
  }
  const rows = await res.json();
  return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
}

function answer(cors, status, body) {
  return { statusCode: status, headers: cors, body: JSON.stringify(body) };
}

// deps = { env, fetch } so the test can run this with a made-up network.
async function handle(event, deps) {
  const env = (deps && deps.env) || process.env;
  const fetchImpl = (deps && deps.fetch) || fetch;
  const CORS = corsFor(event.headers);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return answer(CORS, 405, { ok: false, code: 'method', error: 'Not available.' });
  }
  if (!requestAllowed(event.headers)) {
    const h = event.headers || {};
    console.warn('[notify-description-approved] refused', JSON.stringify({
      origin: h.origin || '', site: h['sec-fetch-site'] || '', referer: (h.referer || '').slice(0, 120) }));
    return answer(CORS, 403, { ok: false, code: 'refused', error: 'Not available.' });
  }

  let propertyId = '';
  try { propertyId = String((JSON.parse(event.body || '{}') || {}).property_id || ''); } catch (e) {}
  if (!/^[A-Za-z0-9-]{1,64}$/.test(propertyId)) {
    return answer(CORS, 400, { ok: false, code: 'bad_request', error: 'No listing was named, so nothing was sent.' });
  }

  const hook = hookUrl(env);
  if (hook.error === 'not_configured') {
    console.error('[notify-description-approved] NOT SENT: ZAPIER_DESCRIPTION_APPROVED_HOOK is not set. listing ' + propertyId);
    return answer(CORS, 503, { ok: false, code: 'hook_not_configured',
      error: 'the concierge notification is not set up yet (no hook address on the server)' });
  }
  if (hook.error) {
    console.error('[notify-description-approved] NOT SENT: ZAPIER_DESCRIPTION_APPROVED_HOOK is not an https address. listing ' + propertyId);
    return answer(CORS, 503, { ok: false, code: 'hook_not_configured',
      error: 'the concierge notification is set up wrong (the hook address on the server is not a web address)' });
  }

  let approval, property;
  try {
    approval = await readRow(fetchImpl, env, 'listing_description_approvals',
      'select=property_id,content,approved_by,approved_at&property_id=eq.' + encodeURIComponent(propertyId));
    if (approval) {
      property = await readRow(fetchImpl, env, 'properties',
        'select=id,address,agent_name&id=eq.' + encodeURIComponent(propertyId));
    }
  } catch (e) {
    console.error('[notify-description-approved] NOT SENT: could not read the approval. listing ' + propertyId + ': ' + (e && e.message));
    return answer(CORS, 502, { ok: false, code: 'read_failed',
      error: 'the approval could not be read back from the database (' + ((e && e.name === 'AbortError') ? 'no answer in time' : (e && e.message)) + ')' });
  }
  if (!approval) {
    console.error('[notify-description-approved] NOT SENT: no approval on file. listing ' + propertyId);
    return answer(CORS, 409, { ok: false, code: 'not_approved',
      error: 'this listing has no approval on file, so there was nothing to send' });
  }

  const payload = buildPayload(approval, property);
  let res;
  try {
    res = await timedFetch(fetchImpl, hook.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }, HOOK_TIMEOUT_MS);
  } catch (e) {
    const why = (e && e.name === 'AbortError') ? 'Zapier did not answer in time' : 'Zapier could not be reached';
    console.error('[notify-description-approved] NOT SENT: ' + why + '. listing ' + propertyId + ' approved_at ' + approval.approved_at);
    return answer(CORS, 502, { ok: false, code: 'hook_unreachable', error: why });
  }
  if (!res.ok) {
    console.error('[notify-description-approved] NOT SENT: Zapier answered ' + res.status + '. listing ' + propertyId + ' approved_at ' + approval.approved_at);
    return answer(CORS, 502, { ok: false, code: 'hook_refused', error: 'Zapier answered with error ' + res.status });
  }
  console.log('[notify-description-approved] sent. listing ' + propertyId + ' approved_at ' + approval.approved_at);
  return answer(CORS, 200, { ok: true, approved_at: approval.approved_at });
}

exports.handler = async (event) => {
  try { return await handle(event); }
  catch (e) {
    console.error('[notify-description-approved] NOT SENT: ' + (e && e.message));
    return answer(corsFor(event && event.headers), 500, { ok: false, code: 'error', error: 'the notification step failed on the server' });
  }
};

exports._test = { handle, buildPayload, displayTime, requestAllowed, originAllowed, hookUrl };
