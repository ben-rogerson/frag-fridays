# Decision log

This project is being chronicled as a multi-entry blog series. This file is
the raw material: notes on every decision point, captured as they happen.
**Update this file whenever a decision is made** - it is far easier to write
down at the time than to reconstruct later.

---

## Why browser-based at all

Original plan was a normal ReHLDS server. Pivoted to WebAssembly because
colleagues on managed work laptops often can't install games - a URL removes
the entire onboarding problem. Trade-off accepted knowingly: browser is
*slower*, and the original brief was "must be fast for players". Zero-install
access beat raw performance for a casual office social.

## The ReAPI dead end

First research pass produced a list of excellent modern mods - ReGG for
GunGame, ReZombiePlague, ReDeathmatch - all built on ReAPI. None work on the
browser stack, which is Xash3D-FWGS + Metamod-P + AMX Mod X. An entire
shortlist invalidated by one architectural fact discovered after the fact.
Lesson: establish the platform constraint *before* researching what runs on it.

## Zombie Plague, abandoned

Picked as the first mod because the upstream repo had an official example. The
example turned out to contain no plugin files at all - just a Dockerfile that
compiles user-supplied source. Combined with ZP's heavy custom models and
sounds fighting the no-lazy-loading constraint, it was dropped for asset-light
GunGame. Two commands were issued against a directory structure that had been
assumed rather than checked.

## Hosting: Vultr Sydney, and not destroying it weekly

Considered spinning the box up and down per session to save money. Rejected -
optimising a $6/month line item against 15 minutes of weekly faff and a 1GB
re-upload. Automatic Backups was silently pre-toggled at $5.60/mo, nearly
doubling the bill for a box holding nothing unrecoverable; turned off in favour
of a single manual snapshot. Hetzner was ~3x cheaper but has no AU datacentre,
which would have added ~250ms.

## Not hosting on the work MacBook

ARM (so the `linux/386` image would run under emulation), has to stay awake and
unslept for the whole session, and it's a corporate device. Ruled out early.

## Ubuntu 24.04 over 26.04

26.04 LTS was available and would have worked. Chose 24.04 anyway: with a WASM
engine, an emulated 32-bit container and an untested mod pipeline already in
play, adding a four-month-old distro to the list of things that could be at
fault wasn't worth the zero upside.

## Three false-alarm diagnostics

Each looked like a failure and wasn't:

1. `uname -m` returning `x86_64` inside a `--platform linux/386` container.
   Looked like missing 32-bit support. `uname` reports the *kernel* arch; the
   container had already run a 32-bit binary successfully.
2. Ping of 75-320ms to a confirmed-Sydney host. Looked like wrong-region
   deployment. Was a phone hotspot - mobile radio latency plus jitter.
3. "GunGame isn't working." Was the vanilla container, which had
   `restart: always` and silently reclaimed port 27016 after a restart. Two
   containers that look identical from the browser.

## The silent-failure class of bug

The recurring theme: this stack fails quietly. A plugin not listed in
`plugins.ini` loads nothing and logs nothing useful. A bind-mount over an empty
host directory masks the image's own files. The wrong container answers on the
right port. Almost every debugging session came down to *verify, don't assume* -
`docker ps`, `amx_plugins`, check the archive root.

## Team select and the F1 bind

The browser build doesn't render the team select menu, so players had to type
`jointeam 1` / `joinclass 1` in console. `mp_autoteambalance` was tried and
doesn't help - it rebalances existing teams rather than assigning unassigned
ones. Solved instead by shipping a `userconfig.cfg` inside `valve.zip` binding
F1/F2, turning a two-command instruction into a single keypress. Removing
friction from the Slack announcement was judged to matter more to turnout than
anything technical.

## valve.zip as a distribution channel

Realising the shared `valve.zip` could carry a client config was the point the
project got easier - it's the mechanism for pushing settings, binds, and now
the spray, to every player at once. Also the reason custom maps are expensive:
same channel, no lazy loading.

## Steam account lockout

