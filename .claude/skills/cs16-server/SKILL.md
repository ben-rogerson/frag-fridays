---
name: cs16-server
description: Operate the Frag Fridays CS 1.6 server - run live console commands (change map, cvars) via the cmdpipe remote console, swap mods, restart, check status, tail logs, ship client config, manage maps/rotations, tune bots, verify plugins. Use for any request about the game server, the VPS, valve.zip, GunGame, deathmatch, bots or maps.
---

# CS 1.6 server operations

Browser CS 1.6 (Xash3D-FWGS WASM + WebRTC) on a Vultr VPS. Players join at
`http://149.28.172.74:27016` - constant across all mods. SSH: `cs16` alias
(verify with `ssh cs16 true`; if it fails, see memory note vps-access).

**The prime directive: this stack fails silently - verify, don't assume.**
Full gotcha list: `docs/troubleshooting.md`. Session procedure:
`docs/runbook.md`. Player-facing settings: `docs/game-guide.md`.

## Layout

- Repo `server/` mirrors box `/opt/cs16` 1:1. Never hand-edit the box - edit
  the repo and deploy. `pnpm run pull` re-syncs repo from box.
- Mods: `gg` (GunGame), `dm` (deathmatch, our `frag_dm.sma`), `kz` (jump
  maps, our `kz.sma` - checkpoints/timer, no bots), `vanilla` (root compose,
  profile), `zp` (abandoned). One mod at a time - all bind 27016.
- `/opt/cs16/cs/` = game files tree (SteamCMD install, source of truth,
  never in repo). `/opt/cs16/valve.zip` = the ONE canonical client payload,
  mounted by every mod's compose.

## Commands (from the repo root)

| Task                                             | Command                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                                           | `pnpm run status`                                                                                                                                                                                                                                                                                 |
| Logs                                             | `pnpm run logs <mod>`                                                                                                                                                                                                                                                                             |
| Sync files only                                  | `pnpm run deploy`                                                                                                                                                                                                                                                                                 |
| Swap/restart mod ("swap to gg/dm/kz/vanilla")    | `pnpm run swap <vanilla\|gg\|dm\|kz>` - announces the switch in-game first (when the running mod has cmdpipe), then runs deploy.sh. DROPS all players - never mid-session; still check for a sibling session first (memory: concurrent-sessions). Bare `pnpm run deploy <mod>` skips the announce |
| Ship client config / rebuild valve.zip           | `pnpm run clientcfg`                                                                                                                                                                                                                                                                              |
| Live server console (gg/dm/kz only)              | `pnpm run rc "<command>"`                                                                                                                                                                                                                                                                         |
| Start a map vote ("votemap" / "vote map")        | `pnpm run votemap` - 4 random mapcycle picks (script-side shuffle; never hand-pick maps). Run directly - no status/log checks first                                                                                                                                                               |
| Next map ("next map")                            | `pnpm run nextmap` - one shot: detects mod + current map, announces a 5s amx_csay warning, changelevels to the next mapcycle entry (wraps). Run directly - no status/log checks first                                                                                                             |
| Announce ("announce <msg>" / "tell the players") | `pnpm run announce "message"` - green centre-screen HUD message to all players (amx_csay). Run directly - no status/log checks first                                                                                                                                                              |
| Restart map ("restart map" / "restart the map")  | `pnpm run restartmap` - announces a 5s amx_csay warning, then changelevels to the current map (full reload: entities, timer, scores; players stay connected). Run directly - no status/log checks first                                                                                           |
| Rebalance teams ("rebalance" / "even the teams") | `pnpm run rebalance` - evens the T/CT headcount now (teambalance.amxx, gg/dm only): bots move first, then lowest-frag humans; moved players respawn instantly on the new side, nobody dropped. Run directly - no status/log checks first                                                          |

## Iron rules

1. **After any swap: `docker ps` must show exactly ONE container on 27016.**
   deploy.sh enforces this - never announce a mod without it. Containers look
   identical in-browser (the port-theft incident).
2. **valve.zip root = only `valve/` and `cstrike/`.** It is rebuilt by
   `update-clientcfg.sh` from `cs/{valve,cstrike}` using a keep-list (union
   of mod `mapcycle.txt` files; HL campaign maps always excluded). Client
   changes (userconfig.cfg, new maps) need `pnpm run clientcfg` + players
   hard-refresh. clientcfg RESTARTS the running mod at the end so the new
   zip is served - it drops connected players; don't run it mid-session.
