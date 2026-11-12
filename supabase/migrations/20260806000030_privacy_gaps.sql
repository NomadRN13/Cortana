-- 40/LOVE — closing the two privacy gaps logged on 2026-11-11
--
-- GAP 1. Other members' settings were readable through the API.
--   Migration 18 hid birthdates and coordinates but left 22 other profile
--   columns readable by any signed-in member, for every member who hadn't
--   blocked them: cities, modes, who they are looking for, age and distance
--   range, exact last-active time and more. The app displays none of them.
--   Someone with an account and a script could list who is in Date mode and
--   what they want, city by city.
--
--   Now only `id` and `first_name` stay readable column by column — the admin
--   desk joins first names onto reports and photos, and a row filter needs the
--   id. Everything a member is shown about someone else comes from a function
--   that decides what to hand over: the deck, get_profile_cards, and the
--   tournament lookups. Your own row comes from get_my_profile, as it already
--   did.
--
--   Writing had a hole of its own: the update policy only checked that the row
--   was yours, so a member could set any column on it — including clearing
--   their own suspension, marking themselves verified, or backdating
--   created_at. A trigger now refuses those changes from a member's session.
--   Functions that legitimately set them (suspend_member,
--   sync_phone_verification, set_my_location) run as the owner and pass.
--
--   get_profile_cards also tightens: nobody signed out can call it (it never
--   revoked the default grant to PUBLIC, so the public anon key and a member's
--   id were enough to get their card); a suspended member's card is no longer
--   handed out, matching the row policy; and it stops sending the city and the
--   exact last-active and verified timestamps, which no card shows. It gains
--   partner_gender and play_games, which cards do show — the app used to read
--   partner_gender straight from the table, the one direct read this closes.
--
-- GAP 2. Distance could be used to find where someone lives.
--   The deck returned distance to a tenth of a mile, and a member could write
--   any coordinates to their own profile as often as they liked. Three readings
--   from chosen spots recovered another member's stored ~1 km position. The
--   distance filter and the metro boundary leaked the same thing more slowly.
--
--   Now:
--   · Distance is worked out between the centres of a grid of squares about
--     2½ miles on a side (0.04° of latitude by 0.05° of longitude), never
--     between the stored points, and returned in whole miles. Two members in
--     the same square are "1 mile" apart. Moving around inside your own square
--     changes nothing anyone sees, so no amount of probing can place someone
--     more precisely than their square. The radius filter, the "close by"
--     score and the metro test all use the same squares.
--   · Members can no longer write their position directly. The app calls
--     set_my_location(), which checks it is a real place and lets you move to
--     a different square at most once every 6 hours; within that time a new
--     position is politely ignored and the old one stands.
--   · The deck returns at most 100 cards per call.
--   · A radius under 4 miles still covers your own square and its eight
--     neighbours, or people a few hundred yards away across a square's edge
--     would be hidden while someone 3 miles off in your own square showed.
--
-- FROM THE INDEPENDENT REVIEW (same kinds of leak, through the deck):
--   · The deck only shows people whose preferences fit you. A member who could
--     rewrite their own birthdate and gender at will could re-check the deck
--     after each change and read off another member's exact age range and who
--     they are looking for. Your birthdate is now fixed once your profile
--     exists (email support to correct it), and your gender can change freely
--     in the first hour, then at most once every 30 days.
--   · The deck no longer returns its matching score. Taking the parts you can
--     see away from it revealed who had already aced you and who was active
--     this week; ties were broken by last-active time. It still ranks by the
--     score, and breaks ties with an order that is fixed per viewer and says
--     nothing about anyone.
--   · Still possible, and logged as follow-ups: switching a doubles partner on
--     and off can hint at someone's Play/Friends partner preference; and
--     is_blocked()/is_suspended() answer for any two ids.

-- ---- columns ----
alter table public.profiles
  add column location_updated_at timestamptz,
  add column gender_updated_at timestamptz;

alter table public.profiles
  add constraint profiles_approx_on_earth
  check (approx_lat between -90 and 90 and approx_lng between -180 and 180);

-- ---- GAP 1: reading ----
-- Column privileges, explicitly, so nothing depends on how a table-level
-- revoke interacts with column grants.
revoke select (first_name, bio, city, availability_note, modes, radius_mi,
  age_min, age_max, same_sports_only, verified_at, last_active_at, created_at,
  gender, seeking, play_games, play_pref, friends_pref, phone_verified_at,
  is_team, partner_name, partner_gender, extra_cities)
  on public.profiles from authenticated;
revoke select on public.profiles from anon, authenticated;
grant select (id, first_name) on public.profiles to authenticated;

