# Backlog

Outstanding work, roughly in order. See [troubleshooting.md](troubleshooting.md)
for the constraints that shape most of these (ReAPI incompatibility, no lazy
loading, plugins.ini vs modules.ini).

## 1. Ping retest off hotspot - done (2026-08-02)

26.5ms avg, 0% loss, 0.97ms stddev over 15 pings from the home connection.
The earlier 75-320ms reading was the phone hotspot, as suspected. No
server-side latency concern.

## 2. Verify join binds in-browser - done (2026-08-02)

Verified in-browser on gg: pressing F1 at the team screen spawned straight
into the game. The F1/F2 binds live in `userconfig.cfg`, so the bind working
proves the config loaded (the console echo wasn't checked directly - the
WASM client has no console UI; the Xash menu has no Console entry and `~`
does nothing). Two client quirks seen on the way in: one load stalled at
the splash with "If it's not starting, try to enable microphone and
refresh" (a refresh fixed it - worth a line in the Slack instructions),
and the team-select menu DOES render in-browser (numbered text menu), so
F1/F2 are a convenience rather than the only path in. Root cause of those
stalls (seen repeatedly while testing item 5): whenever the engine tries
to draw its yes/no message box (e.g. after a disconnect), the WASM build
crashes with `RuntimeError: remainder by zero` in `UI_DrawString` and the
render loop dies at the splash - upstream Xash3D-FWGS bug, not ours; the
fix for players is always just refresh. **Fixed 2026-08-29** by dropping the
GameUI menu from the engine's dynamic libraries, so nothing ever draws that
menu - see "Escape used to crash the client" in troubleshooting.md.

## 3. Verify Deathmatch (frag_dm) in-browser - done (2026-08-03)

CSDM is dead on this stack - its binary module signature-scans the original
CS DLL and fails silently against the reimplemented one (full story in
troubleshooting.md). Replaced 2026-08-02 with `frag_dm.sma`, a from-scratch
module-free DM plugin built on the Ham calls GunGame proves work: instant
respawn, armour + rifle + deagle on spawn, spawn protection, ammo refill on
kill, C4 stripped. Gun choice via chat (`/guns` lists; `/ak /m4 /awp /mp5
/p90 /scout /shotty /famas /deagle`) because AMXX menus are unverified in the
browser (item 5). Deployed, compiles, reports `running`.

Verified in-browser (2026-08-03) on fy_pool_day with 9 bots: spawn equips
AK + deagle + 100 armour; death respawns instantly (no death-cam wait)
with full kit; spawn protection renders as a green glow on fresh spawns;
`/guns` in chat answers "[DM] Pick a gun for your next spawn: /ak /m4 ...".
`/opt/cs16/src/dm-src` deleted from the box. Untested: ammo-refill-on-kill
(needs a human kill) and per-gun switch (e.g. `/m4`) - exercise on Friday.

Watch items spotted during the test:

- "[BOT] Chrono picked up the bomb" appeared on fy_pool_day - a C4 exists
  despite frag_dm's strip (possibly re-granted at a round restart before the
  strip runs). Cosmetic unless someone plants; check if it recurs.
- "Terrorists Win!" round-end banners still appear - rounds cycle rather
  than pure continuous DM. Instant respawn makes this near-invisible, but a
  full-team wipe can still end a round.
- The client's team-change limit ("Only 1 team change is allowed") can
  strand a fumbled join in spectate; the fix is the usual browser refresh.

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

## 5. Map voting - done (2026-08-02), vote menu verified in-browser

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

Verified in-browser (2026-08-02) via `pnpm run rc "amx_votemap de_dust2
fy_iceworld fy_snow de_aztec"` while connected in Chrome: the AMXX vote
menu renders in the WASM client ("Choose map: 1..4 / 0. none"), a number
keypress registers ("Reversons voted for option #2"), the vote passes and
the server changelevels to the winner (fy_iceworld) with the client staying
connected and bots rejoining. The end-of-map mapchooser flow also works:
one full cycle observed where the advertised nextmap (de_dust2) was
replaced by a vote outcome (de_inferno). So both voting paths function;
`amx_votemap` doubles as a session-day tool to put a map change to a vote.

Gotchas learned while testing:

- The vote menu lasts ~10s and loses to whatever menu already has focus -
  a player sitting on the GunGame welcome screen ("press any number key")
  never sees it and their keys don't count. Fine in practice; know it
  exists.
- Don't force votes by lowering `mp_timelimit` mid-map: on this engine the
  timer behaves as if measured against cumulative server time, so setting
  it below the current value ends the map instantly, skipping the vote.
  It resets from config on each map change (verified back at 20).

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