SteamCMD logging in from a new datacentre IP triggered Steam's verification
flow, and an earlier wrong answer locked sign-in entirely. The recovery
questionnaire is built around scam pretexts ("collect a free skin", "assist a
Valve employee"), none of which describe downloading files you own. Correct
answers: "Steam client" (SteamCMD *is* the client) and "Other".

## (2026-08-02) Moved into a local pnpm monorepo with deploy script

The project now lives in a local pnpm monorepo, developed on the MacBook and
pushed to the server with a deploy script - nothing configured by hand on the
box any more.

## (2026-08-02) Repo excludes game files and valve.zip

The Steam game files, `valve.zip` and downloaded mod archives stay out of the
repo - copyrighted, ~1GB, and would need Git LFS. The deploy script assumes
game files already exist on the server and only syncs config, Dockerfiles and
scripts.

## (2026-08-02) Monorepo layout: apps/ and packages/

Chose an `apps/` + `packages/` monorepo layout to make room for the future
web portal and Slack integration alongside the server config, rather than
restructuring later.

## Repo seeded from the live box, not the handover doc (2026-08-02)

Pulling the real files revealed the handover doc had drifted from reality:
`update-clientcfg.sh` never existed (valve.zip was built by hand), the root
compose was already profile-based with an empty `mods/` bind-mount scheme,
and `/opt/cs16` doubles as the SteamCMD install dir. Decision: the repo
mirrors the box's actual layout 1:1 (`pnpm run pull` re-syncs it) rather than
imposing a tidier invented one - less to migrate, nothing to break on a
working server two file-moves before a Friday.

## Housekeeping applied via first deploy (2026-08-02)

`restart: always` changed to `unless-stopped` in all three mod compose files
(the port-theft incident), root compose service renamed `zp` to `vanilla` to
match its profile, stray 438MB `dm/valve.zip` deleted from the box.

## One canonical valve.zip for all mods (2026-08-02)

`update-clientcfg.sh` builds a single `valve.zip` from `cs/{valve,cstrike}`
at `/opt/cs16/valve.zip`, and every mod's compose mounts that one file
(`../valve.zip`) instead of keeping its own copy. Before this, the two
existing zips had drifted: the hand-built gg one carried
`userconfig.cfg` and the gungame sounds, the root one had neither - so a
vanilla session would silently ship players no join binds. The cost of the
canonical approach is that mod-specific client assets (~600KB of gungame
sounds) ship to everyone; against a ~438MB archive that is noise, and it buys
"vanilla and gg cannot disagree about what clients receive". The script also
encodes the two rules that made hand-building risky: only `valve/` and
`cstrike/` at the archive root, and a mandatory down/up of the running mod
because compose bind-mounts the zip by inode.

## Deathmatch: wrote frag_dm.sma instead of shipping CSDM (2026-08-02)

CSDM was the plan (archive already on the box), and its module even loads
cleanly - but its gameplay natives never register because the module
signature-scans the original CS DLL, and this stack's DLL is a
reimplementation (troubleshooting.md has the diagnosis trail). Options were:
hunt for a "CSDM without module" fork of unknown provenance, or write the
~250-line subset we actually want against APIs GunGame already proves work
on this stack. Chose the latter: `frag_dm.sma` does respawn + equip +
spawn protection + ammo refill, with gun choice via chat commands rather
than AMXX menus (menus are unverified in the browser client - and if they
turn out to work, item 5's map voting matters more than gun menus). The
lesson that generalises: on this stack, prefer script-only plugins over
anything shipping a binary `.so`, because binary-module failures are silent
and the error messages point at the wrong cause.

## Client payload trimmed: no HL campaign, only rotation maps (2026-08-02)

Measuring valve.zip's compressed contents revealed `valve/maps/` - the
Half-Life single-player campaign, which CS multiplayer never loads - was
96MB of the 437MB download. Another ~20MB was CS maps outside our rotations.
`update-clientcfg.sh` now builds the client zip from a keep-list: everything
except `valve/maps/` and any `cstrike/maps|overviews` entry not in the union
of the mods' `mapcycle.txt` files. The mapcycles stay the single source of
truth; mod Dockerfiles regenerate `maps.ini` from them so the end-of-map
vote can only offer maps clients actually have. The server still plays from
the full `cs/` tree on disk - only the download is trimmed (~437MB to
299MB, roughly a quarter off every player's first load). Adding a map to a
rotation now means: edit `mapcycle.txt`, redeploy the mod, re-run
`pnpm run clientcfg`.

## Tuned for the 30-minute lunch break (2026-08-02)

The session window is a 30-minute break, and the inherited settings assumed
an evening: GunGame's `gg_map_setup` forced `mp_timelimit 45` (one map
outlives the session), 2 kills per weapon (~48 kills - nobody finishes), and
~5s of dead time per death (3s spawn delay + 2s countdown). Changed to:
1 kill per level, 1s spawn delay, no countdown, timelimit 20 (gg) / 15 (dm),
chattime 5. A GunGame game is now winnable inside the window and dm sees two
maps plus the end-of-map vote. Deliberately NOT doing mid-session mod swaps -
a swap forces every player through a reload of unverified cost; variety comes
from per-Friday mod choice and in-session map rotation instead.

## Custom maps: bsp analysis before bundling (2026-08-02)

First two fun maps (fy_iceworld, fy_pool_day) added for <1MB combined. Two
gotchas worth recording. (1) The obvious mirror (fastdl.me) served
Source-engine `VBSP` files under CS 1.6 map names - check the four-byte
header (`1E 00 00 00` = GoldSrc v30) before trusting any download. (2) A
bsp's real cost is its dependencies: read the texture lump (embedded
mip offsets vs wad references) and the worldspawn `skyname`. iceworld pulls
5 textures from stock wads; pool_day embeds everything and uses the stock
desert sky - so neither needed extra assets. Server-side, custom maps reach
containers via a read-only compose mount into xash's `cstrike/custom/maps`
search path (no image rebuild); client-side they ride valve.zip via the
mapcycle keep-list.

## Per-map cvars: amxx.cfg baseline + configs/maps/<map>.cfg override (2026-08-02)

scoutzknivez needs low gravity, but cvars set for one map persist into the
next - GoldSrc never resets them. The mechanism (verified in a throwaway
container, and reusable for any per-map setting): AMXX executes
`configs/amxx.cfg` on **every** map start, then `configs/maps/<map>.cfg`
for the current map only, in that order. So the mod Dockerfiles append the
stock baseline (`sv_gravity 800`, `sv_airaccelerate 10`) to amxx.cfg, and
`server/<mod>/addons/amxmodx/configs/maps/scoutzknivez.cfg` overrides
(250/100). Observed exec order in the logs: amxx.cfg -> gungame.cfg ->
maps/scoutzknivez.cfg; after `changelevel de_dust2` both cvars read stock
again. This is also how a future `he_glass` could restrict weapons per-map
without touching plugin code.

## SSH password auth disabled (2026-08-02)

The sshd logs showed constant root-password brute-forcing. Root cause of it
being possible at all: Ubuntu's cloud-init drop-in
(`/etc/ssh/sshd_config.d/50-cloud-init.conf`) sets `PasswordAuthentication
yes`, silently overriding the `no` in the main sshd_config - sshd takes the
first value it sees and drop-ins load first. Fixed with
`00-hardening.conf` (sorts ahead, so it wins): password auth off, root
key-only. Chose this over firewalling port 22 to the home IP because a
rotating home IP plus keys-only auth would mean locking yourself out of a box
that is already safe from password guessing. Verified both directions before
closing the console.

Blog material - the numbers and the colour:

- The box was one day old and completely unadvertised: a $6 VPS hosting an
  office CS 1.6 server. It was still being brute-forced around the clock.
  Nobody targeted it; bots scan the entire IPv4 space and found it within
  hours of it existing. This is the baseline weather on any public IP.
- Measured impact: **513 "Failed password" events in the two hours before**
  the change, **1 in the ten minutes after** (a connection that straddled the
  sshd restart). Not reduced - eliminated, because the server no longer
  offers a password prompt at all: rejected attempts changed from
  `Permission denied (publickey,password)` to `Permission denied (publickey)`.
- The username dictionary is a snapshot of what bots think runs on servers in
  2026: `kafka`, `fivem`, `deploy`, `bob`, `mohammad`, `rock`, `openclaw`,
  `cloud-user`, `data`. FiveM (GTA roleplay servers) sitting next to Kafka is
  the tell that they scan for both enterprise and game hosts.
- The trap worth writing about: the main `sshd_config` already said
  `PasswordAuthentication no` - and it was a lie. Ubuntu cloud images ship
  `sshd_config.d/50-cloud-init.conf` with `PasswordAuthentication yes`, the
  drop-in directory is Included at the TOP of the main file, and sshd honours
  the FIRST occurrence of a directive (the opposite of systemd drop-in
  semantics). So the visible setting in the file everyone checks is
  overridden by a file almost nobody checks. Always verify with the effective
  config (`sshd -T | grep -i password`), never the config file.
- The fix respects the same mechanism instead of fighting it: a drop-in named
  `00-hardening.conf` sorts before `50-cloud-init.conf`, so its `no` is read
  first and wins. No editing of cloud-init's file (it could be rewritten on
  image updates), no editing of the main config.
