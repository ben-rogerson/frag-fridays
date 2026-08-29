#!/usr/bin/env bash
# Restart the current map on the LIVE server (changelevel to itself - full
# reload: entities, timer, scores; players stay connected). Announces a
# 5-second centre-screen warning (amx_csay) before the reload.
# Requires the cmdpipe plugin (gg/dm/aim only).
#
# Usage: scripts/restartmap.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

name=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1)
[[ -n "$name" ]] || { echo "[restartmap] no container on 27016 - server is down" >&2; exit 1; }

current=$(ssh "$HOST" "docker logs --tail 5000 $name 2>&1 | grep -aoE 'Started map \"[^\"]+\"' | tail -1" | sed 's/.*"\(.*\)"/\1/')
[[ -n "$current" ]] || { echo "[restartmap] could not detect current map from logs" >&2; exit 1; }

echo "[restartmap] mod=${name%%-*} announcing, then restarting $current"
scripts/rc.sh "amx_csay green Restarting map in 5 seconds..." >/dev/null
sleep 5
exec scripts/rc.sh "changelevel $current"
