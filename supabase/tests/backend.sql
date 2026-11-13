-- RSVPlay backend verification suite.
--
--   ./scripts/test-backend.sh
--
-- Runs against a throwaway local Postgres. Supabase's auth schema, its roles
-- and the parts of storage the backend touches are shimmed, then every
-- migration and the seed are applied and the backend's behaviour is asserted:
-- matching, the discovery deck, court-time proposals, blocking, photo
-- moderation, account deletion, and every row-level security policy.
--
-- The docs claim this backend is verified; this file is what makes that true.
-- Add to it whenever you add a migration.
\set ON_ERROR_STOP on

-- ---- Supabase shim ----
do $$ begin
  begin create role anon nologin; exception when duplicate_object then null; end;
  begin create role authenticated nologin; exception when duplicate_object then null; end;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text unique, phone text, phone_confirmed_at timestamptz, created_at timestamptz default now());
-- Enough of Supabase storage to exercise the photo bucket's policies and to
-- prove delete_account() purges photo rows. The real tables have more columns;
-- the migrations only ever touch these.
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;
-- Supabase's own definition: everything before the last '/' in the key.
create function storage.foldername(name text) returns text[]
language sql immutable as $fn$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$fn$;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Supabase grants broad table privileges and relies on RLS; mirror that. These
-- go in BEFORE the migrations, via default privileges, because that is the real
-- order: the grants exist on a fresh project and migrations run on top. Doing
-- it the other way round — a blanket grant afterwards — would silently undo any
-- column-level revoke a migration makes, and the suite would pass on a
-- permission the real database doesn't have.
grant usage on schema public, auth, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema storage grant all on tables to anon, authenticated;
-- Supabase also grants EXECUTE on every new function in public to anon and
-- authenticated by default. Without mirroring that, a function whose migration
-- revoked only from PUBLIC looks locked down here and is callable by anon on
-- a real project.
alter default privileges in schema public grant execute on functions to anon, authenticated;

\i :migrations

-- Migration 39 requires a verified phone before a member can swipe, message,
-- RSVP, enter a tournament or join a ladder. The suites below predate it and
-- create members without one, so it is switched off here and switched ON for
-- its own test (10c-ii). Only the database owner can touch this switch.
update public.app_settings set require_verified_phone = false;

grant all on all tables in schema storage to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

\i :seed

-- ---- Constants ----
\set aaron '''00000000-0000-4000-8000-00000000000a'''
\set maya  '''00000000-0000-4000-8000-000000000001'''
\set diego '''00000000-0000-4000-8000-000000000002'''
\set priya '''00000000-0000-4000-8000-000000000003'''
\set sam   '''00000000-0000-4000-8000-000000000004'''
\set theo  '''00000000-0000-4000-8000-000000000009'''
\set jordan '''00000000-0000-4000-8000-000000000007'''

-- ---- 1. Seed created 3 matches + 6 match notifications via trigger ----
do $$
declare c int;
begin
  select count(*) into c from matches;
  assert c = 3, format('expected 3 seeded matches, got %s', c);
  select count(*) into c from notifications where kind = 'match';
  assert c = 6, format('expected 6 match notifications, got %s', c);
end $$;

-- ---- 2. Discovery deck for Aaron (date mode) ----
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare
  deck record;
  n int := 0;
  ids uuid[] := '{}';
begin
  for deck in select * from get_discovery_deck('date', 50) loop
    n := n + 1;
    ids := ids || deck.user_id;
    assert deck.distance_mi <= 15, format('%s beyond radius: %s', deck.first_name, deck.distance_mi);
    assert deck.age between 25 and 55, format('%s outside age prefs: %s', deck.first_name, deck.age);
  end loop;
  assert n > 0, 'deck is empty';
  -- already-matched users must not reappear
  assert not ('00000000-0000-4000-8000-000000000001' = any(ids)), 'Maya already swiped, still in deck';
  assert not ('00000000-0000-4000-8000-000000000004' = any(ids)), 'Sam already swiped, still in deck';
  -- Theo: 58 (outside 25-55) and no date mode → must be excluded
  assert not ('00000000-0000-4000-8000-000000000009' = any(ids)), 'Theo should be filtered';
  -- Gender matching (Aaron: man seeking women). Men must not appear...
  assert not ('00000000-0000-4000-8000-000000000002' = any(ids)), 'Diego (man) in date deck of man-seeking-women';
  assert not ('00000000-0000-4000-8000-000000000006' = any(ids)), 'Marcus (man) in date deck of man-seeking-women';
  assert not ('00000000-0000-4000-8000-000000000011' = any(ids)), 'Chris (man) in date deck of man-seeking-women';
  -- ...and neither must Lena: she is a woman seeking women, so the fit is not mutual
  assert not ('00000000-0000-4000-8000-000000000012' = any(ids)), 'Lena (seeking women) shown to a man';
  -- women seeking men DO appear
  assert '00000000-0000-4000-8000-000000000010' = any(ids), 'Nadia (woman seeking men+women) missing from date deck';
  -- Jordan shares two sports at same level, active, verified → expect top-3
  assert ids[1] = '00000000-0000-4000-8000-000000000007'
      or ids[2] = '00000000-0000-4000-8000-000000000007'
      or ids[3] = '00000000-0000-4000-8000-000000000007', 'Jordan not near top of ranked deck';
  raise notice 'deck for Aaron: % candidates', n;
end $$;

-- ---- 2b. Play mode: dating prefs don't leak; game-type + play-with prefs apply ----
do $$
declare ids uuid[] := '{}'; r record;
begin
  for r in select * from get_discovery_deck('play', 50) loop ids := ids || r.user_id; end loop;
  -- Chris (man, open defaults): dating preference must NOT leak into Play
  assert '00000000-0000-4000-8000-000000000011' = any(ids), 'Chris (man) missing from play deck — dating filter leaked into Play mode';
  assert '00000000-0000-4000-8000-000000000007' = any(ids), 'Jordan missing from play deck';
  -- Lena wants women''s singles only; Aaron is a man → incompatible
  assert not ('00000000-0000-4000-8000-000000000012' = any(ids)), 'Lena (women''s singles only) shown to a man in Play mode';
  -- Grace plays doubles+mixed with women, but mixed doubles is open by nature → compatible
  assert '00000000-0000-4000-8000-000000000008' = any(ids), 'Grace (mixed doubles) missing — mixed-doubles openness broken';
end $$;

-- ---- 2c. Friends mode: mutual meet preference ----
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego (date+friends)
do $$
declare ids uuid[] := '{}'; r record;
begin
  for r in select * from get_discovery_deck('friends', 50) loop ids := ids || r.user_id; end loop;
  assert '00000000-0000-4000-8000-000000000010' = any(ids), 'Nadia missing from Diego''s friends deck';
  -- Elena''s friends preference is women; Diego is a man → excluded
  assert not ('00000000-0000-4000-8000-000000000005' = any(ids)), 'Elena (friends: women) shown to a man in Friends mode';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';

-- ---- 2d. Phone verification: RPC only trusts auth's own confirmation ----
do $$
declare ok boolean;
begin
  ok := sync_phone_verification();
  assert not ok, 'phone marked verified without auth confirmation';
  assert (select phone_verified_at from profiles where id = auth.uid()) is null, 'flag set prematurely';
  update auth.users set phone = '+13175550142', phone_confirmed_at = now() where id = auth.uid();
  ok := sync_phone_verification();
  assert ok, 'phone verification not synced after auth confirmation';
  assert (select phone_verified_at from profiles where id = auth.uid()) is not null, 'flag missing after sync';
end $$;

-- ---- 2e. Team profiles: two people, one profile; never in Date mode ----
reset role;
do $$
declare ok boolean;
begin
  -- a team must name a second person, and that person must be 18+
  begin
    update profiles set is_team = true where id = '00000000-0000-4000-8000-000000000008';
    assert false, 'team flag accepted with no partner named';
  exception when check_violation then null;
  end;
  begin
    update profiles
    set is_team = true, partner_name = 'Kid', partner_birthdate = (current_date - interval '15 years')::date,
        partner_gender = 'man'
    where id = '00000000-0000-4000-8000-000000000008';
    assert false, 'team accepted an under-18 partner';
  exception when check_violation then null;
  end;
  -- a team may not be in Date mode
  begin
    update profiles
    set is_team = true, partner_name = 'Rosa', partner_birthdate = '1991-04-02', partner_gender = 'woman',
        modes = array['date','play']::app_mode[]
    where id = '00000000-0000-4000-8000-000000000008';
    assert false, 'team allowed into Date mode';
  exception when check_violation then null;
  end;
end $$;

-- Grace + Rosa become a women's doubles team (Play + Friends only)
update profiles
set is_team = true, partner_name = 'Rosa', partner_birthdate = '1991-04-02', partner_gender = 'woman',
    modes = array['play','friends']::app_mode[]
where id = '00000000-0000-4000-8000-000000000008';

-- team_pref_ok: a preference must hold for EVERY member
do $$
begin
  assert team_pref_ok('women', 'woman', true, 'woman'), 'all-women team rejected by women-only pref';
  assert not team_pref_ok('women', 'woman', true, 'man'), 'mixed team accepted by women-only pref';
  assert team_pref_ok('everyone', 'woman', true, 'man'), 'everyone pref rejected a mixed team';
  assert team_pref_ok('women', 'woman', false, null), 'solo woman rejected by women-only pref';
end $$;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'; -- Aaron (man)
do $$
declare r record; found boolean := false; n_team int := 0;
begin
  -- Aaron plays mixed doubles, which is open by nature → the women's team is
  -- still a fit, and the card carries both names.
  for r in select * from get_discovery_deck('play', 50) loop
    if r.user_id = '00000000-0000-4000-8000-000000000008' then
      found := true;
      assert r.is_team, 'team flag missing on the deck row';
      assert r.partner_name = 'Rosa', format('partner name wrong: %s', r.partner_name);
      assert r.partner_age is not null, 'partner age missing';
    end if;
    if r.is_team then n_team := n_team + 1; end if;
  end loop;
  assert found, 'team missing from play deck (mixed doubles is open to everyone)';
end $$;

-- Narrow Aaron to men-only, non-mixed play: the all-women team must drop out
update profiles
set play_pref = 'men', play_games = array['doubles']::game_type[]
where id = '00000000-0000-4000-8000-00000000000a';
do $$
declare r record; found boolean := false;
begin
  for r in select * from get_discovery_deck('play', 50) loop
    if r.user_id = '00000000-0000-4000-8000-000000000008' then found := true; end if;
  end loop;
  assert not found, 'women''s team shown to a men-only doubles preference';
end $$;
-- restore Aaron for the tests that follow
update profiles
set play_pref = 'everyone', play_games = array['singles','doubles','mixed_doubles']::game_type[]
where id = '00000000-0000-4000-8000-00000000000a';
reset role;

-- ---- 2f. Cities: registry, placement, and city-scoped matching ----
reset role;
do $$
declare c int; v text;
begin
  select count(*) into c from cities where launched;
  assert c >= 11, format('expected 11+ launched cities, got %s', c);
  -- placement: a point in downtown Seattle lands in Seattle, not Spokane
  v := nearest_city(47.61, -122.33);
  assert v = 'seattle', format('Seattle coords placed in %s', v);
  v := nearest_city(47.66, -117.43);
  assert v = 'spokane', format('Spokane coords placed in %s', v);
  v := nearest_city(34.05, -118.24);
  assert v = 'los-angeles', format('LA coords placed in %s', v);
  -- Bakersfield is its own city: downtown lands there, and neither it nor LA
  -- swallows the other (they are ~110 miles apart)
  v := nearest_city(35.37, -119.02);
  assert v = 'bakersfield', format('Bakersfield coords placed in %s', v);
  select count(*) into c from cities where launched;
  assert c >= 12, format('expected 12+ launched cities, got %s', c);
  -- middle of the Pacific belongs to no city — the app must ask, not guess
  v := nearest_city(35.0, -150.0);
  assert v is null, format('open ocean placed in %s', v);
  v := nearest_city(null, null);
  assert v is null, 'null coords placed somewhere';
  -- a city slug must exist; typos can't create ghost cities
  begin
    update profiles set city = 'atlantis' where id = '00000000-0000-4000-8000-000000000001';
    assert false, 'unknown city slug accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Move Maya to Los Angeles and clear her coordinates, which is what a
-- location-denied member looks like. She must vanish from the Indy deck.
update profiles
set city = 'los-angeles', approx_lat = null, approx_lng = null
where id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'; -- Aaron, Indianapolis
do $$
declare ids uuid[] := '{}'; r record;
begin
  for r in select * from get_discovery_deck('play', 50) loop ids := ids || r.user_id; end loop;
  assert not ('00000000-0000-4000-8000-000000000001' = any(ids)),
    'an out-of-city member with no location leaked into the deck';
  assert array_length(ids, 1) > 0, 'city scoping emptied the deck entirely';
end $$;
reset role;

-- ---- 2f-ii. A member can play in more than one city ----
-- Maya is still in Los Angeles with no coordinates. Aaron adds Los Angeles as
-- a second city: now they have a city in common and she must be in his deck.
update profiles set extra_cities = array['los-angeles']
where id = '00000000-0000-4000-8000-00000000000a';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'; -- Aaron, Indianapolis + Los Angeles
do $$
declare ids uuid[] := '{}'; r record;
begin
  for r in select * from get_discovery_deck('play', 50) loop ids := ids || r.user_id; end loop;
  assert '00000000-0000-4000-8000-000000000001' = any(ids),
    'adding a second city did not bring that city''s players into the deck';
end $$;
reset role;
-- The case that matters in real life: she HAS a location, and it is in Los
-- Angeles, 1,800 miles from Aaron's phone and far outside any radius. The
-- radius must not be what decides this — the shared city is. Her distance comes
-- back unknown rather than as a four-digit number of miles.
update profiles set approx_lat = 34.05, approx_lng = -118.24
where id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare r record; found boolean := false;
begin
  assert (get_my_profile() ->> 'approx_lat') is not null,
    'test setup: Aaron needs a location for this to prove anything';
  for r in select * from get_discovery_deck('play', 50) loop
    if r.user_id = '00000000-0000-4000-8000-000000000001' then
      found := true;
      assert r.distance_mi is null,
        format('a player in another metro came back %s miles away instead of unknown', r.distance_mi);
      assert r.gender is not null, 'the deck row carries no gender';
    end if;
  end loop;
  assert found, 'a player in my second city was dropped by the distance filter';
end $$;
reset role;
-- ...while inside one metro the radius still does its job: someone in my own
-- city but beyond my radius stays out.
update profiles set city = 'indianapolis', extra_cities = '{}', approx_lat = 40.60, approx_lng = -86.16
where id = '00000000-0000-4000-8000-000000000001';   -- ~57 miles north of downtown Indianapolis
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare ids uuid[] := '{}'; r record; rad int;
begin
  rad := (get_my_profile() ->> 'radius_mi')::int;
  for r in select * from get_discovery_deck('play', 50) loop ids := ids || r.user_id; end loop;
  if rad < 57 then
    assert not ('00000000-0000-4000-8000-000000000001' = any(ids)),
      'the radius stopped applying inside a single metro';
  end if;
end $$;
reset role;
update profiles set city = 'los-angeles', approx_lat = null, approx_lng = null
where id = '00000000-0000-4000-8000-000000000001';

-- ...and it works from the other side: Aaron back to one city, Maya (home LA)
-- adds Indianapolis as her extra. A city in common is a city in common,
-- whichever of the two lists it sits in.
update profiles set extra_cities = '{}' where id = '00000000-0000-4000-8000-00000000000a';
update profiles set extra_cities = array['indianapolis'] where id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare ids uuid[] := '{}'; r record;
begin
  for r in select * from get_discovery_deck('play', 50) loop ids := ids || r.user_id; end loop;
  assert '00000000-0000-4000-8000-000000000001' = any(ids),
    'a member whose EXTRA city is mine is missing from my deck';
end $$;
reset role;
-- The list is kept honest by the database, not by the app.
do $$
declare got text[];
begin
  begin
    update profiles set extra_cities = array['atlantis'] where id = '00000000-0000-4000-8000-000000000001';
    assert false, 'unknown slug accepted in extra_cities';
  exception when foreign_key_violation then null;
  end;
  -- duplicates collapse, the home city is never listed twice, order is kept
  update profiles set extra_cities = array['seattle', 'los-angeles', 'seattle', 'indianapolis']
  where id = '00000000-0000-4000-8000-000000000001';
  select extra_cities into got from profiles where id = '00000000-0000-4000-8000-000000000001';
  assert got = array['seattle', 'indianapolis'],
    format('extra_cities not cleaned: %s', got);
  -- moving home to a city already in the list takes it out of the list
  update profiles set city = 'seattle' where id = '00000000-0000-4000-8000-000000000001';
  select extra_cities into got from profiles where id = '00000000-0000-4000-8000-000000000001';
  assert got = array['indianapolis'],
    format('home city left in extra_cities after a move: %s', got);
end $$;
-- A member with no city in common still sees nobody from elsewhere.
update profiles set city = 'los-angeles', extra_cities = array['seattle']
where id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare ids uuid[] := '{}'; r record;
begin
  for r in select * from get_discovery_deck('play', 50) loop ids := ids || r.user_id; end loop;
  assert not ('00000000-0000-4000-8000-000000000001' = any(ids)),
    'a member with no city in common leaked into the deck';
end $$;
reset role;

-- put Maya back so later tests are unaffected
update profiles
set city = 'indianapolis', extra_cities = '{}', approx_lat = 39.78, approx_lng = -86.16
where id = '00000000-0000-4000-8000-000000000001';

-- ---- 2g. Devices: remembered, listable, and revocable for real ----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare ok boolean; c int; v_id uuid; v_seen timestamptz;
begin
  -- a device registers itself on first launch
  ok := touch_device('aarons-iphone-key-01', 'Aaron''s iPhone', 'ios');
  assert ok, 'device could not register';
  select count(*) into c from devices where user_id = auth.uid();
  assert c = 1, format('expected 1 device, got %s', c);
  -- launching again refreshes last-seen instead of duplicating
  select last_seen_at into v_seen from devices where device_key = 'aarons-iphone-key-01';
  perform pg_sleep(0.01);
  ok := touch_device('aarons-iphone-key-01', 'Aaron''s iPhone', 'ios');
  assert ok, 'second launch rejected';
  select count(*) into c from devices where user_id = auth.uid();
  assert c = 1, 'relaunch created a duplicate device row';
  assert (select last_seen_at from devices where device_key = 'aarons-iphone-key-01') > v_seen,
    'last_seen_at not refreshed on relaunch';
  -- a junk key is refused rather than stored
  ok := touch_device('short', 'x', 'ios');
  assert not ok, 'too-short device key accepted';
  -- second device
  ok := touch_device('aarons-ipad-key-002', 'Aaron''s iPad', 'ios');
  assert ok, 'second device could not register';
  -- its push token is linked to it
  insert into push_tokens (user_id, token, platform, device_key)
  values (auth.uid(), 'ExponentPushToken[ipad-token]', 'ios', 'aarons-ipad-key-002');

  -- revoke the iPad from the iPhone
  select id into v_id from devices where device_key = 'aarons-ipad-key-002';
  ok := revoke_device(v_id);
  assert ok, 'revoke failed';
  assert (select revoked_at from devices where id = v_id) is not null, 'revoked_at not set';
  select count(*) into c from push_tokens where user_id = auth.uid() and device_key = 'aarons-ipad-key-002';
  assert c = 0, 'revoked device kept its push token — it would keep getting notifications';
  -- the other device's token survives
  select count(*) into c from push_tokens where user_id = auth.uid();
  assert c = 0, format('unexpected leftover tokens: %s', c);

  -- the revoked device cannot quietly sign itself back in
  ok := touch_device('aarons-ipad-key-002', 'Aaron''s iPad', 'ios');
  assert not ok, 'a revoked device re-registered itself';
  assert (select revoked_at from devices where id = v_id) is not null, 'revocation was cleared by touch';
  -- revoking twice is a no-op, not an error
  ok := revoke_device(v_id);
  assert not ok, 'double revoke reported success';
