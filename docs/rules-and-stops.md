# RSVPlay — Rules, hard stops and soft stops

Everything the kit refuses to do, asks before doing, or holds a human to,
in one place. Transferred intact from the 40/Love kit on 2026-11-13; nothing
was loosened in the rename, and the 2026-11-13 additions only add stops. A **hard stop** is enforced by code (the
database, the app, a script) and cannot be talked around. A **soft stop** is
a confirmation, a warning, or a rule a person or an agent follows. Each entry
names where it lives, so it can be verified rather than trusted.

Verify the hard stops at any time with `./scripts/test.sh` (backend, app and
web suites). The backend suite asserts most of the database stops directly,
including that a non-member, an anonymous key, or a blocked member CANNOT do
the thing.

## 1. The golden rules

| Rule | Kind | Where |
|---|---|---|
| Humans send, agents draft. No agent sends an email, DM, post, invite or store submission; they produce drafts (Gmail drafts, Buffer ideas, files in `outreach/`). | soft (agent) | every agent in `.claude/agents/`, `docs/networking-team.md` |
| Nothing is published, scheduled or submitted without the founder's explicit approval of that specific batch in the conversation. | soft (agent) | `social-content`, `release-manager`, `club-partnerships`, `waitlist-community` |
| Agents never run `supabase db push`, `eas build`, `eas submit` or any store-facing command. The founder or their developer pulls every trigger. | soft (agent) | `backend-engineer`, `release-manager` |
| Agents commit only when asked, and never push on their own. | soft (agent) | all agents |
| Real people only: every member verifies a phone number by one-time text before finishing signup, and the database refuses swipes, messages, RSVPs, tournament entries and ladder joins without it. | hard | migrations `20260806000007` and `20260806000039`, `OnboardingScreen.js` ("Almost there") |
| 18 and over, no exceptions; teams count as two adults. | hard + soft | DB check `birthdate <= today − 18 years` (`20260805000001`), alerts in `OnboardingScreen.js` / `SettingsScreen.js`, store rating Mature 17+ |

## 2. Hard stops the database enforces

Every table has row-level security; policies are listed in
`supabase/setup.sql` (rebuilt from `supabase/migrations/`, checked by
`scripts/build-setup-sql.sh --check`). The stops a member actually hits:

### Identity and account
- **Birthdate is fixed once the profile exists** ("Your birthdate can't be changed here") — `20260806000031`.
- **Gender changes freely for the first hour, then once every 30 days** — `20260806000031`.
- **A doubles partner can be added or changed once every 30 days**; removing one is always allowed — `20260806000031`.
- **Members cannot write their own verification, suspension, created_at, or position**; the `profiles_guard_member_writes` trigger refuses it. Only owner-run functions (`suspend_member`, `sync_phone_verification`, `set_my_location`) may — `20260806000030`/`31`.
- **Suspended members get an empty deck and refused writes** ("Your account is suspended.") and are withdrawn from tournaments by trigger `profiles_suspension_withdraws` — `20260806000023`, `20260806000032`.
- **Account deletion is a hard delete** of profile, photos, messages and matches. Nothing about the phone is kept for a member in good standing; if the account was banned (`ban_member`) or is suspended when it is deleted, a hash of its number stays on the ban list so the ban sticks, until the project owner lifts it (`unban_phone`, not callable through the API) — `delete_account()` in `20260806000041`, `20260806000034`.
- **Nothing signed-out can read a member**: `get_profile_cards` revoked from `anon`; only `id` and `first_name` are readable column-by-column; everything else comes through functions that decide what to hand over — `20260806000030`.

### Location (the privacy design, see also §4)
- **Coordinates are rounded to 2 decimals (~1 km) on the phone before they leave it**, and the server rounds again — `mobile/src/lib/location.js`, `set_my_location()`.
- **Position can only be set through `set_my_location()`**; the row refuses direct writes. It rejects anything that is not a place on the map.
- **A member can move to a different ~2.5-mile grid square at most once every 6 hours**; inside the window the old position stands, silently ("accepted: false, retry_after") — `20260806000030`.
- **Distance is computed between grid-square centres, in whole miles, never between stored points**; same square reads as "nearby". The radius filter, the "close by" score and the metro test all use the squares — `20260806000030`.
- **The deck returns at most 100 cards per call and never its score**; ties break in a per-viewer fixed order — `20260806000030`.
- **A player in another metro shows no distance** (null), never a huge number; city scoping (home city + extra cities) decides who is in the deck, not the radius — `20260806000024`.
- **Exact location is never stored anywhere** — permission strings in `mobile/app.json` say so and the schema has only `numeric(5,2)` columns.

