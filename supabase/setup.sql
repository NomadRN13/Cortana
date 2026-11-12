-- 40/LOVE — complete backend in one paste
-- Generated from supabase/migrations/ by scripts/build-setup-sql.sh — don't edit by hand.
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

-- 40/LOVE — close the waitlist membership oracle
--
-- The landing page POSTed straight to the waitlist table with the anon key,
-- which is public by design — it ships in the page source. The email column is
-- UNIQUE, so a second POST of the same address came back 409 instead of 201,
-- and the page said so out loud: "You're already on the list."
--
-- That is a membership oracle for a dating app. Anyone holding an email address
-- could ask whether its owner had signed up, and anyone with a list could ask
-- for all of them. Signing up for a dating app is exactly the kind of thing
-- people do not want disclosed to whoever happens to know their address.
--
-- The fix is to make both outcomes indistinguishable: one entry point that
-- swallows the conflict and always reports the same thing. Direct inserts are
-- withdrawn so the RPC is the only way in.

drop policy if exists waitlist_insert on public.waitlist;

-- No insert policy now, so row-level security refuses client writes outright;
-- this runs as the owner and is the only route in.
create or replace function public.join_waitlist(
  p_email text,
  p_city text default '',
  p_source text default 'landing'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  insert into public.waitlist (email, city, source)
  values (v_email, left(btrim(coalesce(p_city, '')), 60), left(btrim(coalesce(p_source, 'landing')), 40))
  on conflict (email) do nothing;
  -- Deliberately no indication of whether that inserted. The caller is told
  -- the same thing either way.
end
$$;

grant execute on function public.join_waitlist(text, text, text) to anon, authenticated;

-- 40/LOVE — stop handing every member everyone else's birthdate and coordinates
--
-- profiles_select lets any signed-in member read any profile row that hasn't
-- blocked them. Row-level security is row-level: it says WHICH rows, never
-- WHICH COLUMNS. So a member could ask PostgREST for
--
--     /rest/v1/profiles?select=first_name,birthdate,approx_lat,approx_lng
--
-- and get the exact date of birth and home location of every member of the app.
--
-- Both are things the product goes out of its way to protect everywhere else:
-- the privacy policy says "your birthdate is never shown to other members —
-- only your age", and get_discovery_deck deliberately returns a distance rather
-- than coordinates. The table was quietly undoing both. For a dating app, a
-- ~1km home location for every member, available to anyone who signs up, is a
-- stalking vector rather than a privacy nitpick.
--
-- Column privileges are the fix. Note that a column-level REVOKE is a no-op
-- while the role still holds table-level SELECT — Postgres checks the table
-- grant first and stops there. The table grant has to go, and the readable
-- columns be granted back by name.

revoke select on public.profiles from anon, authenticated;

-- Everything except birthdate, partner_birthdate, approx_lat and approx_lng.
-- Adding a column to profiles means adding it here too, or the app cannot read
-- it; supabase/tests/backend.sql §9g fails on any column that is in neither
-- list, so this cannot drift silently in either direction.
grant select (
  id, first_name, bio, city, availability_note, modes, radius_mi,
  age_min, age_max, same_sports_only, verified_at, last_active_at, created_at,
  gender, seeking, play_games, play_pref, friends_pref, phone_verified_at,
  is_team, partner_name, partner_gender
) on public.profiles to authenticated;

-- Writing is unaffected: INSERT and UPDATE privileges are separate from SELECT,
-- so members still set their own birthdate and rounded position at signup.

-- Your own profile, whole. Runs as owner, so the revoke above doesn't apply;
-- the where clause is what keeps it to you, and it is the only thing that does.
create or replace function public.get_my_profile()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object(
    'user_sports',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'sport', s.sport, 'level', s.level, 'rating_label', s.rating_label))
      from public.user_sports s where s.user_id = p.id
    ), '[]'::jsonb))
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Other people, as much as a match card needs and no more. Ages, not
-- birthdates; no coordinates at all — distance comes from the deck, which
-- computes it without ever handing over a position.
create or replace function public.get_profile_cards(p_ids uuid[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(card)), '[]'::jsonb)
  from (
    select
      p.id,
      p.first_name,
      extract(year from age(p.birthdate))::int as age,
      p.bio,
      p.city,
      p.availability_note,
      p.verified_at,
      p.last_active_at,
      p.gender,
      p.is_team,
      p.partner_name,
      case when p.partner_birthdate is null then null
           else extract(year from age(p.partner_birthdate))::int end as partner_age,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sport', s.sport, 'level', s.level, 'rating_label', s.rating_label))
        from public.user_sports s where s.user_id = p.id
      ), '[]'::jsonb) as user_sports
    from public.profiles p
    where p.id = any(p_ids)
      -- Security definer bypasses RLS, so the block filter that profiles_select
      -- would have applied has to be repeated here by hand.
      and not public.is_blocked(auth.uid(), p.id)
  ) card;
$$;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_profile_cards(uuid[]) to authenticated;

-- 40/LOVE — make blocking mean what the docs say it means
--
-- "Blocking makes two people invisible to each other everywhere, enforced at
-- the database layer" (docs/backend-setup.md). Two tables were not doing that:
--
--   event_rsvps  read policy was `using (true)`. Anyone could ask
--                /rest/v1/event_rsvps?select=user_id&event_id=eq.<id>
--                and get the guest list — so someone you had blocked could
--                learn that you would be at a named venue at a named time.
--                Of everything blocking is supposed to protect, where someone
--                will physically be on Saturday is the part that matters most.
--
--   user_sports  same `using (true)`. Less serious on its own, but it left a
--                blocked member able to confirm an account still exists and
--                what it plays, which is precisely what a block should stop.
--
-- The count of who is going is now computed per viewer, so a member with
-- blocks may see one fewer attendee than there are. That is the right trade:
-- a spot count being off by one is a cosmetic inaccuracy, and a guest list
-- leaking to someone who was blocked is a safety failure.

drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps
  for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked(auth.uid(), user_id));

drop policy if exists user_sports_select on public.user_sports;
create policy user_sports_select on public.user_sports
  for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked(auth.uid(), user_id));

-- 40/LOVE — stop events being oversubscribed
--
-- `capacity` was only ever a check on the number itself (between 2 and 500).
-- Nothing counted RSVPs against it, so a member could join a full mixer through
-- the API, and two people could take the last spot at the same moment. For an
-- event with real courts booked, that means someone drives across town to be
-- turned away — the kind of thing that costs a member for good.
--
-- Security definer because the guard has to read the event row and lock it, and
-- an ordinary member has no update rights on events (only admins do), which is
-- what SELECT ... FOR UPDATE would otherwise require.

create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cap int;
  taken int;
begin
  -- Leaving, or sitting on the waitlist, never needs a spot.
  if new.status not in ('going', 'checked_in') then
    return new;
  end if;

  -- Lock the event row first: without it two simultaneous joins both count the
  -- same "one spot left" and both succeed.
  select e.capacity into cap from public.events e where e.id = new.event_id for update;
  if cap is null then
    return new;
  end if;

  select count(*) into taken
    from public.event_rsvps r
   where r.event_id = new.event_id
     and r.status in ('going', 'checked_in')
     and r.user_id <> new.user_id;  -- an existing RSVP isn't competing with itself

  if taken >= cap then
    raise exception 'This event is full.' using errcode = 'P0001';
  end if;

  return new;
end
$$;

drop trigger if exists event_capacity_guard on public.event_rsvps;
create trigger event_capacity_guard
  before insert or update on public.event_rsvps
  for each row execute function public.enforce_event_capacity();

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

-- 40/LOVE — an admin can actually remove someone
--
-- The moderation desk could mark a report "actioned", which set a status and
-- did nothing else. There was no way to stop a reported member using the app
-- short of deleting their auth.users row by hand in the Supabase dashboard —
-- not something anyone will do well at 11pm during a mixer, and not something
-- any document describes. Meanwhile the privacy policy says we keep the
-- community safe by "reviewing reports, enforcing blocks and bans", and Play
-- expects a dating app to be able to remove a member.
--
-- Suspension, not deletion: their account still exists, they can still sign in
-- and delete their own data, and it can be undone if the report was wrong.
-- What they cannot do is reach anybody.

alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text check (char_length(suspended_reason) <= 300);

comment on column public.profiles.suspended_at is
  'Set by an admin via suspend_member(). Non-null means: invisible in discovery, cannot swipe, message or RSVP. The member can still sign in and delete their account.';

create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = p_user and suspended_at is not null);
$$;

grant execute on function public.is_suspended(uuid) to authenticated;

-- ---- discovery -----------------------------------------------------------
-- The deck is security definer, so row-level security doesn't reach inside it.
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
      -- A suspended member is off the courts: out of everyone's deck, and
      -- their own deck is empty, so they cannot start anything new.
      and p.suspended_at is null
      and me.suspended_at is null
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
-- ---- who can be seen ------------------------------------------------------
-- Profile cards, chat headers, the matches grid: a suspended member drops out
-- of all of them. They can still read their own row, so the app works well
-- enough for them to leave.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (not public.is_blocked(auth.uid(), id) and suspended_at is null)
  );

-- ---- what a suspended member can no longer do -----------------------------
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.is_suspended(auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.user_a, m.user_b)
        and m.closed_at is null
        and not public.is_blocked(m.user_a, m.user_b)
    )
  );

