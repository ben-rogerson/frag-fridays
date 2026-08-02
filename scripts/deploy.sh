#!/usr/bin/env bash
# Deploy the repo's server/ tree to the VPS and (optionally) swap the running mod.
#
# Usage:
#   scripts/deploy.sh            # sync files only, no restart
#   scripts/deploy.sh gg         # sync, then swap the running mod to gg
#   scripts/deploy.sh vanilla    # sync, then swap to vanilla (root compose profile)
#
# The VPS keeps the copyrighted game files (/opt/cs16/cs) and the built
# valve.zip archives - this script never touches them. It only syncs compose
# files, Dockerfiles, addon sources and configs, then rebuilds and restarts
# the target mod.
#
# Mod layout on the box:
#   vanilla  -> /opt/cs16/docker-compose.yml, profile "vanilla" (bind-mounts mods/)
#   gg/dm/zp -> /opt/cs16/<mod>/docker-compose.yml, own image built from addons/
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
DIR_MODS=(gg dm zp)
MOD="${1:-}"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
if [[ -n "$MOD" && "$MOD" != "vanilla" ]]; then
  [[ " ${DIR_MODS[*]} " == *" $MOD "* ]] || die "unknown mod '$MOD' (expected: vanilla ${DIR_MODS[*]})"
  [[ -f "$SERVER_DIR/$MOD/docker-compose.yml" ]] \
    || die "server/$MOD/docker-compose.yml missing - run scripts/pull.sh first?"
fi

log "checking SSH access to $HOST..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true \
  || die "cannot SSH to $HOST - check ~/.ssh/config and that your key is authorised on the box"

# --- sync --------------------------------------------------------------------
log "syncing server/ -> $HOST:$REMOTE_ROOT/"
rsync -tvz "$SERVER_DIR/docker-compose.yml" "$HOST:$REMOTE_ROOT/docker-compose.yml"
for d in "${DIR_MODS[@]}"; do
  [[ -d "$SERVER_DIR/$d" ]] || continue
  rsync -rlptvz --delete \
    --exclude 'valve.zip' \
    --exclude '.DS_Store' \
    "$SERVER_DIR/$d/" "$HOST:$REMOTE_ROOT/$d/"
done

# userconfig.cfg lives inside the game files tree (it ships to players via
# valve.zip). Rebuilding valve.zip so players actually receive changes is a
# separate step: pnpm run clientcfg (runs update-clientcfg.sh on the box).
log "installing userconfig.cfg into game files tree"
rsync -tvz "$SERVER_DIR/config/userconfig.cfg" "$HOST:$REMOTE_ROOT/cs/cstrike/userconfig.cfg"

log "installing update-clientcfg.sh"
rsync -tpvz "$SERVER_DIR/update-clientcfg.sh" "$HOST:$REMOTE_ROOT/update-clientcfg.sh"

# the root compose bind-mounts these; they must exist even when empty
ssh "$HOST" "mkdir -p $REMOTE_ROOT/mods/{zp,gg,dm}/{plugins,configs}"

if [[ -z "$MOD" ]]; then
  log "files synced. No mod named, so nothing was restarted."
  log "to swap/restart a mod: pnpm run deploy <vanilla|gg|dm|zp>"
  exit 0
fi

# --- swap mod ----------------------------------------------------------------
# One mod at a time: everything binds 27016 so the player URL never changes.
log "stopping whatever is running..."
ssh "$HOST" "
  cd $REMOTE_ROOT && docker compose --profile vanilla down --remove-orphans 2>/dev/null || true
  for d in ${DIR_MODS[*]}; do
    [ -f $REMOTE_ROOT/\$d/docker-compose.yml ] && (cd $REMOTE_ROOT/\$d && docker compose down --remove-orphans) || true
  done
"

if [[ "$MOD" == "vanilla" ]]; then
  log "starting vanilla (root compose, profile vanilla)..."
  ssh "$HOST" "cd $REMOTE_ROOT && docker compose --profile vanilla up -d"
else
  log "building and starting $MOD..."
  ssh "$HOST" "cd $REMOTE_ROOT/$MOD && docker compose build && docker compose up -d"
fi

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
