# RSVPlay — Improvement log

Append-only memory of the self-improvement network. One entry per cycle:
date · what was checked · what was proposed · what the founder decided · what
shipped. Agents append; nobody rewrites history.

## 2026-11-13 — network created

- **Checked:** the transferred kit with `./scripts/healthcheck.sh` and
  `./scripts/test.sh` (backend, app, web). All green after the rename; one
  stale host pattern in `tests/web/share.test.js` fixed.
- **Proposed:** `docs/proposals/2026-11-13-proposed-additions.md` (15 items)
  for the founder's review.
- **Decided:** pending founder review.
- **Shipped:** the network itself (`scripts/healthcheck.sh`,
  `network-auditor`, `rules-sentinel`, `self-repair`, the `self-improve`
  skill, this log).

## 2026-11-13 — the fifteen additions, built

- **Decided:** the founder approved all fifteen items of
  `docs/proposals/2026-11-13-proposed-additions.md` ("do all 15").
- **Shipped:** migrations 33–38 (check-in, waiver, crew; phone bans; rate
  limits; quiet hours; ladder leagues; tiers), the push function's quiet
  hours, the prototype and phone-app screens (events-first Home, bracket,
  waiver, check-in, crew, leagues, tier), CI, `brand/tokens.json`, the weekly
  scheduled audit, the waiver draft, the rename guide and the name-clearance
  first pass. Status per item is at the top of the proposals file.

## 2026-11-13 — independent review of the fifteen, and repairs

- **Checked:** six reviewers (two on privileges, one on logic and races, one
  on test honesty, one on the prototype, one on documents), each finding
  re-checked by a skeptic, with reproductions against a throwaway Postgres.
- **Found and fixed the same day:**
  - *Critical:* a member could move their own checked-in RSVP row to another
    event — a check-in and a crew with no code, waiver or time window. RSVP
    rows are now immutable in event and member; checked-in rows cannot be
    demoted or deleted by their owner.
  - *High:* who checked in, and when, was readable by every member → those
    columns are no longer selectable. The phone ban only applied if the client
    chose to call the verification sync → a verified phone is now required by
    the database to reach anyone (migration 39), and a banned number suspends
    the account the moment it is attached. Rate limits trusted the client's
    timestamps and could be reset by undoing swipes → they count in a
    server-stamped log. A suspended member could shed the suspension by
    deleting the account → the number's hash is kept (m23).
  - *Medium:* the check-in code could be guessed (now five tries, then the
    host); the dating flag ignored age ranges; a masked "Player" row in ladder
    standings gave a block away (the ladder a member sees now simply leaves
    hidden people out); ladders could keep gaps; a stale challenge could jump
    any number of rungs; a block did not end an open challenge; the report
    limit told a deleted account from a hidden one; the waiver record vanished
    with a cancelled RSVP; the event-night instructions did not work from the
    SQL editor (`is_desk()`); the app dropped an event at its start time so
    check-in could not be reached.
  - *Documents:* the privacy policy and deletion page now describe what is
    stored (attendance, waiver acceptance, timezone, crew, ladder results,
    tier, the banned-number fingerprint); the old name was still URL-encoded
    in the deletion page's email link.
  - *Tests:* section 10 of the backend harness was rewritten to assert every
    stop from the refused side; the harness now mirrors Supabase's default
    function grants; the health check pins the real statements and limits and
    its negative checks see untracked files.
  - *Prototype:* sign-out left the previous member's chats and matches;
    Date mode was pre-selected at signup; the event card nested controls
    inside a button role; reporting from the crew changed nothing; one funnel
    step was never recorded.
- **Left for the founder:** `docs/proposals/2026-11-13-review-decisions.md`.
- **Verified:** `./scripts/healthcheck.sh --full` (result recorded in the
  commit that closes this entry).

## 2026-11-13 — review, second pass: the low-severity findings

- **Trigger:** the review's last verdicts came in after the hardening commit.
  Most were already fixed by it; these were confirmed and still open.
