#!/usr/bin/env bash
# The README film, every step from one place. See README.md for when to run which.
#
#   ./film.sh capture   screens again: a throwaway instance, demo data, the real UI frozen into ui/, instance removed
#   ./film.sh stills    stills around every cut and a contact sheet (out/stills.png), to look at after a capture
#   ./film.sh render    the film (out/film.mp4) and the README version (stellarr.webp), then the checks
#   ./film.sh all       capture, then render
#   ./film.sh down      remove the throwaway instance and its data (after an interrupted capture)
#   ./film.sh purge     the same, and also its package caches
#   ./film.sh logs      the throwaway instance's logs, when it does not come up
#   ./film.sh clean     empty out/ except the rendered film
#
# Needs Docker with Compose, Node 22+, ffmpeg, Python 3 with Pillow, and Chromium or Chrome.
set -euo pipefail
cd "$(dirname "$0")"
FILM=$PWD

# The throwaway instance is its own Compose project. Every command below names it, because
# docker-compose.dev.yml declares `name: stellarr-dev`, and a bare `down -v` would delete the
# development database instead. The repository is needed only for its compose file.
PROJECT=stellarr-film
compose() {
  local repo=${STELLARR_REPO:-$(git -C "$FILM" rev-parse --show-toplevel)}
  docker compose -f "$repo/docker-compose.dev.yml" -f "$FILM/capture/compose.film.yml" -p "$PROJECT" --env-file "$FILM/capture/film.env" "$@"
}
WEB=http://127.0.0.1:3100 API=http://127.0.0.1:5100 COCKPIT=http://127.0.0.1:3101

# the seconds around each cut and key moment, for `stills`
CUTS=0.3,1.9,3.8,5.9,6.2,9,12.5,19.55,20.8,22,24.97,28,30.6,30.85,33,34.95,36.4,37.6,41.3,44.8,48,51.5,53.9,54.8,57,59.4

down() {
  compose down 2>/dev/null || true
  # the instance's data goes, so the next capture starts empty; npm, NuGet and build caches stay
  docker volume rm "${PROJECT}_stellarr_dev_data" "${PROJECT}_stellarr_dev_objects" >/dev/null 2>&1 || true
}

up() {
  down
  compose up -d --no-deps rustfs api web cockpit
  echo "waiting for the instance (the first start installs packages and builds the API, a few minutes)"
  for _ in $(seq 1 300); do
    a=$(curl -s -o /dev/null -w '%{http_code}' "$API/api/bootstrap" || true)
    w=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/login" || true)
    c=$(curl -s -o /dev/null -w '%{http_code}' "$COCKPIT/" || true)
    if [ "$a" != 000 ] && [ "$w" = 200 ] && [ "$c" = 200 ]; then echo "ready"; return; fi
    sleep 3
  done
  echo "the instance did not come up; see: ./film.sh logs" >&2
  exit 1
}

capture() {
  up
  trap down EXIT
  (cd capture && export STELLARR_FILM_WEB=$WEB STELLARR_FILM_COCKPIT=$COCKPIT && node seed.mjs && node capture.mjs && node pack.mjs)
  down
  trap - EXIT
  echo "captured; reference screenshots of the live app are in out/capture/. Next: ./film.sh stills"
}

stills() {
  node tools/render.mjs --src index.html --still "$CUTS"
  tools/export.sh stills out/stills out/stills.png 6
  echo "look at out/stills.png (and out/stills/ at full size)"
}

render() {
  node tools/render.mjs --src index.html --out film.mp4
  python3 tools/webp.py out/film.mp4 stellarr.webp
  python3 tools/check_film.py --composition index.html --film out/film.mp4 --length 60 --format 1920x1080 --audio no --webp stellarr.webp
  tools/export.sh sheet out/film.mp4 out/sheet.png
  echo "done: stellarr.webp (commit it) and out/film.mp4; one frame per second in out/sheet.png"
}

clean() {
  find out -mindepth 1 -maxdepth 1 ! -name film.mp4 -exec rm -rf {} + 2>/dev/null || true
}

case "${1:-}" in
  capture) capture ;;
  stills) stills ;;
  render) render ;;
  all) capture && render ;;
  down) down ;;
  purge) compose down -v ;;
  logs) compose logs --tail 80 ;;
  clean) clean ;;
  *) sed -n '2,14p' "$0" ;;
esac
