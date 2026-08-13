-- 40/Love — doubles team profiles (two people, one profile)
--
-- A pair who always play together can share a single profile: both names on
-- the card, one inbox, one set of preferences. Deliberate limits:
--
--  * TWO people, no more. `partner_*` columns rather than a join table —
--    the cap is the point, and a table would invite three.
--  * Teams are for PLAY and FRIENDS, never DATE. A shared profile in a
--    dating context is confusing at best and a safety problem at worst
--    (you cannot verify who you're actually talking to). Enforced by a
--    check constraint, not just hidden in the UI.
--  * Both people must be 18+, same as any member.
--  * The partner is described, not enrolled — they don't get their own
--    login. The account holder is accountable for the profile, which keeps
--    reports, blocks, and bans meaningful.
--
-- Matching: a preference applies to EVERY person on a team. "I want to play
-- doubles with women" plus a team of a man and a woman is not a fit — you'd
-- be playing with a man too. Both directions, both members.

alter table public.profiles
  add column is_team boolean not null default false,
  add column partner_name text not null default '' check (char_length(partner_name) <= 40),
  add column partner_birthdate date,
  add column partner_gender public.gender_identity;

alter table public.profiles
  -- a team needs a second person, and that person needs to be an adult
  add constraint profiles_team_complete check (
    not is_team or (
      char_length(trim(partner_name)) > 0
      and partner_birthdate is not null
      and partner_birthdate <= (current_date - interval '18 years')::date
    )
  ),
  -- teams never appear in Date mode
  add constraint profiles_team_not_dating check (
    not is_team or not ('date' = any (modes))
  );

-- Does `pref` accept everyone on this profile? For a solo profile that's
-- just their gender; for a team it must hold for both people.
create or replace function public.team_pref_ok(
  pref public.partner_pref,
  p_gender public.gender_identity,
  p_is_team boolean,
  p_partner_gender public.gender_identity
)
returns boolean
language sql immutable
as $$
  select pref_ok(pref, p_gender)
     and (not coalesce(p_is_team, false) or pref_ok(pref, p_partner_gender))
$$;

grant execute on function public.team_pref_ok(public.partner_pref, public.gender_identity, boolean, public.gender_identity) to authenticated;

-- Rebuild the deck so Play/Friends honor every member of a team, and so the
-- card has what it needs to show both names. The signature is unchanged but
-- the OUT columns grow, which `create or replace` cannot do — drop first.
drop function if exists public.get_discovery_deck(public.app_mode, int);

create or replace function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
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
  score int,
  is_team boolean,
  partner_name text,
  partner_age int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as dist,
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
    from profiles p, me
    where p.id <> me.id
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      -- Date mode: mutual gender fit. (Teams can't be in Date mode at all —
      -- the check constraint keeps them out — so no team logic is needed here.)
      and (p_mode <> 'date' or (
        me.gender is not null and p.gender is not null
        and p.gender = any (me.seeking)
        and me.gender = any (p.seeking)
      ))
      -- Play mode: a shared game type; singles/doubles honor both sides'
      -- play-with preference across every member; mixed doubles is open.
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
      -- Friends mode: mutual meet preference, across every member
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
  select
    c.id,
    c.first_name,
    age_of(c.birthdate),
    round(c.dist, 1),
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = c.id),
    c.verified_at is not null,
    c.availability_note,
    c.bio,
    c.created_at > now() - interval '7 days',
    (
      (case when c.aced_me then 10 else 0 end)
      + (case when c.shared_sport then 3 else 0 end)
      + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
      + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
      + (case when c.dist is not null and c.dist <= (select radius_mi from me) / 2.0 then 1 else 0 end)
      + (case when c.verified_at is not null then 1 else 0 end)
    )::int,
    c.is_team,
    c.partner_name,
    case when c.is_team then age_of(c.partner_birthdate) else null end
  from candidates c
  where c.dist is null or c.dist <= (select radius_mi from me)
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;
