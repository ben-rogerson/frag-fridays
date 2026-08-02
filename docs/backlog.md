# Backlog

Outstanding work, roughly in order. See [troubleshooting.md](troubleshooting.md)
for the constraints that shape most of these (ReAPI incompatibility, no lazy
loading, plugins.ini vs modules.ini).

## 1. Ping retest off hotspot

Retest latency from a real connection. The earlier 75-320ms reading was a
phone hotspot (mobile radio latency plus jitter), not the server. Sydney
should give ~20-30ms.

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

Remaining candidates, roughly in order of appeal:

- `ka_legoland`, `rats_*` - untested
- `fy_snow` - more iceworld, if the first ones land well

Watch on Friday: under dm, scoutzknivez's own scout+knife handout
(`player_weaponstrip` + `game_player_equip` map entities) races frag_dm's
rifle handout - either outcome is playable, but if rifles win and it feels
wrong, teach frag_dm to skip equipping on this map.

## 7. Custom spray / wall tag

Players spray a decal on walls (`impulse 201`, default bind `T`). In GoldSrc
the spray lives in `cstrike/pldecal.wad` (64x64 8-bit WAD); related cvars are
`cl_logofile` and `cl_logocolor`.

- **Limitation:** every client loads the same `valve.zip`, so a bundled
  `pldecal.wad` means everyone shares one spray. Acceptable for the goal (one
  temporary funny image); per-player sprays would need upstream changes.
- **Test plan:** unverified whether the WASM client reads a bundled
  `pldecal.wad` and whether `impulse 201` fires at all in this build. Test
  with a **placeholder WAD first** before any effort goes into the image.
- Also confirm server-side: `sv_allow_upload` / decal cvars may need
  enabling; `mp_decals` controls how many render.
- Use an image with clear rights - a team in-joke or something original, not
  lifted game/brand art.

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
