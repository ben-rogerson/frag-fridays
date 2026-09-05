# CPL Tournament: the 5v5 match ruleset

What CPL Tournament plays by, where every number came from, and how to run a
match on this stack. The rules themselves are in
[server/cpl/server.cfg](../server/cpl/server.cfg), one comment per cvar; this
file is the reasoning, the sources and the arguments between leagues.

CPL Tournament is the only mode here not tuned for a casual half hour. Five a
side, no bots, one life a round, on the rules the leagues actually used.

> **This mode was called "Classic" until 2026-09-05**, and everything below
> was written under that name; the id was `vanilla`. It was renamed when the
> Friday version split off as **ClassicAl** (`server/classical/`) - the same
> rounds with the match rules taken off: `mp_startmoney 16000`, no fade to
> black, `mp_timelimit 10` so maps rotate inside a 30-minute block, and bots
> filling to ten. If you are here because a Friday felt punishing, ClassicAl
> is the answer, not a change to the numbers below.

## There was never one ruleset

The single most important thing to know before changing anything: **"the CS
1.6 competition ruleset" did not exist.** Six organisers published rulebooks
and shipped config files, and they disagreed with each other on round time,
freeze time, overtime, how sides were chosen, whether dead players could
watch, and whether the tactical shield was legal. They also disagreed with
themselves across seasons - CAL, CPL and ESL each migrated from MR12 to MR15
independently, at different dates.

So every value below names its league and year. Where they split, this says
so. Where Frag Fridays deviates on purpose - and it does, in a handful of
places, because this is a browser server on a 30-minute Friday slot and not a
LAN final - the deviation is marked **[house]**.

Primary sources throughout: the leagues' own archived rulebooks and the config
files they shipped, not recollection.

