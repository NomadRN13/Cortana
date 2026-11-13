-- RSVPlay — a suspended member can't shed the suspension by deleting
--
-- delete_account() removes the auth.users row, and with it the only copy of
-- the phone number. A member suspended by the desk could delete the account,
-- sign up again and verify the same number, because a suspension (unlike
-- ban_member) recorded nothing about the phone.
--
-- Now, when an account that is suspended at the moment of deletion has a
-- phone number, its hash goes on the ban list first. Nothing is kept for a
-- member in good standing: their deletion is as complete as it was.
-- (The privacy policy's account-deletion section says so.)

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
  v_phone text;
begin
  select lower(btrim(email)), phone into v_email, v_phone from auth.users where id = auth.uid();

  if v_phone is not null and btrim(v_phone) <> ''
     and exists (select 1 from public.profiles where id = auth.uid() and suspended_at is not null) then
    insert into public.banned_phones (phone_hash, reason)
    values (public.phone_ban_hash(v_phone), 'Deleted while suspended.')
    on conflict (phone_hash) do nothing;
  end if;

  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects
    where bucket_id = 'photos'
      and name like auth.uid()::text || '/%';
  end if;

  -- join_waitlist() lower-trims before storing, so a plain comparison is
  -- enough; lower() on both sides anyway, in case a row predates that.
  if v_email is not null and v_email <> '' then
    delete from public.waitlist where lower(email) = v_email;
  end if;

  delete from auth.users where id = auth.uid();
end
$$;
