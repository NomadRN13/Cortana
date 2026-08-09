# 40/Love — System Architecture

The technical blueprint for turning the prototype (`app/index.html`) into the
real product. Written for the founder and for whoever builds the MVP — a
freelance developer, an agency, or a no-code specialist. Scope matches the
feature roadmap's v0.1 → v1.1; everything here should survive to v2.0 without
a rewrite.

## 1. The system at a glance

```
┌─────────────────────┐        ┌──────────────────────────────────────┐
│  Mobile app          │        │  Backend (managed platform)          │
│  (iOS + Android,     │◄──────►│  Auth · Database · Realtime · Storage │
│  one codebase)       │  API   │  Push notifications · Edge functions  │
└─────────────────────┘        └──────────────┬───────────────────────┘
┌─────────────────────┐                       │
│  Waitlist site       │───── signups ────────┤
│  (landing page)      │                      │
└─────────────────────┘        ┌──────────────▼───────────────────────┐
                               │  Admin dashboard                      │
                               │  Moderation queue · Events · Metrics  │
                               └──────────────────────────────────────┘
```

Four pieces: the mobile app users touch, one managed backend that does the
heavy lifting, the waitlist site feeding it, and a small admin dashboard for
moderation and events. No microservices, no custom servers — at MVP scale
(one city, low thousands of users) a managed platform handles all of it.

## 2. Recommended stack

Two viable paths, matching the business plan's build options:

| | Path A — No-code | Path B — Lean custom (recommended) |
|---|---|---|
| App | FlutterFlow or Bubble | React Native + Expo (one codebase → iOS + Android) |
| Backend | Firebase (bundled) | Supabase (Postgres, auth, realtime, storage) |
| Push | Built-in | Expo Push |
| Cost to MVP | ~$5–15k (or DIY time) | ~$25–60k freelance |
| Speed | 6–10 weeks | 10–16 weeks |
| Ceiling | Hits limits at custom matching, moderation tooling | None relevant before multi-city scale |

**Recommendation: Path B if budget allows, Path A to validate faster.** The
deciding factor: Path B's data lives in plain Postgres, so nothing is thrown
away later — the schema below works on either path (Firebase equivalents in
parentheses where they differ). If starting with Path A, insist on exportable
data. Either way, the prototype in this repo is the design spec: every screen,
flow, and interaction the developer needs is clickable.

## 3. Data model

Core tables (Postgres):

```
users            id · phone/email · created_at · last_active_at
profiles         user_id · first_name · birthdate · bio · verified_at
                 location (geohash, ~1km precision — never exact)
                 gender [woman|man|nonbinary] · seeking (gender[], Date mode)
                 play_games [singles|doubles|mixed_doubles] · play_pref
                 [women|men|everyone] · friends_pref [women|men|everyone]
                 availability_note · discovery_prefs (radius, age range,
                 sports_only) · modes_enabled [date|play|friends]
profile_photos   user_id · storage_path · position · moderation_status
user_sports      user_id · sport [tennis|pickleball|padel|racquetball|squash]
                 · level [beginner|intermediate|advanced|competitive]
                 · rating_label (free text: "NTRP 3.5", "DUPR 4.0")
swipes           actor_id · target_id · mode · action [like|pass|ace] · at
matches          id · user_a · user_b · mode · created_at · closed_at
messages         id · match_id · sender_id · kind [text|court_time]
                 · body · court_payload {venue, day, time, sport, status}
                 · sent_at · read_at
events           id · title · venue · starts_at · sport · level_range
                 · capacity · source [admin|club] · club_id?
event_rsvps      event_id · user_id · status [going|waitlist|checked_in]
blocks           blocker_id · blocked_id · at
reports          id · reporter_id · target_id · reason · context (deck|chat|event)
                 · status [open|reviewed|actioned] · at
notifications    user_id · kind · payload · sent_at · read_at
waitlist         email · city · source · created_at        ← fed by landing page
cities           id · name · status [waitlist|active] · launch_at
```

Rules that matter:

- **Location is fuzzy by design.** Store a coarse geohash, display distance
  rounded to 0.1 mi. Exact coordinates never exist in the system — you can't
  leak what you don't store.
- **A swipe is append-only; a match is derived.** Mutual `like` (or one `ace`)
  in a compatible mode creates the match row. This keeps history auditable.
- **Blocks are bidirectional and absolute** — filtered at query level in
  discovery, matches, messages, and events, in both directions.
- **Modes live on both the profile and the swipe** so a Play-mode like never
  becomes a Date-mode match. One pair can hold one match per mode.

## 4. Matching engine

MVP matching is a filtered query plus a ranking score — no ML needed at one
city scale:

**Candidate filter (hard rules):** within radius · inside each other's age
ranges · at least one mode in common · **in Date mode, a mutual gender fit:
their gender is in my "seeking" AND mine is in theirs (all pairings
first-class — woman↔man, woman↔woman, man↔man, nonbinary in any
combination)** · **in Play mode, a shared game type (singles / doubles /
mixed doubles), with both players' play-with preference (women / men /
everyone) honored for singles and doubles — mixed doubles is open by
nature** · **in Friends mode, a mutual meet preference (defaults to
everyone)** · dating preference never leaks across modes · no prior
swipe by actor on target · no block either direction · active in the last
30 days · (optional pref) shares a sport.

