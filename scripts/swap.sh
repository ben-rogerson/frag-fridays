#!/usr/bin/env bash
# Swap the LIVE server to another mod, with an in-game heads-up first.
# A swap rebuilds + restarts the container - it DROPS all players; they
# rejoin at the same URL once it's back. Don't do this mid-session.
#
# Usage: scripts/swap.sh <cpl|classical|gg|dm|aim|css|fy|awp>
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

mod="${1:-}"
# labels are what the site calls each mode - keep them equal to the `mode`
# string in that mod's info.json, or the csay names something nobody can find.
case "$mod" in
  cpl)       label="CPL Tournament" ;;
  classical) label="ClassicAl" ;;
  gg)        label="GunGame" ;;
  dm)        label="Deathmatch" ;;
  aim)       label="Aim Prac" ;;
  css)       label="Source Maps" ;;
  fy)        label="Fight Yard" ;;
  awp)       label="Sniper" ;;
  *) echo "usage: scripts/swap.sh <cpl|classical|gg|dm|aim|css|fy|awp>" >&2; exit 1 ;;
esac

# Heads-up to connected players. Everything but zp has cmdpipe - cpl gets it
# from the box-side mods/zp mounts (server/mcp/src/cmdpipe.js says the same).
# If nothing is running there is no console, so skip rather than fail the swap.
# cpl runs from the ROOT compose project, so its container is cs16-cpl-1 and
# the prefix is the project name, not the mod (same idiom as exec.js).
name=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1 || true)
running="${name%%-*}"
if [[ "$running" == "cs16" ]]; then running=cpl; fi
case "$running" in
  cpl|classical|gg|dm|aim|css|fy|awp)
    scripts/rc.sh "amx_csay green Switching server to $label - you will be dropped, rejoin the same URL in a couple of minutes" >/dev/null || true
    sleep 8
    ;;
esac

echo "[swap] $running -> $mod (deploy.sh enforces the single-container check)"
exec scripts/deploy.sh "$mod"
