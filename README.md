# Frag Fridays

Counter-Strike 1.6 in a browser tab, for the weekly Friday work social.
No install, no Steam, no download prompts on the work laptop - open a URL
and you're in.

**Play:** http://149.28.172.74:27016

- **Real GoldSrc in the browser** - the actual engine compiled to
  WebAssembly ([yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs)),
  networked over WebRTC. Not a remake, not a video stream.
- **Five mods, one command** - GunGame, Deathmatch, KZ jump maps, Zombie
  Plague, vanilla rounds. `pnpm run deploy gg` swaps the whole server;
  the URL never changes.
- **Never an empty server** - YaPB bots fill the slots and leave one by
  one as humans join. `[BOT]`-prefixed on the scoreboard, tuned to be
  beatable.
- **Settings survive reloads** - sensitivity, crosshair and binds persist
  per browser, while updated shipped defaults still reach returning
  players.
- **No dead tabs** - a dropped connection brings the lobby back with a
  reason and a Reconnect button, not a frozen game.
- **Live console, no rcon needed** - `pnpm run rc "changelevel de_dust2"`
  changes map mid-session with no restart and no player drop.
- **MCP control plane** - status, console, logs, restart and mod swap
  exposed as MCP tools ([server/mcp](server/mcp)), so the server can be
  driven from claude.ai as a custom connector.
- **Tuned by obsession** - bot difficulty, map rotations, gravity maps,
  join binds and rates set by someone who has played far too much CS 1.6.
- **Runs on a $6/mo VPS** - one Vultr box in Sydney, one Docker image per
  mod, the repo as the single source of truth.

## Repo layout

| Path        | What                                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| `server/`   | Everything synced to the VPS - one folder per mod (Dockerfile + compose), plus configs and on-box scripts. See [server/README.md](server/README.md). |
| `apps/web`  | The landing page players hit - download progress, name entry, launches the engine fullscreen into the same tab. |
| `scripts/`  | Local tooling run from your machine over SSH: `deploy`, `logs`, `rc`, `swap`.   |
| `docs/`     | Everything below.                                                               |

The repo is the source of truth. Nothing is hand-edited on the box; every
change goes through `pnpm run deploy`.

## Common commands

```sh
pnpm run deploy <mod>     # gg | dm | kz | vanilla | zp
pnpm run status           # what's running on 27016
pnpm run logs             # tail the live server
pnpm run rc "<cmd>"       # live server console (see troubleshooting)
pnpm run web:dev          # landing page locally
```

`pnpm run deploy` (not `pnpm deploy` - that's a reserved pnpm command that
does something else entirely).

## Docs

- [Runbook](docs/runbook.md) - the Friday procedure, start to finish
- [Game guide](docs/game-guide.md) - the mods, chat commands, bot tuning
- [Setup](docs/setup.md) - rebuilding the VPS from scratch
- [Troubleshooting](docs/troubleshooting.md) - this stack fails silently; verify, don't assume
- [Decisions](docs/decisions.md) - why things are the way they are
- [Backlog](docs/backlog.md) - what's next

## Do not commit

`valve.zip`, the extracted Steam files, or any mod archive. They're
copyrighted and ~1GB. The game files live on the server at `/opt/cs16/cs/`;
deploy only syncs configs, Dockerfiles and scripts. `.gitignore` enforces
this - don't work around it.
