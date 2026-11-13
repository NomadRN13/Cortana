-- RSVPlay — rate limits
--
-- The deck returns at most 100 cards per call, but nothing limited how many
-- calls, swipes, reports or messages one account could make. A script could
-- swipe the whole city in a minute, flood a conversation, or bury the
-- moderation desk (which promises a 24-hour review) in reports.
--
-- Generous for a person, tight for a script:
--   swipes    500 per rolling 24 hours
--   reports    20 per rolling 24 hours
--   messages   60 per rolling minute
--
-- Enforced by triggers, so every path — the API, a function, a future client —
-- hits the same limit. Only members' own sessions are counted; the seed, the
-- service role and the SQL editor are not.

create or replace function public.rate_limit_swipes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if (select count(*) from swipes
       where actor_id = new.actor_id and created_at > now() - interval '24 hours') >= 500 then
    raise exception 'That''s plenty for one day. The deck will be here tomorrow.' using errcode = '54000';
  end if;
  return new;
end $$;

create or replace function public.rate_limit_reports()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if (select count(*) from reports
       where reporter_id = new.reporter_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'You''ve sent a lot of reports today. If someone is in danger, email hello@rsvplay.app.' using errcode = '54000';
  end if;
  return new;
end $$;

create or replace function public.rate_limit_messages()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if (select count(*) from messages
       where sender_id = new.sender_id and sent_at > now() - interval '1 minute') >= 60 then
    raise exception 'Slow down a moment, then send again.' using errcode = '54000';
  end if;
  return new;
end $$;

revoke all on function public.rate_limit_swipes() from public, anon, authenticated;
revoke all on function public.rate_limit_reports() from public, anon, authenticated;
revoke all on function public.rate_limit_messages() from public, anon, authenticated;

create index if not exists swipes_actor_created_idx on public.swipes (actor_id, created_at);
create index if not exists reports_reporter_created_idx on public.reports (reporter_id, created_at);
create index if not exists messages_sender_sent_idx on public.messages (sender_id, sent_at);

create trigger swipes_rate_limit before insert on public.swipes
  for each row execute function public.rate_limit_swipes();
create trigger reports_rate_limit before insert on public.reports
  for each row execute function public.rate_limit_reports();
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.rate_limit_messages();
