#!/usr/bin/env bash
# Rebuild valve.zip from the game files tree and restart the running mod so
# players actually receive client config changes.
#
# Runs ON the box as /opt/cs16/update-clientcfg.sh (synced by scripts/deploy.sh;
# from the laptop use `pnpm run clientcfg`, which syncs configs first).
#
# valve.zip is the client payload: the browser build downloads the whole thing
# into RAM on first join, then hands the two pk3s inside it to the engine,
# which reads out of them on demand (see the build section for the layout and
# why the gamedir roots stay loose). Rules encoded here:
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

# --dry-run builds and verifies the archive, then throws it away: no install,
# no container restart, no Cloudflare purge. The only way to see what a trim
# change actually produces without dropping whoever is connected.
DRY_RUN=""
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

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
# loading), twice over: every byte is fetched AND inflated on the main thread.
# Measured 2026-08-30 against a 326MB build: 5158 files, 533MB unpacked, ~6s
# of JSZip inflate on a fast Mac before a single frame renders, and that is
# the floor - a mid-range laptop is several times worse. So the cheapest
# speed-up available is not shipping the file at all.
#
# Everything below is derived from the mapcycles, never hardcoded: the union
# of every mod's rotation is the single source of truth, and the wads and
# skies fall out of the maps by reading their BSPs. Hardcoded keep-lists rot -
# the mod list on THIS line was hardcoded and silently omitted awp/css/fy when
# they were added, which would have trimmed their maps out of the payload.
#
# Cuts, in order of size (all verified against the 2026-08-30 build):
#   - valve/maps/ - the Half-Life single-player campaign (~96MB raw). CS
#     multiplayer never loads it.
#   - valve/media/ (55MB) - the Half-Life CD soundtrack. CS never plays it.
#   - wads no kept map needs (35MB) - see map_deps below.
#   - skies no kept map names (18MB) - gfx/env is six TGAs per sky and the
#     tree carries every sky HL and CS ever shipped.
#   - native dlls/cl_dlls (20MB) - cs.so, client.dll, gameui.so and friends.
#     This is a WASM client: it loads cs_emscripten_wasm32.wasm and
#     client_emscripten_wasm32.wasm, which ride the page as Vite assets and
#     are never read out of the zip. No native binary here can be loaded.
#   - valve/overviews/ (11MB) - the engine reads cstrike/overviews; these are
#     the HL/TFC-era ones and nothing looks at them.
#   - cstrike maps + overviews outside the mapcycles. Mod Dockerfiles
#     regenerate maps.ini from mapcycle.txt so votes can never offer a map
#     clients don't have.
# The server itself always plays from the full cs/ tree on disk - only the
# client payload is trimmed.
#
# NOT cut, on purpose: valve/{models,sprites,sound,resource} (58MB). The
# engine falls back to valve/ for files cstrike/ doesn't carry, and which
# sounds those are is a question for a play-test, not a listing.

# glob, not a hardcoded mod list - a directory with a mapcycle.txt IS a mod.
# the || true guards set -o pipefail: the glob can legitimately match nothing
KEEP_MAPS="$({ cat "$ROOT"/*/mapcycle.txt 2>/dev/null || true; } | tr -d '\r' | grep -v '^\s*$' | sort -u)"
[[ -n "$KEEP_MAPS" ]] || die "no mod mapcycle.txt found - refusing to trim every map from the client payload"

