# server/

Everything in this directory syncs to the VPS at `/opt/cs16/` via
`pnpm run deploy`. The box is the runtime; this repo is the source of truth.
Seeded from the live box with `pnpm run pull` - run that again if anything
gets hand-edited on the server.

## Layout (mirrors /opt/cs16)

| Path | On the VPS | Purpose |
|---|---|---|
| `docker-compose.yml` | `/opt/cs16/docker-compose.yml` | Profile-based compose. `--profile vanilla` runs Classic, the 5v5 match mode, off the stock image. The gg/dm profiles here are unused templates - the real mods run from their own dirs below |
| `vanilla/` | `/opt/cs16/vanilla/` | Classic's config, mounted (not baked) because vanilla runs the stock image unbuilt: `server.cfg` (the match ruleset), `amxx.cfg` (sets no gameplay cvar; ends with `exec server.cfg`, which is what re-applies the ruleset each map), `yapb.cfg` (`yb_quota 0`), `mapcycle.txt`, `maps.ini`. See [docs/classic-rules.md](../docs/classic-rules.md) |
| `gg/` | `/opt/cs16/gg/` | GunGame (working) - Dockerfile compiles `addons/` plugin source at build time, appends to `plugins.ini` |
| `dm/` | `/opt/cs16/dm/` | Deathmatch (working) - our `frag_dm.sma` compiled at build time; CSDM itself is dead on this stack (see docs/troubleshooting.md) |
| `css/` | `/opt/cs16/css/` | Source Maps - dm's rules on CS:S/CS:GO maps remade for 1.6 (`css_*` + `de_bank_csgo`) |
| `fy/` | `/opt/cs16/fy/` | Fight Yard - dm's rules on `fy_*` maps, `mp_roundtime 1` as the mode baseline |
| `awp/` | `/opt/cs16/awp/` | Sniper - dm's rules with `dm_only "awp"` baked in as the mode baseline |
| `zp/` | `/opt/cs16/zp/` | Zombie Plague - abandoned, kept as the Dockerfile template the others were copied from |
| `config/userconfig.cfg` | `/opt/cs16/cs/cstrike/userconfig.cfg` | Shared client config, ships to every player inside `valve.zip` |
| `maps/` | `/opt/cs16/cs/cstrike/maps/` (additive) | Custom map `.bsp`/`.txt` files; containers also mount the box path as `cstrike/custom/maps` |
| `custom/` | `/opt/cs16/cs/cstrike/` (additive) | Assets custom maps need (wads, overviews, skies, sounds - client-only) plus `models/` and `sprites/`, which the SERVER also loads |

## What is deliberately NOT here

- `/opt/cs16/cs/` - the SteamCMD game install (copyrighted, ~1GB). Lives only on the box.
- `valve.zip` - the ~300MB client payload, built on the box by
  `update-clientcfg.sh` (`pnpm run clientcfg`). Gitignored.
- `/opt/cs16/src/` - downloaded mod archives. NOT a mod dir: the Source Maps
  mod is `css/` precisely so `deploy.sh` (which rsyncs `--delete` into every
  name in `DIR_MODS`) can never land on it.
- SteamCMD internals at `/opt/cs16/` root (`linux32/`, `package/`, `steamcmd.sh`, ...).
- `.env` - stays on the box, holds only `PUBLIC_IP` for the root compose.
- **`/opt/cs16/mods/` - the one real hazard.** vanilla runs the stock image
  unbuilt, so it cannot compile or bake anything; the root compose feeds it
  AMXX plugins, AMXX configs and the YaPB tree out of `mods/`, which was
  hand-seeded on the box and which `deploy.sh` only ever `mkdir -p`s. Nothing
  in `server/` syncs it, so a change made there is invisible here and dies
  with the box. Three files have been pulled back under repo control by
  mounting over it (`vanilla/amxx.cfg`, `vanilla/maps.ini`,
  `vanilla/yapb.cfg`) - do the same for anything else that starts mattering,
  rather than editing `mods/` in place. When you do, take the box copy
  VERBATIM and subtract from it; retyping a config from what the docs say is
  in it is how you lose settings nobody remembered.

  Still box-only, audited 2026-09-04: `mods/zp/plugins/*.amxx` (compiled
  binaries - nothing can rebuild them for vanilla; the loaded set is stock
  AMXX plus `cmdpipe.amxx` and `statusjson.amxx`, and notably NOT
  `chatrestart` or `teambalance`), `mods/zp/configs/plugins.ini`,
  `configs/users.ini`, `configs/maps/` (per-map cfgs for awp_india,
  cs_deagle5 and scoutzknivez - none of them in Classic's pool) and
  `mods/metamod-plugins.ini`.

## Rules (learned the hard way - see docs/troubleshooting.md)

- One mod runs at a time; everything binds 27016. `deploy.sh` downs the others
  before starting the target, and verifies with `docker ps`.
- Use `restart: unless-stopped`, never `restart: always`.
- A `.amxx` in `plugins/` does nothing unless listed in `plugins.ini`. Modules
  (like CSDM's `.so`) register in `modules.ini` instead.
- **Classic (vanilla) gets nothing from this repo's `addons/`.** It runs the
  stock image and mounts `/opt/cs16/mods/zp/{plugins,configs}`, which `deploy.sh`
  never touches - a new plugin has to be compiled and copied in by hand. It also
  keeps the stock `gamedata/`, so the AMXX `SV_DropClient` detour is still
  installed there: anything that drops a client programmatically (`ff_rejoin.amxx`)
  must not go to Classic until `fragfridays-sv-dropclient.txt` is mounted too.
- `valve.zip` root must contain only `valve/` and `cstrike/`.
- Wads and sounds are render-side, but **studio models and env_sprites load
  server-side** - a map using them needs the `models/`/`sprites/` compose
  mounts or it logs `Could not load model ... from disk` (de_bank_csgo).
- This stack is Xash3D-FWGS + Metamod-P + AMXX 1.9. ReAPI mods will not work.
