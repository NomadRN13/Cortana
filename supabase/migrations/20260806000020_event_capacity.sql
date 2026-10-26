-- 40/LOVE — stop events being oversubscribed
--
-- `capacity` was only ever a check on the number itself (between 2 and 500).
-- Nothing counted RSVPs against it, so a member could join a full mixer through
-- the API, and two people could take the last spot at the same moment. For an
-- event with real courts booked, that means someone drives across town to be
-- turned away — the kind of thing that costs a member for good.
--
-- Security definer because the guard has to read the event row and lock it, and
-- an ordinary member has no update rights on events (only admins do), which is
-- what SELECT ... FOR UPDATE would otherwise require.

create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cap int;
  taken int;
begin
  -- Leaving, or sitting on the waitlist, never needs a spot.
  if new.status not in ('going', 'checked_in') then
    return new;
  end if;

  -- Lock the event row first: without it two simultaneous joins both count the
  -- same "one spot left" and both succeed.
  select e.capacity into cap from public.events e where e.id = new.event_id for update;
  if cap is null then
    return new;
  end if;

  select count(*) into taken
    from public.event_rsvps r
   where r.event_id = new.event_id
     and r.status in ('going', 'checked_in')
     and r.user_id <> new.user_id;  -- an existing RSVP isn't competing with itself

  if taken >= cap then
    raise exception 'This event is full.' using errcode = 'P0001';
  end if;

  return new;
end
$$;

drop trigger if exists event_capacity_guard on public.event_rsvps;
create trigger event_capacity_guard
  before insert or update on public.event_rsvps
  for each row execute function public.enforce_event_capacity();
