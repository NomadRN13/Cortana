-- RSVPlay — Free, Plus and Club
--
-- The revenue order is event tickets, then Club membership (event discounts
-- and priority signup), then venue deals. This lays the entitlement down so
-- the app can show it honestly; it takes no money. There is no purchase flow
-- and no payment table here — when one exists it will set the tier through
-- the service role, the same way an admin does today.
--
--   · profiles.tier: 'free' | 'plus' | 'club'. A member cannot write it.
--   · events.price_cents and events.club_discount_pct: what the app shows
--     ("Club members save 20%"). Display only.
--   · events.general_opens_at: priority signup. Before it, only Club members
--     can RSVP; after it (or when null) everyone can.
--
-- One price for everyone at a tier. No pricing by gender, ever.

alter table public.profiles
  add column tier text not null default 'free' check (tier in ('free', 'plus', 'club'));

alter table public.events
  add column price_cents int check (price_cents is null or price_cents between 0 and 100000),
  add column club_discount_pct int not null default 0 check (club_discount_pct between 0 and 100),
  add column general_opens_at timestamptz;

-- A member's own session can never set or change its tier.
create or replace function public.profiles_guard_tier()
returns trigger language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
  elsif new.tier is distinct from old.tier then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger profiles_guard_tier
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_tier();

create or replace function public.set_member_tier(p_user uuid, p_tier text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_desk() then
    return false;
  end if;
  if p_tier not in ('free', 'plus', 'club') then
    raise exception 'Unknown tier.' using errcode = '22023';
  end if;
  update profiles set tier = p_tier where id = p_user;
  return found;
end
$$;

-- Priority signup: taking a place before general signup opens needs Club.
create or replace function public.enforce_event_priority()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  opens timestamptz;
begin
  if new.status not in ('going') then
    return new;
  end if;
  -- Already holding a place at THIS event (not relying on migration 33's
  -- guard to stop the row being pointed at another one).
  if tg_op = 'UPDATE' and old.status in ('going', 'checked_in')
     and new.event_id = old.event_id and new.user_id = old.user_id then
    return new;
  end if;
  select general_opens_at into opens from events where id = new.event_id;
  if opens is not null and now() < opens
     and not exists (select 1 from profiles where id = new.user_id and tier = 'club') then
    raise exception 'Signup opens to everyone soon. Club members can RSVP now.' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger event_priority_guard
  before insert or update on public.event_rsvps
  for each row execute function public.enforce_event_priority();

revoke all on function public.profiles_guard_tier() from public, anon, authenticated;
revoke all on function public.enforce_event_priority() from public, anon, authenticated;
revoke all on function public.set_member_tier(uuid, text) from public, anon;
grant execute on function public.set_member_tier(uuid, text) to authenticated;
