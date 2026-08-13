# 40/LOVE — Launch Checklist (live)

Maintained by the Release Manager agent. Source of truth for "what's blocking
launch?". Every item from `docs/app-store-launch.md` §7, statused against the
repo — nothing is marked done on assumption; evidence is cited.

Last updated: 2026-08-09 · App version: 0.1.0 (`mobile/app.json`)

**Status legend:** `done` (evidence in repo) · `in progress` · `not started` ·
`blocked-on <thing>`. **Owner:** founder · dev · agent.

## Phase 1 — Today (no backend needed)

| # | Item | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 1.1 | Run the demo on your phone with Expo Go (`mobile/README.md`) | not started (unconfirmed) | founder | 5 minutes, free. No way to verify from the repo — founder to confirm. |
| 1.2 | Request D-U-N-S number (if launching as an LLC) | not started (unconfirmed) | founder | Only needed for company enrollment with Apple; free but slow — request first. Individual enrollment skips this and can migrate later (playbook §1). |
| 1.3 | Enroll: Apple Developer ($99/yr) + Google Play Console ($25) + Expo account | not started (unconfirmed) | founder | Longest lead time in the whole plan (1–2 days Apple, up to 2 weeks as a company; 1–3 days Play). Play note: new personal accounts must run a closed test with 12+ testers for 14 days before production — the mixer alpha satisfies this (playbook §1). |
| 1.4 | Privacy policy + support email on the 40/LOVE site | in progress (today) | dev | `landing/privacy.html` exists (support email hello@40love.app inside; matches the code's actual collection). **Gaps:** no `landing/terms.html` yet; `scripts/build-site.sh` does not copy either page into `site/`, so neither is deployed at `/privacy` / `/terms`. Netlify CI (`netlify.toml`) will auto-deploy once the build script includes them. Playbook §1: budget a legal review pass before public launch (the policy's own founder-note says the same). |

## Phase 2 — Before submission (with the backend)

| # | Item | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 2.1 | Real auth, matching, chat | done (code) | dev | `mobile/src/api/backend.js` + `supabase/migrations/` implement email-OTP auth, discovery deck, swipes→matches trigger, realtime chat, court-time proposals. QA round closed all blockers (`outreach/launch/bugs.md` B-01…B-19 fixed). Two items still say "verify on a real project": realtime publication (B-07) and photo upload on device (B-09). |
| 2.2 | In-app account deletion | done (code) — one gap | dev | Settings → Delete account (`mobile/src/screens/SettingsScreen.js:68-79,240`) calls the `delete_account()` RPC (initial migration). **Gap:** the RPC deletes `auth.users` (rows cascade) but does not delete photo objects from the `photos` storage bucket — orphaned binaries contradict the privacy policy's hard-delete promise and both stores' deletion declarations. Fix before filing the data forms as final. |
| 2.3 | Block + report shipped in-app | done (code) | dev | Deck: `HomeScreen.js:55-62`; chat: `ConversationScreen.js:60-67`; backend `blockUser`/`reportUser`; `blocks`/`reports` tables with RLS. Blocking is instant + mutual-filtered in the deck RPC. |
| 2.4 | Human moderation flow for reports (24h SLA) | done (code) — see update below | dev + founder | Moderation desk shipped at `/admin` (`admin/index.html` + migration `20260806000008`): photo approve/reject, report triage, event creation — all authorized by DB-side admin policies, harness-tested. Founder one-time step: add yourself to the `admins` list (`docs/backend-setup.md`). Founder owns the human process (24h SLA); suspend/ban actions stay in the dashboard at alpha volume. |
| 2.5 | `eas init` (real project ID) + fill `eas.json` placeholders | not started | dev | `mobile/app.json` still has `projectId: REPLACE_AFTER_RUNNING_eas_init`; `mobile/eas.json` still has `REPLACE_WITH_YOUR_APPLE_ID_EMAIL` / `REPLACE_WITH_APP_STORE_CONNECT_APP_ID` and expects `./play-service-account.json`. Blocked on 1.3 (accounts). Agent never runs eas commands. |
| 2.6 | Store descriptions, keywords, categories | done (draft) | agent | Full copy pack in `outreach/launch/store-listing.md` — founder review for tone + facts. |
| 2.7 | App Privacy (Apple) + Data Safety (Play) form answers | done (draft) | agent | Drafted strictly from `backend.js` + migrations in `store-listing.md`. Must be re-filed if the app ever collects anything new (analytics SDK, phone numbers, precise location…). File only after 2.2's storage-purge gap is fixed, or the deletion answers overstate reality. |
| 2.8 | Screenshots (5–8 per platform) + Play feature graphic (1024×500) | blocked-on device build | founder + dev | Need the real app on device (iPhone 6.7" and 6.5" for Apple; phone + optional tablet for Play). Icon set is already generated: `mobile/assets/icon.png`, `adaptive-icon.png`, `splash-icon.png` (referenced by `app.json`). |
| 2.9 | Seeded reviewer account + review notes | notes drafted; account blocked-on live backend | dev | Review notes drafted in `store-listing.md` (credentials [FILL IN]). Needs: a review account pre-seeded with profiles in range of Indianapolis, and an OTP answer — email-code sign-in means the reviewer needs a real inbox or a fixed test code (suggestion in the notes). |
| 2.10 | TestFlight + Play closed test with mixer attendees (14+ days) | blocked-on 1.3, 2.5 | founder + dev | Doubles as Play's mandatory 12-tester/14-day test. Invite by email list from the mixer. |