drop policy if exists swipes_insert on public.swipes;
create policy swipes_insert on public.swipes
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and not public.is_suspended(auth.uid())
    and not public.is_blocked(auth.uid(), target_id)
  );

-- The real policy here is rsvps_write (FOR ALL), not an insert policy. Adding
-- a second permissive policy would have changed nothing: permissive policies
-- OR together, so the original would still have let a suspended member RSVP.
drop policy if exists rsvps_write on public.event_rsvps;
create policy rsvps_write on public.event_rsvps
  for all to authenticated
  using (user_id = auth.uid())
  -- USING still allows them to cancel an RSVP they already hold; WITH CHECK
  -- stops them taking a new place at an event.
  with check (user_id = auth.uid() and not public.is_suspended(auth.uid()));

-- ---- the desk -------------------------------------------------------------
-- Admin-only, and security definer because profiles_update only ever lets
-- somebody edit their own row — which is the point.
create or replace function public.suspend_member(p_user uuid, p_reason text default '')
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    return false;
  end if;
  if p_user = auth.uid() then
    return false;   -- suspending yourself locks the only person who can undo it
  end if;
  update profiles
     set suspended_at = coalesce(suspended_at, now()),
         suspended_reason = nullif(left(coalesce(p_reason, ''), 300), '')
   where id = p_user;
  if not found then
    return false;
  end if;
  -- Close their open conversations, so nothing they already sent keeps a
  -- thread alive on the other person's phone.
  update matches set closed_at = now()
   where closed_at is null and (user_a = p_user or user_b = p_user);
  return true;
end
$$;