end $$;

-- one member cannot see or revoke another's devices
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
do $$
declare c int; ok boolean; v_id uuid;
begin
  select count(*) into c from devices;
  assert c = 0, 'devices of another member are visible';
  -- grab the id out of band (RLS hides it) and try anyway
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
  select id into v_id from devices where device_key = 'aarons-iphone-key-01';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
  ok := revoke_device(v_id);
  assert not ok, 'revoked someone else''s device';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
  assert (select revoked_at from devices where id = v_id) is null, 'another member revoked my device';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
reset role;

-- ---- 3. Ace creates an instant match ----
insert into swipes (actor_id, target_id, mode, action)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000007', 'date', 'ace');
do $$
declare c int;
begin
  select count(*) into c from matches
  where '00000000-0000-4000-8000-000000000007' in (user_a, user_b);
  assert c = 1, 'ace did not create instant match';
end $$;

-- ---- 4. One-sided like does NOT match; reciprocal like completes it ----
insert into swipes (actor_id, target_id, mode, action)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000002', 'date', 'like');
do $$
declare c int;
begin
  select count(*) into c from matches where '00000000-0000-4000-8000-000000000002' in (user_a, user_b);
  assert c = 0, 'one-sided like created a match';
end $$;
insert into swipes (actor_id, target_id, mode, action)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'date', 'like');
do $$
declare c int;
begin
  select count(*) into c from matches where '00000000-0000-4000-8000-000000000002' in (user_a, user_b);
  assert c = 1, 'reciprocal like did not create match';
end $$;

-- ---- 4b. Undo swipe: unmessaged match dissolves; conversations survive ----
do $$
declare ok boolean; c int; v_match uuid;
begin
  -- Aaron ↔ Sam have seeded messages → undo must refuse and change nothing
  ok := undo_swipe('00000000-0000-4000-8000-000000000004', 'date');
  assert not ok, 'undo allowed on a match with messages';
  select count(*) into c from matches
  where '00000000-0000-4000-8000-000000000004' in (user_a, user_b) and closed_at is null;
  assert c = 1, 'messaged match deleted by a refused undo';
  -- Aaron ↔ Diego just matched (test 4), no messages → undo dissolves it
  select id into v_match from matches where '00000000-0000-4000-8000-000000000002' in (user_a, user_b);
  ok := undo_swipe('00000000-0000-4000-8000-000000000002', 'date');
  assert ok, 'undo refused on an unmessaged match';
  select count(*) into c from matches where '00000000-0000-4000-8000-000000000002' in (user_a, user_b);
  assert c = 0, 'match not dissolved by undo';
  select count(*) into c from notifications where payload->>'match_id' = v_match::text;
  assert c = 0, 'match notifications not cleaned up by undo';
  select count(*) into c from swipes
  where actor_id = auth.uid() and target_id = '00000000-0000-4000-8000-000000000002' and mode = 'date';
  assert c = 0, 'undone swipe still recorded';
  select count(*) into c from swipes
  where actor_id = '00000000-0000-4000-8000-000000000002' and target_id = auth.uid() and mode = 'date';
  assert c = 1, 'other side''s swipe should remain after undo';
  -- their like still stands: re-liking re-matches instantly
  insert into swipes (actor_id, target_id, mode, action)
  values (auth.uid(), '00000000-0000-4000-8000-000000000002', 'date', 'like');
  select count(*) into c from matches where '00000000-0000-4000-8000-000000000002' in (user_a, user_b);
  assert c = 1, 're-like after undo did not re-match';
end $$;

-- ---- 5. Court-time proposal: recipient can respond, sender cannot ----
do $$
declare v_msg bigint; v_ok boolean;
begin
  select id into v_msg from messages where kind = 'court_time' limit 1;
  -- Aaron is the recipient (Sam sent it) → should succeed
  v_ok := respond_court_time(v_msg, true);
  assert v_ok, 'recipient could not accept court time';
  assert (select court_payload->>'status' from messages where id = v_msg) = 'accepted', 'status not updated';
  -- Sam (the sender) must not be able to respond to their own proposal
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
  v_ok := respond_court_time(v_msg, false);
  assert not v_ok, 'sender was able to respond to own proposal';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
end $$;

-- ---- 5b. Read receipts: scoped RPC works; direct message edits are dead ----
set role authenticated;
do $$
declare v_match uuid; c int; v_body text; v_msg bigint;
begin
  -- the Aaron ↔ Sam match has seeded messages from both sides
  select m.id into v_match from matches m
  where '00000000-0000-4000-8000-000000000004' in (m.user_a, m.user_b)
    and '00000000-0000-4000-8000-00000000000a' in (m.user_a, m.user_b);
  assert v_match is not null, 'expected seeded Aaron-Sam match';
  -- a non-member calling the RPC changes nothing
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', false);
  perform mark_messages_read(v_match);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
  select count(*) into c from messages where match_id = v_match and read_at is not null;
  assert c = 0, 'non-member marked messages read';
  -- Aaron marks read: Sam's messages get read_at, Aaron's own do not
  perform mark_messages_read(v_match);
  select count(*) into c from messages
  where match_id = v_match and sender_id <> auth.uid() and read_at is null;
  assert c = 0, 'partner messages not marked read';
  select count(*) into c from messages
  where match_id = v_match and sender_id = auth.uid() and read_at is not null;
  assert c = 0, 'own messages wrongly marked read';
  -- direct UPDATE (message tampering) must be a dead end now — no update
  -- policy exists at all, so even one's own messages are immutable
  select id into v_msg from messages where match_id = v_match limit 1;
  assert v_msg is not null, 'no message found to probe';
  update messages set body = 'tampered' where id = v_msg;
  select body into v_body from messages where id = v_msg;
  assert v_body is distinct from 'tampered', 'member was able to rewrite a message';
end $$;
reset role;

-- ---- 6. RLS: blocked users become invisible both ways ----
set role authenticated;
-- (members block through block_member() since migration 31)
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
select block_member('00000000-0000-4000-8000-000000000003');
do $$
declare c int;
begin
  select count(*) into c from profiles where id = '00000000-0000-4000-8000-000000000003';
  assert c = 0, 'blocked profile still visible to blocker';
end $$;
-- and from the blocked side
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$
declare c int;
begin
  select count(*) into c from profiles where id = '00000000-0000-4000-8000-00000000000a';
  assert c = 0, 'blocker profile still visible to blocked user';
end $$;

-- ---- 7. RLS: cannot swipe as someone else, cannot read others' notifications ----
do $$
declare c int;
begin
  begin
    insert into swipes (actor_id, target_id, mode, action)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'date', 'like');
    assert false, 'was able to swipe as another user';
  exception when insufficient_privilege or check_violation then null;
  end;
  select count(*) into c from notifications where user_id <> auth.uid();
  assert c = 0, 'can read other users notifications';
end $$;

-- ---- 8. RLS: messages restricted to match members ----
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000012';  -- Lena, no matches
do $$
declare c int;
begin
  select count(*) into c from messages;
  assert c = 0, 'non-member can read messages';
end $$;

-- ---- 9. Waitlist: anon joins through the RPC, and can read nothing ----
set role anon;
select join_waitlist('fan@example.com', 'indianapolis');
do $$
declare c int;
begin
  select count(*) into c from waitlist;
  assert c = 0, 'anon can read the waitlist';
end $$;
reset role;

-- ---- 9b. Admin: non-admins see nothing extra; admins moderate ----
reset role;
-- a pending photo belonging to Maya (inserted as superuser)
insert into profile_photos (user_id, storage_path, position, moderation_status)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001/0.jpg', 0, 'pending');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
select report_member('00000000-0000-4000-8000-000000000002', 'Test report for admin triage', 'deck');
do $$
declare c int; ok boolean;
begin
  ok := is_admin();
  assert not ok, 'non-admin passes is_admin()';
  -- Aaron must not see Maya's pending photo…
  select count(*) into c from profile_photos where user_id = '00000000-0000-4000-8000-000000000001';
  assert c = 0, 'non-admin can see someone else''s pending photo';
  -- …or anyone's reports but his own, or create events
  select count(*) into c from reports where reporter_id <> auth.uid();
  assert c = 0, 'non-admin can read others'' reports';
  begin
    insert into events (title, venue, starts_at, sport, capacity)
    values ('Rogue event', 'Nowhere', now() + interval '1 day', 'tennis', 10);
    assert false, 'non-admin created an event';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;
reset role;
insert into admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
set role authenticated;
do $$
declare c int; v_report uuid;
begin
  assert is_admin(), 'admin fails is_admin()';
  -- sees and approves the pending photo
  select count(*) into c from profile_photos
  where user_id = '00000000-0000-4000-8000-000000000001' and moderation_status = 'pending';
  assert c = 1, 'admin cannot see pending photo';
  update profile_photos set moderation_status = 'approved'
  where user_id = '00000000-0000-4000-8000-000000000001' and position = 0;
  select count(*) into c from profile_photos
  where user_id = '00000000-0000-4000-8000-000000000001' and moderation_status = 'approved';
  assert c = 1, 'admin photo approval did not stick';
  -- reads every report and closes one
  select count(*) into c from reports;
  assert c >= 1, 'admin sees no reports';
  select id into v_report from reports limit 1;
  update reports set status = 'reviewed' where id = v_report;
  assert (select status from reports where id = v_report) = 'reviewed', 'admin report triage did not stick';
  -- creates an event
  insert into events (title, venue, starts_at, sport, capacity)
  values ('RSVPlay Social Mixer', 'Broad Ripple Courts', now() + interval '7 days', 'pickleball', 24);
  select count(*) into c from events where title = 'RSVPlay Social Mixer';
  assert c = 1, 'admin could not create event';
end $$;
-- admins table itself stays invisible even to admins via the API
do $$
declare c int;
begin
  begin
    select count(*) into c from admins;
    assert c = 0, 'admins table readable via API';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---- 9c. Photos: members can't self-approve; reorder/delete RPCs work ----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego (not an admin)
insert into profile_photos (user_id, storage_path, position, moderation_status)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002/a.jpg', 0, 'approved');
do $$
declare v_status text;
begin
  -- the trigger must have neutralized the smuggled 'approved'
  select moderation_status into v_status from profile_photos
  where user_id = auth.uid() and position = 0;
  assert v_status = 'pending', format('self-approved insert slipped through: %s', v_status);
  -- explicit self-approval must raise
  begin
    update profile_photos set moderation_status = 'approved'
    where user_id = auth.uid() and position = 0;
    assert false, 'member approved own photo';
  exception when raise_exception then null;
  end;
end $$;
insert into profile_photos (user_id, storage_path, position)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002/b.jpg', 1),
       ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002/c.jpg', 2);
select make_photo_primary(2);
do $$
begin
  assert (select storage_path from profile_photos where user_id = auth.uid() and position = 0)
         like '%/c.jpg', 'make_photo_primary did not move photo to slot 0';
  assert (select storage_path from profile_photos where user_id = auth.uid() and position = 2)
         like '%/a.jpg', 'make_photo_primary did not swap old primary out';
end $$;
select delete_photo(1);
do $$
declare c int;
begin
  select count(*) into c from profile_photos where user_id = auth.uid();
  assert c = 2, format('delete_photo wrong count: %s', c);
  assert (select storage_path from profile_photos where user_id = auth.uid() and position = 1)
         like '%/a.jpg', 'delete_photo did not compact positions';
  -- deleting someone else's slot must be a no-op (RPC scopes to auth.uid())
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
  perform delete_photo(0);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
  select count(*) into c from profile_photos where user_id = '00000000-0000-4000-8000-000000000002';
  assert c = 2, 'delete_photo leaked across accounts';
end $$;
reset role;

-- ---- 9e. Photo objects: you own your folder, and only your folder ----
-- The moderation gate lives at the storage layer, so it is tested there.
reset role;
insert into storage.objects (bucket_id, name)
values ('photos', '00000000-0000-4000-8000-000000000003/p1.jpg');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego
do $$
begin
  -- inserting into someone else's folder must be refused by the policy
  begin
    insert into storage.objects (bucket_id, name)
    values ('photos', '00000000-0000-4000-8000-000000000003/sneaky.jpg');
    assert false, 'wrote a photo object into another member''s folder';
  exception when insufficient_privilege then null;
  end;
  -- and so must deleting one
  delete from storage.objects where name like '00000000-0000-4000-8000-000000000003/%';
  assert (select count(*) from storage.objects
          where name like '00000000-0000-4000-8000-000000000003/%') = 0
      or true, 'checked below';
end $$;
reset role;
do $$
declare c int;
begin
  select count(*) into c from storage.objects
   where name like '00000000-0000-4000-8000-000000000003/%';
  assert c = 1, format('another member deleted Priya''s photo object (left %s)', c);
end $$;

-- Reading: your own objects always; someone else's only once approved.
set role authenticated;
do $$
declare c int;
begin
  select count(*) into c from storage.objects
   where name like '00000000-0000-4000-8000-000000000003/%';
  assert c = 0, 'unapproved photo of another member was readable';
end $$;
reset role;
-- No ON CONFLICT here: the (user_id, position) constraint is deferrable, which
-- Postgres will not accept as a conflict arbiter.
delete from profile_photos where user_id = '00000000-0000-4000-8000-000000000003' and position = 5;
insert into profile_photos (user_id, storage_path, position)
values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003/p1.jpg', 5);
-- Approval goes through the real route: an admin, because the moderation
-- trigger forces every insert to 'pending' for everyone else.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'; -- Aaron, an admin
update profile_photos set moderation_status = 'approved'
 where storage_path = '00000000-0000-4000-8000-000000000003/p1.jpg';
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- back to Diego
do $$
declare c int;
begin
  select count(*) into c from storage.objects
   where name = '00000000-0000-4000-8000-000000000003/p1.jpg';
  assert c = 1, 'approved photo of another member was not readable';
end $$;
reset role;

-- ---- 9d. Apple refresh tokens are unreachable through the API ----
-- The row is a credential: whoever holds it can act on that Apple account.
-- RLS is on with no policies, so every API role should see and write nothing —
-- including admins, who have read access to almost everything else.
reset role;
insert into apple_identities (user_id, refresh_token)
values ('00000000-0000-4000-8000-000000000012', 'rt-secret-value');
do $$
declare c int; who text;
begin
  foreach who in array array[
    '00000000-0000-4000-8000-000000000002',  -- an ordinary member
    '00000000-0000-4000-8000-000000000012',  -- the token's own owner
    '00000000-0000-4000-8000-00000000000a'   -- an admin
  ] loop
    perform set_config('request.jwt.claim.sub', who, false);
    execute 'set role authenticated';
    -- Belt and braces: the grant is withdrawn AND there is no policy, so this
    -- either raises or returns nothing. Both are fine; a row is not.
    begin
      select count(*) into c from apple_identities;
      assert c = 0, format('apple refresh token readable via the API by %s', who);
    exception when insufficient_privilege then null;
    end;
    begin
      insert into apple_identities (user_id, refresh_token)
      values (who::uuid, 'forged');
      assert false, format('%s wrote to apple_identities through the API', who);
    exception when insufficient_privilege then null;
    end;
    execute 'reset role';
  end loop;
end $$;
reset role;
do $$
begin
  assert (select refresh_token from apple_identities
           where user_id = '00000000-0000-4000-8000-000000000012') = 'rt-secret-value',
         'apple token altered through the API';
end $$;

-- ---- 9f. What an unauthenticated visitor can reach ----
-- The anon key is public: it ships in the landing page's source and in the app
-- binary. Everything anon can do is therefore world-readable, so it is asserted
-- rather than assumed. Nothing but the city list should come back.
reset role;
set role anon;
do $$
declare c int; t text;
begin
  foreach t in array array[
    'profiles', 'swipes', 'matches', 'messages', 'notifications',
    'profile_photos', 'reports', 'blocks', 'push_tokens', 'devices',
    'admins', 'apple_identities', 'waitlist', 'event_rsvps', 'courts',
    'tournaments', 'tournament_entries', 'tournament_matches'
  ] loop
    -- Two acceptable outcomes: the grant is withdrawn outright (stronger), or
    -- row-level security filters everything away. Anything returned is a leak.
    begin
      execute format('select count(*) from public.%I', t) into c;
      assert c = 0, format('anon can read public.%s (%s rows)', t, c);
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- The one thing anon is *meant* to see: the city list, which the landing page's
-- "where do you play?" picker is built from before anyone signs in. Events are
-- authenticated-only and stay that way — the landing page's event copy is
-- static, not read from the database.
do $$
begin
  assert (select count(*) from cities) > 0, 'anon cannot read the city list';
  assert (select count(*) from events) = 0, 'anon can read the event calendar';
end $$;

-- Joining the waitlist must not reveal whether the address was already there.
-- Same call twice, same result, and no way to tell from the outside.
do $$
declare before_n int; after_n int;
begin
  perform join_waitlist('Court.Fan@Example.COM ', 'seattle', 'landing');
  perform join_waitlist('court.fan@example.com', 'miami', 'landing');
  -- anon still cannot read the table to find out which one landed
  select count(*) into after_n from waitlist;
  assert after_n = 0, 'anon can read the waitlist';
end $$;
reset role;
do $$
declare c int;
begin
  select count(*) into c from waitlist where email = 'court.fan@example.com';
  assert c = 1, format('waitlist should hold one normalised row, has %s', c);
  -- the second call was swallowed, so the first city stands
  assert (select city from waitlist where email = 'court.fan@example.com') = 'seattle',
         'duplicate join overwrote the original row';
end $$;

-- A direct insert is refused outright now: there is no insert policy, so the
-- RPC is the only door and it cannot be made to leak.
set role anon;
do $$
begin
  begin
    insert into waitlist (email) values ('sneaky@example.com');
    assert false, 'anon inserted into the waitlist directly, bypassing join_waitlist';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---- 9g. A member cannot read anyone else's birthdate or coordinates ----
-- Row-level security says which ROWS, never which columns. profiles_select
-- hands out every other member's row, so before the column privileges were
-- withdrawn this returned an exact date of birth and a ~1km home location for
-- the whole app, to anyone who signed up. The deck goes to the trouble of
-- returning a distance instead of a position; the table was undoing that.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego
do $$
declare v text;
begin
  -- Since 20260806000030 that is every column but id and first_name: settings
  -- such as who someone is looking for were readable the same way.
  foreach v in array array['birthdate', 'partner_birthdate', 'approx_lat', 'approx_lng',
                           'city', 'extra_cities', 'modes', 'seeking', 'radius_mi', 'age_min',
                           'age_max', 'same_sports_only', 'play_pref', 'friends_pref',
                           'play_games', 'last_active_at', 'created_at', 'verified_at',
                           'phone_verified_at', 'gender', 'bio', 'availability_note',
                           'is_team', 'partner_name', 'partner_gender',
                           'location_updated_at', 'gender_updated_at', 'team_updated_at'] loop
    begin
      execute format('select %I::text from profiles where id = $1', v)
        using '00000000-0000-4000-8000-000000000003'::uuid;
      assert false, format('a member can read another member''s %s', v);
    exception when insufficient_privilege then null;
    end;
  end loop;
  -- own row is no different: the column is withdrawn from the role outright
  begin
    execute 'select birthdate from profiles where id = auth.uid()';
    assert false, 'birthdate still selectable from the table';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Exactly two columns of profiles are readable column by column: id (a row
-- filter needs it) and first_name (the desk joins it onto reports and photos).
-- Everything else a member sees about someone comes from a function that
-- decides what to hand over. A new column is withheld by default; this fails
-- if one is ever granted, rather than letting it quietly become readable.
do $$
declare readable text;
begin
  select string_agg(c.column_name, ', ' order by c.column_name) into readable
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'profiles'
    and has_column_privilege('authenticated', 'public.profiles', c.column_name, 'select');
  assert readable = 'first_name, id',
    format('profiles columns readable by members should be just id and first_name, got: %s '
           '— see migration 20260806000030', readable);
  assert not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'profiles'
      and has_column_privilege('anon', 'public.profiles', c.column_name, 'select')
  ), 'a signed-out visitor can read a profiles column';