-- Other people, as much as a card shows and no more.
create or replace function public.get_profile_cards(p_ids uuid[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(card)), '[]'::jsonb)
  from (
    select
      p.id,
      p.first_name,
      extract(year from age(p.birthdate))::int as age,
      p.bio,
      p.availability_note,
      p.verified_at is not null as verified,
      p.gender,
      p.play_games,
      p.is_team,
      p.partner_name,
      case when p.is_team then p.partner_gender else null end as partner_gender,
      case when p.partner_birthdate is null then null
           else extract(year from age(p.partner_birthdate))::int end as partner_age,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sport', s.sport, 'level', s.level, 'rating_label', s.rating_label))
        from public.user_sports s where s.user_id = p.id
      ), '[]'::jsonb) as user_sports
    from public.profiles p
    where auth.uid() is not null
      and p.id = any(p_ids)
      -- Security definer bypasses RLS, so profiles_select's row filter is
      -- repeated here by hand: blocks either way, and suspended members —
      -- except that you always get your own card.
      and (p.id = auth.uid() or (
        not public.is_blocked(auth.uid(), p.id)
        and p.suspended_at is null
      ))
  ) card;
$$;

revoke all on function public.get_profile_cards(uuid[]) from public, anon;
grant execute on function public.get_profile_cards(uuid[]) to authenticated;

-- ---- GAP 1: writing ----
create or replace function public.profiles_guard_member_writes()
returns trigger
language plpgsql
as $$
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
     or new.gender_updated_at is distinct from old.gender_updated_at then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;

  -- Your birthdate is fixed once your profile exists. Matching filters on it,
  -- so changing it at will would let a member read other people's age ranges
  -- off the deck.
  if new.birthdate is distinct from old.birthdate then
    raise exception 'Your birthdate can''t be changed in the app. If it''s wrong, email hello@40love.app and we''ll fix it.'
      using errcode = '42501';
  end if;

  -- Gender: freely in the first hour (a mis-tap at signup), then once every
  -- 30 days, for the same reason — the deck's "who are they looking for" test
  -- runs on it.
  if new.gender is distinct from old.gender then
    if old.gender is not null
       and old.created_at < now() - interval '1 hour'
       and old.gender_updated_at is not null
       and old.gender_updated_at > now() - interval '30 days' then
      raise exception 'You can change this once every 30 days. If it''s wrong, email hello@40love.app and we''ll fix it.'
        using errcode = '42501';
    end if;
    if old.gender is not null and old.created_at < now() - interval '1 hour' then
      new.gender_updated_at := now();
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

create trigger profiles_guard_member_writes
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_member_writes();

revoke all on function public.profiles_guard_member_writes() from public, anon, authenticated;

-- ---- GAP 2: the grid ----
-- The centre of the square a point falls in. 0.04° of latitude is 2.8 miles;
-- 0.05° of longitude is 3.1 miles in Miami and 2.3 in Seattle.
create or replace function public.grid_lat(p numeric)
returns numeric language sql immutable
as $$ select floor(p / 0.04) * 0.04 + 0.02 $$;

create or replace function public.grid_lng(p numeric)
returns numeric language sql immutable
as $$ select floor(p / 0.05) * 0.05 + 0.025 $$;

revoke all on function public.grid_lat(numeric) from public, anon, authenticated;
revoke all on function public.grid_lng(numeric) from public, anon, authenticated;