# --- map dependencies --------------------------------------------------------
# Which wads and skies the kept maps actually need, read out of the BSPs.
#
# A map's "wad" entity key is the list the LEVEL EDITOR had open, not what the
# map needs - most stock maps embed every texture they use (the 2026-08-02
# decision-log finding). The real question is per-texture: a miptex whose
# first mip offset is 0 has no pixels in the BSP and must come from a wad.
# de_aztec names thirteen wads in its "wad" key and needs none of them.
#
# Fails loudly on a texture no wad can supply rather than shipping a map that
# renders as checkerboard - a missing wad is invisible until someone loads it.
map_deps() {
  # $KEEP_MAPS is deliberately unquoted: newline-separated map names, no
  # spaces, and they want to become one argv entry each
  # shellcheck disable=SC2086
  python3 - "$SRC" $KEEP_MAPS <<'PY'
import glob, os, re, struct, sys

src = sys.argv[1]
maps = sys.argv[2:]

# wads the client needs regardless of any map: decals, HUD fonts, sprays,
# and the two base texture wads the engine treats as always-present.
ALWAYS = {"decals.wad", "pldecal.wad", "tempdecal.wad", "fonts.wad", "gfx.wad",
          "spraypaint.wad", "cached.wad", "liquids.wad", "cstrike.wad",
          "halflife.wad"}
# a map with no skyname key gets the engine default
DEFAULT_SKY = "desert"

def lump(data, i):
    return struct.unpack_from("<ii", data, 4 + 8 * i)

def wad_textures(path):
    """texture names the BSP does NOT embed, plus its skyname"""
    with open(path, "rb") as f:
        data = f.read()
    off, ln = lump(data, 0)                      # entities, plain text
    ents = data[off:off + ln].decode("latin-1")
    m = re.search(r'"skyname"\s*"([^"]+)"', ents)
    sky = m.group(1).strip().lower() if m and m.group(1).strip() else DEFAULT_SKY
    off, ln = lump(data, 2)                      # textures
    need = []
    for i in range(struct.unpack_from("<i", data, off)[0]):
        mo = struct.unpack_from("<i", data, off + 4 + 4 * i)[0]
        if mo < 0:
            continue
        base = off + mo
        if struct.unpack_from("<I", data, base + 24)[0] == 0:
            need.append(data[base:base + 16].split(b"\0")[0].decode("latin-1").lower())
    return need, sky

def wad_index():
    out = {}
    for path in glob.glob(f"{src}/cstrike/*.wad") + glob.glob(f"{src}/valve/*.wad"):
        with open(path, "rb") as f:
            if f.read(4) not in (b"WAD3", b"WAD2"):
                continue
            count, diroff = struct.unpack("<ii", f.read(8))
            f.seek(diroff)
            d = f.read(count * 32)
        names = {d[i * 32 + 16:i * 32 + 32].split(b"\0")[0].decode("latin-1").lower()
                 for i in range(count)}
        out[os.path.basename(path).lower()] = (names, os.path.getsize(path))
    return out

wads = wad_index()
missing_maps, need, skies = [], {}, {DEFAULT_SKY}
for m in maps:
    p = f"{src}/cstrike/maps/{m}.bsp"
    if not os.path.exists(p):
        missing_maps.append(m)
        continue
    textures, sky = wad_textures(p)
    skies.add(sky)
    for t in textures:
        need.setdefault(t, set()).add(m)

# greedy set cover, tiebreak toward the smaller wad, then drop any pick whose
# textures the other picks already supply (greedy alone keeps a 6MB wad for a
# texture a wad it later picked also had)
remaining, chosen = set(need), []
while remaining:
    name, (names, size) = max(wads.items(),
                              key=lambda kv: (len(remaining & kv[1][0]), -kv[1][1]))
    hit = remaining & names
    if not hit:
        for t in sorted(remaining)[:10]:
            print(f"unresolved texture {t!r} (in {sorted(need[t])})", file=sys.stderr)
        sys.exit(1)
    chosen.append(name)
    remaining -= hit
for name in sorted(chosen, key=lambda n: -wads[n][1]):
    rest = set().union(*(wads[o][0] for o in chosen if o != name)) or set()
    if set(need) <= rest:
        chosen.remove(name)

for w in sorted(set(chosen) | ALWAYS):
    print(f"wad {w}")
for s in sorted(skies):
    print(f"sky {s}")
for m in missing_maps:
    print(f"missing {m}")
PY
}

DEPS="$(map_deps)" || die "could not read map dependencies out of the BSPs"
KEEP_WADS="$(awk '$1=="wad"{print $2}' <<<"$DEPS")"
KEEP_SKIES="$(awk '$1=="sky"{print $2}' <<<"$DEPS")"
MISSING_MAPS="$(awk '$1=="missing"{print $2}' <<<"$DEPS")"
[[ -z "$MISSING_MAPS" ]] \
  || die "mapcycle lists maps with no bsp in $SRC/cstrike/maps: $(echo "$MISSING_MAPS" | tr '\n' ' ')"
