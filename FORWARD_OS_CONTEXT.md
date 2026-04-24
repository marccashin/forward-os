# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS Cowork chat to restore full context.

---

## What is FORWARD OS?
A Vue 3 SPA (single-file, no build step) for real estate agents.
- **Live site:** https://forward-os.netlify.app
- **Source:** https://github.com/marccashin/forward-os (main branch)
- ~13,000 lines of HTML/JS/CSS in a single index.html (~1,296,189 chars as of Chat 15)

---

## Infrastructure

| Service | Purpose | Details |
|---|---|---|
| Netlify | Hosting | Site ID: 7bcc28c5-97d0-4673-abda-309325eac663 |
| Supabase | Database | Project: forward-marketing-os (ID: ewedrgopezogifzysusn) |
| Railway | Python backend | RAILWAY_URL in index.html |
| Google Drive | LOTA video uploads + client file storage | OAuth via marc@marccashin.com |
| GitHub | Source backup + auto-deploy | github.com/marccashin/forward-os |
| Resend | Transactional email | Domain: marccashin.com (verified via GoDaddy auto-configure). From: FORWARD OS <digest@marccashin.com> |

---

## Pushing Code (No PAT Required — Permanent Setup)

The function at `/.netlify/functions/github-push`:
1. Reads `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` from Netlify env vars
2. Signs a JWT (RS256), exchanges for short-lived installation token
3. Uses that token to push files to `marccashin/forward-os`

### GitHub App details
- App ID: 3382390 | Installation ID: 124051198
- Netlify env vars: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (base64 PEM)

### Standard push workflow
```js
// 1. Fetch fresh source from raw GitHub
fetch('https://raw.githubusercontent.com/marccashin/forward-os/main/index.html')
  .then(r=>r.text()).then(t=>{ window._rawSrc = t; });
// 2. Verify length (separate call)
window._rawSrc.length
// 3. Substring splice (NEVER .replace())
const si = window._rawSrc.indexOf(OLD);
window._patched = window._rawSrc.substring(0, si) + NEW + window._rawSrc.substring(si + OLD.length);
// 4. Get SHA
fetch('/.netlify/functions/github-push', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get-sha',filename:'index.html'})}).then(r=>r.json()).then(d=>{window._sha=d.sha;});
// 5. Push
const encoded = btoa(unescape(encodeURIComponent(window._patched)));
fetch('/.netlify/functions/github-push', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:encoded,message:'describe change',filename:'index.html',sha:window._sha})}).then(r=>r.json()).then(d=>{window._pushResult=d;});
```

### CRITICAL: Never push outerHTML. Always fetch source from raw GitHub.
### CRITICAL: Verify window._rawSrc.length in a SEPARATE tool call after fetching.

---

## Supabase Tables

| Table | Key Columns | Purpose |
|---|---|---|
| `buyers` | id, buyer_name, agent_name, drive_folder_id, subfolder_drive_ids, email, created_at | Buyer records |
| `properties` | id, address, agent_name, drive_folder_id, subfolder_drive_ids, created_at | Listing records |
| `buyer_assets` | id, buyer_id, subfolder, file_name, drive_link, created_at | Files for buyers |
| `property_assets` | id, property_id, subfolder, file_name, drive_link, created_at | Files for listings |
| `property_notes` | id, property_id, subfolder, content, updated_by, updated_at | Text notes. NO `created_by` column — use `updated_by` |
| `agent_feedback` | id, agent_name, type, message, created_at | Feedback (bug/idea/praise/general) |

Global vars: `window.__FORWARD_SUPABASE_URL`, `window.__FORWARD_SUPABASE_ANON_KEY`

For raw DELETE (supaRest.delete may 400 — use direct fetch instead):
```js
fetch(window.__FORWARD_SUPABASE_URL + '/rest/v1/table?filter=eq.value', {method:'DELETE',headers:{'apikey':window.__FORWARD_SUPABASE_ANON_KEY,'Authorization':'Bearer '+window.__FORWARD_SUPABASE_ANON_KEY,'Prefer':'return=representation'}})
```

### Listing Description
- Table: `property_notes` | Subfolder: `listing_remarks` | Column: `content`
- Saved by `ldSaveToProperty()` → `property_notes` + PDF to `property_assets`
- Voice generate queries: `&order=updated_at.desc&limit=1` (always gets newest)
- Bug fixed Chat 14: insert had invalid `created_by` field → silent 400. Now omitted. Agents who saved before must re-save once.

---

## App Architecture

### Vue 3 Setup
- Single `setup()` returns all state + methods to template
- Every template function MUST be in `setup()` return
- `ref()` for primitives/arrays; `computed()` for derived

### Key State: `agentName`, `propFiles`, `allAgentFiles`, `activePropFile`, `byrBuyers`, `lstProperties`

### Key Functions
- `loadPropFiles()` — fetches 4 tables in parallel
- `go(view)` — switches view; triggers `loadPropFiles()` for 'prop-files'
- `lstFetchProperties()` / `byrFetchBuyers()` — admin sees all
- `ldSaveToProperty()` — saves text to `property_notes` + PDF to Drive

---

## AGENTS & Admin
Team: Marc Cashin, Ashling McGowan, Niki Lang, Cesar Rivera, Charlotte Lee, Shannon Casey, Operations.
`ADMIN_AGENT` = 'Admin'. AGENTS array is correct — do NOT change.

---

