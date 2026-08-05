# 40/Love — App Store & Google Play Launch Guide

How to get 40/Love onto the Apple App Store and Google Play: accounts,
costs, the build-and-submit flow, and — most important — the dating-app
policy requirements that decide whether you get approved. Written for a
non-engineer founder; the technical steps assume the Expo app in `mobile/`.

## 0. The honest sequencing

The stores don't list prototypes. Both require a working app, and a dating
app additionally needs real accounts, working chat, and moderation before
either store will approve it. So the realistic order is:

1. **Now:** run the demo app on your own phone via Expo Go (5 minutes,
   free, instructions in `mobile/README.md`) — great for showing clubs and
   players.
2. **Next:** wire the backend (`docs/system-architecture.md`) so accounts,
   matching, and chat are real.
3. **Then:** closed testing — TestFlight (iOS) and Play Internal Testing —
   with mixer attendees. This is your Indy alpha.
4. **Then:** store review and public launch, gated to Indianapolis.

You can and should do step 1 today. Steps 2–4 are the MVP build.

## 1. Accounts you need (start these early)

| Account | Cost | Time to get | Notes |
|---|---|---|---|
| Apple Developer Program | $99/year | 1–2 days (up to 2 weeks if enrolling as a company) | Enrolling as an LLC needs a D-U-N-S number (free, but slow — request it first). Individual enrollment is faster; you can migrate later. |
| Google Play Console | $25 one-time | 1–3 days | New personal accounts must run a closed test with 12+ testers for 14 days before production access — your mixer alpha satisfies this. |
| Expo (EAS) | Free tier is enough to start | Instant | Cloud-builds the iOS app without owning a Mac. |

Also needed before submission: a **privacy policy URL** and a **support
contact** (host both on the 40/Love site — the landing page repo works),
and a **terms of service**. For a dating app these are checked, not
optional. Budget a legal review pass.

## 2. Build & submit flow (once the MVP is real)

All from `mobile/` — no Mac or Android Studio required:

```bash
eas build --profile production --platform all   # produces .ipa (iOS) + .aab (Android)
eas submit --platform ios                       # uploads to App Store Connect
eas submit --platform android                   # uploads to Play Console
```

Then in each console: create the app listing, attach the build to a
release, complete the questionnaires (below), and submit for review.

**Review times:** Apple typically ~1–3 days; Google typically 1–7 days
(longer for new accounts and for dating apps). Expect at least one
rejection on the first try — it's normal; fix and resubmit.

## 3. Dating-app policy requirements — read this twice

Both stores treat dating as a sensitive category. These are the things
that get dating apps rejected, and how 40/Love already answers them:

| Requirement | Where it's enforced | 40/Love's answer |
|---|---|---|
| User-generated-content moderation: block, report, and act on abuse | Apple 1.2 · Play UGC policy | Block/report shipped in the design (prototype + mobile app); moderation queue in the architecture (§6). A human must actually review reports — that's you at first. |
| Age gating: 18+ only | Both | Birthdate at signup; rating questionnaires set to Mature 17+ (Apple) / Mature (Play). |
| Account deletion **in the app** | Apple 5.1.1(v) · Play account-deletion policy | Must be a Settings button, not an email request. In the architecture (§9); make sure it ships in v1. |
| Privacy questionnaires: declare every data type collected | App Privacy "nutrition labels" · Play Data Safety form | The architecture's minimal-PII design (coarse location only, no last names) makes these forms short and honest. Fill them accurately — mismatches trigger rejections. |
| No surprise subscriptions | Both | MVP is free; when premium arrives it must use in-app purchase (stores take 15–30%), with clear pricing. |
| Real content at review time | Apple 2.1 | Reviewers log into a dating app with a test account. Provide one pre-seeded with a few profiles in range and include notes: "Community launches city-by-city; review account is set to Indianapolis." |

One more Apple-specific note: thin apps that are just a website wrapper get
rejected under guideline 4.2 (minimum functionality) — this is why the path
is the native Expo app, not wrapping `app/index.html`.

## 4. Store listing (prep while the backend is built)

Both stores need:

- **Name:** 40/Love — Racquet Sports Dating (name ≤30 chars)
- **Subtitle/short description:** "The first date is a game." / "Meet
  tennis, pickleball & padel players. Date, play, make friends."
- **Icon:** `mobile/assets/icon.png` (already generated from the brand art)
- **Screenshots:** 5–8 per platform (iPhone 6.7" and 6.5" sizes for Apple;
  phone + optional tablet for Play). Take them from the real app on device;
  the marketing-panel composition from the prototype makes a great framing
  device.
- **Feature graphic (Play only):** 1024×500 — the "More than a match. A
  community." panel is exactly this shape of content.
- **Category:** Lifestyle (Apple allows Lifestyle; "Dating" exists on Play).
- **Keywords (Apple):** pickleball, tennis, padel, dating, hitting partner,
  racquet, Indianapolis…

## 5. The Indy-first launch inside the stores

- Both stores let you limit country availability but not city — so the app
  gates by city inside the product (waitlist → invite codes), exactly as the
  landing page promises. Reviewers must still be able to get in: keep a
  reviewer bypass code in the review notes.
- **TestFlight** (up to 10,000 external testers) and **Play closed tracks**
  are your alpha/beta channels — invite mixer attendees by email list.
  This doubles as Play's required 14-day/12-tester test.
- Launch day is a switch: promote the tested build to production on both
  consoles once the Indy community is seeded.

## 6. Costs summary

| Item | Cost |
|---|---|
| Apple Developer | $99/yr |
| Google Play | $25 once |
| EAS builds | Free tier to start; ~$19/mo if you build often |
| Backend (Supabase) | Free tier through alpha; ~$25/mo at beta |
| Privacy policy/ToS legal review | ~$500–2,000 one-time |
| **Store presence total, year one** | **~$150–300 + legal** |

The real cost remains the MVP build itself (business plan §10).

## 7. Checklist

**Today (no backend needed):**
- [ ] Run the demo on your phone with Expo Go (`mobile/README.md`)
- [ ] Request D-U-N-S number if launching as an LLC
- [ ] Enroll: Apple Developer + Google Play Console + Expo account
- [ ] Put a privacy policy + support email on the 40/Love site

**Before submission (with the backend):**
- [ ] Real auth, matching, chat; in-app account deletion
- [ ] Human moderation flow for reports (24h SLA)
- [ ] `eas init` (real project ID), fill `eas.json` placeholders
- [ ] Screenshots, descriptions, data-safety/privacy forms
- [ ] Seeded reviewer account + review notes
- [ ] TestFlight + Play closed test with mixer attendees (14+ days)

**Launch:**
- [ ] Promote to production on both stores
- [ ] Waitlist email: "We're live in Indianapolis"