[[ -n "$KEEP_WADS" && -n "$KEEP_SKIES" ]] || die "map dependency scan returned nothing"

list_files() {
  (cd "$SRC" && find valve cstrike -type f | LC_ALL=C sort) | awk \
      -v keep="$KEEP_MAPS" -v wads="$KEEP_WADS" -v skies="$KEEP_SKIES" '
    BEGIN {
      split(keep,  k, "\n"); for (i in k) keepmap[k[i]]  = 1
      split(wads,  w, "\n"); for (i in w) keepwad[w[i]]  = 1
      split(skies, s, "\n"); for (i in s) keepsky[s[i]] = 1
    }
    # the Half-Life campaign and its CD soundtrack
    /^valve\/maps\// { next }
    /^valve\/media\// { next }
    # the engine reads cstrike/overviews; these are HL/TFC leftovers
    /^valve\/overviews\// { next }
    # native game libraries - this client is WASM and loads its own
    tolower($0) ~ /^(valve|cstrike)\/(cl_)?dlls\/.*\.(so|dll|dylib)$/ { next }
    # maps and their radar images, by mapcycle
    /^cstrike\/(maps|overviews)\// {
      n = $0; sub(/^cstrike\/(maps|overviews)\//, "", n); sub(/\.[^.]*$/, "", n)
      if (!(n in keepmap)) next
    }
    # root wads, by what the kept maps could not embed
    tolower($0) ~ /^(valve|cstrike)\/[^\/]+\.wad$/ {
      n = tolower($0); sub(/^.*\//, "", n)
      if (!(n in keepwad)) next
    }
    # skyboxes: <skyname>{bk,dn,ft,lf,rt,up}.{tga,bmp,pcx}, case-insensitive
    # and across both trees (2desert and desert live only under valve/).
    # A face in some other format is kept rather than guessed at - but list
    # every format the tree actually uses, or the rule silently keeps them all
    #
    # A skyname can carry a subdirectory - de_dust2_2020_se ships its faces as
    # gfx/env/de_dust2_2020/Dust2020*.tga and names the sky
    # "de_dust2_2020/Dust2020". So strip back to gfx/env/, not to the
    # basename: matched on a basename, those six faces hit no keepsky entry
    # and were trimmed out of the payload, leaving the map skyless.
    # (No apostrophes in here - this whole awk program is one single-quoted
    # shell string, and one in a comment ends it.)
    tolower($0) ~ /^(valve|cstrike)\/gfx\/env\// {
      n = tolower($0); sub(/^.*\/gfx\/env\//, "", n)
      if (n ~ /(bk|dn|ft|lf|rt|up)\.(tga|bmp|pcx)$/) {
        sub(/(bk|dn|ft|lf|rt|up)\.(tga|bmp|pcx)$/, "", n)
        if (!(n in keepsky)) next
      }
    }
    { print }'
}

# --- build -------------------------------------------------------------------
# Archive layout, read by apps/web/src/launch.ts - keep the two in step:
#
#   valve.zip                 STORED outer; the client slices it, never inflates
#     cstrike/cstrike.pk3     everything under cstrike/<subdir>/
#     valve/valve.pk3         everything under valve/<subdir>/
#     cstrike/*, valve/*      every gamedir-root file, loose
#
# The engine mounts any *.pk3 it finds in a gamedir (FS_AddGameDirectory in
# FWGS searchpath.c) and inflates out of it on demand, in wasm, for the files a
# session actually opens - the route extras.pk3 already takes. So the client
# writes two files instead of 4893 and inflates none of the 420MB up front:
# measured 2026-08-30 on the 235MB build, 4.8s of JSZip before the first frame
# down to 0.27s. Wire size is unchanged; the compression just moved inside.
#
# The gamedir ROOT stays loose, and that rule is load-bearing. The engine
# decides a directory is a gamedir at all by looking for liblist.gam /
# gameinfo.txt with FS_SysFileExists, which sees real files and never the VFS
# (gameinfo.c). Packed into the pk3 they are invisible, no gamedir is found,
# and the engine unwinds out of main() before a frame - it reaches the page as
# a bare `Infinity`, which is how this was first hit. Root is also where the
# wads live, and wad lumps are read by seeking, which restarts the inflate from
# the top inside a deflated entry. Root is 0.3MB of config plus the wads, so
# the rule is "the root stays loose", not a list of special files.
BUILD="$ROOT/valve.zip.build"
trap 'rm -rf "$STAGE" "$BUILD"' EXIT
rm -rf "$STAGE" "$BUILD"
mkdir -p "$BUILD/cstrike" "$BUILD/valve"
KEPT_COUNT="$(list_files | wc -l | tr -d ' ')"
FULL_COUNT="$(find "$SRC/valve" "$SRC/cstrike" -type f | wc -l | tr -d ' ')"
log "keeping maps: $(echo "$KEEP_MAPS" | tr '\n' ' ')"
log "building $STAGE: $KEPT_COUNT of $FULL_COUNT files (one dot per 10MB)..."
START=$SECONDS
# paths inside a pk3 are gamedir-relative, so cut the gamedir off the front;
# NF>2 is "lives in a subdirectory", which is exactly what may be packed
for game in cstrike valve; do
  (cd "$SRC/$game" && list_files | awk -F/ -v g="$game" '$1 == g && NF > 2' | cut -d/ -f2- \
    | zip -q -X -dg -ds 10m "$BUILD/$game/$game.pk3" -@)
done
# the gamedir roots, copied into the staging tree as they are
(cd "$SRC" && list_files | awk -F/ 'NF == 2' | tar -cf - -T -) | tar -xf - -C "$BUILD"
# -0 on the pk3s: they carry their own deflate already, and STORED is what
# lets the client hand them to the engine as a slice instead of inflating
# 174MB to get at them. The root files deflate normally.
(cd "$BUILD" && zip -q -X -0 "$STAGE" cstrike/cstrike.pk3 valve/valve.pk3)
(cd "$BUILD" && find cstrike valve -type f ! -name '*.pk3' | LC_ALL=C sort | zip -q -X "$STAGE" -@)
echo
log "built in $((SECONDS - START))s: $(du -h "$STAGE" | cut -f1) ($(du -h "$BUILD/cstrike/cstrike.pk3" | cut -f1) cstrike.pk3, $(du -h "$BUILD/valve/valve.pk3" | cut -f1) valve.pk3)"

# --- verify ------------------------------------------------------------------
log "verifying archive..."

# The logical file list, reassembled: the outer archive's own entries minus the
# two pk3s, plus each pk3's contents under its gamedir. Every check below then
# reads the payload the way the ENGINE will, not the way the zip is packed - a
# file is missing in exactly the same way whichever layer it should have been
# in. Single listing; per-check pipelines with grep -q die of SIGPIPE.
OUTER_LIST="$(unzip -Z1 "$STAGE")"
ZIP_LIST="$(
  printf '%s\n' "$OUTER_LIST" | grep -v '\.pk3$'
  for game in cstrike valve; do
    unzip -Z1 "$BUILD/$game/$game.pk3" | sed "s|^|$game/|"
  done
)"

