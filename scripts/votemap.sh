#!/usr/bin/env bash
# Start a map vote on the LIVE server: amx_votemap with 4 random picks from
# the running mod's mapcycle. Randomness comes from python's shuffle so the
# picks are genuinely uniform. Requires the cmdpipe plugin (gg/dm only).
#
# Usage: scripts/votemap.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

name=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1)
[[ -n "$name" ]] || { echo "[votemap] no container on 27016 - server is down" >&2; exit 1; }
mod=${name%%-*}
cycle="server/$mod/mapcycle.txt"
[[ -f "$cycle" ]] || { echo "[votemap] no mapcycle for running mod '$mod' ($cycle missing; vanilla has no cmdpipe)" >&2; exit 1; }

maps=$(python3 -c "
import random, sys
ms = [l.strip() for l in open(sys.argv[1]) if l.strip()]
print(' '.join(random.sample(ms, min(4, len(ms)))))
" "$cycle")

echo "[votemap] mod=$mod candidates: $maps"
exec scripts/rc.sh "amx_votemap $maps"
