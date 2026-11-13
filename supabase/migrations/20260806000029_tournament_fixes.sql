-- 40/LOVE — tournament fixes from an independent review
--
-- 1. A player who deletes their account mid-tournament no longer stalls the
--    bracket. Their side of every match is cleared (ON DELETE SET NULL), and so
--    is `winner` on every match they won — which used to make those matches look
--    unplayed, so the "next round already played" guard stopped protecting them
--    and the desk had no way to settle the match they left. Now:
--      · "has this been played?" is read from reported_at (a plain column that
--        survives a deletion), not from winner;
--      · the desk can settle a match with one empty side, but only when that
--        side was VACATED (its player deleted their account) — never when it is
--        merely still to be decided by an unplayed earlier match.
-- 2. Every path locks the tournament row first, then match rows, so a result
--    and a correction reported at the same moment can't deadlock.
-- 3. The second player confirming the same result is a no-op, not an error
--    ("already in — ask the organiser") — both players recording the match they
--    just played is the normal case, not a dispute.
-- 4. leave_tournament locks the tournament, so a member can't slip out while the
--    draw is being made and still be drawn; leaving a deleted tournament is a
--    no-op rather than "the draw has been made".
-- 5. The desk sees every entrant. Entry RLS hid anyone the organiser's own
--    account had a block with, so the desk's count and "Make the draw with N
--    entries" could disagree with what start_tournament actually drew. Names on
--    the desk come from an admin-only lookup for the same reason. Members still
--    never see someone they have a block with, and no longer see a suspended
--    entrant either.
-- 6. entry_count on tournaments, kept by a trigger: the true count, which a
--    member's block-filtered entry list can't give them. Without it a member
--    with one block among 72 entrants saw "71 of 72" and an Enter button on a
--    full tournament.
-- 7. completed_at, so the app can list a finished tournament for two weeks
--    after it finished — not two weeks after it started, which dropped a long
--    tournament from the app while it was still being played.
-- 8. bracket_seed_order is internal: no longer callable through the API (it
--    was, by anyone, with any size — a cheap way to burn CPU), and it refuses a
--    size outside 1..128.

-- ---- 6, 7: columns ----
alter table public.tournaments
  add column entry_count int not null default 0 check (entry_count >= 0),
  add column completed_at timestamptz;

update public.tournaments t
   set entry_count = (select count(*) from public.tournament_entries e where e.tournament_id = t.id),
       completed_at = case when t.status = 'completed' then now() end;

create or replace function public.tournament_entry_count_sync()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update tournaments set entry_count = entry_count + 1 where id = new.tournament_id;
    return new;
  end if;
  -- On a cascade from deleting the tournament itself the row is already gone;
  -- the update then simply matches nothing.
  update tournaments set entry_count = greatest(0, entry_count - 1) where id = old.tournament_id;
  return old;
end
$$;

create trigger tournament_entry_count_sync
  after insert or delete on public.tournament_entries
  for each row execute function public.tournament_entry_count_sync();

revoke all on function public.tournament_entry_count_sync() from public, anon, authenticated;

-- ---- 5: who can see an entry ----
drop policy if exists tournament_entries_select on public.tournament_entries;
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (not public.is_blocked(auth.uid(), user_id) and not public.is_suspended(user_id))
  );

-- Names for the desk's brackets and entry lists. get_profile_cards withholds a
-- card when there is a block between the caller and that member, which is right
-- for members and wrong for the organiser running the draw.
create or replace function public.admin_player_names(p_ids uuid[])
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the organiser can look these up.' using errcode = '42501';
  end if;
  return query
    select p.id,
           case when p.is_team and coalesce(p.partner_name, '') <> ''
                then p.first_name || ' & ' || p.partner_name
                else p.first_name end
      from profiles p
     where p.id = any (p_ids);
end
$$;

revoke all on function public.admin_player_names(uuid[]) from public, anon;
grant execute on function public.admin_player_names(uuid[]) to authenticated;

-- ---- 8: the seed order is internal ----
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
  if p_size is null or p_size < 1 or p_size > 128 then
    raise exception 'A bracket has between 1 and 128 places.' using errcode = '22023';
  end if;
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

revoke all on function public.bracket_seed_order(int) from public, anon, authenticated;

-- ---- 7: completed_at is set when the final crowns a champion ----
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
    update tournaments set champion_id = m.winner, status = 'completed', completed_at = now()
     where id = m.tournament_id;
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

revoke all on function public.tournament_advance(uuid) from public, anon, authenticated;

