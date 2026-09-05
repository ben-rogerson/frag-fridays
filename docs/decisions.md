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
- **Starting early moves the kickoff, it does not hide the clock (2026-09-03).**
  Sessions sometimes start before the scheduled time, and a countdown still
  ticking over a session in progress is wrong. The obvious fix - a switch
  that blanks the counter cells - would have left the rest of the page
  lying: still "next session", still PRACTICE in the server browser, still
  "warm up" on the join button, because all of those read the same clock. So
  START NOW rewrites `web/assets/session.json` with the kickoff at this
  minute (keeping the slot's end) and the page's existing "kickoff already
  past = live until the end" rule does the rest, in one place. The original
  time rides along in a `scheduled` key so BACK TO 2.30 PM is a rewrite and
  not a guess, and the page ignores keys it does not know. Fridays only: the
  clock counts to Fridays, so a file dated anything else is one the page
  ignores - a dead button. The page also re-reads that file every 30s now,
  because the useful case is the phone in someone's hand changing what the
  page in front of everyone else says.

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

## Loading screen: the masthead and the stack, on the same margin (2026-09-04)

The 2026-08-30 entry above says the art "carries no text at all". That is now
half wrong, deliberately. What had to go was the strap - a fixed weekly
session time baked into a file that is rebuilt only when someone remembers
to. The failure mode was stale copy, not lettering. So the rule the art keeps
is narrower than "no text": **nothing time-bound, date-bound or
session-bound**. A wordmark and a list of what the thing runs on never go
stale.

Two blocks, both hung off one right margin (`MARGIN = 108`, inside the
viewfinder corners at 56/1456):

- **Top right, the masthead lockup** - the page's own crest and
  `FRAG<b>FRIDAYS</b>` in Black Ops One, scaled up off the site's 54px crest /
  42px logo, over a hairline and a `counter-strike 1.6` micro-label. The crest
  IS the Counter-Strike figure, so the game gets its logo without a second
  traced mark competing with it.
- **Bottom right, the colophon** - `running on` over three right-aligned rows
  of small mark-and-label pairs: the game (xash3d-fwgs, webassembly, webrtc,
  amx mod x, metamod-p, yapb), the box (go, docker, ubuntu, vultr, cloudflare
  workers), the page (react, typescript, vite). Rows are written out in the
  script rather than left to flex wrapping, so each one is a group you can
  read. Every mark is one flat slate weight at 11px - a colophon, not a
  sponsor board. Things with no official SVG take the page's news square
  instead of a logo, so the row grammar holds.

Both blocks are far right of `QUIET_W`; the console column measures 11/255
mean against 35/255 across the rest, unchanged from before.

Two things the render now depends on, both embedded because headless Chrome
has no network guarantee and a missing asset fails *silently* into a fallback
nobody notices:

- `assets/black-ops-one-latin-400-normal.woff2`, base64'd into an
  `@font-face`. Committed rather than read out of `node_modules` so a fresh
  clone renders the same wordmark with no install; the script raises if it is
  missing rather than letting Arial Narrow through.
- `scripts/brandmarks.py` - the crest's two paths (copied from `CrestLogo` in
  `apps/web/src/App.tsx`; redraw both together) and the official monochrome
  tech marks from simple-icons 13.0.0, verbatim path data.

The atmosphere is still one SVG, but the two blocks sit over it as HTML in
the same document: they are rows of mark-plus-label pairs, right-aligned, and
the browser is the thing that knows how wide a label is. Chrome screenshots
both layers as one image, so the pipeline below the render is untouched -
same 1512x982, same hand-packed type-2 24-bit TGA with descriptor `0x20`,
same identical bytes under both basenames, same 4.5MB each (an uncompressed
TGA is a fixed size, so valve.zip does not grow).

The image only reaches players after `pnpm run clientcfg` rebuilds valve.zip,
and then only after a hard refresh - the old payload is cached.
## The map button verifies, and the page says a map is loading (2026-09-04)

Two war-room map changes stranded a session on its loading screen (the full
diagnosis is in [troubleshooting.md](troubleshooting.md)). The map changes
themselves ran; what broke was every client's carry-over into the new level,
and neither end of the system said a word about it. The admin was told
"Changed map to de_nuke" while nobody could see de_nuke, and the players had
a frozen canvas with no message on it at all. Both halves are worth fixing
separately from whatever the underlying engine fault turns out to be.

**The admin API now checks its own work.** `changeMap()` in
`server/mcp/src/actions.js` warns, waits, changes, then polls `status.json`
for the new map name and finally for the players still being on it. It is the
only action here that does this, and it earns it: it is the only one that has
stranded a session, and it is the one whose failure mode looks exactly like
success from the outside (the map really does come up, the scoreboard really
does refill - with bots). The cost is that the button takes ~15s to answer
instead of returning the moment the pipe is written. That is the right
trade: an admin who has to guess whether a button worked will press it again,
which is precisely what happened on the night.

Two supporting rules fell out of it:

- **The restart button is never disabled by another action.** It is the way
  out of everything on this stack, and a 15-second map change is exactly when
  someone reaches for it. `act()` in the panel grew an `urgent` flag that
  skips the one-at-a-time gate; the restart is the only caller.
- **`status.json` gets read for its AGE, not just its contents.** The file
  reads perfectly healthy when the sim behind it has stopped - a full
  scoreboard, a map name, a clock. `serverState()` now reports
  `statusAgeMs`/`statusStale` off the Last-Modified header (this process and
  the game container share a clock, so there is no skew to argue about), the
  panel warns when the scoreboard has stopped moving, and `changeMap` refuses
  to send a change into a sim that is not running. A server that sends no
  Last-Modified reports `null`, which every caller reads as "unknown" - never
  as fresh, and never as stale.

