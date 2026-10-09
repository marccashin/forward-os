-- "Editing now" marker for the Listing Description Writer.
-- Run once in the Supabase SQL Editor, in the two parts marked below. Safe to run
-- again: every statement is repeatable.
--
-- One row per listing in public.listing_description_editing while an agent has the
-- writer open on a listing that already has a saved description. The Command Center
-- reads it and warns Concierge that the approved text may be about to change. Its four
-- columns are a fixed contract: do not rename or retype them.
--
-- It is a courtesy signal, not a lock. The Command Center ignores a row whose
-- last_active_at is more than 3 minutes old, so a row the OS failed to remove clears
-- itself. Nothing in the OS depends on it.
--
-- The app can read the table and nothing else. Rows are written and removed only by
-- the three functions below.
--
-- Additive only: no existing table, column, policy, function or trigger is changed.

-- ===== PART 1 of 2: the table. Last line of this part is: grant all ... to service_role;

do $$
declare
  t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.properties'::regclass
     and a.attname = 'id';
  execute format(
    'create table if not exists public.listing_description_editing (
       property_id %s primary key references public.properties(id) on delete cascade,
       editor text not null,
       started_at timestamptz not null default now(),
       last_active_at timestamptz not null default now()
     )', t);
end;
$$;

alter table public.listing_description_editing enable row level security;

drop policy if exists "listing description editing read" on public.listing_description_editing;
create policy "listing description editing read" on public.listing_description_editing
  for select to anon, authenticated using (true);

revoke all on public.listing_description_editing from public, anon, authenticated;
grant select on public.listing_description_editing to anon, authenticated;
grant all on public.listing_description_editing to service_role;

-- ===== PART 2 of 2: the three functions. Last line of this part is:
-- notify pgrst, 'reload schema';

create or replace function public.listing_description_editing_start(
  p_property_id public.properties.id%type,
  p_editor text
)
returns public.listing_description_editing
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.listing_description_editing;
begin
  if p_property_id is null or p_editor is null or btrim(p_editor) = '' then
    return null;
  end if;
  if not exists (
    select 1 from public.property_notes n
     where n.property_id = p_property_id
       and n.subfolder = 'listing_remarks'
       and btrim(coalesce(n.content, '')) <> ''
  ) then
    delete from public.listing_description_editing where property_id = p_property_id;
    return null;
  end if;

  insert into public.listing_description_editing (property_id, editor, started_at, last_active_at)
  values (p_property_id, btrim(p_editor), now(), now())
  on conflict (property_id) do update
     set editor = excluded.editor,
         started_at = excluded.started_at,
         last_active_at = excluded.last_active_at
  returning * into r;
  return r;
end;
$$;

create or replace function public.listing_description_editing_touch(
  p_property_id public.properties.id%type,
  p_editor text
)
returns public.listing_description_editing
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.listing_description_editing;
begin
  if p_property_id is null or p_editor is null or btrim(p_editor) = '' then
    return null;
  end if;
  if not exists (
    select 1 from public.property_notes n
     where n.property_id = p_property_id
       and n.subfolder = 'listing_remarks'
       and btrim(coalesce(n.content, '')) <> ''
  ) then
    delete from public.listing_description_editing where property_id = p_property_id;
    return null;
  end if;

  insert into public.listing_description_editing as e (property_id, editor, started_at, last_active_at)
  values (p_property_id, btrim(p_editor), now(), now())
  on conflict (property_id) do update
     set started_at = case when e.editor = excluded.editor then e.started_at else excluded.started_at end,
         editor = excluded.editor,
         last_active_at = excluded.last_active_at
  returning * into r;
  return r;
end;
$$;

create or replace function public.listing_description_editing_stop(
  p_property_id public.properties.id%type,
  p_editor text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.listing_description_editing
   where property_id = p_property_id
     and editor = btrim(coalesce(p_editor, ''));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.listing_description_editing_start(public.properties.id%type, text) from public;
revoke all on function public.listing_description_editing_touch(public.properties.id%type, text) from public;
revoke all on function public.listing_description_editing_stop(public.properties.id%type, text) from public;
grant execute on function public.listing_description_editing_start(public.properties.id%type, text) to anon, authenticated, service_role;
grant execute on function public.listing_description_editing_touch(public.properties.id%type, text) to anon, authenticated, service_role;
grant execute on function public.listing_description_editing_stop(public.properties.id%type, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
