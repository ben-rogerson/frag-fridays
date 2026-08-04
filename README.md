# Frag Fridays

Counter-Strike 1.6 in a browser tab, for the weekly Friday work social.
No install, no Steam, no download prompts on the work laptop - open a URL
and you're in. Real GoldSrc compiled to WebAssembly
([yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs))
networked over WebRTC, running on a $6/mo Vultr VPS in Sydney.

**Play:** http://149.28.172.74:27016

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
