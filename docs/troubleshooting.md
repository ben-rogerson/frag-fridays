# Troubleshooting and known gotchas

Diagnostic reference. Every entry here was learned the hard way.

## The overarching theme: silent failure

This stack fails quietly. A plugin not listed in `plugins.ini` loads nothing
and logs nothing useful. A bind-mount over an empty host directory masks the
image's own files. The wrong container answers on the right port. Almost
every debugging session came down to **verify, don't assume**:

- `docker ps` - is the container you think is running actually running?
- `amx_plugins` (in-game/console) - did the plugin actually load?
- Check the archive root - is `valve.zip` structured correctly?

**Live server console: `pnpm run rc "<command>"`** (e.g. `pnpm run rc
"changelevel de_dust2"`). There is no rcon (this build answers no A2S/rcon
UDP queries) and stdin is closed, so the `cmdpipe.amxx` plugin (gg + dm, not
vanilla) polls a compose-mounted file `/opt/cs16/cmdpipe/cmd.txt` once a
second and executes new lines in the server console. `scripts/rc.sh` bumps
the serial on line 1 and replaces the file atomically; the plugin swallows
the current serial on load so restarts/map changes never replay a command.
Output comes back via `docker logs` (rc.sh tails it, but slow output like a
map load can outrun the 5s window - re-check with `pnpm run logs`).

To interrogate a mod's console *offline* (image not deployed yet), boot a
throwaway copy with stdin piped:

```bash
( sleep 10; echo "amxx plugins"; sleep 2; echo "quit" ) | \
  docker run -i --rm --platform linux/386 dm-xash3d:latest +map de_dust2 +maxplayers 4 \
  2>&1 | grep -aiE "bad load|running|plugins,"
```

This is how the CSDM failure below was diagnosed. Note `grep -a`: some
upstream sources (gungame.sma) are ISO-8859 + CRLF and macOS grep silently
treats them as binary - another silent failure.

## Team select menu does not render

The browser build never shows the team select menu. Players sit unassigned.

- Fix: F1/F2 join binds shipped via `userconfig.cfg` inside `valve.zip`, or
  console fallback `jointeam 1` then `joinclass 1`.
- `mp_autoteambalance` does NOT solve this - it rebalances existing teams, it
  does not assign unassigned players.

## No lazy loading - valve.zip size = load time

The entire game filesystem loads into browser RAM on first join. Every custom
asset (maps, sounds, models, sprays) added to `valve.zip` increases load time
for **every player, every first load**. This is the main constraint on mod
and map selection. Measure the size cost before bundling anything.

## valve.zip root structure

The archive root must contain **only** `valve/` and `cstrike/`. Nesting them
under an extra directory is the most common boot failure. If the server won't
boot after a rebuild, check the archive root first.

## Web client changes break the live site until the container restarts

`index.html` is a single-file bind mount (inode rule, same as valve.zip),
but `web/assets/` is a directory mount. A file-only `pnpm run deploy` after
a web change therefore HALF-applies: the container keeps serving the stale
`index.html` (old inode) while rsync `--delete` has already removed the old
hashed JS bundle it references from `assets/` - fresh page loads 404 on the
bundle and the site is blank until the container restarts (2026-08-03).
After any `apps/web` change, restart the running mod (players drop) or ship
it alongside a `pnpm run deploy <mod>` / `pnpm run clientcfg` that restarts
anyway. Emergency no-drop fix: overwrite the stale inode through the
container's mount namespace:

```bash
ssh cs16 'PID=$(docker inspect -f "{{.State.Pid}}" dm-xash3d-1) && \
  nsenter -t "$PID" -m sh -c "mount -o remount,rw,bind /xashds/public/index.html && \
  cat > /xashds/public/index.html && \
  mount -o remount,ro,bind /xashds/public/index.html" < /opt/cs16/web/index.html'
```

## The restart:always port-theft incident

The vanilla container had `restart: always` and silently reclaimed port
27016 after a host reboot. The "GunGame" server was actually vanilla - the
two look identical from the browser.

- Use `restart: unless-stopped` in every compose file.
- Always confirm with `docker ps` before announcing a session.

## Unknown cvars are silently ignored

Not all cvars exist in this WASM build (`cl_himodels` and `v_dark` are
reported unknown). Unknown cvars are ignored harmlessly - but that means you
cannot assume a setting took effect. Verify in console.

## Mobile browsers do not work

Text input isn't real HTML input, so console and chat are unusable. Laptop
only. Not fixable at our level.

## plugins.ini vs modules.ini

Two different registration files, and a third that belongs to Metamod:

- **AMXX plugins** (`.amxx` files): a plugin in `addons/amxmodx/plugins/`
  does **nothing** unless listed in `configs/plugins.ini`. No error, no log -
  a silent no-op. This caused a wasted debugging session.
- **AMXX modules** (`.so` files, e.g. CSDM's `csdm_amxx_i386.so`): register
  in `configs/modules.ini`, not `plugins.ini`. The GunGame Dockerfile pattern
  (which appends to `plugins.ini`) does not transfer unchanged to
  module-based mods.
- **Metamod plugins** (e.g. YaPB bots): register in **Metamod's** own
  `plugins.ini`, a different file from AMXX's.

## ReAPI incompatibility

The stack is **Xash3D-FWGS + Metamod-P + AMX Mod X 1.9**. It is NOT
ReHLDS/ReGameDLL/ReAPI. Any mod or plugin requiring ReAPI natives (ReGG,
ReZombiePlague, ReDeathmatch, and many other modern mods) **will not work**.
All plugins must be classic Metamod-P/AMXX-era. Check for ReAPI dependency
before spending any time on a candidate mod.

## Binary modules that sig-scan the game DLL do not work (CSDM)

A subtler cousin of the ReAPI problem, found 2026-08-02. CSDM's
`csdm_amxx_i386.so` loads and reports `running` in both `meta list` and
`amxx modules` - but it locates its gameplay hooks by **binary signature
scanning** the original `cs_i386.so` (its strings contain
`"Sig line %d (%s) failed"`). This stack's cstrike DLL is a reimplementation,
so the scan fails **silently**: the module registers its config natives
(`csdm_get_ffa`, `csdm_reg_cfg`) but never the gameplay ones (`csdm_active`,
`csdm_respawn`, `csdm_trace_hull`), and every CSDM plugin dies with
`Plugin uses an unknown function ... check your modules.ini` - which points
at entirely the wrong cause. Recompiling the plugins from source changes
nothing; the natives simply do not exist at runtime.

Rule of thumb: **script-only plugins using Ham/fakemeta work** (GunGame
proves the whole surface: `Ham_Spawn`, `Ham_CS_RoundRespawn`, entity
give/strip, `cs_set_user_*`). **Binary modules that peek inside the game DLL
fail.** Deathmatch is therefore a from-scratch script plugin
(`dm/addons/amxmodx/scripting/frag_dm.sma`), not CSDM.

The refinement, from YaPB working first try: what matters is *how* the
binary hooks in. YaPB is a Metamod plugin coded against engine interfaces
with explicit Xash3D support and logs
`Counter-Strike v1.6 @ Xash3D Engine` - fine. CSDM pattern-matches bytes
inside the game DLL - dead. Before adopting anything with a `.so`, ask which
kind it is, and prefer projects that name Xash3D in their compatibility
list.

## Client sound errors: check for unshipped sound references

Anything server-side that tells clients to play a sound must have that wav
inside valve.zip, or every trigger throws a client sound error. First
occurrence (2026-08-02): YaPB's default `yb_radio_mode 2` uses its voice
chatter pack (`sound/radio/bot/`), which was never bundled - fixed by
`yb_radio_mode 1` (stock radio sounds only, all shipped). Audit recipe:
extract configured sound paths (`grep -aoE '"sound/[^"]+\.wav"'` on the
configs) and check each against `unzip -Z1` of the zip. Custom maps can also
embed `ambient_generic` references - not covered by the texture/sky
dependency check.

## Steam account verification (SteamCMD)

SteamCMD from a new datacentre IP triggers Steam verification, and a wrong
answer locks sign-in. Correct answers: "Steam client" (SteamCMD *is* the
Steam client) and "Other". See [setup.md](setup.md) for the full context.

## uname -m false alarm

`uname -m` inside a `--platform linux/386` container reports `x86_64`. Not a
fault - it reports the kernel arch. Correct check:
`docker image inspect i386/alpine --format '{{.Architecture}}'` -> `386`.

## Menus truncate at ~175 characters in the browser client

GoldSrc splits long `show_menu` text into multi-part ShowMenu messages; the
browser client doesn't reassemble them, so anything past ~175 characters is
silently cut off. First occurrence (2026-08-03): the GunGame welcome menu's
last line rendered as `Chat commands: !gu` - a player duly typed `!gu`.
Budget menu text (all lines + colour codes + "press key" footer) under 175
chars total, and keep player-facing hints in chat (`client_print`) where
there is no such limit.

## `exec` is a no-op in the browser client

The wasm client's `exec <file>.cfg` opens and reads the file (visible via an
FS.open trace) but its contents never execute - the command buffer never
pumps them. The same applies at boot: a `config.cfg` written into the FS
before `main()` is ignored, so players always started from compiled-in cvar
defaults. Direct `Cmd_ExecuteString` calls DO work, so settings persistence
(2026-08-03) replays the saved `config.cfg` line-by-line instead of exec'ing
it (`apps/web/src/launch.ts`). If a future feature needs to run a cfg file
client-side, feed it through `Cmd_ExecuteString` per line.

