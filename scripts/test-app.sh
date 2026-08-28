#!/usr/bin/env bash
set -euo pipefail

# 40/LOVE — run the app state suite.
#
#   ./scripts/test-app.sh
#
# Bundles mobile/src/state.js for Node with the native modules stubbed out, then
# drives the real provider through the flows that used to fail silently. It runs
# the shipped file, not a copy of its logic, so a regression in state.js fails
# here. Needs Node and about 5 seconds of npm on first run.

cd "$(dirname "$0")/../tests/app"

if [ ! -d node_modules ]; then
  echo "→ installing the test harness (react, react-test-renderer, esbuild)…"
  npm install --no-audit --no-fund --silent
fi

node build.mjs
echo
node chat.test.js
echo
node safety.test.js
echo
node settings.test.js
echo
node boot.test.js
echo
node signup.test.js
echo
node photos.test.js

echo
echo "✅ App suites passed."