end $$;

-- What the app uses instead. Your own profile still comes back whole...
do $$
declare me jsonb;
begin
  me := get_my_profile();
  assert me is not null, 'get_my_profile returned nothing for a real member';
  assert me ->> 'birthdate' is not null, 'get_my_profile withheld my own birthdate';
  assert me ->> 'first_name' = 'Diego', format('wrong profile came back: %s', me ->> 'first_name');
  assert jsonb_array_length(me -> 'user_sports') > 0, 'get_my_profile lost my sports';
end $$;

-- ...and other people come back as cards: an age, never a birthdate, and no
-- coordinates at any point.
do $$
declare cards jsonb; card jsonb;
begin
  cards := get_profile_cards(array['00000000-0000-4000-8000-000000000003']::uuid[]);
  assert jsonb_array_length(cards) = 1, format('expected one card, got %s', jsonb_array_length(cards));
  card := cards -> 0;
  assert (card ->> 'age')::int between 18 and 99, format('card age looks wrong: %s', card ->> 'age');
  foreach card in array array[cards -> 0] loop
    assert not (card ? 'birthdate'), 'profile card leaks birthdate';
    assert not (card ? 'partner_birthdate'), 'profile card leaks partner birthdate';
    assert not (card ? 'approx_lat'), 'profile card leaks latitude';
    assert not (card ? 'approx_lng'), 'profile card leaks longitude';
  end loop;
end $$;

-- Blocking still applies, even though a definer function skips RLS entirely --
-- so the filter profiles_select would have done has to be repeated by hand.
-- Checked both ways round, or the assertion proves nothing.
do $$
begin
  assert jsonb_array_length(
    get_profile_cards(array['00000000-0000-4000-8000-000000000004']::uuid[])) = 1,
    'test setup: Sam should be visible before the block';
  perform block_member('00000000-0000-4000-8000-000000000004');
  assert jsonb_array_length(
    get_profile_cards(array['00000000-0000-4000-8000-000000000004']::uuid[])) = 0,
    'a blocked member still comes back as a card';
  delete from blocks
   where blocker_id = auth.uid() and blocked_id = '00000000-0000-4000-8000-000000000004';
end $$;
reset role;

-- ---- 9h. What one member can reach about another ----
-- Same idea as the anon sweep, one level up: everything an ordinary signed-in
-- member can read is readable by anyone who registers, so each table gets an
-- explicit expectation rather than being assumed safe. Diego looks at Priya,
-- who he has no relationship with — no match, no messages, nothing.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego
do $$
declare c int;
begin
  -- Who liked whom is the product's whole secret. Seeing someone else's swipes
  -- would reveal that they liked you before a match exists.
  select count(*) into c from swipes where actor_id <> auth.uid();
  assert c = 0, format('a member can read %s of other people''s swipes', c);

  -- Matches and messages: participants only.
  select count(*) into c from matches where auth.uid() not in (user_a, user_b);
  assert c = 0, format('a member can read %s matches they are not in', c);
  select count(*) into c from messages where sender_id <> auth.uid();
  assert c = 0, 'a member can read messages from a conversation they are not in';

  -- Who blocked or reported whom is a safety matter in both directions.
  select count(*) into c from blocks where blocker_id <> auth.uid();
  assert c = 0, 'a member can see who else has blocked people';
  select count(*) into c from reports where reporter_id <> auth.uid();
  assert c = 0, 'a member can read other people''s reports';

  -- Notifications, devices and push tokens are all strictly personal.
  select count(*) into c from notifications where user_id <> auth.uid();
  assert c = 0, 'a member can read other people''s notifications';
  select count(*) into c from devices where user_id <> auth.uid();
  assert c = 0, 'a member can see other people''s devices';
  select count(*) into c from push_tokens where user_id <> auth.uid();
  assert c = 0, 'a member can read other people''s push tokens';

  -- Unapproved photos must not be reachable before a human has seen them.
  select count(*) into c from profile_photos
   where user_id <> auth.uid() and moderation_status <> 'approved';
  assert c = 0, 'a member can see another member''s unmoderated photo';
end $$;

-- Blocking has to hold on the event guest list too, or a blocked member can
-- find out where someone will physically be, and when.
do $$
declare ev uuid; seen int;
begin
  select id into ev from events limit 1;
  reset role;
  insert into event_rsvps (event_id, user_id)
  values (ev, '00000000-0000-4000-8000-000000000003')
  on conflict do nothing;
  set role authenticated;

  select count(*) into seen from event_rsvps
   where event_id = ev and user_id = '00000000-0000-4000-8000-000000000003';
  assert seen = 1, 'test setup: Priya should be on the guest list to start with';

  perform block_member('00000000-0000-4000-8000-000000000003');

  select count(*) into seen from event_rsvps
   where event_id = ev and user_id = '00000000-0000-4000-8000-000000000003';
  assert seen = 0, 'a blocked member is still visible on the event guest list';

  -- ...and the same block hides the sports rows, so the account cannot even be
  -- confirmed to still exist.
  select count(*) into seen from user_sports
   where user_id = '00000000-0000-4000-8000-000000000003';
  assert seen = 0, 'a blocked member''s sports are still readable';

  delete from blocks
   where blocker_id = auth.uid() and blocked_id = '00000000-0000-4000-8000-000000000003';
end $$;
reset role;

-- ---- 9i. An event cannot be oversubscribed ----
-- capacity used to be a check on the number and nothing more, so the API would
-- happily take more RSVPs than there were spots.
reset role;
do $$
declare ev uuid; i int; uid uuid;
begin
  insert into events (title, venue, starts_at, sport, capacity, city)
  values ('Tiny Round Robin', 'Test Courts', now() + interval '3 days', 'pickleball', 2, 'indianapolis')
  returning id into ev;

  -- fill it exactly
  for i in 1..2 loop
    uid := ('00000000-0000-4000-8000-00000000010' || i)::uuid;
    insert into auth.users (id, email) values (uid, format('cap%s@example.com', i));
    insert into profiles (id, first_name, birthdate, city)
    values (uid, 'Cap' || i, '1995-01-01', 'indianapolis');
    insert into event_rsvps (event_id, user_id) values (ev, uid);
  end loop;

  assert (select count(*) from event_rsvps where event_id = ev) = 2, 'setup: expected a full event';

  -- one more must be refused, not silently accepted
  begin
    insert into event_rsvps (event_id, user_id)
    values (ev, '00000000-0000-4000-8000-000000000002');
    assert false, 'a member joined an event that was already full';
  exception when raise_exception then null;
  end;

  -- someone already going can still be updated without tripping the guard
  update event_rsvps set status = 'checked_in'
   where event_id = ev and user_id = '00000000-0000-4000-8000-000000000101';
  assert (select status from event_rsvps
           where event_id = ev and user_id = '00000000-0000-4000-8000-000000000101') = 'checked_in',
         'checking in an existing attendee was blocked by the capacity guard';

  -- and a spot freed up is genuinely reusable
  delete from event_rsvps where event_id = ev and user_id = '00000000-0000-4000-8000-000000000102';
  insert into event_rsvps (event_id, user_id)
  values (ev, '00000000-0000-4000-8000-000000000002');
  assert (select count(*) from event_rsvps where event_id = ev) = 2, 'freed spot was not reusable';

  delete from event_rsvps where event_id = ev;
  delete from events where id = ev;
end $$;

-- ---- 9j. Founder data: the waitlist and the demo funnel ----
-- Both are readable by admins and nobody else. The waitlist read exists so the
-- founder can email people when a city opens; it must not reopen the
-- membership oracle join_waitlist was written to close.
reset role;
select join_waitlist('one@example.com', 'seattle');
select join_waitlist('two@example.com', 'miami');
select record_demo_step('11111111-1111-4111-8111-111111111111', 'landed');
select record_demo_step('11111111-1111-4111-8111-111111111111', 'start_signup');
select record_demo_step('11111111-1111-4111-8111-111111111111', 'landed'); -- reload
select record_demo_step('22222222-2222-4222-8222-222222222222', 'landed');

-- an ordinary member sees neither
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
do $$
declare c int;
begin
  select count(*) into c from waitlist;
  assert c = 0, format('a member can read %s waitlist rows', c);
  select count(*) into c from demo_events;
  assert c = 0, format('a member can read %s demo events', c);
  begin
    perform demo_funnel(30);
    assert false, 'a member can read the demo funnel';
  exception when insufficient_privilege then null;
  end;
end $$;

-- anon can write a step and read nothing
reset role;
set role anon;
select record_demo_step('33333333-3333-4333-8333-333333333333', 'landed');
do $$
declare c int;
begin
  begin
    select count(*) into c from demo_events;
    assert c = 0, 'anon can read demo events';
  exception when insufficient_privilege then null;
  end;
  -- and the vocabulary is closed, so the endpoint can't be used as free storage
  begin
    perform record_demo_step('33333333-3333-4333-8333-333333333333', 'arbitrary junk');
    assert false, 'record_demo_step accepted an unknown step';
  exception when others then null;
  end;
end $$;
reset role;

-- the admin sees both, and the funnel counts visits rather than events
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'; -- Aaron, an admin
do $$
declare c int; f jsonb;
begin
  select count(*) into c from waitlist;
  assert c >= 2, format('admin cannot read the waitlist (%s rows)', c);
  f := demo_funnel(30);
  -- three distinct visits landed; one of them reloaded, which must not count twice
  assert (f ->> 'landed')::int = 3, format('funnel counted events not visits: %s', f ->> 'landed');
  assert (f ->> 'start_signup')::int = 1, format('wrong start_signup count: %s', f ->> 'start_signup');
end $$;
reset role;

-- ---- 9j-ii. Places to play: members read, only the desk writes ----
reset role;
do $$
declare c int;
begin
  select count(*) into c from courts where city = 'bakersfield';
  assert c = 13, format('expected the 13 Bakersfield venues, got %s', c);
  select count(*) into c from courts where city = 'bakersfield' and setting = 'indoor';
  assert c >= 1, 'no indoor venue listed for Bakersfield';
  select count(*) into c from courts where city = 'bakersfield' and access = 'public';
  assert c >= 1, 'no free public court listed for Bakersfield';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego, an ordinary member
do $$
declare c int;
begin
  assert not is_admin(), 'test setup: Diego should not be an admin';
  select count(*) into c from courts where city = 'bakersfield';
  assert c = 13, format('a member sees %s of the 13 Bakersfield places', c);
  begin
    insert into courts (city, name, setting, access) values ('bakersfield', 'My Driveway', 'outdoor', 'public');
    assert false, 'a member added a place';
  exception when insufficient_privilege then null;
  end;
  -- RLS filters an update or delete to zero rows rather than raising; either
  -- way nothing may change.
  update courts set name = 'Hacked' where city = 'bakersfield';
  delete from courts where city = 'bakersfield';
end $$;
reset role;
do $$
declare c int;
begin
  select count(*) into c from courts where city = 'bakersfield' and name <> 'Hacked';
  assert c = 13, 'a member changed or removed a place';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a'; -- Aaron, on the admins list
do $$
declare c int; new_id uuid;
begin
  assert is_admin(), 'test setup: Aaron should be an admin by this point';
  insert into courts (city, name, setting, access) values ('seattle', 'Green Lake Courts', 'outdoor', 'public')
  returning id into new_id;
  select count(*) into c from courts where id = new_id and courts is null and lights is null;
  assert c = 1, 'unknown court count / lights did not stay unknown';
  begin
    insert into courts (city, name, setting, access) values ('seattle', 'Green Lake Courts', 'outdoor', 'public');
    assert false, 'the same place was listed twice in one city';
  exception when unique_violation then null;
  end;
  begin
    insert into courts (city, name, setting, access) values ('seattle', 'green lake COURTS', 'outdoor', 'public');
    assert false, 'the same place was listed twice under a different capitalisation';
  exception when unique_violation then null;
  end;
  begin
    insert into courts (city, name, setting, access) values ('seattle', ' Padded Name ', 'outdoor', 'public');
    assert false, 'a name with surrounding spaces was stored';
  exception when check_violation then null;
  end;
  begin
    insert into courts (city, name, setting, access) values ('atlantis', 'Lost Courts', 'outdoor', 'public');
    assert false, 'a place was filed under a city that does not exist';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into courts (city, name, setting, access, courts) values ('seattle', 'Zero Courts', 'outdoor', 'public', 0);
    assert false, 'a court count of zero was accepted';
  exception when check_violation then null;
  end;
  update courts set note = 'Rotating doubles by the lake.' where id = new_id;
  delete from courts where id = new_id;
  select count(*) into c from courts where id = new_id;
  assert c = 0, 'the desk could not remove a place';
end $$;
reset role;

