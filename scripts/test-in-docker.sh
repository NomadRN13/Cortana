#!/usr/bin/env bash
# RSVPlay — run every test suite in Docker, from macOS or Linux.
# (On Windows use scripts/test-in-docker.ps1, which does the same thing.)
#
#   ./scripts/test-in-docker.sh              # all three suites
#   ./scripts/test-in-docker.sh backend web  # some (backend | app | web)
#   ./scripts/test-in-docker.sh --clean      # remove the three images and exit
#   ./scripts/test-in-docker.sh web --clean  # run, then remove the images
#
# Each suite runs in a throwaway container with the repo mounted read-only, so
# nothing is written into your checkout. The images (about 2.5 GB in total) are
# downloaded the first time and kept so later runs start in seconds.
set -uo pipefail

cd "$(dirname "$0")/.."
repo="$(pwd)"

# Keep the Playwright tag in step with tests/web/package-lock.json.
image_for() {
  case "$1" in
    backend) echo 'postgres:16' ;;
    app)     echo 'node:20-slim' ;;
    web)     echo 'mcr.microsoft.com/playwright:v1.62.1-noble' ;;
  esac
}

clean=0
suites=""
for arg in "$@"; do
  case "$arg" in
    --clean) clean=1 ;;
    backend|app|web) suites="$suites $arg" ;;
    *) echo "unknown argument: $arg (backend | app | web | --clean)" >&2; exit 2 ;;
  esac
done
[ -z "$suites" ] && [ "$clean" = 0 ] && suites="backend app web"

if [ -n "$suites" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed (no docker command found)." >&2; exit 1
  fi
  if ! docker version >/dev/null 2>&1; then
    echo "Docker is not running. Start it and try again." >&2; exit 1
  fi
fi

fails=0
summary=""
for s in $suites; do
  image="$(image_for "$s")"
  [ -z "$image" ] && { echo "unknown suite: $s (backend | app | web)" >&2; exit 2; }
  echo
  echo "=== $s suite ($image) ==="
  extra=""
  [ "$s" = "web" ] && extra="--ipc=host"
  # shellcheck disable=SC2086
  if docker run --rm $extra -v "$repo:/src:ro" "$image" bash -c "sed 's/\r\$//' /src/scripts/docker-suite.sh | bash -s $s"; then
    summary="$summary\n  PASS  $s"
  else
    summary="$summary\n  FAIL  $s"
    fails=$((fails + 1))
  fi
done

if [ -n "$suites" ]; then
  echo
  echo "=== Summary ==="
  printf "%b\n" "$summary"
fi

if [ "$clean" = 1 ]; then
  for s in backend app web; do docker image rm "$(image_for "$s")" >/dev/null 2>&1 && echo "removed $(image_for "$s")"; done
fi
exit "$fails"
