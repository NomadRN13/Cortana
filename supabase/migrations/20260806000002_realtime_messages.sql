-- 40/LOVE — enable realtime delivery for chat
-- postgres_changes subscriptions only fire for tables in the
-- supabase_realtime publication; without this, the app's live chat channel
-- subscribes cleanly but never receives an event (QA finding B-07).
-- Idempotent and safe on local Postgres where the publication may not exist.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end
$$;
