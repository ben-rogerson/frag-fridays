# Frag Fridays

Counter-Strike 1.6 in a browser tab, for a weekly Friday work social.

**Play:** https://ff.benrogerson.dev

## What it is

The real GoldSrc engine compiled to WebAssembly
([yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs)),
networked over WebRTC, with a dedicated server running on one small VPS in
Sydney. Not a remake and not a video stream, it is actual CS 1.6, running
locally in the tab.

The point is the zero-friction join. Nobody installs Steam on a work laptop
for a half-hour Friday game. You open a URL, type a name, and you are in the
server. Everything below exists to make that hold up in practice.

## What I've added on top

Stock CS 1.6 assumes a desktop install, a persistent community and people
who already know the game. None of that is true here, so:

- **A lobby that isn't the CS menu.** The stock menu doesn't render in this
  build at all, so the browser page does the job: the ~300MB game download
  with a progress bar (cached after the first visit), name entry, who's on
  the server right now, and the current mode. The engine boots straight into
  the game.
- **Four modes, one URL.** Classic, GunGame, Deathmatch and Aim Prac. Each
  is its own Docker image with its own plugins, maps, bots and
  round pacing. Swapping the whole server takes one command and the address
  never changes.
- **Custom game modes.** Deathmatch is a plugin I wrote, because the usual
  one (CSDM) sig-scans the original game DLL and this stack reimplements it.
  The rest is AMX Mod X tuning: GunGame weapon ladders, per-map weapon
  restrictions, gravity, round timers pitched at a 30-minute
  session rather than a whole evening.
- **Never an empty server.** YaPB bots hold the slots and step out one at a
  time as humans arrive, prefixed `[BOT]` and tuned to be beatable. Classic
  is the exception and ships zero: it is the 5v5 match mode, and its ten
  seats are for people.
- **It handles the browser being a browser.** Backgrounded tabs freeze the
  game loop, so the timeouts on both ends are set to survive an alt-tab
  rather than kicking you. A dropped connection returns to the lobby with a
  reason and a Reconnect button instead of a frozen canvas. Settings persist
  per browser across reloads. The mic is blocked outright, which people were
  otherwise broadcasting into without realising.
- **Remote control.** A live console pipe means maps and settings change
  mid-session with no restart and nobody dropped. The same controls are
  exposed as MCP tools ([server/mcp](server/mcp)), so the server can be
  driven from a chat window.
- **Session tooling.** Scripts that generate the Slack announcements and the
  post-session recap and standings off the server's own kill logs.

## Working on it

The repo is the source of truth. Nothing is hand-edited on the box, every
change goes through `pnpm run deploy`.

| Path       | What                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `server/`  | Everything synced to the VPS, one folder per mode (Dockerfile + compose), plus configs and on-box scripts. See [server/README.md](server/README.md). |
| `apps/web` | The page players hit: download progress, name entry, launches the engine into the same tab.                                   |
| `scripts/` | Local tooling run from your machine over SSH: `deploy`, `logs`, `rc`, `swap`.                                                 |
| `docs/`    | Everything below.                                                                                                             |

```sh
pnpm run deploy            # sync files only, no restart
pnpm run deploy <mod>      # gg | dm | aim | vanilla - swaps the running mode
pnpm run status            # what's running on 27016
pnpm run logs              # tail the live server
pnpm run rc "<cmd>"        # live server console
pnpm run web:dev           # the page, locally
```

`pnpm run deploy`, not `pnpm deploy` - the latter is a reserved pnpm command
that does something else entirely.

## Docs

- [Runbook](docs/runbook.md) - the Friday procedure, start to finish
- [Game guide](docs/game-guide.md) - the modes, chat commands, bot tuning
- [Classic rules](docs/classic-rules.md) - the 5v5 match ruleset, with sources
- [Setup](docs/setup.md) - rebuilding the VPS from scratch
- [Troubleshooting](docs/troubleshooting.md) - this stack fails silently; verify, don't assume
- [Decisions](docs/decisions.md) - why things are the way they are
- [Backlog](docs/backlog.md) - what's next

## Do not commit

`valve.zip`, the extracted Steam files, or any mod archive. They're
copyrighted and ~1GB. The game files live on the server at `/opt/cs16/cs/`;
deploy only syncs configs, Dockerfiles and scripts. `.gitignore` enforces
this, don't work around it.
