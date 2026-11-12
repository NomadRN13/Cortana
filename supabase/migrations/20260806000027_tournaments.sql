-- 40/LOVE — tournaments with brackets that build and fill themselves
--
-- A tournament is a single-elimination bracket for 2 to 24 entries in one
-- city. The founder creates it on the moderation desk; members join from the
-- Events tab until it is full or it starts. A doubles team's shared profile is
-- one entry, exactly as it is one card in the deck.
--
-- When the desk starts it, the bracket is built in one go:
--   · the field is seeded in a random draw (we hold no rating we would trust to
--     seed a real draw by);
--   · the bracket is the next power of two up from the field — 24 entries play
--     in a 32-slot bracket — and the empty slots are byes;
--   · seeds are placed in the standard order (1 v 32, 16 v 17, 8 v 25, …), so
--     byes fall to the top seeds, never meet each other, and the two top seeds
--     can only meet in the final;
--   · a bye advances its player at once, so round 1 is only real matches.
-- Every later round exists from the start with empty slots, and each result
-- moves the winner into the next one. The final's result crowns the champion
-- and completes the tournament.
--
-- Who can write what — all writes go through the functions below, never
-- straight into the tables, so the bracket can't be edited into nonsense:
--   · members: join and leave (only while registration is open);
--   · either player in a match: record its result — trusted the way a ladder
--     at a club is, with the desk able to correct it;
--   · the desk (admins): create, edit and cancel tournaments, start them, and
--     record or correct any result, including a walkover when a player can't
--     continue.

create type public.tournament_status as enum ('registration', 'in_progress', 'completed', 'cancelled');

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities (slug),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  venue text not null default '' check (char_length(venue) <= 80),
  sport public.sport not null default 'pickleball',
  level_range text not null default 'All levels' check (char_length(level_range) <= 40),
  starts_at timestamptz not null,
  max_entries int not null default 16 check (max_entries between 2 and 24),
  status public.tournament_status not null default 'registration',
  bracket_size int check (bracket_size in (2, 4, 8, 16, 32)),
  champion_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index tournaments_city_starts_idx on public.tournaments (city, starts_at);

create table public.tournament_entries (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed int check (seed between 1 and 24),
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null check (round between 1 and 5),     -- 1 = first round; the final is the last
  slot int not null check (slot between 0 and 15),      -- position within the round, top to bottom
  player_a uuid references public.profiles (id) on delete set null,
  player_b uuid references public.profiles (id) on delete set null,
  winner uuid references public.profiles (id) on delete set null,
  score text not null default '' check (char_length(score) <= 40),
  is_bye boolean not null default false,
  reported_by uuid references public.profiles (id) on delete set null,
  reported_at timestamptz,
  unique (tournament_id, round, slot),
  check (winner is null or winner = player_a or winner = player_b)
);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;

-- ---- reading ----
-- Members read every city's tournaments; which ones the app shows is its query
-- (the member's cities), the same as events and places to play.
create policy tournaments_select on public.tournaments
  for select to authenticated using (true);
-- The entry list says who will be where, and when — so, like an event's guest
-- list, a member never sees someone who has blocked them, or whom they blocked.
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked(auth.uid(), user_id));
-- Match rows carry ids only; names come from get_profile_cards, which already
-- withholds a blocked member, so a bracket shows them as an unnamed player.
create policy tournament_matches_select on public.tournament_matches
  for select to authenticated using (true);

-- ---- writing ----
-- The desk manages tournaments directly. Entries and matches have no write
-- policies at all: the functions below are the only way in.
create policy tournaments_admin_insert on public.tournaments
  for insert to authenticated with check (public.is_admin());
create policy tournaments_admin_update on public.tournaments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tournaments_admin_delete on public.tournaments
  for delete to authenticated using (public.is_admin());

grant select on public.tournaments, public.tournament_entries, public.tournament_matches to authenticated;
grant insert, update, delete on public.tournaments to authenticated;

-- ---- joining and leaving ----
create or replace function public.join_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t record;
  taken int;
