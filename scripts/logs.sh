#!/usr/bin/env bash
# Tail logs for a mod's container on the VPS.
# Usage: scripts/logs.sh [vanilla|gg|dm|aim|css|fy|awp]   (defaults to gg)
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
MOD="${1:-gg}"

exec ssh -t "$HOST" "cd $REMOTE_ROOT/$MOD && docker compose logs -f --tail 100"
