# Frag Fridays

Browser-playable Counter-Strike 1.6 for the weekly Friday work social. No
installs, no Steam accounts - players open a URL and play. The server runs in
Docker on a Vultr VPS in Sydney (CS 1.6 compiled to WebAssembly via
[yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs), networked
over WebRTC).

**Player URL:** http://149.28.172.74:27016

This repo is the source of truth. Everything is developed locally and pushed
to the server with a deploy script - nothing is configured by hand on the box.

## Repo layout

| Path        | What it is                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/`   | Everything synced to the VPS (`/opt/cs16`): one directory per mod, each with its own Dockerfile and docker-compose, plus `config/` (client/server configs, map lists) and scripts that run on the box |
| `scripts/`  | Local deploy tooling - `deploy.sh`, `logs.sh` and friends, run from your machine over SSH                                                                                                             |
| `docs/`     | Runbook, troubleshooting guide and decision log                                                                                                                                                       |
| `apps/`     | Future web portal (map voting, schedule, RSVP, server status)                                                                                                                                         |
| `packages/` | Future shared packages and Slack bot                                                                                                                                                                  |

`apps/` and `packages/` are pnpm workspaces; the server side needs no Node at
all.

## Deploying

```sh
pnpm run deploy <mod>     # e.g. pnpm run deploy gg
pnpm run deploy:vanilla   # shortcut for vanilla CS 1.6
pnpm run deploy:gg        # shortcut for GunGame
pnpm run status           # docker ps on the server
pnpm run logs             # tail server logs
```

Note: it must be `pnpm run deploy` - plain `pnpm deploy` is a reserved pnpm
command and does something entirely different.

First time (or after hand-edits on the box): `pnpm run pull` syncs the live
server's configs, Dockerfiles and addon sources down into `server/` - see
`server/README.md`. All remote access goes through the `cs16` SSH host alias
in `~/.ssh/config`.

Deploy rsyncs the repo's server files to the VPS, rebuilds the target mod
image, restarts it and verifies with `docker ps`. Only one mod runs at a time
(they all bind port 27016, keeping the player URL constant).

## What must NOT be committed

**Never commit `valve.zip`, the extracted Steam game files, or downloaded mod
archives.** They are copyrighted and roughly 1GB. The deploy script assumes
the game files already exist on the server (`/opt/cs16/cs/`) and only syncs
configs, Dockerfiles and scripts. The `.gitignore` enforces this - do not work
around it.

## Documentation

Start in `docs/`:

- Runbook - the Friday procedure: bring up the mod, verify, announce in Slack
- Game guide - how each mod plays, DM chat commands, bot difficulty and tuning
- Troubleshooting - the known gotchas (this stack fails quietly; verify, don't
  assume)
- Decision log - why things are the way they are, kept as decisions happen
