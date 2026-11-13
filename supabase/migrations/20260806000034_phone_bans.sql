-- RSVPlay — a ban that sticks to the phone number
--
-- The architecture promised "bans are by phone number hash, not just account".
-- What existed was suspension, which is per account: a suspended member could
-- delete the account, sign up again with a new email, verify the same phone
-- and be back in the deck the same evening.
--
-- ban_member() suspends the account AND records a hash of its verified
-- number. sync_phone_verification() — the only way a profile becomes
-- phone-verified — now refuses a banned number and suspends the profile that
-- tried. The raw number is never copied out of auth.users.
--
-- Honest limit: phone numbers are a small space, so the hash is not secrecy
-- against someone holding the database; it is there so the ban list is not a
-- list of phone numbers. Nobody but the database owner can read the table.

create table public.banned_phones (
  phone_hash text primary key,
  reason text not null default '' check (char_length(reason) <= 300),
  banned_at timestamptz not null default now()
);
alter table public.banned_phones enable row level security;
-- No policies at all: not readable or writable through the API, admins included.
revoke all on public.banned_phones from anon, authenticated;

create or replace function public.phone_ban_hash(p_phone text)
returns text language sql immutable
as $$ select encode(sha256(convert_to('rsvplay:ban:' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 'UTF8')), 'hex') $$;
revoke all on function public.phone_ban_hash(text) from public, anon, authenticated;

create or replace function public.ban_member(p_user uuid, p_reason text default '')
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_phone text;
begin
  -- The desk: an admin in the app or on the moderation desk, or the project
  -- owner in the SQL editor (is_desk, migration 33).
  if not public.is_desk() then
    return false;
  end if;
  if p_user = auth.uid() then
    return false;   -- banning yourself locks out the only person who can undo it
  end if;
  -- The same two steps as suspend_member(): stop them, and close their open
  -- conversations so nothing they sent keeps a thread alive.
  update profiles
     set suspended_at = coalesce(suspended_at, now()),
         suspended_reason = nullif(left(coalesce(p_reason, ''), 300), '')
   where id = p_user;
  if not found then
    return false;
  end if;
  update matches set closed_at = now()
   where closed_at is null and (user_a = p_user or user_b = p_user);
  select phone into v_phone from auth.users where id = p_user;
  if v_phone is not null and btrim(v_phone) <> '' then
    insert into banned_phones (phone_hash, reason)
    values (public.phone_ban_hash(v_phone), left(coalesce(p_reason, ''), 300))
    on conflict (phone_hash) do nothing;
  end if;
  return true;
end
$$;

-- Lifting a ban is deliberate and separate from lifting a suspension.
create or replace function public.unban_member(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_phone text;
begin
  if not public.is_desk() then
    return false;
  end if;
  select phone into v_phone from auth.users where id = p_user;
  if v_phone is not null then
    delete from banned_phones where phone_hash = public.phone_ban_hash(v_phone);
  end if;
  update profiles set suspended_at = null, suspended_reason = null where id = p_user;
  return found;
end
$$;

create or replace function public.sync_phone_verification()
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_confirmed timestamptz;
  v_phone text;
begin
  select phone_confirmed_at, phone into v_confirmed, v_phone
  from auth.users
  where id = auth.uid();

  if v_confirmed is null then
    return false;
  end if;

  -- A banned number never verifies, and the account that tried is suspended
  -- so it cannot reach anyone while unverified either.
  if v_phone is not null
     and exists (select 1 from banned_phones where phone_hash = public.phone_ban_hash(v_phone)) then
    update profiles
       set suspended_at = coalesce(suspended_at, now()),
           suspended_reason = coalesce(suspended_reason, 'This phone number is banned.')
     where id = auth.uid();
    return false;
  end if;

  update profiles
  set phone_verified_at = coalesce(phone_verified_at, now())
  where id = auth.uid();
  return true;
end
$$;

revoke all on function public.ban_member(uuid, text) from public, anon;
revoke all on function public.unban_member(uuid) from public, anon;
grant execute on function public.ban_member(uuid, text) to authenticated;
grant execute on function public.unban_member(uuid) to authenticated;
grant execute on function public.sync_phone_verification() to authenticated;

-- ---- the ban is enforced where the number becomes known ----
-- (Added after the independent review.) sync_phone_verification() is a call the
-- client chooses to make. These two triggers don't wait for it:
--   (a) an account that attaches a banned, confirmed number is suspended by
--       auth's own write to auth.users;
--   (b) a profile created for an account that already holds one starts
--       suspended. (The name sorts after profiles_guard_member_writes, which
--       clears suspended_at on a member's insert.)
-- Neither ever raises, so neither can block a signup.
create or replace function public.enforce_phone_ban()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if new.phone_confirmed_at is not null
     and new.phone is not null and btrim(new.phone) <> ''
     and exists (select 1 from public.banned_phones where phone_hash = public.phone_ban_hash(new.phone)) then
    update public.profiles
       set suspended_at = coalesce(suspended_at, now()),
           suspended_reason = coalesce(suspended_reason, 'This phone number is banned.')
     where id = new.id;
  end if;
  return new;
end
$$;
revoke all on function public.enforce_phone_ban() from public, anon, authenticated;
create trigger users_enforce_phone_ban
  after insert or update of phone, phone_confirmed_at on auth.users
  for each row execute function public.enforce_phone_ban();

create or replace function public.profiles_phone_ban()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  if exists (select 1 from auth.users u
              where u.id = new.id
                and u.phone_confirmed_at is not null
                and u.phone is not null and btrim(u.phone) <> ''
                and exists (select 1 from public.banned_phones b
                             where b.phone_hash = public.phone_ban_hash(u.phone))) then
    new.suspended_at := coalesce(new.suspended_at, now());
    new.suspended_reason := coalesce(new.suspended_reason, 'This phone number is banned.');
  end if;
  return new;
end
$$;
revoke all on function public.profiles_phone_ban() from public, anon, authenticated;
create trigger profiles_phone_ban
  before insert on public.profiles
  for each row execute function public.profiles_phone_ban();

-- Lifting a ban after the account is gone (unban_member() needs the account,
-- which delete_account() removed). Database owner / service role only: it is
-- deliberately not granted to signed-in members, so an admin session cannot
-- use it to probe whether a number is on the list.
create or replace function public.unban_phone(p_phone text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from banned_phones where phone_hash = public.phone_ban_hash(p_phone);
  return found;
end
$$;
revoke all on function public.unban_phone(text) from public, anon, authenticated;
