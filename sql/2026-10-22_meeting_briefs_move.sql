-- Move a Meeting Prep brief to the right card, or take it off a card.
-- Run once in the Supabase SQL Editor (paste the whole file, press Run). Safe to run
-- again: every statement is repeatable. The last line is: notify pgrst, 'reload schema';
--
-- Why (Marc, Oct 22, 2026): a brief on Julie Chapman was saved to buyer Julia Long's
-- card by mistake, and nothing could put it right: the app may only read and add
-- briefs (2026-09-30_meeting_briefs.sql).
--
-- What this adds:
--   * two columns on meeting_briefs, removed_at and removed_by. A removed brief is
--     KEPT; the app just stops showing it on the card.
--   * table meeting_brief_changes: one row for every move or removal, with from,
--     to, who and when. The app can read it, never write it.
--   * function move_meeting_brief(p_id, p_to_type, p_to_id, p_by): puts the brief on
--     another buyer or seller card. The card's name is read from the database, not
--     taken from the browser.
--   * function remove_meeting_brief(p_id, p_by): takes a brief off its card.
--
-- The app still cannot update or delete a brief directly. Nothing is ever deleted.
-- Additive only: no existing column, policy or grant is changed.
-- To put a removed brief back by hand:
--   update public.meeting_briefs set removed_at = null, removed_by = null where id = '<id>';

alter table public.meeting_briefs add column if not exists removed_at timestamptz;
alter table public.meeting_briefs add column if not exists removed_by text;

create table if not exists public.meeting_brief_changes (
  id          uuid primary key default gen_random_uuid(),
  brief_id    uuid not null references public.meeting_briefs(id) on delete cascade,
  action      text not null check (action in ('moved', 'removed')),
  from_type   text,
  from_id     text,
  from_name   text,
  to_type     text,
  to_id       text,
  to_name     text,
  changed_by  text not null,
  changed_at  timestamptz not null default now()
);

create index if not exists meeting_brief_changes_brief_idx on public.meeting_brief_changes (brief_id, changed_at desc);

alter table public.meeting_brief_changes enable row level security;
drop policy if exists "meeting_brief_changes read" on public.meeting_brief_changes;
create policy "meeting_brief_changes read" on public.meeting_brief_changes
  for select to anon, authenticated using (true);
revoke all on public.meeting_brief_changes from public, anon, authenticated;
grant select on public.meeting_brief_changes to anon, authenticated;
grant all on public.meeting_brief_changes to service_role;

-- The name a card goes by, read the same way the app reads it (mbPersonName):
-- buyer = buyer_name, else first and last name; seller = seller_name, else address.
-- Null when no such card exists.
create or replace function public.meeting_brief_card_name(p_type text, p_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j jsonb;
begin
  if p_type = 'buyer' then
    select to_jsonb(b) into j from public.buyers b where b.id::text = p_id;
    if j is null then return null; end if;
    return coalesce(nullif(btrim(j->>'buyer_name'), ''),
                    nullif(btrim(concat_ws(' ', j->>'first_name', j->>'last_name')), ''),
                    'Buyer');
  elsif p_type = 'seller' then
    select to_jsonb(p) into j from public.properties p where p.id::text = p_id;
    if j is null then return null; end if;
    return coalesce(nullif(btrim(j->>'seller_name'), ''), nullif(btrim(j->>'address'), ''), 'Seller');
  end if;
  return null;
end;
$$;

create or replace function public.move_meeting_brief(
  p_id uuid,
  p_to_type text,
  p_to_id text,
  p_by text
)
returns public.meeting_briefs
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.meeting_briefs;
  to_name text;
begin
  if p_by is null or btrim(p_by) = '' then
    raise exception 'say who is moving the brief';
  end if;
  if p_to_type is null or p_to_type not in ('buyer', 'seller') then
    raise exception 'a brief can only go on a buyer or a seller card';
  end if;
  select * into r from public.meeting_briefs where id = p_id for update;
  if not found then
    raise exception 'that brief was not found';
  end if;
  if r.removed_at is not null then
    raise exception 'that brief was removed from its card';
  end if;
  if r.person_type = p_to_type and r.person_id = btrim(coalesce(p_to_id, '')) then
    raise exception 'that brief is already on this card';
  end if;
  to_name := public.meeting_brief_card_name(p_to_type, btrim(coalesce(p_to_id, '')));
  if to_name is null then
    raise exception 'that % card was not found', p_to_type;
  end if;

  insert into public.meeting_brief_changes (brief_id, action, from_type, from_id, from_name, to_type, to_id, to_name, changed_by)
  values (r.id, 'moved', r.person_type, r.person_id, r.person_name, p_to_type, btrim(p_to_id), to_name, btrim(p_by));

  update public.meeting_briefs
     set person_type = p_to_type, person_id = btrim(p_to_id), person_name = to_name
   where id = r.id
  returning * into r;
  return r;
end;
$$;

create or replace function public.remove_meeting_brief(
  p_id uuid,
  p_by text
)
returns public.meeting_briefs
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.meeting_briefs;
begin
  if p_by is null or btrim(p_by) = '' then
    raise exception 'say who is removing the brief';
  end if;
  select * into r from public.meeting_briefs where id = p_id for update;
  if not found then
    raise exception 'that brief was not found';
  end if;
  if r.removed_at is not null then
    raise exception 'that brief was already removed';
  end if;

  insert into public.meeting_brief_changes (brief_id, action, from_type, from_id, from_name, changed_by)
  values (r.id, 'removed', r.person_type, r.person_id, r.person_name, btrim(p_by));

  update public.meeting_briefs
     set removed_at = now(), removed_by = btrim(p_by)
   where id = r.id
  returning * into r;
  return r;
end;
$$;

revoke all on function public.meeting_brief_card_name(text, text) from public;
revoke all on function public.move_meeting_brief(uuid, text, text, text) from public;
revoke all on function public.remove_meeting_brief(uuid, text) from public;
grant execute on function public.move_meeting_brief(uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function public.remove_meeting_brief(uuid, text) to anon, authenticated, service_role;
grant execute on function public.meeting_brief_card_name(text, text) to service_role;

notify pgrst, 'reload schema';