**The page polls `status.json` while playing.** It only ever polled in the
lobby, which meant that once the engine had the screen the page's model of
the server was frozen and a map change was invisible by construction. Now a
change puts a banner at the top of the canvas (which map, and that the slot
is kept) and, if the player's own alias has not appeared in the new map's
player list after 30 seconds, a card with a rejoin button.

Two things make this honest rather than a guess. `status.json`'s player list
comes from `get_players()`, which only counts clients that have actually
spawned in, so "my name is not on the new map" is the server saying it has
not seen this player arrive. And the page can tell a stuck client from a
stopped server, because a sim that is running rewrites `status.json` every
five seconds with clocks that move - identical bytes for thirty seconds means
the server stopped, and the card says so, because "restart it" and "rejoin"
are not the same advice.

The banner deliberately does not cover the game or take the pointer: a
healthy carry-over is one to three seconds and the page must not be a
five-second obstacle every map. Only the stuck state gets the full sheet, by
which point there is nothing to play behind it.

## The bots wait for the humans at a map change (2026-09-04)

The same incident, one layer down. When the carry-over into the new map
stalled, the thing that made it unrecoverable was not the stall - it was that
YaPB reached the new map first and closed it. Side by side:

    FAILED   bots enter 03:34:10-13, "Maximum players reached (16/16)" at :13,
             no human ever enters, reloads at :18-:27 hit a full server
    HEALTHY  humans enter 04:11:42-43, bots fill the remainder at :46-:48,
             and YaPB keeps kicking its own bots as more humans arrive

Every 16-player mod shipped `yb_autovacate_keep_slots "1"` and
`yb_join_delay "5.0"`. One reserved slot cannot absorb a session's worth of
people coming back at once, and five seconds is shorter than a slow
carry-over - so the failure gets WORSE the more people are playing, which is
exactly the wrong way round for an event.