## Upload System
- Files → `RAILWAY_URL + '/upload-file'` or `'/upload-buyer-file'`
- `_upload_ux` script wraps `window.fetch`, stores original as `const _f` (block-scoped). Shows "Keep screen on" banner + Wake Lock for uploads.
- ⚠️ NEVER wrap window.fetch again — already wrapped by _upload_ux. Double-wrapping breaks fetch permanently in that tab.

---

## Voice Modal — Write Content Tool

### Phases: `listening → parsing → confirm-write → answer`

### voiceModal.generate() flow
1. Fuzzy-match property via `_addrNorm()` (Rd/Road, St/Street, Ave/Avenue, Dr/Drive, Blvd/Boulevard + street-number fallback)
2. Fetch: `select=content&property_id=eq.{id}&subfolder=eq.listing_remarks&order=updated_at.desc&limit=1`
3. If none → "re-save the description for this property"
4. Build `_pd` → Anthropic API → set `voiceModal.answerText`

### Nav Pre-check
`/^(?:open(?!\s+house)|go to|take me to|show me|navigate to|pull up|bring up|switch to)\s+(.+)/i`
Negative lookahead prevents "open house for [address]" routing as navigation.

### Answer Phase
Full Training button hidden when `detectedTool === 'write-content'`.

---

## Feedback System
- Gold gradient CTA → modal → `agent_feedback` table
- Digest: `netlify/functions/send-feedback-digest.js`, cron `0 22 * * *` (6pm ET)
- To: marc.cashin@corcoranmce.com via Resend
- Env vars: `RESEND_API_KEY`, `RESEND_FROM`, `SUPABASE_SERVICE_KEY` (all in Netlify)

---

## Chat History Summary

### Chat 9 (April 2026)
Client Files → Supabase. Resources bug fixed. View/Send buttons. GitHub App auth.

### Chat 10 (April 16)
Restored from outerHTML corruption. Removed Claude banner. Upload UX + Wake Lock. Agent-switch refresh.

### Chat 11 (April 17)
Voice write-content: Full Training hidden. Listing description from property_notes.

### Chat 12 (April 22)
Fixed $' injection bug. Feedback button gold CTA. Railway → Hobby plan.

### Chat 13 (April 22–23)
1. Gold feedback button — `a077cf1e`
2. Feedback digest + Resend domain — `d418a157`
3. Voice hint chips — `9aea8d73`
4. Fixed "open house" nav routing (negative lookahead) — `59179fe4`
5. Address fuzzy matching (_addrNorm) — `9605cd05`

### Chat 14 (April 23)
1. Fixed property_notes insert bug (invalid `created_by` field → silent 400) — `4409d117`
2. Voice generate query: added `&order=updated_at.desc&limit=1` — `be14a7a0`
3. Backfilled 19209 Croom Road description from Drive PDF into property_notes
4. Context file rebuilt (previous GitHub version was truncated)
5. Pitfall: never double-wrap window.fetch — use fresh tab if fetch breaks

### Chat 15 (April 23, 2026)
1. **Google Maps distance integration**: New Netlify function `get-nearby-places.js` calls Geocoding API + Places Nearby Search + Distance Matrix API server-side. Client-side `ldGetAmenityDistances()` calls the function and injects real driving distances into LD_SYSTEM as VERIFIED DISTANCE DATA. Updated instruction #7 to prohibit fabricated distances. Commits `2f855df2` (index.html), `259fb4f3` (new function).
2. **Env var required**: `GOOGLE_MAPS_PLACES_KEY` must be set in Netlify with a key that has Places API, Geocoding API, and Distance Matrix API enabled.
3. Pitfall: Browser fetch broken by prior session interceptors — opened fresh tab for all subsequent work.

---

## Common Pitfalls

1. **Template function invisible?** → Not in `setup()` return.
2. **Raw `{{ }}` on screen?** → Literal newline in JS string. Use `\n`.
3. **localStorage** → Old approach. All data in Supabase.
4. **Never paste GitHub tokens** — auto-revoked. Use github-push function.
5. **Supabase `.catch(()=>[])`** — intentional graceful fallback.
6. **Never push outerHTML** — always push fetched source.
7. **Claude in Chrome must be connected.**
8. **Async fetch timing** — verify length in separate tool call.
9. **Never use `.replace()` for patches** — use substring splice (`$'` hazard).
10. **GitHub rate limiting** — one get-sha call per file right before push.
11. **Security filter** — use raw.githubusercontent.com; use structural indexOf searches not large reads.
12. **`property_notes` no `created_by` column** — use `updated_by`. Wrong column = silent 400.
13. **Context file corruption** — if truncated in GitHub, rebuild from uploaded copy.
14. **Never double-wrap window.fetch** — _upload_ux already wraps it. If fetch breaks, open a fresh tab via `tabs_create_mcp` → navigate to forward-os.netlify.app → do work there.
15. **`supaRest.delete` may 400** — use direct `fetch()` DELETE to Supabase REST URL instead.
16. **Between-call async**: Network I/O callbacks only complete with user interaction gaps between tool calls. Open a fresh tab if you need reliable async network in rapid-fire tool sequences.

---

## Standard Session Startup
1. User uploads this context file
2. Claude reads it fully
3. Ensure Claude in Chrome is connected
4. For code changes: fetch raw.githubusercontent.com source, verify length, substring splice, get SHA, push
5. Update and push this file at end of session via fresh tab (no manual steps for Marc)