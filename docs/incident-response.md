# RSVPlay — security incident runbook

For the moment something has gone wrong, or might have. Ask the
`incident-responder` agent to walk it with you; it recommends and drafts, you
act. Work top to bottom. Write times down as you go.

## 0. Is this an incident?

Yes if any of these might be true: a key, token or password was exposed; an
account that can change RSVPlay was signed in to by someone else; a member
reports their account was used by someone else; member data was shown to
someone who should not see it; a vendor says they were breached; a founder's
phone or laptop is lost.

When unsure, treat it as one. Standing down is cheap.

## 1. Severity

| Level | Meaning | Examples | Start within |
|---|---|---|---|
| 1 | Member data exposed, or control of a system lost | Master key leaked; database read by an outsider; domain hijacked | Now |
| 2 | Could become level 1 | A collaborator's account compromised; a public-key abuse that got past a rule | 1 hour |
| 3 | Contained, no data exposed | A secret committed and caught before push; one member's account taken over by a guessed inbox | Same day |

## 2. The first hour

1. **Open the record:** `outreach/safety/incidents/<date>-<slug>.md` — what
   was noticed, when, by whom. Append with times; never rewrite.
2. **Contain.** Use the table in §3 for the thing that is exposed.
3. **Preserve evidence before cleaning up:** export Supabase logs (Dashboard →
   Logs → API, Auth, Postgres), GitHub's security log, Cloudflare's audit log.
4. **Tell counsel** if any member data may be involved (§5).

## 3. Contain: what to turn, and where

| Exposed | Do this | Where |
|---|---|---|
| Supabase `service_role` key or JWT secret | Rotate the JWT secret (this signs every member out and replaces both keys), then re-run `scripts/go-live.sh` with the new public key and rebuild the app | Supabase → Project Settings → API |
| Supabase database password | Reset it | Supabase → Project Settings → Database |
| A member's account | Sign out all their sessions; suspend from the desk if abuse continues | Supabase → Authentication → Users; the desk |
| Someone on the admin list | Remove the row | Supabase → Table editor → `admins` |
| Push webhook secret | Set a new one and update the webhook header | `supabase secrets set PUSH_WEBHOOK_SECRET=…`; Database → Webhooks |
| A collaborator's GitHub, Cloudflare, host or Expo account | Remove them, review their recent changes, rotate anything they could read | Each service's members page |
| GitHub token or deploy key | Revoke it | GitHub → Settings → Developer settings |
| The domain or DNS | Lock the registrar account, restore the records in `docs/go-live-rename.md` | Cloudflare |
| Apple or Google signing keys | Revoke and re-issue; a new build is needed | App Store Connect; Play Console; `eas credentials` |
| A secret committed to the repository | Rotate it first (it is public the moment it is pushed), then remove it; history rewriting does not un-leak it | — |
| A founder device | Remote-lock or wipe; sign out its sessions everywhere; change the email password | iCloud / Google; each service |

## 4. Scope

From the evidence: which data, which members, over what time. Write three
lists: known, assumed, cannot be known. If the master key or database
password was exposed, assume every table was readable.

## 5. Who must be told — counsel decides

- **Members.** US state breach laws require notice when certain personal
  information is acquired without authorisation. Indiana's requires it
  without unreasonable delay and sets an outer limit of 45 days from
  discovery; other states where members live have their own rules. **Confirm
  the deadlines and whether notice is required with counsel**; this document
  is not legal advice.
- **State attorneys general**, where a state requires it.
- **Vendors**, if their system was the path in.
- **Apple and Google**, if a signing key or a published build is affected.

The `incident-responder` drafts each notice in plain words: what happened,
what information was involved, what we did, what the member should do, how to
reach a person. You and counsel decide and send.

## 6. Afterwards

Within a week: cause, timeline, what worked, what was slow, and the changes
to make, filed in `docs/proposals/`. Add a test or a health check for the
thing that failed, so it cannot fail quietly twice.

## Record template

```
# Incident <date> — <one line>
Severity: <1|2|3>      Opened by: <who>      Status: open
## Timeline (append only, with times)
## What is exposed
## Contained (what, when, by whom)
## Evidence saved (what, where)
## Scope: known / assumed / cannot be known
## Notices: drafted / approved / sent
## Review
```
