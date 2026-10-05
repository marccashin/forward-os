# FORWARD OS — Claude Working Rules

## Deployment workflow (ALWAYS follow this order)

1. Make changes on a feature branch (never directly on `main` or `staging`)
2. Push feature branch to GitHub
3. Merge feature branch → `staging` first
4. Marc tests on staging
5. Only after Marc approves: merge to `main` via pull request

**Never push to `main` directly. GitHub ruleset enforces this, but follow it regardless.**
**Never skip staging. Even small fixes go to staging first.**

## One change at a time

- One session ships to a repo at a time. Check for open PRs and other sessions' branches before starting.
- Do not open a PR while the backend system check (`GET /api/smoke-test/status` on the Railway backend) or the PR check on GitHub is red. Fix the red check first.
- After a backend merge, wait for the deploy and read the system check again before starting the next change.

## Security rules

- Never paste GitHub tokens in chat — they are auto-revoked by GitHub the moment they appear in a conversation
- Never commit `.env` files or secrets to the repo

## Data rules

- Everything is stored globally in Supabase so any device can access it at any time
- `localStorage` is only used as a fast display cache — Supabase is always the source of truth
- When writing to `property_notes`, do NOT include a `created_by` field — that column does not exist
- A listing note (`property_notes`) is saved with `supaRest.saveNote(propertyId, subfolder, content)`, which calls the database function `save_property_note` (SQL in `sql/2026-10-03_save_property_note.sql`, run by Marc Oct 3, 2026). It replaces the note in one step. Never delete a note and then insert it: if the insert fails the note is gone. Never call the backend's `/save-property-note` from the app. Voice notes (`voice_note`) are the exception: many per listing, added with a plain insert, and the function refuses them.
- Every saved version of a listing note is kept in `property_note_history` (SQL in `sql/2026-10-05_property_note_history.sql`, run by Marc Oct 5, 2026). The DATABASE writes it, by a trigger on `property_notes`, in the same step as the save; the app can only read it and must never try to write, change or delete a row. `supaRest.saveNote()` calls `save_property_note_by`, which is `save_property_note` plus the signed-in agent's name. Not kept: voice notes, the description writer's chat (`listing_remarks_chat`) and `campaign_sections`, which autosave constantly. On the listing, `lstHistFor(type)` lists the earlier versions and `lstHistCurrent(type)` says when and by whom the one on screen was saved. If history cannot be loaded, say so on screen (`lstHistError`).
- Read listing notes newest first (`order=updated_at.desc.nullslast`) and use the first row of each type.
- CMA comp fees: the subject's monthly fee is HOA fee plus condo fee, and a comp's HOA/Mo box must hold the same sum. A BLANK comp fee means not known yet and gets NO HOA adjustment in `recalcAll()`; a typed 0 means the comp has no fee and is adjusted in full (Marc, Oct 4, 2026; before that a blank counted as $0 and put the subject's whole fee times the multiplier on every comp of a condo CMA, $86,500 each). So a fee box must show a stored 0 as 0 and store an emptied box as blank, never as 0. The import fills the fee; a closed sale left blank is orange until a number is typed (a click does not clear it). Direction (Marc, Oct 4, 2026): a fee is a cost to the buyer, so a comp with a HIGHER fee than the subject is adjusted UP and a lower fee DOWN: `(comp fee - subject fee) x multiplier`.
- CMA wording (Marc, Oct 4, 2026): the number beside each comp is the **Indicated Value**, what that sale says the listing is worth. Never label it Adjusted Price or Adj Price, and never describe a comp as inferior or superior: say the listing is better (plus) or the comp is better (minus). The internal names (`_adj.adjusted`, `c0_adjPrice`) are unchanged.
- CMA drafts (`cma_sessions`, one row per agent and listing): the builder OPENS the newest draft for the listing that has at least one property in it, whoever saved it (Marc, Oct 3, 2026). It always SAVES under the signed-in agent's own name. Never let an empty draft win over one with properties, and never save before the load has finished.
- Every listing opens its own tools (Marc, Oct 5, 2026). `lstOpenProperty()` closes any open tool panel and clears a net sheet that belongs to another listing; a caller that wants a panel open sets `lstToolOpen` AFTER calling it. The in-listing net sheet fills from that listing only: address and unit from the listing, HOA fee and sale price (the List Price, only a plain dollar figure) from its MLS Data note, and only into an empty box. The standalone net sheet never shows a form stamped with a listing (`ns._propId`). Any new in-listing tool whose form lives in a shared object must be cleared in `lstOpenProperty()`.
- Buyer offers live in the `buyer_offers` table, one row per offer. New offers are sent as insert-ignore-duplicates with an id made on the device; changes are a PATCH limited to rows that are not removed; nothing ever clears `removed_at` and nothing is hard-deleted. Never save offers as one list again.

## Saves must tell the truth

- `fetch()` does not throw on a 404 or 500. Pass every save's answer through `fosOk(res)` (in `index.html`), which throws unless it succeeded.
- Show a success message only after the save went through. On failure, say what was not saved and why (`fosWhy(e)`), and leave the agent's text on screen.
- Never `catch` a failed save with only `console.warn`. A new save gets a case in `ci/save-failure-test.js`.

## No demo output, ever

- No tool may show sample, mock or demo output. A tool that cannot do its job says why and produces nothing. Until Oct 3, 2026 three tools showed made-up output on a device with no AI key.
- The AI key is checked by `fosCheckAiKey()` at sign-in, on page load and on agent switch. It is the only place the key is looked up. `aiKey.state` drives the red notice on every screen.
- Agents cannot add their own key: the key boxes in Settings are shown to Marc only. Never tell an agent to "add your key in Settings".

## Branches

- `main` — production (Netlify)
- `staging` — test environment, always updated before main
- Feature branches — named descriptively, short-lived, merged via PR

## Key files

- `index.html` — main FORWARD OS app (Vue 3 SPA)
- `cma-tool.html` — CMA builder standalone page
- `netlify/functions/` — serverless backend functions

## Automatic checks on every pull request

GitHub runs `.github/workflows/pr-checks.yml` on every PR to `main` or `staging`:

- `ci/static-checks.js`: scripts parse, the `#app` template compiles, every name the template uses is returned from `setup()` and declared, `index.html` did not shrink, CHANGELOG is well formed.
- `ci/mount-check.js`: opens the real app in headless Chromium, logged out and as every login, and opens every view. All network calls are intercepted; it never touches production.

- `ci/offers-test.js`: the Offer Tracker against a made-up `buyer_offers` table, as several devices at once. A failed save is shown, a retry never duplicates, a removed offer never comes back.
- `ci/save-failure-test.js`: runs each save with the cloud working and with every write failing. A success message may appear only when the save went through.
- `ci/meeting-prep-test.js`: a Meeting Prep brief says when online research did not run and research slower than 30 seconds is still used. One case waits 33 seconds on purpose.
- `ci/ai-key-test.js`: the AI key check at sign-in. No notice when a key is there; a red notice on every screen when it is not; with no key the tools produce nothing and say why.
- `ci/cma-builder-test.js`: the CMA Builder (`cma-tool.html`). The newest saved CMA for a listing opens and an empty one never hides one with properties in it; orange review boxes clear once clicked or changed and the count equals the boxes on the page; Back to Listing returns to the listing. An imported comp gets its monthly fee from the MLS sheet (HOA fee plus condo fee, the same sum the subject uses), a blank comp fee gets no HOA adjustment while a typed 0 is adjusted in full, and a closed sale with a blank fee is orange until a number is typed. On a computer (1280, 1440 and 1920 wide) the comps tables fit their cards with no sideways scroll, no cut header and no box outside its cell; orange boxes have a Confirm button. A notice names any closed sale whose HOA adjustment is more than 5% of its sale price, and showing it changes no value.
- `ci/net-sheet-listing-test.js`: three made-up listings, each with its own MLS Data. A net sheet left open on one listing never shows on the next; one click opens the form with that listing's address, list price and HOA fee; typed figures are kept on reopen; the standalone net sheet opens blank after a listing's.
- `ci/note-history-test.js`: a made-up history table that behaves like the real one. The saved net sheet, CMA and description each say when and by whom they were saved; Previous versions lists the earlier saves newest first and opens their text; a new save carries the agent's name, goes out as one request and appears on the list without reopening the listing; an identical re-save adds nothing; one listing never shows another's versions; a failed load is said on screen.

The first two compare the PR with its base branch. Problems `main` already has do not fail a PR; new ones do.

Run them yourself before pushing (tools installed OUTSIDE the clone, base = a copy of `main`):

```
NODE_PATH=/tmp/tools/fe/node_modules node ci/static-checks.js . /path/to/main-copy
NODE_PATH=/tmp/tools/fe/node_modules node ci/mount-check.js . /path/to/main-copy
```

Do not merge a PR while this check is red. A removal of more than 2% of `index.html` needs the PR label `allow-shrink`.