-- ---- 4: leaving ----
create or replace function public.leave_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st public.tournament_status;
begin
  -- The same lock the draw takes: leaving waits for a draw in progress, and
  -- then sees that it has been made.
  select status into st from tournaments where id = p_tournament for update;
  if not found then
    return;  -- already gone: nothing left to leave
  end if;
  if st <> 'registration' then
    -- Pulling out of a drawn bracket would leave a hole in it. Once it has
    -- started, the desk records a walkover instead.
    raise exception 'The draw has been made — ask the organiser to withdraw you.' using errcode = 'P0001';
  end if;
  delete from tournament_entries where tournament_id = p_tournament and user_id = auth.uid();
end
$$;

-- ---- 1, 2, 3: recording results ----
create or replace function public.report_match_result(p_match uuid, p_winner uuid, p_score text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  tid uuid;
  m record;
  t record;
  nxt record;
  last_round int;
  empty_feeder_slot int;
  vacated boolean;
  nobody constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- Tournament first, then the match: the same order as every other path.
  select tournament_id into tid from tournament_matches where id = p_match;
  if not found then raise exception 'That match doesn''t exist.' using errcode = 'P0002'; end if;
  select * into t from tournaments where id = tid for update;
  select * into m from tournament_matches where id = p_match for update;

  if t.status = 'cancelled' then
    raise exception 'This tournament was cancelled.' using errcode = 'P0001';
  end if;
  if t.status = 'registration' then
    raise exception 'The draw hasn''t been made yet.' using errcode = 'P0001';
  end if;
  if m.is_bye then
    raise exception 'A bye has no result to record.' using errcode = 'P0001';
  end if;
  if not admin and (me is null or me not in (coalesce(m.player_a, nobody), coalesce(m.player_b, nobody))) then
    raise exception 'Only the two players in a match can record its result.' using errcode = '42501';
  end if;
  if not admin and public.is_suspended(me) then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;

  last_round := round(log(2, t.bracket_size))::int;

  -- Once the next match in this line has a result, this one is settled for
  -- everyone: correcting it would show someone advancing from a match they
  -- lost. reported_at, not winner — a winner who deleted their account leaves
  -- winner empty, but the match was still played.
  if m.round < last_round then
    select * into nxt from tournament_matches
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
    if nxt.reported_at is not null then
      raise exception 'The next round has already been played — correct that result first.' using errcode = 'P0001';
    end if;
  end if;

  -- Both places must be filled. The desk may settle a match with one empty
  -- side, but only when that side was vacated — its player deleted their
  -- account — not when an earlier match that fills it is still to be played.
  if m.player_a is null or m.player_b is null then
    if not admin or (m.player_a is null and m.player_b is null) then
      raise exception 'This match is still waiting for its players.' using errcode = 'P0001';
    end if;
    if m.round = 1 then
      vacated := true;  -- a first-round match that isn't a bye always had two players
    else
      empty_feeder_slot := m.slot * 2 + (case when m.player_a is null then 0 else 1 end);
      select exists (
        select 1 from tournament_matches f
         where f.tournament_id = m.tournament_id and f.round = m.round - 1 and f.slot = empty_feeder_slot
           and (f.reported_at is not null                    -- played; its winner has since left
                or f.is_bye                                  -- a bye whose player has since left
                or (f.round = 1 and f.player_a is null and f.player_b is null))  -- both first-round players left
      ) into vacated;
    end if;
    if not vacated then
      raise exception 'This match is still waiting for its players.' using errcode = 'P0001';
    end if;
  end if;

  if p_winner is null or p_winner not in (coalesce(m.player_a, nobody), coalesce(m.player_b, nobody)) then
    raise exception 'The winner has to be one of the two players in the match.' using errcode = 'P0001';
  end if;

  if m.reported_at is not null then
    if not admin then
      -- The other player recording the same result: it's already in, and that
      -- is fine. Don't overwrite the first reporter's score.
      if p_winner = m.winner then return; end if;
      raise exception 'This result is already in — ask the organiser to correct it.' using errcode = 'P0001';
    end if;
    if t.status = 'completed' then
      update tournaments set status = 'in_progress', champion_id = null, completed_at = null where id = t.id;
    end if;
  end if;

  update tournament_matches
     set winner = p_winner, score = left(btrim(coalesce(p_score, '')), 40),
         reported_by = me, reported_at = now()
   where id = p_match;
  perform public.tournament_advance(p_match);
end
$$;

revoke all on function public.report_match_result(uuid, uuid, text) from public, anon;
grant execute on function public.report_match_result(uuid, uuid, text) to authenticated;
revoke all on function public.leave_tournament(uuid) from public, anon;
grant execute on function public.leave_tournament(uuid) to authenticated;
