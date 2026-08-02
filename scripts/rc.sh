#!/usr/bin/env bash
# Send console commands to the LIVE server via the cmdpipe plugin (no rcon on
# this stack - see docs/troubleshooting.md). Each invocation bumps a serial
# number and atomically replaces /opt/cs16/cmdpipe/cmd.txt; cmdpipe.amxx polls
# the file every second and executes the lines once.
#
# Usage:
#   scripts/rc.sh "changelevel de_dust2"
#   scripts/rc.sh "amxx plugins" "status"     # multiple commands, one write
#
# Tails the container log afterwards so command output is visible here.
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
[[ $# -ge 1 ]] || { echo "usage: scripts/rc.sh \"<console command>\" [more...]" >&2; exit 1; }

printf '%s\n' "$@" | ssh "$HOST" '
  set -euo pipefail
  DIR=/opt/cs16/cmdpipe
  mkdir -p "$DIR"
  serial=$(( $(head -n1 "$DIR/cmd.txt" 2>/dev/null || echo 0) + 1 ))
  tmp=$(mktemp "$DIR/.cmd.XXXXXX")
  { echo "$serial"; cat; } > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$DIR/cmd.txt"
  echo "[rc] sent #$serial"
  sleep 3
  c=$(docker ps --filter publish=27016 --format "{{.Names}}" | head -n1)
  if [ -n "$c" ]; then
    echo "[rc] console output ($c):"
    docker logs --since 5s "$c" 2>&1 | tail -n 25
  else
    echo "[rc] no container on 27016 - nothing is reading the pipe"
  fi
'
