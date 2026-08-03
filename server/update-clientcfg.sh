#!/usr/bin/env bash
# Rebuild valve.zip from the game files tree and restart the running mod so
# players actually receive client config changes.
#
# Runs ON the box as /opt/cs16/update-clientcfg.sh (synced by scripts/deploy.sh;
# from the laptop use `pnpm run clientcfg`, which syncs configs first).
#
# valve.zip is the client payload: the browser build downloads the whole thing
# into RAM on first join (no lazy loading). Rules encoded here:
#   - archive root contains ONLY valve/ and cstrike/ - anything else breaks
#     the client's filesystem mount
#   - built from /opt/cs16/cs/{valve,cstrike}, the single source of truth
#     (deploy.sh installs userconfig.cfg into that tree before this runs)
#   - ONE canonical zip at /opt/cs16/valve.zip - every mod's compose mounts
#     it (mod composes use ../valve.zip), so mods cannot drift; the ~600KB of
#     gungame sounds shipping to everyone is noise against a ~438MB archive
#   - compose bind-mounts the zip file by inode, so the running mod must go
#     down/up before clients are served the new build
set -euo pipefail

ROOT="${CS16_REMOTE_ROOT:-/opt/cs16}"
SRC="$ROOT/cs"
STAGE="$ROOT/valve.zip.new"
TARGETS=("$ROOT/valve.zip")

