# Pricing options for RSVPlay's paid version (researched 2026-11-14)

**Status:** for the founder to choose. Version 1.0 launches free (decided
2026-11-14). Nothing here is built. Payments still need rule 4 changed by the
founder (`docs/proposals/2026-11-14-payments.md`).

**How this was made:** four researchers gathered published prices, a
strategist built three options, and a skeptic tried to refute them. Its
findings are applied below. **Limit:** most pages could not be opened from the
research session, so many prices come from search summaries of the named
pages, not from the pages themselves. Check any price before quoting it
publicly.

## What players already pay (the evidence)

| What | Price | Source (as reported) |
|---|---|---|
| DUPR+ (pickleball rating) | $19.99/year | dupr.com/duprplus |
| Pickleheads Plus | $12–19.99/year (conflicting on its own pages) | pickleheads.com/pricing |
| Hitch (pickleball partner matching) | $4.99/month | App Store |
| Strava | $11.99/month or $79.99/year | strava.com/pricing |
| Meetup+ (members) | $14.99/month or $129.99/year | price tracker, Oct 2026 |
| UTR Power (tennis rating) | $12/month or $120/year | universaltennis.com |
| Hinge+, Bumble, Tinder | about $15–50/month | search summaries |
| Indy Parks pickleball | $3 drop-in or $15/month | search summaries |
| Carmel Monon Center drop-in | $11 | search summaries |
| The Picklr (indoor club, Indy) | $139/month | search summaries |
| Social leagues in Indy (Silly Pickles) | $115–148 per 6–8 week season, about $18–20 a night | search summaries |

**What this says:**
1. Players pay very little for pickleball software, about $1–2 a month.
   The business plan's $12–15/month anchor sits with Strava and Meetup+, which
   offer much more than an app tier would.
2. Players already pay real money to play: $3–11 a drop-in, about $18–20 a
   league night, $115–148 a season.
3. Subscription apps convert few people. About 2% of free users become paying
   ones (RevenueCat 2025 and 2026). Tickets get paid by most people who show up.
4. Tickets to in-person events can use a card processor (Stripe) instead of
   Apple's billing, under Apple guideline 3.1.3(e), so Apple takes no
   commission on them. Memberships that unlock app features must use Apple's
   and Google's billing, at about 15%. Google Play's rule for event tickets
   was not verified.

## Three options

### Option A — one cheap membership

- **Free:** everything about playing, connecting and staying safe.
- **Plus: $2.99/month or $19.99/year.** Advanced filters, play history and
  stats, travel mode (events only; see the rules below).
- **Tickets:** venues sell their own; RSVPlay adds no fee.
- **Why it might sell:** priced like DUPR+ and Pickleheads, which players
  already accept.
- **Risk:** earns very little. At 2% of 1,000 members, about 20 payers, or
  roughly $400 a year.

### Option B — two tiers on the slots the app already has

- **Plus: $6.99/month or $49.99/year.** Filters, travel mode, play history.
- **Club: $12.99/month or $99.99/year.** Everything in Plus, signup 48 hours
  early on capped events, first offer when a spot opens on a full event, and a
  member price on RSVPlay-run mixers.
- **Tickets:** RSVPlay mixers at $15.
- **Why it might sell:** matches Strava and Meetup+ for players who plan their
  week around events.
- **Risk:** the $6.99 level is inferred, not found in the research. Two tiers
  is more to explain, and $12.99/month is close to a full Indy Parks month
  ($15).

### Option C — events first (recommended)

- **The whole social app stays free:** connecting, filters, stats, travel
  mode, dating mode, messaging.
- **Club: $4.99/month or $39.99/year.** Signup 48 hours early on capped
  RSVPlay events, first offer on full events, and no booking fee on partner
  tickets.
