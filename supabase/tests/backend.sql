-- 40/LOVE backend verification suite.
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

\i :migrations

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
-- put Maya back so later tests are unaffected
update profiles
set city = 'indianapolis', approx_lat = 39.78, approx_lng = -86.16
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
insert into blocks (blocker_id, blocked_id)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000003');
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
insert into reports (reporter_id, target_id, reason, context)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000002', 'Test report for admin triage', 'deck');
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
  values ('40/LOVE Social Mixer', 'Broad Ripple Courts', now() + interval '7 days', 'pickleball', 24);
  select count(*) into c from events where title = '40/LOVE Social Mixer';
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
    'admins', 'apple_identities', 'waitlist', 'event_rsvps'
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
  foreach v in array array['birthdate', 'partner_birthdate', 'approx_lat', 'approx_lng'] loop
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

-- Every column of profiles must be deliberately classified: readable by
-- members, or withheld. A new column that is in neither list fails here rather
-- than silently becoming readable (a leak) or silently not (a broken screen).
do $$
declare unclassified text;
begin
  select string_agg(c.column_name, ', ') into unclassified
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'profiles'
    and c.column_name not in (
      'birthdate', 'partner_birthdate', 'approx_lat', 'approx_lng')
    and not has_column_privilege('authenticated', 'public.profiles', c.column_name, 'select');
  assert unclassified is null,
    format('profiles column(s) neither readable nor deliberately withheld: %s '
           '— classify them in migration 20260806000018', unclassified);
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
  insert into blocks (blocker_id, blocked_id)
  values (auth.uid(), '00000000-0000-4000-8000-000000000004');
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

  insert into blocks (blocker_id, blocked_id)
  values (auth.uid(), '00000000-0000-4000-8000-000000000003');

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
    'select count(*) from apple_identities where user_id = $1'
  ] loop
    execute t into c using '00000000-0000-4000-8000-000000000012'::uuid;
    assert c = 0, format('account deletion left %s row(s) behind: %s', c, t);
  end loop;
  -- Photo objects go too, so a deleted member's images cannot be served.
  select count(*) into c from storage.objects
   where name like '00000000-0000-4000-8000-000000000012/%';
  assert c = 0, format('account deletion left %s photo object(s) in storage', c);
end $$;

select 'ALL BACKEND TESTS PASSED' as result;
