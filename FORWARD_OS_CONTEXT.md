# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS Cowork chat to restore full context.

---

## What is FORWARD OS?
A Vue 3 SPA (single-file, no build step) for real estate agents.
- **Live site:** https://forward-os.netlify.app
- **Source:** https://github.com/marccashin/forward-os (main branch)
- ~13,000 lines of HTML/JS/CSS in a single index.html (~1,294,639 chars as of Chat 14)

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

Pushing changes to GitHub is done via a Netlify Function that uses a **GitHub App** for authentication. No personal access tokens are needed or should ever be pasted in chat.

### How it works
The function at `/.netlify/functions/github-push` (source: `netlify/functions/github-push.js`):
1. Reads `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` from Netlify env vars
2. Signs a JWT with the private key (RS256)
3. Exchanges the JWT for a short-lived installation token via GitHub API
4. Uses that token to push files to `marccashin/forward-os`

### GitHub App details
- **App name:** Forward OS Deployer
- **App ID:** 3382390
- **Installation ID:** 124051198 (installed on marccashin/forward-os)
- **Permissions:** Read & write access to repository contents
- **Netlify env vars set:** `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (base64-encoded PEM)
- The private key PEM file is stored safely — it is NOT a GitHub PAT and will not be auto-revoked

### Standard push workflow (all done via Claude in Chrome javascript_tool)
```js
// 1. Fetch fresh source from raw GitHub
fetch('https://raw.githubusercontent.com/marccashin/forward-os/main/index.html')
  .then(r=>r.text()).then(t=>{ window._rawSrc = t; });

// 2. Verify length
window._rawSrc.length

// 3. Apply patches using substring splice (NEVER .replace())
const si = window._rawSrc.indexOf(OLD);
window._patched = window._rawSrc.substring(0, si) + NEW + window._rawSrc.substring(si + OLD.length);

// 4. Get SHA
fetch('/.netlify/functions/github-push', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({action: 'get-sha', filename: 'index.html'})
}).then(r=>r.json()).then(d=>{ window._sha = d.sha; });

