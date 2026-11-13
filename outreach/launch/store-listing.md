# RSVPlay — Store Submission Copy Pack

Everything the consoles ask for, drafted in the brand voice
(`docs/brand-guide.md` §7 — one pun per field, controls say what they do) and
strictly from what the code collects (`mobile/src/api/backend.js`,
`supabase/migrations/`). Placeholders marked [FILL IN] need founder facts.
Version and dates come from the founder; the app is 0.1.0 per `mobile/app.json`.

---

## 1. Apple App Store

### Name (30 char limit)

> **RSVPlay: Racquet Sport Socials**

30 characters exactly. (The positioning note of 2026-11 keeps "Dating" out of the title.)

### Subtitle (30 char limit)

> **Serve. Rally. Connect.**

22 characters.

### Promotional text (170 char limit — editable without review)

> Now live in 12 cities. RSVP to pickleball, tennis and padel socials, show up
> and play, and keep the people you meet. Serve. Rally. Connect.

139 characters.

### Full description

> **RSVP. Show up. Play.**
>
> RSVPlay is the app for paddle and racquet sports — pickleball, tennis,
> padel, racquetball, and squash. RSVP to a social, a league night, a
> tournament or a pickup game, show up and play, then keep the people you met.
>
> **Events first:**
>
> • Socials, league nights, tournaments and pickup games in your city
> • Check in with the host's code when you arrive
> • The people you shared a court with become your crew
> • Ladder leagues and tournament brackets, with the results on the board
>
> **Three modes, your choice:**
>
> • PLAY — find hitting partners at your level. Real skill talk: NTRP for
> tennis, DUPR for pickleball, or Beginner through Competitive.
> • DATE — opt in if you'd like to. Off by default, and only people who turned
> it on too can see it on you.
> • FRIENDS — keep the people you'd play with again.
>
> **How it works:**
>
> • Build a profile with your sports, skill level, and photos
> • RSVP to an event and accept its waiver; check in when you get there
> • See players near you — matched by sport, skill, distance, and what you're
> each looking for
> • Chat, then propose a court time right in the conversation: venue, day,
> time. One tap to accept.
>
> **Built respectfully:**
>
> • 18+ only, and every account is phone-verified
> • Your exact location never leaves your phone — we only ever see a
> neighborhood-level approximation (about 1 km)
> • First names only. No last names, anywhere.
> • New photos are reviewed before other players see them
> • Block and report from any profile or conversation; every report is
> reviewed by a human
> • No ads, no tracking, and we never sell your data
> • Delete your account any time, right in Settings
>
> **City by city.** RSVPlay is open in Indianapolis, Los Angeles, San Diego,
> Bakersfield, Phoenix, Seattle, Spokane, Dallas, Houston, Orlando, Miami, and
> Washington, DC — and you see events and players in the cities you play in,
> because a game needs people who are actually near you.
>
> Questions? hello@rsvplay.app

### Keywords (100 char limit, comma-separated, no spaces)

> `pickleball,tennis,padel,squash,racquetball,hitting,partner,singles,court,doubles,social,meet`

93 characters. Dropped the city name now that RSVPlay spans 12 metros —
per-city keywords belong in localized listings, not the base one. Deliberately excludes words Apple already indexes from the
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
| Contact Info → Phone Number | Verified once by SMS at signup (`startPhoneVerification`); stored in auth, never shown to members, never used for marketing — anti-fake-account / ban enforcement only; a one-way hash is retained after a ban or a delete-while-suspended (`banned_phones`) | Yes | App Functionality (account security) |
| Contact Info → Name | **First name only** — `profiles.first_name`; last names don't exist in the schema | Yes | App Functionality |
| Sensitive Info | Gender identity + who the user wants to date (`profiles.gender`, `seeking`) — sexual orientation can be inferred, so declare it | Yes | App Functionality (Date-mode matching) |
| Location → Coarse Location | ~1 km approximation; the client rounds to 2 decimals **before upload** (`upsertMyProfile`), columns are `numeric(5,2)` — precise location never reaches the server | Yes | App Functionality (distance matching) |
| Location → Precise Location | **Not collected** | — | — |
| User Content → Photos or Videos | Profile photos (up to 6), private bucket, moderated before visible | Yes | App Functionality |
| User Content → Other User Content | Bio, availability note, chat messages, court-time proposals, reports filed | Yes | App Functionality (chat content may be reviewed by a human when reported — say so in the policy, already done) |
| Identifiers → User ID | Account UUID (Supabase auth id), plus the provider subject id from Apple/Google sign-in | Yes | App Functionality |
| Identifiers → Device ID | Push-notification token, only if the user allows notifications (`push_tokens`), plus a random per-install tag and device name in `devices` so the member can see and sign out their own phones. No hardware identifier or IDFA is read. | Yes | App Functionality (notifications, account security) |
| Usage Data → Product Interaction | Likes/passes/aces, matches, event RSVPs, event check-in time and waiver acceptance (time + version), crew adds, ladder-league membership, challenges and win/loss, membership tier — stored server-side (`swipes`, `matches`, `event_rsvps`, `waiver_acceptances`, `crew_adds`, `league_members`, `league_challenges`, `profiles.tier`) | Yes | App Functionality |
| Other Data | Device timezone name (`profiles.timezone`) — quiet hours for notifications; not shown to members | Yes | App Functionality |
| Other Data | Birthdate (`profiles.birthdate`) — 18+ enforcement and age display; never shown raw to other users, only computed age | Yes | App Functionality |

