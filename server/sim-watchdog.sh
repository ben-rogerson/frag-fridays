#!/bin/sh
# sim-watchdog: keeps the game sim alive between manual visits. Two jobs, in
# order of urgency.
#
# 1. HEAL A DEAD SIM. The engine leaks model precache slots across map loads,
#    so a long-lived process eventually blows the 4096 cap and kills itself:
#
#      Host_Error: MAX_MODELS limit exceeded (4096)
#      Server was killed due to an error
#
#    The container stays up and keeps serving the page, so nothing looks
#    wrong from outside - players just hang forever on the splash screen.
#    On 2026-08-28 that went unnoticed for six hours.
#
#    Detection is by LOG MARKER, deliberately not by status.json staleness.
#    The previous watchdog (removed 2026-08-14, commit 024e6fb) compared
#    status.json 45s apart, which cannot tell a dead sim from a paused one -
#    the sim also freezes when every connected client goes quiet at once, so
#    it mass-kicked idlers ~5 min after each session wound down. A kill line
#    that is NEWER than the last proof-of-life line is unambiguous: a paused
#    sim still has its `Spawn Server` after any older kill.
#
# 2. AGE OUT AN IDLE SIM. The leak is armed by uptime plus map churn (it took
#    ~11h on 2026-08-28), so a sim that has been up all day is likely to die
#    partway through the evening. Recycling it while it is EMPTY costs
#    nobody anything. There is no schedule to know here: the Friday slot
#    moves week to week (data/sessions.json), so this keys off uptime and an
#    empty server instead, and can therefore never interrupt a session.
#
# Installed on the box at /opt/cs16/sim-watchdog.sh (rsynced by deploy.sh) via:
#   */5 * * * * /opt/cs16/sim-watchdog.sh >> /opt/cs16/logs/sim-watchdog.log 2>&1
set -eu

MAX_IDLE_UPTIME=28800 # 8h - recycle an empty sim older than this
MIN_UPTIME=300        # 5m - grace after any restart, including our own

say() { echo "$(date -u '+%F %T') $*"; }

c=$(docker ps --filter publish=27016 --format '{{.Names}}' | head -n1)
[ -n "$c" ] || exit 0 # no game container - nothing to watch

# A container that only just booted has not had time to log its first
# `Spawn Server`, and restarting it again on that basis would loop forever.
started=$(docker inspect -f '{{.State.StartedAt}}' "$c")
uptime=$(($(date -u +%s) - $(date -u -d "$started" +%s)))
[ "$uptime" -ge "$MIN_UPTIME" ] || exit 0

# 1. dead sim. Compare LINE NUMBERS, not timestamps: the engine's own clock
# is not on every line, and docker logs are already in order.
logs=$(docker logs --tail 20000 "$c" 2>&1 || true)
alive=$(printf '%s\n' "$logs" | grep -n -a -E 'Spawn Server|player server started' | tail -n1 | cut -d: -f1)
# only the kill line, not every Host_Error - the engine prints Host_Error for
# faults it goes on to recover from, and `Server was killed` is the one that
# means the sim is gone (same line docs/troubleshooting.md diagnoses on)
dead=$(printf '%s\n' "$logs" | grep -n -a 'Server was killed due to an error' | tail -n1 | cut -d: -f1)
if [ -n "$dead" ] && { [ -z "$alive" ] || [ "$dead" -gt "$alive" ]; }; then
  say "sim dead (kill line after last spawn) - restarting $c"
  printf '%s\n' "$logs" | grep -a -E 'Host_Error:|Server was killed' | tail -n3
  docker restart "$c"
  exit 0
fi

# 2. old and empty. Unreachable status.json means we cannot prove the server
# is empty, so leave it alone - job 1 covers the case where it is actually dead.
[ "$uptime" -ge "$MAX_IDLE_UPTIME" ] || exit 0
status=$(curl -fsS --max-time 5 http://127.0.0.1:27016/status.json) || exit 0
humans=$(printf '%s' "$status" | sed -n 's/.*"humans":[[:space:]]*\([0-9]*\).*/\1/p')
[ -n "$humans" ] || exit 0
if [ "$humans" -eq 0 ]; then
  say "sim up ${uptime}s with no humans - recycling $c ahead of the precache leak"
  docker restart "$c"
fi
