# Browser tests

```bash
./scripts/test-web.sh            # everything
./scripts/test-web.sh admin      # one suite
```

These drive the real pages in headless Chromium — the same files the site build
copies to Netlify, served over http from a local static server so that
root-absolute paths like `/favicon.png` resolve the way they do in production.

- `prototype.test.js` — 26 steps through the demo people are actually being
  sent to: onboarding, the deck, blocking, matching, chat, events, photos,
  sign-out.
- `admin.test.js` — the moderation desk: photo queue, approve/reject, reports,
  events, empty states. If this breaks, every tester's photo stays invisible.
- `waitlist.test.js` — the signup form, including the two that matter: a repeat
  address gives nothing away, and a deployed-but-unconfigured page refuses to
  fake a signup instead of thanking someone into their own browser.
- `events.test.js` — meetups list nationwide and narrow to a chosen city.
- `funnel.test.js` — the demo's own analytics: one visit id, no step counted
  twice, nothing personal in the payload, and complete silence when no keys
  are configured.

A step that fails now fails the process. Every one of these used to print
`FAIL` and exit 0, so a broken page looked green from the shell.

First run installs `playwright-core` here. Chromium comes from the session
image; set `PW_CHROMIUM` to a binary if yours is elsewhere. Screenshots and
image fixtures are written to `.artifacts/`, which is ignored.