BAD_ROOT="$(printf '%s\n' "$ZIP_LIST" | grep -vE '^(valve|cstrike)/' || true)"
[[ -z "$BAD_ROOT" ]] || die "archive root must contain only valve/ and cstrike/, found:
$BAD_ROOT"

ZIP_COUNT="$(printf '%s\n' "$ZIP_LIST" | grep -cv '/$')"
[[ "$KEPT_COUNT" == "$ZIP_COUNT" ]] \
  || die "file count mismatch: $KEPT_COUNT in keep list vs $ZIP_COUNT in archive"

# The outer archive holds the two pk3s and nothing but gamedir-root files.
# A subdirectory file loose out here is a file the pk3 build dropped.
BAD_LOOSE="$(printf '%s\n' "$OUTER_LIST" | grep -v '/$' | grep -v '\.pk3$' \
  | awk -F/ 'NF != 2' || true)"
[[ -z "$BAD_LOOSE" ]] || die "outer archive carries subdirectory files, which belong in a pk3:
$BAD_LOOSE"

# Stored, or the client inflates 174MB to get at them and the whole point of
# the layout is gone. Silent if it regresses: the payload still works.
for game in cstrike valve; do
  unzip -Z "$STAGE" "$game/$game.pk3" | grep -q ' stor ' \
    || die "$game.pk3 is compressed inside the outer archive - it must be stored (zip -0)"
