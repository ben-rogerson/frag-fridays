# Game guide

How the server plays and how to tune it. Player-facing facts first, then the
knobs. For the session-day procedure see [runbook.md](runbook.md).

## Joining

- URL: `http://149.28.172.74:27016` - same for every mod, laptop browsers
  only (mobile does not work).
- **F1** joins Terrorists, **F2** joins Counter-Terrorists (the team menu
  does not render in the browser). Console fallback (backtick): `jointeam 1`
  then `joinclass 1`.
- First load pulls the whole ~300MB game into browser RAM - tell people to
  open the URL early and let it cache (see runbook, midday reminder).

## Mods

One mod runs at a time; the URL never changes.

| Mod | What it is | Swap to it |
|---|---|---|
| gg | GunGame - new weapon every kill, first to gold knife wins. Deathmatch respawn is on (`gg_dm 1`). | `pnpm run deploy gg` |
| dm | Deathmatch - instant respawn, pick your gun, aim practice (`frag_dm.sma`, ours) | `pnpm run deploy dm` |
| vanilla | Stock CS 1.6 rounds | `pnpm run deploy vanilla` |

### DM gun selection (chat commands)

AMXX menus are unverified in the browser build, so gun choice is chat:

- `/guns` - list options
- `/ak /m4 /awp /mp5 /p90 /scout /shotty /famas` - primary from next spawn
- `/deagle` - pistol only
- Default without choosing: your team's rifle (AK/M4) + deagle. Everyone
  spawns with full armour; ammo refills on every kill.

## Bots (YaPB 4.4.957)

Both gg and dm ship YaPB so the server is never empty. Bots fill to 9 and
leave one-by-one as humans join (`yb_kick_after_player_connect 1`,
`yb_autovacate 1`). Bots are unmistakable on the scoreboard: names are
prefixed `[BOT]` and the ping column shows `BOT` rather than a fake ping.

Config lives per mod in `server/<mod>/addons/yapb/conf/yapb.cfg`. It is
baked into the image, so changes need `pnpm run deploy <mod>` (rebuild +
restart) to take effect. The two mods deliberately have separate copies -
dm runs `yb_csdm_mode 1` (respawn-aware bots), gg does not.

### Difficulty

Current setting (both mods): spread **Noob-Normal** (`yb_difficulty_min 0`,
`yb_difficulty_max 2`), auto-balance OFF - browser-play testing (2026-08-02)
found even the Easy-Hard spread with K/D auto-balance too strong; the
auto-balancer can also buff bots back up when they do well, so it's
deterministic now. `yb_difficulty 1` is the fallback if the spread is turned
off (min/max -1). The upstream default was a flat 3 (Hard: 0.2-0.4s
reaction, 75% headshots, zero aim error).

Scale 0-4, defined in `conf/difficulty.cfg`
(reaction time / headshot % / aim error):

| Level | Name | Reaction | Headshot % | Aim error |
|---|---|---|---|---|
| 0 | Noob | 0.8-1.0s | 5 | large |
| 1 | Easy | 0.6-0.8s | 10 | large |
| 2 | Normal (spread top) | 0.4-0.6s | 50 | moderate |
| 3 | Hard | 0.2-0.4s | 75 | none |
| 4 | Expert | 0.1-0.2s | 100 | none |

To simplify back to one flat level: set `yb_difficulty_min`/`_max` to -1
and `yb_difficulty_auto 0`, then `yb_difficulty` alone applies.

### Other knobs that matter

| Cvar | Current | Notes |
|---|---|---|
| `yb_quota` | 9 | bot count; lower it for tiny maps |
| `yb_quota_mode` | normal | `fill` = top up to quota counting humans; `match` = N bots per human |
| `yb_join_team` | any | force `t`/`ct` to stack one side |
| `yb_chat` / `yb_chat_percent` | 0 / 30 | text-chat banter, off since 2026-08-02 |
| `yb_radio_mode` | 0 | 0 = no radio, 1 = radio, 2 = radio + voice chatter; off since 2026-08-02 |
| `yb_preferred_personality` | none | `rusher` / `careful` / `normal` |
| `yb_random_knife_attacks` | 1 | bots occasionally go for the humiliation knife |
| `yb_camping_allowed` | 1 | set 0 for pure run-and-gun sessions |
| `yb_csdm_mode` | 1 (dm) / 0 (gg) | respawn-aware bot behaviour for DM |
| `yb_name_prefix` | `[BOT]` | every bot name is prefixed, so they're obvious on the scoreboard |
| `yb_show_latency` | 1 | scoreboard ping column shows literal `BOT` instead of a fake ping |

