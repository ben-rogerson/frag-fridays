#!/usr/bin/env bash
# Mirror the box's HL kill logs into data/logs/ - the local archive that
# standings.sh and the /friday-recap skill both read.
#
# /opt/cs16/logs is otherwise the ONLY copy of the season, and it dies with
# the instance. data/logs/ is gitignored, so it is a second copy on this
# machine, not an off-site backup.
#
# Additive on purpose - no --delete. A rebuilt box comes back with an empty
# logs dir, and must never be able to erase history by looking empty. That
# also makes it safe to prune the BOX's logs (the recap only needs the
# session day) - but never prune data/logs/, standings.py replays the whole
# season from it every run.
#
# Exit 0 = mirrored. Exit 3 = box unreachable, archive left as-is; callers
# can carry on with what they have.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
LOGS=data/logs
mkdir -p "$LOGS"

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null; then
  echo "==> $HOST unreachable - using the $LOGS/ archive as-is" >&2
  exit 3
fi

# Only L*.log - logs/console/ is docker output and logs/*.log are the
# watchdog's; neither parser reads them.
echo "==> mirroring kill logs to $LOGS/"
rsync -rtz --prune-empty-dirs \
  --include='*/' --include='L*.log' --exclude='*' \
  "$HOST:$REMOTE_ROOT/logs/" "$LOGS/"
