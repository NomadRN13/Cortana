-- RSVPlay — the waiver, check-in, and the crew you played with
--
-- The product's promise is "RSVP to a game, show up, and keep the people you
-- met". Until now the backend stopped at the RSVP: nothing recorded that a
-- member accepted the event waiver, nothing recorded that they actually
-- turned up, and nothing connected the people who shared a court afterwards.
--
--   · Waiver: accept_event_waiver() stamps the member's own RSVP with the time
--     and the waiver version they accepted. Check-in refuses without it.
--   · Check-in: the host reads out a code; check_in_event() takes it. The code
--     lives in its own table with no member policy at all, so it cannot be
--     read through the API. Members can no longer mark themselves checked in
--     by writing the row.
--   · Crew: get_my_crew() lists the people who checked in to the same event
--     as you — never the RSVP list, never anyone you've blocked or who has
--     blocked you, never a suspended member. "Also open to dating" is true
--     only when BOTH people have Date mode on and each fits what the other is
--     looking for; otherwise it is false and says nothing about either.
--   · crew_add() keeps someone on your list. It only works for a person you
--     really shared an event with.
--
-- No deposits: there is no payment code anywhere in RSVPlay, so nothing here
-- (or in the app) promises one.

alter table public.event_rsvps
  add column waiver_accepted_at timestamptz,
  add column waiver_version text check (char_length(waiver_version) <= 20),
  add column checked_in_at timestamptz;

-- The waiver text members accept. Bump this when counsel changes the wording;
-- every acceptance records which version it was.
create or replace function public.current_waiver_version()
returns text language sql immutable as $$ select '2026-11-draft'::text $$;

-- ---- check-in codes: admin-only, never readable by a member ----
create table public.event_checkin_codes (
  event_id uuid primary key references public.events (id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Z]{4,8}$'),
  created_at timestamptz not null default now()
);
alter table public.event_checkin_codes enable row level security;
create policy checkin_codes_admin on public.event_checkin_codes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---- members cannot check themselves in or forge a waiver by writing the row ----
create or replace function public.event_rsvps_guard_member_writes()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'checked_in' then
      raise exception 'Check in with the host''s code.' using errcode = '42501';
    end if;
    new.waiver_accepted_at := null;
    new.waiver_version := null;
    new.checked_in_at := null;
    return new;
  end if;
  if new.waiver_accepted_at is distinct from old.waiver_accepted_at
     or new.waiver_version is distinct from old.waiver_version
     or new.checked_in_at is distinct from old.checked_in_at
     or (new.status = 'checked_in' and old.status <> 'checked_in') then
    raise exception 'Check in with the host''s code.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function public.event_rsvps_guard_member_writes() from public, anon, authenticated;

create trigger event_rsvps_guard_member_writes
  before insert or update on public.event_rsvps
  for each row execute function public.event_rsvps_guard_member_writes();

