create or replace function public.save_property_note(
  p_property_id public.property_notes.property_id%type,
  p_subfolder text,
  p_content text
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

  insert into public.property_notes (property_id, subfolder, content, updated_at)
  values (p_property_id, p_subfolder, p_content, now())
  returning * into r;

  return r;
end;
$$;

grant execute on function public.save_property_note(public.property_notes.property_id%type, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
