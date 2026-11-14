-- RSVPlay — strangers and members cannot empty a table
--
-- Supabase gives the two API roles (anon, authenticated) every privilege on a
-- new table and relies on row-level security to narrow them. Row-level
-- security does not apply to TRUNCATE. The Data API offers no way to send a
-- TRUNCATE today, so this is not a hole that can be reached — it is a lock on
-- a door that happens to be bricked up. Taking the privilege away means it
-- stays shut even if a later function runs as its caller, and it lets the
-- test harness assert the plain statement: neither API role can empty a
-- table. REFERENCES and TRIGGER go too; neither role has any use for them.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- And for every table created from here on.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
