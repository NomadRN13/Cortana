-- RSVPlay go-live: UPGRADE A LIVE PROJECT FROM MIGRATION 32 TO THE CURRENT ONE
--
-- Run 1-status.sql first. Paste this ONLY if it shows everything up to 32
-- true and everything after it false. For a fresh project, paste
-- supabase/setup.sql instead.
--
-- All or nothing: it runs inside one transaction, so if any statement fails,
-- nothing is changed and the database stays exactly as it was. Then run
-- 1-status.sql again; every row should read true.
--
-- Built from supabase/migrations/ by scripts/build-go-live.sh. Never edit by
-- hand; never run it twice.
begin;

-- ======================================================================
-- 20260806000033_checkin_waiver_crew.sql
-- ======================================================================
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
--
-- Hardened after the independent review of 2026-11-13:
--   · An RSVP row can't be moved to another event or another member, a
--     checked-in RSVP can't be demoted or deleted by its owner, and the
--     'checked_in' status is no longer used at all — being checked in is
--     checked_in_at, which only check_in_event() and the host can set.
--   · Who checked in, when, and when they accepted the waiver is no longer
--     readable from the RSVP list: those columns are not selectable by
--     members. Your own stamps come from get_my_event_stamps().
--   · Five wrong codes and check-in locks for that member at that event; the
--     host can check them in by hand (admin_check_in).
--   · "Also open to dating" also requires each person to be inside the
--     other's age range, the same rule the Date deck uses.
--   · crew_adds is not readable directly: a row that outlived a block would
--     have told a hidden member from a deleted one.

alter table public.event_rsvps
  add column waiver_accepted_at timestamptz,
  add column waiver_version text check (char_length(waiver_version) <= 20),
  add column checked_in_at timestamptz;

-- Other members may see that you are going (they always could). They may not
-- see whether you actually turned up, when, or when you accepted the waiver.
revoke select on public.event_rsvps from anon, authenticated;
grant select (event_id, user_id, status, created_at) on public.event_rsvps to authenticated;

-- The waiver text members accept. Bump this when counsel changes the wording;
-- every acceptance records which version it was.
create or replace function public.current_waiver_version()
returns text language sql immutable as $$ select '2026-11-draft'::text $$;

-- Every acceptance, kept even if the member later cancels the RSVP: the point
-- of a waiver is that it is still on record afterwards. Deleted with the
-- account, like everything else. Not readable or writable through the API.
create table public.waiver_acceptances (
  event_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  waiver_version text not null check (char_length(waiver_version) <= 20),
  accepted_at timestamptz not null default now(),
  primary key (event_id, user_id, waiver_version)
);
alter table public.waiver_acceptances enable row level security;
revoke all on public.waiver_acceptances from anon, authenticated;

-- The desk: someone on the admin list using the app or the moderation desk,
-- or the project owner in the SQL editor / the service role. A member's or an
-- anonymous visitor's API session is never the desk, whatever it sends.
create or replace function public.is_desk()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or coalesce(nullif(current_setting('role', true), ''), 'none') not in ('authenticated', 'anon')
$$;
revoke all on function public.is_desk() from public, anon, authenticated;

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

-- Wrong guesses, so a four-digit code can't simply be tried until it works.
create table public.event_checkin_attempts (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  failed int not null default 0,
  primary key (event_id, user_id)
);
alter table public.event_checkin_attempts enable row level security;
revoke all on public.event_checkin_attempts from anon, authenticated;

-- ---- members cannot check themselves in or forge a waiver by writing the row ----
create or replace function public.event_rsvps_guard_member_writes()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Attendance is a record: once you've checked in, the RSVP stays.
    if old.checked_in_at is not null then
      raise exception 'You''ve already checked in to this one.' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.status = 'checked_in' then
    raise exception 'Check in with the host''s code.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.waiver_accepted_at := null;
    new.waiver_version := null;
    new.checked_in_at := null;
    return new;
  end if;
  -- An RSVP belongs to one member and one event for good. Moving the row
  -- would carry a check-in and a waiver onto an event never attended.
  if new.event_id is distinct from old.event_id or new.user_id is distinct from old.user_id then
    raise exception 'RSVP to that event instead.' using errcode = '42501';
  end if;
  if new.waiver_accepted_at is distinct from old.waiver_accepted_at
     or new.waiver_version is distinct from old.waiver_version
     or new.checked_in_at is distinct from old.checked_in_at then
    raise exception 'Check in with the host''s code.' using errcode = '42501';
  end if;
  if old.checked_in_at is not null and new.status is distinct from old.status then
    raise exception 'You''ve already checked in to this one.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function public.event_rsvps_guard_member_writes() from public, anon, authenticated;

create trigger event_rsvps_guard_member_writes
  before insert or update or delete on public.event_rsvps
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
  insert into waiver_acceptances (event_id, user_id, waiver_version)
  values (p_event, me, current_waiver_version())
  on conflict do nothing;
end
$$;

