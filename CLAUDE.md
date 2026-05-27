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
