# 40/LOVE — Backend Setup (Supabase)

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

5. **Connect everything** — one command wires the phone app, the website,
   and the moderation desk to your project, rebuilds `site/`, and then calls
   your database to prove the connection actually works:

   ```bash
   ./scripts/go-live.sh https://YOUR-REF.supabase.co  YOUR_ANON_PUBLIC_KEY
   ```

   Both values are in Dashboard → Settings → API. Copy the key labelled
   **anon / public**. The one below it, `service_role`, is a master key that
   ignores every security rule — the script decodes what you paste and
   refuses that one rather than publishing it to your website.

   The anon key *is* meant to be public: it appears in the app binary and in
   the website's source, and row-level security is what actually protects
   your data.

   Prefer to do it by hand? Then it's three places: `mobile/.env` (copy
   `mobile/.env.example`), and the `window.FORTYLOVE = { ... }` line near the
   top of both `landing/index.html` and `admin/index.html` — then
   `bash scripts/build-site.sh`.

   Either way, `cd mobile && npx expo start` runs the app against the live
   backend. Without the env vars the app keeps running in demo mode —
   nothing breaks.

6. **(Development only) seed demo data** — to fill your dev project with the
   12 demo players, run the contents of `supabase/seed.sql` in Dashboard →
   SQL Editor. Never run the seed against the real launch project.

## Sign in with Apple & Google (optional, but Apple is required if you ship Google)

The app offers three ways in: an email code (works today), **Sign in with
Apple**, and **Continue with Google**. The social buttons only appear once
they're configured — until then the app quietly shows just the email option,
so nothing is broken while you work through this.

**Important rule:** App Store Guideline 4.8 says that if you offer Google
sign-in, you must also offer an equivalent option that limits data collection
to name and email and lets people hide their email. Sign in with Apple is the
standard way to satisfy it. So on iPhone: **ship both, or neither.**

**Also important:** both are native features. They cannot be tested in the
Expo Go preview app — you need a development build (`eas build --profile
development`). Apple's works in Expo Go only with extra fiddling and produces
a *different* test account, so don't judge it there.

### Apple (~20 minutes, needs the paid Apple Developer account)

1. Apple Developer → Certificates, Identifiers & Profiles → Identifiers →
   `com.fortylove.app` → tick **Sign In with Apple** → Save.
2. Create a **Services ID** (Identifiers → + → Services IDs), e.g.
   `com.fortylove.web`, and a **Key** with Sign in with Apple enabled —
   download the `.p8` file, and note the Key ID and your Team ID.
3. Supabase Dashboard → Authentication → Sign In / Up → **Apple**: enable it.
   In **Client IDs** put `com.fortylove.app` (the app) — add the Services ID
   too if you ever add web sign-in, and put the Services ID *first* if so.
   Fill the secret fields from the `.p8` key.
4. If you email your members, register your sending domain under Apple
   Developer → Services → **Sign in with Apple for Email Communication**.
   Apple users can choose "Hide My Email", which gives you a
   `…@privaterelay.appleid.com` address — real and deliverable, but mail is
   dropped if your domain isn't registered.
5. **Deploy the revocation function.** Apple requires (Guideline 5.1.1(v))
   that deleting an account also revokes the Apple tokens issued for it —
   otherwise 40/LOVE keeps showing up under the member's *Apps Using Apple ID*
   for an account that no longer exists. **Reviewers check this**, so an iOS
   build with Sign in with Apple and without it can be rejected.

   ```bash
   supabase functions deploy apple-auth
   supabase secrets set \
     APPLE_TEAM_ID=YOUR_TEAM_ID \
     APPLE_KEY_ID=YOUR_KEY_ID \
     APPLE_CLIENT_ID=com.fortylove.app \
     APPLE_PRIVATE_KEY="$(cat AuthKey_YOUR_KEY_ID.p8)"
   ```

   That's the same `.p8` key, Key ID and Team ID from step 2. Until the
   secrets are set the function answers "not configured" and does nothing —
   sign-in and account deletion both keep working, so you can ship the
   Android build and come back to this.

   How it works: Apple's authorization code is only valid for about five
   minutes, so the app trades it for a long-lived refresh token the moment
   someone signs in, and parks that token in `apple_identities` — a table with
   row-level security on and deliberately *no* policies, so nothing reachable
   through the API can read it, not even an admin. Deleting an account hands
   the token back to Apple first, then wipes the row.

