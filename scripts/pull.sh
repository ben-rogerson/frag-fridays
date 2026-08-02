#!/usr/bin/env bash
# Seed (or re-sync) the repo's server/ tree FROM the VPS.
#
# server/ mirrors /opt/cs16 1:1 for everything worth tracking:
#
#   /opt/cs16/docker-compose.yml        -> server/docker-compose.yml  (profile-based: vanilla)
#   /opt/cs16/{gg,dm,zp}/               -> server/{gg,dm,zp}/         (minus valve.zip)
#   /opt/cs16/cs/cstrike/userconfig.cfg -> server/config/userconfig.cfg
#
# Never pulled: game files (cs/), valve.zip anywhere, mod archives (src/),
# SteamCMD internals (linux32/, linux64/, package/, public/, siteserverui/),
# .env (stays on the box; holds only PUBLIC_IP).
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"

log() { printf '\033[1;35m[pull]\033[0m %s\n' "$*"; }

log "checking SSH access to $HOST..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true || {
  echo "cannot SSH to $HOST" >&2; exit 1; }

mkdir -p "$SERVER_DIR/config"

log "pulling root docker-compose.yml (profile-based, vanilla lives here)..."
rsync -tvz "$HOST:$REMOTE_ROOT/docker-compose.yml" "$SERVER_DIR/docker-compose.yml"

for mod in gg dm zp; do
  log "pulling $mod/ (excluding valve.zip)..."
  rsync -rlptvz --delete --exclude 'valve.zip' \
    "$HOST:$REMOTE_ROOT/$mod/" "$SERVER_DIR/$mod/"
done

log "pulling shared client config..."
rsync -tvz "$HOST:$REMOTE_ROOT/cs/cstrike/userconfig.cfg" "$SERVER_DIR/config/userconfig.cfg"

log "done. Review with: git status && git diff"
