-- RSVPlay — quiet hours for push notifications
--
-- The architecture says notifications keep quiet from 10pm to 8am local time.
-- Nothing enforced it: the push function sent the moment a row landed, in
-- whatever timezone the server happened to think it was.
--
-- The phone tells us its timezone (an IANA name such as America/Indiana/
-- Indianapolis) through set_my_timezone(). in_quiet_hours() answers for the
-- push function, which now holds a push back during those hours. The
-- notification itself is still written, so it is in the app's inbox when the
-- member next opens it; only the buzz is skipped. A member with no timezone
-- on file is never treated as being in quiet hours.

alter table public.profiles
  add column timezone text check (char_length(timezone) <= 64);

create or replace function public.set_my_timezone(p_tz text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'That isn''t a timezone we know.' using errcode = '22023';
  end if;
  update profiles set timezone = p_tz where id = auth.uid();
end
$$;

-- A timezone written straight to the row has to be a real one too.
create or replace function public.profiles_check_timezone()
returns trigger language plpgsql
as $$
begin
  if new.timezone is not null
     and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'That isn''t a timezone we know.' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger profiles_check_timezone
  before insert or update on public.profiles
  for each row execute function public.profiles_check_timezone();

-- 10pm–8am in the member's own timezone. p_at is there so it can be tested.
create or replace function public.in_quiet_hours(p_user uuid, p_at timestamptz default now())
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select extract(hour from (p_at at time zone p.timezone)) >= 22
        or extract(hour from (p_at at time zone p.timezone)) < 8
      from profiles p
     where p.id = p_user and p.timezone is not null), false)
$$;

revoke all on function public.set_my_timezone(text) from public, anon;
grant execute on function public.set_my_timezone(text) to authenticated;
-- Only the push function (service role) asks; members have no reason to.
revoke all on function public.in_quiet_hours(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.profiles_check_timezone() from public, anon, authenticated;