## Phase 3 — Launch

| # | Item | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 3.1 | Promote tested build to production on both stores | not started | founder | Founder (or dev) pulls the trigger in both consoles — the agent never runs store-facing commands. |
| 3.2 | Waitlist email: "We're live in Indianapolis" | not started | founder + agent | Agent can draft when a launch date exists. Dates come from the founder. |

## Already verified in the repo (no action needed)

- App icons + splash generated and wired (`mobile/assets/`, `mobile/app.json`).
- Permission strings honest and minimal (`app.json`: photos, camera, coarse
  location only — "Your exact location is never stored").
- Netlify CI deploys the site on every push (`netlify.toml` → `scripts/build-site.sh`).
- 18+ enforced at signup client-side and by DB constraint (`profiles.birthdate` check).
- Coarse-location promise is real: client rounds to 2 decimals (~1 km) before
  upload (`backend.js` `upsertMyProfile`); columns are `numeric(5,2)`.
- No analytics, ad, or tracking SDKs in `mobile/package.json`.

## The 3 highest-leverage next actions

1. **Founder — start all three account enrollments today (1.2, 1.3).** Apple
   Developer, Google Play Console, Expo. It's the longest lead time on the
   critical path (up to 2 weeks for company enrollment), it costs ~$124, and
   items 2.5, 2.9, 2.10, and 3.1 all block on it. Decide LLC-vs-individual
   enrollment now; if LLC, request the D-U-N-S number first.
2. **Dev — publish `/privacy` and `/terms` (1.4).** Write `landing/terms.html`,
   make `scripts/build-site.sh` copy both pages into `site/`, push (Netlify
   auto-deploys). Both store consoles demand a live privacy-policy URL before
   you can even complete the listing; for a dating app it's checked, not
   optional (playbook §1).
3. **Dev + founder — stand up the moderation path (2.4) and close the deletion
   gap (2.2).** A minimal admin queue that (a) reviews reports and (b) approves
   photos is required for Apple 1.2 and for the app to even look right at
   review time (photos stay invisible until approved). While in there, make
   `delete_account()` purge the user's storage objects so the privacy forms
   and policy stay honest.

## Update — 2026-08-09 (post-review fixes)