create or replace function public.unsuspend_member(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    return false;
  end if;
  update profiles set suspended_at = null, suspended_reason = null where id = p_user;
  return found;
end
$$;

revoke all on function public.suspend_member(uuid, text) from public, anon;
revoke all on function public.unsuspend_member(uuid) from public, anon;
grant execute on function public.suspend_member(uuid, text) to authenticated;
grant execute on function public.unsuspend_member(uuid) to authenticated;

-- Deliberately withheld, like birthdate and the coordinates: whether an
-- account is suspended, and why, is between the member and the desk.
-- get_my_profile() is security definer and still returns the member's own row
-- whole, so the app can tell them.
revoke select (suspended_at, suspended_reason) on public.profiles from authenticated;

-- 40/LOVE — a member can play in more than one city
--
-- Until now a profile had exactly one city, and both matching and meetups hung
-- off it. Plenty of players split their time — Seattle and Spokane, LA and San
-- Diego, a snowbird in Indianapolis and Orlando — and had to flip a setting
-- back and forth to see either half of their life.
--
-- profiles.city stays: it is the member's HOME city, still a foreign key, still
-- what a profile card says. extra_cities holds any others they also play in.
-- Everything that used to ask "same city?" now asks "any city in common?".
--
-- An array can't carry a foreign key, so a trigger does the job the FK does for
-- the home city: an unknown slug is refused rather than quietly creating a
-- ghost city nobody can be matched in. It also keeps the list tidy — no
-- duplicates, and never the home city a second time — so "how many cities" is
-- a number the app can trust.

alter table public.profiles
  add column extra_cities text[] not null default '{}';

create or replace function public.clean_extra_cities()
returns trigger
language plpgsql
as $$
declare
  bad text;
begin
  if new.extra_cities is null then
    new.extra_cities := '{}';
  end if;

  select s into bad
  from unnest(new.extra_cities) as s
  where not exists (select 1 from public.cities c where c.slug = s)
  limit 1;
  if bad is not null then
    raise exception 'unknown city: %', bad using errcode = '23503';
  end if;

  -- de-duplicate, drop the home city, keep the order they were chosen in
  select coalesce(array_agg(s order by first_at), '{}') into new.extra_cities
  from (
    select s, min(ord) as first_at
    from unnest(new.extra_cities) with ordinality as t(s, ord)
    where s <> new.city
    group by s
  ) d;

  return new;
end;
$$;

create trigger profiles_clean_extra_cities
  before insert or update of city, extra_cities on public.profiles
  for each row execute function public.clean_extra_cities();

-- Every city a member plays in: home first, then the rest.
create or replace function public.member_cities(p_city text, p_extra text[])
returns text[]
language sql immutable
as $$
  select array[p_city] || coalesce(p_extra, '{}')
$$;

grant execute on function public.member_cities(text, text[]) to authenticated;

-- Readable like city itself is (see 20260806000018 — a profiles column must be
-- either granted or deliberately withheld, and the suite fails on one that is
-- neither).
grant select (extra_cities) on public.profiles to authenticated;

-- ---- the deck ----
-- Three changes from the version in 20260806000023:
--
-- 1. Any city in common, instead of the same single city.
--
-- 2. Distance only means something inside one metro. The radius filter at the
--    bottom used to be safe because everyone in the deck was in your city. Now
--    a member in Indianapolis who also plays in Seattle has Seattle players in
--    their deck, 1,900 miles from where their phone is — and the radius tops
--    out at 50. Left alone, the filter would throw away every one of them and
--    the second city would do nothing. So the distance counts only between
--    people who are local to each other: when the two are placed in different
--    metros, or are more than 100 miles apart (no metro reaches further than
--    60), it is unknown — exactly as it already is for a member who denies
--    location — and the city overlap above is what scopes the pair. Inside
--    one metro nothing changes: someone in your city but beyond your radius
--    still stays out.
--
-- 3. The card carries gender (and, for a doubles team, the partner's), so a
--    profile says who it is while you are choosing, not only after you match.
--    Both were already readable column by column (20260806000018); this just
--    puts them on the row the deck is drawn from.
--
-- The return type changes, which `create or replace` refuses to do, so the
-- function is dropped and created again — and the grant with it.
drop function if exists public.get_discovery_deck(public.app_mode, int);

create function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
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
  partner_age int,
  gender public.gender_identity,
  partner_gender public.gender_identity
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      case
        -- in two different metros: the shared city is why they are here
        when g.my_metro is not null and g.their_metro is not null and g.my_metro <> g.their_metro then null
        -- too far apart to be local to each other, whatever metro they are in
        when g.miles > 100 then null
        else g.miles
      end as dist,
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
    from profiles p, me,
      lateral (
        select
          miles_between(me.approx_lat, me.approx_lng, p.approx_lat, p.approx_lng) as miles,
          nearest_city(me.approx_lat, me.approx_lng) as my_metro,
          nearest_city(p.approx_lat, p.approx_lng) as their_metro
      ) g
    where p.id <> me.id
      -- city-first launch: you meet players who play in a city you play in
      and member_cities(p.city, p.extra_cities) && member_cities(me.city, me.extra_cities)
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      -- A suspended member is off the courts: out of everyone's deck, and
      -- their own deck is empty, so they cannot start anything new.
      and p.suspended_at is null
      and me.suspended_at is null
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
    case when c.is_team then age_of(c.partner_birthdate) else null end,
    c.gender,
    case when c.is_team then c.partner_gender else null end
  from candidates c
  where c.dist is null or c.dist <= (select radius_mi from me)
  order by 10 desc, c.last_active_at desc
  limit p_limit
$$;

grant execute on function public.get_discovery_deck(public.app_mode, int) to authenticated;

-- 40/LOVE — open Bakersfield, CA
--
-- City #12. Bakersfield sits about 110 miles north of Los Angeles, so its
-- 30-mile metro does not touch LA's 60: a member in either is placed in their
-- own city, never the other's. sort_order 35 lists it with the other
-- California cities, after San Diego (30) and before Phoenix (40).
--
-- The same entry is mirrored in mobile/src/data/cities.js and the city lists in
-- app/index.html, admin/index.html and landing/index.html.

insert into public.cities (slug, name, state, lat, lng, metro_radius_mi, launched, sort_order)
values ('bakersfield', 'Bakersfield', 'CA', 35.373, -119.019, 30, true, 35)
on conflict (slug) do nothing;

-- 40/LOVE — places to play live in the database
--
-- The Bakersfield places-to-play list shipped inside the app (and the
-- prototype) as a hardcoded array. That made the one thing that changes most
-- often in the whole product — a new court opens, a club changes its guest
-- policy, a park takes its nets down — the one thing that needed an app
-- release, a store review and every member updating before anyone saw it.
--
-- So the list is a table. The founder adds, edits and removes venues from the
-- moderation desk (/admin → Places) and members see the change the next time
-- they open Events. The copy in mobile/src/data/courts.js stays as what the
-- demo build shows, and what a live build falls back to if it cannot reach the
-- database — it is no longer the source of truth.
--
-- Shape notes:
--   · city is a real foreign key, so a venue can't be filed under a city that
--     doesn't exist, and a city can't be removed out from under its venues.
--   · courts and lights are NULLABLE on purpose. "We don't know" is a real
--     answer for a park whose listings disagree, and a number we made up is
--     worse than no number: someone drives there on the strength of it.
--   · access says who can walk on: a free public park, somewhere anyone can pay
--     to play, or members/residents only (listed so a member knows it exists).

create type public.court_setting as enum ('outdoor', 'indoor', 'both');
create type public.court_access as enum ('public', 'paid', 'members');

create table public.courts (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities (slug),
  name text not null check (char_length(name) between 2 and 80 and name = btrim(name)),
  address text not null default '' check (char_length(address) <= 120),
  sport public.sport not null default 'pickleball',
  setting public.court_setting not null,
  access public.court_access not null,
  courts int check (courts is null or courts between 1 and 99),
  lights boolean,
  note text not null default '' check (char_length(note) <= 280),
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- One row per venue per city, ignoring case: "Jastro park" is "Jastro Park".
-- A plain unique (city, name) would let the desk file the same park twice
-- under a different capitalisation, and members would see it twice.
create unique index courts_city_name_key on public.courts (city, lower(name));

create index courts_city_idx on public.courts (city, sort_order, name);

alter table public.courts enable row level security;

-- Members read every city's list: which rows they actually see is the app's
-- query (the cities on their profile), the same way events work. Nothing here
-- is personal data. Signed-out visitors get nothing — the landing page has no
-- use for it.
create policy courts_select on public.courts
  for select to authenticated using (true);

-- Only the desk writes. Same rule as events: authorised by the admins list in
-- the database, never by the page that sends the request.
create policy courts_admin_insert on public.courts
  for insert to authenticated with check (public.is_admin());
create policy courts_admin_update on public.courts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy courts_admin_delete on public.courts
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.courts to authenticated;

-- ---- Bakersfield: the 13 venues confirmed playable in November 2026 ----
-- The same rows as mobile/src/data/courts.js. sort_order groups them the way
-- the app lists them: free public parks first, then pay-to-play, then private.
insert into public.courts (city, name, address, setting, access, courts, lights, note, sort_order) values
  ('bakersfield', 'Greenacres Park PicklePlex', '2014 Calloway Dr', 'outdoor', 'public', 8, true,
   'Bakersfield’s biggest public complex — eight dedicated courts at Greenacres Community Center & Park. Open 6am–10pm.', 10),
  ('bakersfield', 'Jastro Park', '2900 Truxtun Ave', 'outdoor', 'public', 6, true,
   'Six dedicated courts downtown, beside the tennis courts. First come, first served.', 20),
  ('bakersfield', 'Stockdale River Ranch Community Park', '16303 Stockdale Ranch Dr', 'outdoor', 'public', 4, null,
   'The newest park in town (opened November 2025), far southwest.', 30),
  ('bakersfield', 'Haggin Oaks Park', '9200 McInnes Blvd', 'outdoor', 'public', 3, true,
   'Three courts in southwest Bakersfield; lights run on a timer.', 40),
  ('bakersfield', 'Campus Park South', '4445 Pin Oak Park Blvd', 'outdoor', 'public', 3, true,
   'Three dedicated courts in the southwest.', 50),
  ('bakersfield', 'Beale Park', '500 Oleander Ave', 'outdoor', 'public', null, null,
   'Free play in the Oleander neighborhood. Go in daylight — reports on the lights disagree.', 60),
  ('bakersfield', 'Farm Park (Gossamer Grove)', 'Parkdale Way, Shafter', 'outdoor', 'public', null, null,
   'Small neighborhood park in Shafter, northwest of town.', 70),
  ('bakersfield', 'Dignity Health Sports Complex — GSA Pickleball', '3101 Gilmore Ave, Suite 100', 'indoor', 'paid', null, true,
   'Indoor, air-conditioned play on multi-sport courts. Open play three days a week, plus memberships, punch cards and court rentals — call ahead for the schedule.', 110),
  ('bakersfield', 'Sportsplex Bakersfield', '6825 Ming Ave', 'outdoor', 'paid', 4, null,
   'Pay-to-play complex with weekly drop-in open play, leagues, clinics and court rentals you book online.', 120),
  ('bakersfield', 'Bakersfield Racquet Club', '1660 Pine St', 'outdoor', 'members', 4, true,
   'Private member-owned club downtown. Membership required; guests come with a member.', 210),
  ('bakersfield', 'Seven Oaks Country Club', '2000 Grand Lakes Ave', 'outdoor', 'members', 4, true,
   'Private country club — four dedicated courts with LED lights. Members and their guests.', 220),
  ('bakersfield', 'Stockdale Country Club', '7001 Stockdale Hwy', 'outdoor', 'members', 4, null,
   'Private country club. Members and their guests.', 230),
  ('bakersfield', 'Highgate at Seven Oaks', '2200 Highbury St', 'outdoor', 'members', 2, true,
   'Courts inside a gated community — residents and their guests only.', 240)
on conflict do nothing;

-- 40/LOVE — tournaments with brackets that build and fill themselves
--
-- A tournament is a single-elimination bracket for 2 to 24 entries in one
-- city. The founder creates it on the moderation desk; members join from the
-- Events tab until it is full or it starts. A doubles team's shared profile is
-- one entry, exactly as it is one card in the deck.
--
-- When the desk starts it, the bracket is built in one go:
--   · the field is seeded in a random draw (we hold no rating we would trust to
--     seed a real draw by);
--   · the bracket is the next power of two up from the field — 24 entries play
--     in a 32-slot bracket — and the empty slots are byes;
--   · seeds are placed in the standard order (1 v 32, 16 v 17, 8 v 25, …), so
--     byes fall to the top seeds, never meet each other, and the two top seeds
--     can only meet in the final;
--   · a bye advances its player at once, so round 1 is only real matches.
-- Every later round exists from the start with empty slots, and each result
-- moves the winner into the next one. The final's result crowns the champion
-- and completes the tournament.
--
-- Who can write what — all writes go through the functions below, never
-- straight into the tables, so the bracket can't be edited into nonsense:
--   · members: join and leave (only while registration is open);
--   · either player in a match: record its result — trusted the way a ladder
--     at a club is, with the desk able to correct it;
--   · the desk (admins): create, edit and cancel tournaments, start them, and
--     record or correct any result, including a walkover when a player can't
--     continue.

create type public.tournament_status as enum ('registration', 'in_progress', 'completed', 'cancelled');

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities (slug),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  venue text not null default '' check (char_length(venue) <= 80),
  sport public.sport not null default 'pickleball',
  level_range text not null default 'All levels' check (char_length(level_range) <= 40),
  starts_at timestamptz not null,
  max_entries int not null default 16 check (max_entries between 2 and 24),
  status public.tournament_status not null default 'registration',
  bracket_size int check (bracket_size in (2, 4, 8, 16, 32)),
  champion_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index tournaments_city_starts_idx on public.tournaments (city, starts_at);

create table public.tournament_entries (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seed int check (seed between 1 and 24),
  created_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null check (round between 1 and 5),     -- 1 = first round; the final is the last
  slot int not null check (slot between 0 and 15),      -- position within the round, top to bottom
  player_a uuid references public.profiles (id) on delete set null,
  player_b uuid references public.profiles (id) on delete set null,
  winner uuid references public.profiles (id) on delete set null,
  score text not null default '' check (char_length(score) <= 40),
  is_bye boolean not null default false,
  reported_by uuid references public.profiles (id) on delete set null,
  reported_at timestamptz,
  unique (tournament_id, round, slot),
  check (winner is null or winner = player_a or winner = player_b)
);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;

-- ---- reading ----
-- Members read every city's tournaments; which ones the app shows is its query
-- (the member's cities), the same as events and places to play.
create policy tournaments_select on public.tournaments
  for select to authenticated using (true);
-- The entry list says who will be where, and when — so, like an event's guest
-- list, a member never sees someone who has blocked them, or whom they blocked.
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (user_id = auth.uid() or not public.is_blocked(auth.uid(), user_id));
-- Match rows carry ids only; names come from get_profile_cards, which already
-- withholds a blocked member, so a bracket shows them as an unnamed player.
create policy tournament_matches_select on public.tournament_matches
  for select to authenticated using (true);

-- ---- writing ----
-- The desk manages tournaments directly. Entries and matches have no write
-- policies at all: the functions below are the only way in.
create policy tournaments_admin_insert on public.tournaments
  for insert to authenticated with check (public.is_admin());
create policy tournaments_admin_update on public.tournaments
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy tournaments_admin_delete on public.tournaments
  for delete to authenticated using (public.is_admin());

grant select on public.tournaments, public.tournament_entries, public.tournament_matches to authenticated;
grant insert, update, delete on public.tournaments to authenticated;

-- ---- joining and leaving ----
create or replace function public.join_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  t record;
  taken int;
begin
  if me is null then raise exception 'Sign in to join.' using errcode = '42501'; end if;
  if public.is_suspended(me) then raise exception 'Your account is suspended.' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = me) then
    raise exception 'Finish your profile before joining a tournament.' using errcode = 'P0001';
  end if;

  -- Lock the tournament: without it two people can both take the last place.
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'That tournament doesn''t exist.' using errcode = 'P0002'; end if;
  if t.status <> 'registration' then
    raise exception 'Entries for this tournament are closed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from tournament_entries where tournament_id = p_tournament and user_id = me) then
    return;  -- already in: joining twice is not an error
  end if;

  select count(*) into taken from tournament_entries where tournament_id = p_tournament;
  if taken >= t.max_entries then
    raise exception 'This tournament is full.' using errcode = 'P0001';
  end if;

  insert into tournament_entries (tournament_id, user_id) values (p_tournament, me);
end
$$;

create or replace function public.leave_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st public.tournament_status;
begin
  select status into st from tournaments where id = p_tournament;
  if st is distinct from 'registration' then
    -- Pulling out of a drawn bracket would leave a hole in it. Once it has
    -- started, the desk records a walkover instead.
    raise exception 'The draw has been made — ask the organiser to withdraw you.' using errcode = 'P0001';
  end if;
  delete from tournament_entries where tournament_id = p_tournament and user_id = auth.uid();
end
$$;

-- ---- building the bracket ----

-- The standard seeding order for a bracket of p_size slots: the seed in each
-- slot, top to bottom. 8 → {1,8,4,5,2,7,3,6}. Built by doubling: each seed s in
-- a bracket of n becomes the pair (s, 2n+1-s) in a bracket of 2n.
create or replace function public.bracket_seed_order(p_size int)
returns int[]
language plpgsql immutable
as $$
declare
  cur int[] := array[1];
  nxt int[];
  n int := 1;
  s int;
begin
  while n < p_size loop
    nxt := '{}';
    foreach s in array cur loop
      nxt := nxt || s || (2 * n + 1 - s);
    end loop;
    cur := nxt;
    n := n * 2;
  end loop;
  return cur;
end
$$;

-- Put a winner into the next round: slot s feeds slot s/2, as the top player
-- when s is even and the bottom player when s is odd. The final has nowhere to
-- go, so its winner becomes the champion and the tournament is complete.
create or replace function public.tournament_advance(p_match uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m record;
  last_round int;
begin
  select tm.*, t.bracket_size into m
    from tournament_matches tm join tournaments t on t.id = tm.tournament_id
   where tm.id = p_match;
  last_round := round(log(2, m.bracket_size))::int;

  if m.round >= last_round then
    update tournaments set champion_id = m.winner, status = 'completed' where id = m.tournament_id;
    return;
  end if;

  if m.slot % 2 = 0 then
    update tournament_matches set player_a = m.winner
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  else
    update tournament_matches set player_b = m.winner
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  end if;
end
$$;

create or replace function public.start_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t record;
  n int;
  size int := 2;
  rounds int;
  ord int[];
  seeded uuid[];
  r int;
  s int;
  a uuid;
  b uuid;
  mid uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the organiser can start a tournament.' using errcode = '42501';
  end if;
  select * into t from tournaments where id = p_tournament for update;
  if not found then raise exception 'That tournament doesn''t exist.' using errcode = 'P0002'; end if;
  if t.status <> 'registration' then
    raise exception 'This tournament has already been drawn.' using errcode = 'P0001';
  end if;

  -- Anyone suspended since they entered doesn't get a place in the draw.
  delete from tournament_entries e
   where e.tournament_id = p_tournament and public.is_suspended(e.user_id);

  select count(*) into n from tournament_entries where tournament_id = p_tournament;
  if n < 2 then
    raise exception 'A tournament needs at least 2 players to start.' using errcode = 'P0001';
  end if;

  while size < n loop size := size * 2; end loop;
  rounds := round(log(2, size))::int;
  -- Recorded before any match exists: advancing a bye needs to know which
  -- round is the final.
  update tournaments set bracket_size = size where id = p_tournament;

  -- The draw: a random order is the seeding.
  select array_agg(user_id order by random()) into seeded
    from tournament_entries where tournament_id = p_tournament;
  for s in 1..n loop
    update tournament_entries set seed = s
     where tournament_id = p_tournament and user_id = seeded[s];
  end loop;

  -- Every round's matches exist from the start, empty until they are filled.
  for r in 1..rounds loop
    for s in 0..(size / (2 ^ r))::int - 1 loop
      insert into tournament_matches (tournament_id, round, slot) values (p_tournament, r, s);
    end loop;
  end loop;

  -- Round 1 in seeding order; a seed beyond the field is a bye.
  ord := public.bracket_seed_order(size);
  for s in 0..size / 2 - 1 loop
    a := case when ord[2 * s + 1] <= n then seeded[ord[2 * s + 1]] end;
    b := case when ord[2 * s + 2] <= n then seeded[ord[2 * s + 2]] end;
    update tournament_matches
       set player_a = a, player_b = b,
           is_bye = (a is null or b is null),
           winner = case when a is null then b when b is null then a end
     where tournament_id = p_tournament and round = 1 and slot = s
     returning id into mid;
    if a is null or b is null then
      perform public.tournament_advance(mid);
    end if;
  end loop;

  update tournaments set status = 'in_progress' where id = p_tournament;
end
$$;

-- ---- recording results ----
create or replace function public.report_match_result(p_match uuid, p_winner uuid, p_score text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  m record;
  t record;
  nxt record;
  last_round int;
begin
  select * into m from tournament_matches where id = p_match for update;
  if not found then raise exception 'That match doesn''t exist.' using errcode = 'P0002'; end if;
  select * into t from tournaments where id = m.tournament_id for update;

  if t.status = 'cancelled' then
    raise exception 'This tournament was cancelled.' using errcode = 'P0001';
  end if;
  if t.status = 'registration' then
    raise exception 'The draw hasn''t been made yet.' using errcode = 'P0001';
  end if;
  if m.is_bye then
    raise exception 'A bye has no result to record.' using errcode = 'P0001';
  end if;
  if not admin and (me is null or me not in (coalesce(m.player_a, '00000000-0000-0000-0000-000000000000'),
                                             coalesce(m.player_b, '00000000-0000-0000-0000-000000000000'))) then
    raise exception 'Only the two players in a match can record its result.' using errcode = '42501';
  end if;
  if not admin and public.is_suspended(me) then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;

  -- Both places must be filled. The desk may still settle a match with one
  -- empty side — a player who deleted their account mid-tournament — by giving
  -- it to the one who is there.
  if m.player_a is null or m.player_b is null then
    if not admin or (m.player_a is null and m.player_b is null) then
      raise exception 'This match is still waiting for its players.' using errcode = 'P0001';
    end if;
  end if;
  if p_winner is null or p_winner not in (coalesce(m.player_a, '00000000-0000-0000-0000-000000000000'),
                                          coalesce(m.player_b, '00000000-0000-0000-0000-000000000000')) then
    raise exception 'The winner has to be one of the two players in the match.' using errcode = 'P0001';
  end if;

  last_round := round(log(2, t.bracket_size))::int;

  -- A result already recorded is final for the players; the desk can change it
  -- only while the next match hasn't been played, so the bracket never shows a
  -- winner who has advanced from a match they lost.
  if m.winner is not null then
    if not admin then
      raise exception 'This result is already in — ask the organiser to correct it.' using errcode = 'P0001';
    end if;
    if m.round < last_round then
      select * into nxt from tournament_matches
       where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
      if nxt.winner is not null then
        raise exception 'The next round has already been played — correct that result first.' using errcode = 'P0001';
      end if;
    end if;
    if t.status = 'completed' then
      update tournaments set status = 'in_progress', champion_id = null where id = t.id;
    end if;
  end if;

  update tournament_matches
     set winner = p_winner, score = left(btrim(coalesce(p_score, '')), 40),
         reported_by = me, reported_at = now()
   where id = p_match;
  perform public.tournament_advance(p_match);
end
$$;

-- Only signed-in members call these, and only through the rules inside them.
revoke all on function public.join_tournament(uuid) from public, anon;
revoke all on function public.leave_tournament(uuid) from public, anon;
revoke all on function public.start_tournament(uuid) from public, anon;
revoke all on function public.report_match_result(uuid, uuid, text) from public, anon;
revoke all on function public.tournament_advance(uuid) from public, anon, authenticated;
grant execute on function public.join_tournament(uuid) to authenticated;
grant execute on function public.leave_tournament(uuid) to authenticated;
grant execute on function public.start_tournament(uuid) to authenticated;
grant execute on function public.report_match_result(uuid, uuid, text) to authenticated;
grant execute on function public.bracket_seed_order(int) to authenticated;

-- 40/LOVE — tournaments take up to 72 entries
--
-- The first version stopped at 24. A club open day or a city championship
-- wants more, so the ceiling is now 72 — which plays in a bracket of 128 over
-- seven rounds. Nothing about how a bracket is built changes: the functions in
-- 20260806000027 never knew the number 24; only these column limits did.
--
--   entries        2..24  ->  2..72
--   bracket size   ..32   ->  ..128   (72 entries need the next power of two up)
--   seed           1..24  ->  1..72
--   round          1..5   ->  1..7    (a bracket of 128 has seven rounds)
--   slot           0..15  ->  0..63   (64 first-round matches)

alter table public.tournaments
  drop constraint tournaments_max_entries_check,
  add constraint tournaments_max_entries_check check (max_entries between 2 and 72);

alter table public.tournaments
  drop constraint tournaments_bracket_size_check,
  add constraint tournaments_bracket_size_check check (bracket_size in (2, 4, 8, 16, 32, 64, 128));

alter table public.tournament_entries
  drop constraint tournament_entries_seed_check,
  add constraint tournament_entries_seed_check check (seed between 1 and 72);

alter table public.tournament_matches
  drop constraint tournament_matches_round_check,
  add constraint tournament_matches_round_check check (round between 1 and 7);

alter table public.tournament_matches
  drop constraint tournament_matches_slot_check,
  add constraint tournament_matches_slot_check check (slot between 0 and 63);

-- 40/LOVE — tournament fixes from an independent review
--
-- 1. A player who deletes their account mid-tournament no longer stalls the
--    bracket. Their side of every match is cleared (ON DELETE SET NULL), and so
--    is `winner` on every match they won — which used to make those matches look
--    unplayed, so the "next round already played" guard stopped protecting them
--    and the desk had no way to settle the match they left. Now:
--      · "has this been played?" is read from reported_at (a plain column that
--        survives a deletion), not from winner;
--      · the desk can settle a match with one empty side, but only when that
--        side was VACATED (its player deleted their account) — never when it is
--        merely still to be decided by an unplayed earlier match.
-- 2. Every path locks the tournament row first, then match rows, so a result
--    and a correction reported at the same moment can't deadlock.
-- 3. The second player confirming the same result is a no-op, not an error
--    ("already in — ask the organiser") — both players recording the match they
--    just played is the normal case, not a dispute.
-- 4. leave_tournament locks the tournament, so a member can't slip out while the
--    draw is being made and still be drawn; leaving a deleted tournament is a
--    no-op rather than "the draw has been made".
-- 5. The desk sees every entrant. Entry RLS hid anyone the organiser's own
--    account had a block with, so the desk's count and "Make the draw with N
--    entries" could disagree with what start_tournament actually drew. Names on
--    the desk come from an admin-only lookup for the same reason. Members still
--    never see someone they have a block with, and no longer see a suspended
--    entrant either.
-- 6. entry_count on tournaments, kept by a trigger: the true count, which a
--    member's block-filtered entry list can't give them. Without it a member
--    with one block among 72 entrants saw "71 of 72" and an Enter button on a
--    full tournament.
-- 7. completed_at, so the app can list a finished tournament for two weeks
--    after it finished — not two weeks after it started, which dropped a long
--    tournament from the app while it was still being played.
-- 8. bracket_seed_order is internal: no longer callable through the API (it
--    was, by anyone, with any size — a cheap way to burn CPU), and it refuses a
--    size outside 1..128.

-- ---- 6, 7: columns ----
alter table public.tournaments
  add column entry_count int not null default 0 check (entry_count >= 0),
  add column completed_at timestamptz;

update public.tournaments t
   set entry_count = (select count(*) from public.tournament_entries e where e.tournament_id = t.id),
       completed_at = case when t.status = 'completed' then now() end;

create or replace function public.tournament_entry_count_sync()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update tournaments set entry_count = entry_count + 1 where id = new.tournament_id;
    return new;
  end if;
  -- On a cascade from deleting the tournament itself the row is already gone;
  -- the update then simply matches nothing.
  update tournaments set entry_count = greatest(0, entry_count - 1) where id = old.tournament_id;
  return old;
end
$$;

create trigger tournament_entry_count_sync
  after insert or delete on public.tournament_entries
  for each row execute function public.tournament_entry_count_sync();

revoke all on function public.tournament_entry_count_sync() from public, anon, authenticated;

-- ---- 5: who can see an entry ----
drop policy if exists tournament_entries_select on public.tournament_entries;
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (not public.is_blocked(auth.uid(), user_id) and not public.is_suspended(user_id))
  );

-- Names for the desk's brackets and entry lists. get_profile_cards withholds a
-- card when there is a block between the caller and that member, which is right
-- for members and wrong for the organiser running the draw.
create or replace function public.admin_player_names(p_ids uuid[])
returns table (id uuid, name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the organiser can look these up.' using errcode = '42501';
  end if;
  return query
    select p.id,
           case when p.is_team and coalesce(p.partner_name, '') <> ''
                then p.first_name || ' & ' || p.partner_name
                else p.first_name end
      from profiles p
     where p.id = any (p_ids);
end
$$;

revoke all on function public.admin_player_names(uuid[]) from public, anon;
grant execute on function public.admin_player_names(uuid[]) to authenticated;

-- ---- 8: the seed order is internal ----
create or replace function public.bracket_seed_order(p_size int)
returns int[]
language plpgsql immutable
as $$
declare
  cur int[] := array[1];
  nxt int[];
  n int := 1;
  s int;
begin
  if p_size is null or p_size < 1 or p_size > 128 then
    raise exception 'A bracket has between 1 and 128 places.' using errcode = '22023';
  end if;
  while n < p_size loop
    nxt := '{}';
    foreach s in array cur loop
      nxt := nxt || s || (2 * n + 1 - s);
    end loop;
    cur := nxt;
    n := n * 2;
  end loop;
  return cur;
end
$$;

revoke all on function public.bracket_seed_order(int) from public, anon, authenticated;

-- ---- 7: completed_at is set when the final crowns a champion ----
create or replace function public.tournament_advance(p_match uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  m record;
  last_round int;
begin
  select tm.*, t.bracket_size into m
    from tournament_matches tm join tournaments t on t.id = tm.tournament_id
   where tm.id = p_match;
  last_round := round(log(2, m.bracket_size))::int;

  if m.round >= last_round then
    update tournaments set champion_id = m.winner, status = 'completed', completed_at = now()
     where id = m.tournament_id;
    return;
  end if;

  if m.slot % 2 = 0 then
    update tournament_matches set player_a = m.winner
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  else
    update tournament_matches set player_b = m.winner
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
  end if;
end
$$;

revoke all on function public.tournament_advance(uuid) from public, anon, authenticated;

-- ---- 4: leaving ----
create or replace function public.leave_tournament(p_tournament uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st public.tournament_status;
begin
  -- The same lock the draw takes: leaving waits for a draw in progress, and
  -- then sees that it has been made.
  select status into st from tournaments where id = p_tournament for update;
  if not found then
    return;  -- already gone: nothing left to leave
  end if;
  if st <> 'registration' then
    -- Pulling out of a drawn bracket would leave a hole in it. Once it has
    -- started, the desk records a walkover instead.
    raise exception 'The draw has been made — ask the organiser to withdraw you.' using errcode = 'P0001';
  end if;
  delete from tournament_entries where tournament_id = p_tournament and user_id = auth.uid();
end
$$;

-- ---- 1, 2, 3: recording results ----
create or replace function public.report_match_result(p_match uuid, p_winner uuid, p_score text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  admin boolean := public.is_admin();
  tid uuid;
  m record;
  t record;
  nxt record;
  last_round int;
  empty_feeder_slot int;
  vacated boolean;
  nobody constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- Tournament first, then the match: the same order as every other path.
  select tournament_id into tid from tournament_matches where id = p_match;
  if not found then raise exception 'That match doesn''t exist.' using errcode = 'P0002'; end if;
  select * into t from tournaments where id = tid for update;
  select * into m from tournament_matches where id = p_match for update;

  if t.status = 'cancelled' then
    raise exception 'This tournament was cancelled.' using errcode = 'P0001';
  end if;
  if t.status = 'registration' then
    raise exception 'The draw hasn''t been made yet.' using errcode = 'P0001';
  end if;
  if m.is_bye then
    raise exception 'A bye has no result to record.' using errcode = 'P0001';
  end if;
  if not admin and (me is null or me not in (coalesce(m.player_a, nobody), coalesce(m.player_b, nobody))) then
    raise exception 'Only the two players in a match can record its result.' using errcode = '42501';
  end if;
  if not admin and public.is_suspended(me) then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;

  last_round := round(log(2, t.bracket_size))::int;

  -- Once the next match in this line has a result, this one is settled for
  -- everyone: correcting it would show someone advancing from a match they
  -- lost. reported_at, not winner — a winner who deleted their account leaves
  -- winner empty, but the match was still played.
  if m.round < last_round then
    select * into nxt from tournament_matches
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
    if nxt.reported_at is not null then
      raise exception 'The next round has already been played — correct that result first.' using errcode = 'P0001';
    end if;
  end if;

  -- Both places must be filled. The desk may settle a match with one empty
  -- side, but only when that side was vacated — its player deleted their
  -- account — not when an earlier match that fills it is still to be played.
  if m.player_a is null or m.player_b is null then
    if not admin or (m.player_a is null and m.player_b is null) then
      raise exception 'This match is still waiting for its players.' using errcode = 'P0001';
    end if;
    if m.round = 1 then
      vacated := true;  -- a first-round match that isn't a bye always had two players
    else
      empty_feeder_slot := m.slot * 2 + (case when m.player_a is null then 0 else 1 end);
      select exists (
        select 1 from tournament_matches f
         where f.tournament_id = m.tournament_id and f.round = m.round - 1 and f.slot = empty_feeder_slot
           and (f.reported_at is not null                    -- played; its winner has since left
                or f.is_bye                                  -- a bye whose player has since left
                or (f.round = 1 and f.player_a is null and f.player_b is null))  -- both first-round players left
      ) into vacated;
    end if;
    if not vacated then
      raise exception 'This match is still waiting for its players.' using errcode = 'P0001';
    end if;
  end if;

  if p_winner is null or p_winner not in (coalesce(m.player_a, nobody), coalesce(m.player_b, nobody)) then
    raise exception 'The winner has to be one of the two players in the match.' using errcode = 'P0001';
  end if;

  if m.reported_at is not null then
    if not admin then
      -- The other player recording the same result: it's already in, and that
      -- is fine. Don't overwrite the first reporter's score.
      if p_winner = m.winner then return; end if;
      raise exception 'This result is already in — ask the organiser to correct it.' using errcode = 'P0001';
    end if;
    if t.status = 'completed' then
      update tournaments set status = 'in_progress', champion_id = null, completed_at = null where id = t.id;
    end if;
  end if;

  update tournament_matches
     set winner = p_winner, score = left(btrim(coalesce(p_score, '')), 40),
         reported_by = me, reported_at = now()
   where id = p_match;
  perform public.tournament_advance(p_match);
end
$$;

revoke all on function public.report_match_result(uuid, uuid, text) from public, anon;
grant execute on function public.report_match_result(uuid, uuid, text) to authenticated;
revoke all on function public.leave_tournament(uuid) from public, anon;
grant execute on function public.leave_tournament(uuid) to authenticated;

-- 40/LOVE — closing the two privacy gaps logged on 2026-11-11
--
-- GAP 1. Other members' settings were readable through the API.
--   Migration 18 hid birthdates and coordinates but left 22 other profile
--   columns readable by any signed-in member, for every member who hadn't
--   blocked them: cities, modes, who they are looking for, age and distance
--   range, exact last-active time and more. The app displays none of them.
--   Someone with an account and a script could list who is in Date mode and
--   what they want, city by city.
--
--   Now only `id` and `first_name` stay readable column by column — the admin
--   desk joins first names onto reports and photos, and a row filter needs the
--   id. Everything a member is shown about someone else comes from a function
--   that decides what to hand over: the deck, get_profile_cards, and the
--   tournament lookups. Your own row comes from get_my_profile, as it already
--   did.
--
--   Writing had a hole of its own: the update policy only checked that the row
--   was yours, so a member could set any column on it — including clearing
--   their own suspension, marking themselves verified, or backdating
--   created_at. A trigger now refuses those changes from a member's session.
--   Functions that legitimately set them (suspend_member,
--   sync_phone_verification, set_my_location) run as the owner and pass.
--
--   get_profile_cards also tightens: nobody signed out can call it (it never
--   revoked the default grant to PUBLIC, so the public anon key and a member's
--   id were enough to get their card); a suspended member's card is no longer
--   handed out, matching the row policy; and it stops sending the city and the
--   exact last-active and verified timestamps, which no card shows. It gains
--   partner_gender and play_games, which cards do show — the app used to read
--   partner_gender straight from the table, the one direct read this closes.
--
-- GAP 2. Distance could be used to find where someone lives.
--   The deck returned distance to a tenth of a mile, and a member could write
--   any coordinates to their own profile as often as they liked. Three readings
--   from chosen spots recovered another member's stored ~1 km position. The
--   distance filter and the metro boundary leaked the same thing more slowly.
--
--   Now:
--   · Distance is worked out between the centres of a grid of squares about
--     2½ miles on a side (0.04° of latitude by 0.05° of longitude), never
--     between the stored points, and returned in whole miles. Two members in
--     the same square are "1 mile" apart. Moving around inside your own square
--     changes nothing anyone sees, so no amount of probing can place someone
--     more precisely than their square. The radius filter, the "close by"
--     score and the metro test all use the same squares.
--   · Members can no longer write their position directly. The app calls
--     set_my_location(), which checks it is a real place and lets you move to
--     a different square at most once every 6 hours; within that time a new
--     position is politely ignored and the old one stands.
--   · The deck returns at most 100 cards per call.
--   · A radius under 4 miles still covers your own square and its eight
--     neighbours, or people a few hundred yards away across a square's edge
--     would be hidden while someone 3 miles off in your own square showed.
--
-- FROM THE INDEPENDENT REVIEW (same kinds of leak, through the deck):
--   · The deck only shows people whose preferences fit you. A member who could
--     rewrite their own birthdate and gender at will could re-check the deck
--     after each change and read off another member's exact age range and who
--     they are looking for. Your birthdate is now fixed once your profile
--     exists (email support to correct it), and your gender can change freely
--     in the first hour, then at most once every 30 days.
--   · The deck no longer returns its matching score. Taking the parts you can
--     see away from it revealed who had already aced you and who was active
--     this week; ties were broken by last-active time. It still ranks by the
--     score, and breaks ties with an order that is fixed per viewer and says
--     nothing about anyone.
--   · Still possible, and logged as follow-ups: switching a doubles partner on
--     and off can hint at someone's Play/Friends partner preference; and
--     is_blocked()/is_suspended() answer for any two ids.

-- ---- columns ----
alter table public.profiles
  add column location_updated_at timestamptz,
  add column gender_updated_at timestamptz;

alter table public.profiles
  add constraint profiles_approx_on_earth
  check (approx_lat between -90 and 90 and approx_lng between -180 and 180);

-- ---- GAP 1: reading ----
-- Column privileges, explicitly, so nothing depends on how a table-level
-- revoke interacts with column grants.
revoke select (first_name, bio, city, availability_note, modes, radius_mi,
  age_min, age_max, same_sports_only, verified_at, last_active_at, created_at,
  gender, seeking, play_games, play_pref, friends_pref, phone_verified_at,
  is_team, partner_name, partner_gender, extra_cities)
  on public.profiles from authenticated;
revoke select on public.profiles from anon, authenticated;
grant select (id, first_name) on public.profiles to authenticated;

-- Other people, as much as a card shows and no more.
create or replace function public.get_profile_cards(p_ids uuid[])
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(card)), '[]'::jsonb)
  from (
    select
      p.id,
      p.first_name,
      extract(year from age(p.birthdate))::int as age,
      p.bio,
      p.availability_note,
      p.verified_at is not null as verified,
      p.gender,
      p.play_games,
      p.is_team,
      p.partner_name,
      case when p.is_team then p.partner_gender else null end as partner_gender,
      case when p.partner_birthdate is null then null
           else extract(year from age(p.partner_birthdate))::int end as partner_age,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'sport', s.sport, 'level', s.level, 'rating_label', s.rating_label))
        from public.user_sports s where s.user_id = p.id
      ), '[]'::jsonb) as user_sports
    from public.profiles p
    where auth.uid() is not null
      and p.id = any(p_ids)
      -- Security definer bypasses RLS, so profiles_select's row filter is
      -- repeated here by hand: blocks either way, and suspended members —
      -- except that you always get your own card.
      and (p.id = auth.uid() or (
        not public.is_blocked(auth.uid(), p.id)
        and p.suspended_at is null
      ))
  ) card;
$$;

revoke all on function public.get_profile_cards(uuid[]) from public, anon;
grant execute on function public.get_profile_cards(uuid[]) to authenticated;

-- ---- GAP 1: writing ----
create or replace function public.profiles_guard_member_writes()
returns trigger
language plpgsql
as $$
begin
  -- Only a member's own session is limited. Security definer functions run as
  -- their owner, and the service role and SQL editor are not members.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new profile starts unverified, unsuspended and with no position: the
    -- app sets the position afterwards through set_my_location().
    new.verified_at := null;
    new.phone_verified_at := null;
    new.suspended_at := null;
    new.suspended_reason := null;
    new.approx_lat := null;
    new.approx_lng := null;
    new.location_updated_at := null;
    new.gender_updated_at := null;
    new.created_at := now();
    new.last_active_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.verified_at is distinct from old.verified_at
     or new.phone_verified_at is distinct from old.phone_verified_at
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason
     or new.created_at is distinct from old.created_at
     or new.approx_lat is distinct from old.approx_lat
     or new.approx_lng is distinct from old.approx_lng
     or new.location_updated_at is distinct from old.location_updated_at
     or new.gender_updated_at is distinct from old.gender_updated_at then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;

  -- Your birthdate is fixed once your profile exists. Matching filters on it,
  -- so changing it at will would let a member read other people's age ranges
  -- off the deck.
  if new.birthdate is distinct from old.birthdate then
    raise exception 'Your birthdate can''t be changed in the app. If it''s wrong, email hello@40love.app and we''ll fix it.'
      using errcode = '42501';
  end if;

  -- Gender: freely in the first hour (a mis-tap at signup), then once every
  -- 30 days, for the same reason — the deck's "who are they looking for" test
  -- runs on it.
  if new.gender is distinct from old.gender then
    if old.gender is not null
       and old.created_at < now() - interval '1 hour'
       and old.gender_updated_at is not null
       and old.gender_updated_at > now() - interval '30 days' then
      raise exception 'You can change this once every 30 days. If it''s wrong, email hello@40love.app and we''ll fix it.'
        using errcode = '42501';
    end if;
    if old.gender is not null and old.created_at < now() - interval '1 hour' then
      new.gender_updated_at := now();
    end if;
  end if;

  -- "Last active" means now, whatever the app sent — a date in the future
  -- would otherwise keep a profile looking active for ever.
  if new.last_active_at is distinct from old.last_active_at then
    new.last_active_at := now();
  end if;
  return new;
end
$$;

create trigger profiles_guard_member_writes
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_member_writes();

revoke all on function public.profiles_guard_member_writes() from public, anon, authenticated;

-- ---- GAP 2: the grid ----
-- The centre of the square a point falls in. 0.04° of latitude is 2.8 miles;
-- 0.05° of longitude is 3.1 miles in Miami and 2.3 in Seattle.
create or replace function public.grid_lat(p numeric)
returns numeric language sql immutable
as $$ select floor(p / 0.04) * 0.04 + 0.02 $$;

create or replace function public.grid_lng(p numeric)
returns numeric language sql immutable
as $$ select floor(p / 0.05) * 0.05 + 0.025 $$;

revoke all on function public.grid_lat(numeric) from public, anon, authenticated;
revoke all on function public.grid_lng(numeric) from public, anon, authenticated;

-- ---- GAP 2: moving ----
create or replace function public.set_my_location(p_lat numeric, p_lng numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
  cur record;
  new_lat numeric(5, 2);
  new_lng numeric(5, 2);
  move_gap constant interval := interval '6 hours';
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'That isn''t a place on the map.' using errcode = '22023';
  end if;
  -- The same rounding the phone does (about 1 km); the grid coarsens further.
  new_lat := round(p_lat, 2);
  new_lng := round(p_lng, 2);

  select approx_lat, approx_lng, location_updated_at into cur
    from profiles where id = me for update;
  if not found then
    raise exception 'Finish setting up your profile first.' using errcode = 'P0002';
  end if;

  -- Staying in the same square: nothing anyone can see changes, so it is
  -- always fine and doesn't use up the move.
  if cur.approx_lat is not null and cur.approx_lng is not null
     and grid_lat(cur.approx_lat) = grid_lat(new_lat)
     and grid_lng(cur.approx_lng) = grid_lng(new_lng) then
    update profiles set approx_lat = new_lat, approx_lng = new_lng where id = me;
    return jsonb_build_object('accepted', true, 'moved', false);
  end if;

  -- A different square: once every 6 hours. Otherwise the old position stands
  -- — the app carries on, and tries again next time it opens.
  if cur.approx_lat is not null and cur.location_updated_at is not null
     and cur.location_updated_at > now() - move_gap then
    return jsonb_build_object('accepted', false, 'moved', false,
                              'retry_after', cur.location_updated_at + move_gap);
  end if;

  update profiles
     set approx_lat = new_lat, approx_lng = new_lng, location_updated_at = now()
   where id = me;
  return jsonb_build_object('accepted', true, 'moved', true);
end
$$;

revoke all on function public.set_my_location(numeric, numeric) from public, anon;
grant execute on function public.set_my_location(numeric, numeric) to authenticated;

-- ---- GAP 2: the deck ----
-- Unchanged from 20260806000024 except: distance and metro are worked out
-- from grid squares and returned in whole miles; a radius under 4 covers your
-- square and its neighbours; play_games is on the card; the score is used to
-- rank but not returned, and ties are broken per viewer, not by last-active
-- time; p_limit is capped at 100. The return type changes, so drop and
-- recreate.
drop function if exists public.get_discovery_deck(public.app_mode, int);

create function public.get_discovery_deck(p_mode public.app_mode default 'date', p_limit int default 20)
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
  is_team boolean,
  partner_name text,
  partner_age int,
  gender public.gender_identity,
  partner_gender public.gender_identity,
  play_games public.game_type[]
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select * from profiles where id = auth.uid()
  ),
  candidates as (
    select
      p.*,
      case
        -- in two different metros: the shared city is why they are here
        when g.my_metro is not null and g.their_metro is not null and g.my_metro <> g.their_metro then null
        -- too far apart to be local to each other, whatever metro they are in
        when g.miles > 100 then null
        -- whole miles between squares; the same square reads as 1 mile
        when g.miles is not null then greatest(1, round(g.miles))
        else null
      end as dist,
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
    from profiles p, me,
      lateral (
        select grid_lat(me.approx_lat) as my_lat, grid_lng(me.approx_lng) as my_lng,
               grid_lat(p.approx_lat) as their_lat, grid_lng(p.approx_lng) as their_lng
      ) sq,
      lateral (
        select
          miles_between(sq.my_lat, sq.my_lng, sq.their_lat, sq.their_lng) as miles,
          nearest_city(sq.my_lat, sq.my_lng) as my_metro,
          nearest_city(sq.their_lat, sq.their_lng) as their_metro
      ) g
    where p.id <> me.id
      -- city-first launch: you meet players who play in a city you play in
      and member_cities(p.city, p.extra_cities) && member_cities(me.city, me.extra_cities)
      and p_mode = any (me.modes)
      and p_mode = any (p.modes)
      and not is_blocked(me.id, p.id)
      -- A suspended member is off the courts: out of everyone's deck, and
      -- their own deck is empty, so they cannot start anything new.
      and p.suspended_at is null
      and me.suspended_at is null
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
  ,
  -- radius under 4 still means "my square and the eight around it"
  reach as (
    select greatest(radius_mi, 4) as mi from me
  ),
  ranked as (
    select
      c.*,
      (
        (case when c.aced_me then 10 else 0 end)
        + (case when c.shared_sport then 3 else 0 end)
        + (case when p_mode = 'play' then 2 else 1 end) * c.skill_adj
        + (case when c.last_active_at > now() - interval '7 days' then 2 else 0 end)
        + (case when c.dist is not null and c.dist <= (select mi from reach) / 2.0 then 1 else 0 end)
        + (case when c.verified_at is not null then 1 else 0 end)
      ) as rank_score
    from candidates c
    where c.dist is null or c.dist <= (select mi from reach)
  )
  select
    r.id,
    r.first_name,
    age_of(r.birthdate),
    r.dist,
    (select coalesce(jsonb_agg(jsonb_build_object('sport', us.sport, 'level', us.level, 'rating', us.rating_label) order by us.sport), '[]'::jsonb)
       from user_sports us where us.user_id = r.id),
    r.verified_at is not null,
    r.availability_note,
    r.bio,
    r.created_at > now() - interval '7 days',
    r.is_team,
    r.partner_name,
    case when r.is_team then age_of(r.partner_birthdate) else null end,
    r.gender,
    case when r.is_team then r.partner_gender else null end,
    r.play_games
  from ranked r
  order by r.rank_score desc, md5(r.id::text || auth.uid()::text)
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke all on function public.get_discovery_deck(public.app_mode, int) from public, anon;
grant execute on function public.get_discovery_deck(public.app_mode, int) to authenticated;

-- 40/LOVE — the two privacy follow-ups logged with migration 30
--
-- 1. is_blocked(a, b) and is_suspended(user) answered for ANY ids.
--    Row policies call them, and a policy's functions run as the member
--    reading the table, so members had to be able to execute them — and could
--    then ask directly whether two other members had blocked each other, or
--    whether anyone at all was suspended.
--
--    Members now get two helpers that only ever answer about themselves:
--      i_am_suspended()       — is my own account suspended?
--      hidden_from_me(other)  — is this person missing from my profile list?
--                               True for a block either way, a suspended
--                               account, and an id with no profile at all —
--                               the three look the same, exactly as they do
--                               in the profile list, so asking tells a member
--                               nothing they couldn't already see. (A helper
--                               that said "blocked" separately would tell the
--                               blocked person who blocked them; one that was
--                               false for a missing id would single out
--                               suspended accounts.)
--    Members can no longer execute is_blocked or is_suspended. Security
--    definer functions (the deck, cards, tournaments) still use them — they
--    run as the owner.
--
--    Every member-facing table that shows other people's ids now follows the
--    profile list, so none of them can be used to pick out suspended members
--    (rows that outlive a hidden profile) either:
--      profiles, user_sports, event_rsvps, tournament_entries — rows of
--        someone not in your profile list are not shown;
--      profile_photos — approved photos only of people in your profile list
--        (they used to be readable for everyone, blocked and suspended
--        included; the photo files follow, through the storage policy);
--      swipes, messages — you can't act on someone hidden from you.
--    Still visible, by design: a tournament bracket keeps every place,
--    including a player hidden from you (shown unnamed), so a bracket player
--    suspended after the draw can be told apart from one who left. Narrow,
--    and logged in the launch checklist.
--
-- 2. Switching a doubles partner on and off could probe someone's
--    Play/Friends partner preference. The deck's "plays with women / men /
--    everyone" test runs on your gender and, for a team, your partner's; with
--    your own gender limited since migration 30, a partner you could add,
--    remove and re-add at will was the remaining way to change what that test
--    sees. Adding a partner, or changing their gender, is now free in the
--    first hour after signup and then once every 30 days. Removing a partner
--    is always allowed — they may have asked to come off — and editing their
--    name or birthdate is unaffected (neither is used in matching).
--    Also closed: clearing your own gender and then setting a new one used to
--    skip the 30-day count from migration 30.
--
-- 3. From a final adversarial check of the above:
--    · matches_close let a member update ANY column of a match they were in —
--      including swapping the other member for someone else, who would then
--      receive messages without ever having liked them and could read the
--      earlier conversation. Members can no longer update matches at all
--      (suspension closes matches from a security definer function; the app
--      never edits them).
--    · Your own matches told a block from a suspension: a match with someone
--      who blocked you stayed open, a suspended member's was closed. Matches
--      (and so their messages) with someone hidden from you are no longer
--      shown, and undo_swipe treats a hidden person the same way every time.
--    · Blocking or reporting went straight into the tables, where a deleted
--      or made-up id failed a foreign key but a hidden one succeeded. Both now
--      go through block_member() / report_member(), which quietly do nothing
--      for an id with no profile. Your own swipes on someone hidden from you
--      are hidden the same way. Reports are no longer readable by the member
--      who filed them — "actioned" gave away a suspension; the app never
--      read them back.
--    · Known and accepted: a tournament's entry count includes entrants
--      hidden from you, and its bracket keeps every place (a hidden player is
--      shown unnamed); the draw leaves out suspended entrants. Together these
--      can hint at whether a hidden entrant blocked you or was suspended.
--      Tournaments are opt-in and public; logged in the launch checklist.

-- ---- 1. caller-scoped helpers ----
create or replace function public.i_am_suspended()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and public.is_suspended(auth.uid())
$$;

create or replace function public.hidden_from_me(p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then true
    when p_other = auth.uid() then false
    else public.is_blocked(auth.uid(), p_other)
         or not exists (select 1 from public.profiles p
                         where p.id = p_other and p.suspended_at is null)
  end
$$;

revoke all on function public.i_am_suspended() from public, anon;
revoke all on function public.hidden_from_me(uuid) from public, anon;
grant execute on function public.i_am_suspended() to authenticated;
grant execute on function public.hidden_from_me(uuid) to authenticated;

-- ---- 1. the policies, on the new helpers ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or not public.hidden_from_me(id));

drop policy if exists user_sports_select on public.user_sports;
create policy user_sports_select on public.user_sports
  for select to authenticated
  using (user_id = auth.uid() or not public.hidden_from_me(user_id));

drop policy if exists rsvps_select on public.event_rsvps;
create policy rsvps_select on public.event_rsvps
  for select to authenticated
  using (user_id = auth.uid() or not public.hidden_from_me(user_id));

drop policy if exists rsvps_write on public.event_rsvps;
create policy rsvps_write on public.event_rsvps
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not public.i_am_suspended());

drop policy if exists photos_select on public.profile_photos;
create policy photos_select on public.profile_photos
  for select to authenticated
  using (
    user_id = auth.uid()
    or (moderation_status = 'approved' and not public.hidden_from_me(user_id))
  );

drop policy if exists swipes_insert on public.swipes;
create policy swipes_insert on public.swipes
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and not public.i_am_suspended()
    and not public.hidden_from_me(target_id)
  );

