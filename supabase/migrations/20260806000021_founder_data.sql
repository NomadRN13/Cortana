-- 40/LOVE — let the founder see their own numbers
--
-- Two things the product collects but nobody can currently read:
--
--   waitlist      readable by nobody at all since join_waitlist closed the
--                 membership oracle. That was right for strangers and wrong
--                 for the person who has to email these people when a city
--                 opens. Admins get a read; everyone else still gets nothing.
--
--   demo_events   new. The clickable prototype is the top of the funnel and it
--                 currently reports nothing, so there is no way to know whether
--                 people abandon at the phone step, the sports step, or never
--                 start. Counting that is the difference between guessing at
--                 the signup flow and fixing it.
--
-- demo_events deliberately holds no person in it: no account, no IP, no user
-- agent, no cookie, nothing that survives the page. The `visit` column is a
-- random value the page makes up on load and forgets on unload — enough to say
-- "this many people who started finished", which is the entire point of a
-- funnel, and not enough to say who any of them were.

-- ---- 1. the waitlist, for admins only ------------------------------------
create policy waitlist_admin_select on public.waitlist
  for select to authenticated using (public.is_admin());

-- ---- 2. anonymous funnel steps -------------------------------------------
create table public.demo_events (
  id bigint generated always as identity primary key,
  visit uuid not null,
  step text not null,
  at timestamptz not null default now()
);

create index demo_events_at_idx on public.demo_events (at desc);
create index demo_events_visit_idx on public.demo_events (visit);

alter table public.demo_events enable row level security;

-- Writing goes through the RPC below, never straight at the table.
create policy demo_events_admin_select on public.demo_events
  for select to authenticated using (public.is_admin());

-- A fixed vocabulary, so an open endpoint can't be turned into free storage.
create or replace function public.record_demo_step(p_visit uuid, p_step text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_step not in (
    'landed', 'start_signup', 'phone_verified', 'sports_picked',
    'skill_picked', 'finished_signup', 'swiped', 'matched', 'opened_chat'
  ) then
    raise exception 'unknown step' using errcode = '22023';
  end if;
  insert into public.demo_events (visit, step) values (p_visit, p_step);
end
$$;

grant execute on function public.record_demo_step(uuid, text) to anon, authenticated;

-- ---- 3. the funnel, counted server-side -----------------------------------
-- Counting distinct visits rather than events, so a reload doesn't read as
-- another person. Admin-gated because the table is.
create or replace function public.demo_funnel(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(step, visits), '{}'::jsonb) into result
  from (
    select step, count(distinct visit) as visits
    from public.demo_events
    where at >= now() - make_interval(days => greatest(p_days, 1))
    group by step
  ) s;
  return result;
end
$$;

grant execute on function public.demo_funnel(int) to authenticated;
