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

## Steam account verification (SteamCMD)

SteamCMD from a new datacentre IP triggers Steam verification, and a wrong
answer locks sign-in. Correct answers: "Steam client" (SteamCMD *is* the
Steam client) and "Other". See [setup.md](setup.md) for the full context.

## uname -m false alarm

`uname -m` inside a `--platform linux/386` container reports `x86_64`. Not a
fault - it reports the kernel arch. Correct check:
`docker image inspect i386/alpine --format '{{.Architecture}}'` -> `386`.