-- ---- 9j-iii. Tournaments: brackets build themselves for every size, 2 to 72 ----
-- Seventy-two players of our own, so the draw has a full field to work with.
reset role;
do $$
declare i int; uid uuid;
begin
  for i in 1..72 loop
    uid := ('00000000-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email) values (uid, format('player%s@example.com', i));
    insert into profiles (id, first_name, birthdate, city) values (uid, 'Player' || i, '1990-01-01', 'bakersfield');
  end loop;
end $$;

-- Aaron is on the admins list by now; the draw and the results go through him.
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare
  n int; t uuid; size int; expect int; c int; r int; m record; champ uuid; champ_seed int;
  players uuid[];
begin
  assert is_admin(), 'test setup: Aaron should be an admin here';
  assert bracket_seed_order(8) = array[1,8,4,5,2,7,3,6], format('seed order for 8 is %s', bracket_seed_order(8));
  assert bracket_seed_order(2) = array[1,2], 'seed order for 2';

  for n in 2..72 loop
    insert into tournaments (city, title, starts_at, max_entries)
    values ('bakersfield', format('Draw of %s', n), now() + interval '2 days', 72)
    returning id into t;
    insert into tournament_entries (tournament_id, user_id)
    select t, ('00000000-0000-4000-8000-0000000003' || lpad(i::text, 2, '0'))::uuid
      from generate_series(1, n) i;

    perform start_tournament(t);

    expect := 2; while expect < n loop expect := expect * 2; end loop;
    select bracket_size into size from tournaments where id = t;
    assert size = expect, format('%s players: bracket of %s, expected %s', n, size, expect);
    assert (select status from tournaments where id = t) = 'in_progress', format('%s players: not started', n);

    select count(*) into c from tournament_matches where tournament_id = t;
    assert c = size - 1, format('%s players: %s matches, expected %s', n, c, size - 1);

    -- every entrant drawn exactly once in round 1, and seeded 1..n
    select array_agg(p) into players from (
      select player_a as p from tournament_matches where tournament_id = t and round = 1 and player_a is not null
      union all
      select player_b from tournament_matches where tournament_id = t and round = 1 and player_b is not null) x;
    assert array_length(players, 1) = n, format('%s players: %s placed in round 1', n, array_length(players, 1));
    assert (select count(distinct p) from unnest(players) p) = n, format('%s players: someone drawn twice', n);
    assert (select count(*) from tournament_entries where tournament_id = t and seed between 1 and n) = n,
      format('%s players: seeds are not 1..%s', n, n);

    -- byes: exactly size - n, never two in one match, each already advanced
    select count(*) into c from tournament_matches where tournament_id = t and round = 1 and is_bye;
    assert c = size - n, format('%s players: %s byes, expected %s', n, c, size - n);
    assert not exists (select 1 from tournament_matches where tournament_id = t and round = 1
                        and player_a is null and player_b is null), format('%s players: a bye met a bye', n);
    for m in select * from tournament_matches where tournament_id = t and round = 1 and is_bye loop
      assert m.winner is not null, format('%s players: a bye has no winner', n);
      assert exists (select 1 from tournament_matches where tournament_id = t and round = 2
                      and slot = m.slot / 2 and (player_a = m.winner or player_b = m.winner)),
        format('%s players: a bye did not advance', n);
    end loop;
    -- byes go to the top seeds
    assert not exists (
      select 1 from tournament_matches mm join tournament_entries e
        on e.tournament_id = t and e.user_id = mm.winner
       where mm.tournament_id = t and mm.round = 1 and mm.is_bye and e.seed > size - n),
      format('%s players: a bye went to a low seed', n);

    -- play it out: the top player always wins; the champion must be seed 1
    for r in 1..round(log(2, size))::int loop
      for m in select * from tournament_matches where tournament_id = t and round = r and winner is null order by slot loop
        assert m.player_a is not null and m.player_b is not null,
          format('%s players: round %s slot %s was not filled before it was due', n, r, m.slot);
        perform report_match_result(m.id, m.player_a, '11-7');
      end loop;
    end loop;
    select champion_id into champ from tournaments where id = t;
    select seed into champ_seed from tournament_entries where tournament_id = t and user_id = champ;
    assert (select status from tournaments where id = t) = 'completed', format('%s players: not completed', n);
    assert champ_seed = 1, format('%s players: champion is seed %s, expected 1', n, champ_seed);

    delete from tournaments where id = t;
  end loop;
end $$;
reset role;

-- The ceiling is 72, and the database holds it whatever the desk sends.
do $$
begin
  begin
    insert into tournaments (city, title, starts_at, max_entries) values ('bakersfield', 'Too Big', now() + interval '2 days', 73);
    assert false, 'a 73-entry tournament was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into tournaments (city, title, starts_at, max_entries) values ('bakersfield', 'Too Small', now() + interval '2 days', 1);
    assert false, 'a 1-entry tournament was accepted';
  exception when check_violation then null;
  end;
end $$;

-- The rules, from the members' side.
do $$
declare t uuid;
begin
  insert into tournaments (id, city, title, starts_at, max_entries)
  values ('00000000-0000-4000-8000-0000000004aa', 'bakersfield', 'Rules Cup', now() + interval '2 days', 3);
end $$;
set role authenticated;
do $$
declare t uuid := '00000000-0000-4000-8000-0000000004aa'; c int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000301', false);
  perform join_tournament(t);
  perform join_tournament(t);   -- twice is not an error, and not two entries
  assert (select count(*) from tournament_entries where tournament_id = t) = 1, 'joining twice made two entries';
  begin
    perform start_tournament(t);
    assert false, 'a member started a tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into tournament_entries (tournament_id, user_id) values (t, '00000000-0000-4000-8000-000000000305');
    assert false, 'a member wrote an entry for someone else directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into tournaments (city, title, starts_at) values ('bakersfield', 'My Own Cup', now() + interval '1 day');
    assert false, 'a member created a tournament';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000302', false);
  perform join_tournament(t);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000303', false);
  perform join_tournament(t);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000304', false);
  begin
    perform join_tournament(t);
    assert false, 'a fourth player joined a three-player tournament';
  exception when raise_exception then null;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000303', false);
  perform leave_tournament(t);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000304', false);
  perform join_tournament(t);   -- the freed place is genuinely reusable
  assert (select count(*) from tournament_entries where tournament_id = t) = 3, 'freed place not reusable';
end $$;
reset role;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
select start_tournament('00000000-0000-4000-8000-0000000004aa');
set role authenticated;
do $$
declare
  t uuid := '00000000-0000-4000-8000-0000000004aa';
  m record; outsider uuid; nxt record;
begin
  -- three players in a bracket of four: one bye, one real first-round match
  select * into m from tournament_matches where tournament_id = t and round = 1 and not is_bye;
  select user_id into outsider from tournament_entries
   where tournament_id = t and user_id not in (m.player_a, m.player_b);

  perform set_config('request.jwt.claim.sub', m.player_a::text, false);
  begin
    perform leave_tournament(t);
    assert false, 'a player left after the draw';
  exception when raise_exception then null;
  end;
  begin
    update tournament_matches set winner = m.player_a where id = m.id;
    -- RLS hides the row from an update rather than raising; nothing may change
  end;
  assert (select winner from tournament_matches where id = m.id) is null, 'a member edited a match directly';

  perform set_config('request.jwt.claim.sub', outsider::text, false);
  begin
    perform report_match_result(m.id, outsider, '11-0');
    assert false, 'a player not in the match recorded its result';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', m.player_a::text, false);
  begin
    perform report_match_result(m.id, outsider, '11-0');
    assert false, 'someone outside the match was recorded as its winner';
  exception when raise_exception then null;
  end;
  perform report_match_result(m.id, m.player_b, '9-11, 11-8, 11-6');   -- reports their own loss
  assert (select winner from tournament_matches where id = m.id) = m.player_b, 'the result was not recorded';
  assert (select score from tournament_matches where id = m.id) = '9-11, 11-8, 11-6', 'the score was not recorded';
  begin
    perform report_match_result(m.id, m.player_a, '11-0');
    assert false, 'a player changed a result already recorded';
  exception when raise_exception then null;
  end;

  -- the winner is in the final, against the player who had the bye
  select * into nxt from tournament_matches where tournament_id = t and round = 2;
  assert m.player_b in (nxt.player_a, nxt.player_b), 'the winner did not advance to the final';
  assert nxt.player_a is not null and nxt.player_b is not null, 'the final is not filled';
end $$;
reset role;
-- The desk can correct a result while the next match hasn't been played...
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare t uuid := '00000000-0000-4000-8000-0000000004aa'; m record; fin record;
begin
  select * into m from tournament_matches where tournament_id = t and round = 1 and not is_bye;
  perform report_match_result(m.id, m.player_a, 'corrected');
  select * into fin from tournament_matches where tournament_id = t and round = 2;
  assert m.player_a in (fin.player_a, fin.player_b) and m.player_b not in (fin.player_a, fin.player_b),
    'a corrected result did not replace the player in the next round';
  -- ...but not once it has
  perform report_match_result(fin.id, fin.player_a, '11-5');
  begin
    perform report_match_result(m.id, m.player_b, 'too late');
    assert false, 'a result was changed after the next round was played';
  exception when raise_exception then null;
  end;
  assert (select status from tournaments where id = t) = 'completed', 'the final did not complete the tournament';
  assert (select champion_id from tournaments where id = t) = fin.player_a, 'the wrong champion';
  -- correcting the final itself reopens and re-crowns
  perform report_match_result(fin.id, fin.player_b, '5-11');
  assert (select champion_id from tournaments where id = t) = fin.player_b, 'correcting the final did not change the champion';
  assert (select status from tournaments where id = t) = 'completed', 'correcting the final left it unfinished';
end $$;
reset role;
delete from tournaments where id = '00000000-0000-4000-8000-0000000004aa';
-- Blocked members don't see each other's entries.
insert into tournaments (id, city, title, starts_at) values
  ('00000000-0000-4000-8000-0000000004ab', 'bakersfield', 'Block Cup', now() + interval '2 days');
insert into tournament_entries (tournament_id, user_id) values
  ('00000000-0000-4000-8000-0000000004ab', '00000000-0000-4000-8000-000000000310'),
  ('00000000-0000-4000-8000-0000000004ab', '00000000-0000-4000-8000-000000000311');
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-000000000310', '00000000-0000-4000-8000-000000000311');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000311';
do $$
begin
  assert not exists (select 1 from tournament_entries
                      where tournament_id = '00000000-0000-4000-8000-0000000004ab'
                        and user_id = '00000000-0000-4000-8000-000000000310'),
    'a blocked member can see the entry of the person who blocked them';
end $$;
reset role;
delete from blocks where blocker_id = '00000000-0000-4000-8000-000000000310';
delete from tournaments where id = '00000000-0000-4000-8000-0000000004ab';

-- ---- 9j-iv. Tournaments: what the independent review found ----
-- Five players of our own for this section; one of them deletes their account.
reset role;
do $$
declare i int; uid uuid;
begin
  for i in 1..6 loop
    uid := ('00000000-0000-4000-8000-0000000005' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email) values (uid, format('rev%s@example.com', i));
    insert into profiles (id, first_name, birthdate, city) values (uid, 'Rev' || i, '1990-01-01', 'bakersfield');
  end loop;
end $$;

-- entry_count follows joins and leaves; completed_at waits for the final.
insert into tournaments (id, city, title, starts_at, max_entries) values
  ('00000000-0000-4000-8000-0000000005aa', 'bakersfield', 'Review Cup', now() + interval '2 days', 6);
set role authenticated;
do $$
declare t uuid := '00000000-0000-4000-8000-0000000005aa'; i int;
begin
  for i in 1..5 loop
    perform set_config('request.jwt.claim.sub', ('00000000-0000-4000-8000-0000000005' || lpad(i::text, 2, '0')), false);
    perform join_tournament(t);
  end loop;
  assert (select entry_count from tournaments where id = t) = 5, 'entry_count did not follow five joins';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000505', false);
  perform leave_tournament(t);
  assert (select entry_count from tournaments where id = t) = 4, 'entry_count did not follow a leave';
  -- leaving a tournament that no longer exists is a no-op, not "the draw has been made"
  perform leave_tournament('00000000-0000-4000-8000-0000000005ff');
  -- the seed order is internal: not callable through the API
  begin
    perform bracket_seed_order(8);
    assert false, 'a member could call bracket_seed_order';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A suspended member can't join, is left out of the draw, and can't report.
update profiles set suspended_at = now() where id = '00000000-0000-4000-8000-000000000506';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000506';
do $$
begin
  begin
    perform join_tournament('00000000-0000-4000-8000-0000000005aa');
    assert false, 'a suspended member joined a tournament';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update profiles set suspended_at = null where id = '00000000-0000-4000-8000-000000000506';
insert into tournament_entries (tournament_id, user_id)
values ('00000000-0000-4000-8000-0000000005aa', '00000000-0000-4000-8000-000000000506');
update profiles set suspended_at = now() where id = '00000000-0000-4000-8000-000000000506';
-- suspension withdraws them while entries are open (migration 32) ...
do $$
begin
  assert not exists (select 1 from tournament_entries where tournament_id = '00000000-0000-4000-8000-0000000005aa'
                      and user_id = '00000000-0000-4000-8000-000000000506'), 'suspension did not withdraw the entrant';
end $$;
-- ... and an entry left over from before that (put back by hand here) is
-- still kept out of the draw below
insert into tournament_entries (tournament_id, user_id)
values ('00000000-0000-4000-8000-0000000005aa', '00000000-0000-4000-8000-000000000506');
-- a member doesn't see a suspended entrant; the desk does
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000501';
do $$
begin
  assert not exists (select 1 from tournament_entries where tournament_id = '00000000-0000-4000-8000-0000000005aa'
                      and user_id = '00000000-0000-4000-8000-000000000506'), 'a member can see a suspended entrant';
end $$;
-- the desk sees every entrant, even one its own account has a block with
reset role;
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-00000000000a');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
do $$
declare names int;
begin
  assert (select count(*) from tournament_entries where tournament_id = '00000000-0000-4000-8000-0000000005aa') = 5,
    'the desk does not see every entrant';
  select count(*) into names from admin_player_names(array['00000000-0000-4000-8000-000000000502']::uuid[]);
  assert names = 1, 'the desk cannot name an entrant who blocked its account';
  perform start_tournament('00000000-0000-4000-8000-0000000005aa');
  assert not exists (select 1 from tournament_entries where tournament_id = '00000000-0000-4000-8000-0000000005aa'
                      and user_id = '00000000-0000-4000-8000-000000000506'), 'a suspended entrant was drawn';
  assert (select entry_count from tournaments where id = '00000000-0000-4000-8000-0000000005aa') = 4,
    'entry_count did not follow the suspended entrant''s removal';
  assert (select bracket_size from tournaments where id = '00000000-0000-4000-8000-0000000005aa') = 4, 'four players, bracket of four';
end $$;
reset role;
delete from blocks where blocker_id = '00000000-0000-4000-8000-000000000502';
-- members can't name players through the desk's lookup
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000501';
do $$
begin
  begin
    perform admin_player_names(array['00000000-0000-4000-8000-000000000502']::uuid[]);
    assert false, 'a member used the desk''s name lookup';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- With rows in all three tables, a signed-out visitor still reads nothing.
set role anon;
do $$
declare c int; t text;
begin
  foreach t in array array['tournaments', 'tournament_entries', 'tournament_matches'] loop
    begin
      execute format('select count(*) from public.%I', t) into c;
      assert c = 0, format('anon can read public.%s (%s rows)', t, c);
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;

-- Play it: the second player confirming the same result is fine; a suspended
-- player can't report; and a player who deletes their account mid-bracket
-- leaves a place the desk can settle — but only once it is really vacated.
set role authenticated;
do $$
declare
  t uuid := '00000000-0000-4000-8000-0000000005aa';
  m1 record; m2 record; fin record; quitter uuid; survivor uuid;
begin
  select * into m1 from tournament_matches where tournament_id = t and round = 1 and slot = 0;
  select * into m2 from tournament_matches where tournament_id = t and round = 1 and slot = 1;
  assert m1.player_a is not null and m1.player_b is not null and m2.player_a is not null and m2.player_b is not null,
    'test setup: four players should fill both first-round matches';

  perform set_config('request.jwt.claim.sub', m1.player_a::text, false);
  perform report_match_result(m1.id, m1.player_a, '11-4, 11-6');
  perform set_config('request.jwt.claim.sub', m1.player_b::text, false);
  perform report_match_result(m1.id, m1.player_a, 'my version');   -- same winner: accepted, changes nothing
  assert (select score from tournament_matches where id = m1.id) = '11-4, 11-6', 'a confirming report overwrote the score';
  begin
    perform report_match_result(m1.id, m1.player_b, '');
    assert false, 'the loser changed a recorded result';
  exception when raise_exception then null;
  end;

  -- the final now has m1's winner against nobody yet: that empty side is still
  -- to be decided, so even the desk can't settle it
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
  select * into fin from tournament_matches where tournament_id = t and round = 2;
  begin
    perform report_match_result(fin.id, m1.player_a, 'walkover');
    assert false, 'the desk settled a final whose other semifinal has not been played';
  exception when raise_exception then null;
  end;

end $$;
-- a suspended player can't report their own match (suspended from outside the
-- member's session: since migration 30 a member can't touch suspended_at)
reset role;
update profiles set suspended_at = now()
 where id = (select player_a from tournament_matches
              where tournament_id = '00000000-0000-4000-8000-0000000005aa' and round = 1 and slot = 1);
set role authenticated;
do $$
declare m2 record;
begin
  select * into m2 from tournament_matches
   where tournament_id = '00000000-0000-4000-8000-0000000005aa' and round = 1 and slot = 1;
  perform set_config('request.jwt.claim.sub', m2.player_a::text, false);
  begin
    perform report_match_result(m2.id, m2.player_a, '');
    assert false, 'a suspended player recorded a result';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update profiles set suspended_at = null
 where id = (select player_a from tournament_matches
              where tournament_id = '00000000-0000-4000-8000-0000000005aa' and round = 1 and slot = 1);
-- m1's winner deletes their account.
do $$
declare m1 record;
begin
  select * into m1 from tournament_matches where tournament_id = '00000000-0000-4000-8000-0000000005aa' and round = 1 and slot = 0;
  perform set_config('test.quitter', m1.player_a::text, false);
  delete from auth.users where id = m1.player_a;   -- cascades to the profile; matches are set null, not blocked
  assert (select reported_at from tournament_matches where id = m1.id) is not null, 'the played match lost its record';
  assert (select winner from tournament_matches where id = m1.id) is null, 'test setup: the winner should be gone';
end $$;
set role authenticated;
do $$
declare
  t uuid := '00000000-0000-4000-8000-0000000005aa';
  m1 record; m2 record; fin record;
begin
  select * into m1 from tournament_matches where tournament_id = t and round = 1 and slot = 0;
  select * into m2 from tournament_matches where tournament_id = t and round = 1 and slot = 1;
  -- m1 was played: its loser still can't claim it now the winner has gone
  perform set_config('request.jwt.claim.sub', m1.player_b::text, false);
  begin
    perform report_match_result(m1.id, m1.player_b, '');
    assert false, 'a played match was re-recorded after its winner left';
  exception when raise_exception then null;
  end;
  -- the other semifinal is played; its winner meets an empty place in the final
  perform set_config('request.jwt.claim.sub', m2.player_b::text, false);
  perform report_match_result(m2.id, m2.player_b, '11-9');
  select * into fin from tournament_matches where tournament_id = t and round = 2;
  assert fin.player_a is null and fin.player_b = m2.player_b, 'the final should be empty v m2''s winner';
  -- the finalist can't take it on their own...
  begin
    perform report_match_result(fin.id, m2.player_b, '');
    assert false, 'a player claimed a walkover without the desk';
  exception when raise_exception then null;
  end;
  -- ...but the desk can, because that place was vacated, not undecided
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000000a', false);
  perform report_match_result(fin.id, m2.player_b, 'walkover');
  assert (select status from tournaments where id = t) = 'completed', 'the walkover did not finish the tournament';
  assert (select champion_id from tournaments where id = t) = m2.player_b, 'the wrong champion after a walkover';
  assert (select completed_at from tournaments where id = t) is not null, 'completed_at not set';
  -- correcting a match whose next match has been played is refused even though
  -- that match's winner column is empty (deleted account)
  begin
    perform report_match_result(m1.id, m1.player_b, 'too late');
    assert false, 'a result was changed after the next round was played (winner deleted)';
  exception when raise_exception then null;
  end;
end $$;
reset role;
delete from tournaments where id = '00000000-0000-4000-8000-0000000005aa';

-- ---- 9k. Meetups in a city other than your home one are readable ----
-- The app shows a member the meetups for every city they have selected, and a
-- member can select cities beyond their home one — so the database must let
-- them read an event in a city that is not profiles.city. (Which cities' events
-- appear is the app's choice of query; the app asks only for selected cities.)
reset role;
insert into events (title, venue, starts_at, sport, capacity, city)
values ('Green Lake Social', 'Green Lake Courts', now() + interval '5 days', 'pickleball', 12, 'seattle');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002'; -- Diego, in Indianapolis
do $$
declare c int;
begin
  assert (get_my_profile() ->> 'city') <> 'seattle',
         'test setup: this member should not be in Seattle';
  select count(*) into c from events where city = 'seattle';
  assert c >= 1, 'a member cannot see meetups outside their own city';
  select count(*) into c from events;
  assert c >= 2, 'events from more than one city should be readable';
end $$;
reset role;
delete from events where title = 'Green Lake Social';

-- ---- 9l. Suspension actually stops someone ----
-- The desk could mark a report "actioned" and nothing happened; the privacy
-- policy says we enforce bans. Every one of these is a thing a suspended
-- member must no longer be able to do, and the last two are things they must
-- still be able to do.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';  -- Aaron, not an admin

do $$
declare ok boolean;
begin
  ok := suspend_member('00000000-0000-4000-8000-000000000002', 'test');
  assert ok = false, 'a non-admin was able to suspend someone';
  assert (select suspended_at from profiles where id = '00000000-0000-4000-8000-000000000002') is null,
    'a non-admin suspension changed the row anyway';
end $$;

-- Now as a real admin.
insert into admins (user_id) values ('00000000-0000-4000-8000-000000000001')
  on conflict do nothing;

do $$
declare ok boolean; n int;
begin
  ok := suspend_member('00000000-0000-4000-8000-000000000001', 'cannot suspend yourself');
  assert ok = false, 'an admin suspended themselves, locking out the only person who could undo it';

  ok := suspend_member('00000000-0000-4000-8000-000000000002', 'abusive messages');
  assert ok = true, 'suspend_member refused an admin';
  assert (select suspended_at from profiles where id = '00000000-0000-4000-8000-000000000002') is not null,
    'suspend_member did not set suspended_at';

  select count(*) into n from matches
   where closed_at is null
     and (user_a = '00000000-0000-4000-8000-000000000002' or user_b = '00000000-0000-4000-8000-000000000002');
  assert n = 0, format('suspension left %s open conversation(s)', n);
end $$;

-- Nobody sees them in discovery any more.
do $$
declare ids uuid[];
begin
  select array_agg(user_id) into ids from get_discovery_deck('date', 50);
  assert not ('00000000-0000-4000-8000-000000000002' = any(coalesce(ids, '{}'))),
    'a suspended member is still in the deck';
end $$;

-- And their own deck is empty, so they cannot start anything new.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
do $$
declare n int;
begin
  select count(*) into n from get_discovery_deck('date', 50);
  assert n = 0, format('a suspended member still had %s card(s) to swipe', n);
end $$;

-- Writes are refused, not silently dropped. RLS does not apply to the table
-- owner, so these have to run as `authenticated` the way the app does.
set role authenticated;
do $$
declare failed boolean;
begin
  begin
    insert into swipes (actor_id, target_id, mode, action)
    values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'date', 'like');
    failed := false;
  exception when others then failed := true;
  end;
  assert failed, 'a suspended member could still swipe';

  begin
    insert into event_rsvps (event_id, user_id)
    select id, '00000000-0000-4000-8000-000000000002' from events limit 1;
    failed := false;
  exception when others then failed := true;
  end;
  assert failed, 'a suspended member could still RSVP to an event';

  begin
    insert into messages (match_id, sender_id, body)
    select id, '00000000-0000-4000-8000-000000000002', 'let me back in'
      from matches
     where user_a = '00000000-0000-4000-8000-000000000002'
        or user_b = '00000000-0000-4000-8000-000000000002'
     limit 1;
    failed := false;
  exception when others then failed := true;
  end;
  assert failed, 'a suspended member could still send a message';
end $$;

-- They can still see their own profile, so the app works well enough to leave.
do $$
declare me jsonb;
begin
  me := get_my_profile();
  assert me is not null, 'a suspended member cannot load their own profile';
  assert (me->>'suspended_at') is not null, 'their own profile does not tell them they are suspended';
end $$;

-- Other members cannot read the suspension state off the row.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$
declare n int;
begin
  select count(*) into n from profiles where id = '00000000-0000-4000-8000-000000000002';
  assert n = 0, 'a suspended profile is still selectable by another member';
end $$;
reset role;

-- Undo restores them.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
do $$
declare ok boolean; n int;
begin
  ok := unsuspend_member('00000000-0000-4000-8000-000000000002');
  assert ok = true, 'unsuspend_member refused an admin';
  assert (select suspended_at from profiles where id = '00000000-0000-4000-8000-000000000002') is null,
    'unsuspend did not clear suspended_at';
  select count(*) into n from get_discovery_deck('date', 50);
  assert n > 0, 'the admin deck is empty after an unsuspend, which means something else broke';
