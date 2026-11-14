# RSVPlay — security posture

What protects members' data, what proves it, and what is not done yet. Owned
by the `security-lead` agent; changed only with evidence. Last reviewed
2026-11-14.

**How to read "256-bit encryption".** There is no single switch. Data is
encrypted in three places, each by the system that holds it, and each row
below names the algorithm and the proof. Nothing here is a claim the kit
cannot back up.

## 1. What is encrypted, where, and how

| Data | Where | Protection | Proof |
|---|---|---|---|
| Everything in the database: profiles, messages, RSVPs, reports, photos | Supabase (Postgres and file storage, US East) | **AES-256 at rest**, by Supabase on every project; encrypted backups | Supabase's published security practice; nothing to configure |
| Everything between the phone, the website and the database | In transit | **TLS 1.2 or newer** (HTTPS only; the ciphers Supabase and Cloudflare negotiate are AES-256-GCM, AES-128-GCM or ChaCha20) | The app has only an `https://` address; the website sends `Strict-Transport-Security` (`landing/_headers`) |
| The sign-in session on the phone | The phone's secure store | **Keychain on iPhone; AES-256-GCM under an Android Keystore key on Android** (the module's own source: `AES/GCM/NoPadding`, 256-bit key) | `mobile/src/lib/secureStorage.js`, `tests/app/secure-storage.test.js` |
| The cached profile (includes gender and who they are looking for), settings and saved list on the phone | The phone's secure store | Same as the session | Same; `mobile/src/state.js` has no plain-storage call left |
| Banned phone numbers | Database | Never stored: only a **SHA-256** fingerprint | `supabase/migrations/20260806000034_phone_bans.sql`, harness §10c |
| Passwords | Nowhere | Members have none: sign-in is a one-time code, Apple or Google | `mobile/src/api/backend.js` |
| Card numbers | Nowhere | The app takes no payments today. If it does, a processor holds the card and RSVPlay never sees it (`docs/proposals/2026-11-14-payments.md`) | — |

Not encrypted beyond the above, on purpose: the event check-in code (a short
code the host reads out, readable only by the desk, replaced per event), and
the random install id used to list "your devices".

The app ships no encryption code of its own; it uses the phone's and the
servers'. That keeps the App Store export answer at "exempt"
(`mobile/app.json`, `usesNonExemptEncryption: false`).

## 2. Who can read what (access control)

- **The database decides, not the app.** Every table has row-level security
  on (asserted for every table in the harness, §11), and every rule in
  `docs/rules-and-stops.md` is enforced there. The key inside the app and the
  website is public by design; the harness acts as a stranger and as a member
  holding that key and asserts what each is refused.
- **The master key** (`service_role`) exists only inside Supabase and its
  edge functions. `scripts/go-live.sh` refuses it if pasted; the health check
  fails if it appears in the app, the website or the desk.
- **Admins** are a list in the database that can only be changed from the
  Supabase dashboard. The desk page is public code; it can do nothing for
  someone who is not on that list.
- **Photos** sit in a private bucket and are shown through short-lived signed
  links, only after the desk approves them.
- **Location** never reaches the server exactly: rounded to about 1 km on the
  phone, and distances are computed between grid squares.

## 3. Threat model

| Attacker | Wants | What stops them | Proof |
|---|---|---|---|
| A stranger with the public key | Members' data; a list of who signed up | Row-level security; functions refuse `anon`; the waitlist never says whether an address exists | harness §9, §10f-ii; `tests/web/waitlist.test.js` |
| A member | Another member's settings, attendance, real ladder rung, who blocked whom | Column grants, function-only reads, the ladder each member sees | harness §9f–9h, §10 |
| A banned or suspended member | To come back or keep acting | The ban sticks to the phone number; suspension is checked in every function; deletion keeps the fingerprint | harness §10c |
| A bot or a harasser | Volume | Verified phone required to reach anyone; rate limits on swipes, messages and reports, counted on the server's clock | harness §10c-ii, §10d |
| Someone holding a member's unlocked or stolen phone | The session, the profile | The phone's secure store; "sign out this device" from another phone; deleting the app signs the phone out | `tests/app/secure-storage.test.js`, Settings → Devices |
| A hostile web page | To frame the site or inject script | No framing, a content policy that loads and talks to nothing but this site and Supabase | `tests/web/headers.test.js` |
| A compromised collaborator or founder account | The code, the domain, the database | Two-factor sign-in and least-privilege roles (§5) — **owner action, not yet confirmed** | checklist below |
| A compromised vendor | Whatever that vendor holds | Minimal data per vendor; keys can be rotated (`docs/incident-response.md`) | — |

