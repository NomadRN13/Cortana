#!/usr/bin/env bash
# RSVPlay — the deterministic health check behind the self-improvement network.
#
#   ./scripts/healthcheck.sh            # quick: structure, brand, rules, derived files (seconds)
#   ./scripts/healthcheck.sh --full     # quick + the three test suites (minutes)
#
# Prints one line per check, PASS or FAIL, then a summary; exits 1 on any FAIL.
# It changes nothing. Agents read its output; humans decide what to fix.
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0; passes=0
pass() { printf '  PASS  %s\n' "$1"; passes=$((passes + 1)); }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi; }

echo "── structure"
for f in CLAUDE.md docs/rules-and-stops.md docs/brand-guide.md docs/networking-team.md docs/self-improvement-network.md README.md netlify.toml; do
  check "$f exists" test -f "$f"
done
check ".claude/agents has the ten core agents + the network agents" bash -c '[ "$(ls .claude/agents/*.md | wc -l)" -ge 13 ]'
for a in .claude/agents/*.md; do
  check "$(basename "$a") has frontmatter name + description" bash -c "head -1 '$a' | grep -q '^---$' && grep -q '^name: ' '$a' && grep -q '^description: ' '$a'"
done

echo "── brand"
# the retired name must not come back anywhere but git history and the proposals/log that mention it by name
residue=$(git grep -I -n -i -E "40 ?/ ?love|fortylove|40love|40-love" -- . ':!presentations/' ':!scripts/healthcheck.sh' ':!docs/proposals/' ':!docs/improvement-log.md' ':!CLAUDE.md' ':!docs/brand-guide.md' ':!docs/rules-and-stops.md' ':!docs/business-plan.md' ':!docs/self-improvement-network.md' ':!netlify.toml' ':!docs/go-live-rename.md' 2>/dev/null | wc -l)
if [ "$residue" = "0" ]; then pass "no 40/Love residue in product, docs, tests or agents"; else fail "40/Love residue: $residue line(s) (git grep -i '40/love|fortylove|40love|40-love')"; fi
check "wordmark is RSVPlay + ball in the prototype" grep -q "el.innerHTML = 'RSVPlay<span class=\"ball\">" app/index.html
check "no retired palette hexes in app/landing/admin/mobile" bash -c '! git grep -q -i -E "#(0A0B0D|D6F44F|F4F6F0|17191D|1F2227|101215)" -- app landing admin mobile/src scripts/make-icons.js'

echo "── derived files are current"
check "supabase/setup.sql matches the migrations" ./scripts/build-setup-sql.sh --check
check "site/ matches landing/, app/ and admin/" bash -c 'for p in "landing/index.html site/index.html" "app/index.html site/demo/index.html" "admin/index.html site/admin/index.html" "landing/privacy.html site/privacy/index.html" "landing/terms.html site/terms/index.html" "landing/delete-account.html site/delete-account/index.html"; do set -- $p; diff -q <(sed "s|content=\"https://[^\"]*/og.png\"|content=\"/og.png\"|g" "$2") "$1" >/dev/null || exit 1; done'
check "brand/tokens.json current and all surfaces agree" node scripts/build-tokens.js --check
check "every page carries the shared ball mark" bash -c 'for f in landing/index.html app/index.html admin/index.html; do grep -q "mark:defs" "$f" || exit 1; done'

echo "── rules and stops still enforced (docs/rules-and-stops.md vs the code)"
for m in 20260806000033 20260806000034 20260806000035 20260806000036 20260806000037 20260806000038 20260805000001 20260806000003 20260806000006 20260806000007 20260806000008 20260806000009 20260806000014 20260806000015 20260806000017 20260806000019 20260806000020 20260806000023 20260806000024 20260806000027 20260806000029 20260806000030 20260806000031 20260806000032; do
  check "migration $m cited by the rules doc exists" bash -c "ls supabase/migrations/${m}_*.sql >/dev/null"
