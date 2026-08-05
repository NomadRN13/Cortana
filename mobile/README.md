# 40/Love — Mobile App (iOS + Android)

The store-bound React Native app, built with [Expo](https://expo.dev). One
codebase → both the Apple App Store and Google Play. The design implements
the Night Court direction from `../docs/brand-guide.md` §8; the clickable
HTML prototype in `../app/` is the visual spec.

## Current state

**Demo build with real auth flow.** All screens work with seeded
Indianapolis data and local state — the same experience as the HTML
prototype, as a real native app:

- Welcome → **sign in with email + 6-digit code** (real Supabase email OTP
  when the backend env vars are set; simulated in demo mode — any 6-digit
  code works, with a banner saying so)
- 4-step onboarding (name/birthdate — 18+ enforced — photo, sports, skill,
  modes); when the backend is live, finishing onboarding writes the profile,
  sports, and photo to Supabase
- Home: greeting, Date/Play/Friends mode pills, Top Match banner, discover
  deck with rewind / pass / like / ace, report & block, notifications panel
- Matches grid + Saved-for-later strip
- Chat with court-time proposal cards and demo replies
- Events with RSVP, Profile with photo + bio, Settings with working
  discovery filters, sign-out, and in-app **account deletion** (a store
  requirement — calls the backend's `delete_account` when live)

**Not yet wired:** real accounts, real matching, realtime chat, push — that
is the Supabase backend described in `../docs/system-architecture.md`. Every
data access goes through `src/state.js`, which is where those calls plug in.

## Run it

```bash
cd mobile
npm install
npx expo install --fix   # aligns native package versions with the SDK
npx expo start           # scan the QR code with the Expo Go app
```

Requires Node 18+. On a phone with [Expo Go](https://expo.dev/go) installed,
scanning the QR code runs the app immediately — no Mac or Android Studio
needed for development.

## Build for the stores

Uses [EAS Build](https://docs.expo.dev/build/introduction/) — Expo's cloud
build service (no local Xcode/Android Studio required):

```bash
npm install -g eas-cli
eas login                # your Expo account (free)
eas init                 # writes the real projectId into app.json
eas build --profile preview --platform all    # installable test builds
eas build --profile production --platform all # store binaries (AAB + IPA)
eas submit --platform ios
eas submit --platform android
```

Store identifiers are already configured: `com.fortylove.app` on both
platforms. Fill in the placeholders in `eas.json` (Apple ID, App Store
Connect app ID, Play service-account key) before `eas submit`.

**The full store checklist — accounts, costs, policies, review pitfalls for
a dating app — is in [`../docs/app-store-launch.md`](../docs/app-store-launch.md).
Read it before submitting anything.**

## Structure

```
App.js                 navigation (auth stack → 5-tab main app)
src/theme.js           Night Court tokens (colors, type, avatar tints)
src/state.js           all app state + actions — swap in Supabase here
src/data/seed.js       demo data; shapes mirror the production schema
src/components/ui.js   Wordmark, Avatar, Btn, Chip, Tag
src/screens/           one file per screen
assets/                icon, adaptive icon, splash (generated from brand art)
```