Debug aid: the client exposes the live engine as `window.__xash` in
devtools - `__xash.Cmd_ExecuteString(...)`, `__xash.em.FS.readFile(...)`.
Engine console output does not reach the browser console, and `waitLog`/
`getCVar` promises never settle because no log lines flow at runtime;
verify cvar state with `host_writeconfig` + reading back
`/rodir/cstrike/config.cfg`.

## server.cfg execs ONCE; amxx.cfg execs every map (2026-09-04)

Long assumed the other way round in this repo, and it cost Classic its whole
ruleset for a month. Measured in a throwaway container:

| File | When it runs |
|---|---|
| compose `command:` `+cvars` | container start, first |
| `cstrike/server.cfg` | container start, straight after. **Not on changelevel.** |
| `addons/amxmodx/configs/amxx.cfg` | **every map start**, AMXX does it itself |
| `addons/amxmodx/configs/maps/<map>.cfg` | every map start, after amxx.cfg |

Two consequences, both of which have bitten:

- **Anything in `amxx.cfg` beats `server.cfg` permanently.** On the first map
  it wins by running later; on every map after that it wins by running at all.
  Classic's box-side `amxx.cfg` held casual round values that outranked the
  `server.cfg` in this repo for the life of every container.
- **A cvar changed live persists until the container restarts**, because
  nothing re-reads `server.cfg`. If you want a config re-asserted per map, it
  has to be reachable from `amxx.cfg`.

