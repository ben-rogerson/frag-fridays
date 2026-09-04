#!/usr/bin/env bash
# Run a Classic 5v5 match on the LIVE server - the era's knife-round /
# live-on-3 / half-time procedure, as console commands over the cmdpipe.
#
# This is a script and not a plugin because Classic runs the stock image
# unbuilt and cannot compile one (docs/backlog.md item 16). Everything here is
# something you could type into `pnpm run rc` yourself; the value is that the
# steps come in the right order with the right announcements, and that nobody
# has to remember that `restart` segfaults this engine build while
# `sv_restartround` does not.
#
# Usage:
#   scripts/match.sh knife          # knife round for side choice
#   scripts/match.sh live           # go live: three restarts, then LIVE
#   scripts/match.sh half           # call half time and swap sides
#   scripts/match.sh bots <n>       # fill to n players for a warm-up (0 clears)
#   scripts/match.sh score          # current round score, off the server
#
# Every step announces itself on screen first - ten people in a browser tab
# have no other way of knowing the server just did something.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${CS16_HOST:-cs16}"

say() { printf '\033[1;36m[match]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[match]\033[0m %s\n' "$*" >&2; exit 1; }

# amx_csay's buffer is small and the pipe line has its own 192-byte cap, so
# keep every announcement short.
csay() { scripts/rc.sh "amx_csay green $1" >/dev/null; }

# Warn, don't refuse: the commands are valid on any cmdpipe mod, but the
# procedure only means anything on Classic (rounds, buy, one life).
mod=$(ssh "$HOST" 'docker ps --filter publish=27016 --format "{{.Names}}"' | head -n1)
[[ -n "$mod" ]] || die "no container on 27016 - the server is down"
# gg-xash3d-1 -> gg, but vanilla runs from the ROOT compose project so its
# container is cs16-vanilla-1 (same idiom as server/mcp/src/exec.js)
mod=${mod%%-*}
if [[ "$mod" == "cs16" ]]; then mod=vanilla; fi
if [[ "$mod" != "vanilla" ]]; then
  say "WARNING: running mod is '$mod', not Classic - sending the match commands anyway"
fi

case "${1:-}" in
  knife)
    say "knife round - announcing, then restarting the round"
    csay "KNIFE ROUND - winner picks side"
    sleep 3
    scripts/rc.sh "sv_restartround 1"
    say "knife round live. Winner picks a side; to give them the other one,"
    say "everybody rejoins (F1 = T, F2 = CT), then: scripts/match.sh live"
    ;;

  live)
    say "going live in three restarts"
    csay "LIVE ON THREE"
    sleep 2
    for n in 3 2 1; do
      say "  restart $((4 - n))/3"
      scripts/rc.sh "sv_restartround 1" >/dev/null
      sleep 5
    done
    csay "LIVE LIVE LIVE"
    say "live. First to 16 takes it; swap at 15 rounds with: scripts/match.sh half"
    ;;

  half)
    say "half time - announcing the swap"
    csay "HALF TIME - swap sides now"
    sleep 5
    csay "REJOIN THE OTHER TEAM - F1 T, F2 CT"
    say "Classic has no teambalance plugin, so the swap is manual: every"
    say "player rejoins the opposite team. When all ten are across, run:"
    say "  scripts/match.sh live"
    ;;

  bots)
    n="${2:-}"
    [[ "$n" =~ ^[0-9]+$ ]] || die "usage: scripts/match.sh bots <n>   (0 clears)"
    if [[ "$n" == "0" ]]; then
      say "clearing bots"
      scripts/rc.sh "yb_quota 0" "yb kickall"
    else
      # fill mode: n is the TOTAL headcount, humans included
      say "filling to $n players (bots make up the difference)"
      scripts/rc.sh "yb_quota $n"
    fi
    say "reminder: a container restart puts Classic back to zero bots"
    ;;

  score)
    # No score command exists in stock CS 1.6, so read the scoreboard the
    # status plugin already publishes for the web page.
    say "scoreboard from status.json"
    ssh "$HOST" 'docker exec $(docker ps --filter publish=27016 --format "{{.Names}}" | head -n1) cat public/status.json' \
      | python3 -m json.tool 2>/dev/null \
      || die "could not read status.json - is statusjson.amxx loaded on this mod?"
    ;;

  *)
    sed -n '/^# Usage:/,/^# Every step/p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