### Google (~20 minutes, free)

1. [Google Cloud Console](https://console.cloud.google.com) → create a
   project → APIs & Services → **OAuth consent screen**: External, fill in the
   app name, support email, and your privacy-policy URL. **Publish it** —
   while it's in "Testing", only accounts you list can sign in.
2. Credentials → Create credentials → OAuth client ID, **three times**:
   - **Web** — this one's ID is the token audience on Android. Add
     `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as an authorized
     redirect URI.
   - **Android** — package name `com.fortylove.app` plus the SHA-1
     fingerprint from `eas credentials` → Android → Keystore.
   - **iOS** — bundle ID `com.fortylove.app`.
3. Supabase Dashboard → Authentication → Sign In / Up → **Google**: enable,
   paste the **Web** client ID and secret, and add the **iOS** client ID to
   the additional Client IDs field. Turn **Skip nonce check** ON (the native
   Google SDK doesn't send one).
4. In `mobile/.env`, set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. The button appears once they're set.
5. For Google on **iPhone** only, add this to `mobile/app.json`'s `plugins`
   array, using your **iOS** client ID with its two halves swapped
   (`123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`):

   ```json
   ["@react-native-google-signin/google-signin",
    { "iosUrlScheme": "com.googleusercontent.apps.YOUR-IOS-CLIENT-ID" }]
   ```

   Get this wrong and the iPhone build fails at build time (or, if you paste
   the *Web* ID by mistake, fails only at runtime on iPhone).

### The one that bites everyone, later

After you ship through Google Play, Play re-signs your app with a different
key, so Google sign-in works in testing and then fails in production with
"DEVELOPER_ERROR". Fix it *before* launch: Play Console → your app → Test and
release → App integrity → **App signing key certificate** → copy that SHA-1
and add it to the same Google Cloud **Android** OAuth client. Keep both
fingerprints there.

### Two things to know about accounts

- Someone who joined with an email code and later taps "Sign in with Apple"
  with Hide My Email will land in a **separate account** with an empty
  profile — Supabase can only merge accounts when the email addresses match.
  If members report "my account disappeared", this is why.
- Apple gives you the person's name **once**, on their very first sign-in.
  The app captures it and prefills onboarding; there's no way to ask Apple
  again later.

## Opening a city

40/LOVE is open in 11 metros: Indianapolis, Los Angeles, San Diego, Phoenix,
Seattle, Spokane, Dallas, Houston, Orlando, Miami, and Washington, DC.
Members pick their city at signup (pre-selected from their approximate
location) and only ever match with players in it — a dating app is only as
good as who's actually nearby.

The city list lives in the `cities` table. To open another one, add a row
(Dashboard → SQL Editor):

```sql
insert into cities (slug, name, state, lat, lng, metro_radius_mi, launched, sort_order)
values ('austin', 'Austin', 'TX', 30.267, -97.743, 40, true, 120);
```

Then add the same entry to `mobile/src/data/cities.js` and the city lists in
`app/index.html`, `admin/index.html`, and `landing/index.html`, and ship an
app update. The database is the authority — its foreign key rejects any city
the app invents.

**A word of caution about opening eleven at once.** Density, not coverage, is
what makes a dating app work: 200 players in one city beats 2,000 spread
across eleven, because everyone in the thin cities opens the app, sees three
people, and leaves. The code supports every city equally; the community
doesn't build itself. Consider putting real recruiting effort behind two or
three at a time — the mixer playbook in `outreach/` is written for exactly
that — and letting the rest fill in from the waitlist.

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
