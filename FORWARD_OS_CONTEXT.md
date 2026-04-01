# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS chat to restore full context.

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
| Supabase | Database | SUPABASE_URL + SUPABASE_KEY in index.html |
| Railway | Python backend | RAILWAY_URL in index.html |
| Google Drive | Client file storage | Auto-folders per buyer/listing |
| GitHub | Source backup + auto-deploy | github.com/marccashin/forward-os |

Tokens are stored in Marc's password manager.
- GitHub Classic PAT (repo scope, no expiry): regenerate at github.com/settings/tokens/new
- Netlify token: regenerate at app.netlify.com/user/applications

---

## Repo File Manifest
These files MUST all exist in the GitHub repo — do not delete them:

| File | Purpose |
|---|---|
| index.html | The entire FORWARD OS app (~1.24MB) |
| _redirects | Netlify proxy rules — CRITICAL (see below) |
| FORWARD_OS_CONTEXT.md | This context file |
| README.md | Repo description |

### _redirects file content (NEVER remove or overwrite without care):
```
/fub-api/* https://api.followupboss.com/v1/:splat 200
/* /index.html 200
```
- Line 1: Proxies all Follow Up Boss API calls through Netlify (avoids CORS). fubFetch() in the app calls /fub-api/... which gets forwarded to FUB's API.
- Line 2: SPA fallback — sends all direct URL navigations to index.html so Vue Router works.
- Without this file, FUB contact features return 404 and direct URL loads show blank pages.

---

## Standard Deploy Workflow (GitHub-first)
Pushing to GitHub auto-triggers Netlify deploy. ONE step = live update + backup.

### Step 1 — Fetch live file (run in forward-os.netlify.app Chrome tab):
```javascript
fetch('/index.html', {cache:'no-store'}).then(r=>r.text()).then(t=>{window._html=t; console.log('loaded:', t.length)});
```

### Step 2 — Apply changes (repeat for each edit):
```javascript
const old = `EXACT_OLD_STRING`;
const neu = `NEW_STRING`;
if (!window._html.includes(old)) console.error('STRING NOT FOUND - check spacing/quotes');
else { window._html = window._html.split(old).join(neu); console.log('replaced, size:', window._html.length); }
```

### Step 3 — Get current file SHA from GitHub:
```javascript
window._ghToken = 'PASTE_GH_TOKEN_HERE';
fetch('https://api.github.com/repos/marccashin/forward-os/contents/index.html', {
  headers: { 'Authorization': 'token ' + window._ghToken }
}).then(r=>r.json()).then(d=>{ window._currentSha = d.sha; console.log('SHA ready:', d.sha.slice(0,8)); });
```

### Step 4 — Push to GitHub (Netlify auto-deploys):
```javascript
const bytes = new TextEncoder().encode(window._html);
let binary = '';
for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i+8192));
window._htmlB64 = btoa(binary);

fetch('https://api.github.com/repos/marccashin/forward-os/contents/index.html', {
  method: 'PUT',
  headers: { 'Authorization': 'token ' + window._ghToken, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'feat: DESCRIBE_CHANGE_HERE',
    content: window._htmlB64,
    sha: window._currentSha
  })
}).then(r=>r.json()).then(d=>console.log(d.commit ? 'DONE: ' + d.commit.sha.slice(0,8) : 'ERROR: ' + JSON.stringify(d)));
```

---

## Key Vue Functions Reference

### Buyers (My Buyers tab)
- byrBuyers / byrActiveBuyer / byrCreateBuyer()
- Supabase table: buyers (buyer_name, email, drive_folder_id, subfolder_drive_ids)

### Listings (My Sellers tab)
- supaProperties / lstActiveProp / lstCreateProperty()
- Supabase table: properties (address, drive_folder_id, subfolder_drive_ids)

### Client Files
- addPropFile(address, opts) — opts: { buyer_id, property_id, fileType }
- findActiveClientFile() — returns file linked to active buyer/listing
- openSaveToPropModal(type, label, data, pdfData, toolName) — auto-routes to active client file
- openClientFilePicker(label, pdfDataURI, onSave) — global Supabase-backed picker
- saveToClientFileDrive(record, recordType) — uploads to Drive via Railway

### FUB Integration
- fubFetch(path, method, body) — base function for all FUB API calls, routes through /fub-api proxy
- fubAddNote(personId, noteText) — adds note to FUB contact
- All FUB calls go to /fub-api/* which Netlify proxies to https://api.followupboss.com/v1/*

### Buyer Consultation Kit (bck)
- bck._lastPDF — last generated PDF data URI
- bckSaveToClientFolder() — saves to Google Drive buyer_kit subfolder
- bckSendToBuyer() — opens PDF for email/text

---

## Chat History Summary
- Chat 1-3: Initial OS build (all tools, Supabase, Railway)
- Chat 4: Crashed (context overflow from base64 chunk injection — avoid this!)
- Chat 5: Auto-create client folders on buyer/listing creation; global Save-to-Folder; GitHub repo + Netlify connected; _redirects fixed (FUB API proxy was missing from new deployment)

## Pending (Chat 6)
- Migrate Client Files VIEW from localStorage to Supabase/Drive so all agents see all folders globally

---

## Critical Rules
1. NEVER inject base64 file chunks through the chat window — killed Chat 4
2. Always fetch index.html from the live Chrome tab (same-origin, no CORS)
3. index.html is the ENTIRE app — one file, no build process
4. Netlify publish directory = blank (serves from repo root)
5. NEVER delete or overwrite _redirects without preserving both proxy rules