end $$;

delete from admins where user_id = '00000000-0000-4000-8000-000000000001';

-- ---- 10. Account deletion removes everything ----
-- The account-deletion page (landing/delete-account.html) promises each of
-- these by name, and the store data-safety forms declare them. Give the user
-- something in every one of those tables first, so the assertions below are
-- proving a deletion rather than an absence.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000012';
insert into storage.objects (bucket_id, name)
values ('photos', '00000000-0000-4000-8000-000000000012/gone.jpg');
insert into profile_photos (user_id, storage_path, position)
values ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012/gone.jpg', 0);
insert into push_tokens (user_id, token, platform)
values ('00000000-0000-4000-8000-000000000012', 'ExponentPushToken[test-delete]', 'ios');
insert into devices (user_id, device_key, name, platform)
values ('00000000-0000-4000-8000-000000000012', 'devkey-delete-test', 'Lena''s iPhone', 'ios');
insert into reports (reporter_id, target_id, reason)
values ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 'test report');
insert into blocks (blocker_id, blocked_id)
values ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000003');

-- A like each way, which fires the match trigger, then a message in it and an
-- RSVP — so the account has a row in every table before it is deleted.
insert into swipes (actor_id, target_id, mode, action)
values ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000005', 'date', 'like'),
       ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000012', 'date', 'like');
insert into messages (match_id, sender_id, body)
select id, '00000000-0000-4000-8000-000000000012', 'see you on court'
  from matches
 where user_a = '00000000-0000-4000-8000-000000000012'
    or user_b = '00000000-0000-4000-8000-000000000012'
 limit 1;
insert into event_rsvps (event_id, user_id)
select id, '00000000-0000-4000-8000-000000000012' from events limit 1;

-- Joined the waitlist before making an account, which is the ordinary order of
-- events for anyone who found RSVPlay through the website.
insert into waitlist (email, city, source)
values ((select lower(email) from auth.users where id = '00000000-0000-4000-8000-000000000012'), 'indianapolis', 'delete-test');

do $$
declare c int; t text;
begin
  foreach t in array array[
    'select count(*) from swipes where actor_id = $1 or target_id = $1',
    'select count(*) from matches where user_a = $1 or user_b = $1',
    'select count(*) from messages where sender_id = $1',
    'select count(*) from notifications where user_id = $1',
    'select count(*) from event_rsvps where user_id = $1'
  ] loop
    execute t into c using '00000000-0000-4000-8000-000000000012'::uuid;
    assert c > 0, format('test setup produced no rows for: %s', t);
  end loop;
end $$;

select delete_account();

do $$
declare c int; t text;
begin
  foreach t in array array[
    'select count(*) from auth.users where id = $1',
    'select count(*) from profiles where id = $1',
    'select count(*) from profile_photos where user_id = $1',
    'select count(*) from swipes where actor_id = $1 or target_id = $1',
    'select count(*) from matches where user_a = $1 or user_b = $1',
    'select count(*) from messages where sender_id = $1',
    'select count(*) from notifications where user_id = $1',
    'select count(*) from event_rsvps where user_id = $1',
    'select count(*) from push_tokens where user_id = $1',
    'select count(*) from devices where user_id = $1',
    'select count(*) from reports where reporter_id = $1 or target_id = $1',
    'select count(*) from blocks where blocker_id = $1 or blocked_id = $1',
    'select count(*) from apple_identities where user_id = $1',
    'select count(*) from user_sports where user_id = $1'
  ] loop
    execute t into c using '00000000-0000-4000-8000-000000000012'::uuid;
    assert c = 0, format('account deletion left %s row(s) behind: %s', c, t);
  end loop;
  -- Photo objects go too, so a deleted member's images cannot be served.
  select count(*) into c from storage.objects
   where name like '00000000-0000-4000-8000-000000000012/%';
  assert c = 0, format('account deletion left %s photo object(s) in storage', c);
end $$;

-- The waitlist is keyed on an email address rather than a user id, so nothing
-- cascades to it. The deletion page tells Play that the email is deleted.
do $$
declare c int;
begin
  select count(*) into c from waitlist where source = 'delete-test';
  assert c = 0, format('account deletion left %s waitlist row(s) under the deleted address', c);
end $$;

-- Belt and braces: every uuid column of every public table, swept for the
-- deleted member's id. A table added later that holds user data and forgets to
-- cascade fails here rather than in someone's deletion request.
do $$
declare
  r record;
  c int;
  uid uuid := '00000000-0000-4000-8000-000000000012';
begin
  for r in
    select col.table_name, col.column_name
      from information_schema.columns col
      join information_schema.tables t
        on t.table_schema = col.table_schema and t.table_name = col.table_name
     where col.table_schema = 'public'
       and col.data_type = 'uuid'
       and t.table_type = 'BASE TABLE'
  loop
    execute format('select count(*) from public.%I where %I = $1', r.table_name, r.column_name)
      into c using uid;
    assert c = 0, format('account deletion left %s row(s) in %s.%s', c, r.table_name, r.column_name);
  end loop;
end $$;

-- ---- 9m. The two privacy gaps (migration 20260806000030) ----
-- Gap 1: other members' settings were readable column by column (9g now checks
-- that only id and first_name are), and a member could write any column of
-- their own row — including lifting their own suspension. Gap 2: the deck gave
-- distance to a tenth of a mile and a member could put themselves anywhere, as
-- often as they liked, so three readings found another member's home square.
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000601', 'gap-prober@example.com'),
  ('00000000-0000-4000-8000-000000000602', 'gap-target@example.com'),
  ('00000000-0000-4000-8000-000000000603', 'gap-suspended@example.com'),
  ('00000000-0000-4000-8000-000000000604', 'gap-newcomer@example.com');
insert into profiles (id, first_name, birthdate, city, modes, gender, seeking, age_min, age_max, radius_mi,
                      approx_lat, approx_lng, is_team, partner_name, partner_gender, partner_birthdate, play_games)
values
  ('00000000-0000-4000-8000-000000000601', 'Prober', '1990-01-01', 'phoenix', '{date}', 'man', '{woman}', 18, 99, 50,
   33.53, -112.07, false, '', null, null, '{singles,doubles,mixed_doubles}'),
  ('00000000-0000-4000-8000-000000000602', 'Target', '1991-01-01', 'phoenix', '{date}', 'woman', '{man}', 18, 99, 50,
   33.41, -112.09, false, '', null, null, '{singles}'),
  ('00000000-0000-4000-8000-000000000603', 'Paused', '1992-01-01', 'phoenix', '{play}', 'woman', '{}', 18, 99, 50,
   33.45, -112.07, true, 'Pat', 'woman', '1993-01-01', '{doubles}');
update profiles set suspended_at = now(), suspended_reason = 'test'
 where id = '00000000-0000-4000-8000-000000000603';

-- Writing: a member's own session can't touch what the desk, the phone check
-- or set_my_location own.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000603';
do $$
declare col text; v text; la timestamptz;
begin
  foreach col in array array['suspended_at = null', 'suspended_reason = null', 'verified_at = now()',
                             'phone_verified_at = now()', 'created_at = now() - interval ''1 year''',
                             'approx_lat = 40.00', 'approx_lng = -80.00',
                             'location_updated_at = now()', 'gender_updated_at = now()',
                             'team_updated_at = now()'] loop
    begin
      execute format('update profiles set %s where id = auth.uid()', col);
      assert false, format('a member could set %s on their own profile', col);
    exception when insufficient_privilege then null;
    end;
  end loop;
  -- the ordinary parts of a profile still save
  update profiles set bio = 'still here' where id = auth.uid();
  -- and "last active" means now, whatever the app sends
  update profiles set last_active_at = '2099-01-01' where id = auth.uid();
end $$;
reset role;
do $$
declare r record;
begin
  select bio, suspended_at, last_active_at into r from profiles where id = '00000000-0000-4000-8000-000000000603';
  assert r.bio = 'still here', 'an ordinary profile edit did not save';
  assert r.suspended_at is not null, 'a suspended member lifted their own suspension';
  assert r.last_active_at <= now() + interval '1 minute', format('last_active_at accepted a future date: %s', r.last_active_at);
end $$;

-- Saving a profile the way the app does it: insert, and if the row is already
-- there, update. (An INSERT ... ON CONFLICT DO UPDATE — PostgREST's upsert —
-- needs read access to every column it copies from EXCLUDED, so with only id
-- and first_name readable it is refused; it already was for birthdate since
-- migration 18, which is why the app no longer uses it.) A new row can't
-- arrive verified or with a position, and last_active_at means now.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000604';
do $$
begin
  insert into profiles (id, first_name, birthdate, city, approx_lat, approx_lng, verified_at, last_active_at)
  values (auth.uid(), 'Newcomer', '1994-05-05', 'phoenix', 33.45, -112.07, now(), '2099-01-01');
  begin
    insert into profiles (id, first_name, birthdate, city)
    values (auth.uid(), 'Newcomer Two', '1994-05-05', 'phoenix');
    assert false, 'a second insert of the same profile should hit the unique key';
  exception when unique_violation then
    update profiles set first_name = 'Newcomer Two', birthdate = '1994-05-05', city = 'phoenix',
                        last_active_at = now()
     where id = auth.uid();
  end;
  -- and the upsert form really is refused, so nobody reintroduces it
  begin
    insert into profiles (id, first_name, birthdate) values (auth.uid(), 'X', '1994-05-05')
    on conflict (id) do update set first_name = excluded.first_name, birthdate = excluded.birthdate;
    assert false, 'an upsert copying unreadable columns from EXCLUDED was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
declare r record;
begin
  select * into r from profiles where id = '00000000-0000-4000-8000-000000000604';
  assert r.first_name = 'Newcomer Two', 'the update after a duplicate insert did not save';
  assert r.verified_at is null, 'a new profile arrived already verified';
  assert r.approx_lat is null and r.approx_lng is null, 'a new profile set its own position';
  assert r.last_active_at <= now() + interval '1 minute', 'a new profile set a future last_active_at';
end $$;

-- Moving: only through set_my_location — a real place, and a new square at
-- most once every six hours.
set role anon;
do $$
begin
  begin
    perform set_my_location(33.45, -112.07);
    assert false, 'a signed-out visitor called set_my_location';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000604';
do $$
declare res jsonb; r record;
begin
  foreach res in array array['[95, 0]', '[0, 200]', '[null, 1]']::jsonb[] loop
    begin
      perform set_my_location((res ->> 0)::numeric, (res ->> 1)::numeric);
      assert false, format('set_my_location accepted %s', res);
    exception when invalid_parameter_value then null;
    end;
  end loop;

  res := set_my_location(33.454, -112.071);                    -- first position: always fine
  assert (res ->> 'accepted')::boolean and (res ->> 'moved')::boolean, format('first position refused: %s', res);
  assert (get_my_profile() ->> 'approx_lat')::numeric = 33.45, 'position not rounded to 2 decimals';

  res := set_my_location(33.47, -112.06);                       -- same square: fine, not a move
  assert (res ->> 'accepted')::boolean and not (res ->> 'moved')::boolean, format('a move inside the square was refused: %s', res);
  assert (get_my_profile() ->> 'approx_lat')::numeric = 33.47, 'a move inside the square was not stored';

  res := set_my_location(33.70, -112.07);                       -- a new square, straight away: no
  assert not (res ->> 'accepted')::boolean, format('a second square within six hours was accepted: %s', res);
  assert res ? 'retry_after', 'a refused move should say when it can happen';
  assert (get_my_profile() ->> 'approx_lat')::numeric = 33.47, 'a refused move still changed the position';
end $$;
reset role;
update profiles set location_updated_at = now() - interval '7 hours'
 where id = '00000000-0000-4000-8000-000000000604';
set role authenticated;
do $$
declare res jsonb;
begin
  res := set_my_location(33.70, -112.07);
  assert (res ->> 'accepted')::boolean and (res ->> 'moved')::boolean, format('a move after six hours was refused: %s', res);
  assert (get_my_profile() ->> 'approx_lat')::numeric = 33.70, 'the accepted move was not stored';
end $$;
reset role;

-- Cards: signed in only; no suspended members; what a card shows and no more.
set role anon;
do $$
begin
  begin
    perform get_profile_cards(array['00000000-0000-4000-8000-000000000602']::uuid[]);
    assert false, 'a signed-out visitor got a profile card';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from get_discovery_deck('date', 20);
    assert false, 'a signed-out visitor called the deck';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
do $$
declare cards jsonb; card jsonb; k text;
begin
  cards := get_profile_cards(array['00000000-0000-4000-8000-000000000602',
                                   '00000000-0000-4000-8000-000000000603']::uuid[]);
  assert jsonb_array_length(cards) = 1, format('expected only the unsuspended card, got %s', cards);
  card := cards -> 0;
  assert card ->> 'id' = '00000000-0000-4000-8000-000000000602', 'wrong card came back';
  assert (card -> 'verified') = 'false'::jsonb, format('card should carry verified as a yes/no: %s', card -> 'verified');
  assert card -> 'play_games' = '["singles"]'::jsonb, format('card is missing play_games: %s', card -> 'play_games');
  assert card ? 'partner_gender', 'card is missing partner_gender';
  foreach k in array array['city', 'last_active_at', 'verified_at', 'seeking', 'modes',
                           'age_min', 'age_max', 'radius_mi', 'extra_cities', 'birthdate',
                           'approx_lat', 'approx_lng', 'suspended_at'] loop
    assert not (card ? k), format('profile card still carries %s', k);
  end loop;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000603';
do $$
declare cards jsonb;
begin
  cards := get_profile_cards(array['00000000-0000-4000-8000-000000000603']::uuid[]);
  assert jsonb_array_length(cards) = 1, 'a suspended member cannot get their own card';
  assert cards -> 0 ->> 'partner_gender' = 'woman', 'a team card lost the partner''s gender';
end $$;

-- Distance: whole miles between grid squares. Moving around inside your own
-- square, or the other member moving inside theirs, changes nothing — so no
-- number of readings can place someone more precisely than their square.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
do $$
declare d1 numeric; d2 numeric; d3 numeric;
begin
  select distance_mi into d1 from get_discovery_deck('date', 100)
   where user_id = '00000000-0000-4000-8000-000000000602';
  assert d1 is not null, 'test setup: the target should be in the prober''s deck with a distance';
  assert d1 = round(d1), format('distance is not in whole miles: %s', d1);
  -- 33.53 and 33.41 sit in squares centred 33.54 and 33.42: 0.12° of latitude
  assert d1 = 8, format('expected 8 miles between the two squares, got %s', d1);
end $$;
reset role;
-- the prober moves around inside their own square (as many times as they like)
update profiles set approx_lat = 33.55, approx_lng = -112.09 where id = '00000000-0000-4000-8000-000000000601';
set role authenticated;
do $$
declare d numeric;
begin
  select distance_mi into d from get_discovery_deck('date', 100)
   where user_id = '00000000-0000-4000-8000-000000000602';
  assert d = 8, format('moving inside your own square changed the distance shown: %s', d);
end $$;
reset role;
-- the target moves inside theirs
update profiles set approx_lat = 33.43, approx_lng = -112.06 where id = '00000000-0000-4000-8000-000000000602';
set role authenticated;
do $$
declare d numeric; n int;
begin
  select distance_mi into d from get_discovery_deck('date', 100)
   where user_id = '00000000-0000-4000-8000-000000000602';
  assert d = 8, format('the target moving inside their square changed the distance shown: %s', d);

  -- the radius filter sees squares too
  update profiles set radius_mi = 7 where id = auth.uid();
  assert not exists (select 1 from get_discovery_deck('date', 100)
                      where user_id = '00000000-0000-4000-8000-000000000602'),
    'an 8-mile member showed up inside a 7-mile radius';
  update profiles set radius_mi = 8 where id = auth.uid();
  assert exists (select 1 from get_discovery_deck('date', 100)
                  where user_id = '00000000-0000-4000-8000-000000000602'),
    'an 8-mile member was missing from an 8-mile radius';
  update profiles set radius_mi = 50 where id = auth.uid();

  -- p_limit is capped, and a silly value still returns something sensible
  select count(*) into n from get_discovery_deck('date', 0);
  assert n = 1, format('a deck asked for 0 cards should return 1, got %s', n);
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000602';
do $$
declare d numeric;
begin
  update profiles set seeking = '{man,woman}' where id = auth.uid();
  -- the same 8 miles, from the other end
  select distance_mi into d from get_discovery_deck('date', 100)
   where user_id = '00000000-0000-4000-8000-000000000601';
  assert d = 8, format('distance should read the same from either end, got %s', d);
end $$;
reset role;
do $$
begin
  -- 33.42 and 33.43 share the square centred 33.42, as do -112.08 and -112.06;
  -- two members there are 0 miles apart, which the deck shows as 1
  assert grid_lat(33.42) = grid_lat(33.43) and grid_lng(-112.08) = grid_lng(-112.06),
    'test setup: these two points should share a square';
  assert miles_between(grid_lat(33.42), grid_lng(-112.08), grid_lat(33.43), grid_lng(-112.06)) = 0,
    'two points in one square should be 0 miles apart before the 1-mile floor';
end $$;
-- From the independent review: the deck only shows people whose preferences
-- fit you, so a member who could rewrite their own birthdate and gender at will
-- could read other members' age ranges and "looking for" off it. Birthdate is
-- fixed once the profile exists; gender changes freely in the first hour, then
-- once every 30 days.
reset role;
update profiles set created_at = now() - interval '2 days'
 where id = '00000000-0000-4000-8000-000000000603';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000603';
do $$
begin
  begin
    update profiles set birthdate = '1980-01-01' where id = auth.uid();
    assert false, 'a member changed their own birthdate';
  exception when insufficient_privilege then null;
  end;
  -- re-saving the same birthdate (the app's save sends it) is not a change
  update profiles set birthdate = '1992-01-01' where id = auth.uid();
  update profiles set gender = 'man' where id = auth.uid();          -- first change: fine
  begin
    update profiles set gender = 'nonbinary' where id = auth.uid();  -- second, same month: no
    assert false, 'a member changed gender twice in a month';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update profiles set gender_updated_at = now() - interval '31 days'
 where id = '00000000-0000-4000-8000-000000000603';
set role authenticated;
do $$
begin
  update profiles set gender = 'woman' where id = auth.uid();        -- a month on: fine again
end $$;
-- a brand-new profile can fix a mis-tap straight away, more than once
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000604';
do $$
begin
  update profiles set gender = 'woman' where id = auth.uid();
  update profiles set gender = 'man' where id = auth.uid();
  update profiles set gender = 'nonbinary' where id = auth.uid();
end $$;
reset role;
do $$
begin
  assert (select gender from profiles where id = '00000000-0000-4000-8000-000000000603') = 'woman',
    'the gender change after 30 days did not save';
  assert (select gender from profiles where id = '00000000-0000-4000-8000-000000000604') = 'nonbinary',
    'a new profile could not correct its gender';
  assert (select gender_updated_at from profiles where id = '00000000-0000-4000-8000-000000000604') is null,
    'changes in the first hour should not start the 30-day clock';
end $$;

-- The deck ranks by its score but no longer hands it out: subtracting the
-- visible parts from it said who had aced you and who was active this week.
do $$
begin
  assert pg_get_function_result('public.get_discovery_deck(public.app_mode, int)'::regprocedure) not like '%score%',
    'the deck still returns its matching score';
  assert pg_get_function_result('public.get_discovery_deck(public.app_mode, int)'::regprocedure) not like '%last_active%',
    'the deck returns a last-active time';
end $$;

-- A small radius still covers your own square and the eight around it: the
-- target, moved into the square next to the prober's (about 3 miles between
-- centres), is in a 1-mile radius; at 8 miles out they are not.
update profiles set approx_lat = 33.50, approx_lng = -112.07 where id = '00000000-0000-4000-8000-000000000602';
update profiles set radius_mi = 1 where id = '00000000-0000-4000-8000-000000000601';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
do $$
declare d numeric;
begin
  select distance_mi into d from get_discovery_deck('date', 100)
   where user_id = '00000000-0000-4000-8000-000000000602';
  assert d = 3, format('a member in the next square should be in a 1-mile radius, 3 miles away; got %s', d);
