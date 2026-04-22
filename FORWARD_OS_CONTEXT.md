# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS Cowork chat to restore full context.

---

## What is FORWARD OS?
A Vue 3 SPA (single-file, no build step) for real estate agents.
- **Live site:** https://forward-os.netlify.app
- **Source:** https://github.com/marccashin/forward-os (main branch)
- ~13,000 lines of HTML/JS/CSS in a single index.html (~1.37MB)

---

## Infrastructure

| Service | Purpose | Details |
|---|---|---|
| Netlify | Hosting | Site ID: 7bcc28c5-97d0-4673-abda-309325eac663 |
| Supabase | Database | Project: forward-marketing-os (ID: ewedrgopezogifzysusn) |
| Railway | Python backend | RAILWAY_URL in index.html |
| Google Drive | LOTA video uploads + client file storage | OAuth via marc@marccashin.com |
| GitHub | Source backup + auto-deploy | github.com/marccashin/forward-os |

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
// 1. Fetch fresh source
fetch('/index.html').then(r=>r.text()).then(t=>{ window._src = t; });

// 2. Apply string replacements to window._src
window._src = window._src.replace(OLD_STRING, NEW_STRING);

// 3. Get current file SHA (lightweight, no file download)
fetch('/.netlify/functions/github-push', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({action: 'get-sha', filename: 'index.html'})
}).then(r=>r.json()).then(d=>{ window._sha = d.sha; });

