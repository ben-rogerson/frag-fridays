# Backlog

Outstanding work, roughly in order. See [troubleshooting.md](troubleshooting.md)
for the constraints that shape most of these (ReAPI incompatibility, no lazy
loading, plugins.ini vs modules.ini).

## 1. Ping retest off hotspot - done (2026-08-02)

26.5ms avg, 0% loss, 0.97ms stddev over 15 pings from the home connection.
The earlier 75-320ms reading was the phone hotspot, as suspected. No
server-side latency concern.

## 2. Verify join binds in-browser

`update-clientcfg.sh` is written and deployed (2026-08-02): `pnpm run
clientcfg` syncs configs, rebuilds `valve.zip` from `cs/{valve,cstrike}`,
installs it to both mount points and restarts the running mod. Remaining:
open http://149.28.172.74:27016 in a browser and verify the F1/F2 join binds
actually work (and that the `userconfig.cfg loaded` echo appears in console).

## 3. Verify Deathmatch (frag_dm) in-browser

CSDM is dead on this stack - its binary module signature-scans the original
CS DLL and fails silently against the reimplemented one (full story in
troubleshooting.md). Replaced 2026-08-02 with `frag_dm.sma`, a from-scratch
module-free DM plugin built on the Ham calls GunGame proves work: instant
respawn, armour + rifle + deagle on spawn, spawn protection, ammo refill on
kill, C4 stripped. Gun choice via chat (`/guns` lists; `/ak /m4 /awp /mp5
/p90 /scout /shotty /famas /deagle`) because AMXX menus are unverified in the
browser (item 5). Deployed, compiles, reports `running`. Remaining: play it -
verify respawn timing, equip, protection and the chat commands feel right.
The `/opt/cs16/src/dm-src` archive can be deleted once frag_dm is confirmed.

## 4. Tune YaPB bots (installed 2026-08-02)

YaPB 4.4.957 is installed in both gg and dm images and confirmed working:
`successfully loaded for game: Counter-Strike v1.6 @ Xash3D Engine`, 9 bots
join within seconds of boot (de_dust2 graph ships in the release). Settings: `yb_quota 9`, `yb_kick_after_player_connect 1` (bots leave as
humans join), difficulty spread Easy-Hard + K/D auto-balance
(`yb_difficulty_min 1` / `_max 3` / `_auto 1`), `[BOT]` name prefix with
`BOT` in the ping column, `yb_csdm_mode 1` in dm only. Text chat turned off
2026-08-02 (`yb_chat 0` - the banter was noise). Remaining: play against
them and fine-tune quota for small maps. All options documented in
[game-guide.md](game-guide.md); config in
`server/{gg,dm}/addons/yapb/conf/yapb.cfg` (image-baked - redeploy to apply).

## 5. Map voting - server side done, browser vote menu unverified

Investigated 2026-08-02. Server side is all in place:

- `mapchooser`/`nextmap`/`mapsmenu`/`timeleft` were already enabled and
  `running` in the base image; `maps.ini` ships pre-populated with all 25
  stock maps (all of which are in `valve.zip`, and all of which have YaPB
  graphs).
- `mapcycle.txt` was the gap (only 2 maps). Now curated per mod in
  `server/{gg,dm}/mapcycle.txt`, image-baked. Stock maps only - zero
  valve.zip cost.
- Verified in throwaway containers: `changelevel` works, the new map's bot
  graph loads, bots rejoin; `amx_nextmap` steps through the cycle
  sequentially. End-of-map vote fires near `mp_timelimit` (30 min).

Remaining (needs a browser): does the end-of-map vote menu actually render
in the WASM client? If yes, item done. If no, players still get the curated
rotation, and voting needs a chat-command approach like frag_dm's `/guns`
(write a small say-based vote plugin; skip Galileo - same menu question and
heavier).

## 6. Fun map rotation - scoutzknivez in too (2026-08-02)

In: `fy_iceworld` (122KB) and `fy_pool_day` (833KB) in both rotations;
`aim_map` (340KB, both rotations) and `awp_map` (1.5MB, dm only - odd fit
for GunGame's weapon ladder); `scoutzknivez` (734KB, both rotations, low
gravity via the per-map cvar mechanism in the decision log). ~3.5MB of
valve.zip growth total (still 301M), each verified booting with bots (YaPB
downloads proper community graphs from its online DB for all of them). The
pipeline for any future map: drop `.bsp` in `server/maps/`, add to
mapcycles, `pnpm run deploy <mod>` + `pnpm run clientcfg`. Analyse
dependencies first (embedded textures vs wad refs vs skyname) - the trick
is in the decision log; beware download mirrors serving Source-engine
(`VBSP`) files under CS 1.6 map names.

