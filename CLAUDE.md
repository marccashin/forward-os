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
- Read listing notes newest first (`order=updated_at.desc.nullslast`) and use the first row of each type.
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

The first two compare the PR with its base branch. Problems `main` already has do not fail a PR; new ones do.

Run them yourself before pushing (tools installed OUTSIDE the clone, base = a copy of `main`):

```
NODE_PATH=/tmp/tools/fe/node_modules node ci/static-checks.js . /path/to/main-copy
NODE_PATH=/tmp/tools/fe/node_modules node ci/mount-check.js . /path/to/main-copy
```

Do not merge a PR while this check is red. A removal of more than 2% of `index.html` needs the PR label `allow-shrink`.
