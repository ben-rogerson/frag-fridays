#!/usr/bin/env bash
# Seed (or re-sync) the repo's server/ tree FROM the VPS.
#
# Run this once to populate the repo from the live box, and again any time
# something was changed on the server by hand. It maps the box's original
# ad-hoc layout into the repo layout:
#
#   /opt/cs16/docker-compose.yml            -> server/vanilla/docker-compose.yml
#   /opt/cs16/gg/{Dockerfile,compose,addons} -> server/gg/
#   /opt/cs16/dm/docker-compose.yml          -> server/dm/
#   /opt/cs16/update-clientcfg.sh            -> server/scripts/
#   /opt/cs16/cs/cstrike/userconfig.cfg      -> server/config/
#
# Never pulls: game files (/opt/cs16/cs), valve.zip, mod archives (/opt/cs16/src).
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"

log() { printf '\033[1;35m[pull]\033[0m %s\n' "$*"; }

log "checking SSH access to $HOST..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true || {
  echo "cannot SSH to $HOST" >&2; exit 1; }

mkdir -p "$SERVER_DIR"/{vanilla,gg,dm,config,scripts}

log "pulling vanilla compose file..."
rsync -tvz "$HOST:$REMOTE_ROOT/docker-compose.yml" "$SERVER_DIR/vanilla/docker-compose.yml" 2>/dev/null \
  || rsync -tvz "$HOST:$REMOTE_ROOT/vanilla/docker-compose.yml" "$SERVER_DIR/vanilla/docker-compose.yml" 2>/dev/null \
  || log "  (no vanilla compose found - skipped)"

log "pulling gg/ (excluding valve.zip)..."
rsync -rlptvz --exclude 'valve.zip' "$HOST:$REMOTE_ROOT/gg/" "$SERVER_DIR/gg/" \
  || log "  (gg pull failed - skipped)"

log "pulling dm/ (excluding valve.zip)..."
rsync -rlptvz --exclude 'valve.zip' "$HOST:$REMOTE_ROOT/dm/" "$SERVER_DIR/dm/" \
  || log "  (no dm dir - skipped)"

log "pulling server-side scripts..."
rsync -tvz "$HOST:$REMOTE_ROOT/update-clientcfg.sh" "$SERVER_DIR/scripts/update-clientcfg.sh" 2>/dev/null \
  || rsync -tvz "$HOST:$REMOTE_ROOT/scripts/update-clientcfg.sh" "$SERVER_DIR/scripts/update-clientcfg.sh" 2>/dev/null \
  || log "  (update-clientcfg.sh not found - skipped)"

log "pulling shared client config..."
rsync -tvz "$HOST:$REMOTE_ROOT/cs/cstrike/userconfig.cfg" "$SERVER_DIR/config/userconfig.cfg" 2>/dev/null \
  || log "  (userconfig.cfg not found - skipped)"

log "done. Review with: git status && git diff"
log "note: after the first deploy, the box uses the repo layout ($REMOTE_ROOT/vanilla, $REMOTE_ROOT/scripts)."
