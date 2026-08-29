#!/usr/bin/env bash
# Force a team rebalance on the LIVE server: evens the T/CT headcount, bots
# moved first, then the lowest-frag humans. Players stay connected; moved
# players respawn instantly on their new side. Requires the teambalance
# plugin (baked into gg/dm images only - vanilla has no cmdpipe).
#
# Usage: scripts/rebalance.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

name=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1)
[[ -n "$name" ]] || { echo "[rebalance] no container on 27016 - server is down" >&2; exit 1; }

mod=${name%%-*}
case "$mod" in
  gg|dm) ;;
  *) echo "[rebalance] running mod is '$mod' - teambalance is baked into gg/dm only" >&2; exit 1 ;;
esac

echo "[rebalance] mod=$mod sending ff_rebalance"
exec scripts/rc.sh "ff_rebalance"
