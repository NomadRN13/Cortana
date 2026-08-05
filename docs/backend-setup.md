# 40/Love — Backend Setup (Supabase)

The backend lives in this repo as code: `supabase/migrations/` is the entire
database (tables, security rules, the matching engine), and `supabase/seed.sql`
is demo data for development. This guide takes you from zero to a live
backend in about 30 minutes, no server administration involved.

**Verified:** the schema and its behavior — match creation, the ranked
discovery deck, court-time proposals, blocking, and all row-level security
policies — pass an automated test suite against Postgres 16.

## What the backend does (plain English)

- **Accounts** — email sign-in with a one-time code (no passwords).
- **Profiles** — name, birthdate (18+ enforced by the database itself),
  sports + skill levels, photos, availability. Location is stored rounded to
  ~1 km; exact coordinates never leave the phone.
- **The deck** — one database call (`get_discovery_deck`) returns ranked
  candidates: right mode, inside each other's age ranges, within both
  radiuses, not blocked, not already swiped — scored by shared sport, skill
  adjacency (weighted double in Play mode), recency, proximity, and
  verification. Someone who "aced" you jumps to the top.
- **Matches** — the database itself creates a match the instant likes become
  mutual (or an ace lands). No app code can forge one.
- **Chat** — realtime messages, including court-time proposal cards the
  recipient can accept or decline. An accepted proposal is the "a real date
  happened" event.
- **Safety** — blocking makes two people invisible to each other everywhere,
  enforced at the database layer; reports queue for review; photos are
  hidden until approved; in-app account deletion (a store requirement) is
  one call.
- **Events & waitlist** — the Indy event calendar with RSVPs, and the
  waitlist table the landing page feeds.

## One-time setup

1. **Create the project** — [supabase.com](https://supabase.com) → New
   project (free tier). Pick a strong database password and the `us-east-1`
   region (closest to Indianapolis).

2. **Push the schema** — on your computer, from this repo:

   ```bash
   npm install -g supabase
   supabase login
   supabase init          # creates supabase/config.toml locally (keeps migrations/)
   supabase link --project-ref YOUR_PROJECT_REF   # ref is in your project's URL
   supabase db push       # applies supabase/migrations/ — the whole backend
   ```

3. **Create the photo bucket** — Dashboard → Storage → New bucket named
   `photos`, **private**. Then add two policies on the bucket: authenticated
   users can upload to a path starting with their own user id, and can read
   any file (the app only surfaces photos whose database row is approved).

4. **Turn on email sign-in** — Dashboard → Authentication → Providers →
   Email: enable "Email OTP". Leave everything else off for now.

5. **Connect the app** — in `mobile/`:

   ```bash
   cp .env.example .env   # then paste in your Project URL + anon public key
   npx expo start
   ```

   With the env vars set, `src/lib/supabase.js` reports the backend as
   configured and the API layer in `src/api/backend.js` is live. Without
   them the app keeps running in demo mode — nothing breaks.

6. **(Development only) seed demo data** — to fill your dev project with the
   12 demo players, run the contents of `supabase/seed.sql` in Dashboard →
   SQL Editor. Never run the seed against the real launch project.

## Costs

Free tier covers the alpha (500 MB database, 50k monthly active users'
worth of auth, 1 GB storage). Upgrade to Pro (~$25/mo) around the public
Indy beta for daily backups and no project pausing.

## What's deliberately NOT built yet

- **Push notifications** — the `notifications` table is the source of truth;
  wiring Expo Push tokens to it is a v1.1 task (architecture §7).
- **Admin dashboard** — at alpha volume, moderation happens in the Supabase
  dashboard directly: Table Editor → `reports` (triage), `profile_photos`
  (approve), `events` (create). A proper admin app comes later.
- **Verification selfies** — manual at MVP: mark `verified_at` in the
  dashboard after eyeballing a selfie sent during onboarding events.

## For the developer you hire

- Schema: `supabase/migrations/20260805000001_initial_schema.sql` — enums,
  tables, RLS policies, triggers (`process_swipe` derives matches), and
  RPCs (`get_discovery_deck`, `respond_court_time`, `delete_account`).
- Client surface: `mobile/src/api/backend.js` — one function per user
  action, signatures mirroring the demo state layer in `mobile/src/state.js`
  so the swap is mechanical.
- Design intent: `docs/system-architecture.md`. Store rules:
  `docs/app-store-launch.md`.