Also in: `35hp_2` (1.6MB, both rotations) - YaPB warns "graph is probably
not for this map" but bots verifiably fight and die on it, so the warning is
benign. Rejected: `he_glass` - its community bot graph is broken (constant
`A* Search ... failed` + bot remove/re-add loops; breakable glass floors
defeat the pathfinder), and a map bots can't play would dead-air the session
whenever the rotation reached it. Revisit only if a session ever runs
all-human.

Candidate round two (2026-08-02): `fy_snow` (534KB, both rotations - its
sky, and even its wind wav, turned out to be stock), `de_rats` (960KB bsp +
2.9MB `de_rats.wad`, both rotations - the wad is client-only, verified by
booting the map in a container without it) and `ka_legoland` (509KB, dm
only - it strips weapons and hands out knives every spawn, which would
break GunGame's weapon ladder). ka_legoland's `dustbowl` sky isn't stock,
so its worldspawn `skyname` was byte-patched to `desert` (script trick in
the decision log). All three boot-tested with bots: proper community
graphs, kills accumulating, zero A* failures. valve.zip 301M -> 305M.
Non-map client assets (the wad, overviews) ship via the new
`server/custom/` overlay that deploy.sh rsyncs additively into
`cs/cstrike/`.

No candidates left untested. Next map additions are pure pipeline work
(recipe in the cs16-server skill).

Watch on Friday: under dm, scoutzknivez's own scout+knife handout
(`player_weaponstrip` + `game_player_equip` map entities) races frag_dm's
rifle handout - either outcome is playable, but if rifles win and it feels
wrong, teach frag_dm to skip equipping on this map. Same applies to
ka_legoland's knife handout - if frag_dm's rifles win the race there, the
map loses its point; skip frag_dm equipping on it.

## 7. Custom spray / wall tag - image shipped, needs a browser T-press

Shipped (2026-08-02): the giggling-Kirk spray (`assets/spray-kirk.png`,
Ben's pick) as a 48x64 255-colour `{LOGO` miptex in valve.zip as BOTH
`cstrike/tempdecal.wad` (CS 1.6's own-spray file) and `cstrike/pldecal.wad`
(HL's), via the `server/custom/` overlay. `scripts/make-spray-wad.py`
regenerates it from any image (Pillow for quantisation; each mip built
from the source, not from the previous mip). Server-side checks done: the
shipped `config.cfg` already has `bind "t" "impulse 201"`, `decalfrequency`
is 30, and `sv_allow_upload`/`mp_decals` don't exist in this engine build -
with an identical WAD in every client no upload path is needed anyway.

Remaining (browser): join, press T against a wall. Kirk renders = done.
Nothing renders = Xash-FWGS WASM likely ignores tempdecal.wad; investigate
`cl_logofile`/customization support upstream before sinking more time.

- **Limitation (accepted):** every client loads the same `valve.zip`, so
  everyone shares one spray.

## 8. Claude server-control skill - done for local Claude Code (2026-08-02)

`.claude/skills/cs16-server/SKILL.md` encodes the full operating surface:
layout, one-mod-at-a-time rule, swap procedure with the mandatory `docker ps`
check, clientcfg/valve.zip pipeline, the three registration files, the
ReAPI/binary-module constraint, the throwaway-console trick, the add-a-map
recipe, bot verification and the session-day pointers. Transport: local
Claude Code SSHing via the `cs16` alias (the original blocker assumed the
code-execution sandbox; the CLI has no such restriction).

Still open if wanted later: an MCP server on the VPS so the phone/web app
can drive the box too - shares a backend with item 9's portal.

## 9. Web portal / Slack integration (future project)

Not for this Friday. A small web app linked from Slack: vote on maps for the
upcoming session, see the current rotation and what's installed, see the
schedule, see who's signed up (RSVP), possibly live player count / current
map / server-up status.

Design questions for when we get there: hosting (same VPS? static site +
small API?), reading live server state (GoldSrc A2S query protocol, container
logs, or an AMXX status plugin), how votes become map changes (config the
server reads? RCON? scheduled rebuild-and-restart?), auth (open link vs Slack
identity), and a Slack bot that posts the Friday announcement automatically.

**Shared backend opportunity:** the MCP server (item 8) and the web portal
both want the same thing underneath - a small API over docker and server
state. Design once, consume twice.

## 10. IT heads-up

Give IT a heads-up about the public-facing server, if not already done.

## 11. Housekeeping - done (2026-08-02)

All three verified done on the box: root compose profile is `vanilla`, the
stray `/opt/cs16/dm/valve.zip` is gone, every compose (repo and box) uses
`restart: unless-stopped`.
