-- 40/Love — remembered devices
--
-- Two things members expect and a dating app needs:
--
--  1. Signing in on a phone should stick. That already works locally, but a
--     device that still holds a valid session and has lost its local cache
--     had no way back to its profile — the app is now able to rebuild it
--     from the server (client-side change; nothing needed here).
--
--  2. The account should know which devices it's used on, and be able to
--     kick one off. For a dating app that matters: phones get lost, and
--     relationships end with someone else knowing your passcode.
--
-- user_id references auth.users, NOT profiles, because a device signs in
-- before onboarding creates the profile row. (push_tokens references
-- profiles and consequently could not be written until onboarding finished.)
--
-- Revocation is real, not cosmetic: revoked_at is set rather than the row
-- deleted, touch_device() returns false for a revoked device, and the app
-- signs itself out when it sees that. A Supabase session is a JWT, so a
-- revoked device stays usable until it next reaches the server — this is
-- the honest limit, and the UI says so.

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- stable per install, generated on the device; never a hardware id
  device_key text not null check (char_length(device_key) between 8 and 64),
  name text not null default '' check (char_length(name) <= 60),
  platform text not null default 'unknown' check (platform in ('ios', 'android', 'web', 'unknown')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, device_key)
);
create index devices_user_idx on public.devices (user_id, last_seen_at desc);

alter table public.devices enable row level security;

-- You can see and manage your own devices, and nobody else's.
create policy devices_own on public.devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Called on every launch. Records the device, refreshes last-seen, and
-- reports whether this device is still allowed to be signed in.
create or replace function public.touch_device(
  p_key text,
  p_name text default '',
  p_platform text default 'unknown'
)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_revoked timestamptz;
begin
  if auth.uid() is null or p_key is null or char_length(p_key) < 8 then
    return false;
  end if;

  select revoked_at into v_revoked
  from devices
  where user_id = auth.uid() and device_key = p_key;

  -- Already kicked off: say so and change nothing, so a revoked device
  -- can't quietly re-register itself by calling this again.
  if v_revoked is not null then
    return false;
  end if;

  insert into devices (user_id, device_key, name, platform)
  values (auth.uid(), p_key, coalesce(left(p_name, 60), ''), coalesce(p_platform, 'unknown'))
  on conflict (user_id, device_key) do update
    -- clock_timestamp(), not now(): now() is fixed for the whole
    -- transaction, so two launches inside one would record the same instant.
    set last_seen_at = clock_timestamp(),
        name = case when excluded.name <> '' then excluded.name else devices.name end,
        platform = case when excluded.platform <> 'unknown' then excluded.platform else devices.platform end;
  return true;
end
$$;

-- Push tokens are per device, so link them. Without this a revoked phone
-- keeps receiving notifications, because there is no way to tell which
-- token belonged to it.
alter table public.push_tokens add column device_key text;

-- Sign a device out. Its push tokens go with it, so it stops receiving
-- notifications immediately — before it next reaches the server.
create or replace function public.revoke_device(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_key text;
begin
  select device_key into v_key
  from devices
  where id = p_id and user_id = auth.uid() and revoked_at is null;

  if v_key is null then
    return false;   -- not yours, or already revoked
  end if;

  update devices set revoked_at = now() where id = p_id and user_id = auth.uid();
  delete from push_tokens where user_id = auth.uid() and device_key = v_key;
  return true;
end
$$;

grant execute on function public.touch_device(text, text, text) to authenticated;
grant execute on function public.revoke_device(uuid) to authenticated;
