# 40/Love — Store Submission Copy Pack

Everything the consoles ask for, drafted in the brand voice
(`docs/brand-guide.md` §7 — one pun per field, controls say what they do) and
strictly from what the code collects (`mobile/src/api/backend.js`,
`supabase/migrations/`). Placeholders marked [FILL IN] need founder facts.
Version and dates come from the founder; the app is 0.1.0 per `mobile/app.json`.

---

## 1. Apple App Store

### Name (30 char limit)

> **40/Love: Racquet Sports Dating**

30 characters exactly. (The playbook's em-dash version is 31 — one over.)

### Subtitle (30 char limit)

> **The first date is a game.**

25 characters.

### Promotional text (170 char limit — editable without review)

> We're live in Indianapolis. Meet tennis, pickleball, and padel players
> who'd rather rally than sit through another coffee date. Love at first
> serve.

148 characters.

### Full description

> **Meet on the court, not at a bar.**
>
> 40/Love is the dating and social app for people who play racquet sports —
> tennis, pickleball, padel, racquetball, and squash. Skip the "so, what do
> you do?" dinner. Your first date has a net in the middle.
>
> **Three ways to play:**
>
> • DATE — match with singles who share your sport. When you both like each
> other, it's a Match Point.
> • PLAY — find hitting partners at your level. Real skill talk: NTRP for
> tennis, DUPR for pickleball, or Beginner through Competitive.
> • FRIENDS — join local events, socials, and leagues. Some matches aren't
> romantic. They're doubles.
>
> **How it works:**
>
> • Build a profile with your sports, skill level, and photos
> • See compatible players near you — matched by sport, skill, distance, and
> what you're each looking for
> • Chat, then propose a court time right in the conversation: venue, day,
> time. One tap to accept.
> • RSVP to community events around the city
>
> **Built respectfully:**
>
> • 18+ only, enforced at signup
> • Your exact location never leaves your phone — we only ever see a
> neighborhood-level approximation (about 1 km)
> • First names only. No last names, anywhere.
> • Block and report from any profile or conversation; every report is
> reviewed by a human
> • No ads, no tracking, and we never sell your data
> • Delete your account any time, right in Settings
>
> **Indianapolis first.** We're building 40/Love city by city so there are
> real players on the other side of every match — and Indy serves first.
>
> Questions? hello@40love.app

### Keywords (100 char limit, comma-separated, no spaces)

> `pickleball,tennis,padel,squash,racquetball,hitting,partner,singles,court,indianapolis,social,meet`

97 characters. Deliberately excludes words Apple already indexes from the
name/subtitle (racquet, sports, dating, date, game).

### Categories

- **Primary: Lifestyle** (per playbook §4 — Apple has no Dating category)
- **Secondary: Sports** — it's the differentiator and matches real usage.
  (Social Networking is the defensible alternative if Sports feels like a
  stretch at review time.)

### Age rating questionnaire

Answer honestly per question; the dating answer is what sets the rating:

| Question | Answer |
|---|---|
| Made for Kids / kids category | No |
| Cartoon or fantasy violence / realistic violence | None |
| Profanity or crude humor | None (user-generated chat is separate — see UGC) |
| Mature/suggestive themes | Infrequent/Mild (dating context) |
| Sexual content or nudity | None (photo moderation blocks it) |
| Horror/fear themes | None |
| Gambling (simulated or real) | No |
| Unrestricted web access | No (no in-app browser) |
| **App includes dating features / facilitates connections between strangers** | **Yes** |
| User-generated content | Yes — with moderation, blocking, reporting, and a way to contact us (see review notes) |

Expected result: **17+ (Mature)**. Note: Apple revised its age-rating tiers in
2025 (13+/16+/18+ replacing 12+/17+ in some regions/console versions) — accept
whatever the questionnaire yields for dating, never hand-pick a lower tier.
Target audience is 18+ regardless; the app enforces it at signup.

### App Privacy "nutrition label"

Tracking (Apple's definition — data linked with third-party data for
advertising, or shared with data brokers): **No.** Justification from the
code: `mobile/package.json` contains no ad, analytics, or attribution SDK of
any kind. The app talks to our own Supabase backend (a service provider under
our instructions) and — only when the member taps a sign-in button — to
`appleid.apple.com` / Google's sign-in services. Those are *authentication*
SDKs, not advertising or attribution SDKs: no IDFA is requested, no ATT prompt
is needed, no data is combined with third-party data for ad targeting, and
nothing goes to a data broker. This stays true only while sign-in is
implemented with `expo-apple-authentication` + `@react-native-google-signin`
feeding Supabase directly — routing it through Firebase Auth would pull in
analytics SDKs and invalidate both this answer and the "no analytics" claims
in the listing and privacy policy.

Data types collected — all **linked to the user's identity** (everything lives
in rows keyed by account id; there is no anonymous mode), all for **App
Functionality** only, none used for tracking, advertising, or third-party
purposes:

