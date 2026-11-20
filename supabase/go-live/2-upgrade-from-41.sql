-- RSVPlay go-live: UPGRADE A LIVE PROJECT FROM MIGRATION 41 TO THE CURRENT ONE
--
-- Run 1-status.sql first. Paste this ONLY if it shows everything up to 41
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

-- ======================================================================
-- 20260806000044_date_likes_per_day.sql
-- ======================================================================
-- RSVPlay — three likes a day in Date mode
--
-- Founder's decision, 2026-11-14: in Date mode a member gets 3 likes per
-- rolling 24 hours, for now. A like and an ace (super like) both count; a pass
-- never does. Play and Friends are not affected (they keep the 500-a-day
-- anti-script limit from migration 35).
--
-- The number lives in app_settings (date_likes_per_day), so it can change
-- without an app release, from the SQL editor only. date_like_allowance() is
-- the one place that answers "how many may this member have"; when likes can
-- be bought or come with a membership (docs/proposals/2026-11-14-like-packs.md)
-- only that function changes.
--
-- Counted in rate_events (migration 35), stamped by the server: undoing a like
-- does not give it back, and a backdated swipe counts now. The trigger already
-- runs before every swipe insert; swipes can't be updated by members, so a pass
-- can't be turned into a like to get round it.

alter table public.app_settings
  add column date_likes_per_day int not null default 3 check (date_likes_per_day between 0 and 1000);

alter table public.rate_events drop constraint if exists rate_events_kind_check;
alter table public.rate_events
  add constraint rate_events_kind_check check (kind in ('swipe', 'report', 'message', 'date_like'));

