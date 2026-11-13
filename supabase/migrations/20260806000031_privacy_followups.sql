-- RSVPlay — the two privacy follow-ups logged with migration 30
--
-- 1. is_blocked(a, b) and is_suspended(user) answered for ANY ids.
--    Row policies call them, and a policy's functions run as the member
--    reading the table, so members had to be able to execute them — and could
--    then ask directly whether two other members had blocked each other, or
--    whether anyone at all was suspended.
--
--    Members now get two helpers that only ever answer about themselves:
--      i_am_suspended()       — is my own account suspended?
--      hidden_from_me(other)  — is this person missing from my profile list?
--                               True for a block either way, a suspended
--                               account, and an id with no profile at all —
--                               the three look the same, exactly as they do
--                               in the profile list, so asking tells a member
--                               nothing they couldn't already see. (A helper
--                               that said "blocked" separately would tell the
--                               blocked person who blocked them; one that was
--                               false for a missing id would single out
--                               suspended accounts.)
--    Members can no longer execute is_blocked or is_suspended. Security
--    definer functions (the deck, cards, tournaments) still use them — they
--    run as the owner.
--
--    Every member-facing table that shows other people's ids now follows the
--    profile list, so none of them can be used to pick out suspended members
--    (rows that outlive a hidden profile) either:
--      profiles, user_sports, event_rsvps, tournament_entries — rows of
--        someone not in your profile list are not shown;
--      profile_photos — approved photos only of people in your profile list
--        (they used to be readable for everyone, blocked and suspended
--        included; the photo files follow, through the storage policy);
--      swipes, messages — you can't act on someone hidden from you.
--    Still visible, by design: a tournament bracket keeps every place,
--    including a player hidden from you (shown unnamed), so a bracket player
--    suspended after the draw can be told apart from one who left. Narrow,
--    and logged in the launch checklist.
--
-- 2. Switching a doubles partner on and off could probe someone's
--    Play/Friends partner preference. The deck's "plays with women / men /
--    everyone" test runs on your gender and, for a team, your partner's; with
--    your own gender limited since migration 30, a partner you could add,
--    remove and re-add at will was the remaining way to change what that test
--    sees. Adding a partner, or changing their gender, is now free in the
--    first hour after signup and then once every 30 days. Removing a partner
--    is always allowed — they may have asked to come off — and editing their
--    name or birthdate is unaffected (neither is used in matching).
--    Also closed: clearing your own gender and then setting a new one used to
--    skip the 30-day count from migration 30.
--
-- 3. From a final adversarial check of the above:
--    · matches_close let a member update ANY column of a match they were in —
--      including swapping the other member for someone else, who would then
--      receive messages without ever having liked them and could read the
--      earlier conversation. Members can no longer update matches at all
--      (suspension closes matches from a security definer function; the app
--      never edits them).
--    · Your own matches told a block from a suspension: a match with someone
--      who blocked you stayed open, a suspended member's was closed. Matches
--      (and so their messages) with someone hidden from you are no longer
--      shown, and undo_swipe treats a hidden person the same way every time.
--    · Blocking or reporting went straight into the tables, where a deleted
--      or made-up id failed a foreign key but a hidden one succeeded. Both now
--      go through block_member() / report_member(), which quietly do nothing
--      for an id with no profile. Your own swipes on someone hidden from you
--      are hidden the same way. Reports are no longer readable by the member
--      who filed them — "actioned" gave away a suspension; the app never
--      read them back.
--    · Known and accepted: a tournament's entry count includes entrants
--      hidden from you, and its bracket keeps every place (a hidden player is
--      shown unnamed); the draw leaves out suspended entrants. Together these
--      can hint at whether a hidden entrant blocked you or was suspended.
--      Tournaments are opt-in and public; logged in the launch checklist.

-- ---- 1. caller-scoped helpers ----
create or replace function public.i_am_suspended()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and public.is_suspended(auth.uid())
$$;

create or replace function public.hidden_from_me(p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then true
    when p_other = auth.uid() then false
    else public.is_blocked(auth.uid(), p_other)
         or not exists (select 1 from public.profiles p
                         where p.id = p_other and p.suspended_at is null)
  end
$$;

revoke all on function public.i_am_suspended() from public, anon;
revoke all on function public.hidden_from_me(uuid) from public, anon;
grant execute on function public.i_am_suspended() to authenticated;
grant execute on function public.hidden_from_me(uuid) to authenticated;

-- ---- 1. the policies, on the new helpers ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or not public.hidden_from_me(id));