Server-side `exec` DOES work (unlike the browser client's - see above), so
`server/vanilla/amxx.cfg` ends with `exec server.cfg`: one file holds the
ruleset and it is re-applied every map. Verified by setting `mp_roundtime 5`
live, changing map, and reading `1.75` back.

Side effect worth knowing before you think the logger is broken: `server.cfg`
ends with `log on`, and re-running that closes the current kill log and opens
a new one, so a mod doing this writes **two `L*.log` files per map** - cvar
dump in the first, rounds and kills in the second. `standings.sh` cats every
`L*.log` in filename order, so nothing is lost.

How to check exec order yourself: `docker logs <c> | grep -c "Executing AMX"`
counts amxx.cfg runs, and a cvar you set live and then read back after a
`changelevel` tells you whether server.cfg ran again.

## Base image must stay pinned - and signalling dialects differ across tags

`yohimik/cs-web-server-metpamx:0.1.3` (tagged `latest` since 2026-08-02)
changed the websocket signalling protocol: the embedded Go server sends
`["v1:offer", {...}]` / `["v1:candidate", {...}]` JSON arrays instead of
0.1.2's `{"event": "offer", "data": {...}}` objects, and expects
`["v1:answer", ...]` back. A client speaking the wrong dialect silently
ignores every message - players hang forever at "starting engine,
connecting to server…" while the page, valve.zip download, bots, and
cmdpipe all look perfectly healthy. Found 2026-08-19 when a routine
`pnpm run swap gg` rebuilt the image: BuildKit re-resolves
`FROM ...:latest` from the registry on every build, so the rebuild
swallowed the new base even though nothing in the repo changed.

Resolution (same day): `apps/web/src/webrtc.ts` now speaks BOTH dialects -
it adopts whichever one the server's first message uses - and every
Dockerfile plus `server/docker-compose.yml` is pinned to an explicit tag
(`0.1.3`). Keep the pin explicit forever; never `latest`. Server-side
quirk worth knowing: the 0.1.3 Go server re-offers up to 5 times per
connection by design (`signalsCount` in its webrtc.go) - repeated
`v1:offer` messages are normal, not an error loop. Its logs are also
near-silent about webrtc sessions even at LOG_LEVEL=debug; absence of
"websocket" errors means healthy, not absent traffic.

Diagnosis recipes that found it: inject a main-world `<script>` wrapping
`window.WebSocket`/`RTCPeerConnection` to log raw messages (the extension
JS tool runs in an isolated world - page globals like `__xash` are
invisible and hooks from there never reach page code; write findings into
`document.documentElement.dataset` to read them back across worlds). To
bisect client vs server, boot a throwaway base image with the STOCK client
on alt ports (`-e PORT=27028 -e IP=... -p 27026:27016 -p 27028:27028/udp`,
mount `/opt/cs16/valve.zip` in - without it the stock client dies on a
placeholder zip). And when a headless/automation tab "fails to connect" at
the game level with a healthy transport: check `document.hidden` FIRST -
Chrome freezes rAF in hidden tabs, the engine loop stops, and connect
packets (sent from the frame loop, not the `connect` command itself) never
leave. Only a visible tab is a valid end-to-end test - or shim the frame
loop from the isolated world before clicking connect (works because
emscripten looks up `window.requestAnimationFrame` at call time):

```js
const s = document.createElement('script')
s.textContent = `window.requestAnimationFrame = cb =>
  setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = id => clearTimeout(id);`
document.documentElement.appendChild(s)
```

Verified 2026-08-20: with the shim a fully hidden automation tab boots,
connects, and shows up as a human on the server scoreboard - `pnpm run
status`-level proof without a visible window.

## Saved-settings snapshot replays OVER shipped userconfig defaults

The localStorage snapshot (`ff-settings-v2`, see launch.ts) replays a
player's deliberate cvar diffs after every boot - which means changing a
default in userconfig.cfg does NOT reach players who ever changed that
cvar themselves: their old value replays over the new shipped one.
Testing has the same trap in reverse: cvars poked during a debugging
session get persisted as "deliberate" diffs and survive into later
sessions, so a fresh boot shows YOUR old experiments, not the shipped
defaults (bit us 2026-08-21 shipping the hud-scale revert).

Cleaning the snapshot has an ordering trap: persistSettings runs on page
unload, so localStorage edits made while a session is live get
overwritten when that page unloads. Set the live cvars back to the
shipped values FIRST (then the diff is empty), and only then clean
`ff-settings-v2` - or do the cleanup with no game session open.

## A war-room map change stranded everyone on the loading screen (2026-09-04)

Reported as "I changed the level through the admin area and it hung on the
loading screen with no indication it was loading or going to load. To fix it
I had to restart the server." Six or seven people on. It happened TWICE in
one session, fifteen minutes apart.

**The server was never wedged.** That is the whole trap here, and every
instinct points the other way. There is no `Host_Error`, no `MAX_MODELS`, no
`bad entity number`, no `Server was killed due to an error` anywhere in the
container's logs for that day; no core dump; nothing in
`/opt/cs16/logs/sim-watchdog.log`. The changelevel ran perfectly - the log has
a clean `Spawn Server` a second after each button press, the sim kept ticking,
the bots kept playing, `status.json` kept updating, and `cmdpipe` kept
executing commands (proved by the NEXT admin command running fine).

What actually failed is the CLIENTS' half of the level change:

    03:34:03  cmdpipe #522: amx_csay green Changing map to fy_iceworld...
    03:34:03  cmdpipe #522: changelevel fy_iceworld
    03:34:03  Spawn Server: fy_iceworld []
    03:34:04  "_vicentEYyyo<129>" connected     <- all 8 carried over...
    03:34:04  "ZenBot<130>" connected
    03:34:04  ... six more ...
              (no "entered the game", ever, for any of them)
    03:34:13  Maximum players reached (16/16). Unable to create Bot.
    03:34:18  websocket: close 1001 (going away)   <- players reloading
    03:34:22  websocket: close 1001 (going away)
    ...

Read the diff against a HEALTHY changelevel (a rotation one, 04:11:41, seven
humans, same session, same container):

    04:11:41  "_vicentEYyyo<36>" connected
    04:11:42  Custom resource propagation complete.
    04:11:42  "_vicentEYyyo<36>" entered the game     <- 1 second

**`Custom resource propagation complete.` is the marker.** It is printed once
per client, at the end of the engine's per-client resource/consistency
handshake, immediately before `entered the game`. It appears 56 times in that
day's log and never once after either failed change. So the clients got as far
as `SV_ConnectClient` on the new map and then stopped dead in the resource
handshake - which on the player's screen is a loading screen that never ends,
with a server that is demonstrably alive.

**Why a restart was the only way out**, and this is the part that turned a
stall into a stranded session: **the bots got to the new map before the
humans**. Put the two windows side by side and it is the whole story.

    FAILED  03:34:03 fy_iceworld (8 humans)
      03:34:10-13  eight [BOT] ... "entered the game"      <- bots first
      03:34:13     Maximum players reached (16/16)
                   (no human ever reaches "entered the game")
      03:34:18-27  five websocket close 1001 - reloads, into a full server

    HEALTHY 04:11:41 de_dust2 (7 humans, rotation)
      04:11:42-43  seven "Custom resource propagation complete" + entered
      04:11:46-48  then bots fill the remainder                <- humans first
      04:11:49+    "Bot ... kicked" as more humans arrive

The stalled clients still hold their slots for the full `sv_timeout` (600s),
and YaPB filled everything left within ten seconds - `Maximum players reached
(16/16)`, a line that appears exactly twice in the whole day and both times
right here. Eight zombie humans plus eight bots is a full server, so every
player who reloaded in frustration (that is what the `close 1001 (going away)`
burst is) was refused. On a healthy change the humans reclaim their slots in
one to two seconds and YaPB fills what is left, then keeps kicking bots as
more arrive. **Whatever made the carry-over slow, only the bots made it
unrecoverable.**

The config made that inevitable. Every 16-player mod shipped
`yb_autovacate_keep_slots "1"` - one reserved slot out of sixteen, which
cannot absorb a session's worth of people coming back at once - and
`yb_join_delay "5.0"`, so bots start claiming slots five seconds after the
map spawns. It gets WORSE the more people are playing, which is the wrong way
round for an event.

There is a no-restart escape from the lockout, worth knowing but not worth
preferring: the war room's "Clear all bots" (`yb_quota 0` + `yb kickall`)
frees every bot slot, so reloading players can get back in while the zombie
human slots age out on their own. It leaves an empty-feeling server for a
minute and does nothing about the stalled clients themselves. A restart is
faster and cleaner, and it is what the failure message says.

**A trap worth knowing while reading any of this:** `yb_quota` and
`yb_autovacate` are listed in `yb_ignore_cvars_on_changelevel`, so a quota
poked at runtime (the war room's Bots panel, or an MCP call) **survives every
changelevel and is never re-read from yapb.cfg** - only a container restart
puts the file's value back. Verified 2026-09-04: a runtime `yb_quota 6` came
through a changelevel as 6.

**With one exception, and it is a useful one.** A quota of ZERO is not
protected. `config.cpp` carries a special case (`// preserve quota number if
it's zero`) that lets the config's value through when the live quota is `<= 0`
- verified the same way, `yb_quota 0` came back as the config's value after a
changelevel. So clearing the bots is self-healing: it opens the server now and
the next map change puts the bots back on its own.

The two cvars changed below are deliberately NOT in the ignore list, so their
file values ARE re-applied at every map change, which is exactly the moment
they matter.

**What was different about the failed changes.** They are the only two
changelevels of the day issued from the war room's map button, and the war
room was the only path that wrote the warning and the changelevel as ONE
cmdpipe write. `cmdpipe.amxx` runs every line of a write in the same
`task_poll` frame and calls `server_exec()`, so `amx_csay` broadcast a HUD
message to all sixteen clients and `changelevel` tore the level down inside
that same frame. Two other differences ride along and are NOT excluded by the
evidence: the rotation changelevel goes through intermission first (ten quiet
seconds with the pipe empty) while an admin one is immediate, and both
failures had eight clients where the two admin changes that worked that day
had one. `scripts/nextmap.sh` has always done the warn and the change as two
writes five seconds apart and has never done this.

**Changed 2026-09-04.** Only the first of these is a candidate cure for the
stall itself; the rest make the stall survivable whichever of the three
differences turns out to have caused it. The bot-slot changes are the ones
that matter most - they are what turns "restart the server" into "that map
took a while".

- `server/mcp/src/actions.js` `changeMap()` warns and changes as two separate
  pipe writes 4s apart, back to nextmap.sh's shape.
- **`yb_join_delay "5.0"` -> `"20.0"`** in every mod's `addons/yapb/conf/`
  `yapb.cfg` (gg, dm, css, fy, awp AND aim). This is the ordering fix: bots do
  not start claiming slots until 20s after the map spawns, so a carry-over
  that takes longer than a second or two is no longer a race the humans lose.
  YaPB's own max for this cvar is 30.
- **`yb_autovacate_keep_slots "1"` -> `"4"`** in the five 16-player `fill`
  mods, and the war room's bot fill stops at `maxplayers - 4` rather than the
  last slot. **Read the section below before trusting either of these against
  this failure mode** - they are headroom for players the server can see, not
  the map-change guard, and the first version of this entry claimed otherwise.
  `aim` is deliberately left alone here - it runs `maxplayers 24` with a fixed
  16 bots and `yb_autovacate "0"`, so it already keeps 8 slots free by
  arithmetic, and switching autovacate on would change how many bots an aim
  session runs. It still gets the join delay.
- **`changeMap()` clears the bots when it catches the lockout.** Having
  detected `humansBefore > 0 && humansAfter === 0` it sends `yb_quota 0` +
  `yb kickall` before it reports the failure, which frees every slot the
  stalled clients are not themselves holding so the players' own reloads land.
  This is the only repair here that does not depend on YaPB's arithmetic, and
  it costs nothing to leave behind: a zero quota is the one value the ignore
  list does not protect, so the next map change puts the bots back by itself.

### What `yb_autovacate_keep_slots` actually reserves against (measured 2026-09-04)

Settled on the box, because the guard above was built on an assumption. From
YaPB 4.4.957 `src/manager.cpp`, `BotManager::maintainQuota`:

    desiredBotCount = cr::min (desiredBotCount,
       maxClients - (totalHumansInGame + cv_autovacate_keep_slots.as <int> ()));

`totalHumansInGame` is `getHumansCount()`, which counts clients carrying
`ClientFlags::Used` - set in `BotSupport::updateClients` only for entities with
`FL_CLIENT` set and `FL_DORMANT` clear, i.e. players the game DLL has actually
put in the server. **A client stalled in the resource handshake is not one of
them.** It is invisible to YaPB for exactly the same reason it is invisible to
`get_players()` and therefore missing from `status.json`.

So the reserve is subtracted from a headcount that excludes the very clients
causing the lockout. The incident log proves it independently. That night:
`yb_quota 10`, `fill`, `keep_slots 1`, eight stalled clients, eight free
slots.

- If YaPB counted them: `desiredBotCount = min(10, 16 - (8 + 1)) = 7`. It
  would have created seven bots and stopped, in silence.
- If it did not: `desiredBotCount = min(10, 16 - (0 + 1)) = 10`. It would
  create bots until the engine ran out of slots at eight, and say so.

It created **eight** and printed `Maximum players reached (16/16)`. **With
`keep_slots 4` the second line reads `min(10, 16 - (0 + 4)) = 10` - the same
number, the same eight bots, the same lockout.** The reserve never enters the
arithmetic, because with the humans invisible the quota itself is the binding
term.

The cvar does bind, and that part was verified too: two throwaway containers,
`yb_quota 16`, `maxplayers 16`, no humans - `keep_slots 4` settled at 12 bots,
`keep_slots 1` at 15, `status.json` agreeing. It reserves correctly. It just
reserves against the wrong number for this bug.

`yb_join_delay` has no such hole, because it is a clock rather than a
headcount: verified in the same containers, `Spawn Server: de_nuke` at
07:22:44.667 and the first `Connecting Bot...` at 07:23:04.933 - **20.3s** in
which the only thing that can take a slot is a person, against the 7s the
incident log shows at the old value of 5.

**So what carries the fix:** splitting the pipe write (if it is the cause at
all), `yb_join_delay 20` for the first twenty seconds, and `changeMap`
clearing the bots for everything after that. `keep_slots 4` and the panel's
fill cap are worth keeping - they cost nothing and they harden the ordinary
near-full case - but they are not what stops this.
- The same function then VERIFIES: it polls `status.json` for the new map name
  (20s budget) and then, 8s later, checks the humans are still on the
  scoreboard. `humansBefore > 0 && humansAfter === 0` is exactly this bug's
  signature and now fails the call with the sentence "restart the server"
  rather than reporting "Changed map to X". It also refuses to send a map
  change at all against a `status.json` that has stopped moving.
- The war room's restart button is no longer disabled while another action is
  in flight, and its Map hint says what a red result means.
- The client (`apps/web/src/App.tsx`) polls `status.json` while PLAYING, not
  only in the lobby, and says on screen that a map change is happening. If the
  new map's `status.json` does not list this player's own alias after 30s it
  puts up a card with a rejoin button - and distinguishes "the server has
  stopped answering" (its payload froze) from "the map is up but you did not
  come back", because the fixes differ.

**Would the bot changes alone have saved that night?** The join delay plus the
bot clear, yes - as recovery, not as a cure. The eight reloads landed between
+15s and +25s; with bots held off until +20s the early ones get straight back
in, and the bot clear (which fires ~15s after the button press, before the
client's own stuck card at 30s) opens the rest. That is the difference between
"restart the server" and "that map took a while". `keep_slots` on its own
would have changed nothing - see the arithmetic above. And none of it fixes
the stall itself; the client card is what stops a player sitting there not
knowing to reload in the first place.

**Still to verify on the box** (the incident was diagnosed entirely from
`docker logs`, no repro):

- Whether splitting the pipe write is the actual cure. The test is a map
  change from the war room with 6+ real (or headless-Chrome, see the joiner
  recipe above) clients connected, watching for `Custom resource propagation
  complete.` per client. Do NOT trust a repro with one client - both admin
  changes that day with a single client worked fine.
- The bot clear in `changeMap` has never fired for real, only been reasoned
  about, because the lockout itself has not been reproduced. Its ingredients
  are all proven separately (`yb_quota 0` + `yb kickall` is the Bots panel's
  existing Clear button, and the detection is the same `status.json` poll the
  rest of the function uses), but the whole path has not run end to end.
- That `yb_join_delay 20` does not read as a dead server at the top of each
  map. Timing is verified (20.3s, twice); how it FEELS with people on it is
  not, and that wants one full rotation.

## Server sim dies silently: Host_Error kills it, the container lives on

The engine's internal server can die while the container, Go websocket
wrapper, page, and status row all stay green. Seen 2026-08-20 (09:10 UTC):
after 14h uptime and ~54 map changes, a rotation into cs_assault hit

    Host_Error: MAX_MODELS limit exceeded (4096)
    Server was killed due to an error

The engine leaks model precache slots across `Spawn Server` calls, so a
long-lived process eventually blows the 4096 cap on a model-heavy map.
After the kill, clients complete the websocket/WebRTC handshake and then
hang forever on the splash screen ("the game doesn't boot"); status.json
freezes at its last write (stale bot scoreboard, mapTimeLeft 0), and the
only server-side trace of a connect attempt is a
`websocket: close 1006 (abnormal closure)` line when the client gives up.

Diagnosis: `pnpm run logs gg | grep -E "Host_Error|killed"` - a
`Server was killed` line with no later `Spawn Server` means the sim is
dead. Fix: `docker restart <container>` (docker logs survive a restart).

Handled since 2026-08-29 by `server/sim-watchdog.sh`, cron every 5 min on
the box (`/opt/cs16/sim-watchdog.sh`, rsynced by deploy.sh; the crontab
entry is installed by hand once - see the script header). It does exactly
the diagnosis above, by log marker: a `Server was killed due to an error`
line NEWER than the last `Spawn Server` / `player server started` means the
sim is gone, and it restarts the container. It also recycles a sim that has
been up more than 8h with zero humans connected, which is what stops the
leak arming mid-session (it took ~11h of uptime to blow the cap on
2026-08-28).

Note what it deliberately does NOT do: compare status.json across a
sampling window. That was the previous watchdog (removed 2026-08-14, commit
024e6fb) and it cannot tell a dead sim from a paused one - the sim also
freezes when every connected client goes quiet at once, so it mass-kicked
idlers ~5 min after each session wound down. Both of the new triggers are
safe by construction: a paused-but-alive sim still has its `Spawn Server`
after any older kill line, and the age-out only fires on an empty server.

## Engine crashes surface as a native `alert()` that freezes the tab

Reported 2026-08-28 (Windows/Chrome): after being dropped by the server, the
page showed a browser modal reading

    Xash Error

    Mem_FreeBlock: not allocated or double freed

`Mem_FreeBlock: not allocated or double freed pool %d` is the engine's zone
allocator refusing a block whose pool is already gone - a free against a
pool torn down on disconnect. Upstream bug in this wasm build, in the same
post-disconnect area as the `UI_DrawString` message-box crash in backlog
item 2; we can't fix it without rebuilding the engine.

What we CAN fix is the aftermath, and did. The engine's `Sys_Error` hands
its message box to `alert(title + "\n\n" + body)` in the wasm glue (the only
`alert(` in `xash3d-fwgs/dist/raw.js`, an `EM_ASM` at the SDL message-box
call). A native modal blocks the whole page, so the drop overlay and its
Reconnect button were dead behind it, and dismissing it left a frozen canvas
- exactly the dead tab the lobby exists to prevent. `launch.ts` now shadows
`window.alert` before the engine boots (same trick as the mic-capture
kill-switch), so a fatal comes back as a `crashed` stage: lobby returns with
the engine's own message and a `reload` button. A crash also outranks a
drop - the silence watchdog fires ~10s later and must not downgrade
`crashed` (reload only) to `dropped` (offers a reconnect a dead engine can
never honour) - and `persistSettings` skips a dead engine rather than
re-entering the crashed heap with `host_writeconfig`.

### We were the ones triggering it (2026-08-29)

A second report - "couldn't connect" against a gg sim that was dead from the
MAX_MODELS leak - carried a longer version of the same message:

    Mem_FreeBlock: not allocated or double freed (free at ../engine/common/cmd.c:604)

The `free at` suffix is the engine's own `Mem_Free` file/line, and cmd.c is
`Cmd_ExecuteString` freeing the previous argv tokens out of the cmd memory
pool. That pool dies with the connection. So the crash needs two things: a
connection that is gone, and *somebody still sending console commands*. The
somebody was us - `persistSettings` fires `host_writeconfig` on a 30s timer
and `leaveServer` fires `disconnect` on pagehide, and neither checked whether
a connection still existed. On a dead sim no packet ever arrives, so the
silence watchdog never even arms and no drop card shows; the player just sits
on the splash until the first persist tick kills the tab.

Fix: `Xash3DWebRTC` exposes `live` (server traffic seen, no drop fired) and
both entry points require it. The boot-time commands in `launchGame` stay
ungated - freshly booted engine, pool certainly alive. Cost: settings changed
since the last 30s snapshot are lost on a drop, and there is no
snapshot-on-the-way-out because `host_writeconfig` is itself a console
command.

The full crash text now goes to the console as a `[engine fatal]` group (text,
stack, whether the engine was running, URL, UA, timestamp) and is parked on
`window.__ffCrash` - the lobby card only shows the trimmed last line, and the
`free at ...` suffix is the part that identifies the free site.

What dropped that player: the server engine segfaulted - see "AMX Mod X's
SV_DropClient detour" below. One second after the 05:18:26 core dump the log
has `YaPB ... successfully loaded` + `16 player server started`: the
container's supervisor respawns xashds in place, so `docker inspect` still
reads `RestartCount=0` and only the cores and a fresh `player server
started` line give it away. Every human is dropped at that instant, which is
the drop the client then died on.

Reproducing the wrapper (not the crash): join, then in devtools run
`alert("Xash Error\n\nMem_FreeBlock: not allocated or double freed pool 0")`
- that is byte-for-byte the call the engine makes.

## AMX Mod X's SV_DropClient detour kills the server on client timeout

Six of the eight cores in `/opt/cs16/cores` between 2026-08-19 and
2026-08-28 are one bug, and it is the single worst thing on this stack: any
player timing out takes the whole server down, everyone else with it.

The engine prints its own symbolised backtrace before it dies (it is in
`docker logs`, easy to miss among kill-feed lines - grep for
`Crash: signal`):

    Crash: signal 11 errno 0 with code 1 at 0x68520934
     2: SV_DropClient_PreHook (meta_api.cpp:946) (amxmodx_mm_i386.so)
     3: SV_DropClient        (meta_api.cpp:970) (amxmodx_mm_i386.so)
     4: SV_DropTimedOutClient (sv_main.c:465) (./xash)
     5: SV_CheckTimeouts      (sv_main.c:518) (./xash)
     6: Host_ServerFrame      (sv_main.c:704) (./xash)

AMXX detours the engine's drop function, located from its stock gamedata by
symbol name (`"linux" "@SV_DropClient_"`). Xash3D FWGS exports exactly that
name as an HLDS compatibility alias - the engine binary is not stripped - so
the detour installs cleanly. It then reads its first argument as GoldSrc's
`client_t`:

    auto pPlayer = SV_DropClient_PreHook(cl->edict, ...);   // meta_api.cpp:970
    #define GET_PLAYER_POINTER(e) (&g_players[ENTINDEX(e)]) // no bounds check

Xash3D passes its own `sv_client_t`, laid out differently, so `cl->edict`
reads an unrelated field, `ENTINDEX()` of that garbage returns a wild index,
and `pPlayer->initialized` dereferences into nothing. In the cores the
faulting instruction is `cmpb $0x0,0x1c(%edi)` with `edi` = fault address
minus 0x1c, every time - `initialized` sits at offset 0x1c in `CPlayer`.

It fires on the TIMEOUT path, which is the path every browser client takes
when a tab is closed or left in the background past `sv_timeout` (600s).
One player wandering off kills the server ten minutes later. The 05:18:26
crash on 2026-08-28 is exactly 600s after a `websocket: close 1001 (going
away)` at 05:08:26.

The core dumps are all *secondary* crashes and misleading on their own: the
first fault runs the engine's `Sys_Crash` handler, which tries a graceful
`Sys_Quit -> SV_Shutdown -> SV_FinalMessage -> Netchan_TransmitBits`, and
that function needs a 192KB stack frame (`memset(send_buf, 0, 0x30030)`)
that the handler does not have. So the core says "SIGSEGV in memset" and the
real cause is only in the saved signal context (`cr2`/`eip`) or in the log.

**Fix (shipped 2026-08-28):** `addons/amxmodx/data/gamedata/common.games/`
`custom/fragfridays-sv-dropclient.txt` in gg/dm/aim overrides the
signature with a symbol the engine does not export, so `GetMemSig()` fails
and the detour is never installed. This is AMXX's own override mechanism and
the hook is optional upstream.

The directory matters: `common.games` is a master-based config, so the
loader globs `gamedata/<name>/custom/*.txt` (`CGameConfigs.cpp`).
`gamedata/custom/` is the path for single-file configs and is NOT read here -
a file placed there is silently ignored and changes nothing. Confirm it
loaded by the AMXX log line `Parsed custom gamedata override file:`.

Cost, stated by AMXX itself at every map start: `client_disconnected and
client_remove forwards have been disabled - check your gamedata files.`
They are disabled outright, not downgraded. The legacy `client_disconnect`
forward still fires from `C_ClientDisconnect`, so our plugins use that
(`frag_dm.sma`); it misses clients that abort mid-connect, which
never have tasks queued. Three stock plugins we load - `admincmd`,
`adminhelp`, `multilingual` - reference `client_disconnected` for per-player
state resets and silently lose them; the state they leak is a language
setting or a menu page, against a bug that killed the whole server.

Verifying it, without waiting for a crash - read the engine's function entry
in the live process and look for a detour jump. **Wait for AMXX to attach
first**: read it seconds after a container start and the hook is simply not
installed yet, which looks exactly like success. Gate on `Cvar_DirectSet`
(same gamedata file, deliberately not overridden) reading as detoured before
trusting a clean `SV_DropClient_`:

    ssh cs16 'PID=$(docker inspect -f "{{.State.Pid}}" dm-xash3d-1); \
      python3 -c "f=open(\"/proc/$PID/mem\",\"rb\"); f.seek(0x0855a120); \
      print(f.read(8).hex())"'

`ff 25 ...` (an indirect jmp) means the detour is installed and the crash is
live. `55 57 56 53 ...` (the real prologue) means it is gone. The address is
`nm /tmp/xash | grep SV_DropClient_`; copy the binary out with
`docker cp dm-xash3d-1:/xashds/xash /tmp/xash`. As a control, `Cvar_DirectSet`
(same gamedata file, not overridden) should still read `ff 25 ...`.

**Verified end to end 2026-08-28 08:00 UTC**, with `sv_timeout` temporarily
at 30: a player joined at 07:56:46, backgrounded the tab at ~07:58:40 (which
freezes the wasm game loop, so the client goes silent while the WebRTC
transport stays up), and the engine dropped them at 07:59:10 - exactly 30s
after the last packet. Container start time unchanged, `RestartCount=0`,
zero `Crash: signal` lines. Before the fix this sequence was fatal every
time.

Identifying a timeout drop takes care, and cost me a false green first: the
engine does NOT print "timed out" to the console log (`SV_BroadcastPrintf`
goes to clients), so there is no string to grep. Distinguish by what is
absent - a transport teardown logs a `component=server` line
(`websocket: close 1001 (going away)`), so a `disconnected` line with no
`component=server` event near it came from inside the engine, and a drop
landing exactly `sv_timeout` seconds after the client went quiet is
`SV_CheckTimeouts`. Closing the tab is the WRONG trigger for this test - it
tears the transport down and never reaches the timeout path. Background the
tab instead.

Reading a core without gdb (there is none on the box): parse the ELF notes
directly - NT_PRSTATUS for signal and registers, NT_FILE for the module
map - then walk the stack above the crashing frame for return addresses and
symbolise with `addr2line -fCie /tmp/xash`. The engine binary keeps its
symtab and DWARF, so this names functions. To find the ORIGINAL fault behind
a crash-handler crash, scan every mapped segment for the saved sigcontext
(`trapno==14`, `cs==0x23`, `ss==0x2b`) and read its `eip` and `cr2`.

The other two cores (2026-08-19 23:14, 2026-08-20 23:25 UTC) are a separate
bug with the same second stage - see "Mod swaps core-dump the engine" below.

## Reconnect must reload the page, never `retry` in-engine

The drop overlay's button used to prefer `Cmd_ExecuteString('retry')` and
only fall back to `location.reload()` when the WebRTC transport looked dead.
It kept the unpacked filesystem, so it seemed the cheaper recovery. It does
not work: this wasm build's render loop dies on the disconnect itself (the
`UI_DrawString` crash in backlog item 2), so `retry` lands on a black screen
with an engine that never reaches the wire.

Seen live 2026-08-28: a player clicking reconnect produced NO connect
attempt in the server log at all, the silence watchdog re-fired ~10s later,
and they looped between black screen and drop screen. Changed to always
reload (`apps/web/src/App.tsx`); the zombie-transport tiebreaker in
`webrtc.ts` that existed to make the second click reload went with it.
valve.zip comes from Cache Storage, so a reload costs an unpack, not a
316MB download.

## Mod swaps can core-dump the engine (harmless, but that is where the cores come from)

Two of the eight cores in `/opt/cs16/cores` are not a gameplay crash at all.
Both happened the instant a `docker compose down` tore the gg container
down - journald pins each to the second, with a replacement container up
about a second later. `deploy.sh <mod>` snapshots console logs before a
teardown and `swap.sh` / the MCP `swap_mod` path do not, which is why no
snapshot exists for either moment.

The engine prints its own crash block, and it survives *inside the core*
even when no log does (the handler formats the text, prints it, then
re-raises, so the buffer is in the dump):

    Crash: signal 11 errno 0 with code 1 at 0x1c (nil)
     0: Sys_Crash (crash_posix.c:59) (./xash)
     1: 0x...34f (linux-gate.so.1)
     2: runtime.cgocallback (asm_386.s:795) (./xash)

What happens, recovered from core memory:

1. SIGTERM arrives while the main thread is parked in the Go scheduler
   (`stoplockedm -> notesleep -> futex`), a cgo callback having blocked.
   `runtime.park_m`'s inlined `dropg()` has already set `m.curg = nil` -
   `m0` is at 0x08b094a0 and `m0+0x64` reads 0 in both cores, against a
   live goroutine pointer in any healthy core.
2. The engine's `Posix_SigtermCallback` runs a full shutdown INLINE IN THE
   SIGNAL HANDLER: `Sys_Quit -> Host_ShutdownWithReason -> SV_Shutdown ->
   SV_FinalMessage -> Netchan_TransmitBits`.
3. Sending that last "server shutting down" packet goes `NET_SendPacketEx
   -> lib_net_sendto -> crosscall2`, re-entering Go.
4. `runtime.cgocallback` sees a non-nil TLS `g` (it is `g0`) and takes the
   `havem` fast path, which assumes a goroutine owns this m. None does, so
   `m.curg` is nil and `mov 0x1c(%esi),%edi` (cgocallback+0x77, reading
   `g.sched.sp`) faults on 0x1c.

Calling a cgo callback from a signal handler is a Go reentrancy violation;
no version of `cgocallback` survives it. Note the shared second stage with
the AMXX crash above: both die in `SV_FinalMessage -> Netchan_TransmitBits`
run from signal context, there by blowing a 192KB stack frame, here by
re-entering Go. The engine should not do network shutdown from a signal
handler at all.

It is intermittent, not every swap: SIGTERM has to land while the main
thread happens to be parked in the scheduler with `m.curg` already nil. The
dm -> gg swap on 2026-08-28 09:44 shut down cleanly and produced no core,
against two that did on 19/20 Aug.

Deliberately NOT fixed. It only fires while a container is being destroyed
during a swap, with players dropped regardless; the cost is an occasional
~270MB core and clients missing the final shutdown message. The real fix is
upstream (have the handler set a flag and let the main loop shut down), and
carrying an engine patch is not worth that. The tempting workaround - send
`quit` over the cmdpipe and wait before `docker stop` - is untested and may
just trade one shutdown crash for another: `quit` is blocked in
`server/mcp/src/cmdpipe.js` precisely because `restart` was seen to segfault
this build (2026-08-04).

If cores ever fill the disk, they are safe to delete; `/opt/cs16/cores` is
1777 and only catches dumps.

## Escape used to crash the client - fixed by deleting the menu

Pressing Escape in-game killed the render loop: `CL_Escape_f` ->
`UI_SetActiveMenu(true)` -> the GameUI menu drew itself, and drawing it threw
`RuntimeError: remainder by zero`. The tab froze, the client went silent, and
the drop watchdog blamed the network ~10s later.

**Root cause.** Chrome's wasm frames map cleanly onto cs16-client's
`menu_emscripten_wasm32.wasm` because that module keeps its name section
(`wasm-objdump -d`, offsets are file offsets):

```
UI_DrawString                 func[1938] @ 0x5d330, trap at 0x5d39f
EngFuncs::DrawConsoleString   func[1982]
CMenuPicButton::Draw          func[866]
CMenuItemsHolder::Draw        func[832]
CMenuBaseWindow::Draw         func[721]
CMenuFramework::Draw          func[792]
CMenuBaseWindow::DrawAnimation   func[722]
CMenuFramework::DrawAnimation    func[804]
CWindowStack::Update          func[2057]
UI_UpdateMenu                 func[1945]
```

0x5d39f is a bare `i32.rem_s` - `h % charH` in UI_DrawString's vertical
justify, with `charH` (the menu font height) zero. The menu has no usable
font in this build, so EVERY path that draws it dies: Escape, and the
engine's own yes/no message box after a disconnect (backlog item 2 - which
is why `retry` used to land on a black screen).

**The fix** is in `ENGINE_LIBRARIES` in `apps/web/src/launch.ts`: the GameUI
menu is left out of the engine's dynamic libraries, so it never loads. That
is a supported state - `cl_scrn.c` calls `UI_LoadProgs` and comments the
failure "there is non fatal for us", and every `UI_*` entry point then
short-circuits on a null `gameui.hInstance`. `UI_SetActiveMenu(true)` becomes
a no-op, so Escape does nothing at all. No event listeners, no
`preventDefault`, nothing anywhere near the mouse.

Verified 2026-08-29 against the live server: ~90 Escape presses across team
select and in-game, no crash, `window.__ffCrash` null, engine still live.
`host_gameuiloaded` does not exist afterwards, which is the proof the menu
never loaded.

Two things changed with it:

- The engine turns its console on when the menu is missing
  (`host.allow_console`), so `~` now opens the console mid-game where it used
  to do nothing. Escape closes it again (in game, `Con_ToggleConsole_f` ->
  `UI_SetActiveMenu(false)` -> `Key_SetKeyDest(key_game)`). While NOT
  connected, closing it routes through `UI_SetActiveMenu(true)` instead, which
  is the no-op - so a console opened before the connect completes stays up
  until the engine reaches `ca_active` and closes it itself.
- A slow connect now shows the engine's boot log on the canvas instead of
  black. The lobby overlay covers most of it; it clears the moment the world
  loads.

With the engine inert on Escape, the page took the key over: `App.tsx`
renders a "match menu" (Resume / Leave server) on Escape. It is an OBSERVER -
a capture-phase `keydown` on `window` that reads the key and does nothing
else. No `preventDefault`, no `stopPropagation`, nothing touching pointer
lock. Leave server runs `leaveServer()` then reloads, so the slot is handed
back immediately instead of being held for `sv_timeout` (verified in the
server log 2026-08-29: `"esctestesctest" disconnected` the moment the button
was pressed). Escape still exits fullscreen - no page can cancel that - so
Resume re-enters it if the menu was opened from fullscreen.

**Do not** reinstate a page-side Escape swallower. Three were tried on
2026-08-28 and all are in the history for a reason: swallowing the keydown in
a React effect (loses the listener-order race to SDL), swallowing it before
init (Escape still releases the pointer lock, which SDL reads as focus loss),
and swallowing `pointerlockchange` too (broke mouse look outright, because it
hid the lock being GRANTED as well). Blocking events the engine needs is
worse than the crash was.

## A reload used to leave a ghost holding a slot (and the bomb)

The engine keeps a client until `sv_timeout` (600s), so closing or reloading
the tab left the old session live in the sim for up to ten minutes. Seen
2026-08-28: a player reloaded at 10:14, rejoined on a new slot 14s later,
and at 10:15:22 the server handed the ABANDONED slot the C4
(`Spawned_With_The_Bomb`) - a bomb carried by nobody for nearly seven
minutes, plus a wasted slot on a 16-player server.

`leaveServer()` in `launch.ts` now runs `disconnect` on `pagehide`, so the
engine hands the slot back immediately; the reconnect button reloads, so it
cleans up after itself too. A hard kill (browser crash, force quit) still
falls back to the timeout, which is the correct floor.

Lowering `sv_timeout` is NOT the fix - it exists at 600s precisely because a
backgrounded tab freezes the game loop and goes network-silent, and a short
timeout would drop alt-tabbed players mid-session.

Dropping the ghost on a timer is still not available to us: the
transport-close line (`websocket: close 1001`) is logged by the Go layer
inside the prebuilt image and names no player, and there is no per-player
identity to key on (below). What IS available is dropping it at the moment
the same player comes back - see the next entry.

## A crashed player comes back as "Name (1)", and there is no identity to dedupe on but the name

The other half of the ghost problem, and the one people actually notice.
Because the ghost holds the NAME as well as the slot for `sv_timeout`, the
engine hands the returning player `Reversons (1)`. That is cosmetic on the
scoreboard and not cosmetic at all in the kill logs: `scripts/standings.py`
and the recap parser count players by name, so a crash-rejoin splits one
person into two with half the frags each, and can hand away an MVP.

**What identity means on this stack** (measured 2026-09-05 in a throwaway
container with a real browser client, and corroborated by every
`connected, address` line in `data/logs/`):

| signal | what it actually is | usable? |
|---|---|---|
| `get_user_authid` | `ID_7dea362b3fac8e00956a4952a3d4f47` for every browser client ever seen - the hash of an absent steamid | no, it is a constant |
| `get_user_ip` | `0.87.11.9:1000`, `1.94.234.160:1000`, `5.235.128.164:1000` - the Go/WebRTC layer fabricates an address per CONNECTION, port always 1000; the same person gets a different one every join | no, not real and not stable |
| name | the player's own alias | the only signal there is |

So `ff_rejoin.sma` (gg/dm/aim/css/fy/awp) matches on the base name, and
protects live players a different way: **the ghost is the one that is not
sending.** `FM_CmdStart` fires once per usercmd received, so it is a direct
"packets still arriving" signal - a live client ticks ~60/s, and a crashed
one froze its counter instantly and stayed frozen for the whole seven
minutes the engine held the slot. `get_user_ping`/loss do NOT work for this:
the ghost's ping stayed pinned at its last value (27ms) and loss stayed 0
the entire time. `get_players()` does still list the ghost (`conn=1`), so
enumeration is fine.

Two more things established on the rig, both of which shape the plugin:

- **The engine uniquifies before AMXX sees anything.** At `client_connect`
  the incoming name is ALREADY `Reversons (1)`. There is no hook early
  enough to prevent the suffix, so the plugin drops the ghost and then puts
  the base name back with `set_user_info` (~1s after the join).
- **A kick is synchronous.** `server_cmd("kick #<uid>")` + `server_exec()`
  runs the engine's drop inside the call - `client_disconnect` fires before
  `server_exec()` returns. That is why the plugin does its work from a task
  0.5s after `client_putinserver` rather than inline in the connect path.

The kick is only safe because every mod that ships this plugin also ships
the `fragfridays-sv-dropclient.txt` gamedata override (see the SV_DropClient
entry above) - without it a programmatic drop goes straight through the
detour that killed the server eight times. **Classic/vanilla was running
without that override** - it has no build step, so it kept the stock image's
gamedata while gg/dm/aim were fixed on 2026-08-28. The root compose now
mounts `./vanilla/gamedata` into its `common.games/custom/` so Classic
carries the same override as everything else. Classic still does not run
`ff_rejoin.amxx`: its plugins live box-side at `/opt/cs16/mods/zp/plugins/`
where `deploy.sh` never reaches, so the compiled `.amxx` has to be copied in
and registered by hand.

Verified end to end 2026-09-05 in a throwaway dm container: join, crash the
renderer, rejoin inside the timeout window - ghost dropped, name back to
`Reversons`, slot count unchanged (3 before, 3 after), `RestartCount=0`,
zero `Crash: signal` lines across the whole run. A second live client under
the same alias was correctly left alone (`still sending (0.0s)`), and a
`changelevel` with a live client produced no kick.

**The memory-read recipe above no longer discriminates.** Reading
`SV_DropClient_` at `0x0855a120` on the current base image gives the real
prologue (`55 57 56 53 ...`) whether the override is present, masked, or
absent, while the `Cvar_DirectSet` control does read `ff 25 ...` - so AMXX
is attached and hooking, and the entry-point patch is simply not how this
build's `SV_DropClient` hook shows up any more. The signal that still works
is the AMXX line `client_disconnected and client_remove forwards have been
disabled - check your gamedata files.`: it appears at map start in the mod
images and does not appear when the override directory is masked. Vanilla's
console is too quiet to log it either way, which is why its override is
shipped defensively rather than confirmed by log.

## Client prediction can trap on a stale brush model (`memory access out of bounds`)

Reported 2026-08-29, one occurrence, cause of the trigger unknown:

```
Uncaught RuntimeError: memory access out of bounds
    at xash-CAtKZwSO.wasm:0xcd722    PM_RecursiveHullCheck +0xd4
    at xash-CAtKZwSO.wasm:0xce4d5    (hull trace wrapper)
    at xash-CAtKZwSO.wasm:0xce63c    (hull trace wrapper)
    at xash-CAtKZwSO.wasm:0x121680   pmove->PM_TestPlayerPosition
    at 001ddf92:0x617dd              PM_CheckStuck +0x27  (call_indirect)
    at 001ddf92:0x6377f              PM_PlayerMove
    at 001ddf92:0x63ddd              PM_Move
    at 001ddf92:0x35ad6              HUD_PlayerMove
    at xash-CAtKZwSO.wasm:0x120988   CL_RunUsercmd +0x537 (call_indirect)
    at xash-CAtKZwSO.wasm:0x1204e3   CL_RunUsercmd +0x92  (msec>50 self-split)
```

**How to read a stack like this.** The engine wasm ships NO name section, so
its frames are bare `func[N]` - the module named `001ddf92` in the Chrome
stack is a side module, here `client_emscripten_wasm32`, which DOES keep its
names. Dump both and map file offsets to functions:

```
wasm-objdump -d server/web/assets/xash-*.wasm                    > xash.dis
wasm-objdump -d server/web/assets/client_emscripten_wasm32-*.wasm > client.dis
# then find the last `NNNNNN func[K]:` header at or before each offset;
# caller frames land on the `call`/`call_indirect`, the top frame on the trap
```

Unnamed engine functions are identified by shape. `func[559]` is
`PM_RecursiveHullCheck` beyond doubt: it carries the BSP2-vs-BSP29 clipnode
stride branch (12-byte nodes with i32 children vs 8-byte with i16), the
`bad node number` `Host_Error`, `plane = hull->planes + node->planenum * 20`,
and then `if (plane->type < 3) t1 = p1[type] - dist; else DotProduct(...)`.
`func[1389]` is `CL_RunUsercmd` - the two frames are its own `msec > 50`
split recursion. `PM_CheckStuck` on the client side is confirmed by
`GOT.mem.rgStuckLast` in its prologue.

**The trap** is `i32.load8_u [plane+16]`, i.e. `plane->type`, through a
`hull->planes + planenum` that is out of range. The engine bounds-checks the
CLIPNODE number (that is the `Host_Error` immediately above) but never the
PLANE number, so a hull whose `clipnodes` pointer is stale walks straight off
the end of linear memory. In practice: `pmove->physents[i].model` was a freed
or not-yet-loaded brush model when client-side prediction ran.

**Not the maps.** Every BSP in `server/maps/` validates - planenums in range,
clipnode children in range, model headnodes sane. (The `-1` headnodes on the
now-removed kz maps were `CONTENTS_EMPTY`, which is normal for non-solid
brush entities.)
This is engine state, not map data.

**No fix on our side.** The missing planenum guard is upstream. The one lever
that removes the code path entirely is `cl_predict 0` in `userconfig.cfg`,
which stops `CL_RunUsercmd` running at all - do NOT ship that by default, it
makes movement rubber-band over the WebRTC link. Emergency use only, and only
if this turns out to be frequent.

**What was missing at diagnosis time** was any record of what the player was
doing. That is now fixed: `launch.ts` passes `print`/`printErr` into the
engine module and keeps the last 300 lines of engine stdout, which
`reportFatal` dumps with the crash and parks on `window.__ffCrash.log`. Those
lines were previously going nowhere - the xash3d-fwgs wrapper installs its own
`print` for `waitLog` and forwards to `module.print`, which we never supplied.
Next occurrence, the tail says whether it was a join, a changelevel or
mid-round, which separates "spawn-window race" from "precache/model-index rot"
(see the MAX_MODELS leak above).

## Map boot-tests: `timeout` makes every map look like it segfaults

Boot-testing a new map with `timeout N docker run ...` ends the log with
`Crash: signal 11 ... Sys_Crash (crash_posix.c:59)` and
`runtime.cgocallback`. It is not the map. `timeout` sends SIGTERM, the engine
logs `caught signal 15` -> `Server shutdown`, and the Go wrapper then faults
on the way out. The crash lines always sit AFTER those two, so read the order
before blaming the bsp.

Two things make this easy to misread: the trace looks identical to a real
sim crash, and a control run on a known-good map may *not* reproduce it if
SIGTERM lands while that map is still loading (big maps like de_dust2 take
>60s to reach steady play, so a short control proves nothing).

Test the shutdown path instead - pipe a graceful `quit` and check the exit
code, which also gives a clean kill count:

```bash
ssh cs16 '( sleep 100; echo "quit" ) | timeout 140 docker run -i --rm --platform linux/386 \
  --entrypoint ./xash \
  -v /opt/cs16/cs/cstrike/maps:/xashds/cstrike/custom/maps:ro \
  -v /opt/cs16/cs/cstrike/models:/xashds/cstrike/custom/models:ro \
  dm-xash3d:latest +ip 0.0.0.0 -port 27015 -game cstrike +maxplayers 12 "+map <map>"'
```

`exit=0` with zero `signal 11` means the map is clean. Cross-check `/cores`
(empty = no real segfault has happened) and the live container's
`RestartCount`. Note `--entrypoint ./xash` is needed at all because
entrypoint.sh shuffles mapcycle.txt and strips any `+map` you pass.
