# server/

Everything in this directory syncs to the VPS at `/opt/cs16/` via
`pnpm run deploy`. The box is the runtime; this repo is the source of truth.
Seeded from the live box with `pnpm run pull` - run that again if anything
gets hand-edited on the server.

## Layout (mirrors /opt/cs16)

| Path | On the VPS | Purpose |
|---|---|---|
| `docker-compose.yml` | `/opt/cs16/docker-compose.yml` | Profile-based compose. `--profile vanilla` runs stock CS 1.6 (service bind-mounts `mods/`, which is currently empty). The gg/dm profiles here are unused templates - the real mods run from their own dirs below |
| `gg/` | `/opt/cs16/gg/` | GunGame (working) - Dockerfile compiles `addons/` plugin source at build time, appends to `plugins.ini` |
| `dm/` | `/opt/cs16/dm/` | CSDM deathmatch - compose + Dockerfile only, no `addons/` yet so it cannot build (needs `modules.ini` handling, not `plugins.ini`) |
| `zp/` | `/opt/cs16/zp/` | Zombie Plague - abandoned, kept as the Dockerfile template the others were copied from |
| `config/userconfig.cfg` | `/opt/cs16/cs/cstrike/userconfig.cfg` | Shared client config, ships to every player inside `valve.zip` |

## What is deliberately NOT here

- `/opt/cs16/cs/` - the SteamCMD game install (copyrighted, ~1GB). Lives only on the box.
- `valve.zip` (root, `gg/`, `dm/`) - ~438MB game filesystem archives, built on
  the box from the game files. Gitignored. Note: there is currently NO
  `update-clientcfg.sh` on the box (the handover doc was wrong) - rebuilding
  valve.zip after a `userconfig.cfg` change is manual. Automating it is in
  docs/backlog.md.
- `/opt/cs16/src/` - downloaded mod archives.
- SteamCMD internals at `/opt/cs16/` root (`linux32/`, `package/`, `steamcmd.sh`, ...).
- `.env` - stays on the box, holds only `PUBLIC_IP` for the root compose.

## Rules (learned the hard way - see docs/troubleshooting.md)

- One mod runs at a time; everything binds 27016. `deploy.sh` downs the others
  before starting the target, and verifies with `docker ps`.
- Use `restart: unless-stopped`, never `restart: always`.
- A `.amxx` in `plugins/` does nothing unless listed in `plugins.ini`. Modules
  (like CSDM's `.so`) register in `modules.ini` instead.
- `valve.zip` root must contain only `valve/` and `cstrike/`.
- This stack is Xash3D-FWGS + Metamod-P + AMXX 1.9. ReAPI mods will not work.
