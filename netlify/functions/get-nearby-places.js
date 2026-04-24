// netlify/functions/get-nearby-places.js
exports.handler = async function(event) {
  const KEY = process.env.GOOGLE_MAPS_PLACES_KEY;
  if (!KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing GOOGLE_MAPS_PLACES_KEY' }) };
  let address;
  try { address = JSON.parse(event.body || '{}').address; } catch(e) {}
  if (!address) return { statusCode: 400, body: JSON.stringify({ error: 'address required' }) };
  const BASE = 'https://maps.googleapis.com/maps/api';
  const hdrs = { 'Content-Type': 'application/json' };
  try {
    const geoRes = await fetch(`${BASE}/geocode/json?address=${encodeURIComponent(address)}&key=${KEY}`);
    const geo = await geoRes.json();
    if (geo.status !== 'OK' || !geo.results.length) return { statusCode: 200, headers: hdrs, body: JSON.stringify({ distances: null, error: 'Geocode: ' + geo.status }) };
    const { lat, lng } = geo.results[0].geometry.location;
    const origin = `${lat},${lng}`;
    // Categories ordered by what homebuyers search for (Metro first for DC market)
    const cats = [
      { type: 'subway_station',         label: 'Metro' },
      { type: 'grocery_or_supermarket', label: 'Grocery' },
      { type: 'park',                   label: 'Park' },
      { type: 'cafe',                   label: 'Coffee' },
      { type: 'restaurant',             label: 'Restaurant' },
      { type: 'gym',                    label: 'Gym' },
      { type: 'pharmacy',               label: 'Pharmacy' },
    ];
    const placeResults = (await Promise.all(cats.map(async cat => {
      const r = await fetch(`${BASE}/place/nearbysearch/json?location=${origin}&rankby=distance&type=${cat.type}&key=${KEY}`);
      const d = await r.json();
      if (d.status === 'OK' && d.results && d.results.length) {
        const p = d.results[0];
        return { label: cat.label, name: p.name, place_id: p.place_id, location: p.geometry.location };
      }
      return null;
    }))).filter(Boolean);
    const seen = new Set();
    const unique = placeResults.filter(p => { if (seen.has(p.place_id)) return false; seen.add(p.place_id); return true; });
    if (!unique.length) return { statusCode: 200, headers: hdrs, body: JSON.stringify({ distances: null }) };
    const dests = unique.map(p => `${p.location.lat},${p.location.lng}`).join('|');
    const dmRes = await fetch(`${BASE}/distancematrix/json?origins=${origin}&destinations=${encodeURIComponent(dests)}&mode=driving&units=imperial&key=${KEY}`);
    const dm = await dmRes.json();
    if (dm.status !== 'OK') return { statusCode: 200, headers: hdrs, body: JSON.stringify({ distances: null, error: 'DistMatrix: ' + dm.status }) };
    const elements = dm.rows[0].elements;
    const lines = unique.map((p, i) => {
      const el = elements[i];
      const dist = el.status === 'OK' ? el.distance.text : null;
      return dist ? `- ${p.name} (${p.label}): ${dist}` : null;
    }).filter(Boolean);
    lines.sort((a, b) => {
      const mi = s => parseFloat(s.split(':').pop().replace(/[^0-9.]/g, '')) || 999;
      return mi(a) - mi(b);
    });
    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ distances: lines.join('\n') }) };
  } catch(e) {
    return { statusCode: 200, headers: hdrs, body: JSON.stringify({ distances: null, error: e.message }) };
  }
};