| Apple data type | What it actually is (code reference) | Linked | Purpose |
|---|---|---|---|
| Contact Info → Email Address | Sign-in via one-time email code; no passwords (`signInWithEmail`). May instead arrive from Sign in with Apple (possibly an `@privaterelay.appleid.com` relay address) or Google. Also the waitlist form. | Yes | App Functionality (account) |
| Contact Info → Phone Number | Verified once by SMS at signup (`startPhoneVerification`); stored in auth, never shown to members, never used for marketing — anti-fake-account / ban enforcement only | Yes | App Functionality (account security) |
| Contact Info → Name | **First name only** — `profiles.first_name`; last names don't exist in the schema | Yes | App Functionality |
| Sensitive Info | Gender identity + who the user wants to date (`profiles.gender`, `seeking`) — sexual orientation can be inferred, so declare it | Yes | App Functionality (Date-mode matching) |
| Location → Coarse Location | ~1 km approximation; the client rounds to 2 decimals **before upload** (`upsertMyProfile`), columns are `numeric(5,2)` — precise location never reaches the server | Yes | App Functionality (distance matching) |
| Location → Precise Location | **Not collected** | — | — |
| User Content → Photos or Videos | Profile photos (up to 6), private bucket, moderated before visible | Yes | App Functionality |
| User Content → Other User Content | Bio, availability note, chat messages, court-time proposals, reports filed | Yes | App Functionality (chat content may be reviewed by a human when reported — say so in the policy, already done) |
| Identifiers → User ID | Account UUID (Supabase auth id), plus the provider subject id from Apple/Google sign-in | Yes | App Functionality |
| Identifiers → Device ID | Push-notification token, only if the user allows notifications (`push_tokens`) | Yes | App Functionality (notifications) |
| Usage Data → Product Interaction | Likes/passes/aces, matches, event RSVPs — this is the matching engine, stored server-side (`swipes`, `matches`, `event_rsvps`) | Yes | App Functionality |
| Other Data | Birthdate (`profiles.birthdate`) — 18+ enforcement and age display; never shown raw to other users, only computed age | Yes | App Functionality |

**Not collected** (declare "Data Not Collected" for these): precise location,
physical address, contacts, health & fitness, financial info, purchases,
browsing history, search history, diagnostics/crash data (no crash SDK is
installed), advertising data.

---

## 2. Google Play

### Title (30 char limit)

> **40/Love: Racquet Sports Dating**

### Short description (80 char limit)

> Meet tennis, pickleball & padel players. Date, play, make friends.

66 characters (per playbook §4).

### Full description

