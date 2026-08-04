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
