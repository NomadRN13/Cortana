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

Two paths — pick ONE:

**Path A (no terminal): the one-paste SQL.** Create the project at
[supabase.com](https://supabase.com) (free tier, strong DB password,
`us-east-1` region — closest to Indianapolis), then Dashboard → SQL Editor →
paste ALL of `supabase/setup.sql` → Run. That provisions the entire
database, the photo bucket + its policies, realtime, and push tokens in one
shot. (You'll still deploy the push function later via Path B's script or
skip push for the first alpha.)

**Path B (terminal): the script.** After creating the project:

   ```bash
   npm install -g supabase
   supabase login
   ./scripts/setup-supabase.sh YOUR_PROJECT_REF
   ```

   It links, applies every migration (schema, push tokens, realtime, photo
   bucket), deploys the push function with a generated secret, and prints
   the three remaining dashboard clicks.

Then, on either path:

4. **Turn on email sign-in** — Dashboard → Authentication → Sign In / Up →
   Email: enable. Check the "Magic Link" email template contains
   `{{ .Token }}` so the email carries the 6-digit code.

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

## The moderation desk (/admin) — make yourself an admin (one-time, ~5 minutes)

The site ships with a moderation page at `/admin` (also in the repo at
`admin/index.html`). It's where the daily trust-and-safety work happens:
**approve or reject new profile photos** (members' photos stay invisible
until approved — without this, everyone looks blank), **triage reports**
(dismiss or mark actioned), and **create events** that appear in the app.

It's safe that the page is public: every action is authorized by the
database against an `admins` list — the page itself has no special powers,
and the admin list can't be edited through the app or the page at all.

To set yourself up:

1. Open `/admin` on the deployed site, sign in with your email (same
   6-digit-code sign-in as the app). Your account now exists.
2. Supabase Dashboard → SQL Editor → run (with your real email):

   ```sql
   insert into admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```

3. Reload `/admin` — the moderation desk appears.

Also paste your project URL + anon public key into the config block at the
top of `admin/index.html` (the same two values as the landing page) before
deploying — until then the page runs in demo mode with sample data.

Warnings, suspensions, and bans still happen in the dashboard at alpha
volume; the desk records the decision (report → "mark actioned").

## Text-message (SMS) phone verification (one-time, ~15 minutes)

Onboarding asks every new member to verify a phone number by text — that's
what keeps the app real people only. The app and database are already wired;
Supabase just needs an SMS provider to actually send the texts:

1. Create a [Twilio](https://www.twilio.com) account and buy a US phone
   number (~$1.15/month).
2. In Twilio Console, note your **Account SID**, **Auth Token**, and create
   a **Messaging Service** (add the number to it) — copy its SID.
3. Supabase Dashboard → Authentication → Sign In / Up → **Phone**: enable,
   pick Twilio, paste the three values. Leave "Phone confirmations" on.
4. Test: run the app, sign up, enter your own cell number — the code should
   arrive within a few seconds.

Until this is configured, live signups will see "couldn't send the code" at
the phone step (the demo/prototype simulates the text, so it's unaffected).
Cost: about $0.008 per verification text in the US — a few dollars a month
at alpha volume.

## Costs

Free tier covers the alpha (500 MB database, 50k monthly active users'
worth of auth, 1 GB storage). Upgrade to Pro (~$25/mo) around the public
Indy beta for daily backups and no project pausing. SMS verification adds
Twilio's ~$1.15/mo number plus ~$0.008 per signup text.

## Push notifications (one-time, ~10 minutes)

Built and wired: the app registers each signed-in device's push token
(`push_tokens` table, tested), and a serverless function
(`supabase/functions/send-push`) relays every new `notifications` row —
match, message, court-time — to the recipient's phones via Expo. To turn
it on:

1. Deploy the function: `supabase functions deploy send-push --no-verify-jwt`
2. Set its secret: `supabase secrets set PUSH_WEBHOOK_SECRET=<a long random string>`
3. Dashboard → Database → Webhooks → create webhook: table
   `notifications`, event INSERT, HTTP POST to the function's URL, add
   header `x-webhook-secret` with the same secret.
4. Push credentials for store builds are handled by EAS automatically
   (`eas credentials` if prompted). Note: remote push doesn't work inside
   the Expo Go preview app — it works in EAS development/TestFlight builds;
   the code degrades silently in Expo Go.

Dead tokens (app uninstalled) are pruned automatically after a failed send.

## What's deliberately NOT built yet

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