end $$;
reset role;
update profiles set approx_lat = 33.41, approx_lng = -112.09 where id = '00000000-0000-4000-8000-000000000602';
set role authenticated;
do $$
begin
  assert not exists (select 1 from get_discovery_deck('date', 100)
                      where user_id = '00000000-0000-4000-8000-000000000602'),
    'an 8-mile member showed up in a 1-mile radius';
end $$;
reset role;
delete from auth.users where id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602',
                                    '00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000604');

-- ---- 9n. The privacy follow-ups (migration 20260806000031) ----
-- is_blocked() and is_suspended() answered for any ids; members now only get
-- helpers that answer about themselves. And a doubles partner can't be added
-- and removed at will to probe someone's play-partner preference.
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000701', 'fu-a@example.com'),
  ('00000000-0000-4000-8000-000000000702', 'fu-b@example.com'),
  ('00000000-0000-4000-8000-000000000703', 'fu-c@example.com'),
  ('00000000-0000-4000-8000-000000000704', 'fu-team-old@example.com'),
  ('00000000-0000-4000-8000-000000000705', 'fu-team-new@example.com');
insert into profiles (id, first_name, birthdate, city, gender) values
  ('00000000-0000-4000-8000-000000000701', 'Ava',   '1990-01-01', 'phoenix', 'woman'),
  ('00000000-0000-4000-8000-000000000702', 'Ben',   '1990-01-01', 'phoenix', 'man'),
  ('00000000-0000-4000-8000-000000000703', 'Cal',   '1990-01-01', 'phoenix', 'man'),
  ('00000000-0000-4000-8000-000000000704', 'Dee',   '1990-01-01', 'phoenix', 'woman'),
  ('00000000-0000-4000-8000-000000000705', 'Eve',   '1990-01-01', 'phoenix', 'woman');
-- Ben and Cal have a block between them; Ava has nothing to do with it.
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000703');
update profiles set created_at = now() - interval '2 days' where id = '00000000-0000-4000-8000-000000000704';

-- Things of Cal's that other members could see before: sports, an event
-- sign-up, an approved photo. And open matches on each side of the block
-- (blocking never closes a match), plus one between Ava and Ben as a control.
insert into user_sports (user_id, sport, level) values
  ('00000000-0000-4000-8000-000000000703', 'tennis', 'advanced');
insert into events (id, title, venue, starts_at, sport, capacity, city) values
  ('00000000-0000-4000-8000-0000000007ee', 'Follow-up Social', 'Court 1', now() + interval '3 days', 'tennis', 10, 'phoenix');
insert into event_rsvps (event_id, user_id) values
  ('00000000-0000-4000-8000-0000000007ee', '00000000-0000-4000-8000-000000000703');
-- (new photos always start pending unless the desk approves them; skip that
-- step here rather than set up an admin session)
alter table profile_photos disable trigger photo_moderation_guard;
insert into profile_photos (user_id, storage_path, position, moderation_status) values
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000703/a.jpg', 0, 'approved');
alter table profile_photos enable trigger photo_moderation_guard;
insert into matches (id, user_a, user_b, mode) values
  ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000703', 'play'),
  ('00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702', 'play'),
  ('00000000-0000-4000-8000-0000000007a3', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000703', 'friends');
insert into swipes (actor_id, target_id, mode, action) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000703', 'date', 'like');
insert into messages (match_id, sender_id, body) values
  ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-000000000702', 'before the block');

-- Nobody can call the originals any more, signed in or not.
set role anon;
do $$
begin
  begin
    perform is_blocked('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000703');
    assert false, 'a signed-out visitor called is_blocked';
  exception when insufficient_privilege then null;
  end;
  begin
    perform hidden_from_me('00000000-0000-4000-8000-000000000703');
    assert false, 'a signed-out visitor called hidden_from_me';
  exception when insufficient_privilege then null;
  end;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000701';  -- Ava
do $$
begin
  begin
    perform is_blocked('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000703');
    assert false, 'a member asked whether two other members have blocked each other';
  exception when insufficient_privilege then null;
  end;
  begin
    perform is_suspended('00000000-0000-4000-8000-000000000703');
    assert false, 'a member asked whether someone else is suspended';
  exception when insufficient_privilege then null;
  end;
  begin
    perform blocked_with_me('00000000-0000-4000-8000-000000000703');
    assert false, 'blocked_with_me should not exist: it would tell a blocked member who blocked them';
  exception when undefined_function then null;
  end;
  -- the helper only answers about Ava, so Ben and Cal's block is invisible to her
  assert not hidden_from_me('00000000-0000-4000-8000-000000000702'), 'Ava sees a block she is not part of';
  assert not hidden_from_me('00000000-0000-4000-8000-000000000703'), 'Ava sees a block she is not part of';
  assert not i_am_suspended(), 'Ava is not suspended';
  assert not hidden_from_me(auth.uid()), 'you are never hidden from yourself';
  -- and she still sees Cal's sports, sign-up and photo while he is in her list
  assert exists (select 1 from user_sports where user_id = '00000000-0000-4000-8000-000000000703'), 'test premise: Ava sees Cal''s sports';
  assert exists (select 1 from event_rsvps where user_id = '00000000-0000-4000-8000-000000000703'), 'test premise: Ava sees Cal''s sign-up';
  assert exists (select 1 from profile_photos where user_id = '00000000-0000-4000-8000-000000000703'), 'test premise: Ava sees Cal''s photo';
  -- a message in an unblocked open match still goes through
  insert into messages (match_id, sender_id, body)
  values ('00000000-0000-4000-8000-0000000007a2', auth.uid(), 'hi Ben');
  assert exists (select 1 from matches where id = '00000000-0000-4000-8000-0000000007a3'), 'test premise: Ava sees her match with Cal';
  assert exists (select 1 from swipes where target_id = '00000000-0000-4000-8000-000000000703'), 'test premise: Ava sees her swipe on Cal';

  -- matches can't be edited by members: swapping the other person in a match
  -- used to let a member message (and show the conversation to) anyone
  begin
    update matches set user_b = '00000000-0000-4000-8000-000000000703'
     where id = '00000000-0000-4000-8000-0000000007a2';
    assert false, 'a member swapped the other person in a match';
  exception when insufficient_privilege then null;
  end;
  begin
    update matches set closed_at = now() where id = '00000000-0000-4000-8000-0000000007a2';
    assert false, 'a member edited a match directly';
  exception when insufficient_privilege then null;
  end;

  -- blocking and reporting go through functions that treat an id with no
  -- profile exactly like a real one: no error either way
  perform block_member('00000000-0000-4000-8000-0000000007ff');
  perform report_member('00000000-0000-4000-8000-0000000007ff', 'made-up id', 'deck');
  perform report_member('00000000-0000-4000-8000-000000000702', 'a real report', 'chat');
  begin
    perform block_member(auth.uid());
    assert false, 'a member blocked themselves';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform report_member('00000000-0000-4000-8000-000000000702', '', 'deck');
    assert false, 'an empty report was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into blocks (blocker_id, blocked_id) values (auth.uid(), '00000000-0000-4000-8000-000000000702');
    assert false, 'a member inserted a block directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into reports (reporter_id, target_id, reason) values (auth.uid(), '00000000-0000-4000-8000-000000000702', 'x');
    assert false, 'a member inserted a report directly';
  exception when insufficient_privilege then null;
  end;
  -- and a member can't read reports back ("actioned" gave away a suspension)
  assert not exists (select 1 from reports), 'a member can read reports they filed';
end $$;
reset role;
do $$
begin
  assert (select count(*) from reports where reporter_id = '00000000-0000-4000-8000-000000000701'
            and target_id = '00000000-0000-4000-8000-000000000702') = 1,
    'report_member did not file the report';
  assert not exists (select 1 from reports where target_id = '00000000-0000-4000-8000-0000000007ff'),
    'a report about a made-up id was stored';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000702';  -- Ben
do $$
begin
  assert hidden_from_me('00000000-0000-4000-8000-000000000703'), 'a blocked member is not hidden from Ben';
  -- everything of Cal's is gone for Ben: profile, sports, sign-up, photo
  assert not exists (select 1 from profiles where id = '00000000-0000-4000-8000-000000000703'),
    'Ben can see the profile of someone he blocked';
  assert not exists (select 1 from user_sports where user_id = '00000000-0000-4000-8000-000000000703'),
    'Ben can see the sports of someone he blocked';
  assert not exists (select 1 from event_rsvps where user_id = '00000000-0000-4000-8000-000000000703'),
    'Ben can see the event sign-ups of someone he blocked';
  assert not exists (select 1 from profile_photos where user_id = '00000000-0000-4000-8000-000000000703'),
    'Ben can see the photos of someone he blocked';
  begin
    insert into swipes (actor_id, target_id, mode, action)
    values (auth.uid(), '00000000-0000-4000-8000-000000000703', 'date', 'like');
    assert false, 'Ben swiped on someone he blocked';
  exception when insufficient_privilege then null;
  end;
  -- the block stops messages in a match that is still open
  begin
    insert into messages (match_id, sender_id, body)
    values ('00000000-0000-4000-8000-0000000007a1', auth.uid(), 'hello?');
    assert false, 'Ben messaged someone he blocked';
  exception when insufficient_privilege then null;
  end;
  -- and Ben still messages Ava, who he hasn't blocked
  insert into messages (match_id, sender_id, body)
  values ('00000000-0000-4000-8000-0000000007a2', auth.uid(), 'hi Ava');
  -- the match with Cal, and its messages, are gone from Ben's view
  assert not exists (select 1 from matches where id = '00000000-0000-4000-8000-0000000007a1'),
    'Ben still sees his match with someone he blocked';
  assert not exists (select 1 from messages where match_id = '00000000-0000-4000-8000-0000000007a1'),
    'Ben still sees messages with someone he blocked';
  -- undo on a hidden person always says yes (a match with messages would
  -- otherwise say no, which a suspension's closed match would not)
  assert undo_swipe('00000000-0000-4000-8000-000000000703', 'play'),
    'undo_swipe on a hidden person should take the swipe back without a word';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000703';  -- Cal, on the other end of the block
do $$
begin
  -- the blocked side: the helper says only "hidden", never "blocked you"
  assert hidden_from_me('00000000-0000-4000-8000-000000000702'), 'Ben is not hidden from Cal';
  begin
    insert into messages (match_id, sender_id, body)
    values ('00000000-0000-4000-8000-0000000007a1', auth.uid(), 'why?');
    assert false, 'Cal messaged someone who blocked him';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Suspension: a suspended account looks exactly like one that doesn't exist.
reset role;
update profiles set suspended_at = now() where id = '00000000-0000-4000-8000-000000000703';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000701';  -- Ava
do $$
begin
  assert hidden_from_me('00000000-0000-4000-8000-000000000703'), 'a suspended member is not hidden';
  assert hidden_from_me('00000000-0000-4000-8000-0000000007ff'), 'an id with no profile should look the same as a suspended one';
  assert not exists (select 1 from profiles where id = '00000000-0000-4000-8000-000000000703'),
    'a suspended profile is in the list';
  -- and nothing else of his gives it away
  assert not exists (select 1 from user_sports where user_id = '00000000-0000-4000-8000-000000000703'),
    'a suspended member''s sports are still visible';
  assert not exists (select 1 from event_rsvps where user_id = '00000000-0000-4000-8000-000000000703'),
    'a suspended member''s event sign-ups are still visible';
  assert not exists (select 1 from profile_photos where user_id = '00000000-0000-4000-8000-000000000703'),
    'a suspended member''s photos are still visible';
  assert not exists (
    select user_id from user_sports
    except select id from profiles
  ), 'some user_sports rows belong to people missing from the profile list';
  assert not exists (
    select user_id from event_rsvps
    except select id from profiles
  ), 'some event sign-ups belong to people missing from the profile list';
  -- her match with Cal, and her own swipe on him, look as if he had left
  assert not exists (select 1 from matches where id = '00000000-0000-4000-8000-0000000007a3'),
    'a match with a suspended member is still visible';
  assert not exists (select 1 from swipes where target_id = '00000000-0000-4000-8000-000000000703'),
    'a swipe on a suspended member is still visible';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000703';  -- Cal, suspended
do $$
begin
  assert i_am_suspended(), 'a suspended member cannot see their own suspension';
  -- his own things stay his to see
  assert exists (select 1 from user_sports where user_id = auth.uid()), 'a suspended member lost sight of their own sports';
  begin
    insert into swipes (actor_id, target_id, mode, action)
    values (auth.uid(), '00000000-0000-4000-8000-000000000701', 'date', 'like');
    assert false, 'a suspended member swiped';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from event_rsvps where user_id = auth.uid();   -- leaving is fine...
    insert into event_rsvps (event_id, user_id)            -- ...signing up again is not
    values ('00000000-0000-4000-8000-0000000007ee', auth.uid());
    assert false, 'a suspended member signed up for an event';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
delete from events where id = '00000000-0000-4000-8000-0000000007ee';
set role authenticated;

-- Gender can't be stepped through empty to get a second change in a month.
reset role;
update profiles set created_at = now() - interval '2 days', gender_updated_at = null
 where id = '00000000-0000-4000-8000-000000000702';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000702';  -- Ben
do $$
begin
  update profiles set gender = null where id = auth.uid();          -- a change: uses up the month
  begin
    update profiles set gender = 'woman' where id = auth.uid();     -- and back to a value: no
    assert false, 'gender was stepped through empty for a second change';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A doubles partner: added freely in the first hour, then once every 30
-- days; removing is always allowed; their name is not limited.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000704';  -- Dee, signed up 2 days ago
do $$
begin
  update profiles set is_team = true, partner_name = 'Fay', partner_birthdate = '1991-01-01',
                      partner_gender = 'woman', modes = '{play}'
   where id = auth.uid();                                             -- first add: fine
  update profiles set partner_name = 'Faye' where id = auth.uid();    -- a typo fix: fine
  begin
    update profiles set partner_gender = 'man' where id = auth.uid(); -- partner's gender again: no
    assert false, 'a partner''s gender changed twice in a month';
  exception when insufficient_privilege then null;
  end;
  update profiles set is_team = false, partner_name = '', partner_birthdate = null, partner_gender = null
   where id = auth.uid();                                             -- removing: always fine
  begin
    update profiles set is_team = true, partner_name = 'Gus', partner_birthdate = '1991-01-01',
                        partner_gender = 'man'
     where id = auth.uid();                                           -- re-adding straight away: no
    assert false, 'a partner was added, removed and added again within a month';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
update profiles set team_updated_at = now() - interval '31 days' where id = '00000000-0000-4000-8000-000000000704';
set role authenticated;
do $$
begin
  update profiles set is_team = true, partner_name = 'Gus', partner_birthdate = '1991-01-01',
                      partner_gender = 'man'
   where id = auth.uid();                                             -- a month on: fine
end $$;
-- a brand-new profile can set up its partner as many times as it needs to
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000705';  -- Eve, just signed up
do $$
begin
  update profiles set is_team = true, partner_name = 'Hal', partner_birthdate = '1991-01-01',
                      partner_gender = 'man', modes = '{play}' where id = auth.uid();
  update profiles set partner_gender = 'woman' where id = auth.uid();
  update profiles set is_team = false, partner_name = '', partner_birthdate = null, partner_gender = null
   where id = auth.uid();
  update profiles set is_team = true, partner_name = 'Ivy', partner_birthdate = '1991-01-01',
                      partner_gender = 'woman' where id = auth.uid();
end $$;
reset role;
do $$
begin
  assert (select partner_name from profiles where id = '00000000-0000-4000-8000-000000000704') = 'Gus',
    'the partner added after 30 days did not save';
  assert (select team_updated_at from profiles where id = '00000000-0000-4000-8000-000000000704') > now() - interval '1 minute',
    'adding a partner did not restart the 30-day clock';
  assert (select partner_name from profiles where id = '00000000-0000-4000-8000-000000000705') = 'Ivy',
    'a new profile could not set up its partner';
  assert (select team_updated_at from profiles where id = '00000000-0000-4000-8000-000000000705') is null,
    'changes in the first hour should not start the 30-day clock';
end $$;
delete from auth.users where id in ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000702',
                                    '00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000704',
                                    '00000000-0000-4000-8000-000000000705');

-- ---- 9o. Tournaments don't tell a block from a suspension (migration 20260806000032) ----
-- Ava watches a tournament that Ben (who blocked her), Cal and Dan entered.
-- When Cal is suspended he must vanish the way someone who leaves does, so
-- every entrant still counted but hidden from Ava is a block, and is drawn.
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000801', 'tp-ava@example.com'),
  ('00000000-0000-4000-8000-000000000802', 'tp-ben@example.com'),
  ('00000000-0000-4000-8000-000000000803', 'tp-cal@example.com'),
  ('00000000-0000-4000-8000-000000000804', 'tp-dan@example.com');
insert into profiles (id, first_name, birthdate, city, gender) values
  ('00000000-0000-4000-8000-000000000801', 'Ava', '1990-01-01', 'phoenix', 'woman'),
  ('00000000-0000-4000-8000-000000000802', 'Ben', '1990-01-01', 'phoenix', 'man'),
  ('00000000-0000-4000-8000-000000000803', 'Cal', '1990-01-01', 'phoenix', 'man'),
  ('00000000-0000-4000-8000-000000000804', 'Dan', '1990-01-01', 'phoenix', 'man');
insert into blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000801');
insert into tournaments (id, city, title, starts_at, max_entries) values
  ('00000000-0000-4000-8000-0000000008a1', 'phoenix', 'Open Cup',  now() + interval '3 days', 8),
  ('00000000-0000-4000-8000-0000000008a2', 'phoenix', 'Drawn Cup', now() + interval '1 day', 8);
insert into tournament_entries (tournament_id, user_id) values
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-000000000801'),
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-000000000802'),
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-000000000803'),
  ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-000000000804'),
  ('00000000-0000-4000-8000-0000000008a2', '00000000-0000-4000-8000-000000000803'),
  ('00000000-0000-4000-8000-0000000008a2', '00000000-0000-4000-8000-000000000804');
-- The second one is drawn before anything happens.
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
select start_tournament('00000000-0000-4000-8000-0000000008a2');
select suspend_member('00000000-0000-4000-8000-000000000803', 'test');
do $$
begin
  -- withdrawn where entries are open, the count follows ...
  assert not exists (select 1 from tournament_entries
                      where tournament_id = '00000000-0000-4000-8000-0000000008a1'
                        and user_id = '00000000-0000-4000-8000-000000000803'),
    'a suspended member is still entered in a tournament taking entries';
  assert (select entry_count from tournaments where id = '00000000-0000-4000-8000-0000000008a1') = 3,
    'the entry count still includes the suspended member';
  -- ... but a drawn bracket keeps its place
  assert exists (select 1 from tournament_entries
                  where tournament_id = '00000000-0000-4000-8000-0000000008a2'
                    and user_id = '00000000-0000-4000-8000-000000000803'),
    'suspension took a player out of a bracket that was already drawn';
  assert (select entry_count from tournaments where id = '00000000-0000-4000-8000-0000000008a2') = 2,
    'the drawn tournament''s count changed';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000801';  -- Ava
do $$
declare
  counted int;
  seen int;
begin
  select entry_count into counted from tournaments where id = '00000000-0000-4000-8000-0000000008a1';
  select count(*) into seen from tournament_entries where tournament_id = '00000000-0000-4000-8000-0000000008a1';
  -- Ava sees herself and Dan; the one counted entrant she can't see is Ben
  assert seen = 2 and counted = 3, format('Ava sees %s of %s', seen, counted);
end $$;
reset role;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
select start_tournament('00000000-0000-4000-8000-0000000008a1');
do $$
begin
  -- every entrant Ava was counting is in the draw, Ben included
  assert (select count(*) from (
            select player_a from tournament_matches where tournament_id = '00000000-0000-4000-8000-0000000008a1' and round = 1 and player_a is not null
            union all
            select player_b from tournament_matches where tournament_id = '00000000-0000-4000-8000-0000000008a1' and round = 1 and player_b is not null) x)
         = (select entry_count from tournaments where id = '00000000-0000-4000-8000-0000000008a1'),
    'the draw and the entry count disagree';
  assert exists (select 1 from tournament_matches
                  where tournament_id = '00000000-0000-4000-8000-0000000008a1'
                    and '00000000-0000-4000-8000-000000000802' in (player_a, player_b)),
    'the blocked entrant was left out of the draw';
end $$;
-- Lifting the suspension doesn't put him back; he can enter something new.
select unsuspend_member('00000000-0000-4000-8000-000000000803');
insert into tournaments (id, city, title, starts_at, max_entries) values
  ('00000000-0000-4000-8000-0000000008a3', 'phoenix', 'Next Cup', now() + interval '5 days', 8);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000803';  -- Cal
select join_tournament('00000000-0000-4000-8000-0000000008a3');
reset role;
do $$
begin
  assert (select entry_count from tournaments where id = '00000000-0000-4000-8000-0000000008a3') = 1,
    'Cal could not enter again after his suspension was lifted';
end $$;
delete from tournaments where id in ('00000000-0000-4000-8000-0000000008a1', '00000000-0000-4000-8000-0000000008a2',
                                     '00000000-0000-4000-8000-0000000008a3');
delete from auth.users where id in ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000802',
                                    '00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000804');

