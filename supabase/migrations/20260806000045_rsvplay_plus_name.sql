-- RSVPlay — the membership is called RSVPlay+
--
-- Founder's decision, 2026-11-15: the paid membership members see is named
-- "RSVPlay+" (it was "Club"). Only what members read changes. Inside the
-- database the tier keeps its value 'club', so nothing that stores or checks
-- it changes; the 'plus' slot stays reserved and is not sold or assigned.
--
-- The one member-facing sentence the database writes itself is the refusal
-- during early signup; the function is re-created word for word with the new
-- name. Migration 38 is applied on the live project and is not edited.

create or replace function public.enforce_event_priority()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  opens timestamptz;
begin
  if new.status not in ('going') then
    return new;
  end if;
  -- Already holding a place at THIS event (not relying on migration 33's
  -- guard to stop the row being pointed at another one).
  if tg_op = 'UPDATE' and old.status in ('going', 'checked_in')
     and new.event_id = old.event_id and new.user_id = old.user_id then
    return new;
  end if;
  select general_opens_at into opens from events where id = new.event_id;
  if opens is not null and now() < opens
     and not exists (select 1 from profiles where id = new.user_id and tier = 'club') then
    raise exception 'Signup opens to everyone soon. RSVPlay+ members can RSVP now.' using errcode = '42501';
  end if;
  return new;
end
$$;
