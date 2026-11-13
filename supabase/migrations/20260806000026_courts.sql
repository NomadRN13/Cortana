-- RSVPlay — places to play live in the database
--
-- The Bakersfield places-to-play list shipped inside the app (and the
-- prototype) as a hardcoded array. That made the one thing that changes most
-- often in the whole product — a new court opens, a club changes its guest
-- policy, a park takes its nets down — the one thing that needed an app
-- release, a store review and every member updating before anyone saw it.
--
-- So the list is a table. The founder adds, edits and removes venues from the
-- moderation desk (/admin → Places) and members see the change the next time
-- they open Events. The copy in mobile/src/data/courts.js stays as what the
-- demo build shows, and what a live build falls back to if it cannot reach the
-- database — it is no longer the source of truth.
--
-- Shape notes:
--   · city is a real foreign key, so a venue can't be filed under a city that
--     doesn't exist, and a city can't be removed out from under its venues.
--   · courts and lights are NULLABLE on purpose. "We don't know" is a real
--     answer for a park whose listings disagree, and a number we made up is
--     worse than no number: someone drives there on the strength of it.
--   · access says who can walk on: a free public park, somewhere anyone can pay
--     to play, or members/residents only (listed so a member knows it exists).

create type public.court_setting as enum ('outdoor', 'indoor', 'both');
create type public.court_access as enum ('public', 'paid', 'members');

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities (slug),
  name text not null check (char_length(name) between 2 and 80 and name = btrim(name)),
  address text not null default '' check (char_length(address) <= 120),
  sport public.sport not null default 'pickleball',
  setting public.court_setting not null,
  access public.court_access not null,
  courts int check (courts is null or courts between 1 and 99),
  lights boolean,
  note text not null default '' check (char_length(note) <= 280),
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- One row per venue per city, ignoring case: "Jastro park" is "Jastro Park".
-- A plain unique (city, name) would let the desk file the same park twice
-- under a different capitalisation, and members would see it twice.
create unique index courts_city_name_key on public.courts (city, lower(name));

create index courts_city_idx on public.courts (city, sort_order, name);

alter table public.courts enable row level security;

-- Members read every city's list: which rows they actually see is the app's
-- query (the cities on their profile), the same way events work. Nothing here
-- is personal data. Signed-out visitors get nothing — the landing page has no
-- use for it.
create policy courts_select on public.courts
  for select to authenticated using (true);

-- Only the desk writes. Same rule as events: authorised by the admins list in
-- the database, never by the page that sends the request.
create policy courts_admin_insert on public.courts
  for insert to authenticated with check (public.is_admin());
create policy courts_admin_update on public.courts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy courts_admin_delete on public.courts
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.courts to authenticated;

-- ---- Bakersfield: the 13 venues confirmed playable in November 2026 ----
-- The same rows as mobile/src/data/courts.js. sort_order groups them the way
-- the app lists them: free public parks first, then pay-to-play, then private.
insert into public.courts (city, name, address, setting, access, courts, lights, note, sort_order) values
  ('bakersfield', 'Greenacres Park PicklePlex', '2014 Calloway Dr', 'outdoor', 'public', 8, true,
   'Bakersfield’s biggest public complex — eight dedicated courts at Greenacres Community Center & Park. Open 6am–10pm.', 10),
  ('bakersfield', 'Jastro Park', '2900 Truxtun Ave', 'outdoor', 'public', 6, true,
   'Six dedicated courts downtown, beside the tennis courts. First come, first served.', 20),
  ('bakersfield', 'Stockdale River Ranch Community Park', '16303 Stockdale Ranch Dr', 'outdoor', 'public', 4, null,
   'The newest park in town (opened November 2025), far southwest.', 30),
  ('bakersfield', 'Haggin Oaks Park', '9200 McInnes Blvd', 'outdoor', 'public', 3, true,
   'Three courts in southwest Bakersfield; lights run on a timer.', 40),
  ('bakersfield', 'Campus Park South', '4445 Pin Oak Park Blvd', 'outdoor', 'public', 3, true,
   'Three dedicated courts in the southwest.', 50),
  ('bakersfield', 'Beale Park', '500 Oleander Ave', 'outdoor', 'public', null, null,
   'Free play in the Oleander neighborhood. Go in daylight — reports on the lights disagree.', 60),
  ('bakersfield', 'Farm Park (Gossamer Grove)', 'Parkdale Way, Shafter', 'outdoor', 'public', null, null,
   'Small neighborhood park in Shafter, northwest of town.', 70),
  ('bakersfield', 'Dignity Health Sports Complex — GSA Pickleball', '3101 Gilmore Ave, Suite 100', 'indoor', 'paid', null, true,
   'Indoor, air-conditioned play on multi-sport courts. Open play three days a week, plus memberships, punch cards and court rentals — call ahead for the schedule.', 110),
  ('bakersfield', 'Sportsplex Bakersfield', '6825 Ming Ave', 'outdoor', 'paid', 4, null,
   'Pay-to-play complex with weekly drop-in open play, leagues, clinics and court rentals you book online.', 120),
  ('bakersfield', 'Bakersfield Racquet Club', '1660 Pine St', 'outdoor', 'members', 4, true,
   'Private member-owned club downtown. Membership required; guests come with a member.', 210),
  ('bakersfield', 'Seven Oaks Country Club', '2000 Grand Lakes Ave', 'outdoor', 'members', 4, true,
   'Private country club — four dedicated courts with LED lights. Members and their guests.', 220),
  ('bakersfield', 'Stockdale Country Club', '7001 Stockdale Hwy', 'outdoor', 'members', 4, null,
   'Private country club. Members and their guests.', 230),
  ('bakersfield', 'Highgate at Seven Oaks', '2200 Highbury St', 'outdoor', 'members', 2, true,
   'Courts inside a gated community — residents and their guests only.', 240)
on conflict do nothing;
