# 40/LOVE — Feature Roadmap

The build order for turning the prototype into a product. Written to be read
in five minutes and argued with in ten.

## Guiding principles

1. **Ship the differentiator early.** The court-date proposal flow *is*
   40/LOVE. It ships in v0.1, not "later."
2. **One city.** Every feature is judged by whether it helps one launch city
   feel alive. Nothing ships for hypothetical scale.
3. **Every feature serves liquidity, safety, or retention.** If it doesn't,
   it waits — no matter how fun it sounds.

## At a glance

| Release | Theme | Headline features | Target |
|---|---|---|---|
| v0.1 "First Serve" | The core loop | Profiles, matching, chat, match requests, court-time proposals, Date + Play modes | Month 3–5 |
| v1.1 "Rally" | Community & trust | Events + RSVPs, safety pack, push notifications, Friends mode | Month 7–9 |
| v2.0 "Advantage" | Monetize & deepen | Premium tier, club portal, rating integrations, smarter matching | Month 10–12 |
| Backlog | Explore | Tournaments, coaching, gear, leagues, expansion tooling | Post-city-#1 proof |

---

## v0.1 — "First Serve" (MVP)

The founder's Phase 4 list, plus one strategic addition: **Play mode ships in
the MVP alongside Date mode.** A bare dating clone dies in an empty market;
Play mode makes the app useful at 40 users instead of 4,000, seeds Discover
with real people, and gives non-singles a reason to swell the pool. It is the
cold-start solution, not a nice-to-have.

| Feature | Scope | Acceptance |
|---|---|---|
| Sign up | Email or phone + Apple/Google OAuth; 18+ gate | New user reaches Discover in under 3 minutes |
| Profiles | Name, age, photos, bio, availability | Profile completeness ≥80% median |
| Photos | Upload up to 6, basic moderation queue | No unmoderated photo goes live |
| Sport selection | Multi-select: tennis, pickleball, padel, racquetball, squash | Matching only pairs shared sports |
| Skill level | Beginner→Competitive + optional NTRP/DUPR free text | Skill shown on every card |
| Location matching | Radius-based discovery, distance on card | No exact location ever exposed |
| Modes: Date + Play | Separate intents, separate decks, per-mode CTAs | A Play-only user never appears in Date |
| Match requests | Like / pass; mutual like = match ("It's a Match Point!") | Matches open a chat thread |
| Messaging | 1:1 text chat between matches | Delivered in under 2s median |
| **Court-time proposal** | Structured court + day + time card in chat; accept/decline | ≥25% of active chats send one in week one |

**Deliberately NOT in v0.1** — and why:
- **In-app payments / premium** — monetizing before liquidity kills both.
- **Events in-app** — run mixers manually first (Partiful/Eventbrite); learn
  what an event feature must do before building it.
- **Video profiles / video chat** — heavy build, unproven demand here.
- **Algorithmic/AI matchmaking** — sport + skill + distance + mode filters are
  enough at launch scale; a fancy algorithm can't fix a small pool.
- **Android + iOS both native** — pick per launch-city audience (or no-code
  cross-platform) rather than doubling build cost. Revisit at v1.1.
- **Court booking integrations** — propose times, don't book courts; booking
  APIs are a partnership project for v2.0.

## v1.1 — "Rally"

Community and trust, once the loop is proven.

- **Events calendar + RSVP** — in-app mixers, round robins, open plays; the
  offline flywheel moves in-app. Organizer tools for the founder first.
- **Safety pack** — photo verification badge, block/report with 24h review,
  first-meet prompts (public court, daytime default, share-my-plan), community
  guidelines at signup.
- **Friends mode** — third intent for leagues and social play; entry point for
  the new-in-town user who becomes the community's backbone.
- **Push notifications** — matches, "your serve" reminders, event reminders.
  Respect quiet hours; notification fatigue is churn.
- **Profile prompts** — 2–3 racquet-flavored prompts ("My go-to shot", "Post-
  match ritual") to make cards conversational.

## v2.0 — "Advantage"

Monetization and depth, once retention marks are hit.

- **Premium membership** — see-who-liked-you, unlimited likes, boosts,
  advanced filters (skill band, availability windows), travel mode.
- **Club partnership portal** — clubs post events, offer member perks, see
  aggregate (never individual) engagement.
- **Rating integrations** — DUPR/UTR verification for skill credibility.
  *Partnership-dependent: scope only after API conversations.*
- **Smarter matching** — availability-window overlap, preferred courts,
  response-rate weighting. Still filters and heuristics, not a black box.
- **Second city launch tooling** — city switch, per-city waitlists, city-vote
  pipeline from the landing page.

## Backlog / explore

Tournaments and brackets · coaching marketplace · equipment affiliate shop ·
seasonal leagues · corporate/social club packages · international (padel!) ·
"met on 40/LOVE" success-story flow.

## Success metrics per release

| Release | Metric | Honest target |
|---|---|---|
| v0.1 | Activation (complete profile w/ sport + skill) | ≥70% of signups |
| v0.1 | Weekly matches per active member | ≥1.0 |
| v0.1 | Chats sending a court-time proposal (week 1 of chat) | ≥25% |
| v0.1 | Message response rate | ≥50% |
| v1.1 | Event RSVP → attendance | ≥60% |
| v1.1 | Week-4 retention | ≥30% |
| v1.1 | Verified-photo adoption | ≥50% of actives |
| v2.0 | Premium conversion | 4–6% of monthly actives |
| v2.0 | D30 retention | ≥35% |

## Dependencies & open questions

- **Platform choice** (no-code vs native vs cross-platform) gates everything —
  decide at the end of validation, per the business plan's recommendation.
- **Moderation duty** — photo review and report handling need a named owner
  from day one, even at MVP scale (it's the founder at first).
- **DUPR/UTR API access** — open conversations early; timelines are outside
  our control.
- **Open:** does Discover rank by distance, activity, or freshness at MVP?
  (Proposal: activity first — a responsive small pool beats a stale big one.)
- **Open:** are court-time proposals bindable to real court reservations in
  city #1? Depends on local club systems; answer during validation interviews.
