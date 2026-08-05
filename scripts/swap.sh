#!/usr/bin/env bash
# Swap the LIVE server to another mod, with an in-game heads-up first.
# A swap rebuilds + restarts the container - it DROPS all players; they
# rejoin at the same URL once it's back. Don't do this mid-session.
#
# Usage: scripts/swap.sh <vanilla|gg|dm|kz|aim>
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

mod="${1:-}"
case "$mod" in
  vanilla) label="Vanilla CS" ;;
  gg)      label="GunGame" ;;
  dm)      label="Deathmatch" ;;
  kz)      label="KZ jump maps" ;;
  aim)     label="Aim Prac" ;;
  *) echo "usage: scripts/swap.sh <vanilla|gg|dm|kz|aim>" >&2; exit 1 ;;
esac

# Heads-up to connected players. Only gg/dm/kz/aim have cmdpipe - if vanilla
# (or nothing) is running there's no console, so skip rather than fail the swap.
name=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1 || true)
running="${name%%-*}"
case "$running" in
  gg|dm|kz|aim)
    scripts/rc.sh "amx_csay green Switching server to $label - you will be dropped, rejoin the same URL in a couple of minutes" >/dev/null || true
    sleep 8
    ;;
esac

echo "[swap] $running -> $mod (deploy.sh enforces the single-container check)"
exec scripts/deploy.sh "$mod"