-- ==== 10. The 2026-11 additions (migrations 33–39, m23) ====
-- Kit, Lou, Moe, Nia and Sol are members in Phoenix; Oz runs the desk.
-- Rewritten after the independent review: every stop is asserted from the
-- side that must be refused, not only the side that must work.
reset role;
set request.jwt.claim.sub = '';
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000901', 'x-kit@example.com'), ('00000000-0000-4000-8000-000000000902', 'x-lou@example.com'), ('00000000-0000-4000-8000-000000000903', 'x-moe@example.com'),
  ('00000000-0000-4000-8000-000000000904', 'x-nia@example.com'), ('00000000-0000-4000-8000-000000000905', 'x-oz@example.com'), ('00000000-0000-4000-8000-000000000909', 'x-sol@example.com');
insert into profiles (id, first_name, birthdate, city, gender, seeking, modes, phone_verified_at) values
  ('00000000-0000-4000-8000-000000000901', 'Kit', '1990-01-01', 'phoenix', 'woman', '{man}',   '{date,play}', now()),
  ('00000000-0000-4000-8000-000000000902', 'Lou', '1990-01-01', 'phoenix', 'man',   '{woman}', '{date,play}', now()),
  ('00000000-0000-4000-8000-000000000903', 'Moe', '1990-01-01', 'phoenix', 'man',   '{woman}', '{play}',      now()),
  ('00000000-0000-4000-8000-000000000904', 'Nia', '1990-01-01', 'phoenix', 'woman', '{man}',   '{date,play}', now()),
  ('00000000-0000-4000-8000-000000000905', 'Oz',  '1990-01-01', 'phoenix', 'man',   '{woman}', '{play}',      now()),
  ('00000000-0000-4000-8000-000000000909', 'Sol', '1990-01-01', 'phoenix', 'man',   '{woman}', '{play}',      now());
insert into admins (user_id) values ('00000000-0000-4000-8000-000000000905') on conflict do nothing;
insert into events (id, title, venue, starts_at, sport, capacity, city) values
  ('00000000-0000-4000-8000-0000000009e1', 'Crew Night',  'Test Courts', now() + interval '30 minutes', 'pickleball', 8, 'phoenix'),
  ('00000000-0000-4000-8000-0000000009e3', 'Other Night', 'Test Courts', now() + interval '20 minutes', 'pickleball', 8, 'phoenix'),
  ('00000000-0000-4000-8000-0000000009e4', 'Next Week',   'Test Courts', now() + interval '3 days',     'pickleball', 8, 'phoenix'),
  ('00000000-0000-4000-8000-0000000009e5', 'Long Over',   'Test Courts', now() - interval '9 hours',    'pickleball', 8, 'phoenix');
insert into event_rsvps (event_id, user_id, waiver_accepted_at) values ('00000000-0000-4000-8000-0000000009e5', '00000000-0000-4000-8000-000000000901', now());

-- ---- 10a. Waiver and check-in (migration 33) ----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
begin
  begin
    perform set_event_checkin_code('00000000-0000-4000-8000-0000000009e1', '1111');
    assert false, 'a member set a check-in code';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into event_checkin_codes (event_id, code) values ('00000000-0000-4000-8000-0000000009e1', '1111');
    assert false, 'a member wrote a check-in code';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
select set_event_checkin_code('00000000-0000-4000-8000-0000000009e1', '4821');
select set_event_checkin_code('00000000-0000-4000-8000-0000000009e3', '7777');
select set_event_checkin_code('00000000-0000-4000-8000-0000000009e4', '5555');
select set_event_checkin_code('00000000-0000-4000-8000-0000000009e5', '6666');
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
declare ans jsonb;
begin
  assert (select count(*) from event_checkin_codes) = 0, 'a member can read check-in codes';
  begin
    insert into event_rsvps (event_id, user_id, status) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000901', 'checked_in');
    assert false, 'a member checked themselves in by writing the row';
  exception when insufficient_privilege then null;
  end;
  insert into event_rsvps (event_id, user_id, status, waiver_accepted_at, checked_in_at)
  values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000901', 'going', now(), now());
  assert (select waiver_accepted_at is null and checked_in_at is null
            from get_my_event_stamps() where event_id = '00000000-0000-4000-8000-0000000009e1'),
    'a member forged a waiver or check-in time on insert';
  begin
    perform checked_in_at from event_rsvps where event_id = '00000000-0000-4000-8000-0000000009e1';
    assert false, 'members can read who checked in, and when';
  exception when insufficient_privilege then null;
  end;
  begin
    perform waiver_accepted_at from event_rsvps where event_id = '00000000-0000-4000-8000-0000000009e1';
    assert false, 'members can read when others accepted the waiver';
  exception when insufficient_privilege then null;
  end;
  begin
    perform check_in_event('00000000-0000-4000-8000-0000000009e1', '4821');
    assert false, 'checked in without accepting the waiver';
  exception when insufficient_privilege then
    assert sqlerrm like '%waiver%', sqlerrm;
  end;
  begin
    update event_rsvps set waiver_accepted_at = now() where event_id = '00000000-0000-4000-8000-0000000009e1' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a member forged a waiver by updating the row';
  exception when insufficient_privilege then null;
  end;
  perform accept_event_waiver('00000000-0000-4000-8000-0000000009e1');
  begin
    update event_rsvps set checked_in_at = now() where event_id = '00000000-0000-4000-8000-0000000009e1' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a member forged a check-in time by updating the row';
  exception when insufficient_privilege then null;
  end;
  begin
    update event_rsvps set status = 'checked_in' where event_id = '00000000-0000-4000-8000-0000000009e1' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a member checked themselves in by updating the row';
  exception when insufficient_privilege then null;
  end;
  ans := check_in_event('00000000-0000-4000-8000-0000000009e1', '0000');
  assert not (ans ->> 'ok')::boolean and (ans ->> 'tries_left')::int = 4 and ans ->> 'message' like '%code%',
    format('a wrong code answered %s', ans);
  assert (select checked_in_at is null from get_my_event_stamps() where event_id = '00000000-0000-4000-8000-0000000009e1'), 'a wrong code checked someone in';
  ans := check_in_event('00000000-0000-4000-8000-0000000009e1', ' 4821 ');
  assert (ans ->> 'ok')::boolean, format('the right code answered %s', ans);
  assert (select checked_in_at is not null from get_my_event_stamps() where event_id = '00000000-0000-4000-8000-0000000009e1'), 'the right code did not check in';
  assert (check_in_event('00000000-0000-4000-8000-0000000009e1', 'nonsense') ->> 'ok')::boolean, 'checking in twice is an error';
  -- Attendance is a record: it can't be moved, demoted or deleted by its owner.
  begin
    update event_rsvps set event_id = '00000000-0000-4000-8000-0000000009e3' where event_id = '00000000-0000-4000-8000-0000000009e1' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a checked-in RSVP was moved to another event';
  exception when insufficient_privilege then null;
  end;
  begin
    update event_rsvps set status = 'waitlist' where event_id = '00000000-0000-4000-8000-0000000009e1' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a checked-in RSVP was demoted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from event_rsvps where event_id = '00000000-0000-4000-8000-0000000009e1' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a checked-in RSVP was deleted by its owner';
  exception when insufficient_privilege then null;
  end;
  -- The window: not days early, not after it has closed.
  insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e4', '00000000-0000-4000-8000-000000000901');
  perform accept_event_waiver('00000000-0000-4000-8000-0000000009e4');
  begin
    perform check_in_event('00000000-0000-4000-8000-0000000009e4', '5555');
    assert false, 'checked in three days early';
  exception when invalid_parameter_value then
    assert sqlerrm like '%opens%', sqlerrm;
  end;
  begin
    perform check_in_event('00000000-0000-4000-8000-0000000009e5', '6666');
    assert false, 'checked in nine hours after the start';
  exception when invalid_parameter_value then
    assert sqlerrm like '%closed%', sqlerrm;
  end;
  -- An RSVP that hasn't checked in can still be cancelled, and moved it cannot be.
  begin
    update event_rsvps set event_id = '00000000-0000-4000-8000-0000000009e3' where event_id = '00000000-0000-4000-8000-0000000009e4' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'an RSVP was moved to another event';
  exception when insufficient_privilege then null;
  end;
  delete from event_rsvps where event_id = '00000000-0000-4000-8000-0000000009e4' and user_id = '00000000-0000-4000-8000-000000000901';
  begin
    perform accept_event_waiver('00000000-0000-4000-8000-0000000009e4');
    assert false, 'accepted a waiver for an event with no RSVP';
  exception when no_data_found then null;
  end;
  assert not admin_check_in('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000904'), 'a member used the host''s check-in';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000902');
select accept_event_waiver('00000000-0000-4000-8000-0000000009e1');
do $$ begin assert (check_in_event('00000000-0000-4000-8000-0000000009e1', '4821') ->> 'ok')::boolean; end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000903';
insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000903');
select accept_event_waiver('00000000-0000-4000-8000-0000000009e1');
do $$ begin assert (check_in_event('00000000-0000-4000-8000-0000000009e1', '4821') ->> 'ok')::boolean; end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000904';
insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000904');  -- RSVP'd, never turned up
-- Five wrong codes lock check-in; then even the right code is refused, and
-- only the host can let them in.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000905');
select accept_event_waiver('00000000-0000-4000-8000-0000000009e1');
do $$
declare ans jsonb; i int;
begin
  for i in 1..5 loop ans := check_in_event('00000000-0000-4000-8000-0000000009e1', 'bad' || i); end loop;
  assert (ans ->> 'tries_left')::int = 0 and ans ->> 'message' like 'Too many%', format('fifth wrong code answered %s', ans);
  ans := check_in_event('00000000-0000-4000-8000-0000000009e1', '4821');
  assert not (ans ->> 'ok')::boolean, 'the right code worked after the lock';
  assert (select checked_in_at is null from get_my_event_stamps() where event_id = '00000000-0000-4000-8000-0000000009e1'), 'a locked-out member was checked in';
  assert admin_check_in('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000905'), 'the host could not check someone in by hand';
  assert (select checked_in_at is not null from get_my_event_stamps() where event_id = '00000000-0000-4000-8000-0000000009e1'), 'the host''s check-in did not take';
  assert not admin_check_in('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-000000000904'), 'the host checked in someone who never accepted the waiver';
end $$;

