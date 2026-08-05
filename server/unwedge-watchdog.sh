#!/bin/sh
# unwedge-watchdog: the webxash sim freezes permanently if every connected
# client goes silent at once (clients that then time out can never be reaped,
# and new joins hang - see docs/backlog.md item 14). A frozen sim is
# unambiguous: status.json stops changing, while a healthy one ticks
# roundTimeLeft every second. Cron runs this every 5 min; a restart heals it.
#
# Installed on the box at /opt/cs16/unwedge-watchdog.sh via:
#   */5 * * * * /opt/cs16/unwedge-watchdog.sh >> /opt/cs16/logs/unwedge.log 2>&1
set -eu

c=$(docker ps --filter publish=27016 --format '{{.Names}}' | head -n1)
[ -n "$c" ] || exit 0 # no game container - nothing to watch

s1=$(curl -fsS --max-time 5 http://127.0.0.1:27016/status.json) || exit 0
sleep 45
s2=$(curl -fsS --max-time 5 http://127.0.0.1:27016/status.json) || exit 0

if [ "$s1" = "$s2" ]; then
  echo "$(date -u '+%F %T') sim frozen (status.json static for 45s) - restarting $c"
  docker restart "$c"
fi
