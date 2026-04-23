# FORWARD OS — Session Context File
> Upload this file at the start of any new FORWARD OS Cowork chat to restore full context.

---

## What is FORWARD OS?
A Vue 3 SPA (single-file, no build step) for real estate agents.
- **Live site:** https://forward-os.netlify.app
- **Source:** https://github.com/marccashin/forward-os (main branch)
- ~13,000 lines of HTML/JS/CSS in a single index.html (~1.29MB, current length: **1,294,668**)

---

## Infrastructure

| Service | Purpose | Details |
|---|---|---|
| Netlify | Hosting | Site ID: 7bcc28c5-97d0-4673-abda-309325eac663 |
| Supabase | Database | Project: forward-marketing-os (ID: ewedrgopezogifzysusn) |
| Railway | Python backend | RAILWAY_URL in index.html |
| Google Drive | LOTA video uploads + client file storage | OAuth via marc@marccashin.com |
| GitHub | Source backup + auto-deploy | github.com/marccashin/forward-os |
| Resend | Feedback digest email | Domain: marccashin.com (verified via GoDaddy auto-configure) |