#!/usr/bin/env bash
# Advance the LIVE server to the next map in the running mod's mapcycle
# (wraps around). Uses changelevel so players stay connected. Announces a
# 5-second centre-screen warning (amx_csay) before the change.
# Requires the cmdpipe plugin (gg/dm/kz only).
#
# Usage: scripts/nextmap.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

name=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1)
[[ -n "$name" ]] || { echo "[nextmap] no container on 27016 - server is down" >&2; exit 1; }
mod=${name%%-*}
[[ "$mod" == "cs16" ]] && mod=vanilla # root compose names its container cs16-vanilla-1

# read the cycle from the container, not the repo copy - the mod images
# shuffle their mapcycle.txt on every start (entrypoint.sh), so the repo
# order no longer matches the live rotation
cycle=$(ssh "$HOST" "docker exec $name cat cstrike/mapcycle.txt") \
  || { echo "[nextmap] could not read mapcycle from container $name" >&2; exit 1; }

current=$(ssh "$HOST" "docker logs --tail 5000 $name 2>&1 | grep -aoE 'Started map \"[^\"]+\"' | tail -1" | sed 's/.*"\(.*\)"/\1/')

next=$(python3 -c "
import sys
ms = [l.strip() for l in sys.stdin if l.strip()]
cur = sys.argv[1]
i = ms.index(cur) if cur in ms else -1
print(ms[(i + 1) % len(ms)])
" "$current" <<< "$cycle")

echo "[nextmap] mod=$mod current=${current:-unknown} next=$next"
scripts/rc.sh "amx_csay green Next map: $next - changing in 5 seconds..." >/dev/null
sleep 5
exec scripts/rc.sh "changelevel $next"
