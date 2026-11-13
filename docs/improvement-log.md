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
