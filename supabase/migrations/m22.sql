-- 40/LOVE — deleting an account also takes the address off the waitlist
--
-- delete_account() works by deleting the auth.users row and letting foreign
-- keys cascade. That reaches every table keyed on the member's id, which is
-- almost everything — but the waitlist is keyed on an email address and has no
-- user_id at all, so it was never touched.
--
-- The account-deletion page, which Google Play requires and reads, says of
-- "Email & phone": "Deleted." Someone who joined the waitlist first and made an
-- account later would delete that account and still be on a marketing list
-- under the address they asked us to forget. That is the complaint people
-- actually make, and the page promised otherwise.
--
-- Matching on the address is the only link available. It runs before the
-- auth.users delete, because after it there is no email left to match on.

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
begin
  select lower(btrim(email)) into v_email from auth.users where id = auth.uid();

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
