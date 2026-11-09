-- Offer Strategy reports kept on the buyer (forward-os, Nov 9, 2026).
-- Run once by Marc in the Supabase SQL Editor. Safe to run again: every
-- statement is repeatable. Last line: the final "grant update" statement.
--
-- Marc, Nov 9: running several strategies for one client, only Start Over was
-- offered and every earlier strategy was gone from the OS (the PDFs went to
-- Drive, and the buyer page never listed them). Every generated strategy is
-- now one row here, saved automatically and kept up to date while the agent
-- works on it. Reopening a saved one never changes it: the first change makes
-- a new row (copied_from = the one it came from).
--
-- buyer_id is text, as in meeting_briefs: it holds buyers.id as the app has it.
-- inputs = what the strategy was generated from (subject, comps, parameters,
--          the subject's MLS sheet facts). Written once, never updated.
-- work   = the strategy and what the agent did with it (result, chat
--          corrections, client wording, buyer PDF choices). Updated as the
--          agent works.
-- The app may read, add, update `work`, and set removed_at (Remove from list).
-- It cannot delete a row, change its buyer, its inputs or its dates, or bring
-- back a removed row.

create table if not exists public.offer_strategies (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      text not null,
  buyer_name    text,
  agent_name    text,
  address       text,
  copied_from   uuid,
  inputs        jsonb not null,
  work          jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  removed_at    timestamptz
);

create index if not exists offer_strategies_buyer_idx
  on public.offer_strategies (buyer_id, created_at desc);

create or replace function public.offer_strategies_touch()
returns trigger language plpgsql as $$
begin
  if old.removed_at is not null then
    raise exception 'This offer strategy was removed and cannot be changed.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists offer_strategies_touch on public.offer_strategies;
create trigger offer_strategies_touch
  before update on public.offer_strategies
  for each row execute function public.offer_strategies_touch();

alter table public.offer_strategies enable row level security;

drop policy if exists "offer_strategies read"   on public.offer_strategies;
drop policy if exists "offer_strategies insert" on public.offer_strategies;
drop policy if exists "offer_strategies update" on public.offer_strategies;
create policy "offer_strategies read"   on public.offer_strategies for select to anon, authenticated using (true);
create policy "offer_strategies insert" on public.offer_strategies for insert to anon, authenticated with check (removed_at is null);
create policy "offer_strategies update" on public.offer_strategies for update to anon, authenticated using (removed_at is null) with check (true);

revoke all on public.offer_strategies from anon, authenticated;
grant select, insert on public.offer_strategies to anon, authenticated;
grant update (work, removed_at) on public.offer_strategies to anon, authenticated;