> MEET ON THE COURT, NOT AT A BAR.
>
> 40/Love is the dating and social app for people who play racquet sports —
> tennis, pickleball, padel, racquetball, and squash. Skip the "so, what do
> you do?" dinner. Your first date has a net in the middle.
>
> THREE WAYS TO PLAY
>
> ❤ Date — match with singles who share your sport. When you both like each
> other, it's a Match Point.
> ✦ Play — find hitting partners at your level. Real skill talk: NTRP for
> tennis, DUPR for pickleball, or Beginner through Competitive.
> ✦ Friends — join local events, socials, and leagues. Some matches aren't
> romantic. They're doubles.
>
> HOW IT WORKS
>
> • Build a profile with your sports, skill level, and photos
> • See compatible players near you — matched by sport, skill, distance, and
> what you're each looking for
> • Chat, then propose a court time right in the conversation — venue, day,
> time, one tap to accept
> • RSVP to community events around the city
>
> BUILT RESPECTFULLY
>
> • 18+ only, enforced at signup
> • Your exact location never leaves your phone — we only see a
> neighborhood-level approximation (about 1 km)
> • First names only — no last names, anywhere
> • Block and report from any profile or conversation; every report is
> reviewed by a human
> • No ads, no tracking, and we never sell your data
> • Delete your account any time, right in Settings
>
> INDIANAPOLIS FIRST
>
> We're building 40/Love city by city so there are real players on the other
> side of every match — and Indy serves first.
>
> Questions? hello@40love.app

### Category

- **Category: Dating** (exists on Play, unlike Apple — playbook §4)
- Tags: Dating, Sports, Social

### Content rating questionnaire (IARC)

| Question | Answer |
|---|---|
| App category | Social networking / communication — dating app |
| Is this a dating app? | **Yes** |
| Violence, blood, gore | No |
| Sexual content or nudity in app-controlled content | No |
| Profanity in app-controlled content | No |
| Controlled substances | No |
| Gambling | No |
| Users can communicate / exchange content (UGC) | **Yes** — free-form chat between matched users, profile photos and bios; moderated (report + block + human review) |
| Users can share their location | Approximate location is used for matching; exact location is never collected or shared |
| Personal info shared with other users | First name, age, photos, bio, sports — profile content only |

Expected result: **Mature 17+**.

### Target audience & content

- Target age group: **18 and over only.** Do not select any minor age band.
- App is not designed to appeal to children; 18+ is enforced at signup by
  birthdate (client check + database constraint).

### Data Safety form

Global answers:
- **Data encrypted in transit:** Yes (HTTPS to Supabase).
- **Users can request data deletion:** Yes — in-app, Settings → Delete
  account (plus email hello@40love.app).
- **Data shared with third parties:** **None.** Supabase is a service
  provider processing data on our instructions, which Play does not count as
  "sharing". No SDK sends data anywhere else (no ads, no analytics).
- **Committed to the Play Families policy:** N/A (18+ app).

Per data type (Collected / Shared / Purpose / Optional):

| Play data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Personal info → Email address | Yes | No | Account management (one-time-code sign-in) | No — required to sign in |
| Personal info → Phone number | Yes (verified once by SMS at signup; never shown to members) | No | Account management / fraud prevention (keeps the community real people; ban enforcement) | No — required at signup |
| Personal info → User IDs | Yes (Supabase account UUID; plus the Apple `sub` / Google account id when social sign-in is used) | No | Account management | No |
| Personal info → Name | Yes (first name only) | No | App functionality (shown on your profile) | No |
| Personal info → Date of birth ("Other info") | Yes | No | App functionality (18+ enforcement; only your age is shown) | No |
| Personal info → Sexual orientation | Yes (inferable from gender + dating preferences) | No | App functionality (Date-mode matching) | **Yes** — only needed for Date mode; Play/Friends modes work without it |
| Location → Approximate location | Yes (~1 km, rounded on-device before upload) | No | App functionality (showing players and events near you) | **Yes** — deny the permission and the app works without distances |
| Location → Precise location | **No** | — | — | — |
| Photos and videos → Photos | Yes (profile photos) | No | App functionality (your profile; moderated before visible to others) | **Yes** |
| Messages → Other in-app messages | Yes (chat with matches, court-time proposals) | No | App functionality; reported messages may be reviewed by a human moderator | No — required for chat |
| App activity → App interactions | Yes (likes/passes, matches, event RSVPs) | No | App functionality (the matching engine) | No |
| App info and performance | **No** (no crash/diagnostics SDK) | — | — | — |
| Device or other IDs | Yes (push token, only if notifications are enabled) | No | App functionality (notifications) | **Yes** |
| Contacts / Calendar / Files / Audio / Health / Financial / Web browsing | **No** | — | — | — |

