#!/usr/bin/env node
/*
 * FORWARD OS: "Approve for marketing" on the saved listing description.
 * Run on every pull request.
 *
 * Part 1 runs the real Netlify function (netlify/functions/notify-description-approved.js)
 * on its own against a made-up database and a made-up Zapier hook.
 *
 * Part 2 opens the real index.html in headless Chromium against a made-up database
 * that behaves like the real one: the approvals table can only be read, an approval is
 * written by the approve function, and a save of different description text deletes it
 * (the real rule is SQL, tested in ci/description-approval-db-test.js). The browser's
 * call to the Netlify function is answered by the REAL function code, so the message
 * that reaches the made-up Zapier hook is the one production would send.
 *
 * Since the flyer version and the branded PDF were added, the made-up world also has an
 * AI service (the test decides what it answers), a public storage folder that keeps
 * the uploaded PDF bytes, and the two new database functions.
 *
 * SAFETY: never touches production. Every request is intercepted.
 *
 * Usage: node ci/description-approval-test.js <dir-with-index.html>
 * Needs: playwright, vue@3.4.21, jspdf@2.5.1 (resolved through NODE_PATH).
 */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const dir = path.resolve(process.argv[2] || '.');
const VUE = fs.readFileSync(require.resolve('vue/dist/vue.global.js'), 'utf8');
const JSPDF = fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'), 'utf8');
const FN = require(path.join(dir, 'netlify/functions/notify-description-approved.js'));
const HOOK = 'https://hooks.zapier.example/hooks/catch/000/secret-test-hook/';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const PROPS = [
  { id: A, address: '100 Alpha Ct, Alexandria VA 22306', seller_name: 'Seller A', agent_name: 'Ashling McGowan', market: 'VA', status: 'draft', created_at: '2026-10-01T00:00:00Z' },
  { id: B, address: '200 Bravo Ave. Baltimore, MD', seller_name: 'Seller B', agent_name: 'Charlotte Lee', market: 'MD', status: 'draft', created_at: '2026-09-21T00:00:00Z' }
];
const MLS = (addr) => '=== MLS DATA ===\nProperty Address : ' + addr + '\nList Price       : $500,000\nHOA Fee          : None';
const TEXT1 = 'Set on a quiet court, this four bedroom home opens to a kitchen rebuilt in 2024.\n\nSecond paragraph, with "quotes" and an ampersand & a tab\there.';
const TEXT2 = TEXT1 + ' One more sentence.';
const WORDS = (n, w) => Array.from({ length: n }, (_, i) => (w || 'word') + (i + 1)).join(' ');
const FLYER1 = 'A four bedroom residence on a quiet court, with a kitchen rebuilt in 2024.\n\n' + WORDS(120, 'detail');
const SB = 'https://ewedrgopezogifzysusn.supabase.co';
const PUB = SB + '/storage/v1/object/public/listing-description-pdfs/';

// ── The made-up database ─────────────────────────────────────────────────────
let notes, approvals, settings, hookGot, mode, sent, clock, fnCalls, fnAnswers, files, ai, order, pubGets;
function reset() {
  clock = Date.parse('2026-10-09T13:42:00Z'); sent = []; hookGot = []; fnCalls = 0; fnAnswers = []; files = {}; order = []; pubGets = [];
  ai = { answers: [], calls: [], fail: 0 };
  mode = { hook: 'ok', hookSet: true, fnMissing: false, rpcFails: false, rpcLost: false, tableMissing: false, readFails: false, settingsFail: false, storage: 'ok', setPdfFails: false };
  notes = [
    { id: 'n1', property_id: A, subfolder: 'mls_data', content: MLS(PROPS[0].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n2', property_id: A, subfolder: 'listing_remarks', content: 'A DESCRIPTION', updated_at: '2026-10-02T00:00:00Z' },
    { id: 'n3', property_id: B, subfolder: 'mls_data', content: MLS(PROPS[1].address), updated_at: '2026-10-01T00:00:00Z' },
    { id: 'n4', property_id: B, subfolder: 'listing_remarks', content: TEXT1, updated_at: '2026-10-04T00:00:00Z' },
    { id: 'n5', property_id: B, subfolder: 'listing_flyer', content: FLYER1, updated_at: '2026-10-04T01:00:00Z' }
  ];
  approvals = []; settings = {};
}
const nowIso = () => { clock += 60000; return new Date(clock).toISOString().replace('Z', '+00:00'); };
const savedNote = (pid, sf) => { const n = notes.filter(x => x.property_id === pid && x.subfolder === sf).sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1))[0]; return n ? n.content : null; };
const wc = (t) => { const x = String(t || '').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, ''); return x ? x.split(/[ \t\n\r]+/).length : 0; };
const savedText = (pid) => { const n = notes.filter(x => x.property_id === pid && x.subfolder === 'listing_remarks').sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1))[0]; return n ? n.content : null; };
function recheck(pid) {   // what the database trigger does after any change to the description
  const a = approvals.find(x => x.property_id === pid); if (!a) return;
  if (savedText(pid) !== a.content || (a.flyer_content != null && savedNote(pid, 'listing_flyer') !== a.flyer_content)) approvals = approvals.filter(x => x.property_id !== pid);
}
function dbSaveNote(b) {
  if (!b.p_content || !String(b.p_content).trim()) return { status: 400, body: { code: 'P0001', message: 'refusing to replace a note with blank text' } };
  notes = notes.filter(n => !(n.property_id === b.p_property_id && n.subfolder === b.p_subfolder));
  const row = { id: 'n' + (notes.length + 100) + '-' + clock, property_id: b.p_property_id, subfolder: b.p_subfolder, content: b.p_content, updated_by: b.p_saved_by || null, updated_at: nowIso() };
  notes.push(row);
  if (b.p_subfolder === 'listing_remarks' || b.p_subfolder === 'listing_flyer') recheck(b.p_property_id);
  return { status: 200, body: row };
}
function dbApprove(b, withFlyer) {
  if (!b.p_approved_by || !String(b.p_approved_by).trim()) return { status: 400, body: { code: 'P0001', message: 'The approving agent\'s name is missing, so nothing was approved.' } };
  const cur = savedText(b.p_property_id);
  if (cur === null) return { status: 400, body: { code: 'LDA01', message: 'This listing has no saved description, so nothing was approved.' } };
  if (cur !== b.p_content) return { status: 400, body: { code: 'LDA01', message: 'The saved description is no longer the text you were reading, so nothing was approved. Read the current text and approve again.' } };
  const row = { property_id: b.p_property_id, content: cur, approved_by: String(b.p_approved_by).trim(), approved_at: nowIso(), flyer_content: null, pdf_url: null };
  if (withFlyer) {
    if (!b.p_flyer_content || !String(b.p_flyer_content).trim()) return { status: 400, body: { code: 'LDA02', message: 'There is no flyer version yet, so nothing was approved.' } };
    if (wc(b.p_flyer_content) > 200) return { status: 400, body: { code: 'LDA02', message: 'The flyer version is ' + wc(b.p_flyer_content) + ' words. The limit is 200, so nothing was approved.' } };
    const fl = savedNote(b.p_property_id, 'listing_flyer');
    if (fl === null) return { status: 400, body: { code: 'LDA01', message: 'This listing has no saved flyer version, so nothing was approved.' } };
    if (fl !== b.p_flyer_content) return { status: 400, body: { code: 'LDA01', message: 'The saved flyer version is no longer the text you were reading, so nothing was approved. Read the current text and approve again.' } };
    row.flyer_content = fl;
  }
  approvals = approvals.filter(x => x.property_id !== b.p_property_id);
  approvals.push(row);
  return { status: 200, body: row };
}
function dbSetPdf(b) {
  if (!/^https:\/\/ewedrgopezogifzysusn\.supabase\.co\/storage\/v1\/object\/public\/listing-description-pdfs\/[^?#]+\.pdf$/.test(String(b.p_pdf_url || ''))) return { status: 400, body: { code: 'P0001', message: 'That is not the address of a listing description PDF, so it was not recorded.' } };
  const a = approvals.find(x => x.property_id === b.p_property_id && x.approved_at === b.p_approved_at);
  if (!a) return { status: 400, body: { code: 'LDA01', message: 'That approval is no longer on file, so the PDF was not recorded.' } };
  a.pdf_url = b.p_pdf_url; return { status: 200, body: a };
}
// The network the Netlify function sees: the same database, and the hook.
async function fnFetch(url, opts) {
  const u = decodeURIComponent(String(url));
  const R = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.startsWith(HOOK)) {
    if (mode.hook === 'down') { const e = new Error('getaddrinfo ENOTFOUND'); throw e; }
    if (mode.hook === '500') return R(500, { status: 'error' });
    order.push('hook'); hookGot.push({ headers: opts.headers, body: JSON.parse(opts.body), raw: opts.body });
    return R(200, { status: 'success', id: 'x' });
  }
  if (/\/rest\/v1\/listing_description_approvals/.test(u)) {
    if (mode.oldColumns && /flyer_content/.test(u)) return R(400, { code: '42703', message: 'column listing_description_approvals.flyer_content does not exist' });
    return R(200, approvals.filter(a => u.includes('property_id=eq.' + a.property_id)));
  }
  if (/\/rest\/v1\/properties/.test(u)) return R(200, PROPS.filter(p => u.includes('id=eq.' + p.id)));
  return R(404, { message: 'unexpected request from the function: ' + u });
}
const fnEnv = () => (mode.hookSet ? { ZAPIER_DESCRIPTION_APPROVED_HOOK: HOOK } : {});
const prodHeaders = { origin: 'https://forward-os.netlify.app', 'sec-fetch-site': 'same-origin', referer: 'https://forward-os.netlify.app/' };
const quiet = async (f) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return await f(); } finally { console.error = e; console.warn = w; console.log = l; } };
const callFn = (event) => quiet(() => FN._test.handle(event, { env: fnEnv(), fetch: fnFetch }));

