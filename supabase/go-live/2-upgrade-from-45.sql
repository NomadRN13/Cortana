-- RSVPlay go-live: UPGRADE A LIVE PROJECT FROM MIGRATION 45 TO THE CURRENT ONE
--
-- Run 1-status.sql first. Paste this ONLY if it shows everything up to 45
-- true and everything after it false. For a fresh project, paste
-- supabase/setup.sql instead.
--
-- All or nothing: it runs inside one transaction, so if any statement fails,
-- nothing is changed and the database stays exactly as it was. Then run
-- 1-status.sql again; every row should read true.
--
-- Built from supabase/migrations/ by scripts/build-go-live.sh. Never edit by
-- hand; never run it twice.
begin;

-- ======================================================================
-- 20260806000046_city_votes.sql
-- ======================================================================
-- RSVPlay — one city vote per phone number
--
-- The "Not on the list? Tell us where you play" buttons on the website only
-- counted on the visitor's own device: tap Chicago ten times, Chicago read 10,
-- and none of it ever reached us. The founder wants a real reading of demand:
-- one person, one city.
--
-- So a vote now needs a mobile number, and each number holds exactly ONE city
-- vote. Voting again with the same number moves that vote; it never adds a
-- second one. A visitor can also type a city that isn't on the list.
--
-- Privacy, same posture as the waitlist and the phone bans:
--   · The number is never stored. Only a one-way hash of it, used to tell a
--     repeat voter from a new one. Honest limit (as in banned_phones): phone
--     numbers are a small space, so the hash is a de-duplication key, not
--     secrecy; that is why nobody but the database owner can read the table.
--   · No oracle. cast_city_vote() answers the same whether the number is new
--     or has voted before, so the page cannot be used to ask "has this number
--     voted?".
--   · Admins see totals per city through city_vote_tally(), never the rows.
--
-- Abuse: the website has no sign-in, so someone could type made-up numbers.
-- Each network address may cast at most 10 votes a day (counted by a hash of
-- the address, kept two days). Text-message verification would close that
-- fully; it costs money per vote, so it is left for later.

create table public.city_votes (
  phone_hash text primary key,
  city text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.city_votes enable row level security;
revoke all on public.city_votes from anon, authenticated;

create table public.city_vote_events (
  source_hash text not null,
  at timestamptz not null default now()
);
create index city_vote_events_idx on public.city_vote_events (source_hash, at);
alter table public.city_vote_events enable row level security;
revoke all on public.city_vote_events from anon, authenticated;

-- A US/Canada mobile number, written any way (317-555-0142, (317) 555 0142,
-- +1 317 555 0142), as 11 digits starting with 1. Null if it isn't one.
create or replace function public.normalize_vote_phone(p_phone text)
returns text language plpgsql immutable set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(d) = 10 then d := '1' || d; end if;
  if d !~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then return null; end if;
  return d;
end
$$;
revoke all on function public.normalize_vote_phone(text) from public, anon, authenticated;

create or replace function public.cast_city_vote(p_phone text, p_city text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := public.normalize_vote_phone(p_phone);
  v_city text := left(regexp_replace(btrim(coalesce(p_city, '')), '\s+', ' ', 'g'), 60);
  v_hash text;
  v_source text;
begin
  if v_phone is null then
    raise exception 'invalid phone' using errcode = '22023',
      hint = 'Enter a 10-digit US mobile number.';
  end if;
  if v_city !~ '[[:alpha:]]' or length(v_city) < 2 then
    raise exception 'invalid city' using errcode = '22023',
      hint = 'Enter the city you play in.';
  end if;

  -- Per-network limit. PostgREST hands the request headers over as a setting;
  -- the first address in X-Forwarded-For is the visitor's.
  v_source := coalesce(
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
    'unknown');
  v_source := encode(sha256(convert_to('rsvplay:votesrc:' || btrim(v_source), 'UTF8')), 'hex');
  if (select count(*) from city_vote_events
        where source_hash = v_source and at > now() - interval '24 hours') >= 10 then
    raise exception 'too many votes' using errcode = '54000',
      hint = 'Too many votes from this network today. Try again tomorrow.';
  end if;
  insert into city_vote_events (source_hash) values (v_source);
  delete from city_vote_events where at < now() - interval '2 days';

  v_hash := encode(sha256(convert_to('rsvplay:vote:' || v_phone, 'UTF8')), 'hex');
  insert into city_votes (phone_hash, city) values (v_hash, v_city)
  on conflict (phone_hash) do update
    set city = excluded.city, updated_at = now();
  -- Deliberately no indication of whether that was a first vote or a change.
end
$$;
revoke all on function public.cast_city_vote(text, text) from public;
grant execute on function public.cast_city_vote(text, text) to anon, authenticated;

-- Totals for the admin desk. Cities typed differently ("chicago", "Chicago ")
-- count together; the most common spelling is shown.
create or replace function public.city_vote_tally()
returns table (city text, votes bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
    select mode() within group (order by v.city), count(*)
    from city_votes v
    group by lower(v.city)
    order by count(*) desc, 1;
end
$$;
revoke all on function public.city_vote_tally() from public, anon;
grant execute on function public.city_vote_tally() to authenticated;

commit;
