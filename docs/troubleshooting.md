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

What dropped that player: the server engine segfaulted. `/opt/cs16/cores`
holds three dumps from that morning (04:34, 04:45, 05:18 UTC), and one
second after the 05:18:26 dump the log has `YaPB ... successfully loaded` +
`16 player server started` - the container's supervisor respawns xashds in
place, so `docker inspect` still reads `RestartCount=0` and only the cores
and a fresh `player server started` line give it away. Every human is
dropped at that instant, which is the drop the client then died on.

Reproducing the wrapper (not the crash): join, then in devtools run
`alert("Xash Error\n\nMem_FreeBlock: not allocated or double freed pool 0")`
- that is byte-for-byte the call the engine makes.