-- ---- GAP 2: moving ----
create or replace function public.set_my_location(p_lat numeric, p_lng numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cur record;
  new_lat numeric(5, 2);
  new_lng numeric(5, 2);
  move_gap constant interval := interval '6 hours';
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That isn''t a place on the map.' using errcode = '22023';
  end if;
  -- The same rounding the phone does (about 1 km); the grid coarsens further.
  new_lat := round(p_lat, 2);
  new_lng := round(p_lng, 2);

  select approx_lat, approx_lng, location_updated_at into cur
    from profiles where id = me for update;
  if not found then
    raise exception 'Finish setting up your profile first.' using errcode = 'P0002';
  end if;

  -- Staying in the same square: nothing anyone can see changes, so it is
  -- always fine and doesn't use up the move.
  if cur.approx_lat is not null and cur.approx_lng is not null
     and grid_lat(cur.approx_lat) = grid_lat(new_lat)
     and grid_lng(cur.approx_lng) = grid_lng(new_lng) then
    update profiles set approx_lat = new_lat, approx_lng = new_lng where id = me;
    return jsonb_build_object('accepted', true, 'moved', false);
  end if;

  -- A different square: once every 6 hours. Otherwise the old position stands
  -- — the app carries on, and tries again next time it opens.
  if cur.approx_lat is not null and cur.location_updated_at is not null
     and cur.location_updated_at > now() - move_gap then
    return jsonb_build_object('accepted', false, 'moved', false,
                              'retry_after', cur.location_updated_at + move_gap);
  end if;

  update profiles
     set approx_lat = new_lat, approx_lng = new_lng, location_updated_at = now()
   where id = me;
  return jsonb_build_object('accepted', true, 'moved', true);
end
$$;

revoke all on function public.set_my_location(numeric, numeric) from public, anon;
grant execute on function public.set_my_location(numeric, numeric) to authenticated;

-- ---- GAP 2: the deck ----
-- Unchanged from 20260806000024 except: distance and metro are worked out
-- from grid squares and returned in whole miles; a radius under 4 covers your
-- square and its neighbours; play_games is on the card; the score is used to
-- rank but not returned, and ties are broken per viewer, not by last-active
-- time; p_limit is capped at 100. The return type changes, so drop and
-- recreate.
drop function if exists public.get_discovery_deck(public.app_mode, int);

create function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
returns table (
  user_id uuid,
  first_name text,
  age int,
  distance_mi numeric,
  sports jsonb,
  verified boolean,
  availability_note text,
  bio text,
  is_new boolean,
  is_team boolean,
  partner_name text,
  partner_age int,
  gender public.gender_identity,
  partner_gender public.gender_identity,
  play_games public.game_type[]
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      case
        -- in two different metros: the shared city is why they are here
        when g.my_metro is not null and g.their_metro is not null and g.my_metro <> g.their_metro then null
        -- too far apart to be local to each other, whatever metro they are in
        when g.miles > 100 then null
        -- whole miles between squares; the same square reads as 1 mile
        when g.miles is not null then greatest(1, round(g.miles))
        else null
      end as dist,
      exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ) as shared_sport,
      coalesce((
        select max(2 - least(2, abs(skill_rank(mine.level) - skill_rank(theirs.level))))
        from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ), 0) as skill_adj,
      exists (
        select 1 from swipes s
        where s.actor_id = p.id and s.target_id = me.id
          and s.mode = p_mode and s.action = 'ace'
      ) as aced_me
    from profiles p, me,
      lateral (
        select grid_lat(me.approx_lat) as my_lat, grid_lng(me.approx_lng) as my_lng,
               grid_lat(p.approx_lat) as their_lat, grid_lng(p.approx_lng) as their_lng
      ) sq,
      lateral (
        select
          miles_between(sq.my_lat, sq.my_lng, sq.their_lat, sq.their_lng) as miles,
          nearest_city(sq.my_lat, sq.my_lng) as my_metro,
          nearest_city(sq.their_lat, sq.their_lng) as their_metro
      ) g
    where p.id <> me.id
      -- city-first launch: you meet players who play in a city you play in
      and member_cities(p.city, p.extra_cities) && member_cities(me.city, me.extra_cities)
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      -- A suspended member is off the courts: out of everyone's deck, and
      -- their own deck is empty, so they cannot start anything new.
      and p.suspended_at is null
      and me.suspended_at is null
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      and (p_mode <> 'date' or (
        me.gender is not null and p.gender is not null
        and p.gender = any (me.seeking)
        and me.gender = any (p.seeking)
      ))
      and (p_mode <> 'play' or exists (
        select 1 from unnest(me.play_games) g
        where g = any (p.play_games)
          and (
            g = 'mixed_doubles'
            or (
              team_pref_ok(me.play_pref, p.gender, p.is_team, p.partner_gender)
              and team_pref_ok(p.play_pref, me.gender, me.is_team, me.partner_gender)
            )
          )
      ))
      and (p_mode <> 'friends' or (
        team_pref_ok(me.friends_pref, p.gender, p.is_team, p.partner_gender)
        and team_pref_ok(p.friends_pref, me.gender, me.is_team, me.partner_gender)
      ))
      and (not me.same_sports_only or exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ))
      and p.last_active_at > now() - interval '30 days'
  )
  ,
  -- radius under 4 still means "my square and the eight around it"
  reach as (
    select greatest(radius_mi, 4) as mi from me
  ),
  ranked as (
    select
      c.*,
      (
        (case when c.aced_me then 10 else 0 end)
        + (case when c.shared_sport then 3 else 0 end)
        + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
        + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
        + (case when c.dist is not null and c.dist <= (select mi from reach) / 2.0 then 1 else 0 end)
        + (case when c.verified_at is not null then 1 else 0 end)
      ) as rank_score
    from candidates c
    where c.dist is null or c.dist <= (select mi from reach)
  )
  select
    r.id,
    r.first_name,
    age_of(r.birthdate),
    r.dist,
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = r.id),
    r.verified_at is not null,
    r.availability_note,
    r.bio,
    r.created_at > now() - interval '7 days',
    r.is_team,
    r.partner_name,
    case when r.is_team then age_of(r.partner_birthdate) else null end,
    r.gender,
    case when r.is_team then r.partner_gender else null end,
    r.play_games
  from ranked r
  order by r.rank_score desc, md5(r.id::text || auth.uid()::text)
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.get_discovery_deck(public.app_mode, int) from public, anon;
grant execute on function public.get_discovery_deck(public.app_mode, int) to authenticated;
