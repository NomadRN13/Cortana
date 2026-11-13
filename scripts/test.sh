#!/usr/bin/env bash
set -uo pipefail

# 40/LOVE — run everything.
#
#   ./scripts/test.sh
#
# Three suites, in the order they're worth knowing about:
#   backend  every migration and security rule, against a throwaway Postgres
#   app      the shipped state layer, driven in Node
#   web      the demo, the moderation desk and the waitlist, in a real browser
#
# Each can be run on its own — see test-backend.sh, test-app.sh, test-web.sh.

cd "$(dirname "$0")/.."

failed=()
run() {
  echo
  echo "════ $1"
  if ! "./scripts/$2"; then failed+=("$1"); fi
}

run "backend" test-backend.sh
run "app" test-app.sh
run "web" test-web.sh

echo
if [ ${#failed[@]} -gt 0 ]; then
  echo "✗ failing: ${failed[*]}"
  exit 1
fi
echo "✅ Everything passed."
