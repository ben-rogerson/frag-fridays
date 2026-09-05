# Game guide

How the server plays and how to tune it. Player-facing facts first, then the
knobs. For the session-day procedure see [runbook.md](runbook.md).

## Joining

- URL: `http://149.28.172.74:27016` - same for every mod, laptop browsers
  only (mobile does not work).
- **F1** joins Terrorists, **F2** joins Counter-Terrorists. The team menu
  does render (as a numbered text menu), so the binds are a convenience
  rather than the only way in. Console fallback (backtick): `jointeam 1`
  then `joinclass 1`.
- First load pulls the whole ~300MB game into browser RAM - tell people to
  open the URL early and let it cache (see runbook, midday reminder).

## Radio

**Z**, **X** and **C** open the three stock radio menus; pick with the number
keys, `0` closes.

| Key | Menu | Contains |
|---|---|---|
| Z | Radio Commands | cover me, take the point, hold this position, regroup, follow me, taking fire |
| X | Group Radio Commands | go, fall back, stick together, get in position, storm the front, report in |
| C | Radio Responses/Reports | affirmative, enemy spotted, need backup, sector clear, in position, reporting in, she's gonna blow, negative, enemy down |

The menus need two cvars in `userconfig.cfg` and are dead without either
(fixed 2026-08-30, verified in-browser on gg/de_inferno):

- `setinfo "_vgui_menus" "0"` - otherwise the server answers `radio1/2/3`
  with a VGUIMenu message, and cs16-client's `ShowVGUIMenu` has no case for
  `MENU_RADIOA/B/C`. It falls through to `exec touch/radioa.cfg`, a
  mobile-only config that is not in the game tree (and `exec` is a no-op in
  this build regardless).
- `_extended_menus 0` - `CHudMenu::MsgFunc_ShowMenu` special-cases any menu
  string starting `#Radio` and hands it straight back to those same dead
  touch configs while this is on. It changes nothing else: every non-radio
  menu takes the same branch either way.

Menu text is stock `cstrike/titles.txt` (`RadioA`/`RadioB`/`RadioC`).

## Mods

One mod runs at a time; the URL never changes.

| Mod | What it is | Swap to it |
|---|---|---|
| gg | GunGame - new weapon every kill, first to gold knife wins. Deathmatch respawn is on (`gg_dm 1`). | `pnpm run deploy gg` |
| dm | Deathmatch - instant respawn, pick your gun, aim practice (`frag_dm.sma`, ours) | `pnpm run deploy dm` |
| vanilla | Classic - 5v5 competition rules, no bots by default. The match mode; full ruleset and sources in [classic-rules.md](classic-rules.md) | `pnpm run deploy vanilla` |

### DM gun selection (chat commands)

Gun choice is chat. That predates knowing AMXX menus render fine in the
browser (the map vote menu proved it, 2026-08-02); it was never revisited,
not ruled out:

- `/guns` - list options
- Rifles `/ak /m4 /aug /sg552 /galil /famas`, snipers `/awp /scout`,
  SMGs `/mp5 /p90 /mac10 /tmp /ump`, shotguns `/shotty /m3`, LMG `/para` -
  primary from next spawn
- `/deagle` - pistol only
- `/respawn` - back in the game now, if you are dead. Use this rather than
  `/restart`, which restarts the round for the whole server.

**Anything reasonable is accepted.** The prefix can be `/`, `!`, `.` or
nothing at all (`ak`, `!awp`, `.m4`, `guns ak` all work), case is ignored,
and the common second names resolve: `m4a1`/`m4a4`/`colt` to `/m4`,
`ak47`/`kalash` to `/ak`, `sniper`/`awm` to `/awp`, `bullpup` to `/aug`,
`krieg` to `/sg552`, `uzi` to `/mac10`, `m249` to `/para`, and so on. This
came out of reading the logs (2026-09-05): 76 of the 254 commands players
had ever typed did nothing, and most of them were a word we knew in a shape
we rejected.

