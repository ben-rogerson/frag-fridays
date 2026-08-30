#!/usr/bin/env bash
# Regenerate the season standings from the kill logs and push the JSON live.
# Run after each Friday session (any extra args are passed to standings.py,
# e.g. --all-days).
#
# scripts/mirror-logs.sh refreshes data/logs/ first, and that archive - not
# the box - is what standings.py reads (see that script for why).
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

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
OUT=apps/web/public/assets/standings.json
LOGS=data/logs
mkdir -p "$(dirname "$OUT")" "$LOGS"

BOX_UP=1
scripts/mirror-logs.sh || { [ $? = 3 ] && BOX_UP=0; }

COUNT=$(ls "$LOGS"/*/L*.log 2>/dev/null | wc -l | tr -d ' ')
[ "$COUNT" -gt 0 ] || { echo "no kill logs in $LOGS/ - nothing to do" >&2; exit 1; }
echo "==> $COUNT log files in $LOGS/"

cat "$LOGS"/*/L*.log | python3 scripts/standings.py "$@" > "$OUT"
echo "==> wrote $OUT"

if [ "$BOX_UP" = 1 ]; then
  echo "==> pushing to $HOST:$REMOTE_ROOT/web/assets/"
  ssh "$HOST" "mkdir -p $REMOTE_ROOT/web/assets"
  scp -q "$OUT" "$HOST:$REMOTE_ROOT/web/assets/standings.json"
  echo "==> standings live at /assets/standings.json"
else
  echo "==> box down - not pushed live; re-run when it is back up" >&2
fi
