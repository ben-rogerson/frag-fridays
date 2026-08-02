# Backlog

Outstanding work, roughly in order. See [troubleshooting.md](troubleshooting.md)
for the constraints that shape most of these (ReAPI incompatibility, no lazy
loading, plugins.ini vs modules.ini).

## 1. Ping retest off hotspot

Retest latency from a real connection. The earlier 75-320ms reading was a
phone hotspot (mobile radio latency plus jitter), not the server. Sydney
should give ~20-30ms.

## 2. Write update-clientcfg.sh + verify join binds

The handover doc referenced `/opt/cs16/update-clientcfg.sh` but it does not
exist on the box - `valve.zip` was built by hand. Write it (server-side script
in the repo: install `userconfig.cfg`, rebuild `valve.zip` with only `valve/`
and `cstrike/` at the archive root, restart the running mod), then verify the
F1/F2 join binds work in-browser.

## 3. Build CSDM (Deathmatch)

Archive is uploaded to `/opt/cs16/src/dm-src`; nothing built. It ships
`csdm_amxx_i386.so`, which is a **module** and registers in
`configs/modules.ini`, not `plugins.ini` - so the GunGame Dockerfile pattern
does not transfer unchanged. Get a file listing of the archive first.

## 4. Add YaPB bots

Decided on: actively maintained, explicit Xash3D support, ~3x faster than
PodBot MM, supports CSDM. Not yet downloaded.

- Installs to `cstrike/addons/yapb/`
- Registers via **Metamod's** `plugins.ini` (a different file from AMXX's)
- Key cvar: `yb_kick_after_player_connect` - drops bots as real players join

## 5. Map voting investigation

Players should vote on maps in-game. Starting point (unverified): AMXX ships
map management plugins in the base install - `mapchooser.amxx` (end-of-map
vote), `nextmap.amxx`, `mapsmenu.amxx` (admin menu), `timeleft.amxx`. Already
in the image; likely just need enabling in `plugins.ini` plus a populated
`configs/maps.ini`. Try these first.

Also evaluate **Galileo** (nominations, runoff voting, map groups) - but
confirm it works on Metamod-P/AMXX 1.9 **without ReAPI** before investing time.

To work out:

- Which vote plugin actually works in this build (do the menus render?)
- How `configs/maps.ini` is populated and kept in sync with what is actually
  bundled in `valve.zip`
- Vote timing - end-of-map vote vs on-demand player-initiated vote

## 6. Fun map rotation

Wanted: a mix of standard and novelty maps. Candidates suited to GunGame and
casual mixed-skill play (small, fast, low-asset):

- `fy_iceworld` - tiny, chaotic, the classic party map
- `fy_snow`, `fy_pool_day` - same idea
- `awp_map`, `aim_map` - pure aim arenas
- `scoutzknivez` - scouts + knives, low gravity, very silly
- `ka_legoland` - knife arena
- `35hp_2` - small and frantic
- `he_glass` - grenade-only chaos
- `rats_*` - oversized household maps, novelty value

**Constraint:** every custom map added to `valve.zip` increases initial load
for all players (no lazy loading). Measure the size cost of a candidate list
before committing; keep the rotation small - maybe 4-6 maps. Stock maps
(`de_dust2`, `cs_office`, `fy_iceworld` if present in the Steam files) cost
nothing extra. Custom maps also need their own assets (textures, models)
bundled, not just the `.bsp`.

## 7. Custom spray / wall tag

Players spray a decal on walls (`impulse 201`, default bind `T`). In GoldSrc
the spray lives in `cstrike/pldecal.wad` (64x64 8-bit WAD); related cvars are
`cl_logofile` and `cl_logocolor`.

- **Limitation:** every client loads the same `valve.zip`, so a bundled
  `pldecal.wad` means everyone shares one spray. Acceptable for the goal (one
  temporary funny image); per-player sprays would need upstream changes.
- **Test plan:** unverified whether the WASM client reads a bundled
  `pldecal.wad` and whether `impulse 201` fires at all in this build. Test
  with a **placeholder WAD first** before any effort goes into the image.
- Also confirm server-side: `sv_allow_upload` / decal cvars may need
  enabling; `mp_decals` controls how many render.
- Use an image with clear rights - a team in-joke or something original, not
  lifted game/brand art.

## 8. Claude server-control skill

The Docker server should be fully controllable by Claude via a skill: start,
stop, swap mods, rebuild, check status, tail logs, update client config,
manage the map rotation.

**Transport must be decided first.** Claude's code-execution sandbox can only
reach an allowlist (package registries, GitHub, api.anthropic.com) - it
cannot SSH to 149.28.172.74. Options:

1. **MCP server on the VPS** - small MCP server wrapping the docker commands,
   exposed as a connector. Most capable; needs auth and a public endpoint.
2. **Claude Code running on the VPS itself** - Claude gets a shell where the
   server lives; the skill becomes documented procedures. Simplest path,
   probably the right first step.
3. **Skill that generates commands** for the user to paste. Works everywhere,
   no infrastructure, but isn't really "controlled by Claude".

Option 1 if it needs to work from the phone/web app.

Whatever the transport, the skill should encode: the directory layout and
one-mod-at-a-time port constraint, the mod-swap procedure with mandatory
`docker ps` verification, the `valve.zip` root-structure rule, the build-time
compile pattern and the `plugins.ini`/`modules.ini` distinction, the ReAPI
incompatibility, the valve.zip rebuild procedure, and the Friday run-book.
(Note: local Claude Code can now SSH to the box directly via the `cs16`
alias, which weakens the case for option 2's VPS install.)

## 9. Web portal / Slack integration (future project)

Not for this Friday. A small web app linked from Slack: vote on maps for the
upcoming session, see the current rotation and what's installed, see the
schedule, see who's signed up (RSVP), possibly live player count / current
map / server-up status.

Design questions for when we get there: hosting (same VPS? static site +
small API?), reading live server state (GoldSrc A2S query protocol, container
logs, or an AMXX status plugin), how votes become map changes (config the
server reads? RCON? scheduled rebuild-and-restart?), auth (open link vs Slack
identity), and a Slack bot that posts the Friday announcement automatically.

**Shared backend opportunity:** the MCP server (item 8) and the web portal
both want the same thing underneath - a small API over docker and server
state. Design once, consume twice.

## 10. IT heads-up

Give IT a heads-up about the public-facing server, if not already done.

## 11. Housekeeping

- Rename the `zp` compose profile to `vanilla`
- Delete the stray `/opt/cs16/dm/valve.zip` (created by a failed run)
- Ensure every compose file uses `restart: unless-stopped` (not `always`)