Pistol picks (`/glock`, `/fn`) are NOT in - the deagle is hardcoded as
everyone's sidearm and `/deagle` already means "no rifle", so the two
meanings share one slot. Asking gets you an explanation rather than
silence.
- Default without choosing: your team's rifle (AK/M4) + deagle. Everyone
  spawns with full armour; ammo refills on every kill.
- Exception: aim_map uses its own floor guns (`dm_map_guns`, per-map
  config) - you spawn deagle-only and grab an AK/M4/AWP off the floor;
  dropped rifles stay on the ground so the map's guns keep circulating.

## Bots (YaPB 4.4.957)

Both gg and dm ship YaPB so the server is never empty. `yb_quota_mode fill`
with `yb_quota 10` keeps the *total* headcount at 10 (5v5): 10 bots on an
empty server, each human that joins displaces one bot, zero bots once 10
humans are in. (The previous `normal` mode meant "always 7 bots" - `yb_autovacate` /
`yb_kick_after_player_connect` only kick to free a slot, so with 16 slots
bots hung around until the 8th human. Changed 2026-08-21.) Bots are unmistakable on the scoreboard: names are
prefixed `[BOT]` and the ping column shows `BOT` rather than a fake ping.

**Bots keep out of the way of a map change** (changed 2026-09-04, after they
locked a session out of one - see [troubleshooting.md](troubleshooting.md)).
`yb_join_delay 20` holds them off for the first 20 seconds of every new map,
which is the window the humans need to carry over into it, so the server
looks a little thin for that first 20s on purpose.
`yb_autovacate_keep_slots 4` keeps four slots free on top of that, but only
against players the server can SEE: YaPB works out its reserve from its own
headcount, and a client stuck mid-map-change is missing from that count for
the same reason it is missing from the scoreboard (measured 2026-09-04, see
troubleshooting.md). Treat it as headroom for a busy night, not as the
map-change guard - the guard is the join delay, and the war room's map button
clearing the bots outright if it catches the lockout. Neither cvar changes the
fill behaviour above: the ceiling they imply is 12 and the quota is 10, so on
any normal night they never bind.

Config lives per mod in `server/<mod>/addons/yapb/conf/yapb.cfg`. It is
baked into the image, so changes need `pnpm run deploy <mod>` (rebuild +
restart) to take effect. The two mods deliberately have separate copies -
dm runs `yb_csdm_mode 1` (respawn-aware bots), gg does not.

### Classic is the exception: zero bots

Classic is a 5v5 match mode, so its copy (`server/vanilla/yapb.cfg`) ships
`yb_quota "0"` and nothing else differs from gg's. Bots are fully supported
there, just not on by default:

- **Add them:** war room Bots panel (`/#/warroom`), or `pnpm run rc
  "yb_quota 6"`. Quota is a total headcount in `fill` mode, so 6 means six
  players including whoever is already in.