-- The match's other member: the caller is one of the two (checked alongside).
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.i_am_suspended()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
        and auth.uid() in (m.user_a, m.user_b)
        and m.closed_at is null
        and not public.hidden_from_me(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
    )
  );

drop policy if exists tournament_entries_select on public.tournament_entries;
create policy tournament_entries_select on public.tournament_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or not public.hidden_from_me(user_id)
  );

-- ---- 1. and members can no longer ask the originals about anyone ----
revoke all on function public.is_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_suspended(uuid) from public, anon, authenticated;

-- ---- 2. the doubles-partner limit ----
alter table public.profiles
  add column team_updated_at timestamptz;

-- The member write guard from migration 30, plus team_updated_at as a
-- protected column and the partner rule. Everything else is unchanged.
create or replace function public.profiles_guard_member_writes()
returns trigger
language plpgsql
as $$
declare
  settled boolean;  -- past the first hour after signup
begin
  -- Only a member's own session is limited. Security definer functions run as
  -- their owner, and the service role and SQL editor are not members.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new profile starts unverified, unsuspended and with no position: the
    -- app sets the position afterwards through set_my_location().
    new.verified_at := null;
    new.phone_verified_at := null;
    new.suspended_at := null;
    new.suspended_reason := null;
    new.approx_lat := null;
    new.approx_lng := null;
    new.location_updated_at := null;
    new.gender_updated_at := null;
    new.team_updated_at := null;
    new.created_at := now();
    new.last_active_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.verified_at is distinct from old.verified_at
     or new.phone_verified_at is distinct from old.phone_verified_at
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason
     or new.created_at is distinct from old.created_at
     or new.approx_lat is distinct from old.approx_lat
     or new.approx_lng is distinct from old.approx_lng
     or new.location_updated_at is distinct from old.location_updated_at
     or new.gender_updated_at is distinct from old.gender_updated_at
     or new.team_updated_at is distinct from old.team_updated_at then
    raise exception 'That part of your profile can''t be changed from the app.' using errcode = '42501';
  end if;

  -- Your birthdate is fixed once your profile exists. Matching filters on it,
  -- so changing it at will would let a member read other people's age ranges
  -- off the deck.
  if new.birthdate is distinct from old.birthdate then
    raise exception 'Your birthdate can''t be changed in the app. If it''s wrong, email hello@40love.app and we''ll fix it.'
      using errcode = '42501';
  end if;

  settled := old.created_at < now() - interval '1 hour';

  -- Gender: freely in the first hour (a mis-tap at signup), then once every
  -- 30 days, for the same reason — the deck's "who are they looking for" test
  -- runs on it. Clearing it counts as a change too, so it can't be stepped
  -- through empty to get a second change.
  if new.gender is distinct from old.gender then
    if settled
       and old.gender_updated_at is not null
       and old.gender_updated_at > now() - interval '30 days' then
      raise exception 'You can change this once every 30 days. If it''s wrong, email hello@40love.app and we''ll fix it.'
        using errcode = '42501';
    end if;
    if settled then
      new.gender_updated_at := now();
    end if;
  end if;

  -- A doubles partner: adding one, or changing their gender, freely in the
  -- first hour and then once every 30 days. Removing one is always allowed.
  if (new.is_team and not old.is_team)
     or (new.is_team and old.is_team and new.partner_gender is distinct from old.partner_gender) then
    if settled
       and old.team_updated_at is not null
       and old.team_updated_at > now() - interval '30 days' then
      raise exception 'You can add or change a doubles partner once every 30 days. Removing one is always fine — email hello@40love.app if you need a hand.'
        using errcode = '42501';
    end if;
    if settled then
      new.team_updated_at := now();
    end if;
  end if;

  -- "Last active" means now, whatever the app sent — a date in the future
  -- would otherwise keep a profile looking active for ever.
  if new.last_active_at is distinct from old.last_active_at then
    new.last_active_at := now();
  end if;
  return new;