| League | Rules | Config |
|---|---|---|
| CAL 2003 | [caleague.com rules](https://web.archive.org/web/20030614041541/http://caleague.com/data/div_cs/rules.html) | [cal.cfg, updated 2003-01-05](https://web.archive.org/web/20030915230709/http://www.caleague.com/data/div_cso/files/cal.cfg) |
| CAL 2004 | | [cal.cfg 2004-01-23](https://web.archive.org/web/20040202120657/http://caleague.com/data/div_cs/files/cal.cfg), [cal.cfg 2004-08-19](https://github.com/hpoon/HLDS-CS1.6/blob/master/cstrike/cal.cfg), [calot.cfg](https://github.com/hpoon/HLDS-CS1.6/blob/master/cstrike/calot.cfg) |
| CAL 2006 | [CAL-i rules](https://web.archive.org/web/20060807023150/http://www.caleague.com/?division=csi&page=rules) | |
| CPL | [Summer 2004](https://web.archive.org/web/20040313151632/http://www.thecpl.com:80/extreme/cs_rules.htm), [Winter 2004](https://web.archive.org/web/20041209115534/http://www.thecpl.com:80/winter/cs_rules.html), [2006 Finals](https://web.archive.org/web/20060830085044/http://www.thecpl.com:80/finals/?p=cs16rules) | |
| CEVO | [Season rules](https://web.archive.org/web/20070325153741/http://www.cevo.com:80/?page=div&id=56&func=rules), [2009](https://web.archive.org/web/20090713023936/http://aw.dev.cevo.com:80/event/howiepalooza-cs/rules/) | [cevo_cs_server_configs.zip](https://web.archive.org/web/20120121181539id_/http://www.cevo.com/FILES/cevo_cs_server_configs.zip) |
| ESL | [5on5 MR15 ladder](https://web.archive.org/web/20080727123910/http://www.esl.eu/eu/cs/5on5/mr15/ladder/rules/), [Amateur Series](https://web.archive.org/web/20130425232404/http://www.esl.eu/eu/cs/5on5/mr15/aseries/rules/), [IEM rule book 2008](https://web.archive.org/web/20081005060411/http://www.esl-world.net/masters/rule_book/) | [configesl.zip → 4on4_5on5.cfg v1.0, 2009-10-23](https://web.archive.org/web/20160310113044/http://gfx.esl-europe.net/gfx/media/eu/cs/configesl.zip) |
| WCG | [WCG PH 2008](https://web.archive.org/web/20081230163927/http://ph.wcg.com/csrules.htm) | same page |
| The Gathering | [TG09](https://archive.gathering.org/tg09/en/game/cs-1-6/) | same page |

## Match format: MR15

Fifteen rounds a half. Both teams play both sides. First to sixteen rounds
wins - a team on 16 cannot be caught in the 30 available.

This is the *late* era. Everyone started at MR12 and moved:

- **CAL** was MR12, first to 13, **three-minute rounds** in 2003 ("HALF - One
  12 round map session... ROUND - One 3-minute cycle on a map"), still MR12 at
  `mp_roundtime 2.5` in January 2004, and MR15 at 1.75 by its 2004-08-19
  config.
- **CPL** was MR12 through Summer 2004 and switched at Winter 2004: "Half -
  One 15 round map session. Two halves equal a Match. Round - One 1:45 minute
  cycle on a map."
- **ESL** ran an MR12 5on5 ladder in 2003 and had moved to MR15 by 2004.
- **CEVO** launched at MR15.
- **WCG's** national format was neither: MR10, first to 11, no overtime.

### At 15-15, four different answers

This is the least settled rule of the era and it is worth stating in full.

- **CPL: always overtime, never a draw.** Two 3-round halves, `$10,000` start
  money, repeated indefinitely until decided, sides alternating. (Rule 4.10e,
  wording stable 2002-2006; the $10,000 figure first appears Winter 2004.)
- **CAL: overtime in the regular season**, not a playoff-only rule as is often
  claimed. Two 3-round halves, repeated until decided by 2006 (§5.130); in
  2003 a single overtime, then a draw. `calot.cfg` ships `mp_startmoney
  10000`. The 2006 rulebook contradicts itself here - the definitions section
  still describes tied games scoring a point each, after the rules text had
  moved to repeating overtime.
- **CEVO: always overtime**, but MR5, not MR3, and at `$5,000` in the 2006-07
  rules, raised to `$7,500` by the config stamped August 2008. "NO CEVO match
  may end in a tie."
- **ESL: a draw, and overtime was FORBIDDEN.** Not optional - forbidden.
  Amateur Series §3.2.7 penalises two teams who agree to play one anyway if
  either later complains. The ladder tables carry a D column and the shipped
  config has `mp_maxrounds 0` / `mp_winlimit 0`: nothing in it ends a match at
  all. ESL only played overtime in cups and at IEM, where the 2008 rule book
  used `mp_maxrounds 5` and `mp_startmoney 10000`, teams staying on the side
  they started the map on.
- **The Gathering 2009:** MR3, first to four, `mp_startmoney 10000`.
- **WCG's** MR10 format: none at all.

**[house]** Frag Fridays treats 15-15 as a draw, which is ESL's default and
the only version that fits a Friday afternoon. If anyone wants overtime, the
majority answer (CPL, CAL, TG09) is one command:
`pnpm run rc "mp_startmoney 10000; mp_maxrounds 3"`.

### Half time

CAL and CPL both allowed an optional ten-minute break at the half. On this
stack the half break is where the manual side swap happens - see below.

## The cvars

Every line is in [server/cpl/server.cfg](../server/cpl/server.cfg)
with the same explanation attached to it. Blank means the league did not set
it.

### The round

| cvar | CAL 03 | CAL 04-08 | CPL 04-06 | CEVO | ESL 09 | TG09 | WCG | **Classic** |
|---|---|---|---|---|---|---|---|---|
| `mp_roundtime` | 3 | 1.75 | 1.75 | 2.00 | 1.75 | 1.75 | 1.75 | **1.75** |
| `mp_freezetime` | 10 | 15 | 15 | 15 | 10 | 15 | 15 | **15** |
| `mp_buytime` | .25 | .25 | .25 | .25 | .25 | .25 | .25 | **.25** |
| `mp_c4timer` | 35 | 35 | 35 | 35 | 35 | 35 | 35 | **35** |
| `mp_startmoney` | 800 | 800 | 800 | 800 | 800 | 800 | | **800** |

`mp_roundtime` and `mp_buytime` are in **minutes**, which is the one unit trap
in the file: `.25` is fifteen seconds, `1.75` is one minute forty-five.

Round time is the least stable number of the era (3.0 → 2.5 → 1.75 at CAL;
1.5 in the WCG 2006 ruleset; 2.00 at CEVO). 1.75 is where 1.6 finished and
what four of the six organisers shipped.

Freeze time is nearly as unstable - 10, 15, 20 in CAL's own files across four
years, 6 at ESL in 2004, 10 by 2009. **[house]** Classic runs 15, the majority
and the value that pairs with a 15-second buy window. If it drags on a Friday,
ESL's 10 is the era-legitimate way to shorten it.

### Ending the match

| cvar | CAL | CPL | CEVO | ESL | TG09 | **Classic** |
|---|---|---|---|---|---|---|
| `mp_maxrounds` | 12, then unset | 15 | 0 | 0 | 15 | **15** |
| `mp_winlimit` | | 0 | | 0 | 0 | **0** |
| `mp_timelimit` | 999 | | 999 | 0 | 999 | **0** |

The 0 camp expected an admin and an HLTV proxy to stop the half by hand -
CEVO's config even announces "15 rounds per half" in a `say` line while
shipping `mp_maxrounds 0`. Nobody here is counting, so Classic takes CPL's and
TG09's 15 and lets the server end the half itself.

`mp_timelimit 0` is the important one: **no map clock**. Every other mode here
rotates on a timer, and a match must not be cut off mid-half by one. 999 and 0
amount to the same thing.

### The teams

| cvar | CAL | CPL | CEVO | ESL | TG09 | WCG | **Classic** |
|---|---|---|---|---|---|---|---|
| `mp_friendlyfire` | 1 | 1 | 1 | 1 | 1 | 1 | **1** |
| `mp_autoteambalance` | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| `mp_limitteams` | 6 | | 6 | 0 | 6 | 10 | **6** |
| `mp_tkpunish` | 0 | | 0 | 0 | 0 | 0 | **0** |
| `mp_hostagepenalty` | 0 | | 0 | | 0 | 0 | **0** |
| `mp_autokick` | 0 | | 0 | 0 | 0 | 0 | **0** |
| `mp_kickpercent` | | | | 1 | | | **1** |

Friendly fire on is the one thing nobody argued about, and it is most of what
makes a 5v5 play differently from a casual round.

`mp_limitteams` caps the *difference* between team sizes, not the size, so 6
on a 12-slot server is the same as 0: no limit. That is deliberate - 5v4 has
to be legal while somebody reconnects, and a server "fixing" it mid-round
would be worse than the problem. Team **size** is capped by the slot count.

**[house]** Classic runs `+maxplayers 12`: ten players and two spare, for a
sub or someone watching. There is no cvar that caps a side at five - only the
slot count and `mp_limitteams` between them - so twelve is the closest the
config can get to "this is a 5v5".

### No ghosting

| cvar | CAL | CPL | CEVO | ESL | TG09 | WCG | **Classic** |
|---|---|---|---|---|---|---|---|
| `mp_fadetoblack` | 0 | 1 | 0 | 1 | 1 | 1 | **1** |
| `mp_forcecamera` | 2 | 3 | 2 | 2 | 3 | 2 | **2** |
| `mp_forcechasecam` | 2 | | 2 | 2 | | 2 | **2** |
| `allow_spectators` | 0 | | 0 | 1 | | 1 | **1** |
| `mp_playerid` | 0 | | 0 | | 0 | 1 | **0** |

`mp_fadetoblack 1` is the rule most likely to read as "the game is broken" to
someone who has only played the casual modes: **a dead player's screen goes
black until the round ends.** It is the era's answer to ghosting - you cannot
pass on what you cannot see - and it is the LAN circuit's answer specifically
(CPL, ESL, WCG, TG09 all ran 1; CAL and CEVO ran 0 and let dead players
watch). Classic runs 1. If it turns out to be more confusing than it is worth,
0 is a legitimate era value and a one-line change.

### The world

The leagues pinned the stock physics explicitly rather than trusting a server
to be unmodified, and Classic does too - this box runs seven other mods and
GoldSrc never resets a cvar at a map change.

`sv_maxspeed 320`, `sv_gravity 800`, `sv_airaccelerate 10`, `sv_accelerate 5`,
`sv_friction 4`, `sv_stopspeed 75`, `sv_stepsize 18`, `edgefriction 2`,
`sv_aim 0`, `sv_cheats 0`, `mp_consistency 1`, `mp_flashlight 1`,
`mp_footsteps 1` - all shipped by CAL and WCG, and all either matched or unset
elsewhere. `sv_unlag 1` / `sv_maxunlag 0.5` is CAL's and WCG's
lag-compensation pair, which matters more here than it did on a LAN.

Classic keeps sprays working (`sv_allowupload 1`, `sv_allowdownload 1`,
`sv_send_logos 1`, `decalfrequency 60`) as CAL, CEVO and ESL did. The LANs ran
uploads off; this server has a spray feature and the era's reason for killing
them was bandwidth, which is gone.

### Three of the era's cvars do not exist here

This stack's game DLL is a reimplementation, not the Valve one, and three
cvars every league config sets are simply absent from it. Verified in a
throwaway container on 2026-09-04 - each printed `Unknown command` at boot and
`cvarlist <prefix>` returned nothing:

- **`mp_autocrosshair`** - `cvarlist mp_auto` returns only `mp_autokick`,
  `mp_autokick_timeout` and `mp_autoteambalance`.
- **`mp_decals`** - the per-client decal cap. `decalfrequency` is an engine
  cvar and does exist. Server-side only: `mp_decals` is a real CLIENT cvar on
  this build and `userconfig.cfg` sets it (2026-09-05, see troubleshooting).
- **`sv_proxies`** - the HLTV proxy allowance, moot anyway on a WebRTC-only
  server with no A2S or rcon netchannel.

All three are out of `server.cfg`, with a comment where each was, rather than
left in to warn on every map start.

One quirk worth knowing before you go looking for a bug: **`mp_c4timer`
exists but reads back blank.** Typing it in the console prints nothing at all
- not a value, not a warning - while `cvarlist mp_c4` reports it as a real
cvar. It is set; it just cannot be echoed.

`pausable 0` (CAL, CPL from Winter 2004, WCG; ESL, CEVO and TG09 ran 1). There
is no console in the browser client to type `pause` into either way.

### Restrictions: one weapon, and even that is disputed

**The tactical shield is the only weapon ban in the entire era, and it was not
universal.** Banned by CAL (§3.90c: "The tactical shield is NOT to be used in
any CAL match... use of the shield in regular play will result in the
forfeiture of that round and an additional penalty of three others"), by CEVO
(§14.2, up to three rounds overturned per round it is used in), and by ESL and
IEM (§9.6.1, and at IEM worth 10% of the prize money). **Legal at CPL** - the
word "shield" appears zero times in every CPL ruleset from 2002 to 2006.

**There was never an AWP restriction anywhere.** Checked across ten rulesets -
CPL 2002/03/04/05/06, CEVO 2006 and 2009, CAL 2003 and 2006, ESL - and the
words awp, sniper and magnum do not appear in any of them. Neither is there a
grenade limit: ESL is explicit that "it is perfectly allowed to buy as many
equipment as you wish to during the buytime", and WCG's "approved grenade
amounts" list is just the engine's own carry limits written down.

The real restrictions were *techniques*, and they were enforced by people, not
by cvars: silent bomb plants (CAL forfeits the rest of the half), crouch- and
speed-walking (banned by CAL and WCG, allowed at TG09), and a named list of
map exploits per season. Classic does not enforce any of them; there is no
plugin, and there are ten people who can all see each other.

### Rates: the myth

"Everyone ran `ex_interp 0.01`" is one league's rule, not the era's.

**Only WCG mandated client rates.** Its allowed-values list pins
`cl_updaterate 101`, `cl_cmdrate 101`, `rate 25000`, and its
must-not-be-changed list includes `ex_interp 0.01`, backed server-side with
`sv_minupdaterate 101` and `sv_minrate 25000` so everyone was on identical
rates.

**CAL, CPL, CEVO and ESL mandated nothing client-side.** None of `rate`,
`cl_updaterate`, `cl_cmdrate` or `ex_interp` appears in any of their rulebooks
or configs; there is even a period HLTV thread titled "ex_interp on ESL?? No
rules?". They constrained rates server-side only:

| League | `sv_maxrate` | `sv_minrate` | `sv_maxupdaterate` | `sv_minupdaterate` |
|---|---|---|---|---|
| CAL 2003 | 10000 | 0 | 100 | 20 |
| CAL 2004-08 | 25000 | 0 | 100 | 20 |
| CPL | 25000 | | 101 | |
| CEVO | 25000 | 0 | 100 | 30 |
| ESL 2009 | 20000 | 2500 | 100 | 20 |
| **Classic** | **100000** | **25000** | **102** | **30** |

**[house]** Classic keeps this server's own ceilings, which every mode here
already uses and which the shipped `userconfig.cfg` asks for. The era's
numbers were sized for 2004 domestic broadband; copying them would cap this
server *below* what its players already get, for period accuracy nobody could
feel.

What the leagues did police client-side was visual and anti-cheat: CAL
suspended players for touching `gl_*`, `cl_bob`, `cl_bobcycle` or
`r_drawviewmodel`, and required 32-bit colour; ESL enforced a list of fifteen
visual cvars; WCG and CPL both required their own GUI.

### Logging

`log on`, `mp_logfile 1`, `mp_logmessages 1`, `mp_logdetail 3` - full logging
including chat, which the leagues kept as dispute evidence and which the
Friday recap and season standings (`pnpm run standings`) are parsed out of.
`mp_logecho 0` follows ESL: echoing every log line to the console would bury
the command-pipe output that `pnpm run rc` reads back.

## The map pool

**[house]** Classic runs seven: `de_dust2`, `de_inferno`, `de_nuke`,
`de_train`, `de_cbble`, `de_aztec`, `de_dust`.

Five of those - dust2, inferno, nuke, train, cbble - are in every league's
rotation, every year, on both continents. That is the durable core and it is
not really disputed by anyone. The other two come and go: `de_aztec` was in
the CPL pool through 2004 and WCG's 2006 pool but gone from CPL by 2005 (CAL
used a fixed variant, `de_aztec2`, for its 2006 playoffs), and `de_dust` is in
CPL's Summer 2005 pool and was ESL's 2003 default.

What is missing is the customs, and there were two families of them, which is
the real US/Europe split:

- **CPL's**, mandatory downloads: `de_cpl_mill` and `de_cpl_fire` (which
  entered as `de_clan1_mill` / `de_clan2_fire` in 2002 and were renamed by
  Winter 2003 - one map each, not two), joined by `de_cpl_strike` in 2005. CAL
  ran these too, one per week over an eight-week season.
- **The Brute/CEVO/ESL set**: `de_tuscan`, `de_forge`, `de_russka`, appearing
  in both CEVO's and ESL's pools from 2007.

None of them is in this server's client payload and each would cost every
player download size. `de_prodigy` is the near miss: a stock map, in CPL's
pool to 2004 and ESL's 2003 pool, with its screenshot already in the web
client - out only because adding a map to a mapcycle grows `valve.zip` and
needs a `clientcfg` run. See backlog item 18.

No hostage map was in any competition pool, which is why `cs_italy`,
`cs_assault` and `cs_office` left Classic's rotation.

`cs_italy` and `cs_office` then left the server entirely on 2026-09-05, out of
every mode's cycle. `cs_assault` stays, and is still in **ClassicAl's** pool
(`server/classical/mapcycle.txt`).

The same day put three customs - `de_mirage`, `de_beishan` and
`de_dust2_2020_se` - into every rotation that carries classic maps, CPL
Tournament's included. That last one is a deliberate break with the rest of
this file: the seven are the era's pool, the three are not, and CPL Tournament
runs both. If a match should be played on era maps only, the pool to use is
lines 1-7 of `server/cpl/mapcycle.txt`.

## Running a match on this stack

Everything above is the ruleset. This is what actually works on a WASM Xash3D
box with no rcon, no HLTV and a reimplemented game DLL.

### Choosing sides, and going live

Both conventions people remember are real, and they belong to different
leagues. Getting this right matters because the popular version - "knife round
then live on three" - is two leagues' rules stapled together.

- **Sides split four ways.** CAL fixed them by schedule ("HOME TEAM: The team
  listed in the left column... is required to play as Terrorist for the first
  half"). CPL and WCG used a coin toss ("A coin toss is used to decide which
  team plays Counter-Terrorist"). CEVO let the home team pick. **Only ESL used
  a knife round** ("A knife round has to be played before the match starts. It
  is up to the winner to choose sides"). The word "knife" appears zero times
  in every CPL, CEVO and CAL 1.6 ruleset.
- **"Live on three" is CAL's own term**, in CAL's own words: §5.40 permits
  changing `sv_restart` "for round restarts in the traditional 'live on
  three'" and nothing else, on pain of forfeit. CEVO wrote the definition down
  - "Live - The commencing of a half after three (3) consecutive round
  restarts" - and shipped it as a config filename, `lo3-ot.cfg`. ESL had no
  restart ceremony at all, and restarting once live was a default loss plus
  penalty points.
- **The "three" is the number of restarts, not the delay.** `sv_restart 1`
  three times over. The argument is the delay in seconds - CAL's documented
  dead-round variant is `sv_restart 5`.
- CAL also required (2003) or recommended (2006) **one dead round** before
  each half while people joined: stay on spawn, touch nothing, and restart if
  anyone dies.
- The `.ready` chat command has **no period source**. It was AMXX match-mod
  behaviour and later client software, never a written league rule.

**[house]** Classic uses ESL's knife round for sides, because a coin toss
needs an organiser and a schedule needs a league, and CAL's live-on-three,
because three restarts is a clearer signal to ten people in browser tabs than
someone typing "ready" in chat. `scripts/match.sh` does both:

```sh
pnpm run match knife     # announce, restart the round - knife for sides
pnpm run match live      # three restarts, then LIVE
pnpm run match half      # call half time and the manual side swap
pnpm run match bots 6    # fill to 6 for a warm-up (0 clears)
pnpm run match score     # the live scoreboard
```

Note `sv_restartround`, not `restart`: the command pipe blocks `restart`
because it segfaults this engine build (2026-08-04). `sv_restartround` is an
alias of the era's `sv_restart` and is what the war room's Restart round
button sends on the other modes.

### What this stack cannot do

- **No half-time side swap.** CS 1.6 has no half-time concept - `mp_maxrounds`
  just ends the map, and nothing swaps sides or carries a score over. In the
  era that was HLTV's job, or a human with a piece of paper. The plugin that
  would do it here (`teambalance.amxx`, `ff_swapteams`) is baked into the mod
  images, and Classic is not one of them, so the swap is manual: after round
  15 everybody rejoins the other team. `pnpm run match half` announces it.
- **No score across the halves.** The scoreboard is the current half. The
  season standings read the kill logs afterwards regardless.
- **No `.ready`, no automatic knife round, no match plugin.** Classic runs the
  **stock image, unbuilt**: it has no Dockerfile, so nothing compiles a `.sma`
  for it, and the plugins it does load are pre-compiled binaries hand-placed
  on the box. Backlog item 16 is the fix and it is bigger than a plugin.
- **No `!restart` in chat.** Nothing has it any more - the plugin that took
  it (`chatrestart.amxx`) was removed from every mod on 2026-09-05. Use
  `pnpm run match knife`, or the war room's Restart round button.

### Bots

Zero on every cold start: `server/cpl/yapb.cfg` ships `yb_quota "0"` and
YaPB re-reads it on load. They are still fully supported when you want them -
`pnpm run match bots <n>` or the war room's Bots panel - and a fill survives a
map change but never a restart. Full detail in [game-guide.md](game-guide.md).

### Where Classic's config lives

Not where you would expect, and this has bitten before. Classic runs the stock
image, so nothing is baked; the root `docker-compose.yml` mounts every config
in from `/opt/cs16`.

**The exec order is not what this repo used to believe, and the difference is
the whole bug.** Measured on the box 2026-09-04:

- the compose's `+cvars` run first, at container start;
- `server.cfg` execs **once**, at container start, straight after them. A
  changelevel does **not** re-run it;
- `amxx.cfg` is exec'd by AMXX at **every** map start, followed by
  `configs/maps/<map>.cfg` for that map only.

So on the first map `amxx.cfg` beat `server.cfg` by running after it, and on
every map after that it beat it by running at all. A box-side `amxx.cfg`
holding casual round values was therefore re-applying them for the life of the
container while the repo's `server.cfg` never got another turn.

`server/cpl/amxx.cfg` therefore sets **no gameplay cvar at all**. It used
to be a box-only file holding Classic's casual quick-round values
(`mp_startmoney 16000`, `mp_roundtime 2.5`, `mp_freezetime 5`, `mp_c4timer 35`,
`mp_timelimit 10`, added 2026-08-11), silently outranking the `server.cfg` in
this repo - which is why the config that looks like the server's config was
not the one deciding how Classic played. With `amxx.cfg` neutral, `server.cfg`
is unopposed and IS the ruleset. Do not put an `mp_` cvar in `amxx.cfg`.

What `amxx.cfg` does end with is `exec server.cfg`. That gives the ruleset the
same per-map re-assertion the casual values used to have, out of the one file
that holds it - so a cvar changed live (an overtime `mp_startmoney 10000`,
say) returns to the ruleset at the next map instead of persisting for the life
of the container. Verified on the box: setting `mp_roundtime 5` and
`mp_startmoney 16000` live, then changing map, put both back to `1.75` and
`800`.

It has one visible side effect. `server.cfg` ends with `log on`, and re-running
that closes the current kill log and opens a new one, so **each map writes two
`L*.log` files** instead of one - the first holding that map's cvar dump, the
second its rounds and kills. Harmless: `standings.sh` cats every `L*.log` in
filename order, so nothing is lost or reordered. It is only surprising if you
are counting files.

The repo copy is the box copy **verbatim** as of 2026-09-04 apart from those
five lines, so nothing AMX Mod X was relying on went missing when the mount
went over it. Two things in it are not stock AMXX: the scrolling advert
(`amx_scrollmsg`) had already been deleted, and `amx_imessage` had been
rewritten from the AMX Mod X plug to `"Welcome to %hostname%"` - which, with
the hostname being "Frag Fridays", is the "Welcome to Frag Fridays" banner
that printed centre-screen every `amx_freq_imessage` (180) seconds, during
live rounds included. Both are now off everywhere: commented out here
(2026-09-04), and as of 2026-09-05 the other modes' Dockerfiles strip *every*
`amx_imessage` line from the image copy, not just AMXX's own advert.

`configs/maps.ini` is mounted from the repo for the same reason. It is the
list `mapchooser` offers in the end-of-map vote, the mod Dockerfiles
regenerate it from `mapcycle.txt` so a vote can never offer a map that is not
in `valve.zip`, and Classic - having no build step - had been missed: its box
copy still listed `de_prodigy` and `cs_militia`, neither of which is in the
client payload at all. Keep `server/cpl/maps.ini` equal to
`server/cpl/mapcycle.txt`.

### What the boot test proved (2026-09-04)

A throwaway container on the live image, this config bind-mounted, its own
command pipe and no published ports:

- **Zero bots on a cold start.** `status` returns an empty scoreboard,
  `yb_quota` reads `0`, and the log has no `Connecting Bot` line.
  `12 player server started`, so the slot count took.
- **`amxx.cfg` no longer overrides.** `mp_startmoney` reads `800`, not
  `16000`; `mp_timelimit` reads `0`, not `10`; `mp_roundtime` `1.75`, not
  `2.5`. These are read back *after* a map start, i.e. after `amxx.cfg` has
  had its turn.
- **The nested mounts apply.** A file bind-mounted inside a directory bind
  mount does win: `yb_quota_mode` reads `fill` where the box file says
  `normal`, and `yb_join_delay` reads `20.0` where the box file says `5.0`.
- The netcode work's `sv_maxupdaterate 60` and `sys_ticrate 200` survive
  `amxx.cfg` too, reading back correctly after a map start.
- Adding bots live still works on Classic: `yb_quota 4` over the pipe
  connected four bots within a second.
- `mp_maxrounds` really does end the map with `mp_timelimit 0`: set to 2, the
  server played two rounds and changed level. One quirk, pre-existing and
  mild - AMXX's `nextmap` reports the FIRST map of the cycle as next during
  the first map after a container start, so the boot map plays twice before
  the rotation advances properly.
- `sv_restart` and `sv_restartround` both exist as cvars on this DLL, so the
  knife-round and live-on-three procedure works.

## Contradictions in the sources

Recorded rather than resolved, because the sources really do disagree:

- CAL's 2006 rulebook says overtime repeats until decided (§5.130), while its
  own definitions section still describes tied games scoring a point each.
- `calot.cfg` ships `mp_maxrounds 15` although it is the overtime config and
  CAL's rules say overtime is two 3-round halves. Treat its `mp_startmoney
  10000` as authoritative and its round count as a copy-paste leftover.
- CAL's shipped `CALHLTV.cfg` sets `delay 150.0` while both the 2003 and 2006
  rulebooks require a 180-second delay.
- CEVO's config announces "15 rounds per half" in a `say` line while shipping
  `mp_maxrounds 0`.
