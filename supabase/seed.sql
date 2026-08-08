-- 40/Love — development seed (local/dev only; never run against production)
-- The 12 demo players from the prototype plus a demo account "Aaron",
-- pre-seeded matches/threads, and the Indianapolis event calendar.

-- Demo auth users (Supabase local dev allows direct inserts into auth.users)
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'aaron@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000001', 'maya@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000002', 'diego@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000003', 'priya@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000004', 'sam@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000005', 'elena@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000006', 'marcus@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000007', 'jordan@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000008', 'grace@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000009', 'theo@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000010', 'nadia@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000011', 'chris@demo.40love.app'),
  ('00000000-0000-4000-8000-000000000012', 'lena@demo.40love.app');

insert into public.profiles
  (id, first_name, birthdate, bio, approx_lat, approx_lng, availability_note, modes, gender, seeking, verified_at, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'Aaron',  '1992-04-15', 'Founder demo account.', 39.78, -86.16, 'Evenings + weekends', '{date,play}', 'man', '{woman}', now(), now() - interval '30 days'),
  ('00000000-0000-4000-8000-000000000001', 'Maya',   '1995-03-14', 'Litigator by day, baseline grinder by night. Looking for someone who can keep a rally going — in conversation too.', 39.79, -86.17, 'Weekday evenings · Sat mornings', '{date,play}', 'woman', '{man}', now(), now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000002', 'Diego',  '1988-02-02', 'Moved here from Madrid two years ago — converting Indy to padel one pickleball game at a time.', 39.75, -86.12, 'Weekends', '{date,friends}', 'man', '{woman}', null, now() - interval '5 days'),
  ('00000000-0000-4000-8000-000000000003', 'Priya',  '1997-05-20', 'Product designer who treats every third ball like a drop-shot opportunity. Winner picks the coffee spot after.', 39.78, -86.15, 'Sun + Wed evenings', '{date,play}', 'woman', '{man}', now(), now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000004', 'Sam',    '1981-04-11', 'Recovering marathoner, fully converted to the kitchen line. I play hard and brunch harder.', 39.82, -86.19, 'Early mornings, most days', '{date,play,friends}', 'woman', '{man}', now(), now() - interval '60 days'),
  ('00000000-0000-4000-8000-000000000005', 'Elena',  '1974-06-30', 'Retired teacher, new to the city, and pickleball has been the best welcome committee.', 39.80, -86.13, 'Weekday mornings', '{date,friends}', 'woman', '{man}', now(), now() - interval '90 days'),
  ('00000000-0000-4000-8000-000000000006', 'Marcus', '1992-01-25', 'Architect who thinks best inside four glass walls. If you can hold a T, you already have my attention.', 39.72, -86.10, 'Tue + Thu after 6', '{date}', 'man', '{man}', null, now() - interval '45 days'),
  ('00000000-0000-4000-8000-000000000007', 'Jordan', '1996-07-19', 'Coach says my forehand is a weapon; my dog says I need to get out more. They can both be right.', 39.74, -86.20, 'Flexible — I make time', '{date,play}', 'woman', '{man,woman}', now(), now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000008', 'Grace',  '1985-03-08', 'ER nurse with a wicked slice. Weekends are sacred court time — see if you can break serve.', 39.85, -86.10, 'Sat + Sun mornings', '{date,play}', 'woman', '{man}', now(), now() - interval '120 days'),
  ('00000000-0000-4000-8000-000000000009', 'Theo',   '1968-05-15', 'Thirty years of racquetball and still learning new angles. Grandkids say I''m cool; verify in person.', 39.76, -86.19, 'Mon/Wed/Fri lunch', '{play,friends}', 'man', '{woman}', null, now() - interval '200 days'),
  ('00000000-0000-4000-8000-000000000010', 'Nadia',  '1993-04-22', 'Food scientist who joined a pickleball league on a dare and stayed for the people. Post-game taco recs are my specialty.', 39.87, -86.05, 'Weekend afternoons', '{date,friends}', 'woman', '{man,woman}', now(), now() - interval '15 days'),
  ('00000000-0000-4000-8000-000000000011', 'Chris',  '1978-06-10', 'Two kids, one dog, zero interest in small talk at bars. Ten minutes of doubles tells you more than any bio could.', 39.73, -86.22, 'Evenings after 7', '{date,play}', 'man', '{woman}', now(), now() - interval '75 days'),
  ('00000000-0000-4000-8000-000000000012', 'Lena',   '2001-03-30', 'Grad student and former junior squash champ. Fair warning: I call every let.', 39.90, -86.02, 'Weekday evenings', '{date,play}', 'woman', '{woman}', null, now() - interval '10 days');

-- Play/Friends preference flavor (everyone else keeps the open defaults):
-- Lena only wants women's singles; Grace does doubles + mixed with women;
-- Marcus wants men's singles; Elena's friends circle is women.
update public.profiles set play_games = '{singles}', play_pref = 'women' where id = '00000000-0000-4000-8000-000000000012';
update public.profiles set play_games = '{doubles,mixed_doubles}', play_pref = 'women' where id = '00000000-0000-4000-8000-000000000008';
update public.profiles set play_games = '{singles}', play_pref = 'men' where id = '00000000-0000-4000-8000-000000000006';
update public.profiles set friends_pref = 'women' where id = '00000000-0000-4000-8000-000000000005';

insert into public.user_sports (user_id, sport, level, rating_label) values
  ('00000000-0000-4000-8000-00000000000a', 'tennis', 'advanced', 'NTRP 4.0'),
  ('00000000-0000-4000-8000-00000000000a', 'pickleball', 'advanced', ''),
  ('00000000-0000-4000-8000-000000000001', 'tennis', 'advanced', 'NTRP 4.0'),
  ('00000000-0000-4000-8000-000000000002', 'padel', 'intermediate', ''),
  ('00000000-0000-4000-8000-000000000002', 'pickleball', 'intermediate', ''),
  ('00000000-0000-4000-8000-000000000003', 'tennis', 'intermediate', 'NTRP 3.5'),
  ('00000000-0000-4000-8000-000000000003', 'pickleball', 'intermediate', ''),
  ('00000000-0000-4000-8000-000000000004', 'pickleball', 'competitive', 'DUPR 4.2'),
  ('00000000-0000-4000-8000-000000000005', 'pickleball', 'intermediate', 'DUPR 3.4'),
  ('00000000-0000-4000-8000-000000000006', 'squash', 'advanced', ''),
  ('00000000-0000-4000-8000-000000000007', 'tennis', 'advanced', 'NTRP 4.0'),
  ('00000000-0000-4000-8000-000000000007', 'pickleball', 'advanced', ''),
  ('00000000-0000-4000-8000-000000000008', 'tennis', 'advanced', 'NTRP 4.5'),
  ('00000000-0000-4000-8000-000000000008', 'padel', 'advanced', ''),
  ('00000000-0000-4000-8000-000000000009', 'racquetball', 'intermediate', ''),
  ('00000000-0000-4000-8000-000000000010', 'pickleball', 'beginner', ''),
  ('00000000-0000-4000-8000-000000000011', 'pickleball', 'advanced', 'DUPR 4.0'),
  ('00000000-0000-4000-8000-000000000011', 'tennis', 'advanced', ''),
  ('00000000-0000-4000-8000-000000000012', 'squash', 'competitive', ''),
  ('00000000-0000-4000-8000-000000000012', 'tennis', 'competitive', '');

-- Mutual likes → the trigger creates Aaron's three seeded matches
insert into public.swipes (actor_id, target_id, mode, action) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'date', 'like'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'date', 'like'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000004', 'date', 'like'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000a', 'date', 'like'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000003', 'date', 'like'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'date', 'like');

-- Seeded conversations (thread content from the prototype)
with m as (
  select id, user_a, user_b from public.matches
)
insert into public.messages (match_id, sender_id, kind, body, court_payload, sent_at)
select m.id, '00000000-0000-4000-8000-000000000001'::uuid, 'text'::public.message_kind, 'Okay your backhand slice is genuinely rude 😄', null::jsonb, now() - interval '26 hours'
from m where '00000000-0000-4000-8000-000000000001' in (m.user_a, m.user_b)
union all
select m.id, '00000000-0000-4000-8000-00000000000a', 'text', 'Years of being too lazy to hit topspin finally paying off', null::jsonb, now() - interval '25 hours'
from m where '00000000-0000-4000-8000-000000000001' in (m.user_a, m.user_b)
union all
select m.id, '00000000-0000-4000-8000-000000000001', 'text', 'Rematch this weekend? Loser buys smoothies', null::jsonb, now() - interval '24 hours'
from m where '00000000-0000-4000-8000-000000000001' in (m.user_a, m.user_b)
union all
select m.id, '00000000-0000-4000-8000-000000000004', 'court_time', '',
       '{"venue":"Broad Ripple Park","day":"Sat","time":"9:00 AM","sport":"pickleball","status":"proposed"}'::jsonb,
       now() - interval '3 days'
from m where '00000000-0000-4000-8000-000000000004' in (m.user_a, m.user_b)
union all
select m.id, '00000000-0000-4000-8000-000000000003', 'text', 'So verdict on the new courts at Riverside?', null::jsonb, now() - interval '2 days'
from m where '00000000-0000-4000-8000-000000000003' in (m.user_a, m.user_b);

-- Indianapolis launch events (real venues from outreach/indianapolis/targets.md)
insert into public.events (title, venue, starts_at, sport, level_range, capacity) values
  ('Sunset Doubles Social',      'Riverside Park Tennis Complex', now() + interval '2 days',  'tennis',     'All levels',    24),
  ('Beginner Pickleball Mixer',  'Broad Ripple Park',             now() + interval '3 days',  'pickleball', 'Beginner–Int.', 24),
  ('40/Love Round Robin',        'Tarkington Park',               now() + interval '4 days',  'tennis',     'NTRP 3.0–4.0',  16),
  ('Pickleball Under the Lights','Ellenberger Park',              now() + interval '7 days',  'pickleball', 'All levels',    32),
  ('Cardio Tennis + Coffee',     'Tarkington Park',               now() + interval '10 days', 'tennis',     'Int. and up',   16),
  ('Ladder League Kickoff',      'Indy Pickleball Club',          now() + interval '11 days', 'pickleball', 'DUPR 3.0+',     20);
