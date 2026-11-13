-- 40/LOVE — stop handing every member everyone else's birthdate and coordinates
--
-- profiles_select lets any signed-in member read any profile row that hasn't
-- blocked them. Row-level security is row-level: it says WHICH rows, never
-- WHICH COLUMNS. So a member could ask PostgREST for
--
--     /rest/v1/profiles?select=first_name,birthdate,approx_lat,approx_lng
--
-- and get the exact date of birth and home location of every member of the app.
--
-- Both are things the product goes out of its way to protect everywhere else:
-- the privacy policy says "your birthdate is never shown to other members —
-- only your age", and get_discovery_deck deliberately returns a distance rather
-- than coordinates. The table was quietly undoing both. For a dating app, a
-- ~1km home location for every member, available to anyone who signs up, is a
-- stalking vector rather than a privacy nitpick.
--
-- Column privileges are the fix. Note that a column-level REVOKE is a no-op
-- while the role still holds table-level SELECT — Postgres checks the table
-- grant first and stops there. The table grant has to go, and the readable
-- columns be granted back by name.

revoke select on public.profiles from anon, authenticated;

-- Everything except birthdate, partner_birthdate, approx_lat and approx_lng.
-- Adding a column to profiles means adding it here too, or the app cannot read
-- it; supabase/tests/backend.sql §9g fails on any column that is in neither
-- list, so this cannot drift silently in either direction.
grant select (
  id, first_name, bio, city, availability_note, modes, radius_mi,
  age_min, age_max, same_sports_only, verified_at, last_active_at, created_at,
  gender, seeking, play_games, play_pref, friends_pref, phone_verified_at,
  is_team, partner_name, partner_gender
) on public.profiles to authenticated;

-- Writing is unaffected: INSERT and UPDATE privileges are separate from SELECT,
-- so members still set their own birthdate and rounded position at signup.

-- Your own profile, whole. Runs as owner, so the revoke above doesn't apply;
-- the where clause is what keeps it to you, and it is the only thing that does.
create or replace function public.get_my_profile()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object(
    'user_sports',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sport', s.sport, 'level', s.level, 'rating_label', s.rating_label))
      from public.user_sports s where s.user_id = p.id
    ), '[]'::jsonb))
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Other people, as much as a match card needs and no more. Ages, not
-- birthdates; no coordinates at all — distance comes from the deck, which
-- computes it without ever handing over a position.
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
      p.city,
      p.availability_note,
      p.verified_at,
      p.last_active_at,
      p.gender,
      p.is_team,
      p.partner_name,
      case when p.partner_birthdate is null then null
           else extract(year from age(p.partner_birthdate))::int end as partner_age,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sport', s.sport, 'level', s.level, 'rating_label', s.rating_label))
        from public.user_sports s where s.user_id = p.id
      ), '[]'::jsonb) as user_sports
    from public.profiles p
    where p.id = any(p_ids)
      -- Security definer bypasses RLS, so the block filter that profiles_select
      -- would have applied has to be repeated here by hand.
      and not public.is_blocked(auth.uid(), p.id)
  ) card;
$$;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_profile_cards(uuid[]) to authenticated;
