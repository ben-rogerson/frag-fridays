# Decision log

This project is being chronicled as a multi-entry blog series. This file is
the raw material: notes on every decision point, captured as they happen.
**Update this file whenever a decision is made** - it is far easier to write
down at the time than to reconstruct later.

---

## Why browser-based at all

Original plan was a normal ReHLDS server. Pivoted to WebAssembly because
colleagues on managed work laptops often can't install games - a URL removes
the entire onboarding problem. Trade-off accepted knowingly: browser is
*slower*, and the original brief was "must be fast for players". Zero-install
access beat raw performance for a casual office social.

## The ReAPI dead end

First research pass produced a list of excellent modern mods - ReGG for
GunGame, ReZombiePlague, ReDeathmatch - all built on ReAPI. None work on the
browser stack, which is Xash3D-FWGS + Metamod-P + AMX Mod X. An entire
shortlist invalidated by one architectural fact discovered after the fact.
Lesson: establish the platform constraint *before* researching what runs on it.

## Zombie Plague, abandoned

Picked as the first mod because the upstream repo had an official example. The
example turned out to contain no plugin files at all - just a Dockerfile that
compiles user-supplied source. Combined with ZP's heavy custom models and
sounds fighting the no-lazy-loading constraint, it was dropped for asset-light
GunGame. Two commands were issued against a directory structure that had been
assumed rather than checked.

## Hosting: Vultr Sydney, and not destroying it weekly

Considered spinning the box up and down per session to save money. Rejected -
optimising a $6/month line item against 15 minutes of weekly faff and a 1GB
re-upload. Automatic Backups was silently pre-toggled at $5.60/mo, nearly
doubling the bill for a box holding nothing unrecoverable; turned off in favour
of a single manual snapshot. Hetzner was ~3x cheaper but has no AU datacentre,
which would have added ~250ms.

## Not hosting on the work MacBook

ARM (so the `linux/386` image would run under emulation), has to stay awake and
unslept for the whole session, and it's a corporate device. Ruled out early.

## Ubuntu 24.04 over 26.04

26.04 LTS was available and would have worked. Chose 24.04 anyway: with a WASM
engine, an emulated 32-bit container and an untested mod pipeline already in
play, adding a four-month-old distro to the list of things that could be at
fault wasn't worth the zero upside.

## Three false-alarm diagnostics

Each looked like a failure and wasn't:

1. `uname -m` returning `x86_64` inside a `--platform linux/386` container.
   Looked like missing 32-bit support. `uname` reports the *kernel* arch; the
   container had already run a 32-bit binary successfully.
2. Ping of 75-320ms to a confirmed-Sydney host. Looked like wrong-region
   deployment. Was a phone hotspot - mobile radio latency plus jitter.
3. "GunGame isn't working." Was the vanilla container, which had
   `restart: always` and silently reclaimed port 27016 after a restart. Two
   containers that look identical from the browser.

## The silent-failure class of bug

The recurring theme: this stack fails quietly. A plugin not listed in
`plugins.ini` loads nothing and logs nothing useful. A bind-mount over an empty
host directory masks the image's own files. The wrong container answers on the
right port. Almost every debugging session came down to *verify, don't assume* -
`docker ps`, `amx_plugins`, check the archive root.

## Team select and the F1 bind

The browser build doesn't render the team select menu, so players had to type
`jointeam 1` / `joinclass 1` in console. `mp_autoteambalance` was tried and
doesn't help - it rebalances existing teams rather than assigning unassigned
ones. Solved instead by shipping a `userconfig.cfg` inside `valve.zip` binding
F1/F2, turning a two-command instruction into a single keypress. Removing
friction from the Slack announcement was judged to matter more to turnout than
anything technical.

## valve.zip as a distribution channel

Realising the shared `valve.zip` could carry a client config was the point the
project got easier - it's the mechanism for pushing settings, binds, and now
the spray, to every player at once. Also the reason custom maps are expensive:
same channel, no lazy loading.

## Steam account lockout

SteamCMD logging in from a new datacentre IP triggered Steam's verification
flow, and an earlier wrong answer locked sign-in entirely. The recovery
questionnaire is built around scam pretexts ("collect a free skin", "assist a
Valve employee"), none of which describe downloading files you own. Correct
answers: "Steam client" (SteamCMD *is* the client) and "Other".

## (2026-08-02) Moved into a local pnpm monorepo with deploy script

The project now lives in a local pnpm monorepo, developed on the MacBook and
pushed to the server with a deploy script - nothing configured by hand on the
box any more.

## (2026-08-02) Repo excludes game files and valve.zip

The Steam game files, `valve.zip` and downloaded mod archives stay out of the
repo - copyrighted, ~1GB, and would need Git LFS. The deploy script assumes
game files already exist on the server and only syncs config, Dockerfiles and
scripts.

## (2026-08-02) Monorepo layout: apps/ and packages/

Chose an `apps/` + `packages/` monorepo layout to make room for the future
web portal and Slack integration alongside the server config, rather than
restructuring later.

## Repo seeded from the live box, not the handover doc (2026-08-02)

Pulling the real files revealed the handover doc had drifted from reality:
`update-clientcfg.sh` never existed (valve.zip was built by hand), the root
compose was already profile-based with an empty `mods/` bind-mount scheme,
and `/opt/cs16` doubles as the SteamCMD install dir. Decision: the repo
mirrors the box's actual layout 1:1 (`pnpm run pull` re-syncs it) rather than
imposing a tidier invented one - less to migrate, nothing to break on a
working server two file-moves before a Friday.

## Housekeeping applied via first deploy (2026-08-02)

`restart: always` changed to `unless-stopped` in all three mod compose files
(the port-theft incident), root compose service renamed `zp` to `vanilla` to
match its profile, stray 438MB `dm/valve.zip` deleted from the box.
