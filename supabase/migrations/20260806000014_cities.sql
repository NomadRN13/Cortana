-- 40/LOVE — multi-city launch
--
-- "Indianapolis" was a hardcoded default in four places. This replaces it
-- with a real registry so opening a new city is a row, not a code change.
--
-- profiles.city and events.city now hold a city SLUG with a foreign key, so
-- a typo can't silently create a ghost city that nobody can be matched in.
--
-- Matching is scoped to the member's city. Distance alone very nearly does
-- this already (the nearest pair here, LA and San Diego, are ~120 miles
-- apart and the radius maxes out at 50) — but a member who denies location
-- has a NULL distance, and the deck deliberately keeps those people
-- visible. Without a city scope, that member would be shown players from
-- every city in the country.

create table public.cities (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  state text not null check (char_length(state) = 2),
  lat numeric(6, 3) not null,
  lng numeric(6, 3) not null,
  -- how far out the metro reasonably extends; used to place a new member
  metro_radius_mi int not null default 40 check (metro_radius_mi between 5 and 120),
  -- a city can exist in the registry before it opens to signups
  launched boolean not null default false,
  sort_order int not null default 100
);

insert into public.cities (slug, name, state, lat, lng, metro_radius_mi, launched, sort_order) values
  ('indianapolis', 'Indianapolis', 'IN', 39.768, -86.158, 40, true, 10),
  ('los-angeles',  'Los Angeles',  'CA', 34.052, -118.244, 60, true, 20),
  ('san-diego',    'San Diego',    'CA', 32.716, -117.161, 40, true, 30),
  ('phoenix',      'Phoenix',      'AZ', 33.448, -112.074, 50, true, 40),
  ('seattle',      'Seattle',      'WA', 47.606, -122.332, 40, true, 50),
  ('spokane',      'Spokane',      'WA', 47.659, -117.426, 35, true, 60),
  ('dallas',       'Dallas',       'TX', 32.777, -96.797, 50, true, 70),
  ('houston',      'Houston',      'TX', 29.760, -95.370, 50, true, 80),
  ('orlando',      'Orlando',      'FL', 28.538, -81.379, 40, true, 90),
  ('miami',        'Miami',        'FL', 25.762, -80.192, 45, true, 100),
  ('washington-dc','Washington',   'DC', 38.907, -77.037, 40, true, 110);

alter table public.cities enable row level security;
-- Everyone (including a signed-out landing page) may read the city list;
-- nobody may write it from a client. New cities are added by migration.
create policy cities_read on public.cities for select to anon, authenticated using (true);

-- ---- point the existing columns at the registry ----
update public.profiles set city = 'indianapolis' where city = 'Indianapolis';
update public.events   set city = 'indianapolis' where city = 'Indianapolis';

alter table public.profiles
  alter column city set default 'indianapolis',
  add constraint profiles_city_fkey foreign key (city) references public.cities (slug);

alter table public.events
  alter column city set default 'indianapolis',
  add constraint events_city_fkey foreign key (city) references public.cities (slug);

create index events_city_starts_idx on public.events (city, starts_at);

-- Where should a new member be placed? Nearest launched city whose metro
-- reaches them. Null when they're not near any of them yet — the app then
-- asks rather than guessing, and offers the waitlist.
create or replace function public.nearest_city(p_lat numeric, p_lng numeric)
returns text
language sql stable
as $$
  select c.slug
  from cities c
  where c.launched
    and p_lat is not null and p_lng is not null
    and miles_between(p_lat, p_lng, c.lat, c.lng) <= c.metro_radius_mi
  order by miles_between(p_lat, p_lng, c.lat, c.lng)
  limit 1
$$;

grant execute on function public.nearest_city(numeric, numeric) to anon, authenticated;

-- ---- scope discovery to the member's city ----
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
      -- city-first launch: you meet players in your own city
      and p.city = me.city
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
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
    case when c.is_team then age_of(c.partner_birthdate) else null end
  from candidates c
  where c.dist is null or c.dist <= (select radius_mi from me)
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;
