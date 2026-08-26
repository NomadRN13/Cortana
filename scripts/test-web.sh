#!/usr/bin/env bash
set -uo pipefail

# 40/LOVE — run the browser suites against the website and the demo.
#
#   ./scripts/test-web.sh            # everything
#   ./scripts/test-web.sh admin      # one suite
#
# Drives the real pages in headless Chromium: the app prototype people are
# being sent to, the waitlist form, the moderation desk, the meetup city
# picker, and the demo funnel's privacy. Needs Node and Chromium; the session
# image already has one, otherwise set PW_CHROMIUM to a binary.

cd "$(dirname "$0")/../tests/web"

if [ ! -d node_modules ]; then
  echo "→ installing playwright-core…"
  npm install --no-audit --no-fund --silent
fi

only="${1:-}"
fails=0
for suite in prototype admin waitlist events funnel; do
  [ -n "$only" ] && [ "$only" != "$suite" ] && continue
  echo
  echo "── $suite"
  node "$suite.test.js" || fails=$((fails + 1))
done

echo
if [ "$fails" -gt 0 ]; then
  echo "✗ $fails suite(s) failing"
  exit 1
fi
echo "✅ Web suites passed."
