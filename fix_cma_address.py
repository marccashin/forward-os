with open('/sessions/charming-lucid-gauss/forward-os/cma-tool.html', 'r') as f:
    html = f.read()

# Replace the single-field address injection with a full parser
old_cma = "    if (_URL_ADDRESS) { const _a = document.getElementById('s_address'); if (_a && !_a.value) _a.value = _URL_ADDRESS; }"
new_cma = """    if (_URL_ADDRESS) {
      // Parse full address string into separate fields
      (function parseAndFill(raw) {
        const set = (id, val) => { if (!val) return; const el = document.getElementById(id); if (el && !el.value) el.value = val; };
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        let street = parts[0] || '';
        let unit = '';
        let cityStateZip = '';
        if (parts.length >= 2) {
          const p1 = parts[1];
          if (/^(unit|apt|#|suite)/i.test(p1)) {
            unit = p1;
            cityStateZip = parts.slice(2).join(', ');
          } else {
            cityStateZip = parts.slice(1).join(', ');
          }
        }
        // Parse "Washington DC 20037" or "Washington, DC 20037"
        const m = cityStateZip.match(/^(.*?)\\s+([A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)\\s*$/);
        let city = '', state = '', zip = '';
        if (m) { city = m[1].trim(); state = m[2]; zip = m[3]; } else { city = cityStateZip; }
        set('s_address', street);
        set('s_city', city);
        set('s_state', state);
        set('s_zip', zip);
        // also fill unit in notes if present
        if (unit) { const n = document.getElementById('s_notes'); if (n && !n.value) n.value = unit; }
      })(_URL_ADDRESS);
    }"""
assert old_cma in html, "CMA address injection not found"
html = html.replace(old_cma, new_cma, 1)

with open('/sessions/charming-lucid-gauss/forward-os/cma-tool.html', 'w') as f:
    f.write(html)
print("cma-tool.html done.")