- **Privacy policy + terms are LIVE** at `/privacy` and `/terms` on the
  deployed site (pages committed, build script publishes them, footer links
  added) — the "not actually live" finding above is resolved.
- **Deletion gap fixed:** `delete_account()` now purges the user's photo
  objects from storage (migration `20260806000006`). Verify once against the
  live project.
- **Photo-read policy tightened:** others' photos are readable only with an
  APPROVED `profile_photos` row; own photos always (same migration). The
  manual approval step (dashboard → profile_photos → approve) is the
  moderation queue at alpha volume — remember it for the reviewer account's
  photos before submission.

## Update — 2026-08-09 (SMS phone verification added)

- **Phone verification shipped (code):** onboarding now requires a one-time
  SMS code before a profile can be created (mobile step 2 of 5; prototype
  simulates the text). Backend: `profiles.phone_verified_at` +
  `sync_phone_verification()` RPC (migration `20260806000007`), which only
  trusts auth's own `phone_confirmed_at` — the client cannot fake it.
- **New founder setup item (blocks live signups):** configure Twilio as the
  SMS provider in Supabase — Dashboard → Authentication → Sign In / Up →
  Phone. Steps + costs (~$1.15/mo number, ~$0.008/text) in
  `docs/backend-setup.md`. Until configured, live signups stall at the
  phone step; the demo is unaffected.
- **Privacy paperwork updated:** phone number added to the privacy policy's
  "What we collect", the Apple App Privacy table, and the Play Data Safety
  table (`store-listing.md`) — it moved OFF both "not collected" lists.
  Reviewer notes now flag that the review account must have a pre-verified
  phone or a Supabase test-phone fixed OTP.

## Update — 2026-08-09 (moderation desk shipped — item 2.4 unblocked)

- **Item 2.4 (human moderation flow) is now `done (code)`:** the site ships
  a moderation desk at `/admin` (`admin/index.html`) — photo approvals
  (fixes the "no photo ever becomes visible" trap), report triage with a
  24h-SLA framing, and event creation. Backed by migration
  `20260806000008_admin.sql`: an `admins` table invisible to the API,
  an `is_admin()` check, and admin RLS policies (photos any-status +
  update, reports read/update, profiles read, events write, storage read).
  Verified by the SQL harness: non-admins can't see pending photos, read
  others' reports, or create events; admins can, and the admins table
  stays unreadable even to admins.
- **Founder one-time step:** sign in at `/admin` once, then run the
  one-line SQL in `docs/backend-setup.md` to put yourself on the admin
  list. Until the Supabase keys are pasted into the page, `/admin` runs in
  demo mode with sample data — you can try the workflow today.
- Warnings/suspensions/bans remain dashboard actions at alpha volume; the
  desk records the decision. A fuller admin app stays on the roadmap.

## Update — 2026-08-09 (multi-photo profiles shipped)

- **Members now manage up to 6 photos** (Profile → Photos grid: add,
  remove, make-main) and **approved photos actually display in live mode**
  — deck cards, the profile detail sheet (with a thumbnail strip), match
  lists, and chat headers all show real photos, falling back to initials.
  Backed by migration `20260806000009`: reorder/delete RPCs (deferrable
  position constraint, storage cleanup, no gaps) and unique per-upload
  filenames.
- **Security fix shipped in the same migration:** the original photos
  policy let a member write their own `moderation_status` — i.e.
  self-approve a photo past the moderation queue. A DB trigger now forces
  every member-written photo to `pending`; only admins can approve/reject,
  and replacing an image file re-enters the queue. Harness-tested (smuggled
  'approved' on insert is neutralized; explicit self-approval raises).
- Test 5 in the beta plan updated for the grid + the founder approval loop
  through `/admin`.

## Update — 2026-08-09 (polish: real rewind, honest stats)

- **Rewind works in live mode** (migration `20260806000010`): takes back
  the last swipe so the card returns; an unmessaged brand-new match
  dissolves (their like still stands — re-liking re-matches instantly) and
  its notifications are cleaned up. Matches with a conversation are never
  deleted — the server refuses and the app explains. Harness-tested.