// 5. Push
const encoded = btoa(unescape(encodeURIComponent(window._patched)));
fetch('/.netlify/functions/github-push', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({content: encoded, message: 'describe change', filename: 'index.html', sha: window._sha})
}).then(r=>r.json()).then(d=>{ window._pushResult = d; });
```

### CRITICAL: Always push source, never outerHTML
**NEVER push `document.documentElement.outerHTML`** — breaks all Vue directives/buttons.

### CRITICAL: Async fetch timing
Always verify `window._rawSrc.length` in a SEPARATE tool call after the fetch.

---

## Supabase Tables

| Table | Key Columns | Purpose |
|---|---|---|
| `buyers` | id, buyer_name, agent_name, drive_folder_id, subfolder_drive_ids, email, created_at | Buyer records |
| `properties` | id, address, agent_name, drive_folder_id, subfolder_drive_ids, created_at | Listing records |
| `buyer_assets` | id, buyer_id, subfolder, file_name, drive_link, created_at | Files for buyers |
| `property_assets` | id, property_id, subfolder, file_name, drive_link, created_at | Files for listings |
| `property_notes` | id, property_id, subfolder, content, updated_by, updated_at | Text notes for listings. No `created_by` column — use `updated_by` |
| `agent_feedback` | id, agent_name, type, message, created_at | Feedback from agents (bug/idea/praise/general) |

Supabase helper: `supaRest.select/insert/update/delete('table', params)`

### Listing Description storage
- Table: `property_notes`, Column: `content`, Subfolder: `listing_remarks`
- Saved by: `ldSaveToProperty()` — inserts to `property_notes` AND saves branded PDF to `property_assets`
- Bug fixed Chat 14: insert used `created_by` (column doesn't exist), silently failing. Fixed to omit. Users who saved before Chat 14 need to re-save once.

---

## App Architecture

### Vue 3 Setup
- Single `setup()` function returns all reactive state and methods to template
- **Critical:** Every function used in template MUST be returned from `setup()`
- `ref()` for primitives/arrays; `computed()` for derived values

### Key Reactive State
- `agentName`, `propFiles`, `allAgentFiles`, `activePropFile`, `byrBuyers`, `lstProperties`

### Key Functions
- `loadPropFiles()` — fetches all 4 tables in parallel, builds propFile objects
- `go(view)` — switches active view; triggers `loadPropFiles()` for 'prop-files'
- `lstFetchProperties()` / `byrFetchBuyers()` — fetch for dashboard, admin sees all
- `viewResourceLink(r)` — opens Drive link; `sendResourceToClient(r, pf)` — opens mailto
- `ldSaveToProperty()` — saves description to `property_notes` + PDF to `property_assets`

---

## AGENTS & Admin
Real team: Marc Cashin, Ashling McGowan, Niki Lang, Cesar Rivera, Charlotte Lee, Shannon Casey, + Operations.
`ADMIN_AGENT` = 'Admin'. AGENTS array is correct — do NOT change it.

---

## Upload System
- Files upload via `RAILWAY_URL + '/upload-file'` or `'/upload-buyer-file'`
- `_upload_ux` script (Chat 10): auto-detects uploads, shows "Keep screen on" banner, Wake Lock API

---

## Voice Modal — Write Content Tool

### Phases: `listening` → `parsing` → `confirm-write` → `answer`

### flow in `voiceModal.generate()`
1. Fuzzy-match property via `_addrNorm()` (handles Rd/Road, St/Street, Ave/Avenue, Dr/Drive, Blvd/Boulevard + street-number fallback)
2. Fetch listing description from `property_notes` (subfolder=listing_remarks)
3. If none → error: "re-save the description for this property"
4. If found → build `_pd` string → call Anthropic API → set `voiceModal.answerText`

### Voice Nav Pre-check
Nav regex: `/^(?:open(?!\s+house)|go to|take me to|show me|navigate to|pull up|bring up|switch to)\s+(.+)/i`
Negative lookahead prevents "open house for [address]" routing as navigation.

### Answer Phase
Full Training button hidden when `detectedTool === 'write-content'`.

---

## Feedback System

### Agent Feedback Button
Gold gradient CTA on dashboard → modal → bug/idea/praise/general → saved to `agent_feedback`

### Daily Digest Email
- File: `netlify/functions/send-feedback-digest.js`
- Schedule: `0 22 * * *` (6pm ET) via `netlify.toml`
- Sends to: marc.cashin@corcoranmce.com via Resend
- Env vars: `RESEND_API_KEY`, `RESEND_FROM`, `SUPABASE_SERVICE_KEY` (all set in Netlify)

---

## Chat History Summary

### Chat 9 (April 2026)
Client Files migrated to Supabase. Resources bug fixed. View/Send buttons added. GitHub App auth.

### Chat 10 (April 16, 2026)
Restored app from outerHTML corruption. Removed Claude banner. Upload UX + Wake Lock. Dashboard agent-switch refresh.

### Chat 11 (April 17, 2026)
Voice write-content: Full Training button hidden. Listing description pulled from property_notes.

### Chat 12 (April 22, 2026)
Fixed $' injection bug. Feedback button gold CTA design. Railway upgraded to Hobby.

### Chat 13 (April 22–23, 2026)
1. Pushed gold feedback button (commit `a077cf1e`)
2. Built feedback digest Netlify function + Resend domain verified (commit `d418a157`)
3. Voice hint chips on dashboard (commit `9aea8d73`)
4. Fixed voice "open house" nav routing — negative lookahead in regex (commit `59179fe4`)
5. Fixed address fuzzy matching — `_addrNorm()` normalizer (commit `9605cd05`)

### Chat 14 (April 23, 2026)
1. **Fixed listing description silent save bug** — `ldSaveToProperty()` used `created_by` (doesn't exist in property_notes), causing silent 400 on every save. Fixed to omit. Commit `4409d117`. Agents need to re-save once.
2. Updated voice error message to say "re-save".
3. Context file rebuilt from scratch (previous version was truncated in GitHub).

---

## Common Pitfalls

1. **Vue template can't see a function?** → Not in `setup()` return. Add it.
2. **Raw `{{ }}` on screen?** → JS string has literal newline. Use `\n`.
3. **localStorage** → Old approach. All data in Supabase.
4. **Never paste GitHub tokens** — auto-revoked. Use github-push function.
5. **Supabase `.catch(()=>[])`** — intentional graceful fallback.
6. **Never push outerHTML** — always push fetched /index.html source.
7. **Claude in Chrome must be connected.**
8. **Async fetch timing** — verify length in separate tool call.
9. **Never use `.replace()` for patches** — use substring splice to avoid `$'` injection.
10. **GitHub rate limiting** — minimize get-sha calls, one per file right before push.
11. **Security filter blocks source reads** — use raw.githubusercontent.com; read in small chunks or search structurally.
12. **`property_notes` has no `created_by` column** — use `updated_by`. Wrong column = silent 400.
13. **Context file corruption** — if truncated in GitHub, rebuild from uploaded copy.

---

## Standard Session Startup
1. User uploads this context file
2. Claude reads it fully
3. Ensure Claude in Chrome is connected
4. For code changes: fetch raw GitHub source, verify length, substring splice, get SHA, push
5. Update this file at end of session — Claude pushes it via browser (no manual steps for Marc)