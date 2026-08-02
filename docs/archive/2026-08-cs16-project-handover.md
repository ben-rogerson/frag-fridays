# CS 1.6 Browser Server — Project Handover

Context document for continuing this project in a new conversation.

---

## What this is

A browser-playable Counter-Strike 1.6 server for a weekly Friday afternoon
work social. No install, no Steam account needed for players — they open a URL
and play. Hosted on a cheap VPS.

**Player URL:** `http://149.28.172.74:27016`

---

## Infrastructure (built and working)

| Item | Detail |
|---|---|
| Host | Vultr Cloud Compute, **Sydney** region |
| OS | Ubuntu (24.04 LTS recommended path) |
| Cost | ~$5–6/month. Automatic Backups deliberately OFF (was $5.60/mo default-on) |
| Access | SSH keys only |
| Snapshot | Taken after GunGame was working — this is the rollback point |
| Firewall | 22/tcp (should be restricted to admin IP), 27016/tcp, 27018/tcp+udp |

**Verified:** the host runs 32-bit containers correctly (the image is
`linux/386`). Note that `uname -m` inside a `--platform linux/386` container
still reports `x86_64` — that is normal, not a fault. The correct check is
`docker image inspect i386/alpine --format '{{.Architecture}}'` → `386`.

---

## Software stack

Built on **[yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs)**
— CS 1.6 compiled to WebAssembly, networked over WebRTC, played in-browser.
MIT licensed, actively maintained (latest release June 2026).

Image used: `yohimik/cs-web-server-metpamx:latest`

**Critical constraint:** this stack is **Xash3D-FWGS + Metamod-P + AMX Mod X
1.9**. It is *not* ReHLDS / ReGameDLL / ReAPI. Any mod or plugin requiring
ReAPI natives **will not work**. All plugins must be classic
Metamod-P/AMXX-era. This ruled out several otherwise-good modern mods.

---

## Directory layout on the server

```
/opt/cs16/
├── cs/                      # SteamCMD install (source of truth for game files)
│   ├── valve/
│   └── cstrike/
│       └── userconfig.cfg   # shared client config, ships to all players
├── docker-compose.yml       # vanilla server (profile: was "zp", renaming to "vanilla")
├── update-clientcfg.sh      # writes client cfg, rebuilds valve.zip, restarts
├── src/                     # downloaded mod archives
│   ├── gg-src/
│   └── dm-src/
├── gg/                      # GunGame — WORKING
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── addons/
│   └── valve.zip
└── dm/                      # CSDM — NOT BUILT YET
    ├── docker-compose.yml
    └── valve.zip            # stray, created by a failed run
```

---

## Current state

### Working
- **Vanilla CS 1.6** in browser — tested, playable, from two machines
- **GunGame** — built, `gungame.amxx` loaded and confirmed in `plugins.ini`,
  config exec'ing at startup, sounds bundled into `valve.zip`
- **Shared client config** via `cstrike/userconfig.cfg` inside `valve.zip` —
  applies to every player (autoswitch, fastswitch, performance cvars,
  crosshair, F1/F2 join binds)

### Not done
- **CSDM / Deathmatch** — archive uploaded to `/opt/cs16/src/dm-src`, nothing
  built. Ships `csdm_amxx_i386.so`, which is a **module** and registers in
  `configs/modules.ini`, not `plugins.ini` — so the GunGame Dockerfile pattern
  does not transfer unchanged.
- **YaPB bots** — decided on (actively maintained, explicit Xash3D support,
  ~3x faster than PodBot MM, supports CSDM). Not downloaded. Installs to
  `cstrike/addons/yapb/` and registers via **Metamod's** `plugins.ini`, a
  different file from AMXX's. Key cvar: `yb_kick_after_player_connect` to drop
  bots as real players join.
- **Map voting** — see requirements below
- **Ping retest** off mobile hotspot (earlier 75–320ms reading was the
  hotspot, not the server; Sydney should give ~20–30ms)
- Housekeeping: rename `zp` profile to `vanilla`; delete stray `/opt/cs16/dm/valve.zip`

### Abandoned
- **Zombie Plague** — the upstream example ships no plugin files (just a
  Dockerfile that compiles user-supplied source), and ZP's custom models/sounds
  would significantly inflate `valve.zip`. Dropped in favour of asset-light modes.

---

## How mods work here (important)

The Dockerfile pattern **compiles plugins at build time**:

```dockerfile
FROM yohimik/cs-web-server-metpamx:latest
COPY addons cstrike/addons
USER root
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/ \
 && grep -qx 'gungame.amxx' ../configs/plugins.ini || echo 'gungame.amxx' >> ../configs/plugins.ini
USER xashds
```

Consequences:
- Each mod is **its own image and directory**, not a swapped bind-mount
- `COPY` merges rather than replaces, so base-image tooling survives
- **A `.amxx` in `plugins/` does nothing unless listed in `plugins.ini`** —
  this caused a silent no-op failure earlier
- Only one mod runs at a time (all bind port 27016, so the player URL is constant)

**Swapping mods:**
```bash
cd /opt/cs16/gg && docker compose down
cd /opt/cs16/dm && docker compose up -d
docker ps --format '{{.Names}}'   # always verify — containers look identical in-browser
```

---

## Known gotchas (learned the hard way)

1. **Team select menu does not render** in the browser build. Players must
   either press F1/F2 (via the shipped `userconfig.cfg` binds) or type
   `jointeam 1` then `joinclass 1` in console (backtick key).
   `mp_autoteambalance` does **not** solve this — it rebalances existing teams,
   it doesn't assign unassigned players.
2. **No lazy loading.** The entire game filesystem loads into browser RAM on
   first join. Every custom asset added to `valve.zip` increases load time for
   every player. This is the main constraint on mod and map selection.
3. **`valve.zip` structure is fragile.** Root must contain *only* `valve/` and
   `cstrike/`. Nesting is the most common boot failure.
4. **`restart: always` bites.** The vanilla container silently reclaimed port
   27016 after a reboot, so the "GunGame" server was actually vanilla. Use
   `restart: unless-stopped` and always confirm with `docker ps` before announcing.
5. **Not all cvars exist** in this WASM build (`cl_himodels`, `v_dark` are
   reported unknown). Unknown cvars are ignored harmlessly, but don't assume a
   setting took effect — verify in console.
6. **Mobile browsers don't work** (text input isn't real HTML input). Laptop only.
7. **Steam account lockout risk** — SteamCMD from a new IP triggers verification.
   Answer "Steam client" (SteamCMD *is* the Steam client) and "Other".

---

## NEW REQUIREMENT: Map voting

Players should be able to vote on maps in-game.

**Starting point (needs verification, not yet tested):** AMX Mod X ships map
management plugins in its base install — `mapchooser.amxx` (end-of-map vote),
`nextmap.amxx`, `mapsmenu.amxx` (admin map menu), and `timeleft.amxx`. These
are already in the image; they likely just need enabling in `plugins.ini` and
a populated `configs/maps.ini`.

Also worth evaluating: **Galileo**, a more capable AMXX map manager with
nominations, runoff voting and map groups. Needs confirming it works on
Metamod-P/AMXX 1.9 without ReAPI.

Things to work out:
- Which vote plugin actually works in this build
- How the map list is populated (`configs/maps.ini`) and kept in sync with
  what's actually bundled in `valve.zip`
- Vote timing — end-of-map vote vs. on-demand player-initiated vote

---

## NEW REQUIREMENT: Fun map rotation

Wanted: a mix of standard and novelty maps. Candidates suited to GunGame and
casual mixed-skill play (small, fast, low-asset):

- `fy_iceworld` — tiny, chaotic, the classic party map
- `fy_snow`, `fy_pool_day` — same idea
- `awp_map`, `aim_map` — pure aim arenas
- `scoutzknivez` — scouts + knives, low gravity, very silly
- `ka_legoland` — knife arena
- `35hp_2` — small and frantic
- `he_glass` — grenade-only chaos
- `rats_*` — oversized household maps, novelty value

**Constraint to respect:** every custom map added to `valve.zip` increases the
initial load for all players (point 2 above). Recommend measuring the size cost
of a candidate list before committing, and keeping the rotation small —
maybe 4–6 maps. Stock maps (`de_dust2`, `cs_office`, `fy_iceworld` if present
in the Steam files) cost nothing extra.

Custom maps also need their own assets (textures, models) bundled, not just
the `.bsp`.

---

## NEW REQUIREMENT: Claude skill for server control

The Docker server should be fully controllable by Claude via a skill — start,
stop, swap mods, rebuild, check status, tail logs, update client config,
manage the map rotation.

**Architectural constraint to solve first.** Claude's code-execution sandbox
has network access only to an allowlist (package registries, GitHub,
api.anthropic.com). It **cannot SSH to 149.28.172.74**. So a skill cannot
directly drive the VPS from a normal chat session. Options:

1. **MCP server on the VPS** — write a small MCP server that wraps the docker
   commands and expose it as a connector. Claude then calls real tools against
   the live host. Most capable option; needs auth and a public endpoint.
   (`/mnt/skills/examples/mcp-builder/` has guidance for this.)
2. **Claude Code running on the VPS itself** — Claude gets a shell where the
   server actually lives. Simplest path to "fully controlled", and the skill
   becomes a set of documented procedures rather than a remote-control layer.
3. **Skill that generates commands** — Claude produces the exact command block
   and the user pastes it. Works everywhere, no infrastructure, but it isn't
   really "controlled by Claude".

Option 2 is probably the right first step; option 1 if it needs to work from
the phone/web app.

**What the skill should encode** (regardless of transport):
- The directory layout and one-mod-at-a-time port constraint
- Mod swap procedure, including the mandatory `docker ps` verification
- The `valve.zip` root-structure rule
- The build-time compile pattern and the `plugins.ini` / `modules.ini` distinction
- The ReAPI incompatibility (so it never suggests an incompatible mod)
- `update-clientcfg.sh` usage
- Friday run-book: bring up mod, verify, post Slack messages

---

## NEW REQUIREMENT: Custom spray / wall tag

Players should be able to spray a custom decal on walls (`impulse 201`,
default bind `T` in most configs).

**How it works in GoldSrc:** the player's spray lives in
`cstrike/pldecal.wad` — a 64×64 8-bit WAD file. Related cvars are
`cl_logofile` and `cl_logocolor`.

**Consequence of this stack:** every client loads the same filesystem from
`valve.zip`, so a bundled `pldecal.wad` means **everyone shares one spray**.
That's acceptable for the stated goal (one temporary funny gaming image), but
per-player sprays would need a different mechanism entirely — likely not
achievable here without upstream changes.

**Unverified.** Whether the WASM client reads a bundled `pldecal.wad` and
whether `impulse 201` fires at all in this build both need testing before any
work goes into making the image. Test with any placeholder WAD first.

Also worth confirming server-side: `sv_allow_upload` / decal-related cvars may
need enabling, and `mp_decals` controls how many render.

Use an image you have the rights to — a team in-joke or something original
rather than lifted game or brand art.

---

## NEW REQUIREMENT: GitHub repo + deploy script

The project becomes a repo, developed locally on the MacBook and pushed to the
server with a deploy script. Nothing configured by hand on the box any more.

Should be in the repo:
- `docker-compose.yml` per mod
- `Dockerfile` per mod
- `config/` — client config, server configs, map lists
- `scripts/` — `deploy.sh`, `update-clientcfg.sh`, mod-swap helpers
- `docs/` — setup, run-book, troubleshooting
- `README.md` — what this is, how to run it

**Must NOT be in the repo:** `valve.zip` and the extracted Steam game files
(copyrighted, ~1GB, and would need Git LFS). Same for downloaded mod archives.
The deploy script should assume game files already exist on the server and
only sync config, Dockerfiles and scripts.

`deploy.sh` should broadly: rsync the repo to the server, rebuild the target
mod image, restart it, and verify with `docker ps`.

**Documentation is a first-class requirement.** Everything simple to
understand and documented — this is a project someone else (or the author in
six months) should be able to pick up from the repo alone.

---

## FUTURE PROJECT: Web portal / automation

Longer-term goal, not for this Friday. A small web app linked from Slack where
players can:

- **Vote on maps** for the upcoming session
- **See the current map rotation** and what's installed
- **See the schedule** — when sessions run, what mode is up
- **See who's playing / who's signed up** (RSVP)
- Possibly: live player count, current map, "server is up" status

Design considerations to think about when we get there:
- Where it's hosted (same VPS? separate? static site + small API?)
- How it reads live server state (GoldSrc A2S query protocol on the game port,
  or parsing container logs, or an AMXX plugin exposing status)
- How votes translate into actual map changes (write to a config the server
  reads? RCON? scheduled job that rebuilds and restarts?)
- Auth — is it open to anyone with the link, or tied to Slack identity?
- Slack integration — a bot that posts the announcement automatically on
  Friday mornings rather than manual posting

**Shared backend opportunity.** The MCP server (for Claude control) and the
web portal both want the same thing underneath: a small API over the docker
and server state. Worth designing once and consuming twice rather than
building two half-overlapping things.

---

## Blog decision log

The project is being chronicled as a multi-entry blog. Notes on every decision
point, kept as they happen. Reconstructed so far:

### Why browser-based at all
Original plan was a normal ReHLDS server. Pivoted to WebAssembly because
colleagues on managed work laptops often can't install games — a URL removes
the entire onboarding problem. Trade-off accepted knowingly: browser is
*slower*, and the original brief was "must be fast for players". Zero-install
access beat raw performance for a casual office social.

### The ReAPI dead end
First research pass produced a list of excellent modern mods — ReGG for
GunGame, ReZombiePlague, ReDeathmatch — all built on ReAPI. None work on the
browser stack, which is Xash3D-FWGS + Metamod-P + AMX Mod X. An entire
shortlist invalidated by one architectural fact discovered after the fact.
Lesson: establish the platform constraint *before* researching what runs on it.

