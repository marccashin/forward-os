-- Meeting Prep briefs saved to a buyer or seller card (forward-os PR #165, Sept 30, 2026).
-- Run by Marc in the Supabase SQL Editor on Oct 2, 2026, 08:42 ET. Kept here as the
-- record of what is live; copied word for word from the PR #165 description. Safe to
-- run again: every statement is repeatable.
--
-- One row per brief. person_type + person_id say which card it is on (buyer = buyers.id,
-- seller = properties.id; text, because they are different tables). The app may read
-- and add rows, nothing else. Moving or removing a brief goes through the functions in
-- 2026-10-22_meeting_briefs_move.sql.

create table if not exists public.meeting_briefs (
  id            uuid primary key default gen_random_uuid(),
  person_type   text not null check (person_type in ('buyer','seller')),
  person_id     text not null,
  person_name   text,
  subject_name  text,
  agent_name    text,
  brief         jsonb not null,
  sources       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists meeting_briefs_person_idx on public.meeting_briefs (person_type, person_id, created_at desc);

alter table public.meeting_briefs enable row level security;

drop policy if exists "meeting_briefs read"   on public.meeting_briefs;
drop policy if exists "meeting_briefs insert" on public.meeting_briefs;
create policy "meeting_briefs read"   on public.meeting_briefs for select to anon, authenticated using (true);
create policy "meeting_briefs insert" on public.meeting_briefs for insert to anon, authenticated with check (true);

grant select, insert on public.meeting_briefs to anon, authenticated;