**Ranking score (soft ordering):**

```
score = 3 × shared_sport
      + 2 × skill_adjacency      (same level = 2, one apart = 1, else 0)
      + 2 × recency              (active this week)
      + 1 × proximity            (closer half of radius)
      + 1 × verified
      + 1 × has_availability_overlap (text-level at MVP; structured in v2)
```

Play mode weights skill_adjacency double and ignores age preference beyond
the hard filter — a hitting partner at your level matters more than their
birthday. The `ace` action surfaces the actor at the top of the target's
deck. Tune the weights with real usage data; keep the formula in one edge
function so tuning never needs an app release.

## 5. Chat & court proposals

- One realtime channel per match (Supabase Realtime / Firestore listeners).
- Two message kinds: `text` and `court_time` — the structured card from the
  prototype (venue, day, time, sport) with an accept/decline `status`.
  An accepted proposal is the app's core success event ("a date happened").
- Venue names autocomplete from a per-city court list (seeded from
  `outreach/indianapolis/targets.md` for city #1).
- "Your serve" badge = other party sent the latest message; drives the
  message-response-rate KPI.

## 6. Trust & safety (non-negotiable for a dating app)

- **Verification:** selfie-pose photo review — manual at MVP via the admin
  queue (minutes/day at launch volume), vendor API (e.g. Persona/Berbix
  class) when volume demands. Verified badge as in the prototype.
- **Report → queue → action:** every report lands in the admin dashboard
  with context (profile, recent messages if from chat). Target SLA: reviewed
  within 24h. Actions: dismiss, warn, photo removal, suspend, ban.
  Bans are by phone number hash, not just account — and the raw material for
  that is now collected: every signup verifies a phone by SMS (migration
  `20260806000007`; number lives in `auth.users`, verified flag on
  `profiles.phone_verified_at`), so a banned number can't just re-register
  with a fresh email.
- **Blocking** takes effect instantly and silently, exactly as prototyped.
- **First-meet nudges:** when a court proposal is accepted in Date mode, the
  app suggests public courts and shares safety basics. Public-court-first is
  a product value, not just a footnote.
- **18+** enforced at signup (birthdate) and by app-store rating.
- **Photo moderation:** new photos are `pending` and visible only after an
  automated screen (vendor nudity/violence API) — manual review on flags.

## 7. Notifications

| Trigger | Notification |
|---|---|
| Mutual like / ace received | "It's a Match Point! 🎾" |
| New message | "Your serve — {name} replied" |
| Court proposal received/accepted | "{name} proposed a court time" |
| Event reminder (24h + 2h) | "{event} is tomorrow — {n} spots left" |
| Inactivity (7 days, max 1) | New players in your radius |

All individually toggleable (Settings screen already prototypes this). Quiet
hours 10pm–8am local by default.

## 8. Analytics — instrument the validation criteria

Every KPI in the business plan maps to an event:

```
signup_completed · profile_completed · deck_swipe {action, mode}
match_created {mode} · message_sent · court_time_proposed / _accepted
event_rsvp / event_checkin · report_filed · session_start
```

Dashboards to watch from day one: activation (signup → completed profile),
weekly matches per active user, message response rate, court-time acceptance
rate (the "real dates" number), D30 retention, mode mix. PostHog or
Amplitude free tier is plenty.

## 9. Privacy & compliance

- Minimal PII: phone/email, first name, birthdate, coarse location. No last
  names in the product at all.
- Account deletion = hard delete of profile/photos/messages within 30 days
  (app-store requirement) with a tombstone for ban enforcement.
- Photos in private storage buckets, served via short-lived signed URLs.
- Privacy policy + terms needed before TestFlight; budget a legal review.

## 10. Rollout plan

| Phase | Ships | Backend work |
|---|---|---|
| Alpha (mixers, ~50 invited) | Auth, profiles, photos, Date+Play deck, match, chat | Core tables, matching query, manual verification |
| Beta (waitlist invite, ~500) | + court proposals, notifications, safety pack, events RSVP | Realtime, push, moderation queue, analytics |
| Launch (Indianapolis public) | + Friends mode, event check-in codes | Rate limiting, cost alarms, city gating |

The waitlist table gates every phase: invites go out city-by-city, oldest
signups first, exactly as the landing page promises.

## 11. Prototype → production map

| In the prototype (`app/index.html`) | In production |
|---|---|
| localStorage profile | `users` + `profiles` rows behind auth |
| Seeded 12-profile deck | Matching engine query (§4) |
| Every-3rd-like match modal | Real mutual-like match creation |
| Canned chat replies | Realtime messaging |
| "Suggest court time" card | `court_time` message kind with accept flow |
| Settings filters (radius/age/sports) | `discovery_prefs` enforced server-side |
| Block/report sheet | `blocks` + `reports` + admin queue (§6) |
| Notifications panel | Push + in-app inbox (§7) |
| Photo upload (on-device) | Storage bucket + moderation pipeline |
| Events list + Join | `events` + `event_rsvps`, admin-managed |

Everything else — brand, copy, layout, flows — transfers as-is. The
prototype is the spec; this document is the plumbing.
