# App state tests

```bash
./scripts/test-app.sh
```

These run the real `mobile/src/state.js` — the file the app ships — in Node,
with the native modules (React Native, AsyncStorage, Supabase, push, location)
swapped for the stubs in `stubs/`. Nothing here reimplements app logic, so a
regression in `state.js` fails here rather than on someone's phone.

- `chat.test.js` — a message the server refuses must never sit in the thread
  looking sent, must survive a thread refresh, and must be retryable.
- `safety.test.js` — block, report, and RSVP either happen or say they didn't,
  and meetups list nationwide until a city is picked.
- `settings.test.js` — every setting that decides who can see you or who you
  see reverts and says so if the server refuses the write.
- `boot.test.js` — opening the app signed in with no cached profile always
  reaches a real screen, whether the profile fetch fails, hangs, or arrives
  late.

The backend stub is generated at build time from whatever `state.js` actually
calls, so adding an `api.something()` doesn't break the build.

First run installs react, react-test-renderer and esbuild here (a few seconds).
It deliberately sits outside `mobile/` — a nested `node_modules` inside the Expo
project confuses Metro's module map and gets uploaded to EAS builds.