## 7. Custom spray / wall tag - done (2026-08-02)

Shipped (2026-08-02): the giggling-Kirk spray (`assets/spray-kirk.png`,
Ben's pick) as a 48x64 255-colour `{LOGO` miptex in valve.zip as BOTH
`cstrike/tempdecal.wad` (CS 1.6's own-spray file) and `cstrike/pldecal.wad`
(HL's), via the `server/custom/` overlay. `scripts/make-spray-wad.py`
regenerates it from any image (Pillow for quantisation; each mip built
from the source, not from the previous mip). Server-side checks done: the
shipped `config.cfg` already has `bind "t" "impulse 201"`, `decalfrequency`
is 30, and `sv_allow_upload`/`mp_decals` don't exist SERVER-side in this build
(corrected 2026-09-05: `mp_decals` very much exists on the CLIENT, and is what
governs the decal cap from the second map onwards - see troubleshooting) -
with an identical WAD in every client no upload path is needed anyway.

Verified working in-browser (2026-08-02) after the mechanism hunt: the
wads were the wrong path - Xash3D-FWGS reads the custom spray from
`logos/remapped.<cl_logoext>` (engine cl_main.c; missing file = silent
lambda fallback, which the first T-press proved). `tempdecal.wad` only
matters on GoldSrc-protocol connections. First working version at 48x64
was poor quality, so now 96x128 (decal world size = texture size / scale
per ref/gl/gl_decals.c, so it also sprays twice as large). Regenerate any
time: `scripts/make-spray-wad.py server/custom/logos/remapped.bmp
assets/<img>.png 96 128` then deploy + clientcfg. Server side:
`sv_send_logos 1`, `sv_uploadmax 0.5`MB.

Done (2026-08-02): 96x128 confirmed in-browser on gg - sprayed on a de_dust2
wall, clearly recognisable Kirk, roughly double the old world size as
intended. `tempdecal.wad`/`pldecal.wad` deleted from `server/custom`; the
removal ships with the next `pnpm run clientcfg` (not run at the time -
another session was mid-deploy on the box).

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

MCP server built 2026-08-04: `server/mcp/` on the box (port 27017, routed
via the front-door Worker at `https://ff.benrogerson.dev/mcp/<secret>`),
five tools (status, console via cmdpipe, log tail, restart, mod swap) as a
claude.ai custom connector - the phone can now drive the box. Details in
decisions.md and runbook.md §5. This is also item 9's backend seed.

## 9. Web portal / Slack integration (future project)

Not for this Friday. A small web app linked from Slack: vote on maps for the
upcoming session, see the current rotation and what's installed, see the
schedule, see who's signed up (RSVP), possibly live player count / current
map / server-up status.

Design questions for when we get there: hosting (same VPS? static site +
small API?), reading live server state (GoldSrc A2S query protocol, container
logs, or an AMXX status plugin), how votes become map changes (answered:
the cmdpipe plugin - drop a serial-numbered command file in
`/opt/cs16/cmdpipe/`, see decisions.md), auth (open link vs Slack
identity), and a Slack bot that posts the Friday announcement automatically.

**Shared backend opportunity:** the MCP server (item 8) and the web portal
both want the same thing underneath - a small API over docker and server
state. Design once, consume twice.

## 10. IT heads-up

Give IT a heads-up about the public-facing server, if not already done.

## 11. Housekeeping - done (2026-08-02)

All three verified done on the box: root compose profile is `vanilla` (now
`cpl`), the
stray `/opt/cs16/dm/valve.zip` is gone, every compose (repo and box) uses
`restart: unless-stopped`.

## 12. GunGame welcome message cosmetic bug - done (2026-08-02)

The join-screen welcome menu showed `ML_NOTFOUND: WELCOME_MESSAGE_LINEB--`
as its last line. Root cause wasn't a missing key: the AMXX lang parser
can't read the colon-block form of `WELCOME_MESSAGE_LINE8` in
`gungame.txt`. Fixed in commit 91ac1f5 and deployed.

## 13. Domain + https in front of the box - done (2026-08-03)

Live at **https://ff.benrogerson.dev** - a Cloudflare Worker
(`apps/web/proxy/`, worker name `frag-friday`) on a wrangler custom domain,
reverse-proxying everything to the VPS. No Caddy, no box changes, no
firewall changes; the old `http://149.28.172.74:27016` URL keeps working.

How it hangs together:

- The client uses same-origin relative paths for everything (`/websocket`
  signalling, `/valve.zip`, the page), so a transparent proxy suffices.
- Game packets never touch the Worker - they flow over WebRTC data channels
  directly to the VPS IP, so only the page, the 305MB download and the
  lightweight signalling ws go through Cloudflare.
- Workers `fetch()` refuses IP-literal origins (error 1003), so the origin
  is `http://149-28-172-74.sslip.io:27016` (sslip.io just resolves the
  dashed IP; custom ports are fine once it's a hostname).
- Verified 2026-08-03: page 200, valve.zip range requests proxy with full
  319MB length, wss handshake returns the server's WebRTC offer, and the
  full client loads, downloads and reaches the in-engine briefing screen in
  Chrome on the new URL. (Join attempts then dropped after ~10s - but
  identically on the old IP URL, so it's a server-side wedge, not the
  proxy; see the join-wedge watch item below.)

The https origin unlocks `getUserMedia`, so webrtc.ts now actually gets a
mic track - exercise voice on Friday. Two notes: localStorage is
per-origin, so players switching from the IP URL start with fresh settings
and re-enter their name once. And the mic permission prompt now appears on
PLAY - `connect()` awaits `getUserMedia` before opening the signalling ws,
so a player who ignores the prompt (neither allow nor deny) sits on
"Starting engine, connecting to server..." forever. Allow and deny both
proceed normally. Worth a line in the Friday Slack instructions; a timeout
race in webrtc.ts is the code fix if it bites.

**Update 2026-08-07: mic capture disabled.** Voice was always-on with no
mute UI, so players broadcast without realising - `getUserMedia` and the
`addTrack` loop are removed from webrtc.ts for now (git history has them
if voice comes back with a proper push-to-talk/mute). Side benefit: no
permission prompt on PLAY, so the ignored-prompt hang above is moot.

## 14. Join-wedge incident 2026-08-03 - restart fixed it, cause unknown

While verifying item 13 (~05:00 UTC), the gg server got into a state where
NEW clients could not complete a join, on both URLs equally: the client
half-connects (ws + WebRTC handshake fine, world/briefing renders, engine
`status` shows the slot in "Connect" state) but its client->server packets
never arrive - `lastmsg` climbs until the 60s timeout reaps the slot, and
the client's 10s silence watchdog shows "You were dropped from the server".
An already-connected player survived ~30 min more, then their flow died the
same way (lastmsg climbing while "playing"). `docker restart gg-xash3d-1`
(05:13 UTC) cleared it - a fresh join completed normally within a minute.

Context around onset (any could be the trigger, none proven):

- The server had changelevelled de_dust2 -> (something) -> fy_iceworld at
  04:56/05:02 (2x "Custom resource propagation complete" + vistable
  rebuild), roughly when the wedge started.
- I had abandoned a WebRTC handshake mid-flight (a Node ws test that read
  the offer and exited without answering - sfu logged `close 1006`). A
  player closing their tab mid-load does exactly this, so if THIS is the
  trigger it will happen on Friday.
- statusjson.amxx kept reporting stale de_dust2 data for 10+ min after the
  changelevel, then recovered by fy_iceworld - possibly just its own bug,
  possibly a symptom of the same wedge.

Friday risk: if this recurs mid-session, nobody new can join and current
players drop one by one, all silently. Mitigation for now: `pnpm run rc
"status"` when joins misbehave (look for humans stuck in "Connect" /
climbing lastmsg), and `ssh cs16 docker restart gg-xash3d-1` clears it
(~30s outage, drops everyone). Before Friday, worth a deliberate repro:
two humans + a changelevel + an abandoned mid-load refresh, watching
engine `status`. Suspect list: goxash sfu peer-state leak vs changelevel
interaction. Upstream: yohimik/goxash3d-fwgs (the sfu-ws bit).

Also learned: the address column in engine `status` for emscripten-wasm32
clients is a synthetic per-peer address from the webrtc bridge, NOT the
player's real IP (the same player showed 5.110.162.3 before the restart
and the unroutable 0.53.145.241 after). Don't use it to identify anyone.

## 15. Pressbox spectator - built, removed as too buggy (2026-08-05)

Headless-Chromium spectator (`server/pressbox/`) that joined as a real
client and screenshot the canvas to an HTTP viewer on :27060. Removed
2026-08-05: too buggy in practice - stall/ghost-slot recovery loops, a
choose-team menu burned onto the feed with no dismissal, and an idle
pressbox left as the only client wedged the sim (the unwedge-watchdog
restarts it, but that cycles the map for everyone). Decision write-up and
removal note in decisions.md. If spectating comes back, start from the
constraint that the server is WebRTC-only: no HLTV/A2S UDP netchannel, so
any spectator must reuse the browser client stack.

## 16. Classic match plugin - not built (2026-09-04)

Classic now plays by the era's competition rules
([classic-rules.md](classic-rules.md)), but the *match* around those rules is
still run by hand: knife round, live-on-3, half-time side swap, and keeping
the two halves' scores on the same piece of paper. A match plugin
(`ffmatch.sma`: `.ready` / `.knife` / `.stay` / `.swap`, a half-time swap, a
HUD score across halves) is the obvious next piece.

**Update 2026-09-05:** option 1 below now exists in working form, for the
other half of the mode. `server/classical/` (ClassicAl) is a Classic-family
mode built the normal way - its own Dockerfile, its own compiled
`cmdpipe`/`statusjson`/`ff_rejoin`/`teambalance`, its cvars baked into
`amxx.cfg`, and no `frag_dm.amxx`. Copy that dir, put `server/cpl/server.cfg`'s
numbers in its `amxx.cfg` block, drop the bots to `yb_quota 0`, and CPL
Tournament stops being the unbuilt one. That closes item 17 with it.

The blocker is not the plugin, it is where it would live. CPL Tournament runs
the **stock image, unbuilt** - it has no Dockerfile, so nothing compiles `.sma`
for it, and the plugins it does load are pre-compiled `.amxx` binaries
hand-placed in `/opt/cs16/mods/zp/plugins` that no part of `server/` syncs.
Two honest options, both bigger than a plugin:

1. **Give it its own mod dir** (`server/cpl/` gains a Dockerfile +
   compose the way `gg/` has, and `cpl` joins `DIR_MODS` in deploy.sh).
   Then it compiles its own plugins, bakes its own configs, and `mods/zp`
   stops mattering. This is the right answer and it also fixes item 17.
2. Compile the plugin in a throwaway container and `docker cp` the `.amxx`
   into `mods/zp/plugins` box-side. Fast, and it keeps the box-only pile
   growing - the exact hazard item 17 is about.

One smaller win available on the same path, currently missing on Classic and
already compiled inside the mod images: `teambalance.amxx` (`ff_swapteams`,
which would make the half-time swap a war room button instead of ten people
rejoining by hand). A botched knife round no longer needs a plugin here - the
war room's Restart round button sends `sv_restartround` through the pipe,
which Classic has.

## 17. Vanilla's box-only plugins and configs (2026-09-04)

`/opt/cs16/mods/` is the one directory the repo feeds a running container but
does not own. `deploy.sh` only `mkdir -p`s it; its contents were hand-seeded
on the box (cmdpipe + statusjson 2026-08-03, YaPB 2026-08-13). Anything
changed there is invisible to version control and dies with the box.

Three files have been pulled back by mounting repo copies over the box tree
(`server/cpl/{amxx.cfg,maps.ini,yapb.cfg}`, 2026-09-04). Still box-only:
`mods/zp/plugins/*.amxx`, `mods/zp/configs/{plugins.ini,users.ini,maps/}`,
`mods/metamod-plugins.ini`.

The 2026-09-04 audit of what those box files actually held is worth reading
before the next rescue: the box `amxx.cfg` carried `amx_default_access "z"`,
the vote ratios, the CS stats settings and a rewritten `amx_imessage` that
none of the docs mentioned, and the box `yapb.cfg` was a STALE copy of gg's
(`yb_quota_mode normal`, `yb_join_delay 5.0`) rather than the current one.
Neither would have survived a hand-written replacement. Take the box copy
verbatim and subtract. The `.amxx` binaries genuinely cannot
live in the repo while Classic is unbuilt - nothing can rebuild them - which
is why option 1 in item 16 is the real fix. Until then, the mount-over trick
is how anything that starts mattering gets rescued, and
[server/README.md](../server/README.md) lists what is still exposed.

## 18. de_prodigy for the Classic pool (2026-09-04)

`de_prodigy` was in the CPL and CAL rotations of the era and is a stock CS 1.6
map, so the `.bsp` is already in `/opt/cs16/cs/cstrike/maps` and the
screenshot is already in `apps/web/src/assets/maps/`. It is out of both
Classic-family pools only because it is in no mod's `mapcycle.txt`, and the valve.zip
keep-list is the union of those - adding it costs every player the extra
download and needs `pnpm run clientcfg` on top of the deploy. Worth doing if
either mode gets used enough to want another map; not worth the payload
otherwise.