drop policy if exists user_sports_select on public.user_sports;
create policy user_sports_select on public.user_sports
  for select to authenticated
  using (user_id = auth.uid() or not public.hidden_from_me(user_id));

drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps
  for select to authenticated
  using (user_id = auth.uid() or not public.hidden_from_me(user_id));

drop policy if exists rsvps_write on public.event_rsvps;
create policy rsvps_write on public.event_rsvps
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not public.i_am_suspended());

drop policy if exists photos_select on public.profile_photos;
create policy photos_select on public.profile_photos
  for select to authenticated
  using (
    user_id = auth.uid()
    or (moderation_status = 'approved' and not public.hidden_from_me(user_id))
  );

drop policy if exists swipes_insert on public.swipes;
create policy swipes_insert on public.swipes
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and not public.i_am_suspended()
    and not public.hidden_from_me(target_id)
  );

-- The match's other member: the caller is one of the two (checked alongside).
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.i_am_suspended()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.user_a, m.user_b)
        and m.closed_at is null
        and not public.hidden_from_me(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
    )
  );

drop policy if exists tournament_entries_select on public.tournament_entries;
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or not public.hidden_from_me(user_id)
  );

-- ---- 1. and members can no longer ask the originals about anyone ----
revoke all on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_suspended(uuid) from public, anon, authenticated;

-- ---- 2. the doubles-partner limit ----
alter table public.profiles
  add column team_updated_at timestamptz;

-- The member write guard from migration 30, plus team_updated_at as a
-- protected column and the partner rule. Everything else is unchanged.
create or replace function public.profiles_guard_member_writes()
returns trigger
language plpgsql
as $$
declare
  settled boolean;  -- past the first hour after signup
begin
  -- Only a member's own session is limited. Security definer functions run as
  -- their owner, and the service role and SQL editor are not members.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new profile starts unverified, unsuspended and with no position: the
    -- app sets the position afterwards through set_my_location().
    new.verified_at := null;
    new.phone_verified_at := null;
    new.suspended_at := null;
    new.suspended_reason := null;
    new.approx_lat := null;
    new.approx_lng := null;
    new.location_updated_at := null;
    new.gender_updated_at := null;
    new.team_updated_at := null;
    new.created_at := now();
    new.last_active_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.verified_at is distinct from old.verified_at
     or new.phone_verified_at is distinct from old.phone_verified_at
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason
     or new.created_at is distinct from old.created_at
     or new.approx_lat is distinct from old.approx_lat
     or new.approx_lng is distinct from old.approx_lng
     or new.location_updated_at is distinct from old.location_updated_at
     or new.gender_updated_at is distinct from old.gender_updated_at
     or new.team_updated_at is distinct from old.team_updated_at then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;

  -- Your birthdate is fixed once your profile exists. Matching filters on it,
  -- so changing it at will would let a member read other people's age ranges
  -- off the deck.
  if new.birthdate is distinct from old.birthdate then
    raise exception 'Your birthdate can''t be changed in the app. If it''s wrong, email hello@rsvplay.app and we''ll fix it.'
      using errcode = '42501';
  end if;

  settled := old.created_at < now() - interval '1 hour';

  -- Gender: freely in the first hour (a mis-tap at signup), then once every
  -- 30 days, for the same reason — the deck's "who are they looking for" test
  -- runs on it. Clearing it counts as a change too, so it can't be stepped
  -- through empty to get a second change.
  if new.gender is distinct from old.gender then
    if settled
       and old.gender_updated_at is not null
       and old.gender_updated_at > now() - interval '30 days' then
      raise exception 'You can change this once every 30 days. If it''s wrong, email hello@rsvplay.app and we''ll fix it.'
        using errcode = '42501';
    end if;
    if settled then
      new.gender_updated_at := now();
    end if;
  end if;

  -- A doubles partner: adding one, or changing their gender, freely in the
  -- first hour and then once every 30 days. Removing one is always allowed.
  if (new.is_team and not old.is_team)
     or (new.is_team and old.is_team and new.partner_gender is distinct from old.partner_gender) then
    if settled
       and old.team_updated_at is not null
       and old.team_updated_at > now() - interval '30 days' then
      raise exception 'You can add or change a doubles partner once every 30 days. Removing one is always fine — email hello@rsvplay.app if you need a hand.'
        using errcode = '42501';
    end if;
    if settled then
      new.team_updated_at := now();
    end if;
  end if;

  -- "Last active" means now, whatever the app sent — a date in the future
  -- would otherwise keep a profile looking active for ever.
  if new.last_active_at is distinct from old.last_active_at then
    new.last_active_at := now();
  end if;
  return new;
