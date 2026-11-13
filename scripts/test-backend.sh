#!/usr/bin/env bash
set -euo pipefail

# 40/LOVE — run the backend verification suite.
#
#   ./scripts/test-backend.sh
#
# Starts a throwaway Postgres on a spare port, applies every migration plus the
# seed against Supabase shims, runs supabase/tests/backend.sql, and tears the
# cluster down again. Nothing touches your Supabase project.
#
# Needs a local Postgres install (the binaries only — no running server):
#   Debian/Ubuntu:  sudo apt-get install postgresql
#   macOS:          brew install postgresql@16

cd "$(dirname "$0")/.."

# setup.sql is what actually creates the launch database — check it matches the
# migrations before spending 30 seconds proving the migrations are correct.
./scripts/build-setup-sql.sh --check

PORT="${PGTEST_PORT:-5433}"
WORK="$(mktemp -d)"
DATA="$WORK/data"

# Find the server binaries. They are not on PATH on Debian-family installs.
BIN=""
for c in "$(command -v initdb 2>/dev/null || true)" /usr/lib/postgresql/*/bin/initdb /opt/homebrew/opt/postgresql@*/bin/initdb /usr/local/opt/postgresql@*/bin/initdb; do
  [ -n "$c" ] && [ -x "$c" ] && BIN="$(dirname "$c")" && break
done
if [ -z "$BIN" ]; then
  echo "✗ Couldn't find Postgres server binaries (initdb)." >&2
  echo "  Debian/Ubuntu: sudo apt-get install postgresql" >&2
  echo "  macOS:         brew install postgresql@16" >&2
  exit 1
fi

# initdb refuses to run as root, so drop to the postgres user when we are.
RUNAS=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  RUNAS="postgres"
  chmod 777 "$WORK"
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }

cleanup() {
  run "$BIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$DATA"
[ -n "$RUNAS" ] && chown "$RUNAS" "$DATA"

echo "==> Starting a throwaway Postgres on port $PORT"
run "$BIN/initdb -D $DATA -U postgres --auth=trust" > "$WORK/initdb.log" 2>&1 || {
  tail -20 "$WORK/initdb.log" >&2; exit 1; }
# Unix socket in the work dir, no TCP listener: nothing outside can reach it.
run "$BIN/pg_ctl -D $DATA -o '-k $WORK -p $PORT -c listen_addresses=' -l $WORK/pg.log start" >/dev/null 2>&1 || {
  tail -20 "$WORK/pg.log" >&2; exit 1; }

# The suite applies migrations in filename order, which is also apply order.
cat supabase/migrations/*.sql > "$WORK/migrations.sql"
cp supabase/seed.sql "$WORK/seed.sql"
chmod -R a+rX "$WORK"

export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres
run "$BIN/createdb -h $WORK -p $PORT -U postgres fortylove"

echo "==> Applying $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations + seed, then asserting"
if run "$BIN/psql -h $WORK -p $PORT -U postgres -d fortylove -q -v ON_ERROR_STOP=1 \
      -v migrations=$WORK/migrations.sql -v seed=$WORK/seed.sql \
      -f $(pwd)/supabase/tests/backend.sql" > "$WORK/out.log" 2>&1; then
  grep -E "NOTICE|PASSED" "$WORK/out.log" || true
  echo "✅ Backend suite passed."
else
  echo "✗ Backend suite FAILED:" >&2
  tail -40 "$WORK/out.log" >&2
  exit 1
fi
