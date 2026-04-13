# FORWARD OS â Session Context File
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

Tokens stored in Marc's password manager.
- GitHub Classic PAT (repo scope, no expiry): regenerate at github.com/settings/tokens/new
- Netlify token: regenerate at app.netlify.com/user/applications

---

## Google Cloud / OAuth

| Item | Value |
|---|---|
| GCP Project | `forward-os-490520` (under `marc@marccashin.com` / `marccashin.com` Workspace) |
| OAuth App User Type | **Internal** â refresh tokens never expire |
| OAuth Client Name | LOTA Drive Uploader |
| Client ID | `1019354489966-j4fsg0elahtkillhv8734462cme9q7e1.apps.googleusercontent.com` |
| Authorized Account | `marc@marccashin.com` |
| Old GCP Project | `forward-marketing-os` (under Corcoran account â deprecated for auth, marc@marccashin.com added as Owner for safety) |

**Netlify env vars (forward-os project):**
- `GOOGLE_CLIENT_ID` â Client ID above
- `GOOGLE_CLIENT_SECRET` â Secret ending in `9YSu`
- `GOOGLE_REFRESH_TOKEN` â Permanent token for `marc@marccashin.com`

---

## Video Upload Feature

- **Page:** `/video-upload.html` (separate page, not a Vue view)
- **Routing:** `go('video-upload')` in index.html redirects to `/video-upload.html`
- **Netlify Function:** `netlify/functions/prepare-lota-upload.js`
  - Authenticates as `marc@marccashin.com` via OAuth2 refresh token (server-side only)
  - Creates folder hierarchy in LOTA Visuals Drive folder (`129RwYEDPK0aC7hGJDTA8_QDX0XFDqD5e`)
  - Returns pre-authenticated resumable upload URLs
  - **No per-agent Google login required** â works for any agent on any device
- **Flow:** Agent fills topic + name â Netlify fn creates Drive folders â browser uploads directly to Drive

---

## Repo File Manifest (never delete these)

| File | Purpose |
|---|---|
| index.html | The entire FORWARD OS app (~1.24MB) |
| video-upload.html | Standalone Video Upload page |
| netlify/functions/prepare-lota-upload.js | Netlify Function â Drive OAuth + folder creation |
| _redirects | Netlify proxy rules â CRITICAL |
| FORWARD_OS_CONTEXT.md | This file |
| README.md | Repo description |

### _redirects content (NEVER remove either line):
```
/fub-api/* https://api.followupboss.com/v1/:splat 200
/* /index.html 200
```
Line 1: Proxies FUB API calls through Netlify. fubFetch() calls /fub-api/... which forwards to FUB.
Line 2: SPA fallback â direct URL loads go to index.html so Vue routing works.
Without this file: FUB features return 404, direct URL navigation breaks.

---

## Standard Deploy Workflow (GitHub-first)
Push to GitHub â Netlify auto-deploys. One step = live update + backup.

### Step 1 â Fetch live file (in forward-os.netlify.app Chrome tab):
```javascript
fetch('/index.html', {cache:'no-store'}).then(r=>r.text()).then(t=>{window._html=t; console.log('loaded:', t.length)});
```

### Step 2 â Apply string-replace changes:
```javascript
const old = `EXACT_OLD_STRING`;
const neu = `NEW_STRING`;
if (!window._html.includes(old)) console.error('NOT FOUND');
else { window._html = window._html.split(old).join(neu); console.log('replaced:', window._html.length); }
```

### Step 3 â Get current SHA:
```javascript
window._ghToken = 'PASTE_GH_TOKEN_HERE';
fetch('https://api.github.com/repos/marccashin/forward-os/contents/index.html', {
  headers: { 'Authorization': 'token ' + window._ghToken }
}).then(r=>r.json()).then(d=>{ window._currentSha = d.sha; console.log('SHA:', d.sha.slice(0,8)); });
```

### Step 4 â Push to GitHub:
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

### To update FORWARD_OS_CONTEXT.md on GitHub:
Same pattern as above but target /contents/FORWARD_OS_CONTEXT.md instead of /contents/index.html.

---

## Supabase Tables

### buyers
Fields: id, agent_name, buyer_name, first_name, market_area, budget_min, budget_max, down_payment, pre_approved, pre_approval_lender, pre_approval_amount, target_neighborhoods, areas_note, home_type, home_type_note, bedrooms_min, bedrooms_note, bathrooms, parking, parking_note, outdoor_space, outdoor_note, move_in_target, urgency, urgency_note, current_status, current_note, school_district, hoa_acceptable, must_haves, deal_breakers, agent_notes, drive_folder_id, subfolder_drive_ids, created_at
RLS: enabled (allow_all_anon policy â all operations for anon + authenticated)