-- ---- the waiver ----
create or replace function public.accept_event_waiver(p_event uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  update event_rsvps
     set waiver_accepted_at = coalesce(waiver_accepted_at, now()),
         waiver_version = coalesce(waiver_version, current_waiver_version())
   where event_id = p_event and user_id = me;
  if not found then
    raise exception 'RSVP before you accept the waiver.' using errcode = 'P0002';
  end if;
end
$$;

-- ---- check-in ----
create or replace function public.check_in_event(p_event uuid, p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  r record;
  ev record;
  want text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from profiles where id = me and suspended_at is not null) then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  select * into ev from events where id = p_event;
  if not found then
    raise exception 'That event doesn''t exist.' using errcode = 'P0002';
  end if;
  select * into r from event_rsvps where event_id = p_event and user_id = me for update;
  if not found or r.status = 'waitlist' then
    raise exception 'RSVP before you check in.' using errcode = 'P0002';
  end if;
  if r.status = 'checked_in' then
    return;  -- already in; saying so twice is not an error
  end if;
  if r.waiver_accepted_at is null then
    raise exception 'Accept the event waiver first.' using errcode = '42501';
  end if;
  if now() < ev.starts_at - interval '1 hour' then
    raise exception 'Check-in opens an hour before the event.' using errcode = '22023';
  end if;
  if now() > ev.starts_at + interval '8 hours' then
    raise exception 'Check-in for this event has closed.' using errcode = '22023';
  end if;
  select code into want from event_checkin_codes where event_id = p_event;
  -- Same answer whether there is no code yet or the wrong one was typed.
  if want is null or upper(btrim(coalesce(p_code, ''))) <> want then
    raise exception 'That code isn''t right.' using errcode = '22023';
  end if;
  update event_rsvps set status = 'checked_in', checked_in_at = now()
   where event_id = p_event and user_id = me;
end
$$;

-- The host's side: set or replace an event's code. Admins only.
create or replace function public.set_event_checkin_code(p_event uuid, p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  insert into event_checkin_codes (event_id, code) values (p_event, upper(btrim(p_code)))
  on conflict (event_id) do update set code = excluded.code, created_at = now();
end
$$;

-- ---- the crew ----
create table public.crew_adds (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
alter table public.crew_adds enable row level security;
-- Your own list, readable by you. Written only through crew_add()/crew_remove().
create policy crew_adds_select on public.crew_adds
  for select to authenticated using (owner_id = auth.uid());
revoke insert, update, delete on public.crew_adds from anon, authenticated;

-- Did the two of us check in to the same event?
create or replace function public.shared_a_court(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from event_rsvps a
      join event_rsvps b on b.event_id = a.event_id
     where a.user_id = p_a and b.user_id = p_b
       and a.status = 'checked_in' and b.status = 'checked_in')
$$;
revoke all on function public.shared_a_court(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_my_crew()
returns table (
  user_id uuid, first_name text, event_id uuid, event_title text,
  event_starts_at timestamptz, added boolean, also_open_to_dating boolean)
language sql stable security definer set search_path = public
as $$
  select distinct on (p.id)
         p.id, p.first_name, e.id, e.title, e.starts_at,
         exists (select 1 from crew_adds c where c.owner_id = auth.uid() and c.member_id = p.id),
         -- Mutual, or nothing: both in Date mode, and each fits the other.
         ('date' = any (me.modes) and 'date' = any (p.modes)
          and not me.is_team and not p.is_team
          and me.gender is not null and p.gender is not null
          and p.gender = any (me.seeking) and me.gender = any (p.seeking))
    from profiles me
    join event_rsvps mine on mine.user_id = me.id and mine.status = 'checked_in'
    join event_rsvps theirs on theirs.event_id = mine.event_id
                           and theirs.status = 'checked_in'
                           and theirs.user_id <> me.id
    join profiles p on p.id = theirs.user_id
    join events e on e.id = mine.event_id
   where me.id = auth.uid()
     and me.suspended_at is null
     and not public.hidden_from_me(p.id)
   order by p.id, e.starts_at desc
$$;

create or replace function public.crew_add(p_member uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  -- One answer for "not someone you played with", "blocked" and "doesn't
  -- exist", so the function can't be used to probe any of them.
  if p_member is null or p_member = me
     or public.hidden_from_me(p_member)
     or not public.shared_a_court(me, p_member) then
    raise exception 'You can add people you''ve shared a court with.' using errcode = '22023';
  end if;
  insert into crew_adds (owner_id, member_id) values (me, p_member) on conflict do nothing;
end
$$;

create or replace function public.crew_remove(p_member uuid)
returns void
language sql security definer set search_path = public
as $$ delete from crew_adds where owner_id = auth.uid() and member_id = p_member $$;

revoke all on function public.accept_event_waiver(uuid) from public, anon;
revoke all on function public.check_in_event(uuid, text) from public, anon;
revoke all on function public.set_event_checkin_code(uuid, text) from public, anon;
revoke all on function public.get_my_crew() from public, anon;
revoke all on function public.crew_add(uuid) from public, anon;
revoke all on function public.crew_remove(uuid) from public, anon;
grant execute on function public.accept_event_waiver(uuid) to authenticated;
grant execute on function public.check_in_event(uuid, text) to authenticated;
grant execute on function public.set_event_checkin_code(uuid, text) to authenticated;
grant execute on function public.get_my_crew() to authenticated;
grant execute on function public.crew_add(uuid) to authenticated;
grant execute on function public.crew_remove(uuid) to authenticated;
