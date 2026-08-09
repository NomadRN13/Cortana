# 40/Love — Launch Checklist (live)

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
| 1.4 | Privacy policy + support email on the 40/Love site | in progress (today) | dev | `landing/privacy.html` exists (support email hello@40love.app inside; matches the code's actual collection). **Gaps:** no `landing/terms.html` yet; `scripts/build-site.sh` does not copy either page into `site/`, so neither is deployed at `/privacy` / `/terms`. Netlify CI (`netlify.toml`) will auto-deploy once the build script includes them. Playbook §1: budget a legal review pass before public launch (the policy's own founder-note says the same). |

## Phase 2 — Before submission (with the backend)

| # | Item | Status | Owner | Notes |
|---|------|--------|-------|-------|
| 2.1 | Real auth, matching, chat | done (code) | dev | `mobile/src/api/backend.js` + `supabase/migrations/` implement email-OTP auth, discovery deck, swipes→matches trigger, realtime chat, court-time proposals. QA round closed all blockers (`outreach/launch/bugs.md` B-01…B-19 fixed). Two items still say "verify on a real project": realtime publication (B-07) and photo upload on device (B-09). |
| 2.2 | In-app account deletion | done (code) — one gap | dev | Settings → Delete account (`mobile/src/screens/SettingsScreen.js:68-79,240`) calls the `delete_account()` RPC (initial migration). **Gap:** the RPC deletes `auth.users` (rows cascade) but does not delete photo objects from the `photos` storage bucket — orphaned binaries contradict the privacy policy's hard-delete promise and both stores' deletion declarations. Fix before filing the data forms as final. |
| 2.3 | Block + report shipped in-app | done (code) | dev | Deck: `HomeScreen.js:55-62`; chat: `ConversationScreen.js:60-67`; backend `blockUser`/`reportUser`; `blocks`/`reports` tables with RLS. Blocking is instant + mutual-filtered in the deck RPC. |
| 2.4 | Human moderation flow for reports (24h SLA) | blocked-on admin queue | dev + founder | `reports` table exists and reports land in it — but **no admin dashboard/queue exists in the repo** to review them, and nothing approves photos: `profile_photos` default to `pending` and only `approved` photos are shown to others, so on a fresh backend **no profile photo ever becomes visible**. This is both an Apple 1.2 requirement and a review-time functionality risk. Founder owns the human process (24h SLA, actions per architecture §6); dev owns the queue tooling. |
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
