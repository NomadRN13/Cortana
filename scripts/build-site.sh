#!/usr/bin/env bash
set -euo pipefail

# 40/LOVE — assemble the deployable website into site/
#   site/index.html        ← landing/index.html   (waitlist page)
#   site/demo/index.html   ← app/index.html       (clickable prototype)
#   site/delete-account/   ← landing/delete-account.html (Play requirement)
#   site/admin/index.html  ← admin/index.html     (moderation desk; safe to
#                            deploy — every action is authorized by the
#                            database's admin list, not by the page)
#   site/og.png            ← mobile/assets/og.png (shared-link preview card)
#   site/robots.txt        ← written here
#   site/favicon.png       ← mobile/assets/favicon.png (the store icon
#                            rendered small; it ships on every page load)
#
# Deploy: drag the site/ folder onto https://app.netlify.com/drop
# (or point any static host at site/). Re-run this script after editing
# landing/index.html or app/index.html, then re-deploy.

cd "$(dirname "$0")/.."

rm -rf site
mkdir -p site/demo site/privacy site/terms site/delete-account site/admin
cp landing/index.html site/index.html
cp app/index.html site/demo/index.html
cp landing/privacy.html site/privacy/index.html
cp landing/terms.html site/terms/index.html
# Google Play requires a publicly reachable account-deletion page, not just
# the in-app button. It is linked from the Play listing and the Data Safety form.
cp landing/delete-account.html site/delete-account/index.html
cp admin/index.html site/admin/index.html
cp mobile/assets/favicon.png site/favicon.png
cp mobile/assets/og.png site/og.png

# Keep the moderation desk out of search results. It is safe to deploy — every
# action is authorised by the database's admin list — but there is no reason for
# it to be indexed, and /demo is the link worth ranking, not a crawler's guess.
cat > site/robots.txt <<'ROBOTS'
User-agent: *
Disallow: /admin/
Allow: /
ROBOTS

# Facebook, LinkedIn and iMessage do not resolve a relative og:image, so a site
# built without this has no preview card on any link anyone shares — which is
# the entire point of having one. It defaults to where the site lives today
# rather than being opt-in, because go-live.sh rebuilds without setting it and
# the failure is invisible until someone pastes a link.
#     SITE_URL=https://40love.app bash scripts/build-site.sh   # after a move
BASE="${SITE_URL:-https://40-love.netlify.app}"
BASE="${BASE%/}"
find site -name '*.html' -exec sed -i.bak \
  -e "s|content=\"/og.png\"|content=\"$BASE/og.png\"|g" "{}" +
find site -name '*.bak' -delete
echo "==> Preview cards point at $BASE/og.png"

echo "site/ assembled:"
find site -type f | sort
