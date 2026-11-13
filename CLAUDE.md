# CLAUDE.md — RSVPlay (this branch) and the Cortana workspace

Read automatically by Claude Code, Cowork and the Agent SDK. This is the
project's memory: what RSVPlay is, what must never change, and where things
live. Keep it short; the long versions are linked.

## Two things live in this repository

- **`main`** holds Jones & Co. Realty presentations (`presentations/`). Leave
  them alone when working on RSVPlay.
- **This branch (`claude/rsvplay-scripts-formatting-a15dow`)** holds the
  complete **RSVPlay** launch kit, transferred from the 40/Love kit on
  2026-11-13: the Expo app (`mobile/`), the Supabase backend as code
  (`supabase/`), the clickable prototype (`app/`), the website (`landing/` →
  `site/`), the moderation desk (`admin/`), the docs, the outreach files, the
  test suites (`tests/`, `scripts/test*.sh`) and the agent team
  (`.claude/agents/`).

## What RSVPlay is

An **events-first social app for paddle and racquet sports** — pickleball,
tennis, padel, racquetball, squash. You RSVP to a social, a league night, a
tournament or a pickup game, show up and play, then keep the people you met as
partners, friends or, if both people opt in, dates. Dating is a mode, never
the headline. Tagline: **Serve. Rally. Connect.** Positioning line: *The app
for paddle and racquet sports.* Launch market: Indianapolis and Hamilton
County (Fishers, Carmel, Noblesville, Geist); 12 cities in the registry.

The name "40/Love" is retired. Never reintroduce it, its tagline ("Love at
first serve"), its score chips ("40 – LOVE") or "the first date is a game".

## Brand tokens (the single palette; the design canvases use the same)

Ink `#14161C` · Court `#F5F4EE` · Optic `#C8F04A` · Court blue `#2F5BFF` ·
Surface `#1E2128` · Surface 2 `#272B33` · Line `#2E323B`/`#3E434E` · Muted
`#C9CBD2` · Success `#3DC96B` · Danger `#E15A72`. Headlines Space Grotesk 700,
body Inter. The pickleball mark is defined once in `scripts/lib/ball.js`; the
wordmark is "RSVPlay" with the ball as the period. Full guide:
`docs/brand-guide.md`.

## The rules that never move

The complete list with file references is `docs/rules-and-stops.md`. The
headlines:

1. **Humans send, agents draft.** No agent sends, posts, publishes, submits a
   build, pushes to a store, or runs SQL against production.
2. **Real people only, 18+.** Phone verification by one-time text before
   signup completes, and the database refuses swipes, messages, RSVPs,
   tournament entries and ladder joins without it; a ban sticks to the phone
   number; birthdate check in the database; teams are two adults.
3. **Privacy by design.** Coordinates rounded to ~1 km on the phone, set only
   through `set_my_location()`, moves limited to once per 6 hours, distance
   computed between ~2.5-mile grid squares in whole miles. No last names.
   Other members' settings are unreadable. Hard account deletion.
4. **Safety.** Blocks are absolute and symmetric; reports go to a human desk
   with a 24-hour target; photos are pending until an admin approves (the
   database enforces it); admin membership is dashboard-only. Events: waiver
   before check-in, check-in only with the host's code, attendance private,
   crew = people who checked in with you, "also open to dating" only when
   mutual. Rate limits on swipes, reports and messages. No payments, no
   deposits, no pricing by gender.
5. **Backend changes are migrations with RLS and a passing harness run**, and
   `supabase/setup.sql` is rebuilt from them (`scripts/build-setup-sql.sh`).
6. **The safety core is never auto-edited by an agent** (the stops above, the
   `safety-support` rules, this file). Changes need the founder's sign-off.

## Verify

```bash
./scripts/test.sh            # backend (throwaway Postgres 16) + app (Node) + web (Chromium)
./scripts/test-backend.sh    # migrations, RLS denials, location grid, moderation, tournaments
./scripts/test-app.sh        # the shipped state layer, incl. tests/app/location.test.js
./scripts/test-web.sh        # prototype click-through, waitlist, moderation desk, share cards
```

`./scripts/healthcheck.sh` (add `--full` for the suites) is the one-command
check; CI runs it on every push. Set
`PW_CHROMIUM=/opt/pw-browsers/chromium` in a cloud session.

## Derived files — regenerate, never hand-edit

`supabase/setup.sql` (`scripts/build-setup-sql.sh`), `site/`
(`scripts/build-site.sh`), the ball in every page (`scripts/sync-mark.js`),
icons, splash, share card and `mobile/assets/ball.png`
(`node scripts/make-icons.js`, needs `playwright-core` and a Chromium),
`brand/tokens.json` (`node scripts/build-tokens.js`, from `mobile/src/theme.js`).

## The agent team

Thirteen agents in `.claude/agents/`: two crews of ten, described in
`docs/networking-team.md`: networking (`community-scout`,
`club-partnerships`, `social-content`, `waitlist-community`,
`mixer-coordinator`, `validation-analyst`) and product & launch
(`backend-engineer`, `qa-tester`, `release-manager`, `safety-support`). Ask
for one by name. Every agent reads `docs/brand-guide.md` and works from
`docs/business-plan.md` (read its 2026-11 positioning note first). The other
three are the self-improvement network (`network-auditor`, `rules-sentinel`,
`self-repair`; `docs/self-improvement-network.md`, the `self-improve` skill):
they measure with `./scripts/healthcheck.sh`, propose in `docs/proposals/`,
repair only outside the safety core, and log in `docs/improvement-log.md`.
A weekly scheduled audit runs the loop on Mondays.

## Live infrastructure (state as of 2026-11-13)

- **Domain:** `rsvplayapp.com`, registered at Cloudflare, which also runs its DNS (rsvplay.com was taken).
  Every link and the support address `hello@rsvplayapp.com` use it. The app's
  bundle id stays `com.rsvplay.app`; it is an identifier, not a domain.
- **Database:** the live Supabase project is set up from `setup.sql`
  (migrations through 41 applied; 42 pending). Applied migrations are never
  edited: a change is a new migration, pasted from `supabase/go-live/`.
- **Website:** published by Netlify (project `rsvplay`, production branch
  set to this one). Its free build credits ran out on day one, so new deploys
  are paused until the founder picks a host; `docs/go-live-rename.md` has
  the Cloudflare DNS steps.