Leave alone: `weapon.cfg` (buy priorities - moot when frag_dm hands out
guns) and voice chatter (`chatter.cfg` needs sound files shipped via
valve.zip). Text chat and radio are both off (`yb_chat 0`,
`yb_radio_mode 0`, 2026-08-02) - bots are fully silent.

### Verifying bots server-side

No player needed: `pnpm run logs <mod>` should show
`YaPB ... successfully loaded ... @ Xash3D Engine` and a stream of
`Connecting Bot...` lines within ~15s of start. For a full console
interrogation (bot list, plugin status) use the throwaway-container trick in
[troubleshooting.md](troubleshooting.md).

## Maps and rotation

The client download only contains the maps in the rotations - valve.zip is
built from a keep-list (union of the mod mapcycles), which cut it from
~437MB to 299MB by dropping the HL campaign maps and unused CS maps. All
rotation maps have bot graphs. Each mod has a curated `mapcycle.txt` in
`server/<mod>/`; changing a rotation takes `pnpm run deploy <mod>` AND
`pnpm run clientcfg` (the map list shapes both the image and the client
zip):

- gg (boots on aim_map): aim_map, dust2, assault, dust, italy, inferno,
  militia, aztec, fy_iceworld, fy_pool_day, scoutzknivez, 35hp_2
- dm (boots on fy_pool_day): fy_pool_day, awp_map, dust2, dust, assault,
  prodigy, nuke, militia, fy_iceworld, aim_map, scoutzknivez, 35hp_2

scoutzknivez runs at `sv_gravity 250` / `sv_airaccelerate 100` via an AMXX
per-map config; every other map resets to stock 800/10 (mechanism in
[decisions.md](decisions.md)). The map itself hands out scout+knife.

The boot map is the compose `command:` (`+map ...`) - keep it matching line 1
of that mod's mapcycle.txt so the rotation flows on from it.

Custom (non-Steam) maps live in `server/maps/` and reach the server via a
compose mount (`cs/cstrike/maps` -> `custom/maps` in the container), so
adding one needs no image rebuild - just the deploy + clientcfg pair.

Maps rotate at `mp_timelimit` (30 min). AMXX's end-of-map vote
(`mapchooser`) is enabled and fires shortly before the limit - whether the
vote menu renders in the browser client is untested. All players can use
`say timeleft` and `say nextmap`. To force a specific map now: edit the
`+map` in the mod's compose `command:` and redeploy (there is no live
console - stdin is closed and rcon is off).

Adding custom maps (fy_iceworld etc) means bundling `.bsp` + assets into
valve.zip - measure the size first; see backlog item 6.

## Admin

One named admin (`admin`, full flags) in both mods' `users.ini`
(`server/<mod>/addons/amxmodx/configs/`, image-baked). Auth from the
browser client console works but the order is load-bearing: `setinfo _pw
"<password>"` FIRST, then `name admin` - AMXX re-auths on the name change and
needs `_pw` already in the userinfo; the reverse order fails with "no
access". Once authed, admin console commands work in the WASM client
(`amx_map <map>` to change map, `amx_who` to check flags) - so a live map
change no longer needs a compose edit + redeploy.

## Shared client config

Every player gets `userconfig.cfg` (join binds, rates, mouse raw input,
crosshair) via valve.zip. Edit `server/config/userconfig.cfg`, then
`pnpm run clientcfg` to bake and ship it - players must hard-refresh the
tab. Full rules in [setup.md](setup.md) and the decision log.
