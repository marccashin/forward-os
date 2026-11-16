-- Preferred Vendors: notes from the team (forward-os, Nov 16, 2026).
-- Run once by Marc in the Supabase SQL Editor. Safe to run again: every
-- statement is repeatable. Last line: the final "grant execute" statement.
--
-- Marc, Nov 16, 2026: "let's leave a section for agent feedback. Agents should
-- be able to leave notes for the other agents like what went well or what
-- didn't." The vendor list itself stays in Marc's Google Drive sheet; only the
-- agents' notes live here.
--
-- vendor_notes: one row per note. id is made on the device, so a retried send is
--   ignored, never doubled. vendor = the vendor as the OS shows it (the sheet's
--   name, else its company); trade and region = where the agent was looking when
--   they wrote it. good = went well (true) or did not go well (false).
--   The app may read rows and add rows. It cannot change or delete one.
--   Removing a note goes ONLY through remove_vendor_note(): the agent who wrote
--   it, Marc Cashin or Operations may remove it (Marc, Nov 16, 2026). A removed
--   note is kept with removed_at and removed_by set; the OS lists only notes
--   whose removed_at is null.

create table if not exists public.vendor_notes (
  id          uuid primary key,
  vendor      text not null check (btrim(vendor) <> '' and length(vendor) <= 200),
  trade       text,
  region      text,
  good        boolean not null,
  body        text not null check (btrim(body) <> '' and length(body) <= 2000),
  agent_name  text not null check (btrim(agent_name) <> ''),
  created_at  timestamptz not null default now(),
  removed_at  timestamptz,
  removed_by  text
);

create index if not exists vendor_notes_vendor_idx on public.vendor_notes (vendor, created_at desc);

alter table public.vendor_notes enable row level security;

drop policy if exists "vendor_notes read"   on public.vendor_notes;
drop policy if exists "vendor_notes insert" on public.vendor_notes;
create policy "vendor_notes read"   on public.vendor_notes for select to anon, authenticated using (true);
create policy "vendor_notes insert" on public.vendor_notes for insert to anon, authenticated
  with check (removed_at is null and removed_by is null);

revoke all on public.vendor_notes from anon, authenticated;
grant select, insert on public.vendor_notes to anon, authenticated;

-- The database sets created_at; the app cannot backdate a note.
create or replace function public.vendor_notes_stamp()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists vendor_notes_stamp on public.vendor_notes;
create trigger vendor_notes_stamp
  before insert on public.vendor_notes
  for each row execute function public.vendor_notes_stamp();

create or replace function public.remove_vendor_note(
  p_id uuid,
  p_by text
)
returns public.vendor_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.vendor_notes;
  who text := btrim(coalesce(p_by, ''));
begin
  if who = '' then
    raise exception 'say who is removing the note';
  end if;
  select * into r from public.vendor_notes where id = p_id for update;
  if not found then
    raise exception 'that note was not found';
  end if;
  if r.removed_at is not null then
    raise exception 'that note was already removed';
  end if;
  if who <> r.agent_name and who not in ('Marc Cashin', 'Operations') then
    raise exception 'only the agent who wrote a note, Marc or Operations can remove it';
  end if;
  update public.vendor_notes
     set removed_at = now(), removed_by = who
   where id = r.id
  returning * into r;
  return r;
end;
$$;

revoke all on function public.remove_vendor_note(uuid, text) from public;
grant execute on function public.remove_vendor_note(uuid, text) to anon, authenticated, service_role;
