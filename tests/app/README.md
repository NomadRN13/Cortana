# App state tests

```bash
./scripts/test-app.sh
```

No Node on this machine (or on Windows, where these bash scripts won't run as
they are)? Run the same suite in a throwaway Docker container instead — nothing
is installed and nothing is written into the checkout:

```bash
./scripts/test-in-docker.sh app          # macOS / Linux
.\scripts\test-in-docker.ps1 -Only app   # Windows PowerShell
```

Leave the suite name off to run all three (backend, app, web). The images are
downloaded once (about 2.5 GB, mostly the browser) and kept; `-Clean` /
`--clean` removes them.

These run the real `mobile/src/state.js` — the file the app ships — in Node,
with the native modules (React Native, AsyncStorage, Supabase, push, location)
swapped for the stubs in `stubs/`. Nothing here reimplements app logic, so a
regression in `state.js` fails here rather than on someone's phone.

`build.mjs` makes two bundles of it: `.build/state.cjs`, with a backend
configured (live mode — every test below unless it says otherwise), and
`.build/state.demo.cjs`, with none (`stubs/supabase.demo.js`), which is the
demo build running on the seeded data. Both also carry the Home, Events,
Matches and Profile screens, with React Native's components reduced to plain
host elements (`stubs/react-native.js`, `stubs/ui.js`) so `screens.test.js`
can render and press them.

`npm test` in this folder builds and runs every `*.test.js`.
`scripts/test-app.sh` names its suites one by one, so a new test file has to
be added there too.

- `chat.test.js` — a message the server refuses must never sit in the thread
  looking sent, must survive a thread refresh, and must be retryable.
- `safety.test.js` — block, report, and RSVP either happen or say they didn't,
  and meetups follow the member's selected cities (one or several) and are
  never fetched without a city.
- `settings.test.js` — every setting that decides who can see you or who you
  see reverts and says so if the server refuses the write.
- `boot.test.js` — opening the app signed in with no cached profile always
  reaches a real screen, whether the profile fetch fails, hangs, or arrives
  late.
- `signup.test.js` — a phone step that fails says whose problem it is: an
  unconfigured SMS provider is never blamed on the tester's number.
- `photos.test.js` — the first photo either reaches the server or the member is
  told, and their own profile never shows a file they alone can see.
- `location.test.js` — position goes through `set_my_location`, never the
  profile row; a refused or failed move is silent and never fails a signup.
  (`nativeImpl.coarseLocation` in `stubs/native.js` sets the phone's location.)
- `distance.test.js` — distances read in whole miles, 1 as "nearby", and null
  shows nothing (`mobile/src/lib/distance.js`).
- `timezone.test.js` — the phone's timezone goes through `set_my_timezone`
  when the app opens and after signup, never the profile row; a refusal, a
  failure or a call that never answers is silent and blocks neither.
  (`nativeImpl.timezone` in `stubs/native.js` sets the phone's zone.)
- `checkin.test.js` — RSVP, then the waiver, then check-in with the host's
  code: nothing is sent before the waiver is on record, a refused code shows
  the server's own message, the crew appears after check-in, and "Also open to
  dating" follows the server's flag and nothing else. Also: Add / Added, the
  tier, and that none of it is written to a row directly.
- `leagues.test.js` — ladder leagues: the list follows the member's cities,
  rungs come from the server's standings, "Challenge" is offered only up to two
  rungs above, results and refusals; plus the ladder rules the demo uses
  (`mobile/src/lib/ladder.js`).
- `demo.test.js` — the demo build (no backend): the same RSVP → waiver →
  check-in → crew flow and the ladders work on seeded data, by the same rules,
  without one backend call.
- `screens.test.js` — the screens themselves: Home leads with "This week on
  the courts" and its events, then "Find a game" with the mode pills in the
  order Play, Date, Friends and a deck that still works; the event card walks
  waiver → check-in → crew; "Your crew" sits above the matches; a drawn
  tournament is a bracket by rounds with the winner's row lit and the score
  right-aligned; the tier shows on the profile.
- `review.test.js` — the App Review sign-in: the one review address sends no
  email and its six digits are checked as the password; every other address,
  and every address when no review address is configured, gets an emailed code.
- `secure-storage.test.js` — `lib/secureStorage.js` against a fake of the
  phone's secure store: nothing about the member is left in plain storage, a
  value of any size comes back exactly, a failed write leaves the old value
  whole, overlapping writes cannot interleave, deleting the app signs the
  phone out, and a value an older build left unencrypted is moved and erased.

The backend stub is generated at build time from whatever `state.js` actually
calls, so adding an `api.something()` doesn't break the build. Every call is
recorded in `calls` and answered by `impl.<name>` when a test sets one; calls
that return a list (named in `ARRAYS` in `build.mjs`) answer `[]` by default.

First run installs react, react-test-renderer and esbuild here (a few seconds).
It deliberately sits outside `mobile/` — a nested `node_modules` inside the Expo
project confuses Metro's module map and gets uploaded to EAS builds.
