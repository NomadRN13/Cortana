# 40/Love

**Love at first serve.** A dating and social app for people who play racquet
sports — tennis, pickleball, padel, racquetball, and squash — where the first
date is a game instead of dinner.

Three modes, one app:

- ❤️ **Date** — find romantic matches through the sport you already love
- 🎾 **Play** — find hitting and practice partners at your level
- 👥 **Friends** — meet people for leagues, mixers, and social play

## What's in this repo

| Path | What it is |
|------|------------|
| [`app/index.html`](app/index.html) | **Clickable app prototype** — the full MVP flow: onboarding, Discover (swipe + propose a match), Matches & chat, Events, Profile, Settings. Open it in any browser; no install, no server. |
| [`landing/index.html`](landing/index.html) | **Waitlist landing page** — the pre-launch site: value prop, three modes, how it works, FAQ, and an email waitlist form. |
| [`docs/business-plan.md`](docs/business-plan.md) | **Business plan** — market, competition, validation plan, go-to-market, revenue model, build options, 12-month milestones, risks. |
| [`docs/feature-roadmap.md`](docs/feature-roadmap.md) | **Feature roadmap** — MVP scope and the releases after it, with success metrics per release. |
| [`docs/pitch-deck.md`](docs/pitch-deck.md) | **Pitch deck** — 12 slides with speaker notes, ready to turn into a designed deck. |
| [`docs/brand-guide.md`](docs/brand-guide.md) | **Brand & design guide** — the 40/Love identity: palette, typography, wordmark, voice. Everything above is built from it. |
| [`docs/networking-team.md`](docs/networking-team.md) | **Agentic networking team** — six AI agents (defined in [`.claude/agents/`](.claude/agents/)) that run community-building: city scouting, club partnerships, social content, waitlist emails, mixer planning, and validation scoring. Agents draft; you send. |
| [`docs/system-architecture.md`](docs/system-architecture.md) | **System architecture** — the technical blueprint for the real app: data model, matching engine, chat & court proposals, trust & safety, notifications, analytics, and a prototype→production map. Hand this plus the prototype to whoever builds the MVP. |

## Try the prototype

Download or clone the repo and open `app/index.html` in a browser (double-click
works). On a desktop it renders inside a phone frame; on a phone it fills the
screen. It's a self-contained demo — profiles and matches are sample data, and
your onboarding profile is saved locally in your browser.

The landing page works the same way: open `landing/index.html`.

## Where this fits in the plan

The startup plan runs validate → design → MVP → community → one-city launch.
This repo covers the design-and-materials layer:

1. **Validate the idea** — use the landing page to collect waitlist signups and
   the interview script in the business plan (§ Validation plan).
2. **Show, don't describe** — the clickable prototype is the thing to put in
   front of players, clubs, and potential partners.
3. **Stay focused** — the roadmap says what's in the MVP and, just as
   important, what isn't.
4. **Raise or partner later** — the pitch deck and business plan are the
   starting documents when that conversation happens.

## Status

Concept / pre-validation. Nothing here is a shipped product yet — the
prototype is a design artifact for user interviews and partner conversations.
