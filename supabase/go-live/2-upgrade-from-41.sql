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

commit;
