-- RSVPlay — ladder leagues
--
-- "Socials, leagues and pickup games" is the positioning, and the event
-- calendar already advertises a "Ladder League Kickoff" — but nothing
-- modelled a league. This is the ladder:
--
--   · An admin creates a league for a city.
--   · A member joins and takes the bottom rung.
--   · You may challenge anyone up to two rungs above you. One open challenge
--     per pair at a time.
--   · Either of the two players records the result. If the challenger wins,
--     they take the challenged player's rung and everyone between moves down
--     one. If the challenged player wins, nothing moves.
--
-- The same people rules as everywhere else: a suspended member cannot join,
-- challenge or record; you cannot challenge someone you've blocked or who has
-- blocked you, and their name is not shown to you in the standings.
-- Standings come from a function that decides what to hand over; the tables
-- themselves show a member only their own rows.

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities (slug),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  venue text not null default '' check (char_length(venue) <= 80),
  sport public.sport not null default 'pickleball',
  level_range text not null default 'All levels' check (char_length(level_range) <= 40),
  starts_at timestamptz not null,
  weeks int not null default 8 check (weeks between 1 and 52),
  created_at timestamptz not null default now()
);
create index leagues_city_starts_idx on public.leagues (city, starts_at);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rung int not null check (rung >= 1),
  wins int not null default 0 check (wins >= 0),
  losses int not null default 0 check (losses >= 0),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id),
  unique (league_id, rung) deferrable initially deferred
);

create table public.league_challenges (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  challenger_id uuid not null references public.profiles (id) on delete cascade,
  challenged_id uuid not null references public.profiles (id) on delete cascade,
  winner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (challenger_id <> challenged_id)
);
create unique index league_challenges_open_idx
  on public.league_challenges (league_id, least(challenger_id, challenged_id), greatest(challenger_id, challenged_id))
  where decided_at is null;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_challenges enable row level security;

create policy leagues_select on public.leagues for select to authenticated using (true);
create policy leagues_admin_insert on public.leagues for insert to authenticated with check (public.is_admin());
create policy leagues_admin_update on public.leagues for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy leagues_admin_delete on public.leagues for delete to authenticated using (public.is_admin());

create policy league_members_select on public.league_members
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy league_challenges_select on public.league_challenges
  for select to authenticated using (auth.uid() in (challenger_id, challenged_id) or public.is_admin());
revoke insert, update, delete on public.league_members from anon, authenticated;
revoke insert, update, delete on public.league_challenges from anon, authenticated;