-- ---- check-in ----
-- Answers { ok, message, tries_left } rather than raising for a wrong code,
-- because a raise would roll the failed attempt back and it could never be
-- counted. Everything else still raises with a message meant to be shown.
create or replace function public.check_in_event(p_event uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  r record;
  ev record;
  want text;
  tries int;
  max_tries constant int := 5;
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
  if r.checked_in_at is not null then
    return jsonb_build_object('ok', true);  -- already in; saying so twice is not an error
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

  select failed into tries from event_checkin_attempts where event_id = p_event and user_id = me;
  if coalesce(tries, 0) >= max_tries then
    return jsonb_build_object('ok', false, 'tries_left', 0,
      'message', 'Too many wrong codes. Ask the host to check you in.');
  end if;

  select code into want from event_checkin_codes where event_id = p_event;
  -- Same answer whether there is no code yet or the wrong one was typed.
  if want is null or upper(btrim(coalesce(p_code, ''))) <> want then
    insert into event_checkin_attempts (event_id, user_id, failed) values (p_event, me, 1)
    on conflict (event_id, user_id) do update set failed = event_checkin_attempts.failed + 1
    returning failed into tries;
    return jsonb_build_object('ok', false, 'tries_left', greatest(max_tries - tries, 0),
      'message', case when tries >= max_tries
                      then 'Too many wrong codes. Ask the host to check you in.'
                      else 'That code isn''t right.' end);
  end if;
  update event_rsvps set checked_in_at = now() where event_id = p_event and user_id = me;
  return jsonb_build_object('ok', true);
end
$$;

-- The host checks someone in by hand (a locked-out member, a dead phone). The
-- waiver still has to have been accepted.
create or replace function public.admin_check_in(p_event uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_desk() then
    return false;
  end if;
  update event_rsvps set checked_in_at = coalesce(checked_in_at, now())
   where event_id = p_event and user_id = p_user
     and status = 'going' and waiver_accepted_at is not null;
  if found then
    delete from event_checkin_attempts where event_id = p_event and user_id = p_user;
  end if;
  return found;
end
$$;

-- Your own waiver and check-in times, which the RSVP list no longer shows.
create or replace function public.get_my_event_stamps()
returns table (event_id uuid, waiver_accepted_at timestamptz, checked_in_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.event_id, r.waiver_accepted_at, r.checked_in_at
    from event_rsvps r where r.user_id = auth.uid()
$$;

-- The host's side: set or replace an event's code. Admins only.
create or replace function public.set_event_checkin_code(p_event uuid, p_code text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_desk() then
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
-- No policies and no grants: read through get_my_crew(), written through
-- crew_add()/crew_remove(). A row can outlive a block or a suspension, and
-- reading it directly would tell a hidden member from a deleted one.
revoke all on public.crew_adds from anon, authenticated;

-- Did the two of us check in to the same event?
create or replace function public.shared_a_court(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from event_rsvps a
      join event_rsvps b on b.event_id = a.event_id
     where a.user_id = p_a and b.user_id = p_b
       and a.checked_in_at is not null and b.checked_in_at is not null)
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
         -- Mutual, or nothing: both in Date mode, each fits what the other is
         -- looking for, and each is inside the other's age range — the Date
         -- deck's gender, seeking and age rule.
         ('date' = any (me.modes) and 'date' = any (p.modes)
          and not me.is_team and not p.is_team
          and me.gender is not null and p.gender is not null
          and p.gender = any (me.seeking) and me.gender = any (p.seeking)
          and public.age_of(p.birthdate) between me.age_min and me.age_max
          and public.age_of(me.birthdate) between p.age_min and p.age_max)
    from profiles me
    join event_rsvps mine on mine.user_id = me.id and mine.checked_in_at is not null
    join event_rsvps theirs on theirs.event_id = mine.event_id
                           and theirs.checked_in_at is not null
                           and theirs.user_id <> me.id
    join profiles p on p.id = theirs.user_id
    join events e on e.id = mine.event_id
   where me.id = auth.uid()
     and me.suspended_at is null
     and not public.hidden_from_me(p.id)
     -- Someone I reported leaves my crew at once. (Not hidden_from_me():
     -- the conversation stays, as a record for the desk.)
     and not exists (select 1 from reports r
                      where r.reporter_id = me.id and r.target_id = p.id)
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
  -- One answer for "not someone you played with", "blocked", "reported by
  -- you" and "doesn't exist", so the function can't be used to probe any of
  -- them.
  if p_member is null or p_member = me
     or public.hidden_from_me(p_member)
     or exists (select 1 from reports r where r.reporter_id = me and r.target_id = p_member)
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
revoke all on function public.admin_check_in(uuid, uuid) from public, anon;
revoke all on function public.get_my_event_stamps() from public, anon;
revoke all on function public.current_waiver_version() from public, anon;
revoke all on function public.set_event_checkin_code(uuid, text) from public, anon;
revoke all on function public.get_my_crew() from public, anon;
revoke all on function public.crew_add(uuid) from public, anon;
revoke all on function public.crew_remove(uuid) from public, anon;
grant execute on function public.accept_event_waiver(uuid) to authenticated;
grant execute on function public.check_in_event(uuid, text) to authenticated;
grant execute on function public.admin_check_in(uuid, uuid) to authenticated;
grant execute on function public.get_my_event_stamps() to authenticated;
grant execute on function public.current_waiver_version() to authenticated;
grant execute on function public.set_event_checkin_code(uuid, text) to authenticated;
grant execute on function public.get_my_crew() to authenticated;
grant execute on function public.crew_add(uuid) to authenticated;
grant execute on function public.crew_remove(uuid) to authenticated;

-- ======================================================================
-- 20260806000034_phone_bans.sql
-- ======================================================================
-- RSVPlay — a ban that sticks to the phone number
--
-- The architecture promised "bans are by phone number hash, not just account".
-- What existed was suspension, which is per account: a suspended member could
-- delete the account, sign up again with a new email, verify the same phone
-- and be back in the deck the same evening.
--
-- ban_member() suspends the account AND records a hash of its verified
-- number. sync_phone_verification() — the only way a profile becomes
-- phone-verified — now refuses a banned number and suspends the profile that
-- tried. The raw number is never copied out of auth.users.
--
-- Honest limit: phone numbers are a small space, so the hash is not secrecy
-- against someone holding the database; it is there so the ban list is not a
-- list of phone numbers. Nobody but the database owner can read the table.

create table public.banned_phones (
  phone_hash text primary key,
  reason text not null default '' check (char_length(reason) <= 300),
  banned_at timestamptz not null default now()
);
alter table public.banned_phones enable row level security;
-- No policies at all: not readable or writable through the API, admins included.
revoke all on public.banned_phones from anon, authenticated;

create or replace function public.phone_ban_hash(p_phone text)
returns text language sql immutable
as $$ select encode(sha256(convert_to('rsvplay:ban:' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 'UTF8')), 'hex') $$;
revoke all on function public.phone_ban_hash(text) from public, anon, authenticated;

create or replace function public.ban_member(p_user uuid, p_reason text default '')
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_phone text;
begin
  -- The desk: an admin in the app or on the moderation desk, or the project
  -- owner in the SQL editor (is_desk, migration 33).
  if not public.is_desk() then
    return false;
  end if;
  if p_user = auth.uid() then
    return false;   -- banning yourself locks out the only person who can undo it
  end if;
  -- The same two steps as suspend_member(): stop them, and close their open
  -- conversations so nothing they sent keeps a thread alive.
  update profiles
     set suspended_at = coalesce(suspended_at, now()),
         suspended_reason = nullif(left(coalesce(p_reason, ''), 300), '')
   where id = p_user;
  if not found then
    return false;
  end if;
  update matches set closed_at = now()
   where closed_at is null and (user_a = p_user or user_b = p_user);
  select phone into v_phone from auth.users where id = p_user;
  if v_phone is not null and btrim(v_phone) <> '' then
    insert into banned_phones (phone_hash, reason)
    values (public.phone_ban_hash(v_phone), left(coalesce(p_reason, ''), 300))
    on conflict (phone_hash) do nothing;
  end if;
  return true;
end
$$;

-- Lifting a ban is deliberate and separate from lifting a suspension.
create or replace function public.unban_member(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_phone text;
begin
  if not public.is_desk() then
    return false;
  end if;
  select phone into v_phone from auth.users where id = p_user;
  if v_phone is not null then
    delete from banned_phones where phone_hash = public.phone_ban_hash(v_phone);
  end if;
  update profiles set suspended_at = null, suspended_reason = null where id = p_user;
  return found;
end
$$;

create or replace function public.sync_phone_verification()
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_confirmed timestamptz;
  v_phone text;
begin
  select phone_confirmed_at, phone into v_confirmed, v_phone
  from auth.users
  where id = auth.uid();

  if v_confirmed is null then
    return false;
  end if;

  -- A banned number never verifies, and the account that tried is suspended
  -- so it cannot reach anyone while unverified either.
  if v_phone is not null
     and exists (select 1 from banned_phones where phone_hash = public.phone_ban_hash(v_phone)) then
    update profiles
       set suspended_at = coalesce(suspended_at, now()),
           suspended_reason = coalesce(suspended_reason, 'This phone number is banned.')
     where id = auth.uid();
    return false;
  end if;

  update profiles
  set phone_verified_at = coalesce(phone_verified_at, now())
  where id = auth.uid();
  return true;
end
$$;

revoke all on function public.ban_member(uuid, text) from public, anon;
revoke all on function public.unban_member(uuid) from public, anon;
grant execute on function public.ban_member(uuid, text) to authenticated;
grant execute on function public.unban_member(uuid) to authenticated;
grant execute on function public.sync_phone_verification() to authenticated;

-- ---- the ban is enforced where the number becomes known ----
-- (Added after the independent review.) sync_phone_verification() is a call the
-- client chooses to make. These two triggers don't wait for it:
--   (a) an account that attaches a banned, confirmed number is suspended by
--       auth's own write to auth.users;
--   (b) a profile created for an account that already holds one starts
--       suspended. (The name sorts after profiles_guard_member_writes, which
--       clears suspended_at on a member's insert.)
-- Neither ever raises, so neither can block a signup.
create or replace function public.enforce_phone_ban()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if new.phone_confirmed_at is not null
     and new.phone is not null and btrim(new.phone) <> ''
     and exists (select 1 from public.banned_phones where phone_hash = public.phone_ban_hash(new.phone)) then
    update public.profiles
       set suspended_at = coalesce(suspended_at, now()),
           suspended_reason = coalesce(suspended_reason, 'This phone number is banned.')
     where id = new.id;
  end if;
  return new;
end
$$;
revoke all on function public.enforce_phone_ban() from public, anon, authenticated;
create trigger users_enforce_phone_ban
  after insert or update of phone, phone_confirmed_at on auth.users
  for each row execute function public.enforce_phone_ban();

create or replace function public.profiles_phone_ban()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if exists (select 1 from auth.users u
              where u.id = new.id
                and u.phone_confirmed_at is not null
                and u.phone is not null and btrim(u.phone) <> ''
                and exists (select 1 from public.banned_phones b
                             where b.phone_hash = public.phone_ban_hash(u.phone))) then
    new.suspended_at := coalesce(new.suspended_at, now());
    new.suspended_reason := coalesce(new.suspended_reason, 'This phone number is banned.');
  end if;
  return new;
end
$$;
revoke all on function public.profiles_phone_ban() from public, anon, authenticated;
create trigger profiles_phone_ban
  before insert on public.profiles
  for each row execute function public.profiles_phone_ban();

-- Lifting a ban after the account is gone (unban_member() needs the account,
-- which delete_account() removed). Database owner / service role only: it is
-- deliberately not granted to signed-in members, so an admin session cannot
-- use it to probe whether a number is on the list.
create or replace function public.unban_phone(p_phone text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from banned_phones where phone_hash = public.phone_ban_hash(p_phone);
  return found;
end
$$;
revoke all on function public.unban_phone(text) from public, anon, authenticated;

-- ======================================================================
-- 20260806000035_rate_limits.sql
-- ======================================================================
-- RSVPlay — rate limits
--
-- The deck returns at most 100 cards per call, but nothing limited how many
-- calls, swipes, reports or messages one account could make. A script could
-- swipe the whole city in a minute, flood a conversation, or bury the
-- moderation desk (which promises a 24-hour review) in reports.
--
-- Generous for a person, tight for a script:
--   swipes    500 per rolling 24 hours
--   reports    20 per rolling 24 hours
--   messages   60 per rolling minute
--
-- Counted in a log of its own (rate_events), stamped by the server:
--   · not on the rows themselves, because a swipe can be undone and swiped
--     again for ever without the table ever growing;
--   · not on the row's timestamp, because a member can send any created_at
--     they like — the triggers now overwrite it with the server's clock too.
-- Reports are counted inside report_member() BEFORE it looks the person up,
-- so being at the limit answers the same whether or not that account still
-- exists (migration 31 made that function say nothing about who exists).
--
-- Only members' own sessions are counted; the seed, the service role and the
-- SQL editor are not.

create table public.rate_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('swipe', 'report', 'message')),
  at timestamptz not null default now()
);
create index rate_events_idx on public.rate_events (user_id, kind, at);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- Records one event for the caller, or raises if they are over the limit.
create or replace function public.rate_limit_take(p_kind text, p_max int, p_window interval, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  -- No session, or an account that hasn't made a profile yet: nothing to count
  -- against (and everything it could do is refused elsewhere).
  if me is null or not exists (select 1 from profiles where id = me) then
    return;
  end if;
  if (select count(*) from rate_events
       where user_id = me and kind = p_kind and at > now() - p_window) >= p_max then
    raise exception '%', p_message using errcode = '54000';
  end if;
  insert into rate_events (user_id, kind) values (me, p_kind);
  -- Keep the log small: nothing older than two days is ever counted.
  delete from rate_events where user_id = me and at < now() - interval '2 days';
end
$$;
revoke all on function public.rate_limit_take(text, int, interval, text) from public, anon, authenticated;

create or replace function public.rate_limit_swipes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_at := now();  -- the server's clock, whatever the client sent
  perform public.rate_limit_take('swipe', 500, interval '24 hours',
    'That''s plenty for one day. The deck will be here tomorrow.');
  return new;
end $$;

create or replace function public.rate_limit_messages()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.sent_at := now();
  perform public.rate_limit_take('message', 60, interval '1 minute',
    'Slow down a moment, then send again.');
  return new;
end $$;

revoke all on function public.rate_limit_swipes() from public, anon, authenticated;
revoke all on function public.rate_limit_messages() from public, anon, authenticated;

create trigger swipes_rate_limit before insert on public.swipes
  for each row execute function public.rate_limit_swipes();
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.rate_limit_messages();

-- Reports: the only way to file one is report_member() (migration 31 revoked
-- direct inserts), so the limit lives there, ahead of the existence check.
create or replace function public.report_member(p_target uuid, p_reason text, p_context text default 'deck')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- Checked before looking the person up, so a bad report fails the same way
  -- whoever it is about.
  if p_target is null or p_target = me then
    raise exception 'That isn''t someone you can report.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Tell us what happened, in 500 characters or fewer.' using errcode = '22023';
  end if;
  if coalesce(p_context, 'deck') not in ('deck', 'chat', 'event') then
    raise exception 'Unknown report context.' using errcode = '22023';
  end if;
  -- Counted whether or not the account exists, for the same reason.
  perform public.rate_limit_take('report', 20, interval '24 hours',
    'You''ve sent a lot of reports today. If someone is in danger, email hello@rsvplay.app.');
  if exists (select 1 from profiles where id = p_target) then
    insert into reports (reporter_id, target_id, reason, context)
    values (me, p_target, btrim(p_reason), coalesce(p_context, 'deck'));
  end if;
end
$$;
revoke all on function public.report_member(uuid, text, text) from public, anon;
grant execute on function public.report_member(uuid, text, text) to authenticated;

-- ======================================================================
-- 20260806000036_quiet_hours.sql
-- ======================================================================
-- RSVPlay — quiet hours for push notifications
--
-- The architecture says notifications keep quiet from 10pm to 8am local time.
-- Nothing enforced it: the push function sent the moment a row landed, in
-- whatever timezone the server happened to think it was.
--
-- The phone tells us its timezone (an IANA name such as America/Indiana/
-- Indianapolis) through set_my_timezone(). in_quiet_hours() answers for the
-- push function, which now holds a push back during those hours. The
-- notification itself is still written, so it is in the app's inbox when the
-- member next opens it; only the buzz is skipped. A member with no timezone
-- on file is never treated as being in quiet hours.

alter table public.profiles
  add column timezone text check (char_length(timezone) <= 64);

create or replace function public.set_my_timezone(p_tz text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'That isn''t a timezone we know.' using errcode = '22023';
  end if;
  update profiles set timezone = p_tz where id = auth.uid();
end
$$;

-- A timezone written straight to the row has to be a real one too.
create or replace function public.profiles_check_timezone()
returns trigger language plpgsql
as $$
begin
  if new.timezone is not null
     and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'That isn''t a timezone we know.' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger profiles_check_timezone
  before insert or update on public.profiles
  for each row execute function public.profiles_check_timezone();

-- 10pm–8am in the member's own timezone. p_at is there so it can be tested.
create or replace function public.in_quiet_hours(p_user uuid, p_at timestamptz default now())
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select extract(hour from (p_at at time zone p.timezone)) >= 22
        or extract(hour from (p_at at time zone p.timezone)) < 8
      from profiles p
     where p.id = p_user and p.timezone is not null), false)
$$;

revoke all on function public.set_my_timezone(text) from public, anon;
grant execute on function public.set_my_timezone(text) to authenticated;
-- Only the push function (service role) asks; members have no reason to.
revoke all on function public.in_quiet_hours(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.profiles_check_timezone() from public, anon, authenticated;

-- ======================================================================
-- 20260806000037_leagues.sql
-- ======================================================================
-- RSVPlay — ladder leagues
--
-- "Socials, leagues and pickup games" is the positioning, and the event
-- calendar already advertises a "Ladder League Kickoff" — but nothing
-- modelled a league. This is the ladder:
--
--   · An admin creates a league for a city.
--   · A member joins and takes the bottom rung.
--   · You may challenge anyone up to two rungs above you. One open challenge
--     per pair at a time.
--   · Either of the two players records the result. If the challenger wins,
--     they take the challenged player's rung and everyone between moves down
--     one. If the challenged player wins, nothing moves.
--
-- The same people rules as everywhere else: a suspended member cannot join,
-- challenge or record; you cannot challenge someone you've blocked or who has
-- blocked you, and their name is not shown to you in the standings.
-- Standings come from a function that decides what to hand over; the tables
-- themselves show a member only their own rows.
--
-- Hardened after the independent review of 2026-11-13:
--   · The ladder you see leaves out anyone hidden from you and numbers the
--     rest 1, 2, 3 — there is no masked row to give a block away. "Two rungs
--     above" is counted on that same ladder, so what you can challenge is
--     exactly what you can see.
--   · Whenever a member leaves, is suspended or deletes their account, the
--     ladder closes up in one place (a statement trigger), so it can never
--     keep a gap that the two-rung rule would turn into a wall.
--   · A block ends any open challenge between the two people, and a result
--     can't be recorded against someone hidden from you.
--   · A win moves the challenger up at most two rungs, however far the
--     ladder shifted while the challenge was open.
--   · A member's real rung is never handed over: the table is readable by
--     the desk only, and join_league() answers with the rung on the ladder
--     the caller sees. The gap between the two would count the people hidden
--     from them.
--   · Every path that renumbers a ladder takes the league's row lock first,
--     so a suspension or a deleted account can't interleave with a join or a
--     result.

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities (slug),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  venue text not null default '' check (char_length(venue) <= 80),
  sport public.sport not null default 'pickleball',
  level_range text not null default 'All levels' check (char_length(level_range) <= 40),
  starts_at timestamptz not null,
  weeks int not null default 8 check (weeks between 1 and 52),
  created_at timestamptz not null default now()
);
create index leagues_city_starts_idx on public.leagues (city, starts_at);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rung int not null check (rung >= 1),
  wins int not null default 0 check (wins >= 0),
  losses int not null default 0 check (losses >= 0),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id),
  unique (league_id, rung) deferrable initially deferred
);

create table public.league_challenges (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  challenged_id uuid not null references public.profiles (id) on delete cascade,
  winner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (challenger_id <> challenged_id)
);
create unique index league_challenges_open_idx
  on public.league_challenges (league_id, least(challenger_id, challenged_id), greatest(challenger_id, challenged_id))
  where decided_at is null;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_challenges enable row level security;

create policy leagues_select on public.leagues for select to authenticated using (true);
create policy leagues_admin_insert on public.leagues for insert to authenticated with check (public.is_admin());
create policy leagues_admin_update on public.leagues for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy leagues_admin_delete on public.leagues for delete to authenticated using (public.is_admin());

create policy league_members_select on public.league_members
  for select to authenticated using (public.is_admin());
create policy league_challenges_select on public.league_challenges
  for select to authenticated using (auth.uid() in (challenger_id, challenged_id) or public.is_admin());
revoke insert, update, delete on public.league_members from anon, authenticated;
revoke insert, update, delete on public.league_challenges from anon, authenticated;

create or replace function public.join_league(p_league uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_rung int;
begin
  if me is null then
    raise exception 'Sign in to join.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = me) then
    raise exception 'Finish your profile before joining a league.' using errcode = 'P0002';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  perform 1 from leagues where id = p_league for update;
  if not found then
    raise exception 'That league doesn''t exist.' using errcode = 'P0002';
  end if;
  select rung into v_rung from league_members where league_id = p_league and user_id = me;
  if not found then
    select coalesce(max(rung), 0) + 1 into v_rung from league_members where league_id = p_league;
    insert into league_members (league_id, user_id, rung) values (p_league, me, v_rung);
  end if;
  -- The rung on the ladder the caller sees, never the real one: the gap
  -- between the two would count the people hidden from them.
  return (select count(*)::int from league_members m
           where m.league_id = p_league and m.rung <= v_rung
             and not public.hidden_from_me(m.user_id));
end
$$;

-- Whoever leaves a ladder, and however — leave_league(), a suspension, a
-- deleted account — the ladder closes up and their open challenges go.
create or replace function public.league_members_close_up()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- One writer per ladder at a time, whichever way the member left.
  perform 1 from leagues
    where id in (select league_id from gone) order by id for update;
  delete from league_challenges c
   using gone g
   where c.league_id = g.league_id and c.decided_at is null
     and g.user_id in (c.challenger_id, c.challenged_id);
  update league_members m
     set rung = r.rn
    from (select league_id, user_id,
                 row_number() over (partition by league_id order by rung) as rn
            from league_members
           where league_id in (select distinct league_id from gone)) r
   where m.league_id = r.league_id and m.user_id = r.user_id and m.rung <> r.rn;
  return null;
end
$$;
revoke all on function public.league_members_close_up() from public, anon, authenticated;
create trigger league_members_close_up
  after delete on public.league_members
  referencing old table as gone
  for each statement execute function public.league_members_close_up();

create or replace function public.leave_league(p_league uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform 1 from leagues where id = p_league for update;
  delete from league_members where league_id = p_league and user_id = auth.uid();
end
$$;

-- The ladder as the caller sees it: nobody hidden from them, numbered from 1.
create or replace function public.get_league_standings(p_league uuid)
returns table (rung int, user_id uuid, first_name text, wins int, losses int, is_me boolean)
language sql stable security definer set search_path = public
as $$
  select (row_number() over (order by m.rung))::int, m.user_id, p.first_name,
         m.wins, m.losses, m.user_id = auth.uid()
    from league_members m
    join profiles p on p.id = m.user_id
   where m.league_id = p_league
     and auth.uid() is not null
     and not public.i_am_suspended()
     and exists (select 1 from profiles me where me.id = auth.uid())
     and not public.hidden_from_me(m.user_id)
   order by m.rung
$$;

create or replace function public.league_challenge(p_league uuid, p_target uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_rung int;
  their_rung int;
  v_id uuid;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  select rung into my_rung from league_members where league_id = p_league and user_id = me;
  if my_rung is null then
    raise exception 'Join the league before you challenge anyone.' using errcode = 'P0002';
  end if;
  select rung into their_rung from league_members where league_id = p_league and user_id = p_target;
  -- Not in the league, blocked, suspended, or yourself: one answer for all.
  if their_rung is null or p_target = me or public.hidden_from_me(p_target) then
    raise exception 'That isn''t someone you can challenge.' using errcode = '22023';
  end if;
  -- Counted on the ladder the challenger can see: people hidden from them
  -- don't take up a rung, so the rule never points at someone invisible.
  if their_rung > my_rung
     or (select count(*) from league_members m
          where m.league_id = p_league and m.rung >= their_rung and m.rung < my_rung
            and not public.hidden_from_me(m.user_id)) > 2 then
    raise exception 'You can challenge up to two rungs above you.' using errcode = '22023';
  end if;
  begin
    insert into league_challenges (league_id, challenger_id, challenged_id)
    values (p_league, me, p_target) returning id into v_id;
  exception when unique_violation then
    raise exception 'You two already have a challenge to play.' using errcode = '23505';
  end;
  return v_id;
end
$$;

create or replace function public.report_league_result(p_challenge uuid, p_winner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c record;
  hi int;  -- the challenged player's rung (numerically smaller)
  lo int;  -- the challenger's rung
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  select * into c from league_challenges where id = p_challenge for update;
  if not found then
    raise exception 'That challenge doesn''t exist.' using errcode = 'P0002';
  end if;
  if me not in (c.challenger_id, c.challenged_id) then
    raise exception 'Only the two players in a challenge can record its result.' using errcode = '42501';
  end if;
  if c.decided_at is not null then
    raise exception 'This result is already in.' using errcode = '22023';
  end if;
  -- Blocked since the challenge was made (the block normally removes it; this
  -- is the belt to that brace). Same words as a challenge that never existed.
  if public.hidden_from_me(case when me = c.challenger_id then c.challenged_id else c.challenger_id end) then
    raise exception 'That challenge doesn''t exist.' using errcode = 'P0002';
  end if;
  if p_winner is null or p_winner not in (c.challenger_id, c.challenged_id) then
    raise exception 'The winner has to be one of the two players.' using errcode = '22023';
  end if;
  perform 1 from leagues where id = c.league_id for update;
  select rung into hi from league_members where league_id = c.league_id and user_id = c.challenged_id;
  select rung into lo from league_members where league_id = c.league_id and user_id = c.challenger_id;
  if hi is null or lo is null then
    raise exception 'One of you has left the league.' using errcode = '22023';
  end if;

  update league_challenges set winner_id = p_winner, decided_at = now() where id = p_challenge;
  update league_members set wins = wins + 1 where league_id = c.league_id and user_id = p_winner;
  update league_members set losses = losses + 1
   where league_id = c.league_id
     and user_id = case when p_winner = c.challenger_id then c.challenged_id else c.challenger_id end;

  -- The challenger won from below: take that rung, everyone between drops
  -- one. Never more than two rungs, even if the ladder moved while the
  -- challenge was open.
  if p_winner = c.challenger_id and lo > hi then
    hi := greatest(hi, lo - 2);
    update league_members set rung = rung + 1
     where league_id = c.league_id and rung >= hi and rung < lo;
    update league_members set rung = hi
     where league_id = c.league_id and user_id = c.challenger_id;
  end if;
end
$$;

-- A suspended member is taken off every ladder, like tournaments.
create or replace function public.profiles_suspension_leaves_leagues()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.suspended_at is not null and old.suspended_at is null then
    perform 1 from leagues
      where id in (select league_id from league_members where user_id = new.id)
      order by id for update;
    delete from league_members where user_id = new.id;
  end if;
  return new;
end
$$;
create trigger profiles_suspension_leaves_leagues
  after update on public.profiles
  for each row execute function public.profiles_suspension_leaves_leagues();

-- A block ends any open challenge between the two.
create or replace function public.blocks_end_league_challenges()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from league_challenges
   where decided_at is null
     and ((challenger_id = new.blocker_id and challenged_id = new.blocked_id)
       or (challenger_id = new.blocked_id and challenged_id = new.blocker_id));
  return new;
end
$$;
revoke all on function public.blocks_end_league_challenges() from public, anon, authenticated;
create trigger blocks_end_league_challenges
  after insert on public.blocks
  for each row execute function public.blocks_end_league_challenges();

revoke all on function public.join_league(uuid) from public, anon;
revoke all on function public.leave_league(uuid) from public, anon;
revoke all on function public.get_league_standings(uuid) from public, anon;
revoke all on function public.league_challenge(uuid, uuid) from public, anon;
revoke all on function public.report_league_result(uuid, uuid) from public, anon;
revoke all on function public.profiles_suspension_leaves_leagues() from public, anon, authenticated;
grant execute on function public.join_league(uuid) to authenticated;
grant execute on function public.leave_league(uuid) to authenticated;
grant execute on function public.get_league_standings(uuid) to authenticated;
grant execute on function public.league_challenge(uuid, uuid) to authenticated;
grant execute on function public.report_league_result(uuid, uuid) to authenticated;

-- ======================================================================
-- 20260806000038_membership_tiers.sql
-- ======================================================================
-- RSVPlay — Free, Plus and Club
--
-- The revenue order is event tickets, then Club membership (event discounts
-- and priority signup), then venue deals. This lays the entitlement down so
-- the app can show it honestly; it takes no money. There is no purchase flow
-- and no payment table here — when one exists it will set the tier through
-- the service role, the same way an admin does today.
--
--   · profiles.tier: 'free' | 'plus' | 'club'. A member cannot write it.
--   · events.price_cents and events.club_discount_pct: what the app shows
--     ("Club members save 20%"). Display only.
--   · events.general_opens_at: priority signup. Before it, only Club members
--     can RSVP; after it (or when null) everyone can.
--
-- One price for everyone at a tier. No pricing by gender, ever.

alter table public.profiles
  add column tier text not null default 'free' check (tier in ('free', 'plus', 'club'));

alter table public.events
  add column price_cents int check (price_cents is null or price_cents between 0 and 100000),
  add column club_discount_pct int not null default 0 check (club_discount_pct between 0 and 100),
  add column general_opens_at timestamptz;

-- A member's own session can never set or change its tier.
create or replace function public.profiles_guard_tier()
returns trigger language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
  elsif new.tier is distinct from old.tier then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger profiles_guard_tier
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_tier();

create or replace function public.set_member_tier(p_user uuid, p_tier text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_desk() then
    return false;
  end if;
  if p_tier not in ('free', 'plus', 'club') then
    raise exception 'Unknown tier.' using errcode = '22023';
  end if;
  update profiles set tier = p_tier where id = p_user;
  return found;
end
$$;

-- Priority signup: taking a place before general signup opens needs Club.
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
    raise exception 'Signup opens to everyone soon. Club members can RSVP now.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger event_priority_guard
  before insert or update on public.event_rsvps
  for each row execute function public.enforce_event_priority();

revoke all on function public.profiles_guard_tier() from public, anon, authenticated;
revoke all on function public.enforce_event_priority() from public, anon, authenticated;
revoke all on function public.set_member_tier(uuid, text) from public, anon;
grant execute on function public.set_member_tier(uuid, text) to authenticated;

-- ======================================================================
-- 20260806000039_require_verified_phone.sql
-- ======================================================================
-- RSVPlay — "real people only" enforced by the database
--
-- The app has always made a new member verify a phone number before finishing
-- signup. The database never required it: an account that simply skipped the
-- step through the API could swipe, message and RSVP — and, since a phone ban
-- (migration 34) is checked when a number is verified, an account that never
-- verified could never be matched to a ban.
--
-- Now the things that reach other people need a verified phone:
-- swiping, messaging, taking a place at an event, entering a tournament and
-- joining a ladder. Reading, editing your own profile, reporting, blocking
-- and deleting your account do not — nobody is locked out of leaving, or of
-- asking for help.
--
-- app_settings.require_verified_phone is the switch. It is ON, and nothing
-- reachable through the API can read or change it. The test harness turns it
-- off for the suites that predate it and on again to test it.

create table public.app_settings (
  id boolean primary key default true check (id),  -- one row
  require_verified_phone boolean not null default true
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.require_verified_phone()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Members' own sessions only: the seed, the service role and the SQL editor
  -- have no auth.uid().
  if auth.uid() is null then
    return new;
  end if;
  if (select require_verified_phone from app_settings)
     and not exists (select 1 from profiles
                      where id = auth.uid() and phone_verified_at is not null) then
    raise exception 'Verify your phone number to continue.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function public.require_verified_phone() from public, anon, authenticated;

create trigger swipes_require_phone before insert on public.swipes
  for each row execute function public.require_verified_phone();
create trigger messages_require_phone before insert on public.messages
  for each row execute function public.require_verified_phone();
create trigger event_rsvps_require_phone before insert on public.event_rsvps
  for each row execute function public.require_verified_phone();
create trigger tournament_entries_require_phone before insert on public.tournament_entries
  for each row execute function public.require_verified_phone();
create trigger league_members_require_phone before insert on public.league_members
  for each row execute function public.require_verified_phone();

-- ======================================================================
-- 20260806000040_waitlist_on_delete.sql
-- ======================================================================
-- RSVPlay — deleting an account also takes the address off the waitlist
--
-- delete_account() works by deleting the auth.users row and letting foreign
-- keys cascade. That reaches every table keyed on the member's id, which is
-- almost everything — but the waitlist is keyed on an email address and has no
-- user_id at all, so it was never touched.
--
-- The account-deletion page, which Google Play requires and reads, says of
-- "Email & phone": "Deleted." Someone who joined the waitlist first and made an
-- account later would delete that account and still be on a marketing list
-- under the address they asked us to forget. That is the complaint people
-- actually make, and the page promised otherwise.
--
-- Matching on the address is the only link available. It runs before the
-- auth.users delete, because after it there is no email left to match on.

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
begin
  select lower(btrim(email)) into v_email from auth.users where id = auth.uid();

  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects
    where bucket_id = 'photos'
      and name like auth.uid()::text || '/%';
  end if;

  -- join_waitlist() lower-trims before storing, so a plain comparison is
  -- enough; lower() on both sides anyway, in case a row predates that.
  if v_email is not null and v_email <> '' then
    delete from public.waitlist where lower(email) = v_email;
  end if;

  delete from auth.users where id = auth.uid();
end
$$;

-- ======================================================================
-- 20260806000041_ban_survives_deletion.sql
-- ======================================================================
-- RSVPlay — a suspended member can't shed the suspension by deleting
--
-- delete_account() removes the auth.users row, and with it the only copy of
-- the phone number. A member suspended by the desk could delete the account,
-- sign up again and verify the same number, because a suspension (unlike
-- ban_member) recorded nothing about the phone.
--
-- Now, when an account that is suspended at the moment of deletion has a
-- phone number, its hash goes on the ban list first. Nothing is kept for a
-- member in good standing: their deletion is as complete as it was.
-- (The privacy policy's account-deletion section says so.)

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
  v_phone text;
begin
  select lower(btrim(email)), phone into v_email, v_phone from auth.users where id = auth.uid();

  if v_phone is not null and btrim(v_phone) <> ''
     and exists (select 1 from public.profiles where id = auth.uid() and suspended_at is not null) then
    insert into public.banned_phones (phone_hash, reason)
    values (public.phone_ban_hash(v_phone), 'Deleted while suspended.')
    on conflict (phone_hash) do nothing;
  end if;

  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects
    where bucket_id = 'photos'
      and name like auth.uid()::text || '/%';
  end if;

  -- join_waitlist() lower-trims before storing, so a plain comparison is
  -- enough; lower() on both sides anyway, in case a row predates that.
  if v_email is not null and v_email <> '' then
    delete from public.waitlist where lower(email) = v_email;
  end if;

  delete from auth.users where id = auth.uid();
end
$$;

-- ======================================================================
-- 20260806000042_support_address.sql
-- ======================================================================
-- RSVPlay — the support address is hello@rsvplayapp.com
--
-- The domain bought on 2026-11-13 is rsvplayapp.com (rsvplay.com was taken).
-- Four error messages that members can see named the old address. The two
-- functions that raise them are re-created here word for word with the new
-- one; nothing else changes. Migrations 30, 31 and 35 are left as they were,
-- because they are applied on the live project and applied migrations are
-- never edited.

create or replace function public.profiles_guard_member_writes()
returns trigger
language plpgsql
as $$
declare
  settled boolean;  -- past the first hour after signup
begin
  -- Only a member's own session is limited. Security definer functions run as
  -- their owner, and the service role and SQL editor are not members.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new profile starts unverified, unsuspended and with no position: the
    -- app sets the position afterwards through set_my_location().
    new.verified_at := null;
    new.phone_verified_at := null;
    new.suspended_at := null;
    new.suspended_reason := null;
    new.approx_lat := null;
    new.approx_lng := null;
    new.location_updated_at := null;
    new.gender_updated_at := null;
    new.team_updated_at := null;
    new.created_at := now();
    new.last_active_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.verified_at is distinct from old.verified_at
     or new.phone_verified_at is distinct from old.phone_verified_at
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason
     or new.created_at is distinct from old.created_at
     or new.approx_lat is distinct from old.approx_lat
     or new.approx_lng is distinct from old.approx_lng
     or new.location_updated_at is distinct from old.location_updated_at
     or new.gender_updated_at is distinct from old.gender_updated_at
     or new.team_updated_at is distinct from old.team_updated_at then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;

  -- Your birthdate is fixed once your profile exists. Matching filters on it,
  -- so changing it at will would let a member read other people's age ranges
  -- off the deck.
  if new.birthdate is distinct from old.birthdate then
    raise exception 'Your birthdate can''t be changed in the app. If it''s wrong, email hello@rsvplayapp.com and we''ll fix it.'
      using errcode = '42501';
  end if;

  settled := old.created_at < now() - interval '1 hour';

  -- Gender: freely in the first hour (a mis-tap at signup), then once every
  -- 30 days, for the same reason — the deck's "who are they looking for" test
  -- runs on it. Clearing it counts as a change too, so it can't be stepped
  -- through empty to get a second change.
  if new.gender is distinct from old.gender then
    if settled
       and old.gender_updated_at is not null
       and old.gender_updated_at > now() - interval '30 days' then
      raise exception 'You can change this once every 30 days. If it''s wrong, email hello@rsvplayapp.com and we''ll fix it.'
        using errcode = '42501';
    end if;
    if settled then
      new.gender_updated_at := now();
    end if;
  end if;

  -- A doubles partner: adding one, or changing their gender, freely in the
  -- first hour and then once every 30 days. Removing one is always allowed.
  if (new.is_team and not old.is_team)
     or (new.is_team and old.is_team and new.partner_gender is distinct from old.partner_gender) then
    if settled
       and old.team_updated_at is not null
       and old.team_updated_at > now() - interval '30 days' then
      raise exception 'You can add or change a doubles partner once every 30 days. Removing one is always fine — email hello@rsvplayapp.com if you need a hand.'
        using errcode = '42501';
    end if;
    if settled then
      new.team_updated_at := now();
    end if;
  end if;

  -- "Last active" means now, whatever the app sent — a date in the future
  -- would otherwise keep a profile looking active for ever.
  if new.last_active_at is distinct from old.last_active_at then
    new.last_active_at := now();
  end if;
  return new;
end
$$;

create or replace function public.report_member(p_target uuid, p_reason text, p_context text default 'deck')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- Checked before looking the person up, so a bad report fails the same way
  -- whoever it is about.
  if p_target is null or p_target = me then
    raise exception 'That isn''t someone you can report.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Tell us what happened, in 500 characters or fewer.' using errcode = '22023';
  end if;
  if coalesce(p_context, 'deck') not in ('deck', 'chat', 'event') then
    raise exception 'Unknown report context.' using errcode = '22023';
  end if;
  -- Counted whether or not the account exists, for the same reason.
  perform public.rate_limit_take('report', 20, interval '24 hours',
    'You''ve sent a lot of reports today. If someone is in danger, email hello@rsvplayapp.com.');
  if exists (select 1 from profiles where id = p_target) then
    insert into reports (reporter_id, target_id, reason, context)
    values (me, p_target, btrim(p_reason), coalesce(p_context, 'deck'));
  end if;
end
$$;

-- ======================================================================
-- 20260806000043_no_truncate_grants.sql
-- ======================================================================
-- RSVPlay — strangers and members cannot empty a table
--
-- Supabase gives the two API roles (anon, authenticated) every privilege on a
-- new table and relies on row-level security to narrow them. Row-level
-- security does not apply to TRUNCATE. The Data API offers no way to send a
-- TRUNCATE today, so this is not a hole that can be reached — it is a lock on
-- a door that happens to be bricked up. Taking the privilege away means it
-- stays shut even if a later function runs as its caller, and it lets the
-- test harness assert the plain statement: neither API role can empty a
-- table. REFERENCES and TRIGGER go too; neither role has any use for them.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- And for every table created from here on.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

commit;
