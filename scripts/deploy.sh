#!/usr/bin/env bash
# Deploy the repo's server/ tree to the VPS and (optionally) swap the running mod.
#
# Usage:
#   scripts/deploy.sh            # sync files only, no restart
#   scripts/deploy.sh gg         # sync, then swap the running mod to gg
#   scripts/deploy.sh cpl        # sync, then swap to cpl (root compose profile)
#
# Runs from a clean main only - the syncs use --delete, so deploying any other
# tree removes from the box whatever that tree is missing. CS16_DEPLOY_FORCE=1
# skips both checks for an emergency.
#
# The VPS keeps the copyrighted game files (/opt/cs16/cs) and the built
# valve.zip archives - this script never touches them. It only syncs compose
# files, Dockerfiles, addon sources and configs, then rebuilds and restarts
# the target mod.
#
# Mod layout on the box:
#   cpl            -> /opt/cs16/docker-compose.yml, profile "cpl" (bind-mounts mods/)
#   gg/dm/zp/aim/  -> /opt/cs16/<mod>/docker-compose.yml, own image built from addons/
#   css/fy/awp/
#   classical
set -euo pipefail

HOST="${CS16_HOST:-cs16}"
REMOTE_ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
DIR_MODS=(gg dm zp aim css fy awp classical)
MOD="${1:-}"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
# main only. The syncs below run --delete, so a deploy from a branch that
# doesn't have some feature yet doesn't just skip it - it wipes it off the
# box (the war room went dead exactly this way). main is the one tree that
# has everything, so it is the only tree allowed to push.
# Uncommitted work is the same hazard in reverse: what ships is the working
# TREE, not the commit, so anything half-done rides along, and the next
# deploy from a clean main silently reverts it.
# Both checks are off in a genuine emergency: CS16_DEPLOY_FORCE=1 pnpm run deploy
if [[ "${CS16_DEPLOY_FORCE:-}" != "1" ]]; then
  BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  [[ -n "$BRANCH" ]] || die "not a git checkout - refusing to deploy (CS16_DEPLOY_FORCE=1 overrides)"
  [[ "$BRANCH" == "main" ]] \
    || die "on branch '$BRANCH' - deploy runs from main only, or the --delete syncs wipe whatever main has and this branch doesn't. Merge to main first (CS16_DEPLOY_FORCE=1 overrides)."
  [[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]] \
    || die "working tree is dirty - commit or stash first, so the box matches main (CS16_DEPLOY_FORCE=1 overrides):
$(git -C "$REPO_ROOT" status --short)"
fi

if [[ -n "$MOD" && "$MOD" != "cpl" ]]; then
  [[ " ${DIR_MODS[*]} " == *" $MOD "* ]] || die "unknown mod '$MOD' (expected: cpl ${DIR_MODS[*]})"
  [[ -f "$SERVER_DIR/$MOD/docker-compose.yml" ]] \
    || die "server/$MOD/docker-compose.yml missing - run scripts/pull.sh first?"
fi

log "checking SSH access to $HOST..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true \
  || die "cannot SSH to $HOST - check ~/.ssh/config and that your key is authorised on the box"

# --- web client --------------------------------------------------------------
# apps/web builds into server/web; the composes mount index.html + assets/
# over the image's stock client. Build fresh so the box never gets stale
# assets (server/web is gitignored).
if [[ -d "$REPO_ROOT/apps/web" ]]; then
  log "building web client (apps/web -> server/web)"
  (cd "$REPO_ROOT" && pnpm --filter @frag-friday/web build)
fi

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

if [[ -d "$SERVER_DIR/web" ]]; then
  log "syncing web client"
  # index.html is a single-FILE bind mount in the composes, so the running
  # container keeps the inode it opened at start. A normal rsync (temp file
  # + rename) creates a new inode and the live page goes stale/broken until
  # the next restart; --inplace rewrites the existing inode so the mount
  # stays fresh. The assets/ DIRECTORY mount has no such problem.
  rsync -rlptvz --delete --exclude 'index.html' "$SERVER_DIR/web/" "$HOST:$REMOTE_ROOT/web/"
  rsync -tvz --inplace "$SERVER_DIR/web/index.html" "$HOST:$REMOTE_ROOT/web/index.html"
fi

# userconfig.cfg lives inside the game files tree (it ships to players via
# valve.zip). Rebuilding valve.zip so players actually receive changes is a
# separate step: pnpm run clientcfg (runs update-clientcfg.sh on the box).
log "installing userconfig.cfg into game files tree"
rsync -tvz "$SERVER_DIR/config/userconfig.cfg" "$HOST:$REMOTE_ROOT/cs/cstrike/userconfig.cfg"

log "installing update-clientcfg.sh"
rsync -tpvz "$SERVER_DIR/update-clientcfg.sh" "$HOST:$REMOTE_ROOT/update-clientcfg.sh"

# cron-driven sim watchdog (heals a precache-leak death, recycles an idle sim).
# The crontab entry is installed by hand once - see the header of the script.
log "installing sim-watchdog.sh"
rsync -tpvz "$SERVER_DIR/sim-watchdog.sh" "$HOST:$REMOTE_ROOT/sim-watchdog.sh"