// 4. Push modified source
const encoded = btoa(unescape(encodeURIComponent(window._src)));
fetch('/.netlify/functions/github-push', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({content: encoded, message: 'describe change', filename: 'index.html', sha: window._sha})
}).then(r=>r.json()).then(d=>{ window._pushResult = d; });
```

### ⚠️ CRITICAL: Always push source, never outerHTML
**NEVER push `document.documentElement.outerHTML`** — this captures the rendered Vue DOM (without `@click` directives) and breaks all buttons. Always push `window._src` or a fetched copy of `/index.html`.

### ⚠️ CRITICAL: Async fetch timing
`fetch('/index.html')` is async. Always verify `window._src.length` in a SEPARATE tool call after the fetch to confirm it has loaded before applying patches. The `window._src` may retain an old value until the Promise resolves.

---

## Supabase Tables

| Table | Key Columns | Purpose |
|---|---|---|
| `buyers` | id, buyer_name, agent_name, drive_folder_id, subfolder_drive_ids, email, created_at | Buyer records |
| `properties` | id, address, agent_name, drive_folder_id, subfolder_drive_ids, created_at | Listing records |
| `buyer_assets` | id, buyer_id, subfolder, file_name, drive_link, created_at | Files for buyers |
| `property_assets` | id, property_id, subfolder, file_name, drive_link, created_at | Files for listings |
| `property_notes` | id, property_id, subfolder, content, created_at | Text notes for listings (incl. listing description) |

Supabase is accessed via the `supaRest` helper in index.html:
```js
supaRest.select('table_name', 'select=col1,col2&filter=value')
supaRest.insert('table_name', { col: val })
supaRest.update('table_name', { col: val }, 'id=eq.123')
supaRest.delete('table_name', 'id=eq.123')
```

### Listing Description storage
- Table: `property_notes`
- Column: `content` (raw text)
- Subfolder: `listing_remarks`
- Query: `supaRest.select('property_notes', 'select=content&property_id=eq.'+prop.id+'&subfolder=eq.listing_remarks')`
- Saved by: `ldSaveToProperty()` function (also saves a branded PDF to `property_assets` via Drive)

---

## App Architecture

### Vue 3 Setup
- Single `setup()` function returns all reactive state and methods to the template
- **Critical rule:** Every function used in the template MUST be explicitly returned from `setup()`
- Reactive state: `ref()` for primitives, arrays; `computed()` for derived values

### Key Reactive State
- `agentName` — currently logged-in agent
- `propFiles` — client file records for current agent (from Supabase)
- `allAgentFiles` — all agents' file records grouped by agent (admin view)
- `activePropFile` — currently selected file record in detail panel
- `byrBuyers` — buyer records
- `lstProperties` — property/listing records

### Key Functions
- `loadPropFiles()` — fetches buyers + properties + buyer_assets + property_assets from Supabase in parallel, builds propFile objects with resources arrays
- `go(view)` — switches the active view; triggers `loadPropFiles()` when switching to `'prop-files'`
- `lstFetchProperties()` — fetches listings from Supabase for dashboard; respects agentName (admin sees all)
- `byrFetchBuyers()` — fetches buyers from Supabase for dashboard; respects agentName
- `viewResourceLink(r)` — opens `r.driveLink` in a new tab
- `sendResourceToClient(r, pf)` — opens mailto: with document link pre-filled
- `ldSaveToProperty()` — saves listing description text to `property_notes` (subfolder `listing_remarks`) AND as branded PDF to `property_assets` via Drive

### Client Files (prop-files view)
- `propFiles` is populated from Supabase (NOT localStorage) via `loadPropFiles()`
- Each record has: `id, address, createdAt, resources[], agent_name, drive_folder_id, subfolder_drive_ids, recordType ('buyer'|'property')`
- Resources come from `property_assets` / `buyer_assets` tables
- Each resource: `{ id, label, type, driveLink, savedAt }`
- Resource cards show **View** button (opens Drive link) and **Send to Client** button (mailto)
- Copy button only shows when `!r.driveLink && !r.pdfData`

---

## AGENTS & Admin
The `AGENTS` array and login names are already correct in the app. Do NOT suggest changes.
Real team: Marc Cashin, Ashling McGowan, Niki Lang, Cesar Rivera, Charlotte Lee, Shannon Casey, + Operations role.
The `ADMIN_AGENT` is `'Admin'`.

---

## Upload System
- Property/listing files upload via `RAILWAY_URL + '/upload-file'` (FormData)
- Buyer files upload via `RAILWAY_URL + '/upload-buyer-file'` (FormData)
- LOTA videos upload via Railway backend to Google Drive
- **Upload UX patch** (added Chat 10): fetch interceptor at bottom of `<body>` — auto-detects FormData uploads to Railway URLs, shows fixed bottom banner "Keep this screen on", requests Wake Lock API to prevent screen sleep. ID: `_upload_ux`.

---

## Voice Modal — Write Content Tool

### Phases
`listening` → `parsing` → `confirm-write` → `answer`

### Key State
- `voiceModal.confirmAddress` — editable address field in confirm-write phase
- `voiceModal.confirmType` — `'both'` | `'open-house'` | `'social-post'`
- `voiceModal.generate` — async function assigned as closure, called by Generate button
- `voiceModal.generatedContent` — stores generated text for Copy Content button
- `voiceModal.detectedTool` — set to `'write-content'` when generating copy

### Flow in `voiceModal.generate()`
1. Finds the matching property in `lstProperties` (fuzzy match on street number)
2. Fetches listing description from `property_notes` table: `select=content&property_id=eq.{id}&subfolder=eq.listing_remarks`
3. If no description found → shows error: "Open the Listing Description tool, save the description, then try again"
4. If found → builds property data string (`_pd`) using `_ldText` as description
5. Calls Anthropic API with `_fosApiKey || localStorage.getItem(agentKey('fos_key'))`
6. Sets `voiceModal.answerText` and `voiceModal.generatedContent` with result

### Answer Phase UI (detectedTool === 'write-content')
- Shows generated content with Copy Content button
- Full Training button is **hidden** (`v-if="voiceModal.detectedTool!=='write-content'"`)

---

## Chat History Summary

### Chat 9 (April 2026)
1. Client Files VIEW migrated to Supabase — `loadPropFiles()` fetches all 4 tables in parallel
2. Resources now show correctly — "0 resources" bug fixed
3. View + Send to Client buttons added — `viewResourceLink`, `sendResourceToClient` in setup() return
4. GitHub App authentication (permanent fix) — App ID: 3382390, Installation ID: 124051198

### Chat 10 (April 16, 2026)
1. **Restored broken app from git history** — Previous session saved rendered `outerHTML` instead of source template, stripping all `@click` directives and breaking buttons. Restored from commit `679af3a`. Root cause: NEVER push `document.documentElement.outerHTML`.
2. **Removed Claude banner** — `<div id="claude-static-indicator-container">` was baked into saved HTML from a previous Claude in Chrome session. Removed via targeted string replacement.
3. **GitHub App auth confirmed working** — 401 errors seen earlier were from stale console runs, not an actual auth issue.
4. **Upload UX improvements** — Added fetch interceptor (`_upload_ux` script) that auto-detects file uploads, shows "Keep screen on" banner with spinner, requests Wake Lock API.
5. **Dashboard agent-switch data refresh** — Fixed stale listings/buyers on dashboard after login. Added `watch(agentName, (v, old) => { if(v && v !== old){ lstFetchProperties(); byrFetchBuyers(); } });` before the Listings System block in setup().

### Chat 11 (April 17, 2026)
1. **Voice write-content: Full Training button removed** — Added `v-if="voiceModal.detectedTool!=='write-content'"` to the Full Training button in the answer phase template. Button now hidden when generating listing copy.
2. **Voice write-content: pulls listing description from Supabase** — `voiceModal.generate()` now fetches from `property_notes` table (`subfolder='listing_remarks'`, column `content`) before generating copy. If no description saved, shows actionable error message telling agent to use the Listing Description tool first.
3. **Discovered `property_notes` table** — Stores raw text for listing descriptions. `ldSaveToProperty()` inserts here with `subfolder='listing_remarks'` and `content=text`. Also stores a branded PDF to `property_assets` via Drive.
4. **⚠️ Broke app with `$'` replacement pattern** — `String.replace(old, new)` where `new` contained `'Price: $'+Number(...)` — the `$'` token is a JS replacement pattern meaning "insert text following the match," which injected 77,668 chars of source into `_pd`. App showed raw `{{ a }}` / `{{ loginError }}` (Vue failed to mount). Fixed in Chat 12.

### Chat 12 (April 18, 2026)
1. **Fixed `$'` injection bug** — Broken `_pd` array (77,668 chars, positions 1214808–1292476) replaced with correct 275-char version using `t.substring(0, si) + correctPd + t.substring(ei)` — no `.replace()`. Pushed as commit `78370b65`. App restored.

