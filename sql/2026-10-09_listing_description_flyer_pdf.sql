-- Approve for marketing, part two: the flyer version and the branded PDF.
-- Run once in the Supabase SQL Editor, in the four parts marked below, AFTER
-- sql/2026-10-09_listing_description_approvals.sql. Safe to run again.
--
-- Adds two nullable columns to public.listing_description_approvals. The Command Center
-- reads both, so they are part of the fixed contract:
--   flyer_content  text   the approved flyer version, 200 words or fewer
--   pdf_url        text   public https URL of the branded PDF of the approved description
-- A row approved before this was run keeps both null.
--
-- One approval covers two texts. The flyer version is saved like every other listing
-- note (property_notes, subfolder 'listing_flyer'), so it has version history and the
-- same one-step save. The rule that clears an approval now reads: the row stands only
-- while the listing's saved description is exactly `content` AND, when the row has a
-- flyer_content, the listing's saved flyer version is exactly that. Editing either one
-- to different text deletes the row, in the same transaction as the save.
--
-- The app still cannot write the table. Rows are written by the two functions below.
--
-- Additive only: the four existing columns, the read policy and the trigger itself are
-- as they were. Two existing functions get a new body with the SAME name and arguments:
-- the recheck (it now also compares the flyer) and the trigger function (it now also
-- fires for 'listing_flyer').

-- ===== PART 1 of 4: the two columns and the clearing rule. Last line of this part is:
-- revoke all on function public.property_notes_recheck_description_approval() from public, anon, authenticated;

alter table public.listing_description_approvals add column if not exists flyer_content text;
alter table public.listing_description_approvals add column if not exists pdf_url text;

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
  approved_flyer text;
  cur text;
  cur_flyer text;
  has_note boolean;
  has_flyer boolean;
begin
  if p_property_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || '|' || 'listing_remarks', 0));

  select a.content, a.flyer_content into approved, approved_flyer
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
    return;
  end if;

  if approved_flyer is null then
    return;
  end if;

  select n.content into cur_flyer
    from public.property_notes n
   where n.property_id = p_property_id
     and n.subfolder = 'listing_flyer'
   order by n.updated_at desc nulls last
   limit 1;
  has_flyer := found;

  if not has_flyer or cur_flyer is distinct from approved_flyer then
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
  if tg_op in ('UPDATE', 'DELETE') and old.subfolder in ('listing_remarks', 'listing_flyer') then
    perform public.listing_description_approval_recheck(old.property_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.subfolder in ('listing_remarks', 'listing_flyer') then
    perform public.listing_description_approval_recheck(new.property_id);
  end if;
  return null;
end;
$$;

revoke all on function public.listing_description_approval_recheck(public.properties.id%type) from public, anon, authenticated;
revoke all on function public.property_notes_recheck_description_approval() from public, anon, authenticated;

-- ===== PART 2 of 4: approving both texts. Last line of this part is:
-- grant execute on function public.approve_listing_description_with_flyer(public.properties.id%type, text, text, text) to anon, authenticated, service_role;

create or replace function public.listing_flyer_word_count(p_text text)
returns integer
language sql
immutable
as $$
  select coalesce(array_length(regexp_split_to_array(nullif(btrim(coalesce(p_text, ''), E' \t\n\r'), ''), E'[ \t\n\r]+'), 1), 0);
$$;

create or replace function public.approve_listing_description_with_flyer(
  p_property_id public.properties.id%type,
  p_content text,
  p_flyer_content text,
  p_approved_by text
)
returns public.listing_description_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  cur text;
  cur_flyer text;
  words integer;
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
  if p_flyer_content is null or btrim(p_flyer_content) = '' then
    raise exception 'There is no flyer version yet, so nothing was approved.'
      using errcode = 'LDA02';
  end if;
  words := public.listing_flyer_word_count(p_flyer_content);
  if words > 200 then
    raise exception 'The flyer version is % words. The limit is 200, so nothing was approved.', words
      using errcode = 'LDA02';
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

  select n.content into cur_flyer
    from public.property_notes n
   where n.property_id = p_property_id
     and n.subfolder = 'listing_flyer'
   order by n.updated_at desc nulls last
   limit 1;
  if not found then
    raise exception 'This listing has no saved flyer version, so nothing was approved.'
      using errcode = 'LDA01';
  end if;
  if cur_flyer is distinct from p_flyer_content then
    raise exception 'The saved flyer version is no longer the text you were reading, so nothing was approved. Read the current text and approve again.'
      using errcode = 'LDA01';
  end if;

  insert into public.listing_description_approvals (property_id, content, approved_by, approved_at, flyer_content, pdf_url)
  values (p_property_id, cur, btrim(p_approved_by), now(), cur_flyer, null)
  on conflict (property_id) do update
     set content = excluded.content,
         approved_by = excluded.approved_by,
         approved_at = excluded.approved_at,
         flyer_content = excluded.flyer_content,
         pdf_url = null
  returning * into r;

  return r;
end;
$$;

revoke all on function public.listing_flyer_word_count(text) from public;
revoke all on function public.approve_listing_description_with_flyer(public.properties.id%type, text, text, text) from public;
grant execute on function public.listing_flyer_word_count(text) to anon, authenticated, service_role;
grant execute on function public.approve_listing_description_with_flyer(public.properties.id%type, text, text, text) to anon, authenticated, service_role;

-- ===== PART 3 of 4: the older approve function, and recording the PDF. Last line of this part is:
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

  insert into public.listing_description_approvals (property_id, content, approved_by, approved_at, flyer_content, pdf_url)
  values (p_property_id, cur, btrim(p_approved_by), now(), null, null)
  on conflict (property_id) do update
     set content = excluded.content,
         approved_by = excluded.approved_by,
         approved_at = excluded.approved_at,
         flyer_content = null,
         pdf_url = null
  returning * into r;

  return r;
end;
$$;

create or replace function public.set_listing_description_pdf(
  p_property_id public.properties.id%type,
  p_approved_at timestamptz,
  p_pdf_url text
)
returns public.listing_description_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.listing_description_approvals;
begin
  if p_pdf_url is null
     or p_pdf_url !~ '^https://ewedrgopezogifzysusn\.supabase\.co/storage/v1/object/public/listing-description-pdfs/[^?#]+\.pdf$' then
    raise exception 'That is not the address of a listing description PDF, so it was not recorded.';
  end if;

  update public.listing_description_approvals
     set pdf_url = p_pdf_url
   where property_id = p_property_id
     and approved_at = p_approved_at
  returning * into r;

  if not found then
    raise exception 'That approval is no longer on file, so the PDF was not recorded.'
      using errcode = 'LDA01';
  end if;
  return r;
end;
$$;

revoke all on function public.approve_listing_description(public.properties.id%type, text, text) from public;
revoke all on function public.set_listing_description_pdf(public.properties.id%type, timestamptz, text) from public;
grant execute on function public.approve_listing_description(public.properties.id%type, text, text) to anon, authenticated, service_role;
grant execute on function public.set_listing_description_pdf(public.properties.id%type, timestamptz, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- ===== PART 4 of 4: the public folder for the PDFs. Last line of this part is:
-- for insert to anon, authenticated with check (bucket_id = 'listing-description-pdfs');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-description-pdfs', 'listing-description-pdfs', true, 5242880, array['application/pdf'])
on conflict (id) do update
   set public = true,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "listing description pdfs add" on storage.objects;
create policy "listing description pdfs add" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'listing-description-pdfs');
