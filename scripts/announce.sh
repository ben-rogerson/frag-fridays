#!/usr/bin/env bash
# Announce a message to all players on the LIVE server as a green
# centre-screen HUD message (amx_csay, stock adminchat plugin).
# Requires the cmdpipe plugin (gg/dm/aim/css/fy/awp only).
#
# Usage: scripts/announce.sh "message to show"
set -euo pipefail
cd "$(dirname "$0")/.."

[[ $# -ge 1 && -n "$*" ]] || { echo "usage: scripts/announce.sh \"message\"" >&2; exit 1; }

echo "[announce] $*"
exec scripts/rc.sh "amx_csay green $*"
