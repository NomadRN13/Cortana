-- RSVPlay — three likes a day in Date mode
--
-- Founder's decision, 2026-11-14: in Date mode a member gets 3 likes per
-- rolling 24 hours, for now. A like and an ace (super like) both count; a pass
-- never does. Play and Friends are not affected (they keep the 500-a-day
-- anti-script limit from migration 35).
--
-- The number lives in app_settings (date_likes_per_day), so it can change
-- without an app release, from the SQL editor only. date_like_allowance() is
-- the one place that answers "how many may this member have"; when likes can
-- be bought or come with a membership (docs/proposals/2026-11-14-like-packs.md)
-- only that function changes.
--
-- Counted in rate_events (migration 35), stamped by the server: undoing a like
-- does not give it back, and a backdated swipe counts now. The trigger already
-- runs before every swipe insert; swipes can't be updated by members, so a pass
-- can't be turned into a like to get round it.

alter table public.app_settings
  add column date_likes_per_day int not null default 3 check (date_likes_per_day between 0 and 1000);

alter table public.rate_events drop constraint if exists rate_events_kind_check;
alter table public.rate_events
  add constraint rate_events_kind_check check (kind in ('swipe', 'report', 'message', 'date_like'));

-- How many Date-mode likes a member may make per rolling 24 hours.
create or replace function public.date_like_allowance(p_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce((select date_likes_per_day from app_settings limit 1), 3)
$$;
revoke all on function public.date_like_allowance(uuid) from public, anon, authenticated;

create or replace function public.rate_limit_swipes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_at := now();  -- the server's clock, whatever the client sent
  perform public.rate_limit_take('swipe', 500, interval '24 hours',
    'That''s plenty for one day. The deck will be here tomorrow.');
  if new.mode = 'date' and new.action in ('like', 'ace') then
    perform public.rate_limit_take('date_like', public.date_like_allowance(auth.uid()), interval '24 hours',
      'You''ve used today''s likes in Date mode. More tomorrow.');
  end if;
  return new;
end $$;

-- What the app shows: likes left in Date mode, and when the next one comes
-- back (the oldest like in the window turning 24 hours old). Only the caller's
-- own count; nothing about anyone else.
create or replace function public.get_my_date_likes()
returns table (allowance int, used int, remaining int, next_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  a int;
  u int;
  oldest timestamptz;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  a := public.date_like_allowance(me);
  select count(*), min(at) into u, oldest
    from rate_events
   where user_id = me and kind = 'date_like' and at > now() - interval '24 hours';
  return query select a, u, greatest(a - u, 0),
    case when u >= a and oldest is not null then oldest + interval '24 hours' end;
end $$;
revoke all on function public.get_my_date_likes() from public, anon;
grant execute on function public.get_my_date_likes() to authenticated;
