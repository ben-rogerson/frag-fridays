# server/

Everything in this directory syncs to the VPS at `/opt/cs16/` via
`pnpm run deploy`. The box is the runtime; this repo is the source of truth.

## Layout

| Dir | On the VPS | Purpose |
|---|---|---|
| `vanilla/` | `/opt/cs16/vanilla/` | Vanilla CS 1.6 - compose file only, runs the stock image |
| `gg/` | `/opt/cs16/gg/` | GunGame - Dockerfile compiles plugins at build time, plus addons source |
| `dm/` | `/opt/cs16/dm/` | CSDM deathmatch - not built yet (needs `modules.ini` handling, not `plugins.ini`) |
| `config/` | `userconfig.cfg` -> `/opt/cs16/cs/cstrike/` | Shared client config, ships to every player inside `valve.zip` |
| `scripts/` | `/opt/cs16/scripts/` | Scripts that run ON the box (e.g. `update-clientcfg.sh`) |

## What is deliberately NOT here

- `/opt/cs16/cs/` - the SteamCMD game install (copyrighted, ~1GB). Lives only on the box.
- `valve.zip` - built on the box by `update-clientcfg.sh` from the game files. Gitignored.
- `/opt/cs16/src/` - downloaded mod archives.

The deploy script assumes the game files already exist on the server and never
touches them (except installing `config/userconfig.cfg` into the tree).

## Seeding

If these mod dirs are empty, the repo has not been seeded from the live box
yet - run `scripts/pull.sh` (needs SSH access as the `cs16` host alias).

## Rules (learned the hard way - see docs/troubleshooting.md)

- One mod runs at a time; all bind 27016. `deploy.sh` downs the others before
  starting the target, and verifies with `docker ps`.
- Use `restart: unless-stopped`, never `restart: always`.
- A `.amxx` in `plugins/` does nothing unless listed in `plugins.ini`. Modules
  (like CSDM's `.so`) register in `modules.ini` instead.
- `valve.zip` root must contain only `valve/` and `cstrike/`.
- This stack is Xash3D-FWGS + Metamod-P + AMXX 1.9. ReAPI mods will not work.