const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
function api(route) {
  const req = route.request(), u = decodeURIComponent(req.url()), m = req.method(), base = u.split('?')[0];
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (m !== 'GET') sent.push({ m, u: base, body: req.postData() || '' });
  if (/\/rest\/v1\/listing_description_approvals/.test(base)) {
    if (mode.tableMissing) return J(route, 404, { code: 'PGRST205', message: 'Could not find the table \'public.listing_description_approvals\' in the schema cache' });
    if (m !== 'GET') return J(route, 401, { code: '42501', message: 'permission denied for table listing_description_approvals' });
    if (mode.readFails) return J(route, 500, { message: 'made-up outage' });
    return J(route, 200, approvals.filter(a => u.includes('property_id=eq.' + a.property_id)));
  }
  if (/api\.anthropic\.com\/v1\/messages/.test(base)) {
    const b = JSON.parse(req.postData());
    ai.calls.push({ system: b.system || '', prompt: b.messages[0].content, max: b.max_tokens });
    if (ai.fail) return J(route, ai.fail, { error: { message: 'made-up AI outage' } });
    const text = ai.answers.length ? ai.answers.shift() : 'NO ANSWER QUEUED';
    return J(route, 200, { content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  }
  if (/\/storage\/v1\/object\/public\/listing-description-pdfs\//.test(base)) {
    pubGets.push({ key: !!(req.headers()['apikey'] || req.headers()['authorization']) });
    const k = base.split('/storage/v1/object/public/listing-description-pdfs/')[1];
    if (mode.storage === 'publicfail' || !files[k]) return J(route, 400, { message: 'Object not found' });
    return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: files[k] });
  }
  if (/\/storage\/v1\/object\/listing-description-pdfs\//.test(base)) {
    order.push('upload');
    if (mode.storage === 'nobucket') return J(route, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    if (mode.storage === '500') return J(route, 500, { message: 'made-up storage outage' });
    const k = base.split('/storage/v1/object/listing-description-pdfs/')[1];
    if (files[k]) return J(route, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    files[k] = req.postDataBuffer(); files[k].__type = req.headers()['content-type'];
    return J(route, 200, { Key: 'listing-description-pdfs/' + k });
  }
  if (/\/rpc\/set_listing_description_pdf$/.test(base)) {
    order.push('record');
    if (mode.setPdfFails) return J(route, 500, { message: 'made-up database outage' });
    const r = dbSetPdf(JSON.parse(req.postData())); return J(route, r.status, r.body);
  }
  if (/\/rpc\/approve_listing_description_with_flyer$/.test(base)) {
    order.push('approve');
    if (mode.tableMissing) return J(route, 404, { code: 'PGRST202', message: 'Could not find the function public.approve_listing_description_with_flyer' });
    if (mode.rpcFails) return J(route, 500, { message: 'made-up database outage' });
    const r = dbApprove(JSON.parse(req.postData()), true);
    if (mode.rpcLost) return route.abort('connectionreset');   // applied, but the answer never arrives
    return J(route, r.status, r.body);
  }
  if (/\/rpc\/approve_listing_description$/.test(base)) {
    if (mode.tableMissing) return J(route, 404, { code: 'PGRST202', message: 'Could not find the function public.approve_listing_description' });
    if (mode.rpcFails) return J(route, 500, { message: 'made-up database outage' });
    const r = dbApprove(JSON.parse(req.postData()));
    if (mode.rpcLost) return route.abort('connectionreset');   // applied, but the answer never arrives
    return J(route, r.status, r.body);
  }
  if (/\/rpc\/save_property_note(_by)?$/.test(base)) { const r = dbSaveNote(JSON.parse(req.postData())); return J(route, r.status, r.body); }
  if (/\/rest\/v1\/os_settings/.test(base)) {
    if (mode.settingsFail) return J(route, 500, { message: 'made-up settings outage' });
    if (m === 'GET') { const k = (u.match(/key=eq\.([^&]+)/) || [])[1]; return J(route, 200, (k in settings) ? [{ value: settings[k] }] : []); }
    const b = JSON.parse(req.postData()); settings[b.key] = b.value; return J(route, 201, []);
  }
  if (m === 'GET' && /\/rest\/v1\/properties/.test(base)) return J(route, 200, PROPS);
  if (m === 'GET' && /\/rest\/v1\/property_notes/.test(base)) return J(route, 200, notes.filter(n => u.includes(n.property_id)).sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1)));
  if (m === 'GET') return J(route, 200, []);
  return J(route, /\/rest\/v1\//.test(u) ? 201 : 200, [{ id: 1 }]);
}
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 900) : '')); } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  // ══ Part 1: the Netlify function on its own ═══════════════════════════════
  console.log('The Netlify function');
  reset();
  const post = (body, headers) => ({ httpMethod: 'POST', headers: headers || prodHeaders, body: JSON.stringify(body) });
  const parse = (r) => { try { return JSON.parse(r.body); } catch (e) { return null; } };
  let r = await callFn(post({ property_id: B }));
  ok(r.statusCode === 409 && parse(r).ok === false && hookGot.length === 0, 'a listing with no approval on file: nothing is sent, and the answer says so', r);
  approvals.push({ property_id: B, content: TEXT1, approved_by: 'Charlotte Lee', approved_at: '2026-10-09T13:42:11.123456+00:00' });
  r = await callFn(post({ property_id: B, address: 'FORGED', content: 'FORGED TEXT', approved_by: 'Somebody Else' }));
  // The expected message, typed out by hand here and not taken from the function.
  const EXPECT = {
    event: 'listing_description_approved', source: 'forward-os',
    property_id: B, address: '200 Bravo Ave. Baltimore, MD', agent_name: 'Charlotte Lee',
    approved_by: 'Charlotte Lee', approved_at: '2026-10-09T13:42:11.123456+00:00', approved_at_display: 'Oct 9, 2026, 9:42 AM ET',
    content: TEXT1, flyer_content: ''
  };
  ok(r.statusCode === 200 && parse(r).ok === true && hookGot.length === 1, 'an approved listing: one message goes to the hook and the answer is ok', r);
  ok(hookGot.length === 1 && same(hookGot[0].body, EXPECT), 'an approval from before the flyer version: the original nine fields exactly, plus an empty flyer_content, and no pdf fields', hookGot[0] && hookGot[0].body);
  ok(hookGot.length === 1 && Object.keys(hookGot[0].body).join(',') === 'event,source,property_id,address,agent_name,approved_by,approved_at,approved_at_display,content,flyer_content', 'its keys, in order', hookGot[0] && Object.keys(hookGot[0].body));
  ok(hookGot.length === 1 && hookGot[0].body.content === TEXT1 && !/FORGED|Somebody Else/.test(hookGot[0].raw), 'the text and names come from the database: extra fields sent by the caller are ignored');
  ok(hookGot.length === 1 && /application\/json/.test(hookGot[0].headers['Content-Type']), 'it is sent as JSON');
  ok(!r.body.includes('zapier') && !JSON.stringify(r.headers).includes('zapier'), 'the hook address is not in the answer', r.body);
  ok(FN._test.displayTime('2026-01-15T17:05:00Z') === 'Jan 15, 2026, 12:05 PM ET' && FN._test.displayTime('2026-07-04T03:30:00Z') === 'Jul 3, 2026, 11:30 PM ET', 'the display time is Eastern time, winter and summer', [FN._test.displayTime('2026-01-15T17:05:00Z'), FN._test.displayTime('2026-07-04T03:30:00Z')]);
  // With a flyer version and a PDF. The expected message is typed out by hand.
  hookGot = [];
  approvals[0].flyer_content = 'The flyer text.\n\nSecond flyer paragraph.';
  approvals[0].pdf_url = PUB + B + '/20261009-134300-ab12cd/Listing%20Description%20-%20200%20Bravo%20Ave.pdf';
  r = await callFn(post({ property_id: B }));
  ok(r.statusCode === 200 && hookGot.length === 1 && same(hookGot[0].body, {
    event: 'listing_description_approved', source: 'forward-os',
    property_id: B, address: '200 Bravo Ave. Baltimore, MD', agent_name: 'Charlotte Lee',
    approved_by: 'Charlotte Lee', approved_at: '2026-10-09T13:42:11.123456+00:00', approved_at_display: 'Oct 9, 2026, 9:42 AM ET',
    content: TEXT1, flyer_content: 'The flyer text.\n\nSecond flyer paragraph.',
    pdf_url: 'https://ewedrgopezogifzysusn.supabase.co/storage/v1/object/public/listing-description-pdfs/' + B + '/20261009-134300-ab12cd/Listing%20Description%20-%20200%20Bravo%20Ave.pdf',
    pdf_filename: 'Listing Description - 200 Bravo Ave.pdf'
  }), 'with a flyer version and a PDF: the same message plus flyer_content, pdf_url and pdf_filename, in that order', hookGot[0] && hookGot[0].body);
  ok(parse(r).with_pdf === true, 'and the answer to the app says the message carried a PDF', r.body);
  hookGot = []; approvals[0].pdf_url = null;
  r = await callFn(post({ property_id: B }));
  ok(hookGot.length === 1 && hookGot[0].body.flyer_content === approvals[0].flyer_content && !('pdf_url' in hookGot[0].body) && !('pdf_filename' in hookGot[0].body) && parse(r).with_pdf === false, 'the PDF was not produced: the message still goes, with the flyer version and WITHOUT pdf_url and pdf_filename', hookGot[0] && Object.keys(hookGot[0].body));
  hookGot = []; mode.oldColumns = true;
  r = await callFn(post({ property_id: B }));
  ok(r.statusCode === 200 && hookGot.length === 1 && hookGot[0].body.content === TEXT1, 'a database that does not have the two new columns yet: the approval is still announced', r);
  mode.oldColumns = false; approvals[0].flyer_content = null;
  hookGot = [];
  for (const [name, h] of [['another website', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }], ['a script with no browser headers', {}], ['cross-site with a forged origin', { origin: 'https://forward-os.netlify.app', 'sec-fetch-site': 'cross-site' }]]) {
    r = await callFn(post({ property_id: B }, h));
    ok(r.statusCode === 403 && hookGot.length === 0, 'refused, nothing sent: ' + name, r.statusCode);
  }
  for (const h of [{ origin: 'https://forward-os-staging.netlify.app', 'sec-fetch-site': 'same-origin' }, { origin: 'https://deploy-preview-189--forward-os.netlify.app', 'sec-fetch-site': 'same-origin' }]) {
    hookGot = []; r = await callFn(post({ property_id: B }, h));
    ok(r.statusCode === 200 && hookGot.length === 1 && r.headers['Access-Control-Allow-Origin'] === h.origin, 'allowed from ' + h.origin, r.statusCode);
  }
  hookGot = [];
  r = await callFn({ httpMethod: 'GET', headers: prodHeaders });
  ok(r.statusCode === 405 && hookGot.length === 0, 'a GET sends nothing', r.statusCode);
  r = await callFn(post({}));
  ok(r.statusCode === 400 && hookGot.length === 0, 'no listing id: nothing sent', r.statusCode);
  r = await callFn(post({ property_id: B + '&select=*' }));
  ok(r.statusCode === 400 && hookGot.length === 0, 'a listing id with other characters in it is refused', r.statusCode);
  mode.hookSet = false; r = await callFn(post({ property_id: B }));
  ok(r.statusCode === 503 && parse(r).code === 'hook_not_configured' && /not set up yet/.test(parse(r).error), 'no hook address on the server: says the notification is not set up yet', r);
  mode.hookSet = true; mode.hook = 'down'; r = await callFn(post({ property_id: B }));
  ok(r.statusCode === 502 && parse(r).ok === false && /could not be reached/.test(parse(r).error), 'hook unreachable: says so', r);
  mode.hook = '500'; r = await callFn(post({ property_id: B }));
  ok(r.statusCode === 502 && /error 500/.test(parse(r).error), 'hook answers with an error: says so', r);
  r = await quiet(() => FN._test.handle(post({ property_id: B }), { env: { ZAPIER_DESCRIPTION_APPROVED_HOOK: 'http://hooks.zapier.example/x' }, fetch: fnFetch }));
  ok(r.statusCode === 503 && hookGot.length === 0, 'a hook address that is not https is never used', r);
  r = await quiet(() => FN._test.handle(post({ property_id: B }), { env: fnEnv(), fetch: async () => { throw new Error('db down'); } }));
  ok(r.statusCode === 502 && parse(r).code === 'read_failed', 'the approval cannot be read back: nothing is sent, and it says so', r);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok(!/hooks\.zapier\.com/.test(html) && !/ZAPIER_DESCRIPTION_APPROVED_HOOK/.test(html), 'index.html holds no Zapier hook address and no name of the server setting');

  // ══ Part 2: the app ═══════════════════════════════════════════════════════
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(dir, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r2 => srv.listen(0, '127.0.0.1', r2));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  reset();
  let who = 'Marc Cashin';
  async function newPage() {
    const ctx = await browser.newContext();
    await ctx.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith(origin)) {
        if (u.includes('/.netlify/functions/notify-description-approved')) {
          fnCalls++;
          if (mode.fnMissing) return route.fulfill({ status: 404, contentType: 'text/html', body: '<!DOCTYPE html><h1>Not found</h1>' });
          const a = await callFn({ httpMethod: route.request().method(), headers: prodHeaders, body: route.request().postData() || '' });
          fnAnswers.push(a.body);
          return route.fulfill({ status: a.statusCode, contentType: 'application/json', body: a.body });
        }
        return u.includes('/.netlify/') ? J(route, 200, {}) : route.continue();
      }
      if (/cdnjs.*\/vue\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: VUE });
      if (/cdnjs.*\/jspdf\//.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: JSPDF });
      const t = route.request().resourceType();
      if (t === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (t === 'stylesheet' || t === 'image' || t === 'font' || t === 'media') return route.fulfill({ status: 200, body: '' });
      return api(route);
    });
    const w = who;
    await ctx.addInitScript((w2) => { localStorage.setItem('fos_agent', w2); localStorage.setItem('fos_key_' + w2.replace(/\s+/g, '_'), 'test-key'); }, w);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /approve for marketing/.test(m.text())) page.__logged = (page.__logged || []).concat(m.text()); });
    await page.goto(origin + '/index.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    return page;
  }
  let page = await newPage();
  const open = (id) => page.evaluate(async (id2) => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    if (!st.lstProperties.length) await st.lstFetchProperties();
    await st.lstOpenProperty(st.lstProperties.find(p => p.id === id2));
    await new Promise(r2 => setTimeout(r2, 300));
    const hdr = Array.from(document.querySelectorAll('.subfolder-header')).find(h => /Listing Description/i.test(h.innerText));
    hdr.click(); await new Promise(r2 => setTimeout(r2, 300));
  }, id);
  // What the agent sees: every marked line of the approval box, the header badge, the toast.
  const see = () => page.evaluate(() => {
    const st = document.querySelector('#app').__vue_app__._instance.setupState;
    const o = { badge: '', toast: (st.toast && st.toast.show) ? st.toast.msg : '', gold: (st.goldToast && st.goldToast.show) ? st.goldToast.msg : '' };
    document.querySelectorAll('[data-appr]').forEach(e => { o[e.getAttribute('data-appr')] = e.innerText.replace(/\s+/g, ' ').trim(); });
    const b = document.querySelector('[data-appr-badge]'); if (b) o.badge = b.getAttribute('data-appr-badge') + ': ' + b.innerText.trim();
    document.querySelectorAll('[data-flyer]').forEach(e => { o['f:' + e.getAttribute('data-flyer')] = e.innerText.replace(/\s+/g, ' ').trim(); });
    const pl = document.querySelector('[data-appr="pdf-link"]'); o.pdfHref = pl ? pl.getAttribute('href') : '';
    document.querySelectorAll('[data-appr-writer]').forEach(e => { o['w:' + e.getAttribute('data-appr-writer')] = e.innerText.replace(/\s+/g, ' ').trim(); });
    const a = document.querySelector('[data-appr="approve"]'); o.approveDisabled = a ? a.disabled : null;
    return o;
  });
  const click = (sel, wait) => page.evaluate(async ([sel2, wait2]) => { document.querySelector(sel2).click(); await new Promise(r2 => setTimeout(r2, wait2)); }, [sel, wait || 700]);
  const editSave = (text) => page.evaluate(async (text2) => {
    const w = (ms) => new Promise(r2 => setTimeout(r2, ms));
    const box = document.querySelector('[data-appr="box"]').parentElement;
    Array.from(box.querySelectorAll('button')).find(b => /edit/i.test(b.innerText)).click(); await w(150);
    const warn = document.querySelector('[data-appr="edit-warning"]');
    const seen = { warning: warn ? warn.innerText : '', approveDisabledWhileEditing: (document.querySelector('[data-appr="approve"]') || {}).disabled };
    const ta = box.querySelector('textarea'); ta.value = text2; ta.dispatchEvent(new Event('input', { bubbles: true })); await w(100);
    Array.from(box.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'save').click(); await w(900);
    return seen;
  }, text);
  const clearToasts = () => page.evaluate(() => { const st = document.querySelector('#app').__vue_app__._instance.setupState; st.toast.show = false; st.goldToast.show = false; });
  const rpcSent = () => sent.filter(x => /\/rpc\/approve_listing_description_with_flyer$/.test(x.u));
  const oldRpc = () => sent.filter(x => /\/rpc\/approve_listing_description$/.test(x.u));
  const dateRe = '[A-Z][a-z]{2} \\d{1,2}, 2026, \\d{1,2}:\\d{2} [AP]M';

  console.log('\nA saved description that has never been approved');
  await open(B);
  let s = await see();
  ok(s['not-approved'] === 'Not approved' && /^Approve for marketing$/i.test(s.approve) && !s.approved && !s.badge, 'the listing says Not approved and offers Approve for marketing', s);
  ok(s.approveDisabled === false && !s.failed && !s.cleared && !s['not-notified'], 'no warning of any kind', s);

  console.log('\nApprove');
  sent = []; await click('[data-appr="approve"]', 1200);
  s = await see();
  let w = rpcSent();
  ok(w.length === 1 && same(JSON.parse(w[0].body), { p_property_id: B, p_content: TEXT1, p_flyer_content: FLYER1, p_approved_by: 'Marc Cashin' }) && oldRpc().length === 0, 'one request to the approve function: this listing, the exact description and flyer version on screen, the signed-in agent', w.map(x => x.body));
  ok(sent.filter(x => /\/rest\/v1\/listing_description_approvals/.test(x.u)).length === 0, 'the app never writes to the approvals table itself', sent.map(x => x.m + ' ' + x.u));
  ok(approvals.length === 1 && approvals[0].content === TEXT1 && approvals[0].flyer_content === FLYER1 && approvals[0].approved_by === 'Marc Cashin', 'the database holds one row with the frozen description, the frozen flyer version and the name', approvals);
  ok(new RegExp('^✓ Approved by Marc Cashin on ' + dateRe + '$').test(s.approved || '') && !s['not-approved'] && !s.approve, 'the listing says "Approved by Marc Cashin on <date and time>" and the button is gone', s);
  ok(/^approved: ✓ Approved for marketing$/.test(s.badge), 'the Listing Description header carries an Approved for marketing mark', s.badge);
  ok(hookGot.length === 1 && same(hookGot[0].body, { event: 'listing_description_approved', source: 'forward-os', property_id: B, address: PROPS[1].address, agent_name: 'Charlotte Lee', approved_by: 'Marc Cashin', approved_at: approvals[0].approved_at, approved_at_display: FN._test.displayTime(approvals[0].approved_at), content: TEXT1, flyer_content: FLYER1, pdf_url: approvals[0].pdf_url, pdf_filename: 'Listing Description - 200 Bravo Ave.pdf' }) && /^https:/.test(approvals[0].pdf_url || ''), 'Concierge\'s hook got one message: address, the listing\'s agent, approved_by, approved_at, the approved text, property id, the flyer version and the PDF', hookGot.map(h => h.body));
  ok(/^Concierge was notified on /.test(s.notified || '') && !s['not-notified'] && /Concierge has been notified/.test(s.gold), 'the listing says Concierge was notified', s);
  ok(same(Object.keys(settings), ['ld_approval_notice:' + B]) && settings['ld_approval_notice:' + B].ok === true && settings['ld_approval_notice:' + B].approved_at === approvals[0].approved_at, 'and the record of that message is kept', settings);
  ok(fnAnswers.every(a => !a.includes('zapier')), 'nothing the browser received contains the hook address', fnAnswers);
  const approvedAt = approvals[0].approved_at, approvedLine = s.approved;

  console.log('\nReload the page');
  await page.context().close(); page = await newPage(); await open(B);
  s = await see();
  ok(s.approved === approvedLine && /^Concierge was notified on /.test(s.notified || '') && /approved/.test(s.badge), 'still "' + approvedLine + '", and still says Concierge was notified', s);
  ok(hookGot.length === 1, 'opening the listing sends nothing to Concierge', hookGot.length);
  await open(A);
  s = await see();
  ok(s['not-approved'] === 'Not approved' && !s.approved && !s.badge, 'another listing does not show this listing\'s approval', s);

  console.log('\nSave identical text');
  await open(B); sent = [];
  let e = await editSave(TEXT1);
  s = await see();
  ok(/Saving different text clears the approval/.test(e.warning), 'while editing an approved description the agent is warned what a change does', e);
  ok(sent.filter(x => /save_property_note_by$/.test(x.u)).length === 1 && approvals.length === 1 && approvals[0].approved_at === approvedAt, 'the save went to the database and the approval row is untouched', { sent: sent.map(x => x.u), approvals });
  ok(s.approved === approvedLine && !s.cleared && /^Listing description saved\.$/.test(s.toast), 'the listing still says Approved, and the save message says nothing about approval', s);

  console.log('\nEdit and save different text');
  e = await editSave(TEXT2);
  s = await see();
  ok(approvals.length === 0, 'the approval row is gone from the database');
  ok(s['not-approved'] === 'Not approved' && !s.approved && /^Approve for marketing$/i.test(s.approve || ''), 'the listing says Not approved and offers the button again', s);
  ok(new RegExp('^This description was approved by Marc Cashin on ' + dateRe + '\\. The text has changed since, so that approval was cleared\\. Approve it again when this text is final\\.$').test(s.cleared || ''), 'it says the approval was cleared, by whom and when it had been given, and that it must be given again', s.cleared);
  ok(/^cleared: Approval cleared$/.test(s.badge), 'the header mark changes to Approval cleared', s.badge);
  ok(/^Listing description saved\. The text changed, so its approval for marketing was cleared\. Approve it again when it is final\.$/.test(s.toast), 'the save message says so too', s.toast);
  ok(hookGot.length === 1, 'clearing sends nothing to Concierge');
  await page.context().close(); page = await newPage(); await open(B);
  s = await see();
  ok(s['not-approved'] === 'Not approved' && !s.approved && !s.badge, 'after a reload: Not approved', s);

  console.log('\nApprove again, as another agent');
  await page.context().close(); who = 'Charlotte Lee'; page = await newPage(); await open(B);
  await click('[data-appr="approve"]', 1200);
  s = await see();
  ok(approvals.length === 1 && approvals[0].content === TEXT2 && approvals[0].approved_by === 'Charlotte Lee' && /^✓ Approved by Charlotte Lee on /.test(s.approved || '') && !s.cleared, 'the new text is approved under the agent who is signed in now', { approvals, s });
  ok(hookGot.length === 2 && hookGot[1].body.content === TEXT2 && hookGot[1].body.approved_by === 'Charlotte Lee', 'Concierge gets a second message with the new text', hookGot.length);

  console.log('\nThe writer');
  const writer = (fn, arg) => page.evaluate(async ([src, arg2]) => { const st = document.querySelector('#app').__vue_app__._instance.setupState; const f = new Function('st', 'arg', 'return (' + src + ')(st, arg)'); await f(st, arg2); await new Promise(r2 => setTimeout(r2, 400)); }, [fn.toString(), arg]);
  await writer((st, t) => { st.ldStarted = true; st.ldOutput = t; st.view = 'listing-desc'; }, TEXT2);
  s = await see();
  ok(/^✓ Approved for marketing by Charlotte Lee on /.test(s['w:approved'] || '') && !s['w:approve'], 'with the saved, approved text open, the writer says it is approved', s);
  await writer((st, t) => { st.ldOutput = t; }, 'A NEW DRAFT FROM THE WRITER');
  s = await see();
  ok(/is approved for marketing \(Charlotte Lee, .*\)\. The text here is different: saving it clears that approval\./.test(s['w:will-clear'] || '') && !s['w:approve'] && !s['w:approved'], 'with different text on screen the writer warns that saving it clears the approval, and offers no Approve button', s);
  await writer(async (st) => { await st.ldSaveToProperty(); });
  s = await see();
  ok(approvals.length === 0 && /Description saved\. The text changed, so its approval for marketing was cleared/.test(s.toast), 'saving it from the writer clears the approval and says so', { approvals, toast: s.toast });
  await page.waitForTimeout(900);
  await writer((st) => { st.view = 'listing-desc'; });
  s = await see();
  ok(/^Saved to the listing\. Not approved for marketing\.$/.test(s['w:not-approved'] || '') && /^Approve for marketing$/i.test(s['w:approve'] || ''), 'after the save the writer offers Approve for marketing', s);
  await click('[data-appr-writer="approve"]', 1200);
  s = await see();
  ok(approvals.length === 1 && approvals[0].content === 'A NEW DRAFT FROM THE WRITER' && /^✓ Approved for marketing by Charlotte Lee on /.test(s['w:approved'] || ''), 'and approving there works the same way', { approvals, s });

  console.log('\nThe campaign editor (it saves as you type)');
  await writer((st) => { st.view = 'listing-detail'; });
  await writer(async (st) => { st.campLdEditVal = 'A NEW DRAFT FROM THE WRITER, EDITED IN THE CAMPAIGN'; await st.campLdSave(); });
  s = await see();
  ok(approvals.length === 0 && /^This description was approved by Charlotte Lee/.test(s.cleared || '') && /approval for marketing was cleared/.test(s.toast), 'a change made there clears the approval, and the listing says so', s);

  console.log('\nThe approval cannot be written');
  await open(B); mode.rpcFails = true; hookGot = []; fnCalls = 0;
  await click('[data-appr="approve"]', 1200);
  s = await see();
  ok(approvals.length === 0 && !s.approved && !s.badge && s['not-approved'] === 'Not approved', 'the listing does not say Approved', s);
  ok(/^NOT approved: made-up database outage\.$/.test(s.failed || '') && /^NOT approved for marketing \(made-up database outage\)\.$/.test(s.toast), 'it says NOT approved, with the database\'s own reason', s);
  ok(hookGot.length === 0 && fnCalls === 0, 'Concierge is not told about an approval that did not happen');
  mode.rpcFails = false;

  console.log('\nThe description was changed on another device after this page loaded it');
  notes.find(n => n.property_id === B && n.subfolder === 'listing_remarks').content = 'CHANGED ON A TEAMMATE\'S COMPUTER';
  await click('[data-appr="approve"]', 1200);
  s = await see();
  ok(approvals.length === 0 && !s.approved && /^NOT approved: The saved description is no longer the text you were reading/.test(s.failed || ''), 'the database refuses, nothing is approved, and the agent is told why', s);

  console.log('\nThe database applied the approval but the answer was lost');
  await open(B); mode.rpcLost = true; hookGot = [];
  await click('[data-appr="approve"]', 1500);
  s = await see(); mode.rpcLost = false;
  ok(approvals.length === 1 && /^✓ Approved by Charlotte Lee on /.test(s.approved || '') && !s.failed, 'the app asks the database again, finds the approval, and says Approved', s);
  ok(hookGot.length === 1, 'and Concierge is told', hookGot.length);

  console.log('\nThe hook cannot be reached');
  await editSave('TEXT FOR THE UNREACHABLE HOOK'); await clearToasts(); mode.hook = 'down'; hookGot = []; fnCalls = 0; page.__logged = [];
  await click('[data-appr="approve"]', 1500);
  s = await see();
  ok(approvals.length === 1 && approvals[0].content === 'TEXT FOR THE UNREACHABLE HOOK' && /^✓ Approved by Charlotte Lee on /.test(s.approved || ''), 'the approval stands, in the database and on the listing', s);
  ok(/^Concierge has NOT been notified of this approval \(Zapier could not be reached\)\. The approval stands\. Notify Concierge$/i.test(s['not-notified'] || '') && !s.notified, 'the listing says Concierge has NOT been notified, why, and offers Notify Concierge', s['not-notified']);
  ok(/^Approved for marketing, but Concierge was NOT notified \(Zapier could not be reached\)\. The approval stands\./.test(s.toast) && !/has been notified/.test(s.gold), 'the message on screen says the same and no success message is shown', s);
  const rec = settings['ld_approval_notice:' + B];
  ok(rec && rec.ok === false && rec.error === 'Zapier could not be reached' && rec.approved_at === approvals[0].approved_at && rec.by === 'Charlotte Lee', 'the failure is recorded against this approval', rec);
  ok((page.__logged || []).some(t => /Concierge NOT notified/.test(t) && t.includes(B)), 'and written to the browser log', page.__logged);
  await page.context().close(); page = await newPage(); await open(B);
  s = await see();
  ok(/^✓ Approved by Charlotte Lee on /.test(s.approved || '') && /^Concierge has NOT been notified of this approval \(Zapier could not be reached\)/.test(s['not-notified'] || ''), 'after a reload the listing still says approved, and still says Concierge has not been notified', s);
  mode.hook = 'ok';
  await click('[data-appr="notify"]', 1200);
  s = await see();
  ok(hookGot.length === 1 && hookGot[0].body.content === 'TEXT FOR THE UNREACHABLE HOOK' && /^Concierge was notified on /.test(s.notified || '') && !s['not-notified'] && settings['ld_approval_notice:' + B].ok === true, 'Notify Concierge sends the message once the hook is back, and the warning goes away', s);

  console.log('\nOther ways the notification can fail');
  for (const [name, set, unset, reason] of [
    ['no hook address on the server yet', () => { mode.hookSet = false; }, () => { mode.hookSet = true; }, 'the concierge notification is not set up yet \\(no hook address on the server\\)'],
    ['Zapier answers with an error', () => { mode.hook = '500'; }, () => { mode.hook = 'ok'; }, 'Zapier answered with error 500'],
    ['the notification function is missing', () => { mode.fnMissing = true; }, () => { mode.fnMissing = false; }, 'the notification service answered with error 404']
  ]) {
    await editSave('TEXT FOR: ' + name); set(); hookGot = [];
    await click('[data-appr="approve"]', 1500);
    s = await see(); unset();
    ok(approvals.length === 1 && /^✓ Approved by /.test(s.approved || '') && hookGot.length === 0 && new RegExp('^Concierge has NOT been notified of this approval \\(' + reason + '\\)').test(s['not-notified'] || ''), name + ': approved, and the listing says Concierge was not notified and why', s);
  }
  // The tab is closed between the approval and the message: nothing was recorded at all.
  delete settings['ld_approval_notice:' + B];
  await page.context().close(); page = await newPage(); await open(B);
  s = await see();
  ok(/^✓ Approved by /.test(s.approved || '') && /^Concierge has NOT been notified of this approval\. The approval stands\./.test(s['not-notified'] || ''), 'an approval with no record of any message to Concierge says so', s);
  mode.settingsFail = true; await open(B); s = await see(); mode.settingsFail = false;
  ok(/^✓ Approved by /.test(s.approved || '') && /^Could not check whether Concierge was notified/.test(s['notice-unknown'] || '') && !s.notified, 'if the record cannot be read the listing says it could not check; it does not claim Concierge was told', s);

  console.log('\nThe approval cannot be read');
  mode.readFails = true; await open(B); s = await see();
  ok(/^The approval could not be checked \(made-up outage\)\. This does not say whether the description is approved\./.test(s.error || '') && !s.approved && !s['not-approved'] && !s.approve && !s.badge, 'the listing says it could not check: neither Approved nor Not approved, and no button', s);
  mode.readFails = false; await click('[data-appr="recheck"]', 900); s = await see();
  ok(/^✓ Approved by /.test(s.approved || '') && !s.error, 'Check again shows the real state once the database answers', s);

  console.log('\nThe database setup has not been run yet');
  mode.tableMissing = true; await open(B); s = await see();
  ok(/^Approving is not switched on yet/.test(s.off || '') && !s.approved && !s['not-approved'] && !s.approve && !s.badge, 'the listing says approving is not switched on yet, and shows no state and no button', s);
  mode.tableMissing = false;

  // ══ The flyer version ═════════════════════════════════════════════════════
  const GOOD = 'A residence on a quiet court with a kitchen rebuilt in 2024.\n\n' + WORDS(140, 'point');
  const flyerNote = (pid) => savedNote(pid, 'listing_flyer');
  const setDraft = (text) => page.evaluate(async (t) => { const ta = document.querySelector('[data-flyer="textarea"]'); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r2 => setTimeout(r2, 200)); }, text);
  const freshA = async (desc) => {
    reset(); notes.find(n => n.property_id === A && n.subfolder === 'listing_remarks').content = desc || 'A DESCRIPTION';
    await page.context().close(); who = 'Marc Cashin'; page = await newPage(); await open(A);
  };

  console.log('\nNo flyer version yet');
  await freshA();
  s = await see();
  ok(/^No flyer version yet\./.test(s['f:none'] || '') && /^Write the flyer version$/i.test(s['f:write'] || '') && !s['f:text'], 'the listing says there is no flyer version and offers to write one', s);
  ok(s.approveDisabled === true && s['need-flyer'] === 'A flyer version is needed first.', 'Approve for marketing is off, and says a flyer version is needed first', s);
  await page.evaluate(() => document.querySelector('[data-appr="approve"]').click()); await page.waitForTimeout(500);
  ok(rpcSent().length === 0 && oldRpc().length === 0 && approvals.length === 0, 'pressing it sends nothing');

  console.log('\nWrite the flyer version');
  ai.answers = [GOOD]; sent = [];
  await click('[data-flyer="write"]', 1500);
  s = await see();
  ok(ai.calls.length === 1 && /LISTING DESCRIPTION \(the approved text to rewrite\):\nA DESCRIPTION/.test(ai.calls[0].prompt), 'one request to the AI, carrying the saved description', ai.calls.map(c => c.prompt.slice(0, 80)));
  const sys = ai.calls[0].system;
  ok(/HARD LIMIT: 200 words/.test(sys) && /Rewrite it\. Do not cut it off partway/.test(sys), 'the instructions set the hard 200 word limit and say rewrite, not truncate', sys.slice(0, 200));
  ok(/FORWARD Brand Vision & Voice:/.test(sys) && /Never use Em dashes/.test(sys) && /Use "residence" instead of "property"/.test(sys), 'they carry the same FORWARD voice and writing rules as the full description, taken from the writer\'s own prompt');
  ok(['stunning', 'luxurious', 'impeccable', 'nestled', 'boasts', 'charming', 'gorgeous', 'amazing', 'rare find', 'turnkey'].every(w2 => sys.includes(w2)), 'and every banned word');
  ok(/FAIR HOUSING, REQUIRED: describe the residence, the location and how it lives\. Never describe the buyer/.test(sys) && /"perfect for families"/.test(sys) && /Nothing about them may appear in the copy/.test(sys), 'fair housing: describe the residence, never the buyer; personas steer emphasis and never appear');
  ok(/Use ONLY facts stated in the listing description/.test(sys), 'and: only facts that are in the description');
  ok(/BUYER PERSONAS: none were kept for this listing/.test(ai.calls[0].prompt), 'with no personas kept for the listing, the request says so and does not invent any');
  w = sent.filter(x => /save_property_note_by$/.test(x.u));
  ok(w.length === 1 && JSON.parse(w[0].body).p_subfolder === 'listing_flyer' && JSON.parse(w[0].body).p_content === GOOD && flyerNote(A) === GOOD, 'the answer is saved as the listing\'s flyer version, in one save', w.map(x => x.body.slice(0, 120)));
  ok(s['f:text'] === GOOD.replace(/\s+/g, ' ') && /^152 \/ 200 words$/.test(s['f:count'] || ''), 'it is shown under the description with its word count: 152 / 200 words', { t: (s['f:text'] || '').slice(0, 60), c: s['f:count'] });
  ok(s.approveDisabled === false && !s['need-flyer'] && !s['f:error'] && !s['f:issue'], 'and Approve for marketing is now on', s);

  console.log('\nThe personas steer the rewrite');
  await freshA();
  notes.push({ id: 'nc', property_id: A, subfolder: 'listing_remarks_chat', content: JSON.stringify({ v: 1, messages: [{ role: 'user', content: 'No personas yet.' }, { role: 'assistant', content: 'Here are the five buyer personas.\nPersona 1: Dana, 41, a surgeon relocating from Boston.\nPersona 2: The Okafors.\nPersona 3. Persona 4. Persona 5.' }, { role: 'assistant', content: 'Here is the description.' }] }), updated_at: '2026-10-02T01:00:00Z' });
  await open(A); ai.answers = [GOOD];
  await click('[data-flyer="write"]', 1500);
  ok(/BUYER PERSONAS \(to steer which features lead; never to appear in the copy\):\nHere are the five buyer personas\.\nPersona 1: Dana/.test(ai.calls[0].prompt), 'the five personas the writer produced for this listing are sent with the request, marked as never to appear', ai.calls[0].prompt.slice(-260));

  console.log('\nOver the limit, or wording that breaks a rule: it is sent back, not shown');
  for (const [name, bad, reason] of [
    ['230 words', WORDS(230), /YOUR LAST ANSWER WAS REJECTED: it is 230 words and the limit is 200/],
    ['wording about who should live there', 'A residence perfect for families. ' + WORDS(100), /REJECTED: "for families" describes who should live there/],
    ['a banned word', 'A stunning residence. ' + WORDS(100), /REJECTED: it uses "stunning"/],
    ['a long dash', 'A residence ' + String.fromCharCode(0x2014) + ' with light. ' + WORDS(100), /REJECTED: it has a long dash/]
  ]) {
    await freshA(); ai.answers = [bad, GOOD];
    await click('[data-flyer="write"]', 1800);
    s = await see();
    ok(ai.calls.length === 2 && reason.test(ai.calls[1].prompt) && flyerNote(A) === GOOD && s['f:text'] === GOOD.replace(/\s+/g, ' '), name + ': rejected with the reason, written again, and only the second answer is saved and shown', { n: ai.calls.length, p: ai.calls[1] && ai.calls[1].prompt.slice(-200) });
  }

  console.log('\nThe rewrite fails');
  await freshA(); ai.answers = [WORDS(250), WORDS(240), WORDS(230)];
  await click('[data-flyer="write"]', 2200);
  s = await see();
  ok(ai.calls.length === 3 && flyerNote(A) === null && !s['f:text'], 'three answers over the limit: three tries, then it stops, and nothing is saved', { n: ai.calls.length, f: flyerNote(A) });
  ok(/^The flyer version was NOT written: three tries did not produce a version inside the rules \(last try: it is 230 words and the limit is 200\)\. Nothing was saved, and the description cannot be approved without one\./.test(s['f:error'] || ''), 'the listing says it was NOT written, and why', s['f:error']);
  ok(s.approveDisabled === true && approvals.length === 0, 'and Approve for marketing stays off', s.approveDisabled);
  await freshA(); ai.fail = 500;
  await click('[data-flyer="write"]', 1200);
  s = await see();
  ok(/^The flyer version was NOT written: made-up AI outage\./.test(s['f:error'] || '') && flyerNote(A) === null && s.approveDisabled === true, 'the AI service is down: it says so, saves nothing, and approval stays off', s['f:error']);
  ai.fail = 0;

  console.log('\nThe agent edits the flyer version');
  await click('[data-flyer="self"]', 300);
  await setDraft(WORDS(201));
  s = await see();
  ok(/^201 \/ 200 words: over the limit by 1\./.test(s['f:count'] || '') && s.approveDisabled === true && s['need-flyer'] === 'Save or cancel the flyer edit first.', 'typing 201 words: the count turns to over the limit by 1', s['f:count']);
  await click('[data-flyer="save"]', 900);
  s = await see();
  ok(flyerNote(A) === WORDS(201) && /^201 \/ 200 words: over the limit by 1\. Shorten it before approving\.$/.test(s['f:count'] || '') && s.approveDisabled === true && s['need-flyer'] === 'The flyer version is over 200 words.', 'it can be saved, but Approve stays off and says the flyer version is over 200 words', s);
  await click('[data-flyer="edit"]', 300); await setDraft(WORDS(200)); await click('[data-flyer="save"]', 900);
  s = await see();
  ok(flyerNote(A) === WORDS(200) && /^200 \/ 200 words$/.test(s['f:count'] || '') && s.approveDisabled === false, 'exactly 200 words: Approve is on', s['f:count']);
  await click('[data-flyer="edit"]', 300); await setDraft('  A home ideal for young professionals, with a stunning kitchen.  \n\n\n\n' + WORDS(60) + '   '); await click('[data-flyer="save"]', 900);
  s = await see();
  const issues = await page.evaluate(() => Array.from(document.querySelectorAll('[data-flyer="issue"]')).map(e => e.innerText));
  ok(issues.length === 2 && issues.some(t => /"for young professionals" describes who should live there/.test(t)) && issues.some(t => /uses "stunning"/.test(t)), 'wording about who should live there, and a banned word, are pointed out to the agent before approving', issues);
  ok(flyerNote(A) === 'A home ideal for young professionals, with a stunning kitchen.\n\n' + WORDS(60), 'the saved text is what was typed, with the stray spaces and blank lines at the ends removed', flyerNote(A));

  console.log('\nApprove: one approval covers both texts, and makes the PDF');
  await click('[data-flyer="edit"]', 300); await setDraft(GOOD); await click('[data-flyer="save"]', 900);
  sent = []; order = []; hookGot = []; pubGets = [];
  await click('[data-appr="approve"]', 2200);
  s = await see();
  ok(approvals.length === 1 && approvals[0].content === 'A DESCRIPTION' && approvals[0].flyer_content === GOOD && wc(approvals[0].flyer_content) <= 200, 'the row has content and flyer_content (152 words)', approvals[0] && { c: approvals[0].content, n: wc(approvals[0].flyer_content) });
  const url1 = approvals[0].pdf_url || '';
  ok(new RegExp('^' + PUB.replace(/[.]/g, '\\.') + A + '/\\d{8}-\\d{6}-[a-z0-9]+/Listing%20Description%20-%20100%20Alpha%20Ct\\.pdf$').test(url1), 'and pdf_url: a public https address in the PDF folder, under this listing, named for the street', url1);
  const key1 = decodeURIComponent(url1.slice(PUB.length)), file1 = files[key1];
  ok(!!file1 && file1.slice(0, 5).toString() === '%PDF-' && file1.length > 3000 && /application\/pdf/.test(file1.__type), 'the file stored at that address is a PDF', file1 && file1.length);
  ok(pubGets.length === 1 && pubGets[0].key === false, 'before recording it the app opened the public address with no key, as a logged-out browser would', pubGets);
  ok(same(order, ['approve', 'upload', 'record', 'hook']), 'order: approve, store the PDF, record its address, and only then tell Concierge', order);
  ok(hookGot.length === 1 && hookGot[0].body.flyer_content === GOOD && hookGot[0].body.pdf_url === url1 && hookGot[0].body.pdf_filename === 'Listing Description - 100 Alpha Ct.pdf' && hookGot[0].body.content === 'A DESCRIPTION', 'the message to Concierge carries flyer_content, pdf_url and pdf_filename', hookGot[0] && Object.keys(hookGot[0].body));
  ok(/^✓ Approved by Marc Cashin on /.test(s.approved || '') && s.pdfHref === url1 && /^Open the branded PDF/.test(s.pdf || '') && !s['pdf-failed'], 'the listing says Approved and offers Open the branded PDF', s);
  ok(s['f:text'] === GOOD.replace(/\s+/g, ' '), 'and still shows the approved flyer version');
  if (process.env.PDF_OUT) fs.writeFileSync(path.join(process.env.PDF_OUT, 'approved.pdf'), file1);   // to look at the file by hand

  console.log('\nEdit only the flyer text');
  await click('[data-flyer="edit"]', 300);
  s = await see();
  ok(/^This flyer version is approved for marketing\. Saving different text clears the approval/.test(s['f:edit-warning'] || ''), 'the agent is warned before editing an approved flyer version', s['f:edit-warning']);
  await setDraft(GOOD); await click('[data-flyer="save"]', 900);
  s = await see();
  ok(approvals.length === 1 && /^✓ Approved by/.test(s.approved || '') && /^Flyer version saved\.$/.test(s.toast), 'saving the identical flyer text keeps the approval', s.toast);
  await click('[data-flyer="edit"]', 300); await setDraft(GOOD + ' One more.'); await click('[data-flyer="save"]', 900);
  s = await see();
  ok(approvals.length === 0 && notes.find(n => n.property_id === A && n.subfolder === 'listing_remarks').content === 'A DESCRIPTION', 'saving different flyer text, with the description untouched: the approval row is gone', approvals);
  ok(s['not-approved'] === 'Not approved' && /^This description was approved by Marc Cashin on .* that approval was cleared\./.test(s.cleared || '') && /^Flyer version saved\. The text changed, so its approval for marketing was cleared\./.test(s.toast) && /cleared/.test(s.badge), 'the listing and the save message both say the approval was cleared', s);

  console.log('\nApprove again: a new file, not the old one replaced');
  await click('[data-appr="approve"]', 2200);
  const url2 = approvals[0] && approvals[0].pdf_url;
  ok(!!url2 && url2 !== url1 && Object.keys(files).length === 2 && !!files[key1], 're-approval makes a second file at a new address; the first is still there', { url1, url2, n: Object.keys(files).length });

  console.log('\nThe description is saved after the flyer version');
  await editSave('A DESCRIPTION, CHANGED');
  s = await see();
  ok(approvals.length === 0 && /^The description was saved after this flyer version was written\. Read the flyer version again, or rewrite it, before approving\.$/.test(s['f:stale'] || ''), 'the approval is cleared and the agent is told to read the flyer version again', s['f:stale']);
  await page.context().close(); page = await newPage(); await open(A);
  s = await see();
  ok(/^The description was saved after this flyer version/.test(s['f:stale'] || ''), 'and still told after a reload', s['f:stale']);
  ai.answers = [GOOD]; await click('[data-flyer="rewrite"]', 1500);
  s = await see();
  ok(!s['f:stale'] && /A DESCRIPTION, CHANGED/.test(ai.calls[ai.calls.length - 1].prompt) && flyerNote(A) === GOOD, 'Rewrite from the description uses the new description, and the notice goes away', s['f:stale']);

  console.log('\nThe PDF cannot be produced');
  for (const [name, set, unset, reason] of [
    ['storage answers with an error', () => { mode.storage = '500'; }, () => { mode.storage = 'ok'; }, 'the PDF could not be stored: made-up storage outage'],
    ['the PDF folder has not been set up', () => { mode.storage = 'nobucket'; }, () => { mode.storage = 'ok'; }, 'the PDF could not be stored: the PDF folder is not set up yet \\(the one-time database setup has not been run\\)'],
    ['the public address does not open', () => { mode.storage = 'publicfail'; }, () => { mode.storage = 'ok'; }, 'the PDF was stored but its public address does not open \\(error 400\\)'],
    ['its address cannot be recorded', () => { mode.setPdfFails = true; }, () => { mode.setPdfFails = false; }, 'the PDF was made but could not be recorded on the approval: made-up database outage']
  ]) {
    await freshA(); notes.push({ id: 'nf', property_id: A, subfolder: 'listing_flyer', content: GOOD, updated_at: '2026-10-03T00:00:00Z' }); await open(A);
    set(); hookGot = []; order = [];
    await click('[data-appr="approve"]', 2200);
    s = await see();
    ok(approvals.length === 1 && approvals[0].pdf_url === null && approvals[0].flyer_content === GOOD && /^✓ Approved by Marc Cashin on /.test(s.approved || ''), name + ': the approval stands, with pdf_url left empty', approvals[0] && approvals[0].pdf_url);
    ok(new RegExp('^The branded PDF was NOT produced \\(' + reason + '\\)\\. The approval stands\\. Make the PDF$', 'i').test(s['pdf-failed'] || '') && !s.pdf, name + ': the listing says the PDF was NOT produced, why, and offers Make the PDF', s['pdf-failed']);
    ok(hookGot.length === 1 && hookGot[0].body.flyer_content === GOOD && !('pdf_url' in hookGot[0].body) && !('pdf_filename' in hookGot[0].body) && order[order.length - 1] === 'hook', name + ': Concierge is still told, without pdf_url', hookGot[0] && Object.keys(hookGot[0].body));
    unset();
  }
  await page.context().close(); page = await newPage(); await open(A);
  s = await see();
  ok(/^The branded PDF was NOT produced\. The approval stands\. Make the PDF$/i.test(s['pdf-failed'] || '') && /^✓ Approved by/.test(s.approved || ''), 'after a reload the listing still says the PDF was not produced', s['pdf-failed']);
  hookGot = [];
  await click('[data-appr="pdf-retry"]', 2200);
  s = await see();
  ok(!!approvals[0].pdf_url && s.pdfHref === approvals[0].pdf_url && !s['pdf-failed'], 'Make the PDF produces it and the listing shows Open the branded PDF', s);
  ok(hookGot.length === 1 && hookGot[0].body.pdf_url === approvals[0].pdf_url && hookGot[0].body.pdf_filename === 'Listing Description - 100 Alpha Ct.pdf', 'and Concierge is told again, this time with the PDF', hookGot[0] && Object.keys(hookGot[0].body));

  console.log('\nAn approval from before flyer versions existed');
  await freshA(); approvals = [{ property_id: A, content: 'A DESCRIPTION', approved_by: 'Niki Lang', approved_at: '2026-10-09T17:09:04.01981+00:00' }];
  settings['ld_approval_notice:' + A] = { approved_at: approvals[0].approved_at, ok: true, at: '2026-10-09T17:09:06Z', by: 'Niki Lang', error: '' };
  await open(A); s = await see();
  ok(/^✓ Approved by Niki Lang on /.test(s.approved || '') && /^This approval was given before flyer versions existed\. It covers the description only and has no PDF\.$/.test(s['old-approval'] || '') && !s['pdf-failed'] && !s.pdf && /approved/.test(s.badge), 'it still shows as approved, says it covers the description only, and raises no PDF warning', s);

  console.log('\nThe writer, on a listing with no flyer version');
  await freshA();
  await writer((st, t) => { st.ldStarted = true; st.ldOutput = t; st.view = 'listing-desc'; }, 'A DESCRIPTION');
  s = await see();
  ok(/^A flyer version is needed first: go to the listing$/i.test(s['w:to-listing'] || '') && !s['w:approve'], 'the writer offers no Approve button, and points to the listing', s);
  await click('[data-appr-writer="to-listing"]', 500);
  s = await see();
  ok(/^Write the flyer version$/i.test(s['f:write'] || ''), 'that button opens the listing\'s description panel, where the flyer version is written', s);

  console.log('\nAn approval on file for text that is not the saved text');
  // Should never happen once the database rule is in place. If it ever does, the app must not call it approved.
  approvals = [{ property_id: A, content: 'SOME OTHER TEXT', approved_by: 'Niki Lang', approved_at: '2026-10-08T15:00:00+00:00' }];
  await open(A); s = await see();
  ok(!s.approved && !s.badge && s['not-approved'] === 'Not approved' && /^An approval by Niki Lang on .* is on file, but for different text than the text shown above\. It does not cover this text\.$/.test(s.mismatch || '') && /^Approve for marketing$/i.test(s.approve || ''), 'the listing says Not approved, explains, and offers the button', s);

  console.log('\nA listing with no saved description');
  notes = notes.filter(n => !(n.property_id === A && n.subfolder === 'listing_remarks')); approvals = [];
  await open(A); s = await see();
  ok(!s.box && !s.approve && !s.badge, 'there is nothing to approve, so no approval box is shown', s);

  ok(errors.length === 0, 'no page errors during the whole run', errors.slice(0, 5));
  await browser.close(); srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL the test itself stopped: ' + (e && e.stack || e)); process.exit(1); });