- After the fix, the bots keep knocking - `Invalid user kafka` lines still
  scroll past - but they die pre-auth. The follow-up decision was to do
  nothing about that: it is cosmetic log noise, Ubuntu 24.04's sshd has
  built-in per-source penalties (`srclimit_penalise` was visibly throttling
  the loudest IP already), and fail2ban would only be tidying the logs of a
  door that no longer has a lock to pick.

## Map round two: wads are client-only, skynames are patchable (2026-08-02)

Three additions (fy_snow, de_rats, ka_legoland[dm-only]) settled the two
open questions about custom-map dependencies:

- **External wads never need to reach the server.** de_rats references 130
  textures across five wads including its own 2.9MB `de_rats.wad`; a
  throwaway container booted it with bots fighting and no errors *without*
  the wad present. Texture data is render-side. So wads (plus overviews,
  custom skies, sounds) only need to reach clients - hence the new
  `server/custom/` dir, an overlay of `cstrike/` that deploy.sh rsyncs
  additively into `cs/cstrike/` where update-clientcfg.sh's keep-list zips
  everything that isn't a trimmed map. Containers keep mounting only
  `cs/cstrike/maps`.
- **A missing sky is fixable by patching worldspawn, not by shipping TGAs.**
  ka_legoland wants skyname `dustbowl` (TFC, not in HL/CS). Rather than
  bundle six TGAs for a map you stare at for seconds, rewrite the skyname:
  read lump 0 (entities, plain text) from the BSP's lump directory at offset
  4, replace `"dustbowl"` with a stock sky (`"desert"`), append the modified
  lump at EOF and repoint the directory entry (offsets of other lumps
  untouched - appending sidesteps all shifting). ~10 lines of python,
  verified in a bot boot-test. Check stock skies first though: fy_snow's
  `snow` sky and even its `de_torn` wind wav were already in the game tree,
  so it cost one bsp.
- ka_legoland is dm-only: its per-spawn `player_weaponstrip` +
  `game_player_equip` (knives) would break GunGame's level ladder. Same
  strip/equip race as scoutzknivez under frag_dm - watch which handout wins
  on Friday.

## Remote console with no rcon: the cmdpipe plugin (2026-08-02)

Wanted: change the map on the live server without restarting it. The stack
offers no way in - this Xash3D build answers no rcon/A2S UDP queries at all
(not misconfigured, just absent), the container's stdin is closed, and
configs are image-baked so there is no cfg re-read to hijack. Until now the
only "remote console" was in-game admin chat, and forcing a map meant
editing the compose `+map` and redeploying - which drops every player.