---

## Common Pitfalls

1. **Vue template can't see a function?** → It's not in the `setup()` return object. Add it.
2. **Syntax error / blank login screen with raw `{{ }}`?** → A JS string literal contains a literal newline. Use `\n` escape sequences instead.
3. **localStorage data** → Old approach, no longer used for propFiles. All data lives in Supabase.
4. **Never paste GitHub tokens (ghp_*, github_pat_*) in chat** — GitHub + Anthropic partnership auto-revokes them within seconds. Use the github-push Netlify function instead.
5. **Supabase `.catch(()=>[])` on asset queries** — intentional; allows graceful empty fallback if tables are missing.
6. **⚠️ Never push outerHTML** — Always fetch `/index.html` fresh, modify `window._src`, and push that. Pushing `document.documentElement.outerHTML` saves the rendered DOM without Vue directives, breaking all buttons.
7. **Claude in Chrome must be connected** — Without it, Claude cannot read the source or navigate the app. Ensure the Chrome extension is signed in before starting work sessions.
8. **Async fetch timing** — `fetch('/index.html')` is async. Check `window._src.length` in a separate tool call after fetching to confirm the source loaded before applying patches.
9. **⚠️ NEVER use `.replace()` for patching source** — JS replacement strings treat `$'` (dollar + apostrophe) as "insert text following the match." Any replacement string containing `$'` (e.g., `'Price: $'+...`) will inject the entire tail of the source file into the patch, breaking Vue. **Always use substring splicing instead:** `t.substring(0, si) + newStr + t.substring(ei)` where `si`/`ei` are `indexOf`-computed boundaries.

---

## Standard Session Startup

At the start of each session:
1. User uploads this context file
2. Claude reads it fully before starting work
3. Ensure Claude in Chrome is connected (visible in Connectors panel)
4. To make code changes: fetch `/index.html` into `window._src` (verify length in separate call), apply string replacements, get SHA via `get-sha` action, push via `/.netlify/functions/github-push`
5. Update this context file at end of session and push it too
