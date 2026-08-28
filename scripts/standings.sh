#!/usr/bin/env bash
# Regenerate the season standings from the box's kill logs and push the
# JSON live. Run after each Friday session (any extra args are passed to
# standings.py, e.g. --all-days).
#
# Which slice of the logs counts as the session comes from data/sessions.json
# - one entry per Friday, because the slot moves. If a week's board looks
# short, check that week's entry there before touching anything else.
#
# The file lands in apps/web/public/assets/ so ordinary builds include it,
# AND is pushed straight to /opt/cs16/web/assets/ - that dir is bind-mounted
# into every mod's container, so the live page picks it up with no restart.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=apps/web/public/assets/standings.json
mkdir -p "$(dirname "$OUT")"

echo "==> pulling kill logs from the box"
ssh cs16 'cat /opt/cs16/logs/*/L*.log 2>/dev/null' | python3 scripts/standings.py "$@" > "$OUT"
echo "==> wrote $OUT"

echo "==> pushing to cs16:/opt/cs16/web/assets/"
ssh cs16 'mkdir -p /opt/cs16/web/assets'
scp -q "$OUT" cs16:/opt/cs16/web/assets/standings.json
echo "==> standings live at /assets/standings.json"