end
$$;

revoke all on function public.profiles_guard_member_writes() from public, anon, authenticated;

-- ---- 3. matches: no member edits; hidden counterparts not shown ----
drop policy if exists matches_close on public.matches;
revoke update on public.matches from anon, authenticated;

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (
    auth.uid() in (user_a, user_b)
    and not public.hidden_from_me(case when user_a = auth.uid() then user_b else user_a end)
  );

-- ---- 3. your own swipes and reports ----
drop policy if exists swipes_select on public.swipes;
create policy swipes_select on public.swipes
  for select to authenticated
  using (actor_id = auth.uid() and not public.hidden_from_me(target_id));

drop policy if exists reports_select on public.reports;

-- ---- 3. undo_swipe: a hidden person is treated the same way every time ----
create or replace function public.undo_swipe(p_target uuid, p_mode public.app_mode)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_match uuid;
begin
  if p_target is null or auth.uid() is null or p_target = auth.uid() then
    return false;
  end if;

  -- Someone hidden from you (blocked either way, suspended, or gone): take
  -- your swipe back and say nothing about any match — whether one is open,
  -- closed or has messages would tell a block from a suspension.
  if public.hidden_from_me(p_target) then
    delete from swipes
    where actor_id = auth.uid() and target_id = p_target and mode = p_mode;
    return true;
  end if;

  select id into v_match
  from matches
  where mode = p_mode
    and closed_at is null
    and user_a = least(auth.uid(), p_target)
    and user_b = greatest(auth.uid(), p_target);

  if v_match is not null then
    if exists (select 1 from messages where match_id = v_match) then
      return false;
    end if;
    delete from notifications
    where kind = 'match' and payload->>'match_id' = v_match::text;
    delete from matches where id = v_match;
  end if;

  delete from swipes
  where actor_id = auth.uid() and target_id = p_target and mode = p_mode;
  return true;
end
$$;

revoke all on function public.undo_swipe(uuid, public.app_mode) from public, anon;
grant execute on function public.undo_swipe(uuid, public.app_mode) to authenticated;

-- ---- 3. blocking and reporting through functions ----
create or replace function public.block_member(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_target is null or p_target = me then
    raise exception 'That isn''t someone you can block.' using errcode = '22023';
  end if;
  -- An id with no profile: nothing to block, and no error that would say so.
  if exists (select 1 from profiles where id = p_target) then
    insert into blocks (blocker_id, blocked_id) values (me, p_target)
    on conflict do nothing;
  end if;
end
$$;

create or replace function public.report_member(p_target uuid, p_reason text, p_context text default 'deck')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- Checked before looking the person up, so a bad report fails the same way
  -- whoever it is about.
  if p_target is null or p_target = me then
    raise exception 'That isn''t someone you can report.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Tell us what happened, in 500 characters or fewer.' using errcode = '22023';
  end if;
  if coalesce(p_context, 'deck') not in ('deck', 'chat', 'event') then
    raise exception 'Unknown report context.' using errcode = '22023';
  end if;
  if exists (select 1 from profiles where id = p_target) then
    insert into reports (reporter_id, target_id, reason, context)
    values (me, p_target, btrim(p_reason), coalesce(p_context, 'deck'));
  end if;
end
$$;

revoke all on function public.block_member(uuid) from public, anon;
revoke all on function public.report_member(uuid, text, text) from public, anon;
grant execute on function public.block_member(uuid) to authenticated;
grant execute on function public.report_member(uuid, text, text) to authenticated;

drop policy if exists blocks_insert on public.blocks;
drop policy if exists reports_insert on public.reports;
revoke insert on public.blocks from anon, authenticated;
revoke insert on public.reports from anon, authenticated;
