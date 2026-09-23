# 40/LOVE — The Agent Team

Ten AI agents, defined in `.claude/agents/`, split into two crews: the
**networking crew** that builds the Indianapolis community (Phases 1 and 6
of the startup plan) and the **product & launch crew** that ships the app.
Any Claude Code session opened on this repo can use them — just ask for an
agent by name and give it a task.

## Product & launch crew

| Agent | Role | Typical ask |
|---|---|---|
| `backend-engineer` | Evolves the Supabase backend as tested migrations; keeps RLS airtight and the app's API layer in sync | "Have backend-engineer add a favorites table." |
| `qa-tester` | Runs automated checks, writes beta test plans, triages tester feedback into a bug list | "Have qa-tester write the TestFlight round-1 test plan." |
| `release-manager` | Owns the store checklist, listing copy, privacy questionnaires, review notes | "Ask release-manager what's blocking launch." |
| `safety-support` | Triage recommendations for moderation reports, support reply drafts, community guidelines & code of conduct | "Have safety-support draft the event code of conduct." |

Hard lines for this crew: backend-engineer never touches a production
database; qa-tester reports failures verbatim and doesn't fix product code;
release-manager never submits builds; safety-support recommends — a human
makes every enforcement decision.

## Networking crew

| Agent | Role | Typical ask |
|---|---|---|
| `community-scout` | Maps a city's racquet scene: clubs, leagues, online communities, coaches, influencers → ranked target list | "Use community-scout to scout Austin's racquet scene." |
| `club-partnerships` | Turns target lists into personalized outreach drafts and runs the partner pipeline | "Have club-partnerships draft outreach to the top 5 Austin targets." |
| `social-content` | Weekly IG/TikTok calendars and post copy in the brand voice; stages Buffer drafts | "Ask social-content for next week's content calendar." |
| `waitlist-community` | Welcome/nurture emails, mixer invites, interview recruiting | "Have waitlist-community draft the welcome email sequence." |
| `mixer-coordinator` | Designs 40/LOVE Social Mixers: formats, run-of-show, checklists, signup copy | "Use mixer-coordinator to plan a 24-person pickleball mixer for two courts." |
| `validation-analyst` | Scores interview + waitlist data against the business plan's go/no-go criteria | "Have validation-analyst score these 12 interview notes." |

Every agent reads `docs/brand-guide.md` (voice, palette) and works from
`docs/business-plan.md` (strategy, interview questions, success criteria), so
output stays consistent without re-explaining the project each time.

## The golden rule: humans send, agents draft

No agent ever sends an email, DM, post, or invite to a real person. They
produce **drafts** — Gmail drafts, Buffer ideas/draft posts, files in
`outreach/` — and the founder reviews and sends. This is deliberate:

- Outreach from a founder is authentic; outreach from a bot is spam.
- One bad automated blast can burn a small city's racquet community — the
  only market we have.
- Consent matters: only waitlist opt-ins get emails, every sequence has an
  unsubscribe, and no agent scrapes personal contact info.

## How the agents chain

```
community-scout ──► club-partnerships ──► mixer-coordinator
   (targets.md)        (pipeline.md)        (event plan)
                                                 │
        social-content ◄── promotes ─────────────┤
        waitlist-community ◄── invites ──────────┘
                     │
        validation-analyst ◄── interview notes, debriefs, waitlist data
                     │
              go / no-go scorecard
```

A typical launch-city cycle:

1. **Scout** a candidate city → `outreach/<city>/targets.md` + scorecard.
2. **Partnerships** drafts outreach to the top targets; founder sends;
   pipeline tracks replies.
3. A club says yes → **mixer-coordinator** plans the event;
   **social-content** and **waitlist-community** promote it.
4. At the mixer: collect signups and interview volunteers.
5. **Validation-analyst** scores everything against the business-plan
   criteria → the go/no-go call for the MVP build.

## Weekly operating rhythm (suggested)

- **Monday** — validation-analyst: scorecard refresh from the weekend's
  events/interviews; pick the week's focus.
- **Tuesday** — club-partnerships: draft the week's outreach batch and
  follow-ups; founder sends in one sitting.
- **Wednesday** — social-content: next week's calendar; founder approves;
  stage to Buffer.
- **Thursday** — mixer-coordinator: next event locked (venue, format,
  signup page live); waitlist-community drafts the invite.
- **Friday** — community-scout: refresh targets with anything new; log the
  week in the pipeline.

Two focused hours of founder review/sending per week runs the whole engine.

## File conventions

Working files live in `outreach/` (created on first use):

```
outreach/
  <city-slug>/targets.md        # community-scout
  <city-slug>/pipeline.md       # club-partnerships
  content/week-of-<date>.md     # social-content
  email/<sequence-name>.md      # waitlist-community
  events/<date>-<venue>.md      # mixer-coordinator
  validation-scorecard.md       # validation-analyst
```

Committing these files is recommended — the outreach history becomes part of
the company's memory. **Exception:** never commit files containing personal
contact details of individuals; keep raw interview notes and email exports
out of the repo (the analyst's rules already strip identifying details from
its summaries).

## Connected tools

When the session has these connectors, agents use them — always in
draft/staging mode:

- **Gmail** — outreach and community emails saved as drafts for review.
- **Buffer** — posts staged as ideas/drafts; publishing needs explicit
  approval per batch.
- **Google Calendar** — event holds on the founder's calendar after date
  approval; no external invites.
- **Web search** — community-scout's primary research tool.

Without a connector, agents fall back to writing everything into `outreach/`
files — nothing blocks on tooling.
