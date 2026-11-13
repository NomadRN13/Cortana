-- RSVPlay — a member can play in more than one city
--
-- Until now a profile had exactly one city, and both matching and meetups hung
-- off it. Plenty of players split their time — Seattle and Spokane, LA and San
-- Diego, a snowbird in Indianapolis and Orlando — and had to flip a setting
-- back and forth to see either half of their life.
--
-- profiles.city stays: it is the member's HOME city, still a foreign key, still
-- what a profile card says. extra_cities holds any others they also play in.
-- Everything that used to ask "same city?" now asks "any city in common?".
--
-- An array can't carry a foreign key, so a trigger does the job the FK does for
-- the home city: an unknown slug is refused rather than quietly creating a
-- ghost city nobody can be matched in. It also keeps the list tidy — no
-- duplicates, and never the home city a second time — so "how many cities" is
-- a number the app can trust.

alter table public.profiles
  add column extra_cities text[] not null default '{}';

create or replace function public.clean_extra_cities()
returns trigger
language plpgsql
as $$
declare
  bad text;
begin
  if new.extra_cities is null then
    new.extra_cities := '{}';
  end if;

  select s into bad
  from unnest(new.extra_cities) as s
  where not exists (select 1 from public.cities c where c.slug = s)
  limit 1;
  if bad is not null then
    raise exception 'unknown city: %', bad using errcode = '23503';
  end if;

  -- de-duplicate, drop the home city, keep the order they were chosen in
  select coalesce(array_agg(s order by first_at), '{}') into new.extra_cities
  from (
    select s, min(ord) as first_at
    from unnest(new.extra_cities) with ordinality as t(s, ord)
    where s <> new.city
    group by s
  ) d;

  return new;
end;
$$;

create trigger profiles_clean_extra_cities
  before insert or update of city, extra_cities on public.profiles
  for each row execute function public.clean_extra_cities();

-- Every city a member plays in: home first, then the rest.
create or replace function public.member_cities(p_city text, p_extra text[])
returns text[]
language sql immutable
as $$
  select array[p_city] || coalesce(p_extra, '{}')
$$;

grant execute on function public.member_cities(text, text[]) to authenticated;

-- Readable like city itself is (see 20260806000018 — a profiles column must be
-- either granted or deliberately withheld, and the suite fails on one that is
-- neither).
grant select (extra_cities) on public.profiles to authenticated;

-- ---- the deck ----
-- Three changes from the version in 20260806000023:
--
-- 1. Any city in common, instead of the same single city.
--
-- 2. Distance only means something inside one metro. The radius filter at the
--    bottom used to be safe because everyone in the deck was in your city. Now
--    a member in Indianapolis who also plays in Seattle has Seattle players in
--    their deck, 1,900 miles from where their phone is — and the radius tops
--    out at 50. Left alone, the filter would throw away every one of them and
--    the second city would do nothing. So the distance counts only between
--    people who are local to each other: when the two are placed in different
--    metros, or are more than 100 miles apart (no metro reaches further than
--    60), it is unknown — exactly as it already is for a member who denies
--    location — and the city overlap above is what scopes the pair. Inside
--    one metro nothing changes: someone in your city but beyond your radius
--    still stays out.
--
-- 3. The card carries gender (and, for a doubles team, the partner's), so a
--    profile says who it is while you are choosing, not only after you match.
--    Both were already readable column by column (20260806000018); this just
--    puts them on the row the deck is drawn from.
--
-- The return type changes, which `create or replace` refuses to do, so the
-- function is dropped and created again — and the grant with it.
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
  score int,
  is_team boolean,
  partner_name text,
  partner_age int,
  gender public.gender_identity,
  partner_gender public.gender_identity
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
        else g.miles
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
        select
          miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as miles,
          nearest_city(me.approx_lat, me.approx_lng) as my_metro,
          nearest_city(p.approx_lat, p.approx_lng) as their_metro
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
    case when c.is_team then age_of(c.partner_birthdate) else null end,
    c.gender,
    case when c.is_team then c.partner_gender else null end
  from candidates c
  where c.dist is null or c.dist <= (select radius_mi from me)
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

grant execute on function public.get_discovery_deck(public.app_mode, int) to authenticated;