create or replace function public.join_league(p_league uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_rung int;
begin
  if me is null then
    raise exception 'Sign in to join.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = me) then
    raise exception 'Finish your profile before joining a league.' using errcode = 'P0002';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  perform 1 from leagues where id = p_league for update;
  if not found then
    raise exception 'That league doesn''t exist.' using errcode = 'P0002';
  end if;
  select rung into v_rung from league_members where league_id = p_league and user_id = me;
  if found then
    return v_rung;
  end if;
  select coalesce(max(rung), 0) + 1 into v_rung from league_members where league_id = p_league;
  insert into league_members (league_id, user_id, rung) values (p_league, me, v_rung);
  return v_rung;
end
$$;

-- Leaving closes the gap: everyone below moves up one. Open challenges go.
create or replace function public.leave_league(p_league uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_rung int;
begin
  perform 1 from leagues where id = p_league for update;
  delete from league_members where league_id = p_league and user_id = me returning rung into v_rung;
  if v_rung is null then
    return;
  end if;
  delete from league_challenges
   where league_id = p_league and decided_at is null and me in (challenger_id, challenged_id);
  update league_members set rung = rung - 1 where league_id = p_league and rung > v_rung;
end
$$;

create or replace function public.get_league_standings(p_league uuid)
returns table (rung int, user_id uuid, first_name text, wins int, losses int, is_me boolean)
language sql stable security definer set search_path = public
as $$
  select m.rung,
         -- Someone hidden from you keeps their rung but not their identity.
         case when public.hidden_from_me(m.user_id) then null else m.user_id end,
         case when public.hidden_from_me(m.user_id) then 'Player' else p.first_name end,
         m.wins, m.losses, m.user_id = auth.uid()
    from league_members m
    join profiles p on p.id = m.user_id
   where m.league_id = p_league and auth.uid() is not null
   order by m.rung
$$;

create or replace function public.league_challenge(p_league uuid, p_target uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_rung int;
  their_rung int;
  v_id uuid;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  select rung into my_rung from league_members where league_id = p_league and user_id = me;
  if my_rung is null then
    raise exception 'Join the league before you challenge anyone.' using errcode = 'P0002';
  end if;
  select rung into their_rung from league_members where league_id = p_league and user_id = p_target;
  -- Not in the league, blocked, suspended, or yourself: one answer for all.
  if their_rung is null or p_target = me or public.hidden_from_me(p_target) then
    raise exception 'That isn''t someone you can challenge.' using errcode = '22023';
  end if;
  if their_rung > my_rung or my_rung - their_rung > 2 then
    raise exception 'You can challenge up to two rungs above you.' using errcode = '22023';
  end if;
  begin
    insert into league_challenges (league_id, challenger_id, challenged_id)
    values (p_league, me, p_target) returning id into v_id;
  exception when unique_violation then
    raise exception 'You two already have a challenge to play.' using errcode = '23505';
  end;
  return v_id;
end
$$;

create or replace function public.report_league_result(p_challenge uuid, p_winner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  c record;
  hi int;  -- the challenged player's rung (numerically smaller)
  lo int;  -- the challenger's rung
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if public.i_am_suspended() then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  select * into c from league_challenges where id = p_challenge for update;
  if not found then
    raise exception 'That challenge doesn''t exist.' using errcode = 'P0002';
  end if;
  if me not in (c.challenger_id, c.challenged_id) then
    raise exception 'Only the two players in a challenge can record its result.' using errcode = '42501';
  end if;
  if c.decided_at is not null then
    raise exception 'This result is already in.' using errcode = '22023';
  end if;
  if p_winner is null or p_winner not in (c.challenger_id, c.challenged_id) then
    raise exception 'The winner has to be one of the two players.' using errcode = '22023';
  end if;
  perform 1 from leagues where id = c.league_id for update;
  select rung into hi from league_members where league_id = c.league_id and user_id = c.challenged_id;
  select rung into lo from league_members where league_id = c.league_id and user_id = c.challenger_id;
  if hi is null or lo is null then
    raise exception 'One of you has left the league.' using errcode = '22023';
  end if;

  update league_challenges set winner_id = p_winner, decided_at = now() where id = p_challenge;
  update league_members set wins = wins + 1 where league_id = c.league_id and user_id = p_winner;
  update league_members set losses = losses + 1
   where league_id = c.league_id
     and user_id = case when p_winner = c.challenger_id then c.challenged_id else c.challenger_id end;

  -- The challenger won from below: take that rung, everyone between drops one.
  if p_winner = c.challenger_id and lo > hi then
    update league_members set rung = rung + 1
     where league_id = c.league_id and rung >= hi and rung < lo;
    update league_members set rung = hi
     where league_id = c.league_id and user_id = c.challenger_id;
  end if;
end
$$;

-- A suspended member is taken off every ladder, like tournaments.
create or replace function public.profiles_suspension_leaves_leagues()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  if new.suspended_at is not null and old.suspended_at is null then
    for r in select league_id, rung from league_members where user_id = new.id order by league_id loop
      delete from league_members where league_id = r.league_id and user_id = new.id;
      delete from league_challenges
       where league_id = r.league_id and decided_at is null and new.id in (challenger_id, challenged_id);
      update league_members set rung = rung - 1 where league_id = r.league_id and rung > r.rung;
    end loop;
  end if;
  return new;
end
$$;
create trigger profiles_suspension_leaves_leagues
  after update on public.profiles
  for each row execute function public.profiles_suspension_leaves_leagues();

revoke all on function public.join_league(uuid) from public, anon;
revoke all on function public.leave_league(uuid) from public, anon;
revoke all on function public.get_league_standings(uuid) from public, anon;
revoke all on function public.league_challenge(uuid, uuid) from public, anon;
revoke all on function public.report_league_result(uuid, uuid) from public, anon;
revoke all on function public.profiles_suspension_leaves_leagues() from public, anon, authenticated;
grant execute on function public.join_league(uuid) to authenticated;
grant execute on function public.leave_league(uuid) to authenticated;
grant execute on function public.get_league_standings(uuid) to authenticated;
grant execute on function public.league_challenge(uuid, uuid) to authenticated;
grant execute on function public.report_league_result(uuid, uuid) to authenticated;
