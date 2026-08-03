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