**Not collected** (declare "Data Not Collected" for these): precise location,
physical address, contacts, health & fitness, financial info, purchases,
browsing history, search history, diagnostics/crash data (no crash SDK is
installed), advertising data.

---

## 2. Google Play

### Title (30 char limit)

> **RSVPlay: Racquet Sport Socials**

### Short description (80 char limit)

> Pickleball, tennis & padel socials. Play, make friends, date if you like.

73 characters.

### Full description

> RSVP. SHOW UP. PLAY.
>
> RSVPlay is the app for paddle and racquet sports — pickleball, tennis,
> padel, racquetball, and squash. RSVP to a social, a league night, a
> tournament or a pickup game, show up and play, then keep the people you met.
>
> EVENTS FIRST
>
> • Socials, league nights, tournaments and pickup games in your city
> • Check in with the host's code when you arrive
> • The people you shared a court with become your crew
> • Ladder leagues and tournament brackets, with the results on the board
>
> THREE MODES, YOUR CHOICE
>
> ✦ Play — find hitting partners at your level. Real skill talk: NTRP for
> tennis, DUPR for pickleball, or Beginner through Competitive.
> ✦ Date — opt in if you'd like to. Off by default, and only people who turned
> it on too can see it on you.
> ✦ Friends — keep the people you'd play with again.
>
> HOW IT WORKS
>
> • Build a profile with your sports, skill level, and photos
> • RSVP to an event and accept its waiver; check in when you get there
> • See players near you — matched by sport, skill, distance, and what you're
> each looking for
> • Chat, then propose a court time right in the conversation — venue, day,
> time, one tap to accept
>
> BUILT RESPECTFULLY
>
> • 18+ only, and every account is phone-verified
> • Your exact location never leaves your phone — we only see a
> neighborhood-level approximation (about 1 km)
> • First names only — no last names, anywhere
> • New photos are reviewed before other players see them
> • Block and report from any profile or conversation; every report is
> reviewed by a human
> • No ads, no tracking, and we never sell your data
> • Delete your account any time, right in Settings
>
> INDIANAPOLIS FIRST
>
> We're building RSVPlay city by city so there are real players at every
> event — and Indy serves first.
>
> Questions? hello@rsvplay.app

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
  account.
- **Account deletion URL** (Play requires a web page, not just the in-app
  button): `https://rsvplay.netlify.app/delete-account/`
  — the live site. `rsvplay.app` is not registered; paste a URL that 404s and
  the submission is rejected. Update this and the privacy URL below together
  if the site ever moves to a custom domain.
  (source: `landing/delete-account.html`, deployed by `scripts/build-site.sh`).
  It documents both routes — the in-app button and an email request for people
  who have already uninstalled — and lists, table by table, exactly what is
  deleted. Every row in that table is asserted by `supabase/tests/backend.sql`
  §10, so the page cannot quietly drift away from what the code does.
- **Data shared with third parties:** **None.** Supabase is a service
  provider processing data on our instructions, which Play does not count as
  "sharing". No SDK sends data anywhere else (no ads, no analytics).
- **Committed to the Play Families policy:** N/A (18+ app).

Per data type (Collected / Shared / Purpose / Optional):

