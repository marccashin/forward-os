-- Earlier versions of a CMA (version history, step 3). Run once in the Supabase SQL Editor.
-- Safe to run again: every statement is repeatable.
--
-- One row per kept copy of a CMA draft: its comps, its settings and how condition was
-- valued. The CMA Builder adds a row when a PDF is exported or saved to the folder, before
-- Reset / New CMA, before an earlier version is opened over the current one, and before an
-- agent's edit of a teammate's newer CMA replaces their own older draft.
-- The app can add and read rows. It can never change or delete one.

create table if not exists public.cma_snapshots (
  id               uuid primary key default gen_random_uuid(),
  property_address text not null,
  agent_name       text not null default '',
  reason           text not null default '',
  value_text       text not null default '',
  draft_data       jsonb not null,
  created_at       timestamptz not null default now()
);

create index if not exists cma_snapshots_address_created
  on public.cma_snapshots (property_address, created_at desc);

alter table public.cma_snapshots enable row level security;

drop policy if exists "cma snapshots read" on public.cma_snapshots;
create policy "cma snapshots read" on public.cma_snapshots
  for select to anon, authenticated using (true);

drop policy if exists "cma snapshots add" on public.cma_snapshots;
create policy "cma snapshots add" on public.cma_snapshots
  for insert to anon, authenticated with check (true);

grant select, insert on public.cma_snapshots to anon, authenticated;
grant all on public.cma_snapshots to service_role;

notify pgrst, 'reload schema';
