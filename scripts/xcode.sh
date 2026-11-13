#!/usr/bin/env bash
set -uo pipefail

# 40/LOVE — generate the iOS project and open it in Xcode.
#
#   ./scripts/xcode.sh              # generate + open
#   ./scripts/xcode.sh --clean      # throw the old one away first
#   ./scripts/xcode.sh --no-open    # generate only
#
# The app is React Native (Expo SDK 53) in JavaScript — there is no Xcode
# project checked in, and there shouldn't be. Expo builds the native project
# from mobile/app.json, so app.json is the source of truth: a hand-edit inside
# Xcode is lost the next time this runs. Change app.json, re-run this.
#
# MUST be run on a Mac. Xcode does not exist for Linux or Windows.

cd "$(dirname "$0")/.."

CLEAN=""
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN="--clean" ;;
    --no-open) OPEN=0 ;;
    *) echo "Unknown option: $arg (use --clean, --no-open)" >&2; exit 1 ;;
  esac
done

die() { echo "✗ $1" >&2; shift; for l in "$@"; do echo "  $l" >&2; done; exit 1; }

# ---- the things that have to be true before anything else ------------------

[ "$(uname -s)" = "Darwin" ] || die \
  "Xcode only runs on macOS, and this is $(uname -s)." \
  "On Linux or Windows you cannot build for iPhone at all — the Apple" \
  "toolchain is Mac-only. Two ways round it:" \
  "  • Android instead: ./scripts/test-app.sh, then see docs/google-play.md" \
  "  • Build iOS in the cloud on Expo's Macs: eas build --platform ios" \
  "    (needs the \$99/year Apple Developer account for a device build)"

command -v node >/dev/null || die "Node isn't installed." \
  "Install it from https://nodejs.org, or: brew install node"

command -v xcodebuild >/dev/null || die "Xcode isn't installed." \
  "Get it from the Mac App Store (it's large — allow an hour)," \
  "then open it once so it can finish setting itself up."

# A Mac with only the command line tools has xcodebuild but no SDK, which
# fails much later with a confusing error. Catch it here instead.
if ! xcodebuild -version >/dev/null 2>&1; then
  die "Xcode is installed but not selected." \
      "Run: sudo xcode-select --switch /Applications/Xcode.app" \
      "Then open Xcode once and accept the licence."
fi

echo "==> $(xcodebuild -version | head -1), Node $(node --version)"

# ---- dependencies ---------------------------------------------------------

cd mobile
if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (a few minutes the first time)…"
  npm install || die "npm install failed — scroll up for the reason."
fi

# ---- generate the native project ------------------------------------------

echo "==> Generating ios/ from app.json…"
# prebuild writes ios/ and runs pod install itself.
npx expo prebuild --platform ios $CLEAN || die \
  "expo prebuild failed." \
  "If it complained about CocoaPods: sudo gem install cocoapods" \
  "If it complained about a stale ios/ folder: ./scripts/xcode.sh --clean"

WORKSPACE="$(ls -d ios/*.xcworkspace 2>/dev/null | head -1)"
[ -n "$WORKSPACE" ] || die "prebuild finished but produced no .xcworkspace." \
  "Try again with --clean."

echo
echo "✅ ios/ is ready: mobile/$WORKSPACE"
echo
cat <<'NEXT'
In Xcode:

  1. Pick a simulator at the top (any iPhone), then press ▶.
     A simulator needs no Apple account and costs nothing.

  2. To run on your own iPhone you need a signing team:
     select the 40/LOVE target → Signing & Capabilities → Team.
     A free Apple ID works for 7 days at a time, BUT it cannot enable
     Sign in with Apple — so a device build needs the $99/year
     Apple Developer account, or remove "expo-apple-authentication"
     and "usesAppleSignIn" from app.json first.

  3. Open the WORKSPACE, never the .xcodeproj — the project alone is
     missing the pods and will not build.

Remember: ios/ is generated. Edit mobile/app.json and re-run this script;
anything typed into Xcode's project settings is thrown away next time.
NEXT

if [ "$OPEN" = "1" ]; then
  echo
  echo "==> Opening Xcode…"
  open "$WORKSPACE"
fi
