#!/usr/bin/env bash
# Point the site's countdown at the coming Friday, from data/sessions.json.
# Run after editing the schedule (and after each session, to roll the clock
# to next week). Pass a date to force one: scripts/session.sh 2026-09-11
#
# Same delivery as standings.sh: the file lands in apps/web/public/assets/ so
# ordinary builds include it, AND is pushed straight to /opt/cs16/web/assets/,
# which every mod's container bind-mounts - the live page picks it up with no
# restart and no rebuild.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=apps/web/public/assets/session.json
mkdir -p "$(dirname "$OUT")"

python3 scripts/session.py "$@" > "$OUT"
echo "==> wrote $OUT"

echo "==> pushing to cs16:/opt/cs16/web/assets/"
ssh cs16 'mkdir -p /opt/cs16/web/assets'
scp -q "$OUT" cs16:/opt/cs16/web/assets/session.json
echo "==> countdown live at /assets/session.json"
