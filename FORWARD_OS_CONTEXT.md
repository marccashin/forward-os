# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS Cowork chat to restore full context.

---

## What is FORWARD OS?
A Vue 3 SPA (single-file, no build step) for real estate agents.
- **Live site:** https://forward-os.netlify.app
- **Source:** https://github.com/marccashin/forward-os (main branch)
- ~12,000 lines of HTML/JS/CSS in a single index.html (~1.24MB)

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

### Standard push call (from browser console on forward-os.netlify.app)
```js
// 1. Get current file as base64
const html = document.documentElement.outerHTML;
const encoded = btoa(unescape(encodeURIComponent(html)));

// 2. Push to GitHub
const res = await fetch('/.netlify/functions/github-push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: encoded, message: 'describe change here', filename: 'index.html' })
}).then(r => r.json());
console.log(res);
```

---

## Supabase Tables

| Table | Key Columns | Purpose |
|---|---|---|
| `buyers` | id, buyer_name, agent_name, drive_folder_id, subfolder_drive_ids, email, created_at | Buyer records |
| `properties` | id, address, agent_name, drive_folder_id, subfolder_drive_ids, created_at | Listing records |
| `buyer_assets` | id, buyer_id, subfolder, file_name, drive_link, created_at | Files for buyers |
| `property_assets` | id, property_id, subfolder, file_name, drive_link, created_at | Files for listings |

Supabase is accessed via the `supaRest` helper in index.html:
```js
supaRest.select('table_name', 'select=col1,col2&filter=value')
supaRest.insert('table_name', { col: val })
supaRest.update('table_name', { col: val }, 'id=eq.123')
supaRest.delete('table_name', 'id=eq.123')
```

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
- `viewResourceLink(r)` — opens `r.driveLink` in a new tab
- `sendResourceToClient(r, pf)` — opens mailto: with document link pre-filled

### Client Files (prop-files view)
- `propFiles` is populated from Supabase (NOT localStorage) via `loadPropFiles()`
- Each record has: `id, address, createdAt, resources[], agent_name, drive_folder_id, subfolder_drive_ids, recordType ('buyer'|'property')`
- Resources come from `property_assets` / `buyer_assets` tables
- Each resource: `{ id, label, type, driveLink, savedAt }`
- Resource cards show **View** button (opens Drive link) and **Send to Client** button (mailto)
- Copy button only shows when `!r.driveLink && !r.pdfData`

---

## AGENTS & Admin
```js
const AGENTS = ['Marc','Natalie','Serena','Miranda','Admin'];
const ADMIN_AGENT = 'Admin';
```

---

## Chat History Summary

### Chat 9 (April 2026)
**Completed work:**

1. **Client Files VIEW migrated to Supabase** — `loadPropFiles()` now fetches all 4 tables in parallel (buyers, properties, property_assets, buyer_assets). localStorage fallback removed. View auto-refreshes when switching to the prop-files view.

2. **Resources now show correctly** — "0 resources" bug fixed. Resources now come from `property_assets` and `buyer_assets` Supabase tables, mapped by property_id / buyer_id.

3. **View + Send to Client buttons** — Replaced non-functional Copy button on resource cards. View opens the Drive link. Send to Client opens a pre-filled mailto. Two new functions added to setup() return: `viewResourceLink`, `sendResourceToClient`.

4. **GitHub App authentication (permanent fix)** — Replaced GitHub PAT approach with a GitHub App. The `github-push` Netlify function now signs its own short-lived tokens using the app's private key stored in Netlify env vars. No PATs are ever needed in chat again. App ID: 3382390, Installation ID: 124051198.

---

## Common Pitfalls

1. **Vue template can't see a function?** → It's not in the `setup()` return object. Add it.
2. **Syntax error / blank login screen with raw `{{ }}`?** → A JS string literal contains a literal newline. Use `\n` escape sequences instead.
3. **localStorage data** → Old approach, no longer used for propFiles. All data lives in Supabase.
4. **Never paste GitHub tokens (ghp_*, github_pat_*) in chat** — GitHub + Anthropic partnership auto-revokes them within seconds. Use the github-push Netlify function instead.
5. **Supabase `.catch(()=>[])` on asset queries** — intentional; allows graceful empty fallback if tables are missing.

---

## Standard Session Startup

At the start of each session:
1. User uploads this context file
2. Claude reads it fully before starting work
3. To make code changes: edit index.html in the browser console using string-replace, then push via `/.netlify/functions/github-push`
4. Update this context file at end of session and push it too