Options considered: enabling rcon (dead - the build doesn't serve it),
`docker attach` (dead - stdin closed at spawn), and a scheduled
rebuild-and-restart (works but is the player-dropping hammer we were
avoiding). Solution: the server may be sealed from outside, but AMXX runs
*inside* and can execute arbitrary console commands via `server_cmd()`. So
`cmdpipe.amxx` (~80 lines, script-only, clears the no-binary-modules rule)
polls a compose-mounted file once a second and feeds new lines to the
console. `scripts/rc.sh` (`pnpm run rc "changelevel de_dust2"`) writes the
file over SSH and tails docker logs for the output.

The design wrinkle worth remembering: the mount is **read-only**. The
obvious protocol - plugin deletes the file after executing - needs the
container user to have write access to a host-owned dir (uid gymnastics or
a 777 dir). Instead line 1 carries a serial number: rc.sh increments it and
replaces the file atomically (mktemp + mv - replacing the inode is why the
mount is the *directory*, not the file; a bind-mounted file goes stale on
rename). The plugin executes only when the serial changes, and on plugin
load it swallows the current serial without executing - AMXX reloads
plugins on every map change, so without that guard a `changelevel` command
would re-fire the moment the new map booted. Verified live: round-tripped
`amxx plugins`, changed map twice with bots reconnecting cleanly, no
replay after the reload.

Baked into gg and dm images (vanilla runs the stock image unbuilt, so it
misses out). This also quietly answers the "how does the future web portal
change maps - RCON? scheduled restart?" question in the backlog: it drops
a file.

## DM dropped-gun cleanup: timed weaponbox removal (2026-08-03)

With 8 players on instant respawn, every death drops a gun and stock CS
keeps dropped `weaponbox` ents until the round ends - on a 9-minute DM
round they accumulate into the hundreds and clients lag noticeably
(reported live on fy_iceworld). No stock cvar controls dropped-weapon
lifetime in CS 1.6.

Options considered: a max-count cap (needs a FIFO of entity indices and
still lets N guns litter the floor), round-time tuning (shorter rounds =
more score resets, fights the DM shape), and per-drop timed removal.
Went with timed removal in `frag_dm.sma`: every drop routes through
`SetModel` on a fresh weaponbox, so a `register_forward(FM_SetModel)`
catches it, checks the classname, and schedules `EngFunc_RemoveEntity`
after `dm_ground_time` seconds (default 3.0 - tested live at 10 first,
3 felt right and is plenty to grab a better gun off a corpse). 0 disables.
Self-limiting: at Friday headcounts the map holds maybe a dozen boxes at
any instant.

Constraints that shaped it: engine-level fakemeta only - `RegisterHam` on
non-player classes ("weaponbox") is unverified against this stack's
reimplemented CS DLL (the CSDM lesson), while `FM_SetModel` is pure
engine interface. Removal task is keyed `TASK_WBOX + ent`; entity slots
get reused, so the task re-checks the classname before removing - worst
case a reused slot loses a newer dropped gun early, which in DM is the
point anyway. Known accepted leak: removing the box orphans the packed
`weapon_*` edict until the game's own round/map cleanup sweeps it -
fine at our 15-minute timelimit, worth revisiting if edict warnings ever
appear.

Tuning is live via `pnpm run rc "dm_ground_time <s>"` (cvar survives
changelevel; the baked default applies from the next image rebuild).
Verified live: plugin `running`, AMXX error log silent through minutes of
bot fights, guns visibly vanish on schedule.

## KZ mod: three classic jump maps, script-only timer (2026-08-03)

**Superseded 2026-08-30 - the mod was removed, see the entry at the end.**

New `server/kz/` mod (fourth in the family, internal port 27048): jump/climb
maps with checkpoints and a run timer. Maps picked for fame + variety:
`kz_longjumps2` (the longjump trainer), `kz_cargo` (classic climb),
`bkz_goldbhop` (classic bhop) - all GoldSrc v30 from kz-rush.ru with fully
embedded textures, so despite long wad keys none needed a wad shipped.
kz_cargo brought the only real deps: `waterworld09` sky + five wavs
(client-only, `server/custom/`) and `models/kz_cargo/fork.mdl` - which the
SERVER also needs (studio models load for collision, unlike wads/sounds;
boot-test showed `Could not load model ... from disk`). Hence the second
compose mount `cs/cstrike/models -> cstrike/custom/models`.

Design notes, all downstream of the no-Ham-on-non-players rule:

- Both timed maps use the Xtreme-Jumps counter prefab (buttons targeting
  `counter_start`/`counter_off`). `Ham_Use` on `func_button` is off-limits,
  so kz.sma detects presses engine-side: IN_USE edge in `FM_PlayerPreThink`
  plus an AABB proximity check (<=96u) against counter buttons only.
- The maps ship ZERO T spawn points (`info_player_deathmatch`), only CT
  `info_player_start`. Rather than trust the reimplemented DLL's spawn
  fallback, kz.sma moves anyone on T to CT on spawn.
- Deaths and the 9-minute round cap both funnel through `Ham_Spawn`, where
  players with a checkpoint are auto-teleported back 0.3s later - round
  restarts cost nothing, so `mp_roundtime 9` is invisible instead of a
  run-killer. Timer is gametime-based and survives restarts.
- No YaPB at all (bots can't climb); knife only; PvP damage superceded in
  `Ham_TakeDamage`; fall damage stays - that's kz.
- Finishes log one `kz_finish` line (time + teleports) into the HL log
  (`logs/kz`), so the Friday recap has material even with no kills. The
  recap skill doesn't parse these yet.

## Remote MCP control plane: secret-in-URL, stateless HTTP, docker CLI (2026-08-04)

Backlog item 8's leftover, built so the box is drivable from claude.ai on a
phone (custom connector): `server/mcp/`, a Node container on 27017 exposing
five tools (server_status, console_command, tail_logs, restart_server,
swap_mod) over MCP streamable HTTP. Routed through the existing front-door
Worker: `/mcp/*` → VPS:27017, everything else falls through to the game.

Three deliberate choices:

- **Secret path segment, not OAuth.** claude.ai custom connectors can't set
  custom headers; the alternatives were a full OAuth server or a secret in
  the URL. For a mates' game server the 64-hex path secret wins: checked
  with SHA-256 + `timingSafeEqual`, 404 on mismatch, rotated by editing
  `/opt/cs16/mcp.env` (never in the repo). Accepted cost: the secret lands
  in Cloudflare request logs.
- **Stateless streamable HTTP.** Fresh transport per POST
  (`sessionIdGenerator: undefined`), no session bookkeeping, no SSE stream
  to keep alive - the simplest shape the connector client tolerates. SDK is
  the v2 modular family (`@modelcontextprotocol/{server,node}` 2.0.0); the
  `@modelcontextprotocol/express` adapter was skipped because its default
  DNS-rebinding host validation rejects non-localhost hosts.
- **docker CLI over dockerode.** swap_mod shells out to `docker compose`,
  which dockerode cannot drive; once the CLI is in the image (alpine
  `docker-cli` + `docker-cli-compose` against the mounted socket), using it
  for ps/logs/restart too keeps one execution model. `/opt/cs16` is mounted
  at the same path inside the container, so compose project names and bind
  mounts resolve identically to an SSH session's runs.

The cmdpipe write side is a straight Node port of `rc.sh` (serial bump +
same-dir atomic rename), serialised by an in-process mutex; the laptop-vs-MCP
serial race is unchanged from the existing rc.sh-vs-rc.sh risk. Output
capture stays best-effort (`docker logs --since`), same as rc.sh.

## Pressbox: headless-Chromium spectator, not native HLTV (2026-08-04)

Backlog item 15: we wanted a permanent spectator that could feed back
screenshots/video so we could see inside the game. First instinct was a
native GoldSrc HLTV proxy pointed at the game server - stock CS toolchain,
zero extra client stack. Ruled out before writing any code:

- Upstream `yohimik/webxash3d-fwgs` transport is WebRTC-only; the README
  even lists "Support WebRTC/UDP proxy" as an incomplete TODO.
- HLTV attaches through the same connectionless GoldSrc UDP netchannel
  that A2S queries use, and the skill notes already recorded "build
  answers no A2S/rcon UDP" - so HLTV's initial `connect` would land in the
  same silence.
- Even if HLTV somehow handshook, it only relays a demo stream. Turning
  that into pixels needs a rendering client on top - and the only
  rendering client this stack has is the WASM game in a browser. Which is
  exactly what a headless-Chromium spectator IS, without the HLTV hop.

Landed on: Playwright/Chromium sibling container (`server/pressbox/`) that
opens the player URL, F3s into spectate, and screenshots the canvas
element on an interval to a mounted volume. Own compose project like
`mcp/` - never touched by mod-swap logic, publishes 27060 only so it can't
trip the single-container-on-27016 check. Zero npm deps beyond
playwright-in-the-base-image (built-in `http` for the viewer, no express).

Two things fell out of the choice:

- One `maxplayers` slot goes to the pressbox while it's up (14 -> 13
  humans). Accepted; sessions with heavy turnout can `pressbox down`.
- The known splash-stall (upstream Xash `UI_DrawString` "remainder by
  zero" - backlog item 2) is handled two ways: browser launches with
  microphone permission pre-granted (the confirmed cause) and, as a
  belt-and-braces, N consecutive byte-identical frames force a page
  reload.

Naming: shortlisted `hltv`, `spec`, `overwatch`, `fridaycam`, `pressbox`.
Went with `pressbox` because `hltv` would be actively misleading in the
compose file (not an HLTV proxy) and the rest were either too generic
(`spec` collides with test-file jargon) or too cute for a runbook.

**Update 2026-08-05: removed.** Too buggy to keep: the choose-team menu
stayed burned onto the feed, stall recovery leaked ghost slots, and an
idle pressbox as the sole connected client wedged the whole sim (webxash
pauses when every client goes silent), forcing watchdog restarts that
cycle the map. The WebRTC-only / no-HLTV finding above still stands and
is the starting constraint for any future spectator attempt.

## Forced team rebalance: raw pdata write, cs_set_user_team segfaults (2026-08-05)

`ff_rebalance` (teambalance.amxx, gg + dm) evens the T/CT headcount on
demand - bots moved first, then the lowest-frag humans, each slain with
frags kept so instant respawn drops them on the new side. Driven through
the cmdpipe: `pnpm run rebalance` locally, `rebalance_teams` on the MCP.

The obvious implementation crashes the server: **`cs_set_user_team`
segfaults this stack** (signal 11 in the cstrike module's
`CPlayer::ResetModel -> PostponeModelUpdate` against the reimplemented CS
DLL - same failure class that killed CSDM, caught in a throwaway boot
test). Module *reads* are proven (frag_dm uses `cs_get_user_team` live),
so the plugin instead writes `m_iTeam`/`m_iModelName` directly with
fakemeta at the same offsets, sends the `TeamInfo` scoreboard message
itself, and verifies every write back through `cs_get_user_team` -
aborting loudly on any mismatch rather than corrupting pdata. Server-side
writes also bypass the client's one-team-change-per-round limit that
blocks F1/F2 mid-round. Soak-tested in a throwaway with all nine bots
forced onto T: moved bots respawn, fight and score as their new team.

## Branded loading screen: cstrike/gfx/shell/conback.tga (2026-08-29)

The screen players stare at while a map loads is the engine's console
background, not anything the page controls. Xash resolves it in
`Con_LoadSimpleConback`, which picks its basename off `host.allow_console`:
console allowed -> `conback`, otherwise -> `loading`. It then tries
`gfx/shell/<name>.{dds,bmp,tga}`, `cached/<name>640`, `cached/<name>`, and
finally falls back to Quake-format `gfx/conback.lmp`.

We take the `conback` branch, and permanently: the GameUI menu is
deliberately not preloaded (the Escape crash, see `apps/web/src/launch.ts`),
and a missing menu is exactly what turns `host.allow_console` on. Nothing
matched under `cstrike/`, no `cached/` dir exists, so every player was
getting stock `valve/gfx/conback.lmp` - the Half-Life orange one.

The replacement lives at `server/custom/gfx/shell/conback.tga`, riding the
existing `server/custom/` -> `cs/cstrike/` overlay that `deploy.sh` installs
and `update-clientcfg.sh` bundles into valve.zip. See the 2026-08-30 entry
below for the art that is actually shipped.

Two constraints on any future replacement:

- **Author it 1512x982.** The engine stretches the texture to the canvas
  with no letterboxing, and `#canvas` is `100vw/100vh` while `play()` calls
  `enterFullscreen()` - so the target is a fullscreen MacBook Pro display:
  1512x982 logical on the 14", 1728x1117 on the 16". Both are ~1.54:1, so
  neither 4:3 nor 16:9 fits; 16:9 was tried first and visibly squashed.
  Uncompressed 24-bit TGA, ~4.5MB raw (noise against a 318MB zip).
- **Keep the left ~22% quiet.** The console is open over this image while
  the map loads, and its text runs top-to-bottom down that column. The strap
  starts at x=355 for that reason.

Both basenames are shipped, byte-identical - see below.

## Loading screen: one artwork under both basenames (2026-08-30)

The 2026-08-29 entry above shipped only `conback.tga` on the reasoning that
the `loading` branch is unreachable while the GameUI menu stays out. Two
things were wrong with that.

First, the box was not clean: `cs/cstrike/gfx/shell/loading.tga` existed - a
1024x768 placeholder reading "TEST IMAGE - loading.tga", dropped there during
the 2026-08-29 work and never removed. It is untracked by `server/custom/`,
so `deploy.sh` (an rsync without `--delete`) could never have cleaned it up,
and `update-clientcfg.sh` bundled it into valve.zip along with everything
else under `cs/`. Whichever branch the engine took, one of the two images was
going to be wrong.

Second, "unreachable" is a claim about `host.allow_console`, which is a
consequence of the menu-preload decision - a decision that could be revisited
for unrelated reasons. A branch that is unreachable today is a trap, not a
saving. So both basenames now carry the same file:

    server/custom/gfx/shell/conback.tga
    server/custom/gfx/shell/loading.tga   (identical bytes)

If they ever diverge again, that is the bug. Keep writing both.

The art is new and carries no text at all - no wordmark, no session time. The
strap had to go: it stated a fixed weekly time in a file that is rebuilt only
when someone remembers to, which is exactly the kind of copy that goes stale
without anything failing. Type also survives the engine's stretch worst - the
canvas is whatever the player's display is, and the texture is scaled to it
with no letterboxing.

What replaced it is the web page's own atmosphere at full bleed, so the
loading screen and the page it was launched from read as one thing: navy
ground, the CPL briefing grid at its 44/176px pitch, acid scanline streak
bands around a hot core bloom, the radar ring cluster bleeding off the
top-right with its sweep arcs and blips, CS surveyor crosshairs on the grid
intersections, hyperlink-blue viewfinder corners. Palette and pitches are
lifted from `apps/web/DESIGN.md` rather than eyeballed.

The generator is `scripts/make-conback.py`: it writes the SVG, screenshots it
in headless Chrome at exactly 1512x982, and packs the pixels into a TGA by
hand - type 2, 24-bit, descriptor `0x20` (top-left origin), matching the
header the previous file used. ImageMagick's own TGA writer is not used
because its origin handling is the one thing that must not drift. Re-run it
with `python3 scripts/make-conback.py`; it overwrites both files.

The 2026-08-29 constraints still hold and the generator honours them: 1512x982,
and the left ~22% stays quiet for the console text that runs down it (measured
on the shipped file: mean luminance 10/255 on the left column against 32/255
across the rest).

## KZ mod removed (2026-08-30)

The jump/climb mode is gone: `server/kz/`, its three maps and `kz.sma`, the
kz-only client assets (`waterworld09` sky, the summercliff2 wavs,
`kz_cargo/fork.mdl`), the mode's card and ice-cyan signal colour on the web
page, and every kz branch in the scripts, the MCP tools and the recap
parser. Four modes remain: classic, gg, dm, aim.

Nothing here is load-bearing for the others - kz was its own image, its own
mapcycle and its own port. Two knock-on effects worth knowing:

- The valve.zip keep-list is the union of the remaining mapcycles, so the
  next `pnpm run clientcfg` drops the kz maps and their assets from the
  client payload (a smaller download - the point of the trim).
- The box still holds `/opt/cs16/kz/`, `logs/kz/`, `mods/kz/`, the kz
  `.bsp`s in `cs/cstrike/maps/` and the `kz-xash3d` image. `deploy.sh` no
  longer touches any of them; clean them off by hand if the disk matters.

The 2026-08-03 entry above stays as the record of how it was built.

## The match menu: two ways in, and a keymap (2026-08-30)

The Escape menu only ever appeared in fullscreen, and nothing gated it on
fullscreen - `App.tsx` listened for the Escape keydown and that was all.
The reason is Chrome: the Escape that exits pointer lock is a user-agent
shortcut and the keydown is **never dispatched to the page**. Windowed, a
player pressing Escape got their cursor back and no menu. In fullscreen the
same press also leaves fullscreen, and there the key does reach the page.

So the menu now has two openers, and both only ever OPEN it (firing together
on one keypress is a no-op):

1. the Escape keydown, as before - the fullscreen path;
2. `pointerlockchange` with the lock gone - the windowed path, and also
   alt-tab or a click outside, which leave a free cursor over a running
   round, which is what the menu is for.

Two things must not raise it, and both are timestamp guards rather than
anything that swallows an event (the 2026-08-29 attempt that swallowed
`pointerlockchange` is the one that broke mouse look):

- **fullscreen transitions**, which drop the lock by themselves - the
  fullscreen button is not a request for the menu;
- **the engine releasing the lock**, which it does whenever it wants the
  cursor back - opening the `~` console is the one players hit. Every such
  release lands on `document.exitPointerLock`, so that is wrapped to record
  *when the page gave the lock up by code*, then calls straight through.
  A release the browser initiated (Escape, focus loss) hits no wrapper.

Resume no longer forces fullscreen. It could not tell "was fullscreen" from
"wasn't", because Escape strips fullscreen before the handler runs and the
old code read `document.fullscreenElement` after the fact - so it always put
fullscreen back. A `wantFullscreenRef` records intent instead (set by Play
and the fullscreen button, cleared only by turning fullscreen off or by a
refused request), and a windowed player resumes windowed.

### Where the keys come from

The menu lists the player's controls, because half the regulars have not
played 1.6 since school. They are read from the player's OWN binds via
`currentBinds` in `launch.ts`, not printed from a table - a rebind has to
show up or the list is worse than nothing.

It reads `/rodir/cstrike/config.cfg` straight off the in-memory FS and
**never pokes the console**: this runs while a player sits in the menu, and
`Cmd_ExecuteString` behind a connection that has gone away is the
`Mem_FreeBlock` abort documented above `persistSettings`. `FS.readFile` is
plain JS over MEMFS, safe even on a dead engine. That file is whatever
`host_writeconfig` last wrote (boot, then every 30s persist tick), so it
trails a rebind by at most one tick; the saved diff is replayed over the top
for the first tick of a session, when the file does not have it yet.

A `DEFAULT_BINDS` seed parses first so the menu still teaches the keys with
no engine to ask. It is not a second source of truth: the engine's
config.cfg opens with `unbindall`, so reading it wipes the seed entirely.

`KEYMAP` in `App.tsx` is the running order of what a player needs - about
twenty rows, not the ~60 keys the stock config binds, because a wall of them
teaches nobody. `AWKWARD_KEYS` breaks the ties where the stock config binds
a command twice and the first line is not the one anyone reaches for
(`+attack` is on ENTER before MOUSE1; the arrows shadow WASD).

## How long the session has left, in-game (2026-08-30)

The page always counted down TO Friday and then stopped counting: LIVE NOW,
a map clock, and nothing that said how much of the slot was left. During a
session that is the only question anyone has, and the page cannot answer it
where it gets asked - once you are playing the overlay is hidden behind the
canvas. So the number now rides over the game: a small bug centred on the
top edge (`.slotclock`), rendered outside `.overlay` because that layer is
hidden while playing, `pointer-events: none` so a click still reaches the
canvas and re-locks the mouse.

The end time needed no new plumbing. `data/sessions.json` has always carried
`end` per week and `scripts/session.py` has always written it into
`/assets/session.json` - `App.tsx` simply never read it, and assumed every
slot ran the half hour in `SESSION_LIVE_MS`. It now reads it, and that
constant survives as `SESSION_LENGTH_MS`, the fallback for a week with no
usable end. "Usable" means parses as `HH:MM` AND lands after kickoff: a bad
file falls back rather than showing a session that ran backwards.

Knock-on: LIVE is no longer "kickoff + 30 min". A week whose slot runs an
hour now stays live for the hour, and the site rolls to next week when the
slot is actually over instead of half an hour in.

The map clock keeps the strip's big counter cells and the session clock is a
small line above them, because they are different numbers and one set of
digits for both reads as a contradiction on the minute they disagree.

QA: `?t-minus=<seconds>` already opened the page near kickoff; negative
values now land INSIDE a synthetic half-hour session, so `?t-minus=-1740`
opens on a session with a minute left and the final-minute state on screen.
Positive values give the other face of the bug (`?t-minus=90` -> "SESSION IN
1:30"), because `isToday` is true down that path.

**It rides Tab** (same day): permanently on screen it was one more thing to
play around, so it now shows only while Tab is held - the scoreboard key,
where a player already looks for match state. The handler is read-only in
exactly the way the Escape one is: capture phase on window so nothing can
hide the event, but no `preventDefault` and nothing swallowed, so the engine
still draws its own scoreboard on the same keypress. `keyup` is not
guaranteed to arrive (alt-tab away holding Tab), so `blur` and
`visibilitychange` clear the flag too, and so does unmounting. Being asked
for rather than endured is also why it is solid and full-size now instead of
translucent and tiny.

Two faces, one bug: mid-session it counts the slot down, and on matchday
BEFORE kickoff it counts up to it (`clock.isToday`, which already means
"same day and still to come"). Any other day it stays off screen - a Tuesday
warm-up does not need a three-day countdown over the game.

## No fullscreen button (2026-08-30)

The `.fs` toggle in the top-right corner is gone. Play already asks for
fullscreen on the click that starts the game, and the esc menu's Resume puts
it back after Escape strips it - so the button was chrome over the canvas
that duplicated what both paths do anyway.

What it took with it: the `fullscreen` state (the button's icon was its only
reader) and `toggleFullscreen`. What stays: `wantFullscreenRef`, which now
records only whether Play's request was granted, and the `fullscreenchange`
swallower, which still has to keep SDL from seeing the event (the console
font trap above). A player who leaves fullscreen with Escape and does not
open the menu stays windowed until the next Resume click - a keypress the
page did not act on is not a gesture the browser will take a request from.

## The client payload stopped being an unpacked tree (2026-08-30)

`valve.zip` used to be 4893 loose files that the page inflated with JSZip and
wrote into the engine's in-memory filesystem before the first frame - all
420MB of them, whether or not a session ever opened them. Measured on the
235MB build: 4.8s on a fast Mac, and that is the floor. Nobody plays on a
fast Mac at 1:30 on a Friday.

The engine already knew how to do better. FWGS mounts any `*.pk3` it finds in
a gamedir (`FS_AddGameDirectory`) and inflates out of it on demand, in wasm,
for the files it actually opens - the route `extras.pk3` has always taken
here. So the payload is now a STORED outer zip carrying two archives,
`cstrike/cstrike.pk3` and `valve/valve.pk3`, which the page slices out and
writes whole. Two files instead of 4893, no JS inflate at all: 4.8s -> 0.27s,
and the 420MB unpacked tree stops existing, so peak memory roughly halves.
Wire size is unchanged - the compression just moved inside.

**The gamedir root stays loose, and that rule is the whole finding.** First
attempt packed everything, and the client died at boot with `Infinity` as its
entire error message: emscripten's `_emscripten_throw_number` unwinding out of
`main()`, stringified. The engine decides a directory is a gamedir at all by
looking for `liblist.gam` / `gameinfo.txt` with `FS_SysFileExists`, which sees
real files and never the VFS (`gameinfo.c`). Packed away, they are invisible,
no gamedir is found, and there is nothing to boot. The root is also where the
wads live, and wad lumps are read by seeking, which restarts the inflate from
the top inside a deflated entry (`FS_OpenFile_ZIP`). Root is 0.3MB of config
plus the wads, so the rule is "the root stays loose" rather than a list of
special files - and `update-clientcfg.sh` now fails the build if `liblist.gam`
is not loose, because that failure explains itself to nobody.

The client reads both layouts, so the two halves ship independently: page
first, payload second. The JSZip path (and the dependency) can go once a
session has run on the pk3 payload.

Also gone from the critical path: the ~235MB `cache.put` into Cache Storage
was awaited, holding the Play button shut for the length of a disk write after
the download had already finished. The bytes are in hand either way.

Not done, and still the cheapest bytes left: `valve/sound` is 41MB across 2544
files, kept as a fallback nobody has tested, and the maps are 49MB of which
one mode needs a few. Both want a play-test, not a guess.

## The war room: an admin panel behind a hash route (2026-08-30)

Running a session from the laptop works and running it from claude.ai works,
but both are slow at the moment that matters - someone is being a pest, the
map is wrong, the bot count is wrong, and the fix is twenty seconds away on
a phone that is already open on the game page. So the client grew a hidden
control panel: `/#/warroom` (`apps/web/src/Admin.tsx`), backed by
`/admin-api/*` on the existing MCP container.

Choices worth recording:

- **Hash route, not a second page.** The composes mount only `index.html`
  and `assets/` over the image's stock client, so a second HTML entry would
  never reach the box. `main.tsx` branches on the hash and dynamic-imports
  the panel, which also keeps it out of the player bundle (10 kB chunk that
  players never fetch). The hash is concealment, not security.
- **Header token, not a secret in the URL.** The MCP endpoint puts its
  secret in the path because claude.ai connectors cannot set headers; this
  is our own `fetch()`, so `ADMIN_TOKEN` rides `x-ff-admin` and stays out of
  Cloudflare's request logs. Same env file, separate secret: leaking one
  does not hand over the other. Ten misses per IP buys a 15-minute lockout.
- **One doing-layer, two surfaces.** The tools and the panel now share
  `server/mcp/src/actions.js`. Both call the same `swapMod`, so the panel
  cannot invent a swap that skips the "exactly one container on 27016"
  check, and a fix to either lands in both.
- **Slow actions are jobs, not requests.** A mod swap takes 1-2 minutes and
  Cloudflare gives up at ~100s, so `/mode` and `/restart` return 202 and the
  panel watches a `job` field in `/state`. One at a time - two swaps racing
  for 27016 is exactly the failure the port check exists to catch.
- **Bots are a quota, not a headcount.** YaPB runs `yb_quota_mode fill`, so
  adding or kicking a bot by hand is undone within half a second. The panel
  therefore offers "fill to N" and a clear-all (`yb_quota 0` + `yb kickall`)
  and shows no kick button on bot rows - a control that visibly does nothing
  is worse than no control.
- **Names are refused, not escaped.** Kicks and announcements become console
  arguments, and GoldSrc chains on `;` and tokenises on quotes. Anything
  carrying those characters is rejected with a message rather than escaped
  and hoped for; that name gets kicked over SSH.
- **Two taps for anything that drops players.** Swap and restart arm on the
  first tap ("Drop everyone?") and disarm after five seconds. Not a native
  `confirm()`: a modal dialog freezes the page the game engine is served
  next to.

## Three map-pool modes: Source Maps, Fight Yard, Sniper (2026-08-30)

Three new mods, all dm clones (`server/{css,fy,awp}/`, internal ports 27078 /
27098 / 27118). Same `frag_dm.amxx`, same YaPB setup, same entrypoint shuffle -
what differs is the rotation and one line of `amxx.cfg` baseline:

- `css` **Source Maps** - the CS:S/CS:GO remakes (`css_dust2_go`,
  `css_mirage_go`, `css_cache`, `de_bank_csgo`, `css_bycastor`, `css_deagle`).
  dm's baseline unchanged; four of the six carry real bombsites so
  `mp_roundtime 5` still bites.
- `fy` **Fight Yard** - the `fy_` pool, old and new. `mp_roundtime 1` is the
  MODE baseline, not a per-map override, because every map is a small
  no-objective yard.
- `awp` **Sniper** - `dm_only "awp"` promoted from a per-map override to the
  mode baseline. frag_dm hands out the AWP on spawn and strips anything else
  on deploy; that is what stops bots (`yb_botbuy 1`) buying past the rule,
  which the map's own `info_map_parameters` cannot do on this DLL.

Per-map overrides stay the exception, and only where the BSP demands it:
`css_deagle` (game_player_equip deagle -> `dm_only "deagle"`), `css_bycastor`
(32 floor AWPs -> `dm_map_guns 1`), `fy_houses` (an armoury_entity for every
weapon -> `dm_map_guns 1`).

Four things worth recording:

- **Models and sprites load SERVER-side.** The wads-are-client-only rule from
  the 2026-08-02 entry does not extend to studio models or `env_sprite`.
  de_bank_csgo logged `Could not load model sprites/2dprops/tube.spr from
  disk` until the compose grew a `cs/cstrike/sprites` mount alongside the
  `models` one. Wads and sounds still never need to reach a container.
- **Bake the graph, don't let YaPB analyse.** graph-master had 16 of 18;
  fy_nuketown and awp_sunburn 404 on yapb.jeefo.net, so YaPB ran its own
  analysis (~5s) at every map start - fine once, but it happens on every
  fresh container. Generated both in a throwaway, `docker cp`'d the `.graph`
  out, committed them. All 15 maps now load a baked graph, zero analysis.
- **The mod is `css/`, not `src/`.** `/opt/cs16/src/` already existed on the
  box holding downloaded mod archives, and `deploy.sh` rsyncs `--delete` into
  every name in `DIR_MODS` - the first deploy under the name `src` wiped it.
  Renamed to `css/`, which also matches how `fy` and `awp` are named after
  their map prefix. Any future mod dir must be checked against the box's
  existing `/opt/cs16` layout before it goes in `DIR_MODS`.
- **`update-clientcfg.sh` had a latent hole.** Its keep-list globbed
  `{gg,dm,zp,aim,vanilla}` and its restart `case` had no `aim-*` arm, so a
  clientcfg run with aim live would have died on "not a known mod". Both now
  cover every mod dir.

Client payload cost: ~60MB of new BSPs plus ~15MB of models/sounds/sprites
(de_bank_csgo alone is 19MB of BSP and 28MB installed). The maps are trimmed
by mapcycle, but `models/`, `sprites/` and `sound/` ship to everyone
regardless - worth remembering before the next big map goes in.
