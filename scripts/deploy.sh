#!/usr/bin/env bash
# Deploy the repo's server/ tree to the VPS and (optionally) swap the running mod.
#
# Usage:
#   scripts/deploy.sh            # sync files only, no restart
#   scripts/deploy.sh gg         # sync, then swap the running mod to gg
#   scripts/deploy.sh vanilla    # sync, then swap to vanilla
#
# The VPS keeps the copyrighted game files (/opt/cs16/cs) and built valve.zip
# archives - this script never touches them. It only syncs config, Dockerfiles,
# compose files and scripts, then rebuilds and restarts the target mod.
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
MODS=(vanilla gg dm)
MOD="${1:-}"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
if [[ -n "$MOD" ]]; then
  [[ " ${MODS[*]} " == *" $MOD "* ]] || die "unknown mod '$MOD' (expected: ${MODS[*]})"
  [[ -f "$SERVER_DIR/$MOD/docker-compose.yml" ]] \
    || die "server/$MOD/docker-compose.yml missing - has the repo been seeded? Run scripts/pull.sh first."
fi

log "checking SSH access to $HOST..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true \
  || die "cannot SSH to $HOST - check ~/.ssh/config and that your key is authorised on the box"

# --- sync --------------------------------------------------------------------
log "syncing server/ -> $HOST:$REMOTE_ROOT/"
rsync -rlptvz --delete \
  --exclude 'valve.zip' \
  --exclude '.DS_Store' \
  --exclude 'README.md' \
  "$SERVER_DIR/vanilla" "$SERVER_DIR/gg" "$SERVER_DIR/dm" \
  "$SERVER_DIR/config" "$SERVER_DIR/scripts" \
  "$HOST:$REMOTE_ROOT/"

# userconfig.cfg lives inside the game files tree (it ships to players via
# valve.zip), so it gets copied there separately. Rebuilding valve.zip is a
# deliberate manual step: ssh cs16 '/opt/cs16/scripts/update-clientcfg.sh <mod>'
if [[ -f "$SERVER_DIR/config/userconfig.cfg" ]]; then
  log "installing userconfig.cfg into game files tree"
  rsync -tvz "$SERVER_DIR/config/userconfig.cfg" "$HOST:$REMOTE_ROOT/cs/cstrike/userconfig.cfg"
fi

ssh "$HOST" "chmod +x $REMOTE_ROOT/scripts/*.sh 2>/dev/null || true"

if [[ -z "$MOD" ]]; then
  log "files synced. No mod named, so nothing was restarted."
  log "to swap/restart a mod: pnpm run deploy <vanilla|gg|dm>"
  exit 0
fi

# --- swap mod ----------------------------------------------------------------
# One mod at a time: they all bind 27016 so the player URL never changes.
for other in "${MODS[@]}"; do
  [[ "$other" == "$MOD" ]] && continue
  log "stopping $other (if running)..."
  ssh "$HOST" "[ -f $REMOTE_ROOT/$other/docker-compose.yml ] && cd $REMOTE_ROOT/$other && docker compose down --remove-orphans || true"
done

log "building and starting $MOD..."
ssh "$HOST" "cd $REMOTE_ROOT/$MOD && docker compose build && docker compose up -d"

# --- verify ------------------------------------------------------------------
# Mandatory: containers look identical in-browser, and restart policies have
# silently stolen port 27016 before. Never announce without checking docker ps.
log "verifying with docker ps..."
sleep 3
RUNNING="$(ssh "$HOST" "docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'")"
printf '%s\n' "$RUNNING"

COUNT="$(printf '%s\n' "$RUNNING" | grep -c '27016' || true)"
if [[ "$COUNT" -eq 0 ]]; then
  die "nothing is listening on 27016 - the $MOD container did not come up. Check: pnpm run logs $MOD"
elif [[ "$COUNT" -gt 1 ]]; then
  die "more than one container claims 27016 - a stale container has stolen the port. Fix before announcing."
fi

log "done. $MOD is up on http://149.28.172.74:27016"
log "if the client config changed, rebuild valve.zip: ssh $HOST '$REMOTE_ROOT/scripts/update-clientcfg.sh $MOD'"