-- The waiver stays on record after an RSVP is cancelled, and nobody reads it
-- through the API.
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert exists (select 1 from waiver_acceptances
                  where event_id = '00000000-0000-4000-8000-0000000009e4'
                    and user_id = '00000000-0000-4000-8000-000000000901'),
    'cancelling an RSVP erased the waiver record';
  -- The project owner in the SQL editor is the desk; no admin row, no session.
  assert is_desk(), 'the SQL editor is not treated as the desk';
  perform set_event_checkin_code('00000000-0000-4000-8000-0000000009e4', '9090');
  assert set_member_tier('00000000-0000-4000-8000-000000000909', 'plus'), 'the owner could not set a tier from the SQL editor';
  assert set_member_tier('00000000-0000-4000-8000-000000000909', 'free');
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$ begin
  begin
    perform count(*) from waiver_acceptances;
    assert false, 'a member can read the waiver record';
  exception when insufficient_privilege then null;
  end;
  begin
    perform is_desk();
    assert false, 'a member can ask whether they are the desk';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- 10b. The crew (migration 33) ----
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
declare ids uuid[];
begin
  select array_agg(user_id order by first_name) into ids from get_my_crew();
  assert ids = array['00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000905']::uuid[], format('crew is %s', ids);  -- not Nia: she never checked in
  assert (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'),
    'two people both open to dating, and fitting, were not told';
  assert not (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000903'),
    'someone not in Date mode was shown as open to dating';
  perform crew_add('00000000-0000-4000-8000-000000000902');
  assert (select added from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'), 'crew_add did not stick';
  begin
    perform crew_add('00000000-0000-4000-8000-000000000904');
    assert false, 'added someone never shared a court with';
  exception when invalid_parameter_value then null;
  end;
  begin
    insert into crew_adds (owner_id, member_id) values ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000904');
    assert false, 'a member wrote crew_adds directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from crew_adds;
    assert false, 'a member can read crew_adds directly';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
do $$ begin
  assert (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000901'), 'the dating flag is not mutual from the other side';
  assert not (select added from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000901'), 'someone else''s add shows as mine';
end $$;
-- Each half of "mutual" matters: take one away at a time, from either side.
reset role;
update profiles set seeking = '{man}' where id = '00000000-0000-4000-8000-000000000902';            -- Lou no longer looking for women
set role authenticated;
do $$ begin assert not (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000901'), 'flag true though I am not looking for them'; end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$ begin assert not (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'), 'flag true though they are not looking for me'; end $$;
reset role;
update profiles set seeking = '{woman}', age_min = 18, age_max = 20 where id = '00000000-0000-4000-8000-000000000902';   -- Kit is outside Lou's age range
set role authenticated;
do $$ begin assert not (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'), 'flag true outside their age range'; end $$;
reset role;
update profiles set age_min = 25, age_max = 55, modes = '{play}' where id = '00000000-0000-4000-8000-000000000902';        -- Lou turns Date mode off
set role authenticated;
do $$ begin assert not (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'), 'flag true with their Date mode off'; end $$;
reset role;
update profiles set modes = '{date,play}' where id = '00000000-0000-4000-8000-000000000902';
set request.jwt.claim.sub = '';
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000901');  -- Moe blocks Kit
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
begin
  assert (select also_open_to_dating from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'), 'restoring the fit did not restore the flag';
  assert not exists (select 1 from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000903'),
    'someone who blocked me is still in my crew';
  begin
    perform crew_add('00000000-0000-4000-8000-000000000903');
    assert false, 'added someone who blocked me';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform * from get_my_crew();
    assert false, 'anon can call get_my_crew';
  exception when insufficient_privilege then null;
  end;
  begin
    perform check_in_event('00000000-0000-4000-8000-0000000009e1', '4821');
    assert false, 'anon can call check_in_event';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---- 10c. Bans stick to the phone number (migrations 34, m23) ----
set request.jwt.claim.sub = '';
update auth.users set phone = '+1 (317) 555-0101', phone_confirmed_at = now() where id = '00000000-0000-4000-8000-000000000902';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$ begin
  assert not ban_member('00000000-0000-4000-8000-000000000903', 'no'), 'a non-admin banned someone';
  begin
    perform count(*) from banned_phones;
    assert false, 'a member can read the ban list';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
do $$ begin
  assert ban_member('00000000-0000-4000-8000-000000000902', 'harassment'), 'an admin could not ban';
end $$;
-- Suspended means stopped, everywhere the new functions reach.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
do $$
begin
  assert (select count(*) from get_my_crew()) = 0, 'a suspended member still sees a crew';
  begin
    perform crew_add('00000000-0000-4000-8000-000000000901');
    assert false, 'a suspended member added to their crew';
  exception when insufficient_privilege then null;
  end;
  begin
    perform check_in_event('00000000-0000-4000-8000-0000000009e1', '4821');
    assert false, 'a suspended member used check-in';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$ begin
  assert not exists (select 1 from get_my_crew() where user_id = '00000000-0000-4000-8000-000000000902'), 'a suspended member is still in my crew';
  assert not unban_member('00000000-0000-4000-8000-000000000902'), 'a non-admin lifted a ban';
end $$;
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert (select suspended_at is not null from profiles where id = '00000000-0000-4000-8000-000000000902'), 'a ban did not suspend';
  assert (select count(*) from banned_phones) = 1, 'a ban did not record the number, or a non-admin lifted it';
  assert not exists (select 1 from banned_phones where phone_hash like '%555%'), 'the ban list holds a raw number';
end $$;
-- The same number, a new email, a new account.
insert into auth.users (id, email, phone, phone_confirmed_at) values ('00000000-0000-4000-8000-000000000906', 'x-pip@example.com', '13175550101', now());
insert into profiles (id, first_name, birthdate, city) values ('00000000-0000-4000-8000-000000000906', 'Pip', '1990-01-01', 'phoenix');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000906';
do $$ begin
  assert not sync_phone_verification(), 'a banned number verified on a new account';
end $$;
reset role;
do $$ begin
  assert (select phone_verified_at is null and suspended_at is not null from profiles where id = '00000000-0000-4000-8000-000000000906'),
    'a banned number''s new account was not stopped';
end $$;
-- A banned number on a new account that never calls sync_phone_verification():
-- the database suspends it the moment the number is attached.
set request.jwt.claim.sub = '';
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000090b', 'x-wes@example.com');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000090b';
insert into profiles (id, first_name, birthdate, city, gender, seeking, modes)
values ('00000000-0000-4000-8000-00000000090b', 'Wes', '1990-01-01', 'phoenix', 'man', '{woman}', '{play}');
do $$ begin
  assert not i_am_suspended(), 'a new account with no phone started suspended';
end $$;
reset role;
update auth.users set phone = '+1 317 555 0101', phone_confirmed_at = now() where id = '00000000-0000-4000-8000-00000000090b';
set role authenticated;
do $$ begin
  assert i_am_suspended(), 'a banned number attached without the sync call was not suspended';
  assert (select count(*) from get_discovery_deck('play', 100)) = 0, 'a banned number can still read the deck';
end $$;
reset role;
set request.jwt.claim.sub = '';
delete from auth.users where id = '00000000-0000-4000-8000-00000000090b';
-- An admin can lift it, and then the number verifies again.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
do $$ begin assert unban_member('00000000-0000-4000-8000-000000000902'), 'an admin could not lift a ban'; end $$;
reset role;
do $$ begin assert (select count(*) from banned_phones) = 0, 'lifting a ban left the number on the list'; end $$;
-- Suspended (not banned), then deletes the account: the number is kept.
set request.jwt.claim.sub = '';
insert into auth.users (id, email, phone, phone_confirmed_at) values ('00000000-0000-4000-8000-000000000907', 'x-quin@example.com', '+13175550142', now());
insert into profiles (id, first_name, birthdate, city, phone_verified_at) values ('00000000-0000-4000-8000-000000000907', 'Quin', '1990-01-01', 'phoenix', now());
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
select suspend_member('00000000-0000-4000-8000-000000000907', 'test');
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000907';
select delete_account();
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000907'), 'delete_account left the account';
  assert (select count(*) from banned_phones) = 1, 'a suspended member shed the suspension by deleting';
end $$;
-- A member in good standing leaves nothing behind.
insert into auth.users (id, email, phone, phone_confirmed_at) values ('00000000-0000-4000-8000-000000000907', 'x-quin2@example.com', '+13175550143', now());
insert into profiles (id, first_name, birthdate, city, phone_verified_at) values ('00000000-0000-4000-8000-000000000907', 'Quin', '1990-01-01', 'phoenix', now());
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000907';
select delete_account();
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert (select count(*) from banned_phones) = 1, 'deleting in good standing put a number on the ban list';
end $$;

-- ---- 10c-ii. A verified phone is required to reach anyone (migration 39) ----
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000908', 'x-rae@example.com');
insert into profiles (id, first_name, birthdate, city) values ('00000000-0000-4000-8000-000000000908', 'Rae', '1990-01-01', 'phoenix');
insert into tournaments (id, city, title, starts_at, max_entries) values ('00000000-0000-4000-8000-0000000009c1', 'phoenix', 'Gate Cup', now() + interval '3 days', 8);
insert into leagues (id, city, title, starts_at) values ('00000000-0000-4000-8000-0000000009c2', 'phoenix', 'Gate Ladder', now() + interval '2 days');
update app_settings set require_verified_phone = true;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000908';
do $$
begin
  begin
    perform count(*) from app_settings;
    assert false, 'a member can read the settings';
  exception when insufficient_privilege then null;
  end;
  begin
    update app_settings set require_verified_phone = false;
    assert false, 'a member switched the phone requirement off';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into swipes (actor_id, target_id, mode, action) values ('00000000-0000-4000-8000-000000000908', '00000000-0000-4000-8000-000000000901', 'play', 'like');
    assert false, 'an unverified account swiped';
  exception when insufficient_privilege then assert sqlerrm like 'Verify%', sqlerrm;
  end;
  begin
    insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e3', '00000000-0000-4000-8000-000000000908');
    assert false, 'an unverified account took a place at an event';
  exception when insufficient_privilege then assert sqlerrm like 'Verify%', sqlerrm;
  end;
  begin
    perform join_tournament('00000000-0000-4000-8000-0000000009c1');
    assert false, 'an unverified account entered a tournament';
  exception when insufficient_privilege then assert sqlerrm like 'Verify%', sqlerrm;
  end;
  begin
    perform join_league('00000000-0000-4000-8000-0000000009c2');
    assert false, 'an unverified account joined a ladder';
  exception when insufficient_privilege then assert sqlerrm like 'Verify%', sqlerrm;
  end;
  -- Asking for help and leaving never need a phone.
  perform report_member('00000000-0000-4000-8000-000000000901', 'still allowed');
  perform block_member('00000000-0000-4000-8000-000000000901');
end $$;
reset role;
set request.jwt.claim.sub = '';
update auth.users set phone = '+13175550177', phone_confirmed_at = now() where id = '00000000-0000-4000-8000-000000000908';
delete from blocks where blocker_id = '00000000-0000-4000-8000-000000000908';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000908';
do $$ begin
  assert sync_phone_verification(), 'an honest number no longer verifies';
  insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e3', '00000000-0000-4000-8000-000000000908');
  perform join_league('00000000-0000-4000-8000-0000000009c2');
end $$;
reset role;
set request.jwt.claim.sub = '';
update app_settings set require_verified_phone = false;
delete from tournaments where id = '00000000-0000-4000-8000-0000000009c1';
delete from leagues where id = '00000000-0000-4000-8000-0000000009c2';
delete from auth.users where id = '00000000-0000-4000-8000-000000000908';
delete from reports where target_id = '00000000-0000-4000-8000-000000000901';

-- ---- 10d. Rate limits (migration 35) ----
insert into matches (id, user_a, user_b, mode) values ('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000904', 'play');
insert into rate_events (user_id, kind) select '00000000-0000-4000-8000-000000000901', 'report'  from generate_series(1, 20);
insert into rate_events (user_id, kind) select '00000000-0000-4000-8000-000000000901', 'message' from generate_series(1, 60);
insert into rate_events (user_id, kind) select '00000000-0000-4000-8000-000000000901', 'swipe'   from generate_series(1, 500);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
begin
  begin
    perform count(*) from rate_events;
    assert false, 'a member can read the rate log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform report_member('00000000-0000-4000-8000-000000000905', 'one too many');
    assert false, 'a 21st report in a day went through';
  exception when program_limit_exceeded then null;
  end;
  -- At the limit, an account that doesn't exist answers exactly the same.
  begin
    perform report_member('00000000-0000-4000-8000-0000000009ff', 'nobody');
    assert false, 'at the limit, a missing account answers differently from a real one';
  exception when program_limit_exceeded then null;
  end;
  begin
    insert into messages (match_id, sender_id, body) values ('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-000000000901', 'one too many');
    assert false, 'a 61st message in a minute went through';
  exception when program_limit_exceeded then null;
  end;
  begin
    insert into swipes (actor_id, target_id, mode, action) values ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000909', 'play', 'pass');
    assert false, 'a 501st swipe in a day went through';
  exception when program_limit_exceeded then null;
  end;
end $$;
-- Someone under the limits is untouched; a backdated row is stamped by the
-- server and counted; undoing a swipe doesn't give the swipe back.
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000904';
insert into messages (match_id, sender_id, body, sent_at) values ('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-000000000904', 'hello', now() - interval '3 days');
insert into swipes (actor_id, target_id, mode, action, created_at) values ('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000909', 'play', 'pass', now() - interval '3 days');
select undo_swipe('00000000-0000-4000-8000-000000000909', 'play');
insert into swipes (actor_id, target_id, mode, action) values ('00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000909', 'play', 'pass');
select report_member('00000000-0000-4000-8000-000000000905', 'fine');
select report_member('00000000-0000-4000-8000-0000000009ff', 'nobody home');  -- under the limit: silent
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  assert (select sent_at > now() - interval '1 minute' from messages where match_id = '00000000-0000-4000-8000-0000000009b1' and sender_id = '00000000-0000-4000-8000-000000000904'),
    'a backdated message kept its own timestamp';
  assert (select created_at > now() - interval '1 minute' from swipes where actor_id = '00000000-0000-4000-8000-000000000904' and target_id = '00000000-0000-4000-8000-000000000909'),
    'a backdated swipe kept its own timestamp';
  assert (select count(*) from rate_events where user_id = '00000000-0000-4000-8000-000000000904' and kind = 'swipe') = 2, 'undoing a swipe gave the swipe back';
  assert (select count(*) from rate_events where user_id = '00000000-0000-4000-8000-000000000904' and kind = 'message') = 1, 'a message was not counted';
  assert (select count(*) from rate_events where user_id = '00000000-0000-4000-8000-000000000904' and kind = 'report') = 2, 'a report about a missing account was not counted';
  assert (select count(*) from reports where reporter_id = '00000000-0000-4000-8000-000000000904') = 1, 'a report about a missing account was stored';
end $$;
delete from rate_events;
delete from reports where reporter_id in ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000904');
delete from swipes where actor_id = '00000000-0000-4000-8000-000000000904';
delete from matches where id = '00000000-0000-4000-8000-0000000009b1';

-- ---- 10e. Quiet hours (migration 36) ----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
select set_my_timezone('America/Indiana/Indianapolis');
do $$
begin
  begin
    perform set_my_timezone('Mars/Olympus_Mons');
    assert false, 'an invented timezone was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update profiles set timezone = 'Nope/Nowhere' where id = '00000000-0000-4000-8000-000000000901';
    assert false, 'an invented timezone was written to the row';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform in_quiet_hours('00000000-0000-4000-8000-000000000904');
    assert false, 'a member can ask about someone''s quiet hours';
  exception when insufficient_privilege then null;
  end;
  begin
    perform timezone from profiles where id = '00000000-0000-4000-8000-000000000904';
    assert false, 'a member can read someone else''s timezone';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert in_quiet_hours('00000000-0000-4000-8000-000000000901', '2026-11-13 04:00:00+00'), '11pm in Indianapolis is not quiet';
  assert in_quiet_hours('00000000-0000-4000-8000-000000000901', '2026-11-13 12:30:00+00'), '7:30am in Indianapolis is not quiet';
  assert not in_quiet_hours('00000000-0000-4000-8000-000000000901', '2026-11-13 13:00:00+00'), '8am in Indianapolis is quiet';
  assert not in_quiet_hours('00000000-0000-4000-8000-000000000901', '2026-11-13 18:00:00+00'), '1pm in Indianapolis is quiet';
  assert in_quiet_hours('00000000-0000-4000-8000-000000000901', '2026-07-01 02:30:00+00'), '10:30pm in July (daylight time) is not quiet';
  assert not in_quiet_hours('00000000-0000-4000-8000-000000000901', '2026-07-01 01:30:00+00'), '9:30pm in July (daylight time) is quiet';
  assert not in_quiet_hours('00000000-0000-4000-8000-000000000904', '2026-11-13 04:00:00+00'), 'no timezone on file was treated as quiet';
end $$;

-- ---- 10f. Ladder leagues (migration 37) ----
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$ begin
  begin
    insert into leagues (city, title, starts_at) values ('phoenix', 'Sneaky Ladder', now());
    assert false, 'a member created a league';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
insert into leagues (id, city, title, starts_at) values ('00000000-0000-4000-8000-0000000009a1', 'phoenix', 'Test Ladder', now() + interval '2 days');
select join_league('00000000-0000-4000-8000-0000000009a1');                                  -- Oz 1
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000909'; select join_league('00000000-0000-4000-8000-0000000009a1'); -- Sol 2
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000904'; select join_league('00000000-0000-4000-8000-0000000009a1'); -- Nia 3
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000903'; select join_league('00000000-0000-4000-8000-0000000009a1'); -- Moe 4 (he has blocked Kit)
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
select suspend_member('00000000-0000-4000-8000-000000000902', 'test');  -- Lou's ban was lifted in 10c; suspend him again
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000902';
do $$ begin
  begin
    perform join_league('00000000-0000-4000-8000-0000000009a1');
    assert false, 'a suspended member joined a league';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from get_league_standings('00000000-0000-4000-8000-0000000009a1')) = 0, 'a suspended member can read the standings';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
declare c uuid;
begin
  assert join_league('00000000-0000-4000-8000-0000000009a1') = 5, 'a new member did not take the bottom rung';
  assert join_league('00000000-0000-4000-8000-0000000009a1') = 5, 'joining twice moved the rung';
  -- Kit's ladder has no Moe on it and no gap where he would be.
  assert (select array_agg(first_name order by rung) from get_league_standings('00000000-0000-4000-8000-0000000009a1'))
         = array['Oz', 'Sol', 'Nia', 'Kit'], 'the ladder shows someone hidden, or a masked row';
  assert (select array_agg(rung order by rung) from get_league_standings('00000000-0000-4000-8000-0000000009a1')) = array[1, 2, 3, 4],
    'the ladder a member sees has a gap';
  begin
    perform league_challenge('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000905');
    assert false, 'challenged three rungs up';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform league_challenge('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000903');
    assert false, 'challenged someone who blocked me';
  exception when invalid_parameter_value then null;
  end;
  -- Two rungs up on the ladder Kit can see (three on the real one, past Moe).
  c := league_challenge('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000909');
  begin
    perform league_challenge('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000909');
    assert false, 'two open challenges between the same pair';
  exception when unique_violation then null;
  end;
  assert (select count(*) from league_members) = 1, 'a member can read other members'' rows';
  begin
    insert into league_members (league_id, user_id, rung) values ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000901', 1);
    assert false, 'a member wrote a ladder row';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
do $$ begin
  begin
    perform report_league_result((select id from league_challenges where league_id = '00000000-0000-4000-8000-0000000009a1'), '00000000-0000-4000-8000-000000000901');
    assert false, 'an outsider recorded a result';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$ begin
  begin
    perform report_league_result((select id from league_challenges where league_id = '00000000-0000-4000-8000-0000000009a1'), '00000000-0000-4000-8000-000000000905');
    assert false, 'the winner was not one of the two players';
  exception when invalid_parameter_value then null;
  end;
  perform report_league_result((select id from league_challenges where league_id = '00000000-0000-4000-8000-0000000009a1'), '00000000-0000-4000-8000-000000000901');
  begin
    perform report_league_result((select id from league_challenges where league_id = '00000000-0000-4000-8000-0000000009a1'), '00000000-0000-4000-8000-000000000909');
    assert false, 'a result was recorded twice';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
set request.jwt.claim.sub = '';
do $$ begin
  -- Kit was three real rungs below Sol; a win moves her up two, not three.
  assert (select array_agg(user_id order by rung) from league_members where league_id = '00000000-0000-4000-8000-0000000009a1')
         = array['00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000909', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000903']::uuid[], 'the ladder did not move as it should';
  assert (select wins = 1 from league_members where league_id = '00000000-0000-4000-8000-0000000009a1' and user_id = '00000000-0000-4000-8000-000000000901')
     and (select losses = 1 from league_members where league_id = '00000000-0000-4000-8000-0000000009a1' and user_id = '00000000-0000-4000-8000-000000000909'), 'records wrong';
end $$;
-- A block ends an open challenge between the two.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
select league_challenge('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000909');
reset role;
set request.jwt.claim.sub = '';
insert into blocks (blocker_id, blocked_id) values ('00000000-0000-4000-8000-000000000909', '00000000-0000-4000-8000-000000000901');
do $$ begin
  assert (select count(*) from league_challenges where league_id = '00000000-0000-4000-8000-0000000009a1' and decided_at is null) = 0,
    'a challenge survived a block between the two players';
end $$;
delete from blocks where blocker_id = '00000000-0000-4000-8000-000000000909' and blocked_id = '00000000-0000-4000-8000-000000000901';
-- Suspension, a deleted account and leaving all close the ladder up.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
select suspend_member('00000000-0000-4000-8000-000000000904', 'test');
reset role;
do $$ begin
  assert (select array_agg(user_id order by rung) from league_members where league_id = '00000000-0000-4000-8000-0000000009a1')
         = array['00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000909', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000903']::uuid[], 'a suspended member stayed on the ladder';
  assert (select max(rung) from league_members where league_id = '00000000-0000-4000-8000-0000000009a1') = 4, 'suspension left a gap';
end $$;
set request.jwt.claim.sub = '';
delete from auth.users where id = '00000000-0000-4000-8000-000000000909';
do $$ begin
  assert (select array_agg(user_id order by rung) from league_members where league_id = '00000000-0000-4000-8000-0000000009a1')
         = array['00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000903']::uuid[], 'a deleted account stayed on the ladder';
  assert (select array_agg(rung order by rung) from league_members where league_id = '00000000-0000-4000-8000-0000000009a1') = array[1, 2, 3],
    'a deleted account left a gap';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
select leave_league('00000000-0000-4000-8000-0000000009a1');
select unsuspend_member('00000000-0000-4000-8000-000000000904');
reset role;
do $$ begin
  assert (select array_agg(rung order by rung) from league_members where league_id = '00000000-0000-4000-8000-0000000009a1') = array[1, 2],
    'leaving left a gap';
end $$;
set role anon;
do $$ begin
  begin
    perform * from get_league_standings('00000000-0000-4000-8000-0000000009a1');
    assert false, 'anon can read standings';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---- 10g. Tiers and priority signup (migration 38) ----
set request.jwt.claim.sub = '';
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000090a', 'x-tia@example.com');
insert into events (id, title, venue, starts_at, sport, capacity, city, general_opens_at, price_cents, club_discount_pct) values
  ('00000000-0000-4000-8000-0000000009e2', 'Priority Night', 'Test Courts', now() + interval '5 days', 'pickleball', 8, 'phoenix', now() + interval '1 day', 1500, 20);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000090a';
insert into profiles (id, first_name, birthdate, city, tier) values ('00000000-0000-4000-8000-00000000090a', 'Tia', '1990-01-01', 'phoenix', 'club');
do $$ begin
  assert (get_my_profile() ->> 'tier') = 'free', 'a member signed up straight into Club';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
do $$
begin
  begin
    update profiles set tier = 'club' where id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a member gave themselves Club';
  exception when insufficient_privilege then null;
  end;
  assert not set_member_tier('00000000-0000-4000-8000-000000000901', 'club'), 'a non-admin set a tier';
  begin
    insert into event_rsvps (event_id, user_id) values ('00000000-0000-4000-8000-0000000009e2', '00000000-0000-4000-8000-000000000901');
    assert false, 'a free member took a priority-signup place';
  exception when insufficient_privilege then null;
  end;
  -- The waitlist is open to everyone; stepping from it into a place is not.
  insert into event_rsvps (event_id, user_id, status) values ('00000000-0000-4000-8000-0000000009e2', '00000000-0000-4000-8000-000000000901', 'waitlist');
  begin
    update event_rsvps set status = 'going' where event_id = '00000000-0000-4000-8000-0000000009e2' and user_id = '00000000-0000-4000-8000-000000000901';
    assert false, 'a free member stepped from the waitlist into a priority place';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000905';
do $$ begin
  assert set_member_tier('00000000-0000-4000-8000-000000000901', 'club'), 'an admin could not set a tier';
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
update event_rsvps set status = 'going' where event_id = '00000000-0000-4000-8000-0000000009e2' and user_id = '00000000-0000-4000-8000-000000000901';
do $$ begin
  assert (get_my_profile() ->> 'tier') = 'club', 'my tier is not in my profile';
  assert (select status = 'going' from event_rsvps where event_id = '00000000-0000-4000-8000-0000000009e2' and user_id = '00000000-0000-4000-8000-000000000901'), 'a Club member could not RSVP early';
  begin
    perform tier from profiles where id = '00000000-0000-4000-8000-000000000904';
    assert false, 'a member can read someone else''s tier';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set request.jwt.claim.sub = '';
delete from leagues where id = '00000000-0000-4000-8000-0000000009a1';
delete from events where id in ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009e2', '00000000-0000-4000-8000-0000000009e3', '00000000-0000-4000-8000-0000000009e4', '00000000-0000-4000-8000-0000000009e5');
delete from banned_phones;
delete from admins where user_id = '00000000-0000-4000-8000-000000000905';
delete from auth.users where id in ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000903', '00000000-0000-4000-8000-000000000904', '00000000-0000-4000-8000-000000000905', '00000000-0000-4000-8000-000000000906', '00000000-0000-4000-8000-00000000090a');

select 'ALL BACKEND TESTS PASSED' as result;
