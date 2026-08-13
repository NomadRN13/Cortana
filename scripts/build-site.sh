#!/usr/bin/env bash
set -euo pipefail

# 40/Love — assemble the deployable website into site/
#   site/index.html        ← landing/index.html   (waitlist page)
#   site/demo/index.html   ← app/index.html       (clickable prototype)
#   site/admin/index.html  ← admin/index.html     (moderation desk; safe to
#                            deploy — every action is authorized by the
#                            database's admin list, not by the page)
#   site/favicon.png       ← mobile/assets/favicon.png (the store icon
#                            rendered small; it ships on every page load)
#
# Deploy: drag the site/ folder onto https://app.netlify.com/drop
# (or point any static host at site/). Re-run this script after editing
# landing/index.html or app/index.html, then re-deploy.

cd "$(dirname "$0")/.."

rm -rf site
mkdir -p site/demo site/privacy site/terms site/admin
cp landing/index.html site/index.html
cp app/index.html site/demo/index.html
cp landing/privacy.html site/privacy/index.html
cp landing/terms.html site/terms/index.html
cp admin/index.html site/admin/index.html
cp mobile/assets/favicon.png site/favicon.png

echo "site/ assembled:"
find site -type f | sort
