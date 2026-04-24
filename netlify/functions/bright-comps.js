const http = require('http');
const crypto = require('crypto');

const RETS_HOST = 'bright-rets.brightmls.com';
const RETS_PORT = 6103;
const LOGIN_PATH = '/cornerstone/login';
const SEARCH_PATH = '/cornerstone/search';

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function parseDigestChallenge(header) {
  const get = (key) => { const m = header.match(new RegExp(key + '="([^"]*)"')); return m ? m[1] : ''; };
  return { realm: get('realm'), nonce: get('nonce'), qop: (header.match(/qop="?([^",\s]+)/) || [])[1] || 'auth' };
}

function digestAuth(method, path, realm, nonce, qop, user, pass) {
  const ha1 = md5(user + ':' + realm + ':' + pass);
  const ha2 = md5(method + ':' + path);
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const resp = md5(ha1 + ':' + nonce + ':' + nc + ':' + cnonce + ':' + qop + ':' + ha2);
  return 'Digest username="' + user + '",realm="' + realm + '",nonce="' + nonce + '",uri="' + path + '",qop=' + qop + ',nc=' + nc + ',cnonce="' + cnonce + '",response="' + resp + '",algorithm=MD5';
}

function doRequest(options, postBody) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

async function retsLogin() {
  const USER = process.env.BRIGHT_MLS_USER_ID;
  const PASS = process.env.BRIGHT_MLS_PASSWORD;
  const baseHdrs = { 'User-Agent': 'Bright RETS Application/1.0', 'RETS-Version': 'RETS/1.8', Accept: '*/*' };

  const r1 = await doRequest({ host: RETS_HOST, port: RETS_PORT, path: LOGIN_PATH, method: 'GET', headers: baseHdrs });
  if (r1.status !== 401) throw new Error('Login step1 status: ' + r1.status);

  const { realm, nonce, qop } = parseDigestChallenge(r1.headers['www-authenticate'] || '');
  const auth = digestAuth('GET', LOGIN_PATH, realm, nonce, qop, USER, PASS);

  const r2 = await doRequest({
    host: RETS_HOST, port: RETS_PORT, path: LOGIN_PATH, method: 'GET',
    headers: { ...baseHdrs, Authorization: auth }
  });
  if (r2.status !== 200) throw new Error('Login failed: ' + r2.status);

  const cookies = r2.headers['set-cookie'] || [];
  const cookie = cookies.map(c => c.split(';')[0]).join('; ');
  return { cookie, realm, nonce, qop };
}

async function retsSearch(session, zip, beds) {
  const USER = process.env.BRIGHT_MLS_USER_ID;
  const PASS = process.env.BRIGHT_MLS_PASSWORD;
  const baseHdrs = { 'User-Agent': 'Bright RETS Application/1.0', 'RETS-Version': 'RETS/1.8', Accept: '*/*' };

  const bedsInt = parseInt(beds) || 3;
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 18);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const query = '(PostalCode=' + zip + '),(BedsTotal=' + Math.max(1, bedsInt - 1) + '+),(BedsTotal=' + (bedsInt + 1) + '-),(StandardStatus=Sold),(CloseDate=' + cutoffStr + '+)';
  const select = 'ListingId,UnparsedAddress,BedsTotal,BathroomsTotalDecimal,AboveGradeFinishedArea,ClosePrice,CloseDate,GarageSpaces,AssociationFee,YearBuilt,PropertySubType';

  const params = new URLSearchParams({ SearchType: 'Property', Class: 'RE_1', Query: query, QueryType: 'DMQL2', Count: '0', Format: 'COMPACT-DECODED', Limit: '10', Offset: '0', Select: select });
  const body = params.toString();
  const auth = digestAuth('POST', SEARCH_PATH, session.realm, session.nonce, session.qop, USER, PASS);

  const r = await doRequest({
    host: RETS_HOST, port: RETS_PORT, path: SEARCH_PATH, method: 'POST',
    headers: { ...baseHdrs, Authorization: auth, Cookie: session.cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  return r.body;
}

function parseCompact(xml) {
  const colMatch = xml.match(/<COLUMNS>\t?([\s\S]*?)\t?<\/COLUMNS>/);
  if (!colMatch) return [];
  const cols = colMatch[1].split('\t');
  const rows = [];
  const re = /<DATA>\t?([\s\S]*?)\t?<\/DATA>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const vals = m[1].split('\t');
    const obj = {};
    cols.forEach((c, i) => { if (c.trim()) obj[c.trim()] = (vals[i] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

exports.handler = async (event) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };

  try {
    const { zip, beds } = JSON.parse(event.body || '{}');
    if (!zip) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'zip required' }) };

    const session = await retsLogin();
    const xml = await retsSearch(session, zip, beds);
    const rows = parseCompact(xml);

    const comps = rows.slice(0, 5).map(r => ({
      address: r.UnparsedAddress || '',
      beds: parseInt(r.BedsTotal) || 0,
      baths: parseFloat(r.BathroomsTotalDecimal) || 0,
      sqft: parseInt(r.AboveGradeFinishedArea) || 0,
      salePrice: parseInt(r.ClosePrice) || 0,
      closeDate: r.CloseDate || '',
      garage: parseInt(r.GarageSpaces) || 0,
      hoa: parseFloat(r.AssociationFee) || 0,
      yearBuilt: parseInt(r.YearBuilt) || 0,
      mlsId: r.ListingId || '',
      subType: r.PropertySubType || ''
    }));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ comps, count: comps.length, rawCount: rows.length }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
