-- 40/Love — matching correctness fixes
--
-- 1) Nonbinary members were undiscoverable to anyone who narrowed their
--    Play or Friends preference. Date mode already lets you say you're
--    looking for nonbinary people ("seeking" is a list that includes
--    'nonbinary'), but Play/Friends only offered women/men/everyone, so
--    pref_ok() returned false for a nonbinary player against any narrowed
--    preference and they silently vanished from those decks. Adding the
--    value makes all three modes consistent.
--
-- 2) Empty "looking to date" fails CLOSED. The SQL was always right —
--    `p.gender = any(me.seeking)` matches nobody when seeking is empty —
--    but the clients used to skip the gender filter entirely in that case
--    and show people the member had explicitly ruled out. The client half
--    of that fix ships alongside this migration; the note lives here so
--    both halves stay findable together.

alter type public.partner_pref add value if not exists 'nonbinary';

-- The 'nonbinary' literal is compared as text on purpose: a freshly added
-- enum value cannot be referenced as an enum literal in the same
-- transaction that added it, and `supabase db push` may run this file as
-- one transaction. Casting sidesteps that without a second migration.
create or replace function public.pref_ok(pref public.partner_pref, g public.gender_identity)
returns boolean
language sql immutable
as $$
  select pref = 'everyone'
      or (pref = 'men' and g = 'man')
      or (pref = 'women' and g = 'woman')
      or (pref::text = 'nonbinary' and g::text = 'nonbinary')
$$;