## 4. The website

`landing/_headers` (copied to `site/_headers`) sets HTTPS-only for a year,
no MIME sniffing, no framing, a strict referrer policy, no camera, microphone,
location or payment access, and a content policy with no outside script, no
`eval`, and connections only to this site and `*.supabase.co`. The desk is
additionally never indexed and never cached. `/.well-known/security.txt`
tells researchers where to report (`security@rsvplayapp.com`).

## 5. Accounts — the owner's checklist

The strongest lock in this kit is worth nothing if an owner account is taken
over. Tick each when done; `security-lead` re-asks weekly.

- [ ] **Two-factor sign-in on every account that can change RSVPlay:**
      GitHub, Supabase, Cloudflare, the website host, Expo, Apple ID,
      Google (Play Console and Gmail), the domain's email inbox.
- [ ] **Collaborators at the lowest role that works.** On Cloudflare:
      not Super Administrator. On Supabase: Developer, not Owner.
- [ ] `security@rsvplayapp.com` forwards to an inbox someone reads
      (Cloudflare → Email Routing → add `security`).
- [ ] The GitHub repository's visibility is a decision, not a default. It is
      public today: the code, the plan and the outreach drafts are readable
      by anyone. No secret is in the launch branch or its history (scanned
      2026-11-14; `main` was not scanned).
- [ ] The Supabase database password and every recovery code are in a
      password manager, not in a file or an email.
- [ ] **Supabase → Project Settings → Database → SSL:** "Enforce SSL on
      incoming connections" is on.
- [ ] **Supabase → Authentication:** the email and SMS one-time codes expire
      in 10 minutes or less.
- [ ] **Twilio → Messaging → Geo permissions:** only the United States (and
      Canada if wanted). The app only accepts US numbers; leaving every
      country on invites text-message fraud that the sender pays for.

## 6. Known gaps (honest list)

- **No outside audit.** Everything above is checked by this repository's own
  tests and agents. No third party has tested RSVPlay, and it holds no
  certification (SOC 2, ISO 27001). Supabase, Cloudflare, Apple and Google
  hold their own.
- **Build-tool packages with known issues.** `npm audit` (2026-11-14) lists
  2 high and 16 moderate findings, all in tools that run on the build machine
  (Expo CLI, Metro, glob, postcss, image-size), none in code that ships in
  the app. The fix is moving to a newer Expo SDK; planned, not urgent.
- **Member sign-in email** still needs its own sender (custom SMTP) before
  codes can be sent at volume.
- **Messages are not end-to-end encrypted.** They are encrypted in transit
  and at rest, and the desk can read a reported conversation; that is what
  makes moderation possible, and the privacy policy says so.
- **No bug bounty.** `security.txt` invites reports; there is no reward
  programme.
- **The live website** does not serve the new headers until its next deploy.

## 7. The security team

Four agents in `.claude/agents/`; ask for one by name.

| Agent | Does | Never |
|---|---|---|
| `security-lead` | Owns this document and the threat model; weekly review; triage | Touches production or the safety core |
| `appsec-engineer` | Reviews and fixes code, database rules, headers, dependencies; leaves a test behind | Edits an applied migration or weakens a check |
| `penetration-tester` | Attacks RSVPlay's own rules on the local test database and local builds; reproduces every finding | Tests production or anyone else's system |
| `incident-responder` | Runs `docs/incident-response.md` when something goes wrong; drafts every notice | Acts in a live console or sends a notice |

They work with `rules-sentinel` (are the rules still enforced?) and
`safety-support` (member safety). Cadence: a review every week with the
Monday audit, an attack pass before every release, and the runbook the moment
anything looks wrong. `./scripts/healthcheck.sh` has a "security" section
that fails the build if a lock above is removed.
