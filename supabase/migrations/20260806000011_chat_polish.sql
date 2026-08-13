-- 40/Love — chat polish: read receipts + live match/message signal
--
-- 1) Read receipts (QA B-14). Marking messages read becomes a scoped RPC.
--    This also FIXES A SECURITY HOLE: the old messages_mark_read policy
--    allowed match members to UPDATE any column of any message in the
--    match — including rewriting the other person's message text. The
--    policy is dropped; the only client-reachable mutation left is the
--    RPC below, which touches nothing but read_at on the other side's
--    messages. (Court-time responses already go through the
--    respond_court_time RPC, which is security definer and unaffected.)
--
-- 2) Live "It's a Match Point!" for the first liker (QA B-21). The match
--    trigger already writes a notifications row for both players — adding
--    the table to the realtime publication lets the app subscribe and
--    celebrate the match the moment the second like lands, and refresh
--    chat threads when messages arrive outside an open conversation.
--    Realtime respects RLS, so each member only ever receives their own
--    notification rows.

drop policy messages_mark_read on public.messages;

create or replace function public.mark_messages_read(p_match uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from matches m
    where m.id = p_match and auth.uid() in (m.user_a, m.user_b)
  ) then
    return;
  end if;
  update messages
  set read_at = now()
  where match_id = p_match
    and sender_id <> auth.uid()
    and read_at is null;
end
$$;

grant execute on function public.mark_messages_read(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