- **Fake "Rallies: 128" profile stat removed** (both apps) — replaced with
  the member's real Saved-players count. No made-up numbers shown to users.

## Update — 2026-08-09 (stay signed in + remembered devices)

- **Signing in now sticks properly.** The app decided Welcome-vs-Main from
  local storage alone, so a phone that still held a valid session but had
  lost its cached profile (reinstall, cleared storage, or simply a second
  device) was treated as a stranger and sent back to the welcome screen.
  It now waits for the session check and rebuilds the profile from the
  server. The mirror-image bug is fixed too: with the backend live and the
  session gone, "Continue as <name>" used to walk into an app where every
  request failed — it now routes to sign-in.
- **The account remembers its devices** (migration 15). Settings → Devices
  lists every phone signed in, which one you're holding, and when each was
  last used — and any of them can be signed out. For a dating app that's a
  safety feature, not a convenience: phones get lost, and relationships end
  with someone else knowing the passcode.
- **Revocation is real, not cosmetic.** The revoked device's push tokens are
  deleted immediately (push_tokens gained a `device_key` so they can be
  traced to a device at all), `touch_device()` returns false for it, and the
  app signs itself out when it sees that. A revoked device that never
  reconnects stays usable until its token expires — that's an honest limit
  of JWT sessions, and the in-app copy says so rather than overpromising.
  Harness-tested, including that a revoked device cannot quietly
  re-register and that one member cannot revoke another's device.
- **The device identifier is deliberately not a hardware one** — Apple and
  Google restrict those and we don't need one. It's a random tag the app
  mints for itself and erases on uninstall. Privacy policy and both store
  data forms updated accordingly.

## Update — 2026-08-09 (multi-city: 11 metros)

- **40/LOVE is no longer Indianapolis-only.** Open in Indianapolis, Los
  Angeles, San Diego, Phoenix, Seattle, Spokane, Dallas, Houston, Orlando,
  Miami, and Washington, DC (migration 14). "Indianapolis" was a hardcoded
  default in four places; it's now a `cities` table with a foreign key, so a
  typo can't create a ghost city nobody can be matched in.
- **Members pick a city at signup**, pre-selected from their approximate
  location, changeable in Settings. If they're outside every metro we say so
  and point them at the waitlist rather than guessing.
- **Matching is city-scoped**, which also closed a real leak: a member who
  denied location has no distance, and the deck deliberately keeps those
  people visible — so without a city scope, a Miami member with location off
  would have been shown to someone in Seattle. Harness-tested.
- **Founder note — assumption to confirm:** "Washington" in the request was
  read as **Washington, DC**, since Seattle and Spokane were already listed
  separately. If you meant Washington *state*, say so and I'll drop DC — it's
  one row.
- **Founder note — density beats coverage.** The code treats all 11 equally,
  but a dating app lives on local density: 200 players in one city beats
  2,000 spread across eleven, because everyone in the thin cities opens the
  app, sees three people, and never comes back. Recommend real recruiting
  behind two or three at a time and letting the rest fill from the waitlist.
  The Indy outreach pack and mixer playbook are the template; equivalents
  don't exist for the other ten yet.