---

## 3. Reviewer notes (both stores)

Paste into App Review notes (Apple) and the Play Console "App access" +
review notes fields. Same substance for both.

> **About 40/Love:** a dating and social app for racquet sports players
> (tennis, pickleball, padel, racquetball, squash). 18+ only, enforced at
> signup by birthdate.
>
> **City-by-city launch:** community quality in a dating app depends on
> local density, so 40/Love launches one city at a time, starting with
> Indianapolis, USA. The store listing is US-only; inside the app, the
> community, events, and seeded profiles are Indianapolis-based. The review
> account below is set to Indianapolis and has multiple profiles in range,
> so every feature (discovery, matching, chat, court-time proposals, events)
> is fully exercisable from anywhere.
>
> **Review account:** [FILL IN — email + fixed one-time code, once the
> review account is seeded]
>
> **Sign-in note:** 40/Love offers three ways in, all passwordless: an
> emailed one-time code, Sign in with Apple, and Continue with Google.
> Sign in with Apple is offered wherever Google is, per Guideline 4.8. So that you don't need access to a live inbox, the review
> account above accepts the fixed code listed with the credentials at the
> verification step. [FILL IN — confirm the fixed-OTP bypass is configured
> for the review account before submission.]
>
> **Phone verification note:** new signups verify a phone number by SMS
> (anti-fake-account measure; the number is never shown to other members).
> The review account is already past this step, so no phone or SMS access
> is needed to review. [FILL IN — confirm the review account is seeded
> with a verified phone, or configure Supabase's test-phone fixed OTP for
> it, before submission.]
>
> **Safety features, where to find them:**
> - Block / Report: on any profile card in the Discover deck, and from any
>   conversation — both open a menu with "Report <name>" and "Block
>   <name>". Blocking is immediate and mutual; reports go to a moderation
>   queue reviewed by a human (24h target).
> - Account deletion: Settings → "Delete account" (bottom of the screen).
>   Deletes the account and its data in-app; no email or website required.
> - Photo moderation: newly uploaded photos are held as "pending" and only
>   shown to other users after approval.
> - 18+ gate: birthdate at signup; under-18 birthdates are rejected by both
>   the client and a database constraint.
>
> **Privacy:** the app collects an email, a phone number (verified once by
> SMS at signup, never shown to members), first name (no last names exist in
> the product), birthdate, sports/skill, photos, and an approximate location
> rounded to ~1 km on the device — exact coordinates never reach our
> servers. No ads, no tracking SDKs, no data sale. Privacy policy:
> [FILL IN — https://<domain>/privacy once deployed] · Support:
> hello@40love.app

---

## 4. Release notes — v0.1

For both stores' "What's new" field:

> Our first serve. 40/Love v0.1 brings:
>
> • Three modes — Date, Play, and Friends
> • Matching by sport, skill (NTRP / DUPR), and distance
> • Chat with court-time proposals: venue, day, time, one tap to accept
> • Local events and RSVPs
> • Block, report, and full account deletion in Settings
>
> Indianapolis first. See you on the court.

---

## Open items before any form is filed as final

1. Deploy `/privacy` and `/terms` (both consoles require the live URL).
2. ~~Fix `delete_account()` to also purge the user's photo objects from
   storage~~ — done (migration `20260806000006_privacy_hardening.sql`).
3. Seed the review account + configure its fixed OTP (email AND phone —
   Supabase supports test phone numbers with a fixed code); fill the
   [FILL IN]s.
4. Configure the SMS provider (Twilio) in Supabase before any live build
   ships — see `docs/backend-setup.md` — or signups will stall at the
   phone step.
5. If the app ever adds analytics, crash reporting, precise location, or
   any new data type: **both privacy forms must be re-filed before the
   next release.**