- **Take them away:** the panel's "Clear all bots", or `pnpm run rc
  "yb_quota 0; yb kickall"`.
- **A restart always lands back on zero.** `yb_quota` is a live cvar with no
  persistence of its own, and YaPB re-reads `conf/yapb.cfg` when it loads, so
  a container restart, a redeploy or a box reboot all return to an empty
  server. There is no state anywhere that can leave bots in a match.
- `yb_ignore_cvars_on_changelevel "yb_quota,yb_autovacate"` means a quota set
  live SURVIVES a map change - deliberate, so a practice fill is not undone
  mid-session. Only a restart clears it. **Except zero**: YaPB special-cases a
  quota of 0 and lets the config value back in on changelevel, so "Clear all
  bots" undoes itself at the next map (both measured 2026-09-04).
- Classic runs 12 slots (`+maxplayers 12` in the root compose): 5v5 plus two
  spare. With quota 0 no bot can ever be holding a seat when the tenth person
  arrives.

Vanilla mounts the YaPB tree from `/opt/cs16/mods/yapb` rather than baking it
(it runs the stock image unbuilt), and the root compose mounts
`server/vanilla/yapb.cfg` over `conf/yapb.cfg` so the zero default is under
version control rather than a hand-edit on the box.

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
| `yb_quota` | 10 | target total players in `fill` mode (bot count in `normal`); lower it for tiny maps |
| `yb_quota_mode` | fill | `fill` = top up to quota counting humans (bots leave as humans arrive); `normal` = fixed bot count, only vacate when slots run out; `match` = N bots per human |
| `yb_join_delay` | 20.0 | seconds before bots start joining after a changelevel; max 30. Raised from 5 so the humans carry over first |
| `yb_autovacate_keep_slots` | 4 (2 on Classic, 1 on aim) | slots not given to bots, counted against players YaPB can SEE; max 8. Classic's 12 slots take 2 so the ceiling lands on 5v5; aim keeps 8 free by arithmetic instead (24 slots, 16 fixed bots) |
| `yb_ignore_cvars_on_changelevel` | `yb_quota,yb_autovacate` | those two survive a changelevel, so a non-zero quota poked at runtime sticks until the container restarts and yapb.cfg's value is NOT authoritative on a long-running box. A quota of 0 is exempt and comes back at the next map |
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

- gg: aim_map, dust2, assault, dust, italy, inferno, cs_office, aztec,
  cbble, fy_iceworld, fy_pool_day, scoutzknivez, de_rats, de_train,
  cs_prospeedball, cs_deagle5
- dm: fy_pool_day, dust2, dust, assault, nuke, cbble, cs_office,
  fy_iceworld, aim_map, scoutzknivez, de_rats, de_train,
  cs_prospeedball, cs_deagle5
- vanilla (Classic): dust2, inferno, nuke, de_train, cbble, aztec, dust - the
  era's competition pool, cut to maps already in the client payload (no
  hostage map was ever in one; the CPL and CEVO customs are not on this box).
  Every map it dropped (italy, assault, cs_office, cs_prospeedball,
  cs_deagle5) is still in gg's and dm's cycles, so the valve.zip keep-list
  (the union) is unchanged and this needed no `clientcfg`.

scoutzknivez runs at `sv_gravity 250` / `sv_airaccelerate 100` via an AMXX
per-map config; every other map resets to stock 800/10 (mechanism in
[decisions.md](decisions.md)).

One-weapon maps (cs_deagle5 = deagle, scoutzknivez = scout): each strips
players on spawn, equips its weapon via game_player_equip and sets
info_map_parameters `buying 3` - which this stack's DLL ignores, so buying
stays possible unless blocked server-side.
On dm the `dm_only` cvar (per-map configs, frag_dm.sma) replaces the DM
kit with the map's weapon and strips anything else the moment it is
deployed. On vanilla, restmenu.amxx (enabled box-side in
`mods/zp/configs/plugins.ini`) blocks the buy commands via
`amx_restrict on` in per-map configs, reset by `amx_restrict off` in
amxx.cfg every map start. Neither one-weapon map is in Classic's pool any
more, but the `amx_restrict off` reset stays in `server/vanilla/amxx.cfg`
because a restriction left set by a per-map config would otherwise follow
the server into the next map.

The boot map is the compose `command:` (`+map ...`) - keep it matching line 1
of that mod's mapcycle.txt so the rotation flows on from it.

Custom (non-Steam) maps live in `server/maps/` and reach the server via a
compose mount (`cs/cstrike/maps` -> `custom/maps` in the container), so
adding one needs no image rebuild - just the deploy + clientcfg pair.

Maps rotate at `mp_timelimit`, which each mode sets for itself - the
deathmatch-family modes (Deathmatch, Source Maps, Fight Yard, Aim Prac,
Sniper) run 10 minutes, set from `frag_dm.sma` rather than any config file -
on every mode except **Classic**,
which runs `mp_timelimit 0` - no map clock at all, because a match must not
be cut off mid-half. Its map changes when the half ends
(`mp_maxrounds 15`); see [classic-rules.md](classic-rules.md). Classic's
cvars used to come from box-side `mods/zp/configs/amxx.cfg`, which AMXX execs
at every map start while `server.cfg` execs only at container start - so it
silently overrode `server/vanilla/server.cfg` for the life of every container
(the full exec order is in [troubleshooting.md](troubleshooting.md)). The repo
now mounts an `amxx.cfg` that sets no gameplay cvar and ends with
`exec server.cfg`, so server.cfg is the ruleset and re-applies every map.
AMXX's end-of-map vote
(`mapchooser`) is enabled and fires shortly before the limit - whether the
vote menu renders in the browser client is untested. All players can use
`say timeleft` and `say nextmap`. To force a specific map now:
`pnpm run rc "changelevel de_dust2"` - no restart, no player drop (the
cmdpipe plugin; see troubleshooting.md, there is still no real rcon).

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

## Per-player settings persist across visits

A player's own tweaks (sensitivity, volume, `cl_righthand`, custom binds -
anything that lands in `config.cfg`) survive page reloads. The client diffs
the engine's cfg files against a boot-time baseline and saves only the
changed lines to localStorage (`ff-settings-v2`) every 30s in-game, plus
whenever the tab hides or closes, and replays them on the next launch
(`apps/web/src/launch.ts`, `persistSettings`).

- Per browser, per device. Different browser or cleared site data = back
  to the shipped defaults. Nothing is stored server-side.
- The lobby name field wins over the saved config's `name`.
- The replay is line-by-line `Cmd_ExecuteString` - the engine's `exec`
  does not work in the browser build (see troubleshooting).
- Only deviations from the shipped defaults persist. Shipping a new
  `userconfig.cfg` value reaches every returning player automatically,
  UNLESS they deliberately changed that exact setting - their change wins.
- **A saved `r_decals` can only ever go DOWN.** The engine clamps it to
  `mp_decals` at every level load, and `userconfig.cfg` ships that ceiling at
  4096, so the decals control on the settings page can reduce but never raise
  (measured 2026-09-05, see troubleshooting).
- History: v1 (`ff-settings`) snapshotted the full `host_writeconfig`
  archive (~300 cvars), which pinned stale copies of shipped defaults -
  returning players never received `cl_bob 0` or the xhair crosshair
  (2026-08-03). v1 keys are deleted on launch; those players' old tweaks
  reset to shipped defaults once.

## Drop screen

If the connection dies, the lobby overlay returns with a reason and a
Reconnect button instead of a frozen game. Two detectors in
`apps/web/src/webrtc.ts`: WebRTC transport death (container restart, network
gone - Reconnect does a full page reload) and a 10s packet-silence watchdog
(kicked / timed out / server shutdown - Reconnect does an in-engine `retry`,
no re-download). Kicking a player is therefore safe to demo: they get a
Reconnect button, not a dead tab.

The in-engine retry gets exactly one shot: a WebRTC transport can go
zombie (laptop sleep, network switch, wedged relay) while the channel
still reports open and the peer connected, so a retry sent into it just
vanishes and the watchdog brings the drop screen back 10s later. If that
happens - the retry got no packet back before the next drop - the next
Reconnect click stops trusting the transport and does a full page reload,
which rebuilds the websocket + WebRTC session from scratch (cheap: on the
https origin valve.zip re-reads from Cache Storage, no re-download).
Any answered retry re-earns trust, so a later unrelated drop starts with
the fast in-engine path again.

## Coming back after a crash

Close the tab normally and the page hands the slot back straight away
(`leaveServer()` on `pagehide`). Kill the browser, force-quit, or lose the
machine and it cannot - the engine holds that session, its slot and its name
for `sv_timeout` (600s), which is why a rejoin used to arrive as
`Reversons (1)` next to a motionless copy of you.

`ff_rejoin.amxx` (gg/dm/aim/css/fy/awp, not Classic) closes that: on a join it
looks for another client with the same base name, and if that client has sent
nothing for `ff_rejoin_quiet` seconds it drops it and renames the newcomer back
to the plain name. It takes about a second, so the suffix flashes up and then
goes. Two knobs, both live over `pnpm run rc`:

| cvar | default | what it does |
|---|---|---|
| `ff_rejoin_drop` | `1` | `0` stops it dropping anything (it still logs what it would have done) |
| `ff_rejoin_quiet` | `10.0` | seconds of silence before a same-named client counts as a ghost |

Someone genuinely playing under your alias is never dropped - they are sending
packets, and that is the whole test.
