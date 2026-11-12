#!/usr/bin/env bash
# 40/LOVE — run one test suite INSIDE a container.
#
# You don't call this directly: scripts/test-in-docker.ps1 (Windows) and
# scripts/test-in-docker.sh (macOS/Linux) start the right container and run it.
#
#   docker-suite.sh backend|app|web
#
# The repo is mounted read-only at /src and copied to /work first, so nothing a
# suite writes (node_modules, a .build folder, a throwaway database) ever lands
# in your checkout — and a Windows checkout's CRLF line endings are stripped
# from the copy, which is the only thing that stops these bash and SQL files
# running as they are.
set -uo pipefail

suite="${1:-}"
mkdir -p /work
cd /src
tar --exclude=node_modules --exclude=.git --exclude=.build -cf - . | tar -xf - -C /work
cd /work
find scripts supabase tests -type f \( -name '*.sh' -o -name '*.sql' \) -exec sed -i 's/\r$//' {} +

case "$suite" in
  backend)
    # test-backend.sh first checks that the committed setup.sql matches the
    # migrations. Both had their CRLFs stripped above, so that check compares
    # content; it is NOT rebuilt here, or a stale setup.sql could never fail.
    bash scripts/test-backend.sh
    ;;
  app)
    bash scripts/test-app.sh
    ;;
  web)
    PW_CHROMIUM="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"
    export PW_CHROMIUM
    bash scripts/test-web.sh
    ;;
  *)
    echo "usage: docker-suite.sh backend|app|web" >&2
    exit 2
    ;;
esac