# cpl's mapcycle and ruleset (mounted by the root compose; every other mod
# ships theirs in its own mod dir)
if [[ -d "$SERVER_DIR/cpl" ]]; then
  rsync -rlptvz --delete "$SERVER_DIR/cpl/" "$HOST:$REMOTE_ROOT/cpl/"
fi

# cpl's loading-screen mode blurb (gg/dm ship theirs inside their dirs)
if [[ -f "$SERVER_DIR/info-cpl.json" ]]; then
  rsync -tvz "$SERVER_DIR/info-cpl.json" "$HOST:$REMOTE_ROOT/info-cpl.json"
fi

# custom maps go into the game files tree (server plays from it; clientcfg
# bundles them into valve.zip when a mapcycle references them). Additive on
# purpose - never --delete against the SteamCMD-installed stock maps.
if [[ -d "$SERVER_DIR/maps" ]]; then
  log "installing custom maps into game files tree"
  rsync -rtvz "$SERVER_DIR/maps/" "$HOST:$REMOTE_ROOT/cs/cstrike/maps/"
fi

# non-map client assets a custom map needs (wads, overviews, gfx/env skies,
# sounds) - an overlay of cstrike/, additive for the same reason as maps.
# Client-only: the server proved it loads wad-referencing maps without the
# wad, so containers never mount these; they ride valve.zip via clientcfg.
if [[ -d "$SERVER_DIR/custom" ]]; then
  log "installing custom client assets into game files tree"
  rsync -rtvz "$SERVER_DIR/custom/" "$HOST:$REMOTE_ROOT/cs/cstrike/"
fi

# the root compose bind-mounts these; they must exist even when empty.
# cmdpipe is the remote-console drop dir (scripts/rc.sh -> cmdpipe.amxx).
# logs/<mod> receives HL kill logs; chown so the container's xashds (1000)
# can write through the bind mount. cores/ catches segfault dumps (host
# kernel.core_pattern points at /cores; 1777 so any container uid can write).
ssh "$HOST" "mkdir -p $REMOTE_ROOT/mods/{zp,gg,dm}/{plugins,configs} $REMOTE_ROOT/cmdpipe $REMOTE_ROOT/logs/{gg,dm,aim,css,fy,awp,classical,cpl} $REMOTE_ROOT/cores \
  && chown 1000:1000 $REMOTE_ROOT/logs/{gg,dm,aim,css,fy,awp,classical,cpl} && chmod 1777 $REMOTE_ROOT/cores"

# --- mcp control plane -------------------------------------------------------
# Always-on, own compose project, publishes 27017 only - never part of the
# mod swap below and can never trip the single-container-on-27016 check.
# Skipped until /opt/cs16/mcp.env exists (one-time secret setup, see
# docs/runbook: MCP section).
if [[ -d "$SERVER_DIR/mcp" ]]; then
  log "syncing mcp server"
  rsync -rlptvz --delete --exclude node_modules --exclude '.DS_Store' \
    "$SERVER_DIR/mcp/" "$HOST:$REMOTE_ROOT/mcp/"
  if ssh "$HOST" "test -f $REMOTE_ROOT/mcp.env"; then
    log "building and (re)starting mcp container..."
    ssh "$HOST" "cd $REMOTE_ROOT/mcp && docker compose up -d --build"
  else
    log "SKIPPING mcp start: $REMOTE_ROOT/mcp.env missing (create it to enable the remote MCP server)"
  fi
fi

if [[ -z "$MOD" ]]; then
  log "files synced. No mod named, so nothing was restarted."
  log "to swap/restart a mod: pnpm run deploy <cpl|classical|gg|dm|zp|aim|css|fy|awp>"
  exit 0
fi

# --- swap mod ----------------------------------------------------------------
# One mod at a time: everything binds 27016 so the player URL never changes.

# The teardown below DESTROYS the old container and its docker logs with it -
# cpl's only record of play, and crash output on any mod (learned
# 2026-08-14: two engine crashes left no evidence). Snapshot first.
log "snapshotting console logs of the running container..."
ssh "$HOST" 'c=$(docker ps --filter publish=27016 --format "{{.Names}}" | head -n1); \
  if [ -n "$c" ]; then mkdir -p '"$REMOTE_ROOT"'/logs/console \
  && docker logs --since 24h "$c" > '"$REMOTE_ROOT"'/logs/console/$c-$(date -u +%Y%m%dT%H%M%SZ).log 2>&1 \
  && echo "  saved logs/console/$c-$(date -u +%Y%m%dT%H%M%SZ).log"; fi'

log "stopping whatever is running..."
ssh "$HOST" "
  cd $REMOTE_ROOT && docker compose --profile cpl down --remove-orphans 2>/dev/null || true
  for d in ${DIR_MODS[*]}; do
    [ -f $REMOTE_ROOT/\$d/docker-compose.yml ] && (cd $REMOTE_ROOT/\$d && docker compose down --remove-orphans) || true
  done
"

if [[ "$MOD" == "cpl" ]]; then
  log "starting cpl (root compose, profile cpl)..."
  ssh "$HOST" "cd $REMOTE_ROOT && docker compose --profile cpl up -d"
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
