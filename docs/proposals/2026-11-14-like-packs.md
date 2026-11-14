# Plan — buying more Date likes, or a membership (2026-11-14)

**Status:** the free limit is built and live in the code: 3 likes a day in
Date mode (migration 44). Buying more is a plan for the paid version, after
the free 1.0 launch. Nothing below is built.

## What members get free

- **3 Date likes per rolling 24 hours.** An ace counts as one. Passing is
  unlimited. Play and Friends have no daily limit.
- The app shows "2 of 3 likes left today", and when none are left it says
  when the next one comes back. The card stays on the deck.

## Two ways to get more

### 1. Like packs (one-off purchases)

Bought in the app, through Apple and Google billing (a "consumable" in-app
purchase; Apple and Google take about 15%).

| Pack | Price | Per like |
|---|---|---|
| 5 likes | $2.99 | $0.60 |
| 15 likes | $6.99 | $0.47 |
| 30 likes | $11.99 | $0.40 |

- Bought likes **never expire** and are used only after the free 3 for the
  day are gone.
- They work only in Date mode.
- A like used on someone who later blocks you is not refunded; an ace is one
  like, not a premium item. Keeping it simple keeps it fair.

### 2. A membership with more likes

Fits any pricing option in `docs/proposals/2026-11-14-pricing-options.md`.
Recommended with Option C's Club ($4.99/month or $39.99/year):

| Plan | Date likes a day | Also |
|---|---|---|
| Free | 3 | Everything about playing and safety |
| Club | 15 | Early event signup, first claim on full events, no booking fee |

Not unlimited: a cap keeps likes meaning something, which is the point of
the free limit.

## Rules that stay

- **The same for everyone:** the free number, pack prices and membership
  allowance never vary by gender, age or anything else about the member.
  Tinder settled age-based pricing claims for a reported $60.5M in 2025.
- **Safety is never sold:** block, report, verification and deletion stay
  free and unlimited.
- **No paying to see more of someone:** packs buy likes, not access to
  profiles, photos or who liked you. Privacy rules are unchanged.
- **Matches are never sold:** a match still needs both people to like each
  other.

## How it fits the code already built

- `date_like_allowance(member)` is the one place that answers "how many".
  Today it returns the setting (3). With payments it becomes: the setting,
  or the Club number for members with an active Club plan, plus any bought
  likes still unused.
- Bought likes go in a new table, written only by the billing function after
  Apple or Google confirms the purchase, never by the app.
- The app already shows the count and the "come back at" time; it gains a
  "Get more likes" button on that message.

## Decisions for the founder

1. Packs, membership, or both? *Recommendation: both, launched together, so
   the "out of likes" message can offer either.*
2. Pack sizes and prices (above is a starting point, not researched demand).
3. The Club allowance: 15 a day, or a different number.
4. Test first: during the free launch, count how often members hit the
   limit and come back the next day. If most never hit 3, the limit is
   doing its job and packs will sell slowly.
