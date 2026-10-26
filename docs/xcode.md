# Opening 40/LOVE in Xcode

```bash
./scripts/xcode.sh
```

That's the whole thing — it checks the prerequisites, installs dependencies,
generates the `ios/` project from `app.json`, and opens the workspace.

Read the rest of this page before you spend money on it.

---

## What this app actually is

React Native, Expo SDK 53, written in JavaScript. **Not Swift.** There is no
`.xcodeproj` in the repo and there shouldn't be: Expo generates the native
project from `mobile/app.json` whenever it's needed, which is why the same
JavaScript produces both the iPhone and Android apps.

The practical consequence: **`ios/` is disposable.** Anything you type into
Xcode's project settings — a capability, an Info.plist key, a build setting —
is wiped the next time the project is generated. Change `mobile/app.json` and
re-run the script instead. `mobile/ios/` is in `.gitignore` for the same reason.

If you want a genuinely native Swift app, that's a rewrite from scratch, not a
conversion. It would cost months and buy you nothing a player would notice.

---

## What you need, and what each thing costs

| To do this | You need | Cost |
|---|---|---|
| Run it in the iPhone **simulator** on a Mac | A Mac + Xcode | free |
| Run it on **your own iPhone**, 7 days at a time | A Mac + Xcode + a free Apple ID | free¹ |
| TestFlight, or the App Store | Apple Developer Program | **$99/year** |
| Build iOS **without a Mac** | An Expo account | free² |

¹ A free Apple ID ("personal team") cannot enable **Sign in with Apple**, which
this app declares. For a free device build, first remove
`expo-apple-authentication` from `plugins` and `usesAppleSignIn` from `ios` in
`app.json` — Google and email sign-in still work. The simulator doesn't need
signing at all, so it's unaffected.

² `eas build --platform ios --profile ios-simulator` runs on Expo's Macs and
needs no Apple account — it produces a simulator build. Anything that runs on
real hardware needs the $99 membership, Mac or no Mac.

**Xcode is macOS-only.** There is no version for Windows or Linux, and no
legitimate way around it. The script will tell you this rather than failing
halfway through.

---

## The honest recommendation: not yet

Android first, and finish it. The reasons:

- **Google Play costs $25 once; Apple costs $99 every year.** You don't have
  an iPhone build in anyone's hands yet, so you'd be paying for an audience
  you don't have.
- **Apple reviews every build by a human**, including test builds, which adds
  days per iteration. Play's closed test has no such queue.
- **The Play closed test is already your critical path** — 12 testers for 14
  consecutive days before you may publish at all. Splitting attention now
  doesn't shorten that clock; it just delays the start of it.
- Everything on the code side for iOS is already done, including the
  account-deletion revocation Apple specifically checks for
  (`supabase/functions/apple-auth/`). It will still be done in a month.

The one good reason to do it now: you only have an iPhone and want to see the
real app on your own phone. For that, the simulator on a borrowed Mac is free
and takes twenty minutes.

---

## When something goes wrong

**"Xcode is installed but not selected"**
```bash
sudo xcode-select --switch /Applications/Xcode.app
```
Then open Xcode once and accept the licence.

**CocoaPods errors during prebuild**
```bash
sudo gem install cocoapods
./scripts/xcode.sh --clean
```

**It builds but the app opens on a blank screen**
The backend isn't connected. Run `./scripts/go-live.sh` first — see
`docs/launch-runbook.html`. Without it the app runs in demo mode with invented
players, which is also a perfectly good way to look at the screens.

**Signing errors mentioning "Sign in with Apple" or "personal team"**
That's footnote ¹ above: either pay for the Developer Program or drop the Apple
sign-in plugin from `app.json`.

**Anything else**
Delete and regenerate — `ios/` holds nothing of yours:
```bash
./scripts/xcode.sh --clean
```
