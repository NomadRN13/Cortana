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
-- Counted in a log of its own (rate_events), stamped by the server:
--   · not on the rows themselves, because a swipe can be undone and swiped
--     again for ever without the table ever growing;
--   · not on the row's timestamp, because a member can send any created_at
--     they like — the triggers now overwrite it with the server's clock too.
-- Reports are counted inside report_member() BEFORE it looks the person up,
-- so being at the limit answers the same whether or not that account still
-- exists (migration 31 made that function say nothing about who exists).
--
-- Only members' own sessions are counted; the seed, the service role and the
-- SQL editor are not.

create table public.rate_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('swipe', 'report', 'message')),
  at timestamptz not null default now()
);
create index rate_events_idx on public.rate_events (user_id, kind, at);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- Records one event for the caller, or raises if they are over the limit.
create or replace function public.rate_limit_take(p_kind text, p_max int, p_window interval, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  -- No session, or an account that hasn't made a profile yet: nothing to count
  -- against (and everything it could do is refused elsewhere).
  if me is null or not exists (select 1 from profiles where id = me) then
    return;
  end if;
  if (select count(*) from rate_events
       where user_id = me and kind = p_kind and at > now() - p_window) >= p_max then
    raise exception '%', p_message using errcode = '54000';
  end if;
  insert into rate_events (user_id, kind) values (me, p_kind);
  -- Keep the log small: nothing older than two days is ever counted.
  delete from rate_events where user_id = me and at < now() - interval '2 days';
end
$$;
revoke all on function public.rate_limit_take(text, int, interval, text) from public, anon, authenticated;

create or replace function public.rate_limit_swipes()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.created_at := now();  -- the server's clock, whatever the client sent
  perform public.rate_limit_take('swipe', 500, interval '24 hours',
    'That''s plenty for one day. The deck will be here tomorrow.');
  return new;
end $$;

create or replace function public.rate_limit_messages()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.sent_at := now();
  perform public.rate_limit_take('message', 60, interval '1 minute',
    'Slow down a moment, then send again.');
  return new;
end $$;

revoke all on function public.rate_limit_swipes() from public, anon, authenticated;
revoke all on function public.rate_limit_messages() from public, anon, authenticated;

create trigger swipes_rate_limit before insert on public.swipes
  for each row execute function public.rate_limit_swipes();
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.rate_limit_messages();

-- Reports: the only way to file one is report_member() (migration 31 revoked
-- direct inserts), so the limit lives there, ahead of the existence check.
create or replace function public.report_member(p_target uuid, p_reason text, p_context text default 'deck')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  -- Checked before looking the person up, so a bad report fails the same way
  -- whoever it is about.
  if p_target is null or p_target = me then
    raise exception 'That isn''t someone you can report.' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Tell us what happened, in 500 characters or fewer.' using errcode = '22023';
  end if;
  if coalesce(p_context, 'deck') not in ('deck', 'chat', 'event') then
    raise exception 'Unknown report context.' using errcode = '22023';
  end if;
  -- Counted whether or not the account exists, for the same reason.
  perform public.rate_limit_take('report', 20, interval '24 hours',
    'You''ve sent a lot of reports today. If someone is in danger, email hello@rsvplay.app.');
  if exists (select 1 from profiles where id = p_target) then
    insert into reports (reporter_id, target_id, reason, context)
    values (me, p_target, btrim(p_reason), coalesce(p_context, 'deck'));
  end if;
end
$$;
revoke all on function public.report_member(uuid, text, text) from public, anon;
grant execute on function public.report_member(uuid, text, text) to authenticated;
