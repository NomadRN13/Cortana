-- 40/LOVE — close the waitlist membership oracle
--
-- The landing page POSTed straight to the waitlist table with the anon key,
-- which is public by design — it ships in the page source. The email column is
-- UNIQUE, so a second POST of the same address came back 409 instead of 201,
-- and the page said so out loud: "You're already on the list."
--
-- That is a membership oracle for a dating app. Anyone holding an email address
-- could ask whether its owner had signed up, and anyone with a list could ask
-- for all of them. Signing up for a dating app is exactly the kind of thing
-- people do not want disclosed to whoever happens to know their address.
--
-- The fix is to make both outcomes indistinguishable: one entry point that
-- swallows the conflict and always reports the same thing. Direct inserts are
-- withdrawn so the RPC is the only way in.

drop policy if exists waitlist_insert on public.waitlist;

-- No insert policy now, so row-level security refuses client writes outright;
-- this runs as the owner and is the only route in.
create or replace function public.join_waitlist(
  p_email text,
  p_city text default '',
  p_source text default 'landing'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  insert into public.waitlist (email, city, source)
  values (v_email, left(btrim(coalesce(p_city, '')), 60), left(btrim(coalesce(p_source, 'landing')), 40))
  on conflict (email) do nothing;
  -- Deliberately no indication of whether that inserted. The caller is told
  -- the same thing either way.
end
$$;

grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;