done

# The gamedir marker the engine looks for with FS_SysFileExists. Inside a pk3
# it is invisible, no gamedir is found, and the client dies at boot with a
# bare `Infinity` - the one failure this layout can produce that says nothing
# about its own cause.
for game in cstrike valve; do
  printf '%s\n' "$OUTER_LIST" | grep -x "$game/liblist.gam" >/dev/null \
    || die "$game/liblist.gam is not loose in the outer archive - the engine will find no gamedir"
done

for m in $KEEP_MAPS; do
  printf '%s\n' "$ZIP_LIST" | grep -x "cstrike/maps/$m.bsp" >/dev/null \
    || die "kept map $m has no bsp in the archive - check the mapcycles against cs/cstrike/maps/"
done

# every wad the BSP scan asked for has to be in there. A missing wad is the
# quietest failure on this stack: the map loads, nobody errors, and the walls
# render as checkerboard for everyone.
for w in $KEEP_WADS; do
  printf '%s\n' "$ZIP_LIST" | grep -ixE "(valve|cstrike)/$w" >/dev/null \
    || die "kept wad $w is not in the archive - the map dependency scan and the trim disagree"
done

# all six faces, or the sky renders black. Case varies in the tree (Desbk.tga,
# TrainYardUp.tga), and 2desert/desert live under valve/ while the rest are
# under cstrike/, so match case-insensitively across both.
for sky in $KEEP_SKIES; do
  for face in bk dn ft lf rt up; do
    printf '%s\n' "$ZIP_LIST" | grep -ixE "(valve|cstrike)/gfx/env/$sky$face\.(tga|bmp|pcx)" >/dev/null \
      || die "sky $sky is missing its $face face - a kept map names it in worldspawn"
  done
done

unzip -p "$STAGE" cstrike/userconfig.cfg | cmp -s - "$SRC/cstrike/userconfig.cfg" \
  || die "userconfig.cfg in archive does not match the game tree"

log "verified: $ZIP_COUNT files, $(echo "$KEEP_WADS" | wc -w | tr -d ' ') wads, $(echo "$KEEP_SKIES" | wc -w | tr -d ' ') skies, userconfig.cfg matches game tree"

if [[ -n "$DRY_RUN" ]]; then
  # keep the stage: inspecting what a trim change actually produced is the
  # entire point of a dry run, and the EXIT trap would delete it
  trap - EXIT
  log "dry run: built and verified $STAGE ($(du -h "$STAGE" | cut -f1)) - not installing"
  log "current live payload is $(du -h "$ROOT/valve.zip" | cut -f1); nothing was restarted or purged"
  log "the staged archive is left at $STAGE, and the tree it was packed from"
  log "at $BUILD - delete both when you are done"
  exit 0
fi

# --- install -----------------------------------------------------------------
for target in "${TARGETS[@]}"; do
  log "installing -> $target"
  cp "$STAGE" "$target.tmp" && mv "$target.tmp" "$target"
done
rm -f "$STAGE"

# --- Cloudflare purge --------------------------------------------------------
# ff.benrogerson.dev fronts the box via Cloudflare, which caches valve.zip at
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
  aim-*)       MOD=aim ;;
  css-*)       MOD=css ;;
  fy-*)        MOD=fy ;;
  awp-*)       MOD=awp ;;
  classical-*) MOD=classical ;;
  *cpl*)       MOD=cpl ;;
  *)           die "container '$RUNNING' holds 27016 but is not a known mod - restart it yourself" ;;
esac

log "restarting $MOD ($RUNNING) so the new zip is served..."
if [[ "$MOD" == "cpl" ]]; then
  (cd "$ROOT" && docker compose --profile cpl down && docker compose --profile cpl up -d)
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

log "done. $MOD is serving the new valve.zip on https://ff.benrogerson.dev"