begin
  if me is null then raise exception 'Sign in to join.' using errcode = '42501'; end if;
  if public.is_suspended(me) then raise exception 'Your account is suspended.' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = me) then
    raise exception 'Finish your profile before joining a tournament.' using errcode = 'P0001';
  end if;

  -- Lock the tournament: without it two people can both take the last place.
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'That tournament doesn''t exist.' using errcode = 'P0002'; end if;
  if t.status <> 'registration' then
    raise exception 'Entries for this tournament are closed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from tournament_entries where tournament_id = p_tournament and user_id = me) then
    return;  -- already in: joining twice is not an error
  end if;

  select count(*) into taken from tournament_entries where tournament_id = p_tournament;
  if taken >= t.max_entries then
    raise exception 'This tournament is full.' using errcode = 'P0001';
  end if;

  insert into tournament_entries (tournament_id, user_id) values (p_tournament, me);
end
$$;

create or replace function public.leave_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st public.tournament_status;
begin
  select status into st from tournaments where id = p_tournament;
  if st is distinct from 'registration' then
    -- Pulling out of a drawn bracket would leave a hole in it. Once it has
    -- started, the desk records a walkover instead.
    raise exception 'The draw has been made — ask the organiser to withdraw you.' using errcode = 'P0001';
  end if;
  delete from tournament_entries where tournament_id = p_tournament and user_id = auth.uid();
end
$$;

-- ---- building the bracket ----

-- The standard seeding order for a bracket of p_size slots: the seed in each
-- slot, top to bottom. 8 → {1,8,4,5,2,7,3,6}. Built by doubling: each seed s in
-- a bracket of n becomes the pair (s, 2n+1-s) in a bracket of 2n.
create or replace function public.bracket_seed_order(p_size int)
returns int[]
language plpgsql immutable
as $$
declare
  cur int[] := array[1];
  nxt int[];
  n int := 1;
  s int;
begin
  while n < p_size loop
    nxt := '{}';
    foreach s in array cur loop
      nxt := nxt || s || (2 * n + 1 - s);
    end loop;
    cur := nxt;
    n := n * 2;
  end loop;
  return cur;
end
$$;

