#!/usr/bin/env bash
# Control the pressbox spectator container on the box.
#
# The pressbox is a Playwright/Chromium sibling service (see server/pressbox)
# that joins the running mod as a spectator and screenshots the game canvas.
# It runs as its own compose project - never touched by mod-swap logic and
# only publishes 27060, so it can't trip the single-container-on-27016 check.
#
# Usage:
#   scripts/pressbox.sh up       # build (if needed) + start
#   scripts/pressbox.sh down     # stop + remove container
#   scripts/pressbox.sh restart  # down + up
#   scripts/pressbox.sh status   # docker ps + /health snapshot
#   scripts/pressbox.sh logs     # tail container logs (Ctrl-C to exit)
#   scripts/pressbox.sh shot     # download latest.png to ./pressbox-shot.png
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="${1:-status}"

log() { printf '\033[1;36m[pressbox]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[pressbox]\033[0m %s\n' "$*" >&2; exit 1; }

case "$CMD" in
  up)
    # Sync the source first so `up` is enough on its own after a code change -
    # matches the mcp/ mental model (edit + up = deployed).
    log "syncing server/pressbox -> $HOST:$REMOTE_ROOT/pressbox/"
    rsync -rlptvz --delete --exclude '.DS_Store' \
      "$REPO_ROOT/server/pressbox/" "$HOST:$REMOTE_ROOT/pressbox/"
    log "building + starting on $HOST"
    ssh "$HOST" "mkdir -p $REMOTE_ROOT/pressbox-out && cd $REMOTE_ROOT/pressbox && docker compose up -d --build"
    sleep 3
    ssh "$HOST" "docker ps --filter publish=27060 --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'"
    log "viewer: http://\${IP:-149.28.172.74}:27060/"
    ;;
  down)
    log "stopping on $HOST"
    ssh "$HOST" "cd $REMOTE_ROOT/pressbox && docker compose down --remove-orphans"
    ;;
  restart)
    "$0" down
    "$0" up
    ;;
  status)
    ssh "$HOST" "
      set -e
      echo '--- docker ps ---'
      docker ps --filter publish=27060 --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
      echo
      echo '--- /health ---'
      curl -fsS http://127.0.0.1:27060/health 2>/dev/null || echo '(pressbox not reachable on :27060)'
      echo
      echo '--- /opt/cs16/pressbox-out ---'
      ls -la $REMOTE_ROOT/pressbox-out 2>/dev/null | head -n 20 || echo '(no output dir yet)'
    "
    ;;
  logs)
    ssh -t "$HOST" "cd $REMOTE_ROOT/pressbox && docker compose logs -f --tail=200"
    ;;
  shot)
    out="${REPO_ROOT}/pressbox-shot.png"
    log "fetching latest frame -> $out"
    ssh "$HOST" 'curl -fsS http://127.0.0.1:27060/latest.png' > "$out" \
      || die "no frame available - is pressbox up? try: scripts/pressbox.sh status"
    log "wrote $out ($(wc -c <"$out") bytes)"
    ;;
  *)
    die "unknown command '$CMD' (expected: up|down|restart|status|logs|shot)"
    ;;
esac