end
$$;

revoke all on function public.profiles_guard_member_writes() from public, anon, authenticated;

-- ---- 3. matches: no member edits; hidden counterparts not shown ----
drop policy if exists matches_close on public.matches;
revoke update on public.matches from anon, authenticated;

drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated
  using (
    auth.uid() in (user_a, user_b)
    and not public.hidden_from_me(case when user_a = auth.uid() then user_b else user_a end)
  );

-- ---- 3. your own swipes and reports ----
drop policy if exists swipes_select on public.swipes;
create policy swipes_select on public.swipes
  for select to authenticated
  using (actor_id = auth.uid() and not public.hidden_from_me(target_id));

drop policy if exists reports_select on public.reports;

-- ---- 3. undo_swipe: a hidden person is treated the same way every time ----
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

  -- Someone hidden from you (blocked either way, suspended, or gone): take
  -- your swipe back and say nothing about any match — whether one is open,
  -- closed or has messages would tell a block from a suspension.
  if public.hidden_from_me(p_target) then
    delete from swipes
    where actor_id = auth.uid() and target_id = p_target and mode = p_mode;
    return true;
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

revoke all on function public.undo_swipe(uuid, public.app_mode) from public, anon;
grant execute on function public.undo_swipe(uuid, public.app_mode) to authenticated;

