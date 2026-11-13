-- RSVPlay — "real people only" enforced by the database
--
-- The app has always made a new member verify a phone number before finishing
-- signup. The database never required it: an account that simply skipped the
-- step through the API could swipe, message and RSVP — and, since a phone ban
-- (migration 34) is checked when a number is verified, an account that never
-- verified could never be matched to a ban.
--
-- Now the things that reach other people need a verified phone:
-- swiping, messaging, taking a place at an event, entering a tournament and
-- joining a ladder. Reading, editing your own profile, reporting, blocking
-- and deleting your account do not — nobody is locked out of leaving, or of
-- asking for help.
--
-- app_settings.require_verified_phone is the switch. It is ON, and nothing
-- reachable through the API can read or change it. The test harness turns it
-- off for the suites that predate it and on again to test it.

create table public.app_settings (
  id boolean primary key default true check (id),  -- one row
  require_verified_phone boolean not null default true
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.require_verified_phone()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Members' own sessions only: the seed, the service role and the SQL editor
  -- have no auth.uid().
  if auth.uid() is null then
    return new;
  end if;
  if (select require_verified_phone from app_settings)
     and not exists (select 1 from profiles
                      where id = auth.uid() and phone_verified_at is not null) then
    raise exception 'Verify your phone number to continue.' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function public.require_verified_phone() from public, anon, authenticated;

create trigger swipes_require_phone before insert on public.swipes
  for each row execute function public.require_verified_phone();
create trigger messages_require_phone before insert on public.messages
  for each row execute function public.require_verified_phone();
create trigger event_rsvps_require_phone before insert on public.event_rsvps
  for each row execute function public.require_verified_phone();
create trigger tournament_entries_require_phone before insert on public.tournament_entries
  for each row execute function public.require_verified_phone();
create trigger league_members_require_phone before insert on public.league_members
  for each row execute function public.require_verified_phone();