- Updated: landing page (11-city list, city on the waitlist form, "vote for
  yours" now lists un-launched cities), admin event form (city selector),
  store listing (description, promo text, keywords, reviewer notes),
  `docs/backend-setup.md` (how to open city #12).

## Update — 2026-08-09 (doubles teams + top picks)

- **Doubles team profiles (migration 13):** two people can share one
  profile — both names and ages on the card, one inbox. Deliberate limits,
  all enforced in the database rather than only in the UI:
  - exactly two people (`partner_*` columns, not a join table);
  - **teams cannot use Date mode** — a shared profile can't date, and you
    can't verify who you're talking to. Check constraint, not just hidden UI;
  - both people must be 18+;
  - the partner is *described*, not enrolled — no second login. The account
    holder stays accountable, which keeps reports/blocks/bans meaningful.
- **Team matching is stricter, on purpose:** a preference applies to every
  person on a team. "Doubles with women" plus a man-and-woman team is not a
  fit, because you'd be playing with a man too. Enforced both directions by
  `team_pref_ok()`; harness-tested.
- **Top picks:** Home now shows up to five ranked picks with the reason each
  was chosen ("Also plays Padel", "Tennis at your level — an even match").
  It reads the existing matching score rather than inventing a second
  algorithm, so the ranking that already drove the deck is finally visible.
- **Safety/legal note for the founder:** a team profile publishes a second
  person's first name, age, and gender. The onboarding copy tells the
  account holder to ask permission first, but if you later add photos of
  the partner, revisit the privacy policy — that's someone else's likeness.

## Update — 2026-08-09 (Sign in with Apple + Google)

- **Shipped (code):** three passwordless ways in — emailed code, Sign in with
  Apple (native, with the nonce Apple requires), Continue with Google
  (native). Both social buttons self-disable when their SDK or config is
  absent, so Expo Go and demo mode are unaffected.
- **NEW HARD DEPENDENCY — a development build.** Both providers are native
  modules. Expo Go can no longer exercise sign-in. Item 1.1 ("run the demo
  in Expo Go") still works for everything else, but sign-in testing now needs
  `eas build --profile development`, which needs `eas init` (item 2.5).
- **NEW RELEASE BLOCKER (Apple 4.8):** shipping Google sign-in on iOS without
  Sign in with Apple is a rejection. Both are wired; the blocker is
  *configuration* — the Apple capability + Services ID + key, and the three
  Google OAuth clients. Walkthrough in `docs/backend-setup.md`. Cheap
  alternative if you want to defer Apple's setup: ship Google on **Android
  only** and leave iOS with email codes, which never triggers 4.8.
- **NEW RELEASE BLOCKER (Apple 5.1.1(v)):** an app that supports Sign in with
  Apple must **revoke the Apple token** when the member deletes their
  account. Our `delete_account()` deletes the row but does not call Apple's
  revoke endpoint. Needs a small edge function holding the Apple key before
  the first iOS submission that includes Sign in with Apple.
- **Play Data Safety gap surfaced (pre-existing, now unavoidable):** Play
  requires a **web-accessible account-deletion URL** in addition to the
  in-app button. No such page exists on the site yet.
- **Both privacy forms must be re-filed** before the release that adds OAuth
  — not because new data types appear, but because the SDK inventory and the
  collection route change. `store-listing.md` updated: tracking justification
  rewritten (it claimed Supabase was the only network destination), email/user
  ID rows annotated, a Play "User IDs" row added, reviewer notes list all
  three sign-in paths.
- **Privacy policy updated** (`landing/privacy.html`): names Apple and Google
  as identity providers, explains the Apple private-relay address, and
  discloses plainly that the provider necessarily learns the member signed in
  to a dating app — with the emailed-code route offered as the private
  alternative.
- **Account-merge caveat to expect in support:** a member who joined by email
  code and later taps Sign in with Apple with "Hide My Email" gets a *second*
  account with an empty profile. Supabase can only link identities when the
  verified emails match. Documented in `docs/backend-setup.md`.

## Update — 2026-08-09 (chat polish: B-14 + B-21 closed)

- **Read receipts (B-14):** your last message shows "Read ✓" once your
  match has opened the chat; unread dots in the chat list are now computed
  from real read state. Marking read goes through a scoped RPC
  (migration `20260806000011`) — which also **fixes a security hole**: the
  old policy would have let a match member rewrite the other person's
  message text via a direct update. Direct message updates are now
  impossible; harness-tested.
- **Live Match Point for the first liker (B-21):** the `notifications`
  table joined the realtime publication; the app subscribes to its own
  notification stream, so when someone you liked earlier likes you back,
  the full-screen celebration appears on YOUR phone within seconds — not
  just theirs. Deduped so the second liker doesn't see it twice. Message
  notifications also refresh the chat list live when a message lands
  outside the open conversation.
- Beta test plan updated: Test 8 now expects the live first-liker pop-up;
  Test 9 grew a read-receipt check. Bug tracker: B-14, B-21 → Fixed.

## Update — 2026-08-13 (one-command go-live + signup order fix)

- **`./scripts/go-live.sh <project-url> <anon-key>` connects everything.**
  It writes `mobile/.env`, patches the `window.FORTYLOVE` config line in
  both `landing/index.html` and `admin/index.html`, rebuilds `site/`, and
  then calls your project's `cities` table to prove the connection works —
  rather than leaving you to discover a typo from a blank app later. It
  reports separately on a wrong URL, a rejected key, and a project whose
  database hasn't been applied yet.
- **It refuses the `service_role` key.** That key sits directly under the
  anon key in the dashboard, looks identical, and bypasses every security
  rule; pasting it into the website would hand every visitor full read/write
  access to every table. The script decodes the token's role claim and stops.
- **Founder path to live is now four steps:** create the Supabase project →
  apply the database (paste `supabase/setup.sql`, or run
  `scripts/setup-supabase.sh`) → run `go-live.sh` → turn on email sign-in.
  Then the two that gate real signups: add yourself to `admins`, and add
  Twilio for the SMS step. `docs/backend-setup.md` step 5 rewritten around
  this.
- **Signup order fixed:** the "playing as a pair?" toggle had been pushed
  below the fold on the first onboarding step by the 11-city chip list, so
  it read as missing. The city picker is now a dropdown and the team toggle
  sits above it — the whole step fits one phone screen again. Same order in
  the app (`OnboardingScreen.js`) and the prototype.
- **Logo is a shaded pickleball**, not a flat disc: lit from the upper left,
  holes dark at the top with a little bounce light at the bottom, specular
  highlight on the surface. Applied to the wordmark on the site, the
  prototype, the in-app component, and all three store icons.

## Update — 2026-08-13 (deletion page, deletion purge, committed test suite)

- **Play's account-deletion URL requirement is closed.** Google Play requires
  a publicly reachable page where someone can request deletion *without*
  installing the app; the in-app button alone does not satisfy it.
  `landing/delete-account.html` ships at `/delete-account/`, is linked from
  the footer and the privacy policy, and is now in `scripts/build-site.sh`.
  The URL is recorded in `store-listing.md` for the Data Safety form.
- **Photos are now actually deleted, not just unlinked.** `delete_account()`
  removed the rows from `storage.objects`, which makes a photo unreachable —
  but the image file itself survived in the bucket, which the privacy policy
  says does not happen. `deleteAccount()` now removes the files through the
  Storage API first (the only call that deletes bytes), then calls the RPC,
  which still guarantees nothing points at them if that half fails.
- **The backend suite is in the repo.** It had been living in a temp
  directory, which made "verified by an automated test suite" true only until
  the machine was wiped. `supabase/tests/backend.sql` + `./scripts/test-backend.sh`
  spin up a throwaway Postgres, apply all 16 migrations and the seed, and
  assert. New coverage: the photo storage policies (you can write and delete
  only inside your own folder; another member's photo is readable only once
  approved), and account deletion checked table by table against every row of
  the deletion page's promises — verified to fail when the purge is removed.

### Two copy claims corrected (both would have been false at launch)

- The privacy policy said the phone number was kept "to keep banned accounts
  from returning". There is no ban list, no retained numbers, and
  `delete_account()` removes the number with everything else — so the claim
  described a feature that does not exist, and it had been carried into the
  Play Data Safety draft as "ban enforcement". Both now describe what the
  code does: a one-time check that a new member is a real person.
- **Founder decision, not yet made:** whether to *build* that. Today a member
  who is reported can delete their account and sign up again with the same
  number, and the reports against them are deleted too (`reports.reporter_id`
  and `target_id` both cascade). Retaining a hash of banned numbers would
  close it, but it is new retained data — it would need to go into the
  privacy policy and both store forms before shipping.

## Update — 2026-08-13 (Apple token revocation — last dev-side blocker)

- **Guideline 5.1.1(v) is implemented.** Apple requires that deleting an
  account also revokes the tokens Apple issued for it; reviewers check, and an
  iOS build shipping Sign in with Apple without it can be rejected. The catch
  is that the only revocable credential comes from the authorization code
  Apple hands over at sign-in, which expires in about five minutes — so it is
  exchanged immediately for a refresh token and parked until deletion.
  - `supabase/functions/apple-auth` — one function, two actions (`link` at
    sign-in, `revoke` before deletion). Authenticates the caller from their own
    JWT, never from the request body, so one member cannot revoke another's.
    Signs Apple's ES256 client secret with the `.p8` key at call time.
  - `20260806000016_apple_identities.sql` — the token store. RLS on, **no
    policies at all**: nothing reachable through the API can read it, not even
    an admin. Asserted three ways in the suite (member, owner, admin), and
    the assertion is verified to fail if a policy is ever added.
  - Both halves are best-effort by design. Linking failing leaves the member
    signed in; revoking failing still deletes the account. Someone who asked
    to be deleted is never held hostage by Apple's endpoint being down.
- **Founder step, before the first iOS submission with Sign in with Apple:**
  `supabase functions deploy apple-auth` plus four `APPLE_*` secrets
  (`docs/backend-setup.md`). Unset, the function reports "not configured" and
  no-ops — so the Android build can ship without any of this.

### Where launch stands

Nothing dev-side is blocking any more. Everything remaining needs an account,
a device or a card:

| Blocker | Who | Why it can't be done here |
|---|---|---|
| Create the Supabase project, run `go-live.sh` | founder | Needs their account and a DB password |
| Apple Developer ($99), Play Console ($25), Expo | founder | Paid enrollments, 1–14 days lead time |
| Twilio for the SMS step | founder | Live signups stall at phone verification without it |
| `eas init`, fill `eas.json` | dev, after accounts exist | Agents never run eas commands |
| Screenshots, Play feature graphic | founder | Needs the real app on a real device |
| File both privacy forms | founder | Drafts are ready in `store-listing.md` |

## Update — 2026-08-13 (waitlist membership oracle closed)

- **Anyone could test whether a given email was on the waitlist.** The landing
  page POSTed straight to the `waitlist` table using the anon key — which is
  public by design, it ships in the page source. `email` is UNIQUE, so a repeat
  address came back `409` instead of `201`, and the page said it out loud:
  *"You're already on the list."* Feed it an address, learn whether that person
  signed up for a dating app; feed it a list, learn it about all of them.
- **Fixed by making both outcomes identical.** `join_waitlist()` (migration
  `20260806000017`) is a security-definer RPC that normalises the address,
  `on conflict do nothing`s, and returns the same thing either way. The insert
  policy is dropped, so RLS refuses direct writes and the RPC is the only door.
  The page shows one message now, not two.
- **Asserted, not assumed:** the suite now sweeps everything the anon key can
  reach — fourteen tables must return zero rows, `cities` must be readable
  (the city picker needs it) and `events` must not be. Verified to fail when a
  read policy is added to `profiles`.
- **Privacy policy gap closed alongside it:** the policy is scoped to "the app
  and the website" but described only app data. It now says what the waitlist
  form collects, what it is used for, and that membership is not disclosable.
- **Known and accepted:** `join_waitlist` has no rate limit, so the list can
  still be padded with junk addresses. That was equally true of the direct
  insert it replaces. Supabase's gateway does some throttling; if the list gets
  spammed, a captcha on the form is the usual next step.