-- ---- 3. blocking and reporting through functions ----
create or replace function public.block_member(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_target is null or p_target = me then
    raise exception 'That isn''t someone you can block.' using errcode = '22023';
  end if;
  -- An id with no profile: nothing to block, and no error that would say so.
  if exists (select 1 from profiles where id = p_target) then
    insert into blocks (blocker_id, blocked_id) values (me, p_target)
    on conflict do nothing;
  end if;
end
$$;

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
  if exists (select 1 from profiles where id = p_target) then
    insert into reports (reporter_id, target_id, reason, context)
    values (me, p_target, btrim(p_reason), coalesce(p_context, 'deck'));
  end if;
end
$$;

revoke all on function public.block_member(uuid) from public, anon;
revoke all on function public.report_member(uuid, text, text) from public, anon;
grant execute on function public.block_member(uuid) to authenticated;
grant execute on function public.report_member(uuid, text, text) to authenticated;

drop policy if exists blocks_insert on public.blocks;
drop policy if exists reports_insert on public.reports;
revoke insert on public.blocks from anon, authenticated;
revoke insert on public.reports from anon, authenticated;

-- 40/LOVE — deleting an account also takes the address off the waitlist
--
-- delete_account() works by deleting the auth.users row and letting foreign
-- keys cascade. That reaches every table keyed on the member's id, which is
-- almost everything — but the waitlist is keyed on an email address and has no
-- user_id at all, so it was never touched.
--
-- The account-deletion page, which Google Play requires and reads, says of
-- "Email & phone": "Deleted." Someone who joined the waitlist first and made an
-- account later would delete that account and still be on a marketing list
-- under the address they asked us to forget. That is the complaint people
-- actually make, and the page promised otherwise.
--
-- Matching on the address is the only link available. It runs before the
-- auth.users delete, because after it there is no email left to match on.

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_email text;
begin
  select lower(btrim(email)) into v_email from auth.users where id = auth.uid();

  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    delete from storage.objects
    where bucket_id = 'photos'
      and name like auth.uid()::text || '/%';
  end if;

  -- join_waitlist() lower-trims before storing, so a plain comparison is
  -- enough; lower() on both sides anyway, in case a row predates that.
  if v_email is not null and v_email <> '' then
    delete from public.waitlist where lower(email) = v_email;
  end if;

  delete from auth.users where id = auth.uid();
end
$$;