**`yb_join_delay` 5 -> 20** (YaPB's max is 30) in all six mods with a bot
tree. This is the ordering fix and it is the important one: for the first
twenty seconds of a new map the only thing that can take a slot is a person.
The cost is a visibly thinner server for those twenty seconds, on a
ten-minute map, with everyone who matters already in it.

**`yb_autovacate_keep_slots` 1 -> 4** in the five 16-player `fill` mods. This
was written up as "four landing slots, always" and that was wrong; it is
corrected here rather than quietly edited, because the wrong version is the
kind of thing a future reader would build on. Measured on the box the next
day: YaPB computes the reserve as `maxClients - (its own human count +
keep_slots)`, and a client stalled mid-map-change is not in its human count -
it is invisible to YaPB for the same reason it is missing from `status.json`.
The reserve is real (verified: 12 bots against 15 with the quota at the
ceiling) but it is subtracted from the wrong number for this bug, and the
incident's own log confirms it - eight bots created then `Maximum players
reached (16/16)` is only consistent with YaPB reading the server as empty.

It is kept anyway, reframed as what it is: headroom against players the server
can see, free in normal operation (it implies a 12-player ceiling and the
quota is 10). It is not the map-change guard.

**`changeMap()` clears the bots when it catches the lockout** - `yb_quota 0` +
`yb kickall` before it reports the failure. This is the repair that does not
depend on YaPB's arithmetic: it does not matter whether YaPB can see the
stalled clients, because taking the bots away frees every slot those clients
are not themselves holding, and the players' own reloads land in them. It
fires on one narrow signature (the map came up, there were humans, now there
are none), it is the same command pair the panel's Clear button already runs,
and it says loudly in the feed that it has happened. Acting rather than only
advising is justified here by how the night went: the advice existed - restart
the server - and it still cost six people a session, because nobody knew which
advice applied.

`aim` is deliberately excluded from the second change and gets only the join
delay. It runs `maxplayers 24` with a fixed 16 bots and `yb_autovacate "0"`,
so it already holds 8 slots free by arithmetic - a bigger reserve than the
one being added elsewhere - and switching autovacate on there would change
how many bots an aim session runs, which is a mode design decision and not a
bug fix.

None of this touches the behaviour README.md describes ("bots hold the slots
and step out one at a time as humans arrive"): with quota 10 under a 12
ceiling, `fill` mode and autovacate work exactly as before.

The war room's bot fill now stops at `maxplayers - 4` (`- 2` on Classic's 12
slots, where the reserve is the spare pair rather than four). It earns its
place for a second reason: `yb_quota` is in
`yb_ignore_cvars_on_changelevel`, so any non-zero quota raised at runtime
survives every map change and is never re-read from yapb.cfg (verified
2026-09-04 - a live `yb_quota 6` came through a changelevel as 6). The panel
is the only place that can be capped, since the file is not authoritative
once the container is running.

The one value that is NOT preserved is zero: `config.cpp` special-cases a
quota of `<= 0` and lets the config value through on changelevel. That is
what makes the bot clear above safe to leave behind - it heals at the next
map change instead of leaving a botless server for someone to find later.

`yb_join_delay` and `yb_autovacate_keep_slots` are deliberately NOT added to
`yb_ignore_cvars_on_changelevel`: being re-read from the file at every
changelevel is the property that makes them reliable here, since a
changelevel is the only moment they do anything.
## Classic becomes the 5v5 match mode (2026-09-04)

Classic was the mode with nothing to say for itself: stock CS 1.6, casual
quick-round cvars, the same twelve-map cycle as everything else, and a card
on the front page that described it as "buy your kit, win the round". Every
other mode had a reason to exist. This one was the absence of a reason.

It is now the match mode: five a side, the era's competition ruleset
(sources and cvar-by-cvar rationale in [classic-rules.md](classic-rules.md)),
the era's map pool, and no bots. The casual modes stay casual; Classic is the
one you swap to when ten people want a real game.

Five things worth recording, most of them about where config LIVES rather
than what it says:

- **The box copy of `amxx.cfg` was silently winning, and the reason is worse
  than it looked.** Classic's `amxx.cfg` lived only on the box, in
  `/opt/cs16/mods/zp/configs/`, and held quick-round values - so
  `server/vanilla/server.cfg`, the file in this repo that looks like the
  server's config, was being overridden by a file the repo has never
  contained. Boot-testing it on 2026-09-04 turned up the actual mechanism,
  which this repo had backwards: **`server.cfg` execs ONCE, at container
  start, and never again; `amxx.cfg` is exec'd by AMXX at EVERY map start.**
  So on the first map amxx.cfg won by running later, and on every map after
  that it won by running at all. Written up properly in troubleshooting.md
  because it applies to every mod, not just Classic.
  The fix is not to move the ruleset into `amxx.cfg`; it is to mount a repo
  copy of `amxx.cfg` that sets **no gameplay cvar at all** and ends with
  `exec server.cfg`. One readable file is the ruleset, it re-applies every
  map, and the other file exists only to stop something else claiming to be
  the ruleset. Cost: `log on` re-running splits each map's kill log into two
  files. `standings.sh` cats them all, so it is cosmetic.
- **Take the box copy verbatim when rescuing a file, then subtract.** The
  first draft of `server/vanilla/amxx.cfg` was hand-written from what the
  docs said was in it, which would have silently dropped `amx_default_access`,
  the vote ratios, the CS stats settings and a rewritten `amx_imessage` the
  moment it mounted. The committed version is the box file byte-for-byte
  minus the five casual gameplay lines - a diff of the two proves nothing
  else moved. Rescuing a config is a subtraction, never a retype.
- **Mounting over the box tree is how anything gets rescued from `mods/`.**
  `deploy.sh` only `mkdir -p`s `/opt/cs16/mods`; its contents were hand-seeded
  and nothing syncs them. Rather than a big migration, two files were pulled
  back one at a time by adding deeper bind mounts over the directory mounts
  that feed them (`vanilla/amxx.cfg`, `vanilla/yapb.cfg`). Docker applies
  mounts deepest-path-last, so a file mount inside a directory mount wins.
  That is the pattern for the next one. The real fix - giving Classic its own
  Dockerfile so it can bake its own everything - is backlog item 16.
- **Zero bots has to be a file, not a habit.** `yb_quota` is a live cvar with
  no persistence, so "we just don't add any" is not a default, it is a
  convention that survives exactly until someone fills the server for a
  warm-up and then restarts the container. `server/vanilla/yapb.cfg` ships
  `yb_quota "0"` and YaPB re-reads it on load, so zero is what a cold start
  means. Bots stayed fully supported: the war room's Bots panel already
  reaches Classic (vanilla has the cmdpipe plugin), and a fill deliberately
  survives a map change (`yb_ignore_cvars_on_changelevel`) but never a
  restart.
- **The match itself is a script, not a plugin.** Knife round, live-on-3 and
  the half-time swap are `scripts/match.sh`, because Classic runs the stock
  image unbuilt and cannot compile a plugin at all. That is a real ceiling,
  not a shortcut - no `.ready`, no automatic side swap, no score carried
  across the halves - and it is written up as backlog item 16 rather than
  half-built here.

On the page, Classic leads the roster and wears a "5v5" chip, and its emblem
gained a pentagram inside the shield it already had - the only mark in the set
with something inside it, five points for the five a side. The copy states the
ruleset flatly and makes no claim about being serious; the ruleset is the
claim.
## Server ping: capped sv_maxupdaterate at the browser's refresh rate (2026-09-04)

Players reported ping "up around 100, fluctuating between 30 and 100" and a
rubber-banding feel, worst on `fy_iceworld` with six to eight humans.

The server was sending each client ~76 snapshots a second. A browser client
presents at most one per rendered frame and the frame loop is rAF-driven, so
everything above the display refresh was built, compressed, pushed through
pion and delta-decoded purely to be thrown away - and the cost of doing that
for every client showed up as a long, unstable ping tail for all of them.

`sv_maxupdaterate` 102 -> 60 in every mod Dockerfile and in
`vanilla/server.cfg`. Measured with six connected browser clients on
`fy_iceworld`: the ping column's p95 went from 73-104ms to 47-48ms while the
median barely moved (45-48 -> 43-48), and engine CPU fell from 44-47% to
39-41% of a core. Run twice each way; the baseline's own p95 varied by 30ms
between identical runs and the capped config's did not, which is the actual
complaint - the spread, not the median.

Deliberately a SERVER cvar rather than a `userconfig.cfg` one: it clamps
whatever a client asks for, so it needs no `valve.zip` rebuild and it also
covers players whose saved-settings snapshot replays an old `cl_updaterate`
over the shipped default. `cl_updaterate` was moved to 60 to match, but that
half is tidiness only.

Three suspects were measured and cleared, which is the more useful half of
the record: the WebRTC data channels are already `ordered=false` /
`maxRetransmits=0` (no head-of-line blocking to fix), `ex_interp` is already
0.1 which is the engine's own hard ceiling, and `yb_quota_mode fill` means
eight humans leaves two bots, so bot CPU was never in it. The internet path
itself is clean - 0% loss on a game-shaped UDP probe - and the box adds
0.66ms. Full numbers and method in docs/netcode.md.

**Follow-up the same day:** `sys_ticrate` 100 -> 200 as well. `sys_ticrate`,
not `fps_max`, is what governs the dedicated loop on this engine (fps_max 30
and fps_max 500 both moved the measured frame cadence by zero), and at 100 the
loop does not track its own target. Back-to-back six-client runs: p50 44 -> 39ms,
p95 53 -> 50ms, and - the surprise - CPU 39-45% -> 32-37% of a core. Running
the loop faster is cheaper than letting it undershoot. Combined with the
update-rate cap the final numbers are p50 39ms, p95 50ms, max 51ms against a
baseline of p50 45-48ms, p95 73-104ms, max 74-116ms.

**Second follow-up, same day:** `sys_ticrate` 200 -> 1000, after Ben asked
whether the league-standard "1000 fps server" would cause trouble here. Swept
100/200/250/300/400/450/500/1000/2000/10000 with a frame-counting plugin in a
throwaway container, and 200/500/1000/10000 against six real browser clients.

The loop never reaches 1000: it tops out near **425Hz**. But the target still
matters, because the engine busy-waits the gap between its ~2.3ms frame cost
and the ticrate period. That makes CPU against ticrate **non-monotonic** - it
peaks around 250 at 45% of a core and collapses to 9% once the period reaches
the frame cost. It also explains the earlier surprise that 200 was cheaper than
100. At the shipped 200 the loop was actually delivering ~120Hz with a 52ms
hitch at p99; at 1000 it delivers ~425Hz for half the CPU (31-41% -> 15-18% of
a core with six clients).

The honest half: **the ping column does not move.** Every value from 200 to
10000 sits inside the run-to-run noise, and a deliberate re-check at 200 run
last came back indistinguishable from 1000. The gain is simulation rate and CPU
headroom, not latency, and `sv_maxupdaterate 60` means the wire rate is
unchanged at 44-47 snapshots/sec per client throughout. 1000 is chosen over 500
only for margin above the ceiling; 10000 measures identically and buys nothing.

Also settled: a ping tail seen at ten headless clients (p95 96-117ms) is the
**harness**, not the box - engine CPU flat through it, server-to-client rate
collapsing while client-to-server held, and an independent UDP probe over the
same Mac uplink showing 60-170ms excursions on its own. Two clean ten-client
runs show p95 49-50ms, the same as six. Don't re-chase it.
## Rejoin after a crash: drop the ghost, then take the name back (2026-09-05)

`sv_timeout` is 600 for a good reason (backgrounded tabs freeze the game loop
and go network-silent), so a crashed player's old session keeps their slot AND
their name for up to ten minutes. They come back as `Reversons (1)`. The
scoreboard looks silly; the real damage is that `scripts/standings.py` and the
recap parser count by name, so one person becomes two with half the frags each.

`ff_rejoin.sma` ships in gg/dm/aim/css/fy/awp. On a join it looks for another
client with the same base name, drops it if it has gone quiet, then renames the
newcomer back to the base name.

**Matching on the name, and only the name, is forced.** Every browser client
reports the same `get_user_authid` (`ID_7dea362b...`, the hash of an absent
steamid), and `get_user_ip` is a per-connection address the Go/WebRTC layer
invents (always port 1000, different every join, not the player's real
address). Neither survives a reconnect. The full measurements are in
docs/troubleshooting.md.

**A live player with the same alias is protected by what they are doing, not by
who they are.** `FM_CmdStart` fires once per usercmd received, so a client that
is still there ticks ~60/s and a ghost's counter is frozen. Only a client
silent for `ff_rejoin_quiet` (10s) is eligible. Ping and packet loss are
useless here - a ghost's ping stays pinned at its last value and loss stays 0
for the whole ten minutes.

The case this cannot separate is a DIFFERENT person under the same alias who is
alt-tabbed at that instant - also silent, so they would be dropped to the lobby
with a Reconnect button. Aliases here are people's actual names, so that is a
trade worth making; `ff_rejoin_drop 0` over the cmdpipe turns the dropping off
live if it ever isn't.

**The suffix cannot be prevented, only undone.** The engine uniquifies the name
before AMXX gets a look in - at `client_connect` it is already `Reversons (1)`.
So the plugin drops the ghost first and puts the name back a beat later with
`set_user_info`.

**The kick is only safe where the gamedata override is.** `server_cmd("kick
#uid")` runs the engine's own `SV_DropClient`, which is exactly the function
AMXX detours and crashes on (2026-08-28). Every mod that ships this plugin also
ships the `fragfridays-sv-dropclient.txt` override that stops the detour
installing. Classic had been missing it since that fix - it has no build step,
so it kept the stock image's gamedata - so the root compose now mounts
`server/vanilla/gamedata` into its `common.games/custom/`. Classic still does
not run the plugin: its plugins live box-side at `/opt/cs16/mods/zp/plugins/`,
which `deploy.sh` never touches, so the compiled `.amxx` goes in by hand.

The log parsers fold `Name (1)` back to `Name` anyway (standings.py already
did; the recap parser now does too), because the plugin only helps from the
moment it ships and the archive is full of already-split sessions.

## The round restart left chat for the war room (2026-09-05)

`chatrestart.amxx` gave every player `!restart`, an unadmin-gated
`sv_restartround` - deliberately, because sessions run without admins and a
round can wedge (bots camped, an objective nobody can finish, someone stuck in
spectate) with nobody able to fix it. A 10-second ticker told anyone who had
been dead or spectating for two ticks to type it.

Reading the full log history on 2026-09-05 said what it was actually used for.
Of 90 round restarts, **one player accounted for 57, and 45 of those were
within a minute of joining**: they were dead, they wanted to spawn, and the
only verb anyone had ever advertised to them restarted the round for all ten
people. The nag is what taught it to them.

So the two needs were separated:

- **A player who wants to be back in the game** says `/spawn` (or `/respawn`,
  added the same day in `frag_dm.sma`). It respawns them alone, and the ticker
  now names it. Both moved into the plugin that owns the verb, because
  advertising a command from a plugin that might not be loaded beside it is
  how a note starts lying: `frag_dm.sma` on the DM five, and a second copy in
  `gungame.sma` for GunGame, which runs no `frag_dm.sma` at all. `/restart`
  survives as an alias of `/spawn` in both - the word is in players' fingers,
  and silence would teach nothing.
- **A round that genuinely needs resetting for everyone** is the war room's
  Restart round button (`POST /admin-api/restartround`), one rung below
  Restart server on the Console panel. Same `sv_restartround 1`, now behind
  the admin token, so the cost lands with the person who can see the whole
  server.

`chatrestart.sma` is deleted from all six mod images rather than left
registered with its command removed: what was left was the ticker, and the
ticker belongs next to `/spawn`.

A collision goes with it. GunGame's own `!restart` means "reset me to level
1" (`gungame.sma`, and its `!rules` console text says so), so on gg the two
plugins had been answering the same word with different things - a level
reset menu and a server-wide round restart, both at once. That is why gg's
`/spawn` takes every shape of the word EXCEPT `!restart`: bare, `/` and `.`
land on the respawn, and the `!` shape stays GunGame's level reset, which is
the one meaning a player can read for themselves in `!rules`.

Aim Prac got the same three pieces the same day. Its `frag_dm.sma` is an
older copy (no `split_cmd`, no alias table - it matches whole words), so the
prefix is stripped for these three verbs only rather than pulling the whole
normaliser back; the rest of that file staying a version behind is a separate
tidy-up.

**The last piece is a cvar, not a plugin.** `/spawn` deliberately refuses
anyone not on a team - writing a team segfaults this stack
(`teambalance.sma`) - so it tells them to press F1/F2 instead, and gg was the
one mod where the engine refused that: `aim/awp/css/dm/fy` all append
`mp_limitteams 0` + `mp_autoteambalance 0` to `amxx.cfg` from their
Dockerfiles, gg appended neither and `gungame.cfg` set `mp_autoteambalance 1`
back on. Both cvars now live in `gungame.cfg`, which is where they have to be:
`exec_gg_config_file` runs that file after `amxx.cfg`, so anything the
Dockerfile appended would have been overwritten. Without it gg's new nag ends
in a wall - "press F1 or F2" to a player the engine will not let press it.

## Classic split in two: ClassicAl and CPL Tournament (2026-09-05)

Classic was built as a tournament mode and it is a good one - `mp_startmoney
800`, MR15 halves, no map clock, no bots, `mp_fadetoblack 1`. Every one of
those numbers is sourced to a league rulebook in
[classic-rules.md](classic-rules.md), and none of them is wrong.

They are wrong for a Friday. Sessions here run in 30-minute blocks, people
arrive late, and the mode's three defining rules each work against that: no
map clock means one map for the whole block, $800 means the first three
rounds are pistols, and fade to black means a dead player spends most of the
block looking at nothing. That last one is what actually prompted this - Al
asked to be able to watch the round finish - and `classic-rules.md` had
already flagged it as "the rule most likely to read as 'the game is broken'
to someone who has only played the casual modes".

So the mode split rather than bent:

- **ClassicAl** (`classical`): the same rounds, the match rules off.
  `mp_fadetoblack 0` / `mp_forcecamera 0` / `mp_forcechasecam 0`,
  `mp_startmoney 16000` (the engine's ceiling), `mp_timelimit 10` with
  `mp_maxrounds 0` so a block sees three maps, `mp_freezetime 6`, and
  `yb_quota 10` so it is never empty. `mp_limitteams 0` is mechanical rather
  than taste: stock CS blocks joining the larger team, which locks a human
  out of a bot-filled server. Teams stay as people pick them - it is still
  Classic. Friendly fire went off and `mp_buytime` went to the engine's
  default 1.5 on the same day, once it was played: friendly fire is the match
  rule that punishes a crowded corridor, and with bots on both sides and
  everyone fully kitted the corridors here are crowded; 15 seconds to buy is
  a rule about buying under pressure, which just punished anyone who spawned
  in still reading the map.
- **CPL Tournament** (`cpl`): the old mode, byte-identical in behaviour,
  renamed so its name says which of the two it is. The name is the era it
  copies, and it sits next to a "CPL" column in the rules tables that means
  the league, so the tables in `classic-rules.md` still say "Classic" with a
  note at the top explaining the rename rather than being churned.

**ClassicAl is a built mod dir; CPL Tournament is not.** This is the more
interesting half. Classic runs the stock image unbuilt, which is why it has
no `teambalance` (its half-time swap is ten people rejoining by hand), no
`ff_rejoin` (a crashed player returns as `Name (1)`), and a pile of
hand-placed `.amxx` binaries in `/opt/cs16/mods/zp` that no part of `server/`
syncs - backlog items 16 and 17. Copying that shape for the new mode would
have copied the problem, so `server/classical/` was built from `server/fy/`
instead: its own Dockerfile, its own compiled plugins, its cvars baked into
`amxx.cfg` (which AMXX execs at every map start, unlike `server.cfg`), and
`PORT 27138`. Backlog item 16 now has a working example of what porting CPL
Tournament would look like.

It ships **no `frag_dm.amxx`**, which is the one thing to remember when
copying a mod dir for a round-based mode. That plugin forces instant respawn,
`mp_freezetime 0` and `mp_timelimit 10` from `plugin_init`, so it would
overwrite the ruleset on every map. Its absence also means no `/guns` and no
`/spawn` ticker here, which is correct: nothing respawns.

The rotation is CPL's seven plus `cs_office`, `cs_italy` and `cs_assault` -
maps no competition pool ever had, and exactly the kind of variety a 30-minute
block wants. All ten are already in another mod's `mapcycle.txt`, so the
`valve.zip` keep-list (the union of every rotation) is unchanged and this
needed no `clientcfg`.

Two things the rename touched that are worth knowing:

- `modOf()` in `server/mcp/src/exec.js` mapped **any** `cs16-*` container to
  `vanilla`, because the root compose project is the prefix and there was only
  ever one service in it. It now reads the service name out of the middle
  segment. Nothing was broken by this before; it would have been the moment a
  second root-compose profile existed, which is a second reason ClassicAl is a
  mod dir instead.
- `data/logs/vanilla/` keeps its name - it is the archive, and the recap
  parser's `MODES` keeps `"vanilla": "classic"` alongside the new `"cpl"` so
  old sessions still parse. `/opt/cs16/vanilla/` on the box is dead after the
  first deploy and has to be removed by hand: `deploy.sh` never deletes a
  directory it no longer knows about.
## Decals and blood back on: measured, the "cheap performance win" was not one (2026-09-05)

`userconfig.cfg` shipped `r_decals 0` / `mp_decals 0` in a block labelled cheap
performance wins. Ben asked for decals back and for blood as high as it goes.
Both are now on, `r_decals`/`mp_decals` at **4096**, and the four `violence_*`
cvars pinned at 1.

### Blood was never off, it just had nowhere to land

`violence_ablood`, `violence_hblood`, `violence_agibs`, `violence_hgibs` all
exist client-side and server-side and all four default to `1` - read back off
the engine console in the browser, and out of `cvarlist violence` in a
throwaway container. A symbol dump of the three client wasms finds no other
gore cvar, so there is no "excess blood" setting to turn on: GoldSrc never had
one. What there is instead is decals. With `r_decals 0` the server still sends
every blood effect and the client still draws the spray, but nothing sticks -
so "decals off" and "blood off" were the same switch, and turning decals on is
the whole of the fix.

### The two cvars are not redundant, and the naming is a trap

Ben's read was that the client-side `mp_decals` line was dead weight, since
`server.cfg` records `mp_decals` as absent from the game DLL. Server-side that
is true. Client-side it is exactly backwards, and the line was carrying the
whole setting: **the count the engine uses is `min(r_decals, mp_decals)`,
re-evaluated at every level load.** `mp_decals` is a ceiling. It pulled 1234
down to 777 across a `changelevel`, and it left 300 alone under a ceiling of
4096 - it never raises.

Which means the obvious edit - flip `r_decals 0` to `r_decals 4096` and leave
the other line - would have shipped **no decals at all**, with no warning
anywhere: `mp_decals 0` clamps it to nothing. It took seven runs to see that,
and only because a run that set both was compared against runs that set one.
Both lines now carry the same number and a comment saying why.

The same clamp is what makes a per-player control possible: a saved `r_decals`
sits under the shipped 4096 ceiling and survives every map change, so the
settings panel can reduce decals and can never raise them past what the server
config intends.

### Measurement: client frame rate, not server ping

Decals cost the browser's frame rate, not server CPU, so the server-side ping
column this repo usually reaches for cannot see this at all. Measured with a
headed-Chrome joiner (real GPU: ANGLE Metal on an M1 Pro, verified per run -
Playwright passes `--enable-unsafe-swiftshader` and a software rasteriser would
have made every number here fiction) against the live server on `fy_pool_day`
with ten bots, sampling rAF frame intervals for 60s windows.

Protocol per run: `changelevel fy_pool_day` for a clean decal pool, join, then
spin-and-hold-fire continuously for the whole run so the two windows differ
only in how much of the map is painted. Two passes, second in reverse order, to
bracket drift on the laptop rather than compound it.

The after-window - a map that has had five to seven minutes of ten bots and one
harness client painting it - is the number that matters. fps percentiles, so
higher is better, and p5 is the stutter a player feels:

| `r_decals` | pass | p50 | p5 | p1 | mean | worst frame |
|---|---|---|---|---|---|---|
| 0 (shipped) | 1 | 119 | 40.0 | 24.0 | 83.0 | 58ms |
| 0 (shipped) | 2 | 59.9 | 29.6 | 17.2 | **54.1** | 92ms |
| 300 | 1 | 119 | 57.8 | 39.7 | 92.5 | 58ms |
| 300 | 2 | 119 | 40.7 | 30.0 | 88.8 | 76ms |
| 4096 | 1 | 108.7 | 39.5 | 29.9 | 72.2 | 50ms |
| 4096 | 2 | 62.1 | 40.2 | 38.9 | 73.9 | 42ms |

**There is no decal cost to find.** The two runs with decals OFF are 54.1 and
83.0 mean fps - a 35% spread from the same settings twenty minutes apart - and
that spread is bigger than any gap between the three settings. Decals off
produced the single worst window of all six, and the worst single frame (92ms)
as well. p5, the stutter percentile, sits at 40fps in five of the six windows
regardless of what `r_decals` says.

So the honest answer to "what do the two values cost" is: nothing this
instrument can see, at either of them, on this machine. Ben can have the high
one, and the reason to prefer 4096 over 300 is that it looks better, not that
it was free - both were.

### Why the numbers are quoted as rAF frame intervals, and not the engine's own fps

The engine's `net_graph` prints its own fps, and it does **not** track the rAF
cadence: the same run reads 110 fps face-down on the floor and 32 fps looking
across an open room at two player models. That readout is one instant and it
moves with what is on screen far more than with anything being tested, so it is
useless as an A/B - three paired screenshots produced three contradictory
stories. The 60-second rAF windows (thousands of frames each) are the
instrument; the screenshots are kept only as visual proof that decals and blood
render at all.

Two honest caveats on the windows themselves. The "before" window is not a
clean map: by the time the client has booted, connected and settled, the bots
have already had roughly two minutes to paint, and at 300 the pool has long
since saturated. And the "before" window is consistently *worse* than "after"
in every run, which is the client still warming up rather than decals being
free - which is another way of saying the first two minutes of a player's
session are the expensive part, not the decals.

### And a control on the settings page, because one laptop is not every laptop

Every number above came off one M1 Pro. "No measurable cost here" is not the
same as "no cost on the five-year-old work laptop somebody joins from", and
decals are the most visible looks-versus-speed dial in the game, so the
settings page gets a three-chip control: off / some / full, `r_decals` at
0 / 300 / 4096, defaulting to the shipped 4096.

It works because of the clamp, not in spite of it. `setSavedCvar` writes into
the localStorage snapshot, the boot replay applies it before `connect`, and the
shipped `mp_decals 4096` ceiling leaves every one of those values untouched -
verified end to end, including that 300 survives a `changelevel`. A player can
turn decals down and never up, which is the right direction for a control whose
whole point is buying frames back.

`cl_shadows` and `r_dynamic` are the same family and could join it later; they
are left alone here to keep the diff on a contended file small.

### What has to happen for any of this to reach players

`userconfig.cfg` is baked into valve.zip: `pnpm run clientcfg`, and players
hard-refresh. Nothing here is server-side, so no mod rebuild and no restart -
and equally, no amount of `pnpm run rc` will deliver it.

## Digital vibrance: a CSS filter on the canvas, on a slider (2026-09-05)

"Digital vibrance" is an NVIDIA control-panel setting, not a game one. There is
no cvar for it and there never was - it is a saturation boost the display
driver applies after the game has finished drawing, and 1.6 players have run it
at 60-100% since the CPL era because the maps are sand and concrete and so are
the player models.

The engine draws into a canvas element in a web page here, so the page can do
the driver's old job: `filter: saturate(N)` on `#canvas`, driven by a
`--ff-vibrance` custom property that `Vibrance.tsx` writes on the root element.
Same operation at the same point in the pipeline - on the composited output, on
the GPU, after the frame is drawn and before it is presented. The engine is
never told.

**It costs nothing, measured.** In a live match the number is useless: on this
Mac the display is 120Hz ProMotion, so with vsync on every frame gap quantises
to 120/n and a one-millisecond difference cannot appear at all; with vsync off
(`--disable-gpu-vsync --disable-frame-rate-limit`) the game's own variance -
respawns, bots in view, a round ending, the wasm engine on CPU - swamps it, and
three runs put filter-on above filter-off about as often as below. So the
question was asked again with the game taken out of it: a WebGL canvas laid out
exactly like the engine's (`#canvas`, fixed, 100vw/100vh, 2560x1720 drawing
buffer), GPU-bound at ~53fps, vsync off, filter-off and filter-on blocks
interleaved five times. Median frame 18.7ms in every condition - off,
`saturate(1.2)` and `saturate(1.6)` alike - and the slow tail (fps p5) 51.8 off
against 52.6 and 52.4 filtered, i.e. the filtered runs were marginally *faster*,
which is the shape of noise, not of a cost. A compositor colour matrix on a
surface that is already being composited is free.

**`saturate()`, not a colour matrix.** NVIDIA's dial is a chroma gain in a
YCbCr-ish space, which is an `feColorMatrix` with Rec.601 luma weights; CSS
`saturate()` is the same operation with Rec.709 weights. Both were run over a
real fy_pool_day frame at +20% and differ by a mean of 0.31 of 255 per channel,
max 6 - invisible, and `saturate()` is one browser-native primitive with no SVG
filter element to keep alive in the DOM. `contrast()` was tried alongside it and
dropped: it darkens the corners these maps are already full of, which is the
opposite of the point. Clipping, the usual charge against naive saturation, does
not bite at the shipped strength either - 0.49% of that frame already clips at
off, 0.53% at +20%, and it only reaches 1.55% at the top of the slider.

**A slider, not a fixed default**, for the same reason NVIDIA made it one: it
depends on the monitor and on taste. 1.0 (off) to 1.8, shown as the boost
("+20%") rather than the multiplier, because +20% is the number anyone who ever
opened that control panel already has in their head. Shipped at +20%.

**It is not a cvar, so it does not live in `CONTROLS`.** Everything in that array
is a cfg line that replays into the engine console on the next boot, and the
saved-override chips are that diff made visible. A page-level display setting
replayed there would be an unknown command every session and a chip nobody could
explain, so it gets its own `ff-vibrance` localStorage key and renders its own
tile. The tile still shows `tweak--set` when it is off the default; "clear all"
deliberately does not touch it, because that button clears what the engine will
be told and this is never told to the engine.

**The filter goes on the canvas ELEMENT, never on a parent.** The lobby overlay,
the tab scoreboard and the match menu are sibling page elements drawn over the
canvas, and a filter one level up would saturate those too. Checked, not
assumed: computed `filter` is `none` on `#root`, `body`, `html`, `.overlay` and
`.page` with the dial at maximum, and in a live match at `saturate(4)` - far past
anything the slider offers - the match menu's opaque chrome is pixel-identical to
the unfiltered shot, zero differing channels over the whole Resume button. Where
those overlays are deliberately translucent (`.tabscreen__panel` at 0.93 alpha,
`.pause` at 0.82, both with a backdrop blur) they do show the boosted match
through them, which is what they are for; at the shipped +20% the filter moves a
real frame by a mean of 1.64 of 255, so at 93% opacity the scoreboard can pick up
about a tenth of one level.

Because the rule lives in the stylesheet keyed on `#canvas` rather than as an
inline style, it also survives anything that replaces the element, and fullscreen
is requested on the document element, so no fullscreen path can drop it.

## The two map-overview spectator modes are gone (2026-09-05)

Spectating, the jump key cycles the camera, and CS's own ring ends with two
top-down radar views - Free Map Overview and Chase Map Overview. Both draw
`cstrike/overviews/<map>.bmp` as their backdrop, and when the client has no
overview for the map, cs16-client falls back to a bare green grid on black.
Confirmed live with a browser client: fy_desert (ships an overview) renders the
map image with player icons, fy_iceworld (none) renders black, and the client
says so on connect - "Couldn't open file overviews/fy_iceworld.txt. Using
default values for overview mode."

Only stock CS maps ship overviews. Sixteen of the thirty maps across our
rotations have none: all three awp maps, five of six css, four of six fy, plus
aim_map, scoutzknivez, cs_prospeedball, cs_deagle5 and fy_pool_day in dm and gg.
The community maps we added brought their own only by luck (de_rats, fy_desert,
fy_nuketown, de_bank_csgo).

Two ways out: generate the sixteen missing overview images, or drop the modes.
Dropped them. Generating them is a per-map job for a camera angle almost nobody
uses on maps you can see end to end from the floor, and every one would then have
to ride valve.zip.

There is no cvar for this - the mode ring is hardcoded in the game dll's
`Observer_HandleButtons` - so it is a plugin, `ff_specmode.amxx`, in every mod
that has a plugins.ini (cpl runs the stock image, and its rotation is all stock
maps, so it keeps them and does not need it). It hooks `PlayerPreThink` POST,
which lands in the same frame the dll moved the mode, and rewrites an overview
mode to Free Chase before the client is ever told. It also relabels the dll's
own centre-screen announce, which is sent earlier in that same frame and would
otherwise read "Free Overview" over a chase cam.

The cost is that the overview also disappears on the maps where it worked - all
of aim, classical and cpl, most of dm and gg. If the missing images ever get
made, delete the plugin rather than teaching it which maps have one: containers
mount only `cs/cstrike/maps`, so a server-side file check cannot see the
client-only overviews that ride the `server/custom/` overlay.

## Dead players land in their killer's eyes (2026-09-05)

Stock, the camera you settle in when you die is the free-fly one, and it takes
five seconds to get there. Measured in a throwaway `classical` container with a
probe plugin logging every `iuser1` transition:

```
t+0.00s  DeathMsg, same frame iuser1 0 -> 2 (CHASE_FREE), iuser2 = your own body
t+4.5s   iuser1 2 -> 3 (ROAMING), the mode you are actually left in
```

The chase cam is only the death-cam moment on the way through. The 4.5s step is
`StartObserver` calling `Observer_SetMode(m_iObserverLastMode)`, and
`m_iObserverLastMode` starts life as ROAMING - which is also why the game
remembers a mode you picked yourself and reuses it next death.

Free-fly is the worst of the four for a dead player who just wants to watch the
round out: you are a camera in an empty corridor, and finding the fight is a
job. First person through the player who just killed you is the one that reads
as spectating and answers the question you actually have, so `ff_specmode.amxx`
(v0.2.0, same plugin as the overview fix above) pins mode to `OBS_IN_EYE` and
target to the killer, from the frame you die until you touch the cycle.

Three things that shape it:

- **It has to run every frame, not once on death.** The dll's own switch to
  ROAMING lands 4.5 seconds later and would take the camera straight back.
- **The first jump press hands the camera back for good** - that death and
  every death after it, tracked per player for the session. The dll already
  remembers a chosen mode, so forcing first person over the top of one every
  death would be the more annoying bug. The spectator menu's `specmode` command
  counts as the same choice.
- **The target is set every frame too, not just the mode.** The dll's own
  target at the death frame is the victim's own body, it clears it to 0 at the
  ROAMING step, and it moves you off any target that dies - so re-asserting the
  killer is what keeps you there. When the killer dies, disconnects or the death
  had none (a suicide, the world), it falls back to the dll's target if that is
  alive and then to anyone alive, and forgets the killer rather than snapping
  back to them when they respawn.

Verified on the rig with bots: every death re-aims to the killer in the same
frame (`mode=2->4 target=<self>-><killer>`), the 4.5s step is caught
(`mode=3->4 target=0-><killer>`), it holds until the killer dies and then hands
over to the fallback. Kill switch `ff_specmode_eye 0`. In the dm-family mods
this is a sub-second blip - `dm_spawn_delay` is 0.75 - so it only really shows
in `classical`, where you are dead until the round ends.

## Chat lives on the tab screen now, because it lived nowhere (2026-09-05)

Chat in this build goes one way and stops. Measured live against the classical
mod with a real browser client: three spectator `say`s, an `amx_psay` and two
`amx_say`s all reached the server - they are in the mod's own log - and not one
of them came back anywhere a player could see. Not the HUD, not the engine's
stdout, with `hud_saytext 1` and `hud_saytext_time 5`. Death notices DO print
to stdout (that is the kill feed, and it is how the engine's own feed reaches
the JS console), so this is specific to SayText.

That reframes the panel. It is not a nicer skin on the engine's chat; on this
client it is the only chat there is. Typing still works - Y still opens the say
prompt and the message still reaches everyone server-side - so the missing half
was only ever the reading.

**The feed is the server's, not the client's**, and that follows from the
above: there is no client-side stream to intercept. It also buys structured
fields instead of regexing localised HUD prose, which is what a kill feed built
off the console stream would have to do. statusjson 0.3.0 carries the last 20
lines in the file the scoreboard already polls every second.

**Captured with clcmd hooks on say/say_team**, not `register_message(SayText)`.
The clcmd fires once per message with the sender known; SayText fires once per
RECIPIENT, so every line arrives N times and carries a localisation token
rather than text. The trade is that admin `amx_say` and plugin announcements
are not client says and so never appear, which is the right side of the trade
for a panel whose job is "what did people say".

**Chat commands are skipped.** `/guns` and `!something` are answered and
swallowed by another plugin, so they never reach anyone else's screen; showing
them would put a conversation in the panel that did not happen.

**The freeze this shook out is the part worth remembering.** The panel adds
~3.5em of chrome to the tab screen's fit measurement, which put a common window
size onto a boundary where the two briefing dressings - two columns when
stacked, one when paged - differ by more than the 3em hysteresis band. The
effect then flipped `paged` forever: no error, no console line, just a renderer
pinned at 100% that never painted again, which reads exactly like a hung tab.
The dead band was always the mitigation for a one-line difference; it was never
enough for a bistable one. There is now a settle guard that stops the flipping
after four changes of mind and lands on paged, which fits by construction
because each page is measured on its own, and resets only when the frame really
changes size - the one input that is not downstream of the answer.

Next, if it is wanted: the kill feed. That one CAN come off the engine's stdout
(`launch.ts` already routes every engine line through `noteEngineLine`), or ride
the same `events` array for structured fields. `hud_deathnotice_time 0` retires
the engine's version once something draws it.