### properties
Fields: id, agent_name, address, drive_folder_id, subfolder_drive_ids, created_at (+ listing fields)
RLS: enabled (allow_all_anon policy)

### property_assets, property_notes
RLS: enabled (allow_all_anon policy)

---

## Key Vue Functions Reference

### Buyers (My Buyers tab)
- byrBuyers / byrActiveBuyer / byrCreateBuyer()
- byrCreateBuyer() auto-creates: Supabase record + Drive folder + client file folder entry

### Listings (My Sellers tab)
- supaProperties / lstActiveProp / lstCreateProperty()
- lstCreateProperty() auto-creates: Supabase record + Drive folder + client file folder entry

### Client Files (prop-files view) â PENDING MIGRATION
- Current state: display/browse reads from localStorage (device-local, NOT global)
- Saving PDFs to folders: global via Google Drive (fixed in Chat 5)
- PENDING GOAL: Migrate the CLIENT FILES VIEW to read from Supabase/Drive so all agents see all folders on all devices
- addPropFile(address, opts) â opts: { buyer_id, property_id, fileType } â localStorage write
- getPropFiles() / savePropFiles() â localStorage helpers (to be replaced with Supabase reads)
- findActiveClientFile() â returns client file linked to active buyer/listing
- openSaveToPropModal(type, label, data, pdfData, toolName) â smart save, auto-routes to active client file
- openClientFilePicker(label, pdfDataURI, onSave) â global Supabase-backed picker (already global)
- saveToClientFileDrive(record, recordType) â uploads to Drive via Railway (already global)

### FUB Integration
- fubFetch(path, method, body) â routes through /fub-api Netlify proxy to followupboss.com/v1
- fubAddNote(personId, noteText) â adds note to FUB contact

### Buyer Consultation Kit (bck)
- bck._lastPDF â last generated PDF data URI
- bckSaveToClientFolder() â saves to Google Drive buyer_kit subfolder (global)
- bckSendToBuyer() â opens PDF for eiail/text attachment

---

## Agents
Marc Cashin, Ashling McGowan, Niki Lang, Cesar Rivera, Charlotte Lee, Shannon Casey
Access code: forward2026 â Admin: Marc Cashin

---

## Chat History

| Chat | Key Work |
|---|---|
| 1â3 | Initial OS build â all tools, Supabase, Railway backend |
| 4 | Crashed â context overflow from base64 chunk injection (never do this) |
| 5 | Auto-create client folders on buyer/listing creation; global Save-to-Folder + Send to Buyer on Buyer Consultation Kit; GitHub repo created + connected to Netlify; _redirects added (fixed FUB 404); Supabase RLS enabled on all tables |
| 6 | Video Upload feature built (video-upload.html + prepare-lota-upload Netlify fn); blank screen routing bug fixed; OAuth2 auth set up under marc@marccashin.com (GCP project forward-os-490520, Internal app = permanent tokens); marc@marccashin.com added as Owner on old forward-marketing-os project; Client Files VIEW migration (localStorage â Supabase) still pending |

---

| 7 | Client Files VIEW fully migrated to Supabase: propFiles filtered by agent, adminGetAgentFiles uses allAgentFiles (Supabase) not localStorage, createPropFile writes to Supabase, supaRest.delete added, deletePropFile/removePropFile wired to Supabase. CMA Builder cross-property auto-populate bug fixed: cloud resume skipped when prefill address differs from saved session. GitHub PAT regenerated (no expiry, repo scope). |

## Pending
- *(nothing pending — all items complete as of Chat 7)*

---

## End of Task Protocol
At the end of every completed task, ask Marc:
"Should I update FORWARD_OS_CONTEXT.md on GitHub with what we just built?"
- Yes: update this file and push to GitHub using the GitHub API workflow
- New task given without answering: treat as No, complete new task, ask again at completion
- Never skip asking

---

## Critical Rules
1. NEVER inject base64 file chunks through the chat window â killed Chat 4
2. Always fetch index.html from the live Chrome tab (same-origin, no CORS)
3. index.html is the ENTIRE app â one file, no build process
4. Netlify publish directory = blank (serves from repo root)
5. NEVER delete or modify _redirects without preserving both proxy rules
6. Supabase RLS is enabled â do not disable it