done
check "18+ birthdate check constraint" grep -q "birthdate <= (current_date - interval '18 years')" supabase/migrations/20260805000001_initial_schema.sql
check "set_my_location rounds to 2 decimals and limits moves to 6 hours" bash -c "grep -q \"round(p_lat, 2)\" supabase/migrations/20260806000030_privacy_gaps.sql && grep -q \"interval '6 hours'\" supabase/migrations/20260806000030_privacy_gaps.sql"
check "grid squares: 0.04° lat / 0.05° lng" bash -c "grep -q 'floor(p / 0.04)' supabase/migrations/20260806000030_privacy_gaps.sql && grep -q 'floor(p / 0.05)' supabase/migrations/20260806000030_privacy_gaps.sql"
check "phone rounds coordinates before they leave it" grep -q "Math.round(pos.coords.latitude \* 100) / 100" mobile/src/lib/location.js
check "members cannot write position/verification/suspension (guard trigger)" grep -q "create trigger profiles_guard_member_writes" supabase/migrations/20260806000030_privacy_gaps.sql
check "photo self-approval impossible (moderation guard)" grep -q "create trigger photo_moderation_guard" supabase/migrations/20260806000009_photo_management.sql
check "event capacity guard" grep -q "create trigger event_capacity_guard" supabase/migrations/20260806000020_event_capacity.sql
check "suspension withdraws from tournaments" grep -q "create trigger profiles_suspension_withdraws" supabase/migrations/20260806000032_tournament_privacy.sql
check "admins table has no client policy" bash -c "! git grep -q -E 'create policy .* on public\.admins' -- supabase/migrations"
check "is_blocked() exists and blocks are symmetric" bash -c "grep -q 'function public.is_blocked' supabase/migrations/20260805000001_initial_schema.sql && test -f supabase/migrations/20260806000019_block_symmetry.sql"
check "hard account deletion function exists" grep -q "function public.delete_account" supabase/migrations/20260806000006_privacy_hardening.sql
check "app: under-18 stop" grep -q "RSVPlay is 18+" mobile/src/screens/OnboardingScreen.js
check "app: phone verification required to continue" grep -q "Verify your phone number to continue" mobile/src/screens/OnboardingScreen.js
check "app: coarse location permission only" grep -q "ACCESS_COARSE_LOCATION" mobile/app.json
check "agents: every agent keeps the humans-send rule or a never-runs line" bash -c 'for a in .claude/agents/*.md; do grep -q -i -E "draft|never (send|run|submit|publish|commit)|recommend" "$a" || exit 1; done'
check "check-in only by host code (member-write guard on RSVPs)" grep -q "create trigger event_rsvps_guard_member_writes" supabase/migrations/20260806000033_checkin_waiver_crew.sql
check "check-in requires the waiver" grep -q "Accept the event waiver first" supabase/migrations/20260806000033_checkin_waiver_crew.sql
check "check-in codes have only an admin policy" bash -c "[ \"\$(grep -c 'create policy .* on public.event_checkin_codes' supabase/migrations/*.sql | awk -F: '{s+=\$2} END {print s}')\" = 1 ] && grep -q 'checkin_codes_admin' supabase/migrations/20260806000033_checkin_waiver_crew.sql"
check "crew dating flag is mutual and server-decided" grep -q "p.gender = any (me.seeking) and me.gender = any (p.seeking)" supabase/migrations/20260806000033_checkin_waiver_crew.sql
check "bans stick to the phone hash; ban list has no policy" bash -c "grep -q 'from banned_phones where phone_hash' supabase/migrations/20260806000034_phone_bans.sql && ! git grep -q -E 'create policy .* on public\.banned_phones' -- supabase/migrations"
check "rate limits on swipes, reports, messages" bash -c "grep -q 'create trigger swipes_rate_limit' supabase/migrations/20260806000035_rate_limits.sql && grep -q 'create trigger reports_rate_limit' supabase/migrations/20260806000035_rate_limits.sql && grep -q 'create trigger messages_rate_limit' supabase/migrations/20260806000035_rate_limits.sql"
check "quiet hours enforced by the push function" bash -c "grep -q 'in_quiet_hours' supabase/functions/send-push/index.ts && grep -q '>= 22' supabase/migrations/20260806000036_quiet_hours.sql"
check "members cannot set their own tier" grep -q "create trigger profiles_guard_tier" supabase/migrations/20260806000038_membership_tiers.sql
check "no deposit promise anywhere in the product" bash -c "! git grep -q -i 'deposit' -- app landing admin mobile/src"
check "CI workflow runs the full health check" grep -q "healthcheck.sh --full" .github/workflows/ci.yml
check "safety core untouched by automation: self-repair agent names it off-limits" grep -q "safety core" .claude/agents/self-repair.md

if [ "${1:-}" = "--full" ]; then
  echo "── test suites"
  check "backend suite" ./scripts/test-backend.sh
  check "app suite" ./scripts/test-app.sh
  check "web suite" ./scripts/test-web.sh
fi

echo
echo "$passes passed, $fails failed"
[ "$fails" -eq 0 ]