### Zombie Plague, abandoned
Picked as the first mod because the upstream repo had an official example. The
example turned out to contain no plugin files at all — just a Dockerfile that
compiles user-supplied source. Combined with ZP's heavy custom models and
sounds fighting the no-lazy-loading constraint, it was dropped for asset-light
GunGame. Two commands were issued against a directory structure that had been
assumed rather than checked.

### Hosting: Vultr Sydney, and not destroying it weekly
Considered spinning the box up and down per session to save money. Rejected —
optimising a $6/month line item against 15 minutes of weekly faff and a 1GB
re-upload. Automatic Backups was silently pre-toggled at $5.60/mo, nearly
doubling the bill for a box holding nothing unrecoverable; turned off in favour
of a single manual snapshot. Hetzner was ~3x cheaper but has no AU datacentre,
which would have added ~250ms.

### Not hosting on the work MacBook
ARM (so the `linux/386` image would run under emulation), has to stay awake and
unslept for the whole session, and it's a corporate device. Ruled out early.

### Ubuntu 24.04 over 26.04
26.04 LTS was available and would have worked. Chose 24.04 anyway: with a WASM
engine, an emulated 32-bit container and an untested mod pipeline already in
play, adding a four-month-old distro to the list of things that could be at
fault wasn't worth the zero upside.

### Three false-alarm diagnostics
Each looked like a failure and wasn't:
1. `uname -m` returning `x86_64` inside a `--platform linux/386` container.
   Looked like missing 32-bit support. `uname` reports the *kernel* arch; the
   container had already run a 32-bit binary successfully.
2. Ping of 75–320ms to a confirmed-Sydney host. Looked like wrong-region
   deployment. Was a phone hotspot — mobile radio latency plus jitter.
3. "GunGame isn't working." Was the vanilla container, which had
   `restart: always` and silently reclaimed port 27016 after a restart. Two
   containers that look identical from the browser.

### The silent-failure class of bug
The recurring theme: this stack fails quietly. A plugin not listed in
`plugins.ini` loads nothing and logs nothing useful. A bind-mount over an empty
host directory masks the image's own files. The wrong container answers on the
right port. Almost every debugging session came down to *verify, don't assume* —
`docker ps`, `amx_plugins`, check the archive root.

### Team select and the F1 bind
The browser build doesn't render the team select menu, so players had to type
`jointeam 1` / `joinclass 1` in console. `mp_autoteambalance` was tried and
doesn't help — it rebalances existing teams rather than assigning unassigned
ones. Solved instead by shipping a `userconfig.cfg` inside `valve.zip` binding
F1/F2, turning a two-command instruction into a single keypress. Removing
friction from the Slack announcement was judged to matter more to turnout than
anything technical.

### valve.zip as a distribution channel
Realising the shared `valve.zip` could carry a client config was the point the
project got easier — it's the mechanism for pushing settings, binds, and now
the spray, to every player at once. Also the reason custom maps are expensive:
same channel, no lazy loading.

### Steam account lockout
SteamCMD logging in from a new datacentre IP triggered Steam's verification
flow, and an earlier wrong answer locked sign-in entirely. The recovery
questionnaire is built around scam pretexts ("collect a free skin", "assist a
Valve employee"), none of which describe downloading files you own. Correct
answers: "Steam client" (SteamCMD *is* the client) and "Other".

---

## Slack announcement pattern

Three messages on Friday: morning announcement, midday reminder (asks people to
pre-load the game so the first-load delay doesn't eat the start time), and a
30-minutes-before final call with the connect steps.

The midday "open it now to warm the load" message does real work given the
no-lazy-loading constraint.

Join instructions must be included — currently "press F1 to join T, F2 for CT",
or the console fallback.

---

## Immediate next steps

1. Retest ping off mobile hotspot to confirm real latency
2. Run `/opt/cs16/update-clientcfg.sh gg` and verify F1/F2 join binds work
3. Build CSDM (needs `modules.ini` handling — get file listing first)
4. Add YaPB bots
5. Investigate map voting — which plugin, and whether menus render
6. Choose and bundle a small fun-map rotation
7. Test whether custom sprays work at all (placeholder WAD) before designing one
8. Move the whole project into a GitHub repo with a `deploy.sh`
9. Build the Claude skill for server control (decide transport first — see above)
10. Housekeeping: profile rename, stray valve.zip cleanup, `restart: unless-stopped`

**Ongoing:** keep the decision log updated as choices are made — it's the raw
material for the blog, and it's much easier to write down at the time than
reconstruct later.

**Also outstanding:** give IT a heads-up about the public-facing server, if not
already done.
