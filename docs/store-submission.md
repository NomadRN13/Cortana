# RSVPlay — submitting to the App Store and Google Play

The one ordered list. Background and policy live in `app-store-launch.md` and
`google-play.md`; listing copy, data-safety answers and reviewer notes live in
`outreach/launch/store-listing.md`; store screenshots are in
`outreach/launch/store-screenshots/`.

**Agents prepare; you send.** Every command below that builds, uploads,
submits or touches the live database is yours to run (CLAUDE.md, rule 1).

## What is already done in the repo

- Version **1.0.0**, iOS build 1 / Android versionCode 1; EAS bumps both on
  every production build (`autoIncrement`, remote version source).
- iOS: only three permission prompts (camera, photos, location while using),
  each in RSVPlay's words; no "always" location, no microphone. Encryption is
  declared exempt, so App Store Connect stops asking on every build. The
  privacy manifest Apple requires lists the four system APIs the app's
  libraries use, with their approved reasons, and no tracking.
- Android: coarse location only. Precise and background location, microphone,
  screen overlay and old storage permissions are stripped from the build.
  Production builds are app bundles (`.aab`).
- A production build **refuses to start** without the two Supabase keys, so it
  can never reach a store in demo mode with sample players
  (`mobile/app.config.js`).
- Google sign-in's native setup is added only when its client ids are set;
  otherwise the button never shows.
- A review sign-in path (below) so App Review never needs an inbox.
- `./scripts/healthcheck.sh` pins all of the above.

## 1. Before any build (one time)

1. **Live backend.** In Supabase → SQL Editor:
   - Run `supabase/go-live/1-status.sql`. It changes nothing; it shows which
     migrations the live project already has.
   - All false (a fresh project): paste `supabase/setup.sql`.
   - Base and 30–32 true, the rest false: paste
     `supabase/go-live/2-upgrade-from-32.sql`. It is all or nothing — if a
     statement fails, nothing changes.
   - Only the last rows false (a project set up from an earlier
     `setup.sql`): paste just those migrations from `supabase/migrations/`,
     in order.
   - Anything else: send the result to Claude before pasting anything.
   - Run `1-status.sql` again; every row must read true.
   - Then deploy the push function from your computer:
     `supabase functions deploy send-push --no-verify-jwt`.
2. **Domain and pages.** `rsvplayapp.com` is bought; point it at Netlify
   and set the production branch (`docs/go-live-rename.md`). The privacy,
   terms and account-deletion pages must load there; both stores check them.
3. **Real events.** Create at least three real upcoming Indianapolis events
   from the desk. Never seed sample people into the live project — a store
   reviewer who finds invented members will reject the app, and rightly.
4. **Accounts.** Apple Developer Program ($99/yr) and Google Play Console
   ($25 once). Create the app record in each with bundle id / package
   `com.rsvplay.app`.

## 2. Link the project to EAS (one time, on your computer)

```bash
npm install -g eas-cli
```

```bash
cd mobile && eas login
```

```bash
eas init
```

`eas init` writes the project id into `app.json`; commit that change.

## 3. Give the cloud build its keys (one time)

EAS builds in the cloud and does not see `mobile/.env`. Add each value to the
**production** environment (and to **preview** for test builds):

```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_REF.supabase.co --visibility plaintext
```

```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value YOUR_ANON_KEY --visibility plaintext
```

```bash
eas env:create --environment production --name EXPO_PUBLIC_REVIEW_EMAIL --value review@rsvplayapp.com --visibility plaintext
```

Optional, for Continue with Google: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` the same way (`docs/backend-setup.md`).

Android push needs Firebase: download `google-services.json` from your
Firebase project and either put it at `mobile/google-services.json` (it is
git-ignored) or upload it as an EAS file variable named
`GOOGLE_SERVICES_JSON`. Then upload the FCM key once with
`eas credentials`. Without it the app works, but Android gets no pushes.

## 4. The App Review account (one time)

App Review cannot read an inbox, and Supabase has no fixed code for email
sign-in. So for the one address in `EXPO_PUBLIC_REVIEW_EMAIL`, the app sends
no email and checks the six digits typed at the code step as that account's
password (`mobile/src/api/backend.js`; tested in `tests/app/review.test.js`).

1. Supabase → Authentication → Users → **Add user** → email
   `review@rsvplayapp.com`, a **random six-digit** password, "Auto confirm" on.
2. Supabase → Authentication → Providers → Phone → **Test phone numbers**:
   add `+13175550100` with a fixed code, e.g. `246810`. The reviewer uses it
   at the "Prove you're real" step; no SMS is sent.
3. Put both in the reviewer notes (`store-listing.md` §3): email, the
   six digits, the test phone number and its code.
4. After approval, change the review password; the old one stops working.

The reviewer then signs up like any member: name, birthdate, the test phone,
sports, level, modes. Sign in with Apple also works for Apple's reviewers.

## 5. Build

```bash
eas build --profile production --platform all
```

The first iOS build asks to create the signing certificate and provisioning
profile; let EAS manage them. If it stops with "Production build stopped",
step 3 is incomplete.

To try a build on your own phone first:

```bash
eas build --profile preview --platform all
```

## 6. Submit

Fill `ascAppId` (App Store Connect → App → App Information → Apple ID) and
your Apple ID email in `mobile/eas.json`, and save the Play service-account
key as `mobile/play-service-account.json` (git-ignored). Then:

```bash
eas submit --platform ios --latest
```

```bash
eas submit --platform android --latest
```

Android goes to the **internal** track first. A new personal Play account must
run a closed test with at least 12 testers for 14 days before it can apply
for production (`google-play.md`).

## 7. In each console

- **Listing copy, keywords, category** — `store-listing.md` §1 and §2.
- **Screenshots** — `outreach/launch/store-screenshots/` (iPhone 6.9" set,
  1320 × 2868; Android phone set, 1080 × 2340). Feature graphic:
  `mobile/assets/play-feature-graphic.png`.
- **Privacy** — App Privacy (Apple) and Data safety (Play) answers:
  `store-listing.md`. Privacy policy URL: `https://rsvplayapp.com/privacy/`; account
  deletion URL (Play): `https://rsvplayapp.com/delete-account/`. Both must
  load before the forms are filed (`docs/go-live-rename.md`).
- **Age rating** — 18+ on both. It is a social app with opt-in dating,
  user-to-user messaging and meeting in person; members must be 18.
- **Reviewer notes** — `store-listing.md` §3, with the review account filled in.
- **Export compliance** (Apple) — already answered in the build: no
  non-exempt encryption.

## If a review comes back

Paste the rejection into a session and ask `release-manager` for a reply
draft; you send it.
