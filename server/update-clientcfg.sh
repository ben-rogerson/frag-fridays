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

# --- build -------------------------------------------------------------------
trap 'rm -f "$STAGE"' EXIT
rm -f "$STAGE"
log "building $STAGE from $SRC/{valve,cstrike} (one dot per 10MB, ~440MB total)..."
START=$SECONDS
(cd "$SRC" && zip -r -qdgds 10m "$STAGE" valve cstrike)
echo
log "built in $((SECONDS - START))s: $(du -h "$STAGE" | cut -f1)"

# --- verify ------------------------------------------------------------------
log "verifying archive..."

BAD_ROOT="$(unzip -Z1 "$STAGE" | grep -vE '^(valve|cstrike)/' || true)"
[[ -z "$BAD_ROOT" ]] || die "archive root must contain only valve/ and cstrike/, found:
$BAD_ROOT"

DISK_COUNT="$(find "$SRC/valve" "$SRC/cstrike" -type f | wc -l | tr -d ' ')"
ZIP_COUNT="$(unzip -Z1 "$STAGE" | grep -cv '/$')"
[[ "$DISK_COUNT" == "$ZIP_COUNT" ]] \
  || die "file count mismatch: $DISK_COUNT on disk vs $ZIP_COUNT in archive"

unzip -p "$STAGE" cstrike/userconfig.cfg | cmp -s - "$SRC/cstrike/userconfig.cfg" \
  || die "userconfig.cfg in archive does not match the game tree"

log "verified: $ZIP_COUNT files, userconfig.cfg matches game tree"

# --- install -----------------------------------------------------------------
for target in "${TARGETS[@]}"; do
  log "installing -> $target"
  cp "$STAGE" "$target.tmp" && mv "$target.tmp" "$target"
done
rm -f "$STAGE"

# --- restart running mod -----------------------------------------------------
RUNNING="$(docker ps --filter publish=27016 --format '{{.Names}}' || true)"
if [[ -z "$RUNNING" ]]; then
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

log "done. $MOD is serving the new valve.zip on http://149.28.172.74:27016"
