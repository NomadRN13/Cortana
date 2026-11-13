#!/usr/bin/env bash
# Rebuilds supabase/go-live/2-upgrade-from-32.sql from supabase/migrations/:
# every migration after 32, in order, inside one transaction, for a live project that
# was set up through migration 32. `--check` fails if the file is stale.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=supabase/go-live/2-upgrade-from-32.sql
TMP="$(mktemp)"
{
cat <<'SQL'
-- RSVPlay go-live, step 1b: UPGRADE A LIVE PROJECT FROM MIGRATION 32 TO THE CURRENT ONE
--
-- Run 1-status.sql first. Paste this ONLY if it shows base and 30–32 true and
-- 33 onward false. For a fresh project, paste supabase/setup.sql instead.
--
-- All or nothing: it runs inside one transaction, so if any statement fails,
-- nothing is changed and the database stays exactly as it was. Then run
-- 1-status.sql again; every row should read true.
--
-- Built from supabase/migrations/ by scripts/build-go-live.sh. Never edit by
-- hand; never run it twice.
begin;
SQL
for f in supabase/migrations/2026080600003[3-9]_*.sql supabase/migrations/2026080600004[0-9]_*.sql; do
  printf '\n-- ======================================================================\n-- %s\n-- ======================================================================\n' "$(basename "$f")"
  cat "$f"
done
printf '\ncommit;\n'
} > "$TMP"
if [ "${1:-}" = "--check" ]; then
  if cmp -s "$TMP" "$OUT"; then echo "✅ $OUT is current."; rm -f "$TMP"; exit 0; fi
  echo "✗ $OUT is stale — run scripts/build-go-live.sh" >&2; rm -f "$TMP"; exit 1
fi
mv "$TMP" "$OUT"
echo "==> $OUT rebuilt ($(grep -c '^-- 202608' "$OUT") migrations)"