3. **Three registration files, not one:** AMXX plugins -> `configs/plugins.ini`;
   AMXX modules -> `configs/modules.ini`; Metamod plugins (YaPB) -> Metamod's
   own `plugins.ini`. A plugin absent from its file is a silent no-op.
4. **No ReAPI. No binary modules that sig-scan the CS DLL** (killed CSDM).
   Script-only Ham/fakemeta plugins work; engine-interface Metamod plugins
   with explicit Xash3D support (YaPB) work.
5. **Configs are image-baked.** yapb.cfg, gungame.cfg, mapcycle.txt,
   plugins - all COPY'd at build. Editing repo files does nothing until
   `pnpm run deploy <mod>` rebuilds. Only `server/maps/*.bsp` are live-ish
   (compose-mounted into `cstrike/custom/maps`), but adding a map still
   needs the full pipeline below.

## Recipes

**Run commands on the LIVE server:** `pnpm run rc "changelevel de_dust2"`.
No rcon exists on this stack (build answers no A2S/rcon UDP, stdin closed) -
rc.sh writes a serial-numbered file to `/opt/cs16/cmdpipe/` which the
`cmdpipe.amxx` plugin (baked into gg + dm + kz images, NOT vanilla) polls every
second. rc.sh tails docker logs for output, but slow output (map loads) can
outrun its 5s window - re-check with `pnpm run logs <mod>`. Map changes via
`changelevel` don't drop players; a redeploy does.

**Interrogate a mod's console offline** (image not yet deployed) - boot a
throwaway with stdin piped:

```bash
ssh cs16 '( sleep 10; echo "amxx plugins"; sleep 2; echo "quit" ) | \
  docker run -i --rm --platform linux/386 <mod>-xash3d:latest +map de_dust2 +maxplayers 4 \
  2>&1 | grep -aiE "bad load|running|plugins,"'
```

Also useful: `meta list`, `amxx modules`, `status`, `changelevel <map>`.
Use `grep -a` - some files/output trip binary detection.

**Add a map:** (1) verify the download is GoldSrc - first 4 bytes
`1E 00 00 00`; mirrors serve Source `VBSP` files under CS 1.6 names.
(2) Check dependencies (embedded textures vs wad refs vs skyname - python
lump-reader in the decision log; all-stock deps = free; check the box's
game tree before bundling anything, several "custom" skies/sounds are
stock). Non-map client assets (wads, overviews, skies, sounds) go in
`server/custom/` - deploy.sh overlays it onto `cs/cstrike/` and they ride
valve.zip; the server never needs them (verified: wad-referencing maps
boot without their wads). A missing skyname can be byte-patched to a stock
sky (recipe in the decision log). (3) Drop `.bsp` in
`server/maps/`, add to `server/<mod>/mapcycle.txt`. (4) `pnpm run deploy
<mod>` then `pnpm run clientcfg`. (5) Boot-test in a throwaway with the
custom-maps mount and confirm: graph loads, bots rack up kills, zero
`A* Search failed` (a broken graph dead-airs the session - the he_glass
lesson). Boot map = compose `command:` `+map` - keep it equal to
mapcycle line 1.

**Bots:** YaPB config at `server/<mod>/addons/yapb/conf/yapb.cfg` (per-mod
on purpose - dm has `yb_csdm_mode 1`). Verify after restart: logs show
`YaPB ... @ Xash3D Engine` + `Connecting Bot...` lines. Unknown maps are
fine - YaPB downloads community graphs at map start.

**Client config (binds, rates, crosshair):** edit
`server/config/userconfig.cfg`, `pnpm run clientcfg`. The join binds
(F1/F2) live here - they are the only way players join (team menu doesn't
render in-browser).

## Session day

Follow `docs/runbook.md`: bring up the mod, `docker ps` check, three Slack
messages (morning / midday "open the URL now to preload ~300MB" / final call
with F1-F2 + `/guns` instructions) - generate the text with the
`/friday-posts` skill. Don't swap mods mid-session - forces
every player through a reload. Mid-session map changes are fine:
`pnpm run rc "changelevel <map>"` keeps everyone connected.
