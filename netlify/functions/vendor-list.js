// netlify/functions/vendor-list.js
//
// FORWARD's Preferred Vendor List (Marc, Nov 16, 2026). Marc keeps the list in Google Drive;
// the OS reads it here, every time, so the Preferred Vendors page and FORWARD Voice show what
// the sheet says now. Nothing is stored.
//
// The sheet's layout, as Marc keeps it (row 1: blank, NAME, COMPANY, PHONE, EMAIL, NOTES):
//   a region row        "Washington, DC" / "Maryland" / "Virginia" in column A, the rest empty
//   category rows       column A is the category ("Electrician-"), B to F the vendor, one per row
//   empty slot rows     a category with nothing in B to F (kept as an empty slot, not a vendor)
// RANK is the order in the sheet: within a region and category, the first vendor row is
// choice 1, the next choice 2, and so on (Marc: "if we have three electricians it should name
// choice 1, 2, and 3"). To change the order, Marc moves the rows.
//
// Every value is copied as the sheet has it. Two clean-ups only, both display: invisible
// direction marks pasted with some phone numbers are removed, and a web address typed in the
// Company, Email or Notes column is shown as the vendor's website instead of as a company
// name or an email address.

const SHEET_ID = '18940w5PMmi8lEUNbYKJnTl3YVUEqB0gCKEqeqcysNqo';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit';
const CSV_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=0';

// RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const INVISIBLE_RX = /[​-‏‪-‮⁦-⁩﻿]/g;
const clean = (v) => String(v == null ? '' : v).replace(INVISIBLE_RX, '').trim();
const isUrl = (v) => /^(https?:\/\/|www\.)\S+$/i.test(v);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// "Electrician-" and "Closet design- " are the same category as "Electrician".
const catName = (v) => clean(v).replace(/[\s\-–:]+$/, '').trim();
const REGION_RX = /^(washington,?\s*d\.?c\.?|district of columbia|d\.?c\.?|maryland|virginia|northern virginia|nova)$/i;

function parseVendorCsv(text) {
  const rows = parseCsv(text).map(r => [0, 1, 2, 3, 4, 5].map(i => clean(r[i])));
  const blank = (r) => !r || r.every(v => !v);
  const onlyA = (r) => r && r[0] && r.slice(1).every(v => !v);
  const regions = [];
  const findRegion = (name) => {
    let g = regions.find(x => x.name === name);
    if (!g) { g = { name, categories: [] }; regions.push(g); }
    return g;
  };
  let region = null;
  rows.forEach((r, i) => {
    if (blank(r)) return;
    if (r[1].toUpperCase() === 'NAME' && r[2].toUpperCase() === 'COMPANY') return; // header
    if (onlyA(r) && (REGION_RX.test(r[0]) || (blank(rows[i - 1]) && blank(rows[i + 1]) && i > 0))) {
      region = findRegion(r[0]);
      return;
    }
    if (!r[0]) return; // a vendor with no category cannot be placed; never guess one
    if (!region) region = findRegion('');
    const name = catName(r[0]);
    const key = name.toLowerCase();
    let cat = region.categories.find(c => c.key === key);
    if (!cat) { cat = { key, name, vendors: [] }; region.categories.push(cat); }
    if (r.slice(1).every(v => !v)) return; // an empty slot
    let [, vName, company, phone, email, notes] = r;
    let website = '';
    if (isUrl(company)) { website = company; company = ''; }
    if (email && !isEmail(email) && isUrl(email)) { website = website || email; email = ''; }
    if (isUrl(notes)) { website = website || notes; notes = ''; }
    cat.vendors.push({ rank: cat.vendors.length + 1, name: vName, company, phone, email, website, notes });
  });
  regions.forEach(g => g.categories.forEach(c => { delete c.key; }));
  return regions.filter(g => g.categories.length);
}

exports.parseVendorCsv = parseVendorCsv;
exports.SHEET_URL = SHEET_URL;
exports.CSV_URL = CSV_URL;

exports.handler = async function () {
  const hdrs = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const fail = (why) => ({ statusCode: 502, headers: hdrs, body: JSON.stringify({ error: why, sheetUrl: SHEET_URL }) });
  let res;
  try {
    res = await fetch(CSV_URL, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return fail('Google Drive did not answer (' + (e && e.name === 'TimeoutError' ? 'no answer in 8 seconds' : (e && e.message) || e) + ')');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) return fail('Google Drive refused the list (error ' + res.status + ')');
  // A sheet that is no longer shared answers with a Google sign-in page, not a CSV.
  if (/^\s*<(!doctype|html)/i.test(text)) return fail('Google Drive asked for a sign-in: the list is no longer shared with "anyone with the link"');
  const regions = parseVendorCsv(text);
  const count = regions.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.vendors.length, 0), 0);
  if (!count) return fail('the list was read but no vendor rows were found in it');
  return {
    statusCode: 200,
    headers: hdrs,
    body: JSON.stringify({ regions, count, readAt: new Date().toISOString(), sheetUrl: SHEET_URL }),
  };
};
