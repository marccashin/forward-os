# FORWARD OS — Claude Working Rules

## Deployment workflow (ALWAYS follow this order)

1. Make changes on a feature branch (never directly on `main` or `staging`)
2. Push feature branch to GitHub
3. Merge feature branch → `staging` first
4. Marc tests on staging
5. Only after Marc approves: merge to `main` via pull request

**Never push to `main` directly. GitHub ruleset enforces this, but follow it regardless.**
**Never skip staging. Even small fixes go to staging first.**

## Security rules

- Never paste GitHub tokens in chat — they are auto-revoked by GitHub the moment they appear in a conversation
- Never commit `.env` files or secrets to the repo

## Data rules

- Everything is stored globally in Supabase so any device can access it at any time
- `localStorage` is only used as a fast display cache — Supabase is always the source of truth
- When writing to `property_notes`, do NOT include a `created_by` field — that column does not exist

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

Both compare the PR with its base branch. Problems `main` already has do not fail a PR; new ones do.

Run them yourself before pushing (tools installed OUTSIDE the clone, base = a copy of `main`):

```
NODE_PATH=/tmp/tools/fe/node_modules node ci/static-checks.js . /path/to/main-copy
NODE_PATH=/tmp/tools/fe/node_modules node ci/mount-check.js . /path/to/main-copy
```

Do not merge a PR while this check is red. A removal of more than 2% of `index.html` needs the PR label `allow-shrink`.