### Safety
- **Blocks are absolute and symmetric**: a blocked pair is invisible to each other everywhere (`is_blocked()`), instantly — `20260805000001`, `20260806000019`.
- **Reports need a reason of 1–500 characters and a known context** (deck / chat / event) — `20260806000031`.
- **New and replaced photos are `pending` and invisible until an admin approves**; the `photo_moderation_guard` trigger makes self-approval impossible ("photo moderation status can only be changed by an admin") — `20260806000009`.
- **Admin membership is dashboard-only**: the `admins` table has no client policy at all; `is_admin()` gates every moderation action server-side, never the page — `20260806000008`.
- **Photos live in a private bucket served by short-lived signed URLs** — `20260806000003`.

### Events and tournaments
- **Events refuse RSVPs past capacity** ("This event is full.") — `event_capacity_guard`, `20260806000020`.
- **Tournaments**: sign in to join; finish your profile first; entries close when closed; full is full; a bracket has 1–128 places; at least 2 players to start; only the organiser can draw, start, or look entries up; once drawn, withdraw only through the organiser; only the two players in a match record its result; the winner must be one of them; a bye has no result; a result already in, or a next round already played, cannot be overwritten; a cancelled tournament accepts nothing — `20260806000027`, `20260806000029`.

### Added 2026-11-13 (founder-approved; migrations 33–41; hardened after an independent review the same day)
- **Real people only is enforced by the database, not just the app.** Swiping, messaging, taking a place at an event, entering a tournament and joining a ladder all require a verified phone (`require_verified_phone` triggers). Reporting, blocking and deleting your account never do. The switch (`app_settings.require_verified_phone`) ships ON and cannot be read or changed through the API — `20260806000039`.
- **Waiver before check-in.** A member accepts the event waiver on their own RSVP (`accept_event_waiver()` records the time and the version, `docs/event-waiver.md`); check-in refuses without it. Every acceptance is also kept in `waiver_acceptances`, which survives a cancelled RSVP and is not readable through the API — `20260806000033`.
- **Check-in only with the host's code.** Codes live in `event_checkin_codes` (admin-only policy, unreadable by members). Five wrong codes lock check-in for that member at that event; only the host can then let them in (`admin_check_in`, which still needs the waiver). Check-in opens an hour before and closes eight hours after the start — `20260806000033`.
- **An RSVP is one member at one event for good.** A member cannot move the row to another event or member, mark themselves checked in, forge a waiver or check-in time, or demote or delete an RSVP once checked in (`event_rsvps_guard_member_writes`) — `20260806000033`.
- **Attendance is private.** Other members can see that you are going; whether and when you checked in, and when you accepted the waiver, are not selectable by members (column privileges). Your own stamps come from `get_my_event_stamps()` — `20260806000033`.
- **Your crew is only people who checked in to the same event as you** — never the RSVP list, never a blocked or suspended member, never someone you reported, and a suspended member has no crew. "Also open to dating" is true only when both people have Date mode on, neither is a doubles team, each fits what the other is looking for, and each is inside the other's age range (the Date deck's own rule); the server decides it and the app never infers it. `crew_add()` works only for someone you shared a court with, and the crew list is not readable directly — `20260806000033`.
- **A ban sticks to the phone number.** `ban_member()` suspends the account and stores a one-way hash of its verified number; any account that later holds that confirmed number is suspended by the database the moment the number is attached or the profile is created, whether or not the app calls `sync_phone_verification()` (which also refuses it). An account deleted while suspended leaves its hash behind too (`20260806000041`); an account in good standing leaves nothing. The ban list has no policy at all — `20260806000034`.
- **Rate limits:** 500 swipes per 24 hours, 20 reports per 24 hours, 60 messages per minute. Counted in a server-stamped log (`rate_events`), so backdating a row or undoing a swipe gives nothing back; reports are counted before the reported account is looked up, so the limit says nothing about who exists — `20260806000035`.
- **Date likes (founder's decision, 2026-11-14):** 3 likes per rolling 24 hours in Date mode; a like and an ace both count, a pass never does; Play and Friends are not limited by it. Enforced in the database, counted in `rate_events` (undoing a like gives nothing back); the number is `app_settings.date_likes_per_day`, changed only from the SQL editor. The app says so before the card moves and never loses the card — `20260806000044`, `tests/app/datelikes.test.js`, harness §12.
- **Quiet hours:** no push between 10pm and 8am in the member's own timezone; the notification still lands in the in-app inbox. Timezones are not readable by other members — `20260806000036`, `supabase/functions/send-push/index.ts`.
- **Ladder leagues:** join takes the bottom rung; challenge at most two rungs up on the ladder you can see; one open challenge per pair; only the two players record a result, once; a win moves the challenger up at most two rungs; a block ends an open challenge and a result cannot be recorded against someone hidden from you; a suspended member cannot join, challenge, record or read standings; leaving, suspension and account deletion all close the ladder up. The ladder a member sees leaves out anyone hidden from them and has no masked rows, and a member's real rung is never readable: the table is desk-only and `join_league()` answers with the visible rung — `20260806000037`.
- **Tiers:** a member cannot set or change their own tier, at signup or later (`profiles_guard_tier`); before an event's general signup opens only Club members can take a place, including from the waitlist. One price per tier for everyone; **no pricing by gender, ever.** No payment is taken anywhere and nothing promises a deposit — `20260806000038`.
- **The desk** is someone on the admin list, or the project owner in the SQL editor / the service role (`is_desk()`); a member's or anonymous API session is never the desk. It gates check-in codes, hand check-in, bans and tiers — `20260806000033`.

### Chat, waitlist, devices
- **Court-time messages must carry a court payload**; messages are capped at 2,000 characters — `20260805000001`.
- **The waitlist accepts anonymous inserts only** (a valid email, one row per address); nobody anonymous can read it back — `20260805000001`, `20260806000017`.
- **Cities must exist in the registry**; a typo cannot create a ghost city, and the last city cannot be dropped — `20260806000014`, `20260806000024`.
- **Push tokens and devices are readable and writable by their owner only** — `20260806000001`, `20260806000015`.

## 3. Soft stops in the app and the desk

- Under-18 birthdates stop onboarding with "RSVPlay is 18+"; so does an under-18 doubles partner (`OnboardingScreen.js`, `SettingsScreen.js`).
- Phone verification is required to continue onboarding ("Almost there"); when SMS is not configured the app says so honestly and never pretends a code was sent (`state.js`).
- A refused location move or a failed position update says nothing and never fails signup or boot (`state.js`, tested in `tests/app/location.test.js`).
- Block and report are the two actions that must not fail silently: a report that does not reach the queue is surfaced ("Couldn't send the report"); a reported or blocked profile disappears from the deck and the crew at once (`state.js`; the database leaves a reported member out of `get_my_crew()`).
- Suspending a member from the desk needs a typed confirmation and a reason; it is the one desk action that changes an account (`admin/index.html`).
- Reports are reviewed within 24 hours (the desk's stated target); like cases get like outcomes, logged in `outreach/safety/decisions-log.md` (`safety-support`).
- Deleting an account is a Settings action with a confirmation, in the app, not an email request (store requirement).

## 4. Privacy rules (design rules, not review comments)

- Minimal PII: phone, email, first name, birthdate, coarse location. **No last names anywhere.**
- Exact coordinates never exist off the phone; distance is grid-to-grid in whole miles.
- Members' settings, preferences and timestamps are not readable by other members.
- Photos are private, moderated, signed-URL served; deletion purges storage.
- Report subjects appear as first name + last initial at most in repo files; raw interview notes and email exports never enter the repo.
- Privacy policy, terms and the safety page are live before any tester build (`landing/privacy.html`, `terms.html`, `safety.html`).

## 5. Store and legal requirements

- Block, report and human moderation (Apple 1.2, Play UGC policy) — shipped and desk-backed.
- 18+ age gating, Mature 17+ / Mature ratings.
- In-app account deletion and a public deletion page (`/delete-account`).
- App Privacy and Data Safety answers drafted strictly from what the code collects; refile when collection changes.
- No surprise subscriptions; premium, when it exists, goes through in-app purchase.
- Counsel's open questions (state dating-safety laws, arbitration, injury liability, TCPA, state privacy laws) are in `docs/legal-review-2026-11.md`.

## 6. Engineering rules

- Migrations only; never edit an applied migration; additive by default; destructive changes need the founder's OK.
- RLS or it doesn't ship: every new table gets policies in the same migration, plus a harness test that a non-member cannot do the thing.
- Test before you ship: `./scripts/test-backend.sh` against a throwaway Postgres; keep `supabase/setup.sql` current.
- Keep `mobile/src/api/backend.js` in sync with every schema change and bundle-check it.
- Seed data stays dev-only; `seed.sql` keeps its header warning.
- The safety core (the stops above, the compliance agents, the fair-play rules) is never auto-edited by an agent; changes need the founder's sign-off.
