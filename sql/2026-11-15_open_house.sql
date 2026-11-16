-- Open House sign-ins and seller reports (forward-os, Nov 15, 2026).
-- Run once by Marc in the Supabase SQL Editor. Safe to run again: every
-- statement is repeatable. Last line: the final "grant update" statement.
--
-- Marc, Nov 15, 2026: FORWARD OS replaces Spacio for open house sign-in. Each
-- sign-in goes to Follow Up Boss (the lead) AND, without the visitor's name,
-- phone or email, to open_house_signins here, so the agent can send the seller
-- an open house report from the OS (Marc: no names on the seller's report).
--
-- open_house_signins: one row per sign-in. id is made on the device (the same
--   id the sign-in has while it waits on the device), so a retried send is
--   ignored, never doubled. answers = the visitor's answers to the open house
--   questions: [{ "id", "q" (the question's words), "a" (the answer) }].
--   NO name, phone or email is stored here; those live in Follow Up Boss only.
--   The app may read and add rows. It cannot change or delete one.
--
-- open_house_reports: one row per open house, the agent's working copy of the
--   seller report (which tallies to show, the feedback as edited, kept or left
--   out, feedback the agent added, the agent's note). The app may read, add,
--   and update `report` and `updated_by`. It cannot delete a row.

create table if not exists public.open_house_signins (
  id                    text primary key,
  open_house_id         text not null,
  agent_name            text not null,
  street                text not null,
  unit                  text,
  city                  text,
  state                 text,
  zip                   text,
  open_house_started_at timestamptz,
  signed_in_at          timestamptz not null,
  answers               jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists open_house_signins_house_idx
  on public.open_house_signins (open_house_id, signed_in_at);
create index if not exists open_house_signins_agent_idx
  on public.open_house_signins (agent_name, signed_in_at desc);

alter table public.open_house_signins enable row level security;

drop policy if exists "open_house_signins read"   on public.open_house_signins;
drop policy if exists "open_house_signins insert" on public.open_house_signins;
create policy "open_house_signins read"   on public.open_house_signins for select to anon, authenticated using (true);
create policy "open_house_signins insert" on public.open_house_signins for insert to anon, authenticated with check (true);

revoke all on public.open_house_signins from anon, authenticated;
grant select, insert on public.open_house_signins to anon, authenticated;

create table if not exists public.open_house_reports (
  open_house_id text primary key,
  agent_name    text,
  address       text,
  report        jsonb not null,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.open_house_reports_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists open_house_reports_touch on public.open_house_reports;
create trigger open_house_reports_touch
  before update on public.open_house_reports
  for each row execute function public.open_house_reports_touch();

alter table public.open_house_reports enable row level security;

drop policy if exists "open_house_reports read"   on public.open_house_reports;
drop policy if exists "open_house_reports insert" on public.open_house_reports;
drop policy if exists "open_house_reports update" on public.open_house_reports;
create policy "open_house_reports read"   on public.open_house_reports for select to anon, authenticated using (true);
create policy "open_house_reports insert" on public.open_house_reports for insert to anon, authenticated with check (true);
create policy "open_house_reports update" on public.open_house_reports for update to anon, authenticated using (true) with check (true);

revoke all on public.open_house_reports from anon, authenticated;
grant select, insert on public.open_house_reports to anon, authenticated;
grant update (report, updated_by) on public.open_house_reports to anon, authenticated;
