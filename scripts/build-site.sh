#!/usr/bin/env bash
set -euo pipefail

# 40/Love — assemble the deployable website into site/
#   site/index.html        ← landing/index.html   (waitlist page)
#   site/demo/index.html   ← app/index.html       (clickable prototype)
#   site/favicon.png       ← mobile/assets/icon.png
#
# Deploy: drag the site/ folder onto https://app.netlify.com/drop
# (or point any static host at site/). Re-run this script after editing
# landing/index.html or app/index.html, then re-deploy.

cd "$(dirname "$0")/.."

rm -rf site
mkdir -p site/demo
cp landing/index.html site/index.html
cp app/index.html site/demo/index.html
cp mobile/assets/icon.png site/favicon.png

echo "site/ assembled:"
find site -type f | sort
