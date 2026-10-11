-- Approve for marketing: the approved state of a listing description.
-- Run once in the Supabase SQL Editor, in the three parts marked below. Safe to run
-- again: every statement is repeatable.
--
-- One row per listing in public.listing_description_approvals. Row exists = approved.
-- Row deleted = not approved. Re-approval replaces the row. The Command Center reads
-- this table, so its four columns are a fixed contract: do not rename or retype them.
--
-- The app can read the table and nothing else. An approval is written only by the
-- function approve_listing_description, and removed only by the database itself: when
-- the listing's saved description (property_notes, subfolder 'listing_remarks') no
-- longer holds exactly the approved text, the approval row is deleted in the same
-- transaction as that save. Every save path is covered, because the rule lives on the
-- table and not in the app. Saving identical text keeps the approval.
--
-- Additive only: no existing table, column, policy or function is changed.

-- ===== PART 1 of 3: the table. Last line of this part is: grant all ... to service_role;

do $$
declare
  t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.properties'::regclass
     and a.attname = 'id';
  execute format(
    'create table if not exists public.listing_description_approvals (
       property_id %s primary key references public.properties(id) on delete cascade,
       content text not null,
       approved_by text not null,
       approved_at timestamptz not null default now()
     )', t);
end;
$$;

alter table public.listing_description_approvals enable row level security;

drop policy if exists "listing description approvals read" on public.listing_description_approvals;
create policy "listing description approvals read" on public.listing_description_approvals
  for select to anon, authenticated using (true);

revoke all on public.listing_description_approvals from public, anon, authenticated;
grant select on public.listing_description_approvals to anon, authenticated;
grant all on public.listing_description_approvals to service_role;

-- ===== PART 2 of 3: the rule that clears an approval. Last line of this part is:
-- for each row execute function public.property_notes_recheck_description_approval();

create or replace function public.listing_description_approval_recheck(
  p_property_id public.properties.id%type
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  approved text;
  cur text;
  has_note boolean;
begin
  if p_property_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || '|' || 'listing_remarks', 0));

  select a.content into approved
    from public.listing_description_approvals a
   where a.property_id = p_property_id;
  if not found then
    return;
  end if;

  select n.content into cur
    from public.property_notes n
   where n.property_id = p_property_id
     and n.subfolder = 'listing_remarks'
   order by n.updated_at desc nulls last
   limit 1;
  has_note := found;

  if not has_note or cur is distinct from approved then
    delete from public.listing_description_approvals
     where property_id = p_property_id;
  end if;
end;
$$;

create or replace function public.property_notes_recheck_description_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.subfolder = 'listing_remarks' then
    perform public.listing_description_approval_recheck(old.property_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.subfolder = 'listing_remarks' then
    perform public.listing_description_approval_recheck(new.property_id);
  end if;
  return null;
end;
$$;

revoke all on function public.listing_description_approval_recheck(public.properties.id%type) from public, anon, authenticated;
revoke all on function public.property_notes_recheck_description_approval() from public, anon, authenticated;

drop trigger if exists property_notes_recheck_description_approval on public.property_notes;
create constraint trigger property_notes_recheck_description_approval
  after insert or update or delete on public.property_notes
  deferrable initially deferred
  for each row execute function public.property_notes_recheck_description_approval();

-- ===== PART 3 of 3: the approve function. Last line of this part is:
-- notify pgrst, 'reload schema';

create or replace function public.approve_listing_description(
  p_property_id public.properties.id%type,
  p_content text,
  p_approved_by text
)
returns public.listing_description_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  cur text;
  r public.listing_description_approvals;
begin
  if p_property_id is null then
    raise exception 'No listing was given, so nothing was approved.';
  end if;
  if p_approved_by is null or btrim(p_approved_by) = '' then
    raise exception 'The approving agent''s name is missing, so nothing was approved.';
  end if;
  if p_content is null or btrim(p_content) = '' then
    raise exception 'There is no description text to approve.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || '|' || 'listing_remarks', 0));

  select n.content into cur
    from public.property_notes n
   where n.property_id = p_property_id
     and n.subfolder = 'listing_remarks'
   order by n.updated_at desc nulls last
   limit 1;

  if not found then
    raise exception 'This listing has no saved description, so nothing was approved.'
      using errcode = 'LDA01';
  end if;
  if cur is distinct from p_content then
    raise exception 'The saved description is no longer the text you were reading, so nothing was approved. Read the current text and approve again.'
      using errcode = 'LDA01';
  end if;

  insert into public.listing_description_approvals (property_id, content, approved_by, approved_at)
  values (p_property_id, cur, btrim(p_approved_by), now())
  on conflict (property_id) do update
     set content = excluded.content,
         approved_by = excluded.approved_by,
         approved_at = excluded.approved_at
  returning * into r;

  return r;
end;
$$;

revoke all on function public.approve_listing_description(public.properties.id%type, text, text) from public;
grant execute on function public.approve_listing_description(public.properties.id%type, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
