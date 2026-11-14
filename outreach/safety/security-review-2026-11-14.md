# Security review — 2026-11-14 (baseline)

The first review, run when the security team was created. Method: the checks
below were run against the repository at this commit and against a throwaway
copy of the database. Nothing was run against the live project, the live
website or any vendor console.

## Found and fixed

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 1 | Medium | The sign-in session sat in the phone's plain app storage | Moved to the phone's encrypted store (Keychain / Android Keystore, AES-256-GCM) | `tests/app/secure-storage.test.js` |
| 2 | Medium | The cached profile (gender, who the member is looking for), settings and saved list sat in plain app storage | Same store | same; health check "the profile cache never uses plain storage" |
| 3 | Medium | The website sent no security headers: it could be framed, and nothing limited what a page could load or contact | `landing/_headers`: HTTPS-only, no framing, a content policy with no outside script and connections only to Supabase | `tests/web/headers.test.js` |
| 4 | Low | Android could copy the app's storage into a cloud backup | `allowBackup: false`; secure-store values are this-device-only | health check |
| 5 | Low | Deleting the app on an iPhone would have left the session in the Keychain | A fresh install erases what the last one left | `tests/app/secure-storage.test.js` |
| 6 | Low | The two API roles held TRUNCATE on every table by Supabase's default. Not reachable through the API today; row-level security does not cover it | Migration 43 revokes it, for existing and future tables | harness §11 |
| 7 | Low | Nowhere to report a security problem | `/.well-known/security.txt`, `security@rsvplayapp.com`, a line in the privacy policy | `tests/web/headers.test.js` |

## Checked and held

- **Secrets:** none in the working tree, and none in the 115 commits of the
  three branches scanned (the launch branch, the earlier pre-rename branch and
  one presentations branch): keys, tokens, private keys, JWT-shaped strings,
  env and key files. The `main` branch was not in this copy and was not
  scanned.
- **Database:** row-level security is on for every table; no policy lets a
  stranger write; every function added since migration 33 refuses `anon`
  (harness §10f-ii, §11). All backend tests pass on 43 migrations.
- **The master key** appears nowhere in the app, the website or the desk.
- **Pages:** no `eval`, no inline handler, no outside script, font or frame.

## Open

| Item | Owner | Note |
|---|---|---|
| Apply migrations 42 and 43 to the live database | Founder | `supabase/go-live/2-upgrade-from-41.sql` |
| The headers reach the live site only on its next deploy | Founder | The website host's deploys are paused |
| Two-factor sign-in and least-privilege roles on every account | Founder | `docs/security.md` §5; a collaborator was added to GitHub, the website host and Cloudflare today |
| `security@` mailbox | Founder | Cloudflare → Email Routing |
| Console settings: SSL enforcement, code expiry, SMS geo permissions | Founder | `docs/security.md` §5 |
| Build-tool packages: 2 high, 16 moderate, 1 low (`npm audit --omit=dev`) | `appsec-engineer` | None ships in the app; cleared by a newer Expo SDK |
| The repository is public | Founder | A decision, not a finding: no secret is in it |

## Not checked (cannot be, from the repository)

The live project's settings, the live site's TLS configuration, every vendor
console, and the app on a real phone. No outside party has tested RSVPlay.