- **Tickets, through Stripe:**
  - RSVPlay social mixer: **$15**.
  - Six-week ladder season: **$99**, about $16.50 a night, below the local
    $115–148 leagues. That benchmark is reported, not tested.
  - Partner-hosted events: the venue's own price, plus at most a small booking
    fee that Club waives. A fee like PickleballBrackets' $5 per event is the
    only researched benchmark.
- **Why it sells:** players already pay to play, so the money comes from
  where they already spend. Tickets avoid the 15% store fee. The free app stays
  generous, which keeps people coming to events.
- **Risk:** RSVPlay has to run good events: hosts, courts, insurance. Revenue
  grows with events held, not with downloads.

### Rough size of each, per 1,000 active members

These are placeholder assumptions, not research. Member count, attendance and
conversion are all unknown until v1.0 is live.

| | Low case | Base case |
|---|---|---|
| A: Plus at 2% (benchmark) | about $400/yr | about $400/yr |
| B: Plus 2% + Club 1% | about $2,000/yr | plus mixers below |
| C: Club at 2% | about $800/yr | plus tickets below |
| One mixer: 24 players × $15 | $360 gross | before court, host, insurance and card fees |
| One ladder season: 24 players × $99 | $2,376 gross | same costs apply |

Stripe's rate (about 2.9% + 30¢ per charge in the US) was not verified.
Court rental, host time and event insurance have to come out of ticket money.

## Rules every option keeps

- **Always free:** phone verification, block, report, the human report desk,
  account deletion, check-in, waivers, crew, messaging.
- **Dating is never paywalled.** Likes in dating mode stay unlimited for
  everyone. Any daily cap applies only to partner and friend requests.
- **No fee kept from a no-show.** A paid ticket for someone who doesn't come
  becomes a credit, or is refunded. Never kept.
- **No pricing by gender or age.** Tinder paid a reported $60.5M settlement in
  2025 over age-based pricing.
- **At least half the spots** on every capped event stay open to general
  signup, so early access never locks out free members.
- **Travel mode shows events in other cities only.** No people discovery and
  no fake location, so the location rules (`set_my_location()`, once per 6
  hours) are untouched. It goes through the safety review before it is built.
- **"Play again" is mutual-only**, like dating, so it never reveals one-sided
  interest.

## Launch offers (pick a few, all apply equally to everyone)

- **Founding Club, $19.99 for the first year** (half price) for everyone
  active in free v1.0. Delivered by offer code, by email or in the app. Apple
  allows only one introductory offer per person, so this replaces a free
  trial; it isn't stacked on one.
- **Or a 30-day free trial** of Club for new members, instead of the founding
  price.
- **First mixer free:** a $15 ticket credit, capped at the first 200 members,
  so its cost is known in advance.
- **Bring a player:** a $5 ticket credit each when an invited friend checks
  in at their first paid event.
- **Venue codes:** a free month of Club for members who join at a partner
  venue, using Apple's offer codes.

## How to test prices during free v1.0, without charging anyone

1. **Survey, weeks 1–3.** A short email to the waitlist and to members after
   their first event. Ask four questions about each offer: what price would be
   too cheap, a bargain, getting expensive, too expensive. Then ask which of
   Options A, B and C each person would pick, with the real prices shown.
   Agents draft it; you send it.
2. **Price-test mixers.** Run free RSVPlay mixers and ask at check-out what a
   fair price would have been. Ask again after the second event.
3. **"Coming soon" page on the website,** not in the app: it shows Club and
   its price with a "tell me when it launches" button. Apple can reject an
   app build that shows features or prices that don't exist yet, which is why
   this goes on the website.

Decide when the survey and the mixers have real answers, not before.

## Open checks before building

- Google Play's payments policy on in-person event tickets.
- App Review: a Club discount or fee waiver applied to a Stripe ticket, when
  the Club membership was bought in the app.
- Event insurance and who is merchant of record for partner tickets.
- Rule 4 rewritten by the founder (`docs/proposals/2026-11-14-payments.md`).