-- How many Date-mode likes a member may make per rolling 24 hours.
create or replace function public.date_like_allowance(p_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce((select date_likes_per_day from app_settings limit 1), 3)
$$;
revoke all on function public.date_like_allowance(uuid) from public, anon, authenticated;

create or replace function public.rate_limit_swipes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_at := now();  -- the server's clock, whatever the client sent
  perform public.rate_limit_take('swipe', 500, interval '24 hours',
    'That''s plenty for one day. The deck will be here tomorrow.');
  if new.mode = 'date' and new.action in ('like', 'ace') then
    perform public.rate_limit_take('date_like', public.date_like_allowance(auth.uid()), interval '24 hours',
      'You''ve used today''s likes in Date mode. More tomorrow.');
  end if;
  return new;
end $$;

-- What the app shows: likes left in Date mode, and when the next one comes
-- back (the oldest like in the window turning 24 hours old). Only the caller's
-- own count; nothing about anyone else.
create or replace function public.get_my_date_likes()
returns table (allowance int, used int, remaining int, next_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  a int;
  u int;
  oldest timestamptz;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  a := public.date_like_allowance(me);
  select count(*), min(at) into u, oldest
    from rate_events
   where user_id = me and kind = 'date_like' and at > now() - interval '24 hours';
  return query select a, u, greatest(a - u, 0),
    case when u >= a and oldest is not null then oldest + interval '24 hours' end;
end $$;
revoke all on function public.get_my_date_likes() from public, anon;
grant execute on function public.get_my_date_likes() to authenticated;

-- ======================================================================
-- 20260806000045_rsvplay_plus_name.sql
-- ======================================================================
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

-- ======================================================================
-- 20260806000046_city_votes.sql
-- ======================================================================
-- RSVPlay — one city vote per phone number
--
-- The "Not on the list? Tell us where you play" buttons on the website only
-- counted on the visitor's own device: tap Chicago ten times, Chicago read 10,
-- and none of it ever reached us. The founder wants a real reading of demand:
-- one person, one city.
--
-- So a vote now needs a mobile number, and each number holds exactly ONE city
-- vote. Voting again with the same number moves that vote; it never adds a
-- second one. A visitor can also type a city that isn't on the list.
--
-- Privacy, same posture as the waitlist and the phone bans:
--   · The number is never stored. Only a one-way hash of it, used to tell a
--     repeat voter from a new one. Honest limit (as in banned_phones): phone
--     numbers are a small space, so the hash is a de-duplication key, not
--     secrecy; that is why nobody but the database owner can read the table.
--   · No oracle. cast_city_vote() answers the same whether the number is new
--     or has voted before, so the page cannot be used to ask "has this number
--     voted?".
--   · Admins see totals per city through city_vote_tally(), never the rows.
--
-- Abuse: the website has no sign-in, so someone could type made-up numbers.
-- Each network address may cast at most 10 votes a day (counted by a hash of
-- the address, kept two days). Text-message verification would close that
-- fully; it costs money per vote, so it is left for later.

create table public.city_votes (
  phone_hash text primary key,
  city text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.city_votes enable row level security;
revoke all on public.city_votes from anon, authenticated;

create table public.city_vote_events (
  source_hash text not null,
  at timestamptz not null default now()
);
create index city_vote_events_idx on public.city_vote_events (source_hash, at);
alter table public.city_vote_events enable row level security;
revoke all on public.city_vote_events from anon, authenticated;

-- A US/Canada mobile number, written any way (317-555-0142, (317) 555 0142,
-- +1 317 555 0142), as 11 digits starting with 1. Null if it isn't one.
create or replace function public.normalize_vote_phone(p_phone text)
returns text language plpgsql immutable set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(d) = 10 then d := '1' || d; end if;
  if d !~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then return null; end if;
  return d;
end
$$;
revoke all on function public.normalize_vote_phone(text) from public, anon, authenticated;

create or replace function public.cast_city_vote(p_phone text, p_city text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := public.normalize_vote_phone(p_phone);
  v_city text := left(regexp_replace(btrim(coalesce(p_city, '')), '\s+', ' ', 'g'), 60);
  v_hash text;
  v_source text;
begin
  if v_phone is null then
    raise exception 'invalid phone' using errcode = '22023',
      hint = 'Enter a 10-digit US mobile number.';
  end if;
  if v_city !~ '[[:alpha:]]' or length(v_city) < 2 then
    raise exception 'invalid city' using errcode = '22023',
      hint = 'Enter the city you play in.';
  end if;

  -- Per-network limit. PostgREST hands the request headers over as a setting;
  -- the first address in X-Forwarded-For is the visitor's.
  v_source := coalesce(
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
    'unknown');
  v_source := encode(sha256(convert_to('rsvplay:votesrc:' || btrim(v_source), 'UTF8')), 'hex');
  if (select count(*) from city_vote_events
        where source_hash = v_source and at > now() - interval '24 hours') >= 10 then
    raise exception 'too many votes' using errcode = '54000',
      hint = 'Too many votes from this network today. Try again tomorrow.';
  end if;
  insert into city_vote_events (source_hash) values (v_source);
  delete from city_vote_events where at < now() - interval '2 days';

  v_hash := encode(sha256(convert_to('rsvplay:vote:' || v_phone, 'UTF8')), 'hex');
  insert into city_votes (phone_hash, city) values (v_hash, v_city)
  on conflict (phone_hash) do update
    set city = excluded.city, updated_at = now();
  -- Deliberately no indication of whether that was a first vote or a change.
end
$$;
revoke all on function public.cast_city_vote(text, text) from public;
grant execute on function public.cast_city_vote(text, text) to anon, authenticated;

-- Totals for the admin desk. Cities typed differently ("chicago", "Chicago ")
-- count together; the most common spelling is shown.
create or replace function public.city_vote_tally()
returns table (city text, votes bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
    select mode() within group (order by v.city), count(*)
    from city_votes v
    group by lower(v.city)
    order by count(*) desc, 1;
end
$$;
revoke all on function public.city_vote_tally() from public, anon;
grant execute on function public.city_vote_tally() to authenticated;

commit;
