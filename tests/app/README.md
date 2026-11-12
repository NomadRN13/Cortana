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

The backend stub is generated at build time from whatever `state.js` actually
calls, so adding an `api.something()` doesn't break the build.

First run installs react, react-test-renderer and esbuild here (a few seconds).
It deliberately sits outside `mobile/` — a nested `node_modules` inside the Expo
project confuses Metro's module map and gets uploaded to EAS builds.
