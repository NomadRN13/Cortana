-- 40/LOVE — an admin can actually remove someone
--
-- The moderation desk could mark a report "actioned", which set a status and
-- did nothing else. There was no way to stop a reported member using the app
-- short of deleting their auth.users row by hand in the Supabase dashboard —
-- not something anyone will do well at 11pm during a mixer, and not something
-- any document describes. Meanwhile the privacy policy says we keep the
-- community safe by "reviewing reports, enforcing blocks and bans", and Play
-- expects a dating app to be able to remove a member.
--
-- Suspension, not deletion: their account still exists, they can still sign in
-- and delete their own data, and it can be undone if the report was wrong.
-- What they cannot do is reach anybody.

alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text check (char_length(suspended_reason) <= 300);

comment on column public.profiles.suspended_at is
  'Set by an admin via suspend_member(). Non-null means: invisible in discovery, cannot swipe, message or RSVP. The member can still sign in and delete their account.';

create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = p_user and suspended_at is not null);
$$;

grant execute on function public.is_suspended(uuid) to authenticated;

-- ---- discovery -----------------------------------------------------------
-- The deck is security definer, so row-level security doesn't reach inside it.
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
      -- A suspended member is off the courts: out of everyone's deck, and
      -- their own deck is empty, so they cannot start anything new.
      and p.suspended_at is null
      and me.suspended_at is null
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
-- ---- who can be seen ------------------------------------------------------
-- Profile cards, chat headers, the matches grid: a suspended member drops out
-- of all of them. They can still read their own row, so the app works well
-- enough for them to leave.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (not public.is_blocked(auth.uid(), id) and suspended_at is null)
  );

-- ---- what a suspended member can no longer do -----------------------------
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.is_suspended(auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.user_a, m.user_b)
        and m.closed_at is null
        and not public.is_blocked(m.user_a, m.user_b)
    )
  );

drop policy if exists swipes_insert on public.swipes;
create policy swipes_insert on public.swipes
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and not public.is_suspended(auth.uid())
    and not public.is_blocked(auth.uid(), target_id)
  );

-- The real policy here is rsvps_write (FOR ALL), not an insert policy. Adding
-- a second permissive policy would have changed nothing: permissive policies
-- OR together, so the original would still have let a suspended member RSVP.
drop policy if exists rsvps_write on public.event_rsvps;
create policy rsvps_write on public.event_rsvps
  for all to authenticated
  using (user_id = auth.uid())
  -- USING still allows them to cancel an RSVP they already hold; WITH CHECK
  -- stops them taking a new place at an event.
  with check (user_id = auth.uid() and not public.is_suspended(auth.uid()));

-- ---- the desk -------------------------------------------------------------
-- Admin-only, and security definer because profiles_update only ever lets
-- somebody edit their own row — which is the point.
create or replace function public.suspend_member(p_user uuid, p_reason text default '')
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    return false;
  end if;
  if p_user = auth.uid() then
    return false;   -- suspending yourself locks the only person who can undo it
  end if;
  update profiles
     set suspended_at = coalesce(suspended_at, now()),
         suspended_reason = nullif(left(coalesce(p_reason, ''), 300), '')
   where id = p_user;
  if not found then
    return false;
  end if;
  -- Close their open conversations, so nothing they already sent keeps a
  -- thread alive on the other person's phone.
  update matches set closed_at = now()
   where closed_at is null and (user_a = p_user or user_b = p_user);
  return true;
end
$$;

create or replace function public.unsuspend_member(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    return false;
  end if;
  update profiles set suspended_at = null, suspended_reason = null where id = p_user;
  return found;
end
$$;

revoke all on function public.suspend_member(uuid, text) from public, anon;
revoke all on function public.unsuspend_member(uuid) from public, anon;
grant execute on function public.suspend_member(uuid, text) to authenticated;
grant execute on function public.unsuspend_member(uuid) to authenticated;

-- Deliberately withheld, like birthdate and the coordinates: whether an
-- account is suspended, and why, is between the member and the desk.
-- get_my_profile() is security definer and still returns the member's own row
-- whole, so the app can tell them.
revoke select (suspended_at, suspended_reason) on public.profiles from authenticated;