| Play data type | Collected | Shared | Purpose | Optional? |
|---|---|---|---|---|
| Personal info → Email address | Yes | No | Account management (one-time-code sign-in) | No — required to sign in |
| Personal info → Phone number | Yes (verified once by SMS at signup; never shown to members; a one-way hash is retained after a ban or a delete-while-suspended) | No | Account management / fraud prevention (one-time check that a new member is a real person) | No — required at signup |
| Personal info → User IDs | Yes (Supabase account UUID; plus the Apple `sub` / Google account id when social sign-in is used) | No | Account management | No |
| Device or other IDs | Yes (a random per-install tag and the device's own name, for the sign-out-a-device list; plus the push token when notifications are on) | No | Account management / fraud prevention; notifications | No — the device list is core to account security, so answer No overall even though the push token alone is optional |
| Personal info → Name | Yes (first name only) | No | App functionality (shown on your profile) | No |
| Personal info → Date of birth ("Other info") | Yes | No | App functionality (18+ enforcement; only your age is shown) | No |
| Personal info → Sexual orientation | Yes (inferable from gender + dating preferences) | No | App functionality (Date-mode matching) | **Yes** — only needed for Date mode; Play/Friends modes work without it |
| Location → Approximate location | Yes (~1 km, rounded on-device before upload) | No | App functionality (showing players and events near you) | **Yes** — deny the permission and the app works without distances |
| Location → Precise location | **No** | — | — | — |
| Photos and videos → Photos | Yes (profile photos) | No | App functionality (your profile; moderated before visible to others) | **Yes** |
| Messages → Other in-app messages | Yes (chat with matches, court-time proposals) | No | App functionality; reported messages may be reviewed by a human moderator | No — required for chat |
| App activity → App interactions | Yes (likes/passes, matches, event RSVPs, event check-in and waiver acceptance, crew adds, ladder-league membership and results, membership tier) | No | App functionality | No |
| App activity → Other actions | Yes (device timezone name, for notification quiet hours; not shown to members) | No | App functionality | No |
| App info and performance | **No** (no crash/diagnostics SDK) | — | — | — |
| Contacts / Calendar / Files / Audio / Health / Financial / Web browsing | **No** | — | — | — |

---

## 3. Reviewer notes (both stores)

Paste into App Review notes (Apple) and the Play Console "App access" +
review notes fields. Same substance for both.

> **About RSVPlay:** an events-first social app for paddle and racquet sports players, with opt-in dating
> (tennis, pickleball, padel, racquetball, squash). 18+ only, enforced at
> signup by birthdate.
>
> **City-by-city launch:** community quality in an events app depends on
> local density, so RSVPlay operates city by city. It is currently open in
> 12 US metros: Indianapolis, Los Angeles, San Diego, Bakersfield, Phoenix,
> Seattle, Spokane, Dallas, Houston, Orlando, Miami, and Washington, DC.
> Members choose one or more cities at signup (the first is pre-selected
> from an approximate location) and are matched only with players who share
> a city with them. The store listing is US-only. The review
> account below is set to Indianapolis and has multiple profiles in range,
> so every feature (discovery, matching, chat, court-time proposals, events)
> is fully exercisable from anywhere — in Settings > Cities, tap another
> city to add it, then tap Indianapolis to drop it, to see the scoping work
> (the app keeps at least one city selected, so add before you drop).
>
> **Review account:** email `review@rsvplay.app`, code `[FILL IN — the
> six digits set in docs/store-submission.md §4]`. Enter the email on the
> sign-in screen, tap Send code, then type those six digits. No email is
> sent to this address.
>
> **Sign-in note:** RSVPlay offers three ways in, all passwordless: an
> emailed one-time code, Sign in with Apple, and Continue with Google.
> Sign in with Apple is offered wherever Google is, per Guideline 4.8. So that you don't need access to a live inbox, the review
> account above accepts the fixed code listed with the credentials at the
> verification step.
>
> **Phone verification note:** new signups verify a phone number by SMS
> (anti-fake-account measure; the number is never shown to other members).
> At the "Prove you're real" step, use the test number `(317) 555-0100`
> and the code `[FILL IN — the fixed code from docs/store-submission.md
> §4]`. No SMS is sent and no phone is needed.
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
> https://rsvplay.netlify.app/privacy/ · Support: hello@rsvplay.app

---

## 4. Release notes — v0.1

For both stores' "What's new" field:

> Our first serve. RSVPlay v0.1 brings:
>
> • Three modes — Play, Date, and Friends
> • Matching by sport, skill (NTRP / DUPR), and distance
> • Chat with court-time proposals: venue, day, time, one tap to accept
> • Local events and RSVPs
> • Block, report, and full account deletion in Settings
>
> Open in 12 cities. See you on the court.

---

## Open items before any form is filed as final

1. Deploy `/privacy`, `/terms` and `/delete-account` (the consoles require
   the live URLs; all three are built into `site/`).
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
   - Not triggered by the website. Netlify Analytics (server logs, on
     rsvplay.netlify.app) and the demo funnel (`record_demo_step`, in the web
     prototype) are both **website-only** — neither ships in the app binary,
     and `mobile/` contains no analytics call of any kind. Verified by grep,
     not assumed. Both store forms describe the app, so both stay as filed.
     The privacy policy is shared between app and website, so it does cover
     them, under "Visits to our website" and "How the demo is used".
6. ~~Apple token revocation on account deletion (Guideline 5.1.1(v))~~ —
   built (`supabase/functions/apple-auth` + migration
   `20260806000016_apple_identities.sql`). **Founder step before the first
   iOS submission that includes Sign in with Apple:** deploy the function and
   set the four `APPLE_*` secrets — see `docs/backend-setup.md`. Unset, it
   no-ops, so the feature is not wired up until you do this.
