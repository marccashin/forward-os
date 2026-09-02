// netlify/functions/cma-proximity.js
// Straight-line distance from the CMA subject property to each comp.
// Appraisers report proximity as crow-flies miles, so that is what we return.
// Uses the same GOOGLE_MAPS_PLACES_KEY as get-nearby-places.js.
// Never throws at the caller: on any failure it returns nulls so the agent
// simply fills the field in by hand, exactly as before.

const R_MILES = 3958.7613;

function haversine(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

function fmt(mi) {
  if (mi < 0.1) return '<0.1 mi';
  if (mi < 10) return mi.toFixed(1) + ' mi';
  return Math.round(mi) + ' mi';
}

exports.handler = async function (event) {
  const hdrs = { 'Content-Type': 'application/json' };
  const KEY = process.env.GOOGLE_MAPS_PLACES_KEY;

  let subject, comps;
  try {
    const body = JSON.parse(event.body || '{}');
    subject = (body.subject || '').trim();
    comps = Array.isArray(body.comps) ? body.comps : [];
  } catch (e) {
    return { statusCode: 400, headers: hdrs, body: JSON.stringify({ error: 'bad body' }) };
  }

  // Degrade quietly rather than failing the agent's import.
  if (!KEY || !subject || !comps.length) {
    return {
      statusCode: 200, headers: hdrs,
      body: JSON.stringify({
        distances: comps.map(() => null),
        reason: !KEY ? 'no_key' : (!subject ? 'no_subject' : 'no_comps')
      })
    };
  }

  const BASE = 'https://maps.googleapis.com/maps/api';
  const cache = new Map();

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Google throttles bursts, so geocode one at a time and retry a throttled
  // call rather than dropping it. Firing these in parallel silently lost
  // roughly half the results.
  async function geocode(addr) {
    const k = addr.toLowerCase().replace(/\s+/g, ' ').trim();
    if (cache.has(k)) return cache.get(k);
    let out = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${BASE}/geocode/json?address=${encodeURIComponent(addr)}&key=${KEY}`);
        const d = await r.json();
        if (d.status === 'OK' && d.results && d.results.length) {
          out = d.results[0].geometry.location; // { lat, lng }
          break;
        }
        if (d.status === 'OVER_QUERY_LIMIT' || d.status === 'UNKNOWN_ERROR') {
          await sleep(300 * (attempt + 1));
          continue;
        }
        break; // ZERO_RESULTS / REQUEST_DENIED: retrying will not help
      } catch (e) {
        await sleep(200);
      }
    }
    cache.set(k, out);
    return out;
  }

  try {
    const origin = await geocode(subject);
    if (!origin) {
      return {
        statusCode: 200, headers: hdrs,
        body: JSON.stringify({ distances: comps.map(() => null), reason: 'subject_not_found' })
      };
    }

    const points = [];
    for (const c of comps) {
      points.push(c && c.trim() ? await geocode(c.trim()) : null);
    }
    const distances = points.map(p => (p ? fmt(haversine(origin, p)) : null));

    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ distances }) };
  } catch (e) {
    return {
      statusCode: 200, headers: hdrs,
      body: JSON.stringify({ distances: comps.map(() => null), reason: e.message })
    };
  }
};
