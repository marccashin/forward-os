begin;

do $$
declare
  t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.property_notes'::regclass
     and a.attname = 'property_id';
  execute format(
    'create table if not exists public.property_note_history (
       id bigint generated always as identity primary key,
       property_id %s not null references public.properties(id) on delete cascade,
       subfolder text not null,
       content text not null,
       saved_by text,
       saved_at timestamptz not null default now()
     )', t);
end;
$$;

create index if not exists property_note_history_lookup
  on public.property_note_history (property_id, subfolder, saved_at desc, id desc);

alter table public.property_note_history enable row level security;

drop policy if exists property_note_history_read on public.property_note_history;
create policy property_note_history_read on public.property_note_history
  for select to anon, authenticated using (true);

revoke all on public.property_note_history from anon, authenticated;
grant select on public.property_note_history to anon, authenticated;
grant all on public.property_note_history to service_role;

create or replace function public.property_note_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  last_content text;
begin
  if new.subfolder is null
     or new.subfolder in ('voice_note', 'listing_remarks_chat', 'campaign_sections')
     or new.content is null
     or btrim(new.content) = '' then
    return new;
  end if;

  select h.content into last_content
    from public.property_note_history h
   where h.property_id = new.property_id
     and h.subfolder = new.subfolder
   order by h.saved_at desc, h.id desc
   limit 1;

  if last_content is not distinct from new.content then
    return new;
  end if;

  insert into public.property_note_history (property_id, subfolder, content, saved_by, saved_at)
  values (new.property_id, new.subfolder, new.content, nullif(btrim(new.updated_by::text), ''), coalesce(new.updated_at, now()));

  return new;
end;
$$;

drop trigger if exists property_notes_keep_history on public.property_notes;
create trigger property_notes_keep_history
  after insert on public.property_notes
  for each row execute function public.property_note_keep_history();

insert into public.property_note_history (property_id, subfolder, content, saved_by, saved_at)
select n.property_id, n.subfolder, n.content, nullif(btrim(n.updated_by::text), ''), coalesce(n.updated_at, now())
  from public.property_notes n
 where n.subfolder is not null
   and n.subfolder not in ('voice_note', 'listing_remarks_chat', 'campaign_sections')
   and n.content is not null
   and btrim(n.content) <> ''
   and not exists (
     select 1 from public.property_note_history h
      where h.property_id = n.property_id
        and h.subfolder = n.subfolder
   )
 order by n.updated_at asc nulls first;

create or replace function public.save_property_note_by(
  p_property_id public.property_notes.property_id%type,
  p_subfolder text,
  p_content text,
  p_saved_by text
)
returns public.property_notes
language plpgsql
set search_path = public
as $$
declare
  r public.property_notes;
begin
  if p_property_id is null or p_subfolder is null or btrim(p_subfolder) = '' then
    raise exception 'save_property_note: listing and note type are required';
  end if;
  if p_subfolder = 'voice_note' then
    raise exception 'save_property_note: voice notes are added, never replaced';
  end if;
  if p_content is null or btrim(p_content) = '' then
    raise exception 'save_property_note: refusing to replace a note with blank text';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text || '|' || p_subfolder, 0));

  delete from public.property_notes
   where property_id = p_property_id
     and subfolder = p_subfolder;

  insert into public.property_notes (property_id, subfolder, content, updated_by, updated_at)
  values (p_property_id, p_subfolder, p_content, nullif(btrim(p_saved_by), ''), now())
  returning * into r;

  return r;
end;
$$;

grant execute on function public.save_property_note_by(public.property_notes.property_id%type, text, text, text) to anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