log() { printf '\033[1;33m[clientcfg]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[clientcfg]\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
[[ -d "$SRC/valve" && -d "$SRC/cstrike" ]] \
  || die "$SRC/{valve,cstrike} missing - is this running on the box?"
[[ -f "$SRC/cstrike/userconfig.cfg" ]] \
  || die "no userconfig.cfg in the game tree - run pnpm run deploy (or clientcfg) from the laptop first"
command -v zip >/dev/null || die "zip is not installed (apt install zip)"

AVAIL_KB="$(df --output=avail -k "$ROOT" | tail -1 | tr -d ' ')"
(( AVAIL_KB > 1000000 )) || die "less than 1GB free on $ROOT - not risking a rebuild"

# --- client payload trim -----------------------------------------------------
# The zip is the client download and load time scales with it (no lazy
# loading). Two cuts, ~120MB compressed:
#   - valve/maps/ is the Half-Life single-player campaign (~96MB) - CS
#     multiplayer never loads it
#   - cstrike maps outside every mod's mapcycle.txt (~20MB). The keep-list is
#     the union of the mapcycles, so the rotation files stay the single
#     source of truth. Mod Dockerfiles regenerate maps.ini from mapcycle.txt
#     so votes can never offer a map clients don't have.
# The server itself always plays from the full cs/ tree on disk - only the
# client payload is trimmed.
# the || true guards set -o pipefail: not every mod has a mapcycle.txt
KEEP_MAPS="$({ cat "$ROOT"/{gg,dm,zp,kz}/mapcycle.txt 2>/dev/null || true; } | tr -d '\r' | grep -v '^\s*$' | sort -u)"
[[ -n "$KEEP_MAPS" ]] || die "no mod mapcycle.txt found - refusing to trim every map from the client payload"

list_files() {
  (cd "$SRC" && find valve cstrike -type f | LC_ALL=C sort) | awk -v keep="$KEEP_MAPS" '
    BEGIN { split(keep, k, "\n"); for (i in k) keepmap[k[i]] = 1 }
    /^valve\/maps\// { next }
    /^cstrike\/(maps|overviews)\// {
      n = $0; sub(/^cstrike\/(maps|overviews)\//, "", n); sub(/\.[^.]*$/, "", n)
      if (!(n in keepmap)) next
    }
    { print }'
}

# --- build -------------------------------------------------------------------
trap 'rm -f "$STAGE"' EXIT
rm -f "$STAGE"
KEPT_COUNT="$(list_files | wc -l | tr -d ' ')"
FULL_COUNT="$(find "$SRC/valve" "$SRC/cstrike" -type f | wc -l | tr -d ' ')"
log "keeping maps: $(echo "$KEEP_MAPS" | tr '\n' ' ')"
log "building $STAGE: $KEPT_COUNT of $FULL_COUNT files (one dot per 10MB)..."
START=$SECONDS
(cd "$SRC" && list_files | zip -q -dg -ds 10m "$STAGE" -@)
echo
log "built in $((SECONDS - START))s: $(du -h "$STAGE" | cut -f1)"

# --- verify ------------------------------------------------------------------
log "verifying archive..."

# single listing; per-check pipelines with grep -q die of SIGPIPE under pipefail
ZIP_LIST="$(unzip -Z1 "$STAGE")"

BAD_ROOT="$(printf '%s\n' "$ZIP_LIST" | grep -vE '^(valve|cstrike)/' || true)"
[[ -z "$BAD_ROOT" ]] || die "archive root must contain only valve/ and cstrike/, found:
$BAD_ROOT"

ZIP_COUNT="$(printf '%s\n' "$ZIP_LIST" | grep -cv '/$')"
[[ "$KEPT_COUNT" == "$ZIP_COUNT" ]] \
  || die "file count mismatch: $KEPT_COUNT in keep list vs $ZIP_COUNT in archive"

for m in $KEEP_MAPS; do
  printf '%s\n' "$ZIP_LIST" | grep -x "cstrike/maps/$m.bsp" >/dev/null \
    || die "kept map $m has no bsp in the archive - check the mapcycles against cs/cstrike/maps/"
done

unzip -p "$STAGE" cstrike/userconfig.cfg | cmp -s - "$SRC/cstrike/userconfig.cfg" \
  || die "userconfig.cfg in archive does not match the game tree"

log "verified: $ZIP_COUNT files, userconfig.cfg matches game tree"

# --- install -----------------------------------------------------------------
for target in "${TARGETS[@]}"; do
  log "installing -> $target"
  cp "$STAGE" "$target.tmp" && mv "$target.tmp" "$target"
done
rm -f "$STAGE"

# --- Cloudflare purge --------------------------------------------------------
# cs.benrogerson.dev fronts the box via Cloudflare, which caches valve.zip at
# the edge (default 4h TTL for .zip) - without a purge players on the domain
# get the PREVIOUS build until the TTL expires. Credentials live in
# $ROOT/cf.env (CF_ZONE_ID + CF_API_TOKEN, token scoped to Zone.Cache Purge).
# Must run only after the restart: the container serves the old zip by inode
# until it goes down/up, and a premature purge lets the edge re-cache it.
# purge_everything, not purge-by-URL: the 443->27016 proxy layer caches the
# zip under a key the public URL never matches (verified 2026-08-03 - URL
# purges returned success but the stale entry survived; purge_everything
# cleared it). The zone only hosts the personal site, so the collateral is
# a few cheap refetches.
purge_cloudflare() {
  if [[ ! -f "$ROOT/cf.env" ]]; then
    log "WARNING: $ROOT/cf.env missing - Cloudflare serves the OLD valve.zip for up to 4h"
    return 0
  fi
  # shellcheck source=/dev/null
  source "$ROOT/cf.env"
  log "purging valve.zip from the Cloudflare edge..."
  local resp
  resp="$(curl -sS --max-time 30 -X POST \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}')" \
    || die "Cloudflare purge request failed"
  grep -q '"success": *true' <<<"$resp" || die "Cloudflare purge rejected: $resp"
  log "Cloudflare edge purged"
}

# --- restart running mod -----------------------------------------------------
RUNNING="$(docker ps --filter publish=27016 --format '{{.Names}}' || true)"
if [[ -z "$RUNNING" ]]; then
  # nothing is serving the old zip, so the purge cannot race a re-cache
  purge_cloudflare
  log "no mod is running - new valve.zip will be served on next start. Done."
  exit 0
fi

case "$RUNNING" in
  gg-*)        MOD=gg ;;
  dm-*)        MOD=dm ;;
  zp-*)        MOD=zp ;;
  *vanilla*)   MOD=vanilla ;;
  *)           die "container '$RUNNING' holds 27016 but is not a known mod - restart it yourself" ;;
esac

log "restarting $MOD ($RUNNING) so the new zip is served..."
if [[ "$MOD" == "vanilla" ]]; then
  (cd "$ROOT" && docker compose --profile vanilla down && docker compose --profile vanilla up -d)
else
  (cd "$ROOT/$MOD" && docker compose down && docker compose up -d)
fi

# same mandatory check as deploy.sh: exactly one container on 27016
sleep 3
PS="$(docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}')"
printf '%s\n' "$PS"
COUNT="$(printf '%s\n' "$PS" | grep -c '27016' || true)"
[[ "$COUNT" -eq 1 ]] || die "expected exactly one container on 27016, found $COUNT - fix before announcing"

purge_cloudflare

log "done. $MOD is serving the new valve.zip on https://cs.benrogerson.dev"
