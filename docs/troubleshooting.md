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
Prevention idea (not built): a healthcheck on status.json staleness, or a
pre-session restart, since uptime measured in days plus map churn is what
arms this.

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
`custom/fragfridays-sv-dropclient.txt` in gg/dm/kz/aim overrides the
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
(`frag_dm.sma`, `kz.sma`); it misses clients that abort mid-connect, which
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

## Escape crashes the client - three attempts, all reverted

Pressing Escape in-game kills the render loop: it opens the engine's menu,
which this wasm build cannot draw, and the attempt throws `RuntimeError:
remainder by zero` in `UI_DrawString` (backlog item 2). The tab freezes, the
client goes silent and the drop watchdog reports a disconnect.

The page now REPORTS this honestly - "the game engine crashed - RuntimeError:
remainder by zero", with a reload button - but does not prevent it. Three
attempts on 2026-08-28, all reverted, in the order they failed:

1. **Swallow the keydown** in a React effect when play starts. No effect:
   capture-phase listeners on one target fire in registration order, and
   SDL's was registered first, during engine init.
2. **Swallow it before init**, so ours registers first. The keypress stopped
   reaching SDL and the crash still happened - Escape also releases the
   pointer lock, which no page can cancel, and SDL reads the lock dying as
   the window losing focus and opens the menu anyway. (`fullscreenchange`
   was already hidden from SDL for this reason on 2026-08-07 - that fix
   stays, it works.)
3. **Swallow `pointerlockchange` too.** This broke mouse look outright,
   because hiding the event hid the lock being GRANTED as well and SDL
   enters relative mouse mode on exactly that. Narrowing it to only hide
   the release did not stop the crash either, so the trigger is a fourth
   route - `blur`, `visibilitychange` or something else SDL watches.

Do not attempt a fourth fix against a live session. The repo has a repro
harness for precisely this (see the drop-watchdog notes: Playwright with
`channel: 'chrome'` joins the real server headless): instrument which events
SDL actually has registered - `getEventListeners(document)` in devtools, or
wrap `addEventListener` before the engine boots and log every registration -
and find the real route before writing another swallow. Blocking events the
engine needs is worse than the crash: a crash costs one reload, a broken
mouse costs the session.

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

Dropping the ghost server-side is not available to us: the transport-close
line (`websocket: close 1001`) is logged by the Go layer inside the
prebuilt image and names no player, and every browser client shares one
auth id (`ID_7dea362b...`, the hash of an absent steamid), so there is
nothing to dedupe on.
