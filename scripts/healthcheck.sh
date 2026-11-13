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
# The "must be absent" checks below are `! git grep`: if git cannot read this tree
# (no .git, or "dubious ownership" in a container) they would pass on nothing.
check "git can search this work tree (the must-be-absent checks depend on it)" git grep --untracked -q -e RSVPlay -- CLAUDE.md
# the retired name must not come back anywhere but git history and the proposals/log that mention it by name
residue=$(git grep --untracked -I -n -i -E "40 ?/ ?love|40%2Flove|fortylove|40love|40-love" -- . ':!presentations/' ':!scripts/healthcheck.sh' ':!docs/proposals/' ':!docs/improvement-log.md' ':!CLAUDE.md' ':!docs/brand-guide.md' ':!docs/rules-and-stops.md' ':!docs/business-plan.md' ':!docs/self-improvement-network.md' ':!netlify.toml' ':!docs/go-live-rename.md' 2>/dev/null | wc -l)
if [ "$residue" = "0" ]; then pass "no 40/Love residue in product, docs, tests or agents"; else fail "40/Love residue: $residue line(s) (git grep -i '40/love|fortylove|40love|40-love')"; fi
check "wordmark is RSVPlay + ball in the prototype" grep -q "el.innerHTML = 'RSVPlay<span class=\"ball\">" app/index.html
check "no retired palette hexes in app/landing/admin/mobile" bash -c '! git grep --untracked -q -i -E "#(0A0B0D|D6F44F|F4F6F0|17191D|1F2227|101215)" -- app landing admin mobile/src scripts/make-icons.js'

echo "── derived files are current"
check "supabase/setup.sql matches the migrations" ./scripts/build-setup-sql.sh --check
check "site/ matches landing/, app/ and admin/" bash -c 'for p in "landing/index.html site/index.html" "app/index.html site/demo/index.html" "admin/index.html site/admin/index.html" "landing/privacy.html site/privacy/index.html" "landing/terms.html site/terms/index.html" "landing/delete-account.html site/delete-account/index.html"; do set -- $p; diff -q <(sed "s|content=\"https://[^\"]*/og.png\"|content=\"/og.png\"|g" "$2") "$1" >/dev/null || exit 1; done'
check "the go-live upgrade (33–41) matches the migrations" ./scripts/build-go-live.sh --check
check "brand/tokens.json current and all surfaces agree" node scripts/build-tokens.js --check
check "every page carries the shared ball mark" bash -c 'for f in landing/index.html app/index.html admin/index.html; do grep -q "mark:defs" "$f" || exit 1; done'