- **Fixed (migration 37, unreleased, edited in place):** a member's real rung
  is no longer readable — `league_members` is desk-only and `join_league()`
  answers with the rung on the ladder the caller sees; every path that
  renumbers a ladder takes the league's row lock first (the leave trigger and
  the suspension trigger).
- **Tests added (harness section 10):** `crew_add` of a suspended member is
  refused; the viewer's own half of the dating flag (not in Date mode, own age
  range); each rate limit is pinned from both sides of its limit and its
  window; members cannot update or delete ladder rows or write, decide or
  delete challenges directly, and cannot read a challenge between two others;
  a suspended member cannot challenge or record, her open challenge goes with
  her, and nobody can see, challenge or record against her even if a row were
  left behind; a catalog check that nothing added in migrations 33–38 is
  callable by anon and that the internal helpers are callable by nobody
  through the API (10f-ii).
- **Health check:** fails closed when git cannot search the work tree (its
  must-be-absent checks would otherwise pass on nothing); the quiet-hours
  check requires the early return in `send-push`, not just the function name;
  the dating-flag check pins the viewer-side clauses too.
- **Left for the founder:** decisions 5 and 6 in
  `docs/proposals/2026-11-13-review-decisions.md` (who records a ladder
  result; counting the two-rung cap on the visible ladder).
- **Verified:** `./scripts/test-backend.sh` — ALL BACKEND TESTS PASSED (41
  migrations); full run recorded in the closing commit.
- **Also fixed (migration 33, unreleased):** reporting someone from the crew
  list changed nothing. A member you reported now leaves your crew at once and
  cannot be added back (`get_my_crew()`, `crew_add()`); the phone app drops
  them from the list on the spot. The conversation stays, as a record for the
  desk. Harness 10b and `tests/app/checkin.test.js` assert it.
- **Also fixed (migration 34, unreleased):** a ban on an account that was
  later deleted could never be lifted, because `unban_member()` needs the
  account. `unban_phone('<number>')` lifts it by number; it is owner-only and
  not callable through the API, so it cannot be used to probe the list. The
  rules doc, the deletion page, the event-night guide and the desk's confirm
  text now say exactly what is kept and who can lift it.
- **Also fixed (deployment):** the two migrations named `m22.sql` and
  `m23_ban_survives_deletion.sql` would have been skipped by `supabase db
  push`, which only applies files named `<timestamp>_name.sql`. They are now
  `20260806000040_waitlist_on_delete.sql` and
  `20260806000041_ban_survives_deletion.sql` (same contents, same order).
  Earlier entries in this log that say "m23" mean migration 41. Checklist row
  4.3 now gives the three ways to apply the database and a one-line check.
- **Also fixed (documents and drafts):** the store listing, the Indianapolis
  outreach drafts, the legal-review summary and two agent openers still led
  with "dating and social app"; they now say events-first with opt-in dating,
  and the health check refuses the old line. The store data tables list what
  migrations 33–41 store. The privacy policy says who can see a ladder. The
  waiver draft states how long an acceptance is kept.
  `outreach/safety/decisions-log.md` exists, so the two places that cite it
  resolve.
- **Left for the founder (safety core, not edited):** the same one-sentence
  opener in `.claude/agents/safety-support.md` — decision 7.
- **Prototype (the review's seven findings):** sign-out now replaces the whole
  state, so nothing of the previous member is left; the dating tag uses both
  age ranges; Play is pre-selected and Date is opt-in; the event card and the
  photo tiles no longer nest one control inside another; the check-in code
  accepts 4–8 letters or digits; a report hides the person from the crew, the
  going row and the deck; the funnel records `opened_chat`. Each has a test
  that failed when its fix was reverted.
- **Verified:** `PW_CHROMIUM=/opt/pw-browsers/chromium ./scripts/healthcheck.sh
  --full` — 96 passed, 0 failed (backend: 41 migrations, ALL BACKEND TESTS
  PASSED; app: all green; web: prototype 49, admin 12, admin-live 9, waitlist
  5, events 23, funnel 7, share 13).
