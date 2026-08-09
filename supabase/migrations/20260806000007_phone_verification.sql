-- 40/Love — phone (SMS) verification
-- Sign-in stays email-OTP; onboarding additionally verifies a phone number
-- by text. The number lives in auth.users (attached via Supabase phone-change
-- OTP, so the SMS round-trip is handled by auth itself); profiles carries
-- only the verification timestamp. The RPC below is the ONLY way the flag
-- gets set, and it checks auth's own confirmation — the client cannot fake it.

alter table public.profiles
  add column phone_verified_at timestamptz;

create or replace function public.sync_phone_verification()
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_confirmed timestamptz;
begin
  select phone_confirmed_at into v_confirmed
  from auth.users
  where id = auth.uid();

  if v_confirmed is null then
    return false;
  end if;

  update profiles
  set phone_verified_at = coalesce(phone_verified_at, now())
  where id = auth.uid();
  return true;
end
$$;

grant execute on function public.sync_phone_verification() to authenticated;