echo "── rules and stops still enforced (docs/rules-and-stops.md vs the code)"
for m in 20260806000033 20260806000034 20260806000035 20260806000036 20260806000037 20260806000038 20260806000039 20260805000001 20260806000003 20260806000006 20260806000007 20260806000008 20260806000009 20260806000014 20260806000015 20260806000017 20260806000019 20260806000020 20260806000023 20260806000024 20260806000027 20260806000029 20260806000030 20260806000031 20260806000032; do
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
check "admins table has no client policy" bash -c "! git grep --untracked -q -E 'create policy .* on public\.admins' -- supabase/migrations"
check "is_blocked() exists and blocks are symmetric" bash -c "grep -q 'function public.is_blocked' supabase/migrations/20260805000001_initial_schema.sql && test -f supabase/migrations/20260806000019_block_symmetry.sql"
check "hard account deletion function exists" grep -q "function public.delete_account" supabase/migrations/20260806000006_privacy_hardening.sql
check "app: under-18 stop" grep -q "RSVPlay is 18+" mobile/src/screens/OnboardingScreen.js
check "app: phone verification required to continue" grep -q "Verify your phone number to continue" mobile/src/screens/OnboardingScreen.js
check "app: coarse location permission only" grep -q "ACCESS_COARSE_LOCATION" mobile/app.json
check "store: precise location, microphone and overlay are blocked on Android" bash -c "node -e \"const b=require('./mobile/app.json').expo.android.blockedPermissions||[];['ACCESS_FINE_LOCATION','ACCESS_BACKGROUND_LOCATION','RECORD_AUDIO','SYSTEM_ALERT_WINDOW'].forEach(x=>{if(!b.includes('android.permission.'+x))process.exit(1)})\""
check "store: no Always-location or microphone prompt on iOS" bash -c "node -e \"const p=require('./mobile/app.json').expo.plugins;const l=p.find(x=>x[0]==='expo-location')[1],i=p.find(x=>x[0]==='expo-image-picker')[1];process.exit(l.locationAlwaysPermission===false&&l.locationAlwaysAndWhenInUsePermission===false&&i.microphonePermission===false?0:1)\""
check "store: encryption answer and privacy manifest are declared for iOS" bash -c "node -e \"const i=require('./mobile/app.json').expo.ios;process.exit(i.config&&i.config.usesNonExemptEncryption===false&&i.privacyManifests&&i.privacyManifests.NSPrivacyAccessedAPITypes.length>=4?0:1)\""
check "store: a production build refuses to start in demo mode" bash -c "cd mobile && ! EAS_BUILD_PROFILE=production EXPO_PUBLIC_SUPABASE_URL= EXPO_PUBLIC_SUPABASE_ANON_KEY= node -e \"require('./app.config.js')({config:require('./app.json').expo})\" 2>/dev/null"
check "store: backend keys and Firebase file are never committed" bash -c "cd mobile && git check-ignore -q .env && git check-ignore -q google-services.json && git check-ignore -q play-service-account.json"
check "agents: every agent keeps the humans-send rule or a never-runs line" bash -c 'for a in .claude/agents/*.md; do grep -q -i -E "draft|never (send|run|submit|publish|commit)|recommend" "$a" || exit 1; done'
M=supabase/migrations
check "check-in only by host code (member-write guard on RSVPs)" grep -q "create trigger event_rsvps_guard_member_writes" $M/20260806000033_checkin_waiver_crew.sql
check "an RSVP cannot be moved to another event or member" grep -q "new.event_id is distinct from old.event_id or new.user_id is distinct from old.user_id" $M/20260806000033_checkin_waiver_crew.sql
check "a checked-in RSVP cannot be deleted or demoted by its owner" bash -c "[ \"\$(grep -c \"You''ve already checked in to this one\" $M/20260806000033_checkin_waiver_crew.sql)\" -ge 2 ]"
check "who checked in, and when, is not selectable by members" grep -q "grant select (event_id, user_id, status, created_at) on public.event_rsvps to authenticated" $M/20260806000033_checkin_waiver_crew.sql
check "check-in requires the waiver" grep -q "Accept the event waiver first" $M/20260806000033_checkin_waiver_crew.sql
check "waiver acceptances are kept on their own record" grep -q "insert into waiver_acceptances" $M/20260806000033_checkin_waiver_crew.sql
check "five wrong check-in codes lock check-in" grep -q "max_tries constant int := 5" $M/20260806000033_checkin_waiver_crew.sql
check "check-in codes have exactly one policy, and it is admin-only" bash -c "[ \"\$(cat $M/*.sql | grep -c 'on public.event_checkin_codes\$')\" = 1 ] && grep -A2 'create policy checkin_codes_admin' $M/20260806000033_checkin_waiver_crew.sql | grep -q 'using (public.is_admin()) with check (public.is_admin())'"
check "crew dating flag is mutual, age-checked and server-decided" bash -c "grep -q 'p.gender = any (me.seeking) and me.gender = any (p.seeking)' $M/20260806000033_checkin_waiver_crew.sql && grep -q 'age_of(me.birthdate) between p.age_min and p.age_max' $M/20260806000033_checkin_waiver_crew.sql && grep -q \"'date' = any (me.modes) and 'date' = any (p.modes)\" $M/20260806000033_checkin_waiver_crew.sql && grep -q 'age_of(p.birthdate) between me.age_min and me.age_max' $M/20260806000033_checkin_waiver_crew.sql"
check "crew, attempts, waiver record and rate log are not readable through the API" bash -c "for t in crew_adds event_checkin_attempts waiver_acceptances rate_events banned_phones app_settings; do cat $M/*.sql | grep -q \"revoke all on public.\$t from anon, authenticated\" || exit 1; cat $M/*.sql | grep -q -E \"create policy .* on public\\.\$t\" && exit 1; done; exit 0"
check "a banned number never verifies" grep -q "exists (select 1 from banned_phones where phone_hash = public.phone_ban_hash(v_phone))" $M/20260806000034_phone_bans.sql
check "a suspended member cannot shed it by deleting" grep -q "Deleted while suspended" $M/20260806000041_ban_survives_deletion.sql
# Line breaks are folded first, so a wrapped sentence cannot hide. safety-support.md is
# safety core and still carries the line until the founder signs decision 7 off.
check "no agent or outreach draft leads with the retired dating-first line" bash -c '! cat $(ls .claude/agents/*.md | grep -v safety-support.md) outreach/launch/store-listing.md outreach/indianapolis/*.md | tr "\n" " " | tr -s " " | grep -qiE "dating and social app|social and dating app"'
check "rate limits pinned: 500 swipes/24h, 20 reports/24h, 60 messages/min" bash -c "grep -q \"'swipe', 500, interval '24 hours'\" $M/20260806000035_rate_limits.sql && grep -q \"'report', 20, interval '24 hours'\" $M/20260806000035_rate_limits.sql && grep -q \"'message', 60, interval '1 minute'\" $M/20260806000035_rate_limits.sql"
check "rate limits use the server's clock" bash -c "grep -q 'new.created_at := now()' $M/20260806000035_rate_limits.sql && grep -q 'new.sent_at := now()' $M/20260806000035_rate_limits.sql"
check "quiet hours pinned to 10pm-8am and enforced by the push function" bash -c "grep -q 'rpc(\"in_quiet_hours\"' supabase/functions/send-push/index.ts && grep -q 'if (quiet === true) return new Response' supabase/functions/send-push/index.ts && grep -q '>= 22' $M/20260806000036_quiet_hours.sql && grep -q '< 8' $M/20260806000036_quiet_hours.sql"
check "ladder: two rungs, closes up on any departure, block ends a challenge" bash -c "grep -q 'greatest(hi, lo - 2)' $M/20260806000037_leagues.sql && grep -q 'create trigger league_members_close_up' $M/20260806000037_leagues.sql && grep -q 'create trigger blocks_end_league_challenges' $M/20260806000037_leagues.sql"
check "members cannot set their own tier" grep -q "create trigger profiles_guard_tier" $M/20260806000038_membership_tiers.sql
check "a verified phone is required to swipe, message, RSVP, enter or join" bash -c "for t in swipes messages event_rsvps tournament_entries league_members; do grep -q \"create trigger \${t}_require_phone\" $M/20260806000039_require_verified_phone.sql || exit 1; done"
check "the phone requirement ships ON" grep -q "require_verified_phone boolean not null default true" $M/20260806000039_require_verified_phone.sql
check "the harness mirrors Supabase's default function grants" grep -q "alter default privileges in schema public grant execute on functions to anon, authenticated" supabase/tests/backend.sql
check "no deposit promise anywhere in the product" bash -c "! git grep --untracked -q -i 'deposit' -- app landing admin mobile/src"
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
