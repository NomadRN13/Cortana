-- 40/LOVE — Apple sign-in tokens, kept only so the account can be revoked
--
-- App Store Guideline 5.1.1(v): an app that offers Sign in with Apple must,
-- when the member deletes their account, also tell Apple to revoke the tokens
-- it issued. Otherwise the member's Apple ID still lists 40/LOVE under
-- "Apps Using Apple ID" for an account that no longer exists.
--
-- Revoking requires a token Apple will accept, and the only chance to get one
-- is at sign-in: the authorization code Apple hands the app is good for about
-- five minutes and can be exchanged, once, for a long-lived refresh token.
-- So it is exchanged immediately (supabase/functions/apple-auth) and the
-- refresh token parked here until the account is deleted.
--
-- This is the most sensitive table in the database: a refresh token is a
-- credential. RLS is on and there are deliberately NO policies, so it is
-- unreadable and unwritable through the API by anyone — members, admins,
-- anon. Only the edge function, holding the service role, can touch it.

create table public.apple_identities (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  linked_at timestamptz not null default now()
);

alter table public.apple_identities enable row level security;

-- No policies. See above — this is intentional, not an oversight.

revoke all on public.apple_identities from anon, authenticated;
