#!/usr/bin/env bash
set -euo pipefail

# 40/LOVE — regenerate supabase/setup.sql from supabase/migrations/.
#
#   ./scripts/build-setup-sql.sh           # write it
#   ./scripts/build-setup-sql.sh --check   # fail if it's stale
#
# setup.sql is the single file the founder pastes into the Supabase SQL editor,
# so it IS the production database. A migration that lands without it being
# regenerated ships a project missing that migration — and since the ones most
# likely to be forgotten are the late security fixes, the failure is silent and
# the consequence is a privacy rule that exists only in the repo. --check runs
# as part of the backend suite so that can't happen quietly.

cd "$(dirname "$0")/.."

OUT=supabase/setup.sql
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<'HEADER'
-- 40/LOVE — complete backend in one paste
-- Generated from supabase/migrations/ by scripts/build-setup-sql.sh — don't edit by hand.
-- Use: Supabase Dashboard → SQL Editor → New query → paste ALL of this → Run.
-- Safe to run once on a fresh project. Do NOT also run 'supabase db push' afterwards — pick one path.
-- (Development seed data is separate and optional: supabase/seed.sql — never on the launch project.)

HEADER

for f in supabase/migrations/*.sql; do
  cat "$f" >> "$TMP"
  printf '\n' >> "$TMP"
done

count=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')

if [ "${1:-}" = "--check" ]; then
  if diff -q "$TMP" "$OUT" > /dev/null 2>&1; then
    echo "✅ setup.sql is current ($count migrations)."
    exit 0
  fi
  echo "✗ supabase/setup.sql is stale — it does not match supabase/migrations/." >&2
  echo "  This is the file pasted into the SQL editor, so the launch project would" >&2
  echo "  be missing whatever isn't in it. Run: ./scripts/build-setup-sql.sh" >&2
  diff "$OUT" "$TMP" | head -20 >&2
  exit 1
fi

cp "$TMP" "$OUT"
echo "==> $OUT rebuilt from $count migrations ($(wc -l < "$OUT" | tr -d ' ') lines)"
