-- 40/LOVE — complete backend in one paste
-- Generated from supabase/migrations/ (regenerate: cat supabase/migrations/*.sql > supabase/setup.sql + this header)
-- Use: Supabase Dashboard → SQL Editor → New query → paste ALL of this → Run.
-- Safe to run once on a fresh project. Do NOT also run 'supabase db push' afterwards — pick one path.
-- (Development seed data is separate and optional: supabase/seed.sql — never on the launch project.)

-- 40/LOVE — initial schema
-- Implements docs/system-architecture.md §3–§7 for Supabase (Postgres 15+).
-- Apply with: supabase db push   (see docs/backend-setup.md)

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.sport as enum ('tennis', 'pickleball', 'padel', 'racquetball', 'squash');
create type public.skill_level as enum ('beginner', 'intermediate', 'advanced', 'competitive');
create type public.app_mode as enum ('date', 'play', 'friends');
create type public.swipe_action as enum ('like', 'pass', 'ace');
create type public.message_kind as enum ('text', 'court_time');
create type public.rsvp_status as enum ('going', 'waitlist', 'checked_in');
create type public.report_status as enum ('open', 'reviewed', 'actioned');
create type public.moderation_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per account. Location is deliberately coarse (~1 km): the client
-- rounds to 2 decimal places before writing; exact coordinates never exist
-- server-side (architecture §9).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 40),
  birthdate date not null check (birthdate <= (current_date - interval '18 years')::date),
  bio text not null default '' check (char_length(bio) <= 500),
  approx_lat numeric(5, 2),
  approx_lng numeric(5, 2),
  city text not null default 'Indianapolis',
  availability_note text not null default '' check (char_length(availability_note) <= 120),
  modes public.app_mode[] not null default '{date}' check (cardinality(modes) >= 1),
  radius_mi int not null default 15 check (radius_mi between 1 and 50),
  age_min int not null default 25 check (age_min between 18 and 99),
  age_max int not null default 55 check (age_max between 18 and 99),
  same_sports_only boolean not null default false,
  verified_at timestamptz,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (age_min <= age_max)
);

create table public.user_sports (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport public.sport not null,
  level public.skill_level not null,
  rating_label text not null default '' check (char_length(rating_label) <= 20),
  primary key (user_id, sport)
);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  position int not null default 0 check (position between 0 and 5),
  moderation_status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (user_id, position)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Append-only swipe log; matches are derived from it (architecture §3).
create table public.swipes (
  actor_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  mode public.app_mode not null,
  action public.swipe_action not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, target_id, mode),
  check (actor_id <> target_id)
);
create index swipes_target_idx on public.swipes (target_id, actor_id);

-- user_a < user_b canonically, so one unique row per pair per mode.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  mode public.app_mode not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (user_a, user_b, mode),
  check (user_a < user_b)
);
create index matches_user_a_idx on public.matches (user_a);
create index matches_user_b_idx on public.matches (user_b);

create table public.messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind public.message_kind not null default 'text',
  body text not null default '' check (char_length(body) <= 2000),
  -- for kind = 'court_time': {venue, day, time, sport, status: proposed|accepted|declined}
  court_payload jsonb,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  check (kind <> 'court_time' or court_payload is not null)
);
create index messages_match_idx on public.messages (match_id, sent_at);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 80),
  venue text not null check (char_length(venue) <= 80),
  starts_at timestamptz not null,
  sport public.sport not null,
  level_range text not null default 'All levels' check (char_length(level_range) <= 40),
  capacity int not null check (capacity between 2 and 500),
  city text not null default 'Indianapolis',
  source text not null default 'admin' check (source in ('admin', 'club')),
  created_at timestamptz not null default now()
);
create index events_starts_idx on public.events (city, starts_at);

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.rsvp_status not null default 'going',
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  context text not null default 'deck' check (context in ('deck', 'chat', 'event')),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);
create index reports_open_idx on public.reports (status, created_at);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('match', 'message', 'court_time', 'event_reminder', 'system')),
  payload jsonb not null default '{}',
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, read_at, sent_at);

-- Fed by the landing page (anonymous inserts allowed, never readable by clients).
create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city text not null default '' check (char_length(city) <= 60),
  source text not null default 'landing' check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.miles_between(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
returns numeric
language sql immutable
as $$
  select case
    when lat1 is null or lat2 is null or lng1 is null or lng2 is null then null
    else 3959 * acos(least(1.0, greatest(-1.0,
      cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * cos(radians(lng2::float8) - radians(lng1::float8))
      + sin(radians(lat1::float8)) * sin(radians(lat2::float8))
    )))::numeric
  end
$$;

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  )
$$;

create or replace function public.age_of(d date)
returns int
language sql stable
as $$ select date_part('year', age(d))::int $$;

create or replace function public.skill_rank(l public.skill_level)
returns int
language sql immutable
as $$
  select case l
    when 'beginner' then 1
    when 'intermediate' then 2
    when 'advanced' then 3
    when 'competitive' then 4
  end
$$;

-- ---------------------------------------------------------------------------
-- Match creation: mutual like (or a single ace) creates the match (§4).
-- ---------------------------------------------------------------------------

create or replace function public.process_swipe()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_match_id uuid;
begin
  if new.action = 'pass' then
    return new;
  end if;

  if new.action = 'ace' or exists (
    select 1 from swipes s
    where s.actor_id = new.target_id
      and s.target_id = new.actor_id
      and s.mode = new.mode
      and s.action in ('like', 'ace')
  ) then
    insert into matches (user_a, user_b, mode)
    values (least(new.actor_id, new.target_id), greatest(new.actor_id, new.target_id), new.mode)
    on conflict (user_a, user_b, mode) do nothing
    returning id into v_match_id;

    if v_match_id is not null then
      insert into notifications (user_id, kind, payload)
      values
        (new.actor_id,  'match', jsonb_build_object('match_id', v_match_id, 'with', new.target_id, 'mode', new.mode)),
        (new.target_id, 'match', jsonb_build_object('match_id', v_match_id, 'with', new.actor_id, 'mode', new.mode));
    end if;
  end if;

  return new;
end
$$;

create trigger swipes_process
after insert on public.swipes
for each row execute function public.process_swipe();

-- Notify the recipient of each message.
create or replace function public.notify_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_recipient uuid;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
  into v_recipient
  from matches m where m.id = new.match_id;

  insert into notifications (user_id, kind, payload)
  values (v_recipient,
          case when new.kind = 'court_time' then 'court_time' else 'message' end,
          jsonb_build_object('match_id', new.match_id, 'from', new.sender_id));
  return new;
end
$$;

create trigger messages_notify
after insert on public.messages
for each row execute function public.notify_message();

-- ---------------------------------------------------------------------------
-- The discovery deck (§4): hard filters + ranked scoring, one call.
-- ---------------------------------------------------------------------------

create or replace function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
returns table (
  user_id uuid,
  first_name text,
  age int,
  distance_mi numeric,
  sports jsonb,
  verified boolean,
  availability_note text,
  bio text,
  is_new boolean,
  score int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as dist,
      exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ) as shared_sport,
      coalesce((
        select max(2 - least(2, abs(skill_rank(mine.level) - skill_rank(theirs.level))))
        from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ), 0) as skill_adj,
      exists (
        select 1 from swipes s
        where s.actor_id = p.id and s.target_id = me.id
          and s.mode = p_mode and s.action = 'ace'
      ) as aced_me
    from profiles p, me
    where p.id <> me.id
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      and (not me.same_sports_only or exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ))
      and p.last_active_at > now() - interval '30 days'
  )
  select
    c.id,
    c.first_name,
    age_of(c.birthdate),
    round(c.dist, 1),
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = c.id),
    c.verified_at is not null,
    c.availability_note,
    c.bio,
    c.created_at > now() - interval '7 days',
    (
      (case when c.aced_me then 10 else 0 end)
      + (case when c.shared_sport then 3 else 0 end)
      + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
      + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
      + (case when c.dist is not null and c.dist <= (select radius_mi from me) / 2.0 then 1 else 0 end)
      + (case when c.verified_at is not null then 1 else 0 end)
    )::int
  from candidates c
  where (c.dist is null or (c.dist <= (select radius_mi from me) and c.dist <= c.radius_mi))
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

-- Accept or decline a court-time proposal (recipient only).
create or replace function public.respond_court_time(p_message_id bigint, p_accept boolean)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_updated int;
begin
  update messages msg
  set court_payload = jsonb_set(coalesce(msg.court_payload, '{}'::jsonb), '{status}',
                                to_jsonb(case when p_accept then 'accepted' else 'declined' end))
  from matches m
  where msg.id = p_message_id
    and msg.kind = 'court_time'
    and m.id = msg.match_id
    and auth.uid() in (m.user_a, m.user_b)
    and msg.sender_id <> auth.uid();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end
$$;

-- In-app account deletion (required by both app stores — architecture §9).
create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  delete from auth.users where id = auth.uid();
end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_sports enable row level security;
alter table public.profile_photos enable row level security;
alter table public.blocks enable row level security;
alter table public.swipes enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.waitlist enable row level security;

-- profiles: signed-in users see anyone not in a block relationship with them
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or not public.is_blocked(auth.uid(), id));
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_sports_select on public.user_sports
  for select to authenticated using (true);
create policy user_sports_write on public.user_sports
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- photos: own photos always; others' only when approved
create policy photos_select on public.profile_photos
  for select to authenticated
  using (user_id = auth.uid() or moderation_status = 'approved');
create policy photos_write on public.profile_photos
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy blocks_select on public.blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

create policy swipes_select on public.swipes
  for select to authenticated using (actor_id = auth.uid());
create policy swipes_insert on public.swipes
  for insert to authenticated
  with check (actor_id = auth.uid() and not public.is_blocked(auth.uid(), target_id));

create policy matches_select on public.matches
  for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy matches_close on public.matches
  for update to authenticated
  using (auth.uid() in (user_a, user_b)) with check (auth.uid() in (user_a, user_b));

create policy messages_select on public.messages
  for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.user_a, m.user_b)));
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.user_a, m.user_b)
        and m.closed_at is null
        and not public.is_blocked(m.user_a, m.user_b)
    )
  );
create policy messages_mark_read on public.messages
  for update to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.user_a, m.user_b)));

-- events are readable by all signed-in users; writes go through the service
-- role (admin dashboard) only — no client insert policy on purpose.
create policy events_select on public.events
  for select to authenticated using (true);

create policy rsvps_select on public.event_rsvps
  for select to authenticated using (true);
create policy rsvps_write on public.event_rsvps
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reports_insert on public.reports
  for insert to authenticated with check (reporter_id = auth.uid());
create policy reports_select on public.reports
  for select to authenticated using (reporter_id = auth.uid());

create policy notifications_select on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- waitlist: the landing page inserts anonymously; nobody reads via the client
create policy waitlist_insert on public.waitlist
  for insert to anon, authenticated with check (true);

-- ---------------------------------------------------------------------------
-- Grants (Supabase defaults cover most; RPCs need explicit execute)
-- ---------------------------------------------------------------------------
grant execute on function public.get_discovery_deck(public.app_mode, int) to authenticated;
grant execute on function public.respond_court_time(bigint, boolean) to authenticated;
grant execute on function public.delete_account() to authenticated;
grant execute on function public.miles_between(numeric, numeric, numeric, numeric) to authenticated;

-- 40/LOVE — push notification tokens
-- One row per device token. The send-push edge function (supabase/functions/
-- send-push) reads these with the service role when a notifications row is
-- inserted; clients can only manage their own tokens.

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null check (char_length(token) between 10 and 200),
  platform text not null default 'unknown' check (platform in ('ios', 'android', 'unknown')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

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

-- 40/LOVE — provision the photos storage bucket + policies
-- QA found nothing in the repo creates the bucket uploadProfilePhoto targets
-- (test-plan gap #1): on a fresh project the upload fails silently. This
-- migration makes `supabase db push` provision it. Guarded so it no-ops on
-- plain Postgres (local test harness has no storage schema).

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return; -- local/dev Postgres without Supabase storage: nothing to do
  end if;

  insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do nothing;

  -- Uploads go to <own user id>/<n>.jpg only.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_insert_own') then
    execute $pol$
      create policy photos_insert_own on storage.objects
        for insert to authenticated
        with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $pol$;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_update_own') then
    execute $pol$
      create policy photos_update_own on storage.objects
        for update to authenticated
        using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
        with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $pol$;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_delete_own') then
    execute $pol$
      create policy photos_delete_own on storage.objects
        for delete to authenticated
        using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
    $pol$;
  end if;

  -- Any signed-in user may read photo objects; the app only *surfaces*
  -- photos whose profile_photos row is approved (moderation gate).
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_read') then
    execute $pol$
      create policy photos_read on storage.objects
        for select to authenticated
        using (bucket_id = 'photos')
    $pol$;
  end if;
end
$outer$;

-- 40/LOVE — gender identity + dating preference matching
-- Adds who-I-am and who-I'm-looking-to-date to profiles, and makes the
-- Date-mode deck a MUTUAL filter: you see only people who fit what you're
-- looking for AND who are looking for someone like you. All pairings are
-- first-class: woman↔man, woman↔woman, man↔man, and nonbinary in any
-- combination. Play and Friends modes are unaffected — those are for
-- everyone regardless of dating preference.

create type public.gender_identity as enum ('woman', 'man', 'nonbinary');

alter table public.profiles
  add column gender public.gender_identity,
  add column seeking public.gender_identity[] not null default '{}';

-- Date-mode deck now requires the mutual gender fit. Profiles that haven't
-- set gender/seeking simply don't appear in (or see) the Date deck until
-- they do — Play/Friends keep working for them.
create or replace function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
returns table (
  user_id uuid,
  first_name text,
  age int,
  distance_mi numeric,
  sports jsonb,
  verified boolean,
  availability_note text,
  bio text,
  is_new boolean,
  score int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as dist,
      exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ) as shared_sport,
      coalesce((
        select max(2 - least(2, abs(skill_rank(mine.level) - skill_rank(theirs.level))))
        from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ), 0) as skill_adj,
      exists (
        select 1 from swipes s
        where s.actor_id = p.id and s.target_id = me.id
          and s.mode = p_mode and s.action = 'ace'
      ) as aced_me
    from profiles p, me
    where p.id <> me.id
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      and (p_mode <> 'date' or (
        me.gender is not null and p.gender is not null
        and p.gender = any (me.seeking)
        and me.gender = any (p.seeking)
      ))
      and (not me.same_sports_only or exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ))
      and p.last_active_at > now() - interval '30 days'
  )
  select
    c.id,
    c.first_name,
    age_of(c.birthdate),
    round(c.dist, 1),
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = c.id),
    c.verified_at is not null,
    c.availability_note,
    c.bio,
    c.created_at > now() - interval '7 days',
    (
      (case when c.aced_me then 10 else 0 end)
      + (case when c.shared_sport then 3 else 0 end)
      + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
      + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
      + (case when c.dist is not null and c.dist <= (select radius_mi from me) / 2.0 then 1 else 0 end)
      + (case when c.verified_at is not null then 1 else 0 end)
    )::int
  from candidates c
  where (c.dist is null or (c.dist <= (select radius_mi from me) and c.dist <= c.radius_mi))
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

-- 40/LOVE — Play-mode game matching + Friends-mode preference
-- Play mode: players say which game types they want (singles, doubles,
-- mixed doubles) and, for singles/doubles, whether they want to play with
-- women, men, or everyone. The deck shows only compatible players: a shared
-- game type, with the gender preference honored MUTUALLY — unless the
-- shared game is mixed doubles, which is open by nature. Friends mode gets
-- the same women/men/everyone preference, also mutual. Defaults are fully
-- open (all games, everyone), so nobody is filtered until they choose to be.

create type public.game_type as enum ('singles', 'doubles', 'mixed_doubles');
create type public.partner_pref as enum ('women', 'men', 'everyone');

alter table public.profiles
  add column play_games public.game_type[] not null default '{singles,doubles,mixed_doubles}',
  add column play_pref public.partner_pref not null default 'everyone',
  add column friends_pref public.partner_pref not null default 'everyone';

create or replace function public.pref_ok(pref public.partner_pref, g public.gender_identity)
returns boolean
language sql immutable
as $$
  select pref = 'everyone'
      or (pref = 'men' and g = 'man')
      or (pref = 'women' and g = 'woman')
$$;

create or replace function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
returns table (
  user_id uuid,
  first_name text,
  age int,
  distance_mi numeric,
  sports jsonb,
  verified boolean,
  availability_note text,
  bio text,
  is_new boolean,
  score int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as dist,
      exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ) as shared_sport,
      coalesce((
        select max(2 - least(2, abs(skill_rank(mine.level) - skill_rank(theirs.level))))
        from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ), 0) as skill_adj,
      exists (
        select 1 from swipes s
        where s.actor_id = p.id and s.target_id = me.id
          and s.mode = p_mode and s.action = 'ace'
      ) as aced_me
    from profiles p, me
    where p.id <> me.id
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      -- Date mode: mutual gender fit
      and (p_mode <> 'date' or (
        me.gender is not null and p.gender is not null
        and p.gender = any (me.seeking)
        and me.gender = any (p.seeking)
      ))
      -- Play mode: a shared game type; singles/doubles honor both players'
      -- play-with preference, mixed doubles is open by nature
      and (p_mode <> 'play' or exists (
        select 1 from unnest(me.play_games) g
        where g = any (p.play_games)
          and (
            g = 'mixed_doubles'
            or (pref_ok(me.play_pref, p.gender) and pref_ok(p.play_pref, me.gender))
          )
      ))
      -- Friends mode: mutual meet preference (defaults to everyone)
      and (p_mode <> 'friends' or (
        pref_ok(me.friends_pref, p.gender) and pref_ok(p.friends_pref, me.gender)
      ))
      and (not me.same_sports_only or exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ))
      and p.last_active_at > now() - interval '30 days'
  )
  select
    c.id,
    c.first_name,
    age_of(c.birthdate),
    round(c.dist, 1),
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = c.id),
    c.verified_at is not null,
    c.availability_note,
    c.bio,
    c.created_at > now() - interval '7 days',
    (
      (case when c.aced_me then 10 else 0 end)
      + (case when c.shared_sport then 3 else 0 end)
      + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
      + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
      + (case when c.dist is not null and c.dist <= (select radius_mi from me) / 2.0 then 1 else 0 end)
      + (case when c.verified_at is not null then 1 else 0 end)
    )::int
  from candidates c
  where (c.dist is null or (c.dist <= (select radius_mi from me) and c.dist <= c.radius_mi))
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

-- 40/LOVE — privacy hardening (release-review findings)
-- 1) delete_account now also purges the user's photo objects from storage,
--    making the privacy policy's hard-delete promise true end to end.
-- 2) Photo reads are gated: you can always read your own objects; anyone
--    else's require an APPROVED profile_photos row (the moderation gate is
--    now enforced at the storage layer, not just in the app).
-- Both guarded so plain Postgres (local test harness) is unaffected.

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects
    where bucket_id = 'photos'
      and name like auth.uid()::text || '/%';
  end if;
  delete from auth.users where id = auth.uid();
end
$$;

do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'photos_read') then
    execute 'drop policy photos_read on storage.objects';
  end if;

  execute $pol$
    create policy photos_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'photos'
        and (
          name like auth.uid()::text || '/%'
          or exists (
            select 1 from public.profile_photos pp
            where pp.storage_path = storage.objects.name
              and pp.moderation_status = 'approved'
          )
        )
      )
  $pol$;
end
$outer$;

-- 40/LOVE — phone (SMS) verification
-- Sign-in stays email-OTP; onboarding additionally verifies a phone number
-- by text. The number lives in auth.users (attached via Supabase phone-change
-- OTP, so the SMS round-trip is handled by auth itself); profiles carries
-- only the verification timestamp. The RPC below is the ONLY way the flag
-- gets set, and it checks auth's own confirmation — the client cannot fake it.

alter table public.profiles
  add column phone_verified_at timestamptz;

create or replace function public.sync_phone_verification()
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_confirmed timestamptz;
begin
  select phone_confirmed_at into v_confirmed
  from auth.users
  where id = auth.uid();

  if v_confirmed is null then
    return false;
  end if;

  update profiles
  set phone_verified_at = coalesce(phone_verified_at, now())
  where id = auth.uid();
  return true;
end
$$;

grant execute on function public.sync_phone_verification() to authenticated;

-- 40/LOVE — admin & moderation
-- A tiny, explicit admin layer so moderation happens on a real page
-- (site /admin) instead of the Supabase dashboard. Admins can:
--   · see every profile photo (any moderation status) and approve/reject it
--   · read every report and mark it reviewed/actioned
--   · read any profile (context while triaging a report)
--   · create, edit, and delete events
-- Membership is deliberately NOT manageable through the API: the admins
-- table has RLS on and no policies, so the only way in is the dashboard
-- SQL editor (see docs/backend-setup.md). is_admin() is security definer
-- and is the single source of truth the policies below consult.

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- no policies on purpose: invisible and immutable via the API

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;
grant execute on function public.is_admin() to authenticated;

-- ---- moderation: photos ----
create policy photos_admin_select on public.profile_photos
  for select to authenticated using (public.is_admin());
create policy photos_admin_update on public.profile_photos
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- moderation: reports ----
create policy reports_admin_select on public.reports
  for select to authenticated using (public.is_admin());
create policy reports_admin_update on public.reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- context: any profile, even ones RLS would otherwise hide ----
create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.is_admin());

-- ---- events: the founder curates the calendar from the page ----
create policy events_admin_insert on public.events
  for insert to authenticated with check (public.is_admin());
create policy events_admin_update on public.events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy events_admin_delete on public.events
  for delete to authenticated using (public.is_admin());

-- ---- storage: admins can view pending photo files to review them ----
-- (Guarded so plain Postgres — the local test harness — is unaffected.)
do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    return;
  end if;
  execute $pol$
    create policy photos_admin_read on storage.objects
      for select to authenticated
      using (bucket_id = 'photos' and public.is_admin())
  $pol$;
end
$outer$;

-- 40/LOVE — multi-photo management + moderation hardening
-- Members manage up to 6 photos (positions 0–5; 0 is the main photo).
--
-- 1) SECURITY FIX: photos_write let a member write any moderation_status —
--    including approving their own photo, bypassing the moderation queue.
--    A trigger now forces every member-written photo to 'pending'; only
--    admins (migration 8) can set 'approved'/'rejected'. Replacing the
--    image file re-enters the queue automatically.
--
-- 2) Reordering: the (user_id, position) unique constraint becomes
--    deferrable so positions can be swapped/compacted atomically, and two
--    member RPCs do the only two moves the app needs:
--      make_photo_primary(p) — swap position p with 0
--      delete_photo(p)       — remove the row + its storage object, then
--                              shift higher positions down (no gaps)

alter table public.profile_photos
  drop constraint profile_photos_user_id_position_key;
alter table public.profile_photos
  add constraint profile_photos_user_id_position_key
  unique (user_id, position) deferrable initially immediate;

create or replace function public.enforce_photo_moderation()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_status := 'pending';
  else
    -- members may re-submit (→ pending), never approve/reject themselves
    if new.moderation_status is distinct from old.moderation_status
       and new.moderation_status <> 'pending' then
      raise exception 'photo moderation status can only be changed by an admin';
    end if;
    -- a replaced image always re-enters the moderation queue
    if new.storage_path is distinct from old.storage_path then
      new.moderation_status := 'pending';
    end if;
  end if;
  return new;
end
$$;

create trigger photo_moderation_guard
  before insert or update on public.profile_photos
  for each row execute function public.enforce_photo_moderation();

create or replace function public.make_photo_primary(p_position int)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_position is null or p_position < 1 or p_position > 5 then
    return;
  end if;
  set constraints profile_photos_user_id_position_key deferred;
  update profile_photos
  set position = case position when 0 then p_position else 0 end
  where user_id = auth.uid() and position in (0, p_position);
end
$$;

create or replace function public.delete_photo(p_position int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_path text;
begin
  set constraints profile_photos_user_id_position_key deferred;
  delete from profile_photos
  where user_id = auth.uid() and position = p_position
  returning storage_path into v_path;
  if v_path is null then
    return;
  end if;
  update profile_photos
  set position = position - 1
  where user_id = auth.uid() and position > p_position;
  -- also remove the binary (guarded: local test Postgres has no storage)
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects where bucket_id = 'photos' and name = v_path;
  end if;
end
$$;

grant execute on function public.make_photo_primary(int) to authenticated;
grant execute on function public.delete_photo(int) to authenticated;

-- 40/LOVE — rewind (undo last swipe)
-- Takes back the caller's swipe on one person in one mode so the card can
-- return to their deck. If the swipe had just created a match, the match
-- dissolves (the other side's like still stands, so re-liking re-matches
-- instantly) and its two match notifications are cleaned up. A match with
-- messages is a conversation — those are never deleted: returns false and
-- nothing changes.

create or replace function public.undo_swipe(p_target uuid, p_mode public.app_mode)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_match uuid;
begin
  if p_target is null or auth.uid() is null or p_target = auth.uid() then
    return false;
  end if;

  select id into v_match
  from matches
  where mode = p_mode
    and closed_at is null
    and user_a = least(auth.uid(), p_target)
    and user_b = greatest(auth.uid(), p_target);

  if v_match is not null then
    if exists (select 1 from messages where match_id = v_match) then
      return false;
    end if;
    delete from notifications
    where kind = 'match' and payload->>'match_id' = v_match::text;
    delete from matches where id = v_match;
  end if;

  delete from swipes
  where actor_id = auth.uid() and target_id = p_target and mode = p_mode;
  return true;
end
$$;

grant execute on function public.undo_swipe(uuid, public.app_mode) to authenticated;

-- 40/LOVE — chat polish: read receipts + live match/message signal
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

-- 40/LOVE — matching correctness fixes
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

-- 40/LOVE — doubles team profiles (two people, one profile)
--
-- A pair who always play together can share a single profile: both names on
-- the card, one inbox, one set of preferences. Deliberate limits:
--
--  * TWO people, no more. `partner_*` columns rather than a join table —
--    the cap is the point, and a table would invite three.
--  * Teams are for PLAY and FRIENDS, never DATE. A shared profile in a
--    dating context is confusing at best and a safety problem at worst
--    (you cannot verify who you're actually talking to). Enforced by a
--    check constraint, not just hidden in the UI.
--  * Both people must be 18+, same as any member.
--  * The partner is described, not enrolled — they don't get their own
--    login. The account holder is accountable for the profile, which keeps
--    reports, blocks, and bans meaningful.
--
-- Matching: a preference applies to EVERY person on a team. "I want to play
-- doubles with women" plus a team of a man and a woman is not a fit — you'd
-- be playing with a man too. Both directions, both members.

alter table public.profiles
  add column is_team boolean not null default false,
  add column partner_name text not null default '' check (char_length(partner_name) <= 40),
  add column partner_birthdate date,
  add column partner_gender public.gender_identity;

alter table public.profiles
  -- a team needs a second person, and that person needs to be an adult
  add constraint profiles_team_complete check (
    not is_team or (
      char_length(trim(partner_name)) > 0
      and partner_birthdate is not null
      and partner_birthdate <= (current_date - interval '18 years')::date
    )
  ),
  -- teams never appear in Date mode
  add constraint profiles_team_not_dating check (
    not is_team or not ('date' = any (modes))
  );

-- Does `pref` accept everyone on this profile? For a solo profile that's
-- just their gender; for a team it must hold for both people.
create or replace function public.team_pref_ok(
  pref public.partner_pref,
  p_gender public.gender_identity,
  p_is_team boolean,
  p_partner_gender public.gender_identity
)
returns boolean
language sql immutable
as $$
  select pref_ok(pref, p_gender)
     and (not coalesce(p_is_team, false) or pref_ok(pref, p_partner_gender))
$$;

grant execute on function public.team_pref_ok(public.partner_pref, public.gender_identity, boolean, public.gender_identity) to authenticated;

-- Rebuild the deck so Play/Friends honor every member of a team, and so the
-- card has what it needs to show both names. The signature is unchanged but
-- the OUT columns grow, which `create or replace` cannot do — drop first.
drop function if exists public.get_discovery_deck(public.app_mode, int);

create or replace function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
returns table (
  user_id uuid,
  first_name text,
  age int,
  distance_mi numeric,
  sports jsonb,
  verified boolean,
  availability_note text,
  bio text,
  is_new boolean,
  score int,
  is_team boolean,
  partner_name text,
  partner_age int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as dist,
      exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ) as shared_sport,
      coalesce((
        select max(2 - least(2, abs(skill_rank(mine.level) - skill_rank(theirs.level))))
        from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ), 0) as skill_adj,
      exists (
        select 1 from swipes s
        where s.actor_id = p.id and s.target_id = me.id
          and s.mode = p_mode and s.action = 'ace'
      ) as aced_me
    from profiles p, me
    where p.id <> me.id
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      -- Date mode: mutual gender fit. (Teams can't be in Date mode at all —
      -- the check constraint keeps them out — so no team logic is needed here.)
      and (p_mode <> 'date' or (
        me.gender is not null and p.gender is not null
        and p.gender = any (me.seeking)
        and me.gender = any (p.seeking)
      ))
      -- Play mode: a shared game type; singles/doubles honor both sides'
      -- play-with preference across every member; mixed doubles is open.
      and (p_mode <> 'play' or exists (
        select 1 from unnest(me.play_games) g
        where g = any (p.play_games)
          and (
            g = 'mixed_doubles'
            or (
              team_pref_ok(me.play_pref, p.gender, p.is_team, p.partner_gender)
              and team_pref_ok(p.play_pref, me.gender, me.is_team, me.partner_gender)
            )
          )
      ))
      -- Friends mode: mutual meet preference, across every member
      and (p_mode <> 'friends' or (
        team_pref_ok(me.friends_pref, p.gender, p.is_team, p.partner_gender)
        and team_pref_ok(p.friends_pref, me.gender, me.is_team, me.partner_gender)
      ))
      and (not me.same_sports_only or exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ))
      and p.last_active_at > now() - interval '30 days'
  )
  select
    c.id,
    c.first_name,
    age_of(c.birthdate),
    round(c.dist, 1),
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = c.id),
    c.verified_at is not null,
    c.availability_note,
    c.bio,
    c.created_at > now() - interval '7 days',
    (
      (case when c.aced_me then 10 else 0 end)
      + (case when c.shared_sport then 3 else 0 end)
      + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
      + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
      + (case when c.dist is not null and c.dist <= (select radius_mi from me) / 2.0 then 1 else 0 end)
      + (case when c.verified_at is not null then 1 else 0 end)
    )::int,
    c.is_team,
    c.partner_name,
    case when c.is_team then age_of(c.partner_birthdate) else null end
  from candidates c
  where c.dist is null or c.dist <= (select radius_mi from me)
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

-- 40/LOVE — multi-city launch
--
-- "Indianapolis" was a hardcoded default in four places. This replaces it
-- with a real registry so opening a new city is a row, not a code change.
--
-- profiles.city and events.city now hold a city SLUG with a foreign key, so
-- a typo can't silently create a ghost city that nobody can be matched in.
--
-- Matching is scoped to the member's city. Distance alone very nearly does
-- this already (the nearest pair here, LA and San Diego, are ~120 miles
-- apart and the radius maxes out at 50) — but a member who denies location
-- has a NULL distance, and the deck deliberately keeps those people
-- visible. Without a city scope, that member would be shown players from
-- every city in the country.

create table public.cities (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  state text not null check (char_length(state) = 2),
  lat numeric(6, 3) not null,
  lng numeric(6, 3) not null,
  -- how far out the metro reasonably extends; used to place a new member
  metro_radius_mi int not null default 40 check (metro_radius_mi between 5 and 120),
  -- a city can exist in the registry before it opens to signups
  launched boolean not null default false,
  sort_order int not null default 100
);

insert into public.cities (slug, name, state, lat, lng, metro_radius_mi, launched, sort_order) values
  ('indianapolis', 'Indianapolis', 'IN', 39.768, -86.158, 40, true, 10),
  ('los-angeles',  'Los Angeles',  'CA', 34.052, -118.244, 60, true, 20),
  ('san-diego',    'San Diego',    'CA', 32.716, -117.161, 40, true, 30),
  ('phoenix',      'Phoenix',      'AZ', 33.448, -112.074, 50, true, 40),
  ('seattle',      'Seattle',      'WA', 47.606, -122.332, 40, true, 50),
  ('spokane',      'Spokane',      'WA', 47.659, -117.426, 35, true, 60),
  ('dallas',       'Dallas',       'TX', 32.777, -96.797, 50, true, 70),
  ('houston',      'Houston',      'TX', 29.760, -95.370, 50, true, 80),
  ('orlando',      'Orlando',      'FL', 28.538, -81.379, 40, true, 90),
  ('miami',        'Miami',        'FL', 25.762, -80.192, 45, true, 100),
  ('washington-dc','Washington',   'DC', 38.907, -77.037, 40, true, 110);

alter table public.cities enable row level security;
-- Everyone (including a signed-out landing page) may read the city list;
-- nobody may write it from a client. New cities are added by migration.
create policy cities_read on public.cities for select to anon, authenticated using (true);

-- ---- point the existing columns at the registry ----
update public.profiles set city = 'indianapolis' where city = 'Indianapolis';
update public.events   set city = 'indianapolis' where city = 'Indianapolis';

alter table public.profiles
  alter column city set default 'indianapolis',
  add constraint profiles_city_fkey foreign key (city) references public.cities (slug);

alter table public.events
  alter column city set default 'indianapolis',
  add constraint events_city_fkey foreign key (city) references public.cities (slug);

create index events_city_starts_idx on public.events (city, starts_at);

-- Where should a new member be placed? Nearest launched city whose metro
-- reaches them. Null when they're not near any of them yet — the app then
-- asks rather than guessing, and offers the waitlist.
create or replace function public.nearest_city(p_lat numeric, p_lng numeric)
returns text
language sql stable
as $$
  select c.slug
  from cities c
  where c.launched
    and p_lat is not null and p_lng is not null
    and miles_between(p_lat, p_lng, c.lat, c.lng) <= c.metro_radius_mi
  order by miles_between(p_lat, p_lng, c.lat, c.lng)
  limit 1
$$;

grant execute on function public.nearest_city(numeric, numeric) to anon, authenticated;

-- ---- scope discovery to the member's city ----
drop function if exists public.get_discovery_deck(public.app_mode, int);

create or replace function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
returns table (
  user_id uuid,
  first_name text,
  age int,
  distance_mi numeric,
  sports jsonb,
  verified boolean,
  availability_note text,
  bio text,
  is_new boolean,
  score int,
  is_team boolean,
  partner_name text,
  partner_age int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as dist,
      exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ) as shared_sport,
      coalesce((
        select max(2 - least(2, abs(skill_rank(mine.level) - skill_rank(theirs.level))))
        from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ), 0) as skill_adj,
      exists (
        select 1 from swipes s
        where s.actor_id = p.id and s.target_id = me.id
          and s.mode = p_mode and s.action = 'ace'
      ) as aced_me
    from profiles p, me
    where p.id <> me.id
      -- city-first launch: you meet players in your own city
      and p.city = me.city
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      and not exists (
        select 1 from swipes s
        where s.actor_id = me.id and s.target_id = p.id and s.mode = p_mode
      )
      and age_of(p.birthdate) between me.age_min and me.age_max
      and age_of(me.birthdate) between p.age_min and p.age_max
      and (p_mode <> 'date' or (
        me.gender is not null and p.gender is not null
        and p.gender = any (me.seeking)
        and me.gender = any (p.seeking)
      ))
      and (p_mode <> 'play' or exists (
        select 1 from unnest(me.play_games) g
        where g = any (p.play_games)
          and (
            g = 'mixed_doubles'
            or (
              team_pref_ok(me.play_pref, p.gender, p.is_team, p.partner_gender)
              and team_pref_ok(p.play_pref, me.gender, me.is_team, me.partner_gender)
            )
          )
      ))
      and (p_mode <> 'friends' or (
        team_pref_ok(me.friends_pref, p.gender, p.is_team, p.partner_gender)
        and team_pref_ok(p.friends_pref, me.gender, me.is_team, me.partner_gender)
      ))
      and (not me.same_sports_only or exists (
        select 1 from user_sports mine
        join user_sports theirs on theirs.sport = mine.sport
        where mine.user_id = me.id and theirs.user_id = p.id
      ))
      and p.last_active_at > now() - interval '30 days'
  )
  select
    c.id,
    c.first_name,
    age_of(c.birthdate),
    round(c.dist, 1),
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = c.id),
    c.verified_at is not null,
    c.availability_note,
    c.bio,
    c.created_at > now() - interval '7 days',
    (
      (case when c.aced_me then 10 else 0 end)
      + (case when c.shared_sport then 3 else 0 end)
      + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
      + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
      + (case when c.dist is not null and c.dist <= (select radius_mi from me) / 2.0 then 1 else 0 end)
      + (case when c.verified_at is not null then 1 else 0 end)
    )::int,
    c.is_team,
    c.partner_name,
    case when c.is_team then age_of(c.partner_birthdate) else null end
  from candidates c
  where c.dist is null or c.dist <= (select radius_mi from me)
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

-- 40/LOVE — remembered devices
--
-- Two things members expect and a dating app needs:
--
--  1. Signing in on a phone should stick. That already works locally, but a
--     device that still holds a valid session and has lost its local cache
--     had no way back to its profile — the app is now able to rebuild it
--     from the server (client-side change; nothing needed here).
--
--  2. The account should know which devices it's used on, and be able to
--     kick one off. For a dating app that matters: phones get lost, and
--     relationships end with someone else knowing your passcode.
--
-- user_id references auth.users, NOT profiles, because a device signs in
-- before onboarding creates the profile row. (push_tokens references
-- profiles and consequently could not be written until onboarding finished.)
--
-- Revocation is real, not cosmetic: revoked_at is set rather than the row
-- deleted, touch_device() returns false for a revoked device, and the app
-- signs itself out when it sees that. A Supabase session is a JWT, so a
-- revoked device stays usable until it next reaches the server — this is
-- the honest limit, and the UI says so.

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- stable per install, generated on the device; never a hardware id
  device_key text not null check (char_length(device_key) between 8 and 64),
  name text not null default '' check (char_length(name) <= 60),
  platform text not null default 'unknown' check (platform in ('ios', 'android', 'web', 'unknown')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, device_key)
);
create index devices_user_idx on public.devices (user_id, last_seen_at desc);

alter table public.devices enable row level security;

-- You can see and manage your own devices, and nobody else's.
create policy devices_own on public.devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Called on every launch. Records the device, refreshes last-seen, and
-- reports whether this device is still allowed to be signed in.
create or replace function public.touch_device(
  p_key text,
  p_name text default '',
  p_platform text default 'unknown'
)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_revoked timestamptz;
begin
  if auth.uid() is null or p_key is null or char_length(p_key) < 8 then
    return false;
  end if;

  select revoked_at into v_revoked
  from devices
  where user_id = auth.uid() and device_key = p_key;

  -- Already kicked off: say so and change nothing, so a revoked device
  -- can't quietly re-register itself by calling this again.
  if v_revoked is not null then
    return false;
  end if;

  insert into devices (user_id, device_key, name, platform)
  values (auth.uid(), p_key, coalesce(left(p_name, 60), ''), coalesce(p_platform, 'unknown'))
  on conflict (user_id, device_key) do update
    -- clock_timestamp(), not now(): now() is fixed for the whole
    -- transaction, so two launches inside one would record the same instant.
    set last_seen_at = clock_timestamp(),
        name = case when excluded.name <> '' then excluded.name else devices.name end,
        platform = case when excluded.platform <> 'unknown' then excluded.platform else devices.platform end;
  return true;
end
$$;

-- Push tokens are per device, so link them. Without this a revoked phone
-- keeps receiving notifications, because there is no way to tell which
-- token belonged to it.
alter table public.push_tokens add column device_key text;

-- Sign a device out. Its push tokens go with it, so it stops receiving
-- notifications immediately — before it next reaches the server.
create or replace function public.revoke_device(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_key text;
begin
  select device_key into v_key
  from devices
  where id = p_id and user_id = auth.uid() and revoked_at is null;

  if v_key is null then
    return false;   -- not yours, or already revoked
  end if;

  update devices set revoked_at = now() where id = p_id and user_id = auth.uid();
  delete from push_tokens where user_id = auth.uid() and device_key = v_key;
  return true;
end
$$;

grant execute on function public.touch_device(text, text, text) to authenticated;
grant execute on function public.revoke_device(uuid) to authenticated;

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

