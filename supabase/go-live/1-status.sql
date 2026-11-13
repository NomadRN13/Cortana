-- RSVPlay go-live, step 1a: WHERE IS THE LIVE DATABASE?  (read-only)
--
-- Paste into Supabase → SQL Editor → Run. It changes nothing. It answers, for
-- each migration the launch needs, "is it already in?".
--
--   · Every row false (or "base schema" false): a fresh project. Paste the
--     whole of supabase/setup.sql instead of 2-upgrade-from-32.sql.
--   · base and 30–32 true, 33 onward false: paste 2-upgrade-from-32.sql.
--   · A mix: paste only the missing migrations, from supabase/migrations/,
--     in order — or send this result to Claude and ask what to run.
select step, applied from (values
  (1,  'base schema (profiles)',               to_regclass('public.profiles') is not null),
  (2,  '30–32 privacy follow-ups',             exists (select 1 from pg_proc where proname = 'withdraw_suspended_entries')),
  (3,  '33 waiver, check-in, crew',            to_regclass('public.waiver_acceptances') is not null),
  (4,  '34 phone bans',                        to_regclass('public.banned_phones') is not null),
  (5,  '35 rate limits',                       to_regclass('public.rate_events') is not null),
  (6,  '36 quiet hours',                       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'timezone')),
  (7,  '37 ladder leagues',                    to_regclass('public.leagues') is not null),
  (8,  '38 membership tiers',                  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'tier')),
  (9,  '39 verified phone required',           exists (select 1 from pg_proc where proname = 'require_verified_phone')),
  (10, '40 deletion clears the waitlist',      exists (select 1 from pg_proc where proname = 'delete_account' and prosrc like '%waitlist%')),
  (11, '41 a ban survives deletion',           exists (select 1 from pg_proc where proname = 'delete_account' and prosrc like '%Deleted while suspended%')),
  (12, '42 support address rsvplayapp.com',     exists (select 1 from pg_proc where proname = 'report_member' and prosrc like '%hello@rsvplayapp.com%'))
) as t(n, step, applied)
order by n;
