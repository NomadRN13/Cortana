# Browser tests

```bash
./scripts/test-web.sh            # everything
./scripts/test-web.sh admin      # one suite
```

No Node on this machine (or on Windows, where these bash scripts won't run as
they are)? Run the same suite in a throwaway Docker container instead — nothing
is installed and nothing is written into the checkout:

```bash
./scripts/test-in-docker.sh web          # macOS / Linux
.\scripts\test-in-docker.ps1 -Only web   # Windows PowerShell
```

Leave the suite name off to run all three (backend, app, web). The images are
downloaded once (about 2.5 GB, mostly the browser) and kept; `-Clean` /
`--clean` removes them.

These drive the real pages in headless Chromium — the same files the site build
copies to Netlify, served over http from a local static server so that
root-absolute paths like `/favicon.png` resolve the way they do in production.

- `prototype.test.js` — 49 steps through the demo people are actually being
  sent to: what a shared link says, onboarding (Play pre-selected, Date off
  until it is turned on), the events-first Home, RSVP with the waiver tick, the
  deck behind "Find a game", blocking, reporting, matching, chat, check-in with
  the host's code, the crew, the tournament bracket drawn as rounds, photos,
  sign-out. Several of those steps exist because of a specific fault, and are
  there so it cannot quietly come back:
  - **Sign-out hands the device over clean.** One member blocks, reports,
    matches, clears notifications, types into the seed chats and signs out
    with a reply still on its way; the next person to sign up must find the
    demo exactly as it shipped — the three seed chats and what they said, the
    three matches, the three notifications, everyone back in the deck and the
    going rows, default discovery settings — and nothing of the last member
    drawn in any screen behind the welcome page.
  - **"Also open to dating"** follows the server's rule (`get_my_crew`): both
    in Date mode, neither a team, each one's gender in the other's seeking,
    and each one's age inside the other's range. The age part is checked by
    moving the member's range across two crew members' ages, edges included.
  - **An event card is a container, not a button.** Its header is a real
    `<button>` with `aria-expanded` and `aria-controls`; RSVP, the waiver tick
    and the code field are beside it, never inside it. Checked with the card
    closed, with the waiver open and with the code field open, and opened by
    Enter, Space and tap.
  - **Check-in codes are 4–8 letters or digits**, any case — the shape the
    database stores — and the hint says what the real app does that the demo
    cannot (opens an hour before, locks after five wrong codes).
  - **A report hides the person**, from the crew, the going rows and the deck
    (through a deck reset too), wherever it was made from.
- `admin.test.js` — the moderation desk in demo mode: photo queue,
  approve/reject, reports, events, empty states. If this breaks, every tester's
  photo stays invisible.
- `admin-live.test.js` — the desk signed in against a project, which is the
  path the founder actually uses. Chiefly that the three ways in stay distinct:
  not an admin, signed out, and couldn't reach the database.
- `waitlist.test.js` — the signup form, including the two that matter: a repeat
  address gives nothing away, and a deployed-but-unconfigured page refuses to
  fake a signup instead of thanking someone into their own browser.
- `events.test.js` — meetups list only the cities on the member's profile (one
  or several); no city picker and no nationwide list. Its two signups also
  hold the signup default in place: Play only, Date off and unasked — for a
  first visitor, and again for whoever signs up after a member who had turned
  Date on signs out.
- `funnel.test.js` — the demo's own analytics: exactly the steps walked, in
  order, through to `opened_chat`; one visit id, no step counted twice, nothing
  personal in the payload, and complete silence when no keys are configured.
  It also reads the ids the funnel watches out of the page and checks each one
  exists — `opened_chat` went unrecorded because it watched a screen id that
  was not there, and the funnel is built not to complain.
- `share.test.js` — what a pasted link looks like: the built site's preview
  images are absolute URLs pointing at a file that exists. Scrapers aren't
  browsers, so this reads the markup rather than driving one.

A step that fails now fails the process. Every one of these used to print
`FAIL` and exit 0, so a broken page looked green from the shell.

Two things keep them honest. Every page is **sealed off from the network** —
anything that isn't localhost is aborted, so a suite tests the page rather than
the internet. And pages are served with the Supabase config **blanked**, because
after `go-live.sh` these files carry real keys: without that, the suites that
test demo behaviour would leave demo mode mid-run and either fail or hang
against the founder's live project. Verified both ways — every check passes
whether the repo is wired or not.

First run installs `playwright-core` here. Chromium comes from the session
image; set `PW_CHROMIUM` to a binary if yours is elsewhere. Screenshots and
image fixtures are written to `.artifacts/`, which is ignored.