-- Put a winner into the next round: slot s feeds slot s/2, as the top player
-- when s is even and the bottom player when s is odd. The final has nowhere to
-- go, so its winner becomes the champion and the tournament is complete.
create or replace function public.tournament_advance(p_match uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m record;
  last_round int;
begin
  select tm.*, t.bracket_size into m
    from tournament_matches tm join tournaments t on t.id = tm.tournament_id
   where tm.id = p_match;
  last_round := round(log(2, m.bracket_size))::int;

  if m.round >= last_round then
    update tournaments set champion_id = m.winner, status = 'completed' where id = m.tournament_id;
    return;
  end if;

  if m.slot % 2 = 0 then
    update tournament_matches set player_a = m.winner
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  else
    update tournament_matches set player_b = m.winner
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  end if;
end
$$;

create or replace function public.start_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t record;
  n int;
  size int := 2;
  rounds int;
  ord int[];
  seeded uuid[];
  r int;
  s int;
  a uuid;
  b uuid;
  mid uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the organiser can start a tournament.' using errcode = '42501';
  end if;
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'That tournament doesn''t exist.' using errcode = 'P0002'; end if;
  if t.status <> 'registration' then
    raise exception 'This tournament has already been drawn.' using errcode = 'P0001';
  end if;

  -- Anyone suspended since they entered doesn't get a place in the draw.
  delete from tournament_entries e
   where e.tournament_id = p_tournament and public.is_suspended(e.user_id);

  select count(*) into n from tournament_entries where tournament_id = p_tournament;
  if n < 2 then
    raise exception 'A tournament needs at least 2 players to start.' using errcode = 'P0001';
  end if;

  while size < n loop size := size * 2; end loop;
  rounds := round(log(2, size))::int;
  -- Recorded before any match exists: advancing a bye needs to know which
  -- round is the final.
  update tournaments set bracket_size = size where id = p_tournament;

  -- The draw: a random order is the seeding.
  select array_agg(user_id order by random()) into seeded
    from tournament_entries where tournament_id = p_tournament;
  for s in 1..n loop
    update tournament_entries set seed = s
     where tournament_id = p_tournament and user_id = seeded[s];
  end loop;

  -- Every round's matches exist from the start, empty until they are filled.
  for r in 1..rounds loop
    for s in 0..(size / (2 ^ r))::int - 1 loop
      insert into tournament_matches (tournament_id, round, slot) values (p_tournament, r, s);
    end loop;
  end loop;

  -- Round 1 in seeding order; a seed beyond the field is a bye.
  ord := public.bracket_seed_order(size);
  for s in 0..size / 2 - 1 loop
    a := case when ord[2 * s + 1] <= n then seeded[ord[2 * s + 1]] end;
    b := case when ord[2 * s + 2] <= n then seeded[ord[2 * s + 2]] end;
    update tournament_matches
       set player_a = a, player_b = b,
           is_bye = (a is null or b is null),
           winner = case when a is null then b when b is null then a end
     where tournament_id = p_tournament and round = 1 and slot = s
     returning id into mid;
    if a is null or b is null then
      perform public.tournament_advance(mid);
    end if;
  end loop;

  update tournaments set status = 'in_progress' where id = p_tournament;
end
$$;

-- ---- recording results ----
create or replace function public.report_match_result(p_match uuid, p_winner uuid, p_score text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  m record;
  t record;
  nxt record;
  last_round int;
begin
  select * into m from tournament_matches where id = p_match for update;
  if not found then raise exception 'That match doesn''t exist.' using errcode = 'P0002'; end if;
  select * into t from tournaments where id = m.tournament_id for update;

  if t.status = 'cancelled' then
    raise exception 'This tournament was cancelled.' using errcode = 'P0001';
  end if;
  if t.status = 'registration' then
    raise exception 'The draw hasn''t been made yet.' using errcode = 'P0001';
  end if;
  if m.is_bye then
    raise exception 'A bye has no result to record.' using errcode = 'P0001';
  end if;
  if not admin and (me is null or me not in (coalesce(m.player_a, '00000000-0000-0000-0000-000000000000'),
                                             coalesce(m.player_b, '00000000-0000-0000-0000-000000000000'))) then
    raise exception 'Only the two players in a match can record its result.' using errcode = '42501';
  end if;
  if not admin and public.is_suspended(me) then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;

  -- Both places must be filled. The desk may still settle a match with one
  -- empty side — a player who deleted their account mid-tournament — by giving
  -- it to the one who is there.
  if m.player_a is null or m.player_b is null then
    if not admin or (m.player_a is null and m.player_b is null) then
      raise exception 'This match is still waiting for its players.' using errcode = 'P0001';
    end if;
  end if;
  if p_winner is null or p_winner not in (coalesce(m.player_a, '00000000-0000-0000-0000-000000000000'),
                                          coalesce(m.player_b, '00000000-0000-0000-0000-000000000000')) then
    raise exception 'The winner has to be one of the two players in the match.' using errcode = 'P0001';
  end if;

  last_round := round(log(2, t.bracket_size))::int;

  -- A result already recorded is final for the players; the desk can change it
  -- only while the next match hasn't been played, so the bracket never shows a
  -- winner who has advanced from a match they lost.
  if m.winner is not null then
    if not admin then
      raise exception 'This result is already in — ask the organiser to correct it.' using errcode = 'P0001';
    end if;
    if m.round < last_round then
      select * into nxt from tournament_matches
       where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
      if nxt.winner is not null then
        raise exception 'The next round has already been played — correct that result first.' using errcode = 'P0001';
      end if;
    end if;
    if t.status = 'completed' then
      update tournaments set status = 'in_progress', champion_id = null where id = t.id;
    end if;
  end if;

  update tournament_matches
     set winner = p_winner, score = left(btrim(coalesce(p_score, '')), 40),
         reported_by = me, reported_at = now()
   where id = p_match;
  perform public.tournament_advance(p_match);
end
$$;

-- Only signed-in members call these, and only through the rules inside them.
revoke all on function public.join_tournament(uuid) from public, anon;
revoke all on function public.leave_tournament(uuid) from public, anon;
revoke all on function public.start_tournament(uuid) from public, anon;
revoke all on function public.report_match_result(uuid, uuid, text) from public, anon;
revoke all on function public.tournament_advance(uuid) from public, anon, authenticated;
grant execute on function public.join_tournament(uuid) to authenticated;
grant execute on function public.leave_tournament(uuid) to authenticated;
grant execute on function public.start_tournament(uuid) to authenticated;
grant execute on function public.report_match_result(uuid, uuid, text) to authenticated;
grant execute on function public.bracket_seed_order(int) to authenticated;
