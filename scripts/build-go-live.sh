#!/usr/bin/env bash
# Rebuilds the go-live upgrade bundles in supabase/go-live/ from
# supabase/migrations/: every migration after a starting point, in order,
# inside one transaction.
#   2-upgrade-from-32.sql   a live project set up before the 2026-11 additions
#   2-upgrade-from-41.sql   the live project as first set up on 2026-11-13
# `--check` fails if either file is stale.
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
for base in 32 41; do
  OUT="supabase/go-live/2-upgrade-from-$base.sql"
  TMP="$(mktemp)"
  {
  cat <<SQL
-- RSVPlay go-live: UPGRADE A LIVE PROJECT FROM MIGRATION $base TO THE CURRENT ONE
--
-- Run 1-status.sql first. Paste this ONLY if it shows everything up to $base
-- true and everything after it false. For a fresh project, paste
-- supabase/setup.sql instead.
--
-- All or nothing: it runs inside one transaction, so if any statement fails,
-- nothing is changed and the database stays exactly as it was. Then run
-- 1-status.sql again; every row should read true.
--
-- Built from supabase/migrations/ by scripts/build-go-live.sh. Never edit by
-- hand; never run it twice.
begin;
SQL
  n=0
  for f in supabase/migrations/202608060000[0-9][0-9]_*.sql; do
    num="$(basename "$f" | cut -c13-14)"
    [ "$((10#$num))" -gt "$base" ] || continue
    printf '\n-- ======================================================================\n-- %s\n-- ======================================================================\n' "$(basename "$f")"
    cat "$f"
    n=$((n + 1))
  done
  printf '\ncommit;\n'
  } > "$TMP"
  if [ "${1:-}" = "--check" ]; then
    if cmp -s "$TMP" "$OUT"; then echo "✅ $OUT is current."; else echo "✗ $OUT is stale — run scripts/build-go-live.sh" >&2; status=1; fi
    rm -f "$TMP"
  else
    mv "$TMP" "$OUT"
    echo "==> $OUT rebuilt ($(grep -c '^-- 202608' "$OUT") migrations)"
  fi
done
exit $status
