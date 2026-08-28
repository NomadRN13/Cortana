#!/usr/bin/env bash
set -euo pipefail

# 40/LOVE — connect the apps to your Supabase project.
#
# Run this AFTER creating the project and applying the database
# (scripts/setup-supabase.sh, or pasting supabase/setup.sql in the SQL editor).
#
#   ./scripts/go-live.sh <project-url> <anon-public-key>
#
# It writes the keys everywhere they belong, rebuilds the website, and then
# actually calls your project to prove the connection works — rather than
# leaving you to find out from a blank app later.

cd "$(dirname "$0")/.."

URL="${1:-}"
KEY="${2:-}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  cat <<USAGE
Usage: ./scripts/go-live.sh <project-url> <anon-public-key>

Both are in your Supabase dashboard under Settings → API:
  Project URL      looks like  https://abcdefghijk.supabase.co
  anon public key  a long token starting with  eyJ...

Copy the key labelled "anon" / "public". NOT "service_role" — that one is a
master key; this script refuses it.
USAGE
  exit 1
fi

# ---- sanity-check the inputs before writing them anywhere -----------------

URL="${URL%/}"
if ! printf '%s' "$URL" | grep -Eq '^https://[a-z0-9-]+\.supabase\.(co|in)$'; then
  echo "✗ That doesn't look like a Supabase project URL." >&2
  echo "  Expected something like https://abcdefghijk.supabase.co" >&2
  echo "  Got: $URL" >&2
  exit 1
fi

# The anon key and the service_role key look identical to the naked eye and
# sit next to each other in the dashboard. Pasting service_role into the
# website would hand every visitor full read/write access to every table,
# bypassing all row-level security. Decode the token and refuse it.
ROLE="$(printf '%s' "$KEY" | python3 -c '
import sys, base64, json
tok = sys.stdin.read().strip()
parts = tok.split(".")
if len(parts) != 3:
    print("NOT_A_TOKEN"); raise SystemExit
try:
    pad = parts[1] + "=" * (-len(parts[1]) % 4)
    print(json.loads(base64.urlsafe_b64decode(pad)).get("role", "UNKNOWN"))
except Exception:
    print("UNREADABLE")
')"

case "$ROLE" in
  anon)
    ;;
  service_role)
    echo "✗ STOP — that is the service_role key, not the anon key." >&2
    echo "  It bypasses every security rule, and this script would have put it" >&2
    echo "  on your public website. Go back to Settings → API and copy the key" >&2
    echo "  labelled \"anon\" / \"public\" instead." >&2
    exit 1
    ;;
  *)
    echo "✗ That key isn't readable as a Supabase key (role: $ROLE)." >&2
    echo "  Copy the whole \"anon public\" value — it's long and starts with eyJ" >&2
    exit 1
    ;;
esac

echo "==> Key checks out (role: anon)"

# ---- 1. the phone app -----------------------------------------------------

ENV_FILE="mobile/.env"
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_FILE.bak"
  echo "==> Backed up existing $ENV_FILE to $ENV_FILE.bak"
fi
# Keep any Google client ids that were already set.
GOOGLE_WEB="$(grep -E '^EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
GOOGLE_IOS="$(grep -E '^EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
cat > "$ENV_FILE" <<ENV
EXPO_PUBLIC_SUPABASE_URL=$URL
EXPO_PUBLIC_SUPABASE_ANON_KEY=$KEY

# Sign in with Google — optional; the button hides itself when these are blank.
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=$GOOGLE_WEB
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=$GOOGLE_IOS
ENV
echo "==> Wrote $ENV_FILE"

# ---- 2. the website, the moderation desk and the demo ---------------------

python3 - "$URL" "$KEY" <<'PY'
import re, sys
url, key = sys.argv[1], sys.argv[2]
line = "  window.FORTYLOVE = { SUPABASE_URL: '%s', SUPABASE_ANON_KEY: '%s' };" % (url, key)
for path in ("landing/index.html", "admin/index.html", "app/index.html"):
    s = open(path).read()
    new, n = re.subn(r"^\s*window\.FORTYLOVE\s*=\s*\{[^}]*\};", line, s, count=1, flags=re.M)
    if n != 1:
        print("!! could not find the config line in %s — set it by hand" % path)
        continue
    open(path, "w").write(new)
    print("==> Wired %s" % path)
PY

# ---- 3. rebuild the deployable site ---------------------------------------

bash scripts/build-site.sh > /dev/null
echo "==> Rebuilt site/"

# ---- 4. prove it actually works -------------------------------------------

echo "==> Testing the connection..."
PROBE="$(mktemp)"
# Note the fallback assigns rather than appends: `|| echo 000` inside the
# substitution would have glued itself onto curl's own output.
if ! CODE="$(curl -s --max-time 20 -o "$PROBE" -w '%{http_code}' \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  "$URL/rest/v1/cities?select=slug&limit=1")"; then
  CODE="000"
fi

case "$CODE" in
  200)
    echo "✅ Connected. Your database answered, and the city list is readable."
    ;;
  000)
    echo "⚠️  Couldn't reach $URL at all. Check the URL and your internet." ;;
  401|403)
    echo "⚠️  The project answered but rejected the key ($CODE). Re-copy the anon key." ;;
  404)
    echo "⚠️  Connected, but there's no 'cities' table yet — the database hasn't"
    echo "    been applied. Run ./scripts/setup-supabase.sh <project-ref>, or paste"
    echo "    supabase/setup.sql into the SQL editor, then run this again." ;;
  *)
    echo "⚠️  Unexpected response $CODE:"
    head -c 300 "$PROBE" 2>/dev/null; echo ;;
esac

cat <<DONE

Done wiring. What's left, in order:

  1. Turn on email sign-in     Authentication → Sign In / Up → Email
                               (check the Magic Link template contains {{ .Token }})
                               Before a tester night, also add your own SMTP
                               under Project Settings → Authentication. The
                               built-in sender allows only a few codes an hour
                               for the whole project — fine for you alone, not
                               for twelve people signing up at a mixer.
  2. Make yourself an admin    sign in once at /admin, then run the one-line
                               SQL from docs/backend-setup.md
  3. Text verification         add Twilio under Authentication → Phone,
                               or live signups stall at the phone step
  4. Push notifications        see docs/backend-setup.md
  5. Try it                    cd mobile && npx expo start

Push this commit and your website goes live with the same keys.
DONE
