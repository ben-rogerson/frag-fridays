# Netcode

Where latency actually comes from on this stack, what was measured, and what
moved it. Written 2026-09-04 after a session where players reported ping
"up around 100, fluctuating between 30 and 100" and a rubber-banding feel,
worst on `fy_iceworld` with six to eight humans.

Everything below is measured. Where something was expected to matter and did
not, it says so - that half of the record is the useful half.

## The short version

Two cvars, both server-side:

- **`sv_maxupdaterate` 102 -> 60.** The server was sending each browser
  client ~76 snapshots a second that the client could not possibly draw. The
  cost of building and pushing them showed up as a long, unstable ping tail
  for everyone on the server.
- **`sys_ticrate` 100 -> 200 -> 1000.** The dedicated loop does not track its
  own target below 250. 200 was the first improvement; the later sweep found
  the loop tops out near 425Hz and that any target at or above that ceiling
  stops the engine busy-waiting, which is where the CPU goes. See "How fast the
  loop actually runs" below - that section supersedes the 200 numbers here.

| | before | after |
|---|---|---|
| server ping column, p50 | 45-48ms | **39ms** |
| server ping column, p95 | **73-104ms** | **50ms** |
| server ping column, max | 74-116ms | 51ms |
| snapshots/sec per client | 76.5 | 48.9 |
| engine CPU (of one core) | 44-47% | **32-37%** |

Six connected browser clients on `fy_iceworld`, 140-150s sampling, the
server's own `status` ping column (the number a player reads off the
scoreboard).

The baseline was run twice and its p95 came out 73 then 104. The fixed config
run twice came out 50 and 47. That instability across identical baseline runs
*is* the "fluctuating between 30 and 100" - the point is not just that the
numbers are lower, it is that they stop moving.

Contribution of each, all with six clients:

| sv_maxupdaterate | sys_ticrate | p50 | p95 | max | CPU |
|---|---|---|---|---|---|
| 102 (shipped) | 100 (shipped) | 45-48 | 73-104 | 74-116 | 44-47% |
| 60 | 100 | 43-48 | 47-53 | 48-53 | 39-45% |
| **60** | **200** | **39** | **50** | **51** | **32-37%** |

The last two rows were run back to back against the same clients, so the
tick-rate row is not drift.

`sys_ticrate` was swept properly later the same day and moved on to 1000; the
ping column turned out not to be the thing it changes. See "How fast the loop
actually runs".

## Where the latency actually accumulates

This is WebRTC-tunnelled, not raw UDP, so it is worth knowing which hop owns
which milliseconds before touching any cvar. Measured floor to ceiling:

- **The internet path: ~25ms, and it is clean.** A game-shaped UDP probe
  (60 packets/sec, 200-byte payloads, 90 seconds, throwaway echo container on
  the box) returned p50 25.0ms, p95 27.7ms, p99 42.0ms, max 98.3ms, **0%
  loss**. Rate-independent - the same shape at 20/s and 100/s - so it is
  ambient last-mile jitter, not congestion or queueing.
- **The VPS's own network contributes nothing.** From the box: 0% loss,
  0.66ms average, 0.037ms mdev to 1.1.1.1 over 200 packets. Whatever jitter
  players see is on their side of the ocean, not Sydney's.
- **Do not trust ICMP here.** `ping` to the box reported 3% loss at 10/s. The
  UDP probe over the same path at the same moment lost nothing. That 3% was
  ICMP rate-limiting, and believing it would have sent this whole
  investigation after a packet-loss problem that does not exist.
- **The WebRTC transport adds ~0 at the median.** The candidate-pair
  `currentRoundTripTime` from `getStats()` was 24.0-25.7ms across every run -
  the same as the raw UDP p50. The selected pair is `prflx/udp` straight to
  `149.28.172.74:27038`; no relay, and the Cloudflare Worker carries only the
  page, `valve.zip` and the signalling socket, never game packets.
- **The rest is quantisation**, and it is where the ping number comes from:
  one server tick (`sys_ticrate 100`) plus up to one client frame. The
  browser's frame loop is `requestAnimationFrame`-driven, so on a 60Hz
  display that is up to ~17ms on its own. ~25 + ~10 + ~8 is the ~43ms floor
  the scoreboard shows, and no config reaches it.

## The data channels were already right

Worth recording because it was the first suspect and it was wrong. A reliable
ordered data channel head-of-line blocks on any loss, and that alone looks
exactly like rubber banding. Read off both server-created channels in a live
browser client:

```
channel 'write': ordered=false maxRetransmits=0 maxPacketLifeTime=null
channel 'read':  ordered=false maxRetransmits=0 maxPacketLifeTime=null
```

Unreliable and unordered on both, which is correct for a game and is
goxash3d's own choice - `apps/web/src/webrtc.ts` only ever receives these via
`ondatachannel`, so there is nothing to change on our side anyway.

## `ex_interp` was already at the engine's maximum

The other obvious suspect: an interpolation buffer too small to absorb path
jitter starves and extrapolates, which snaps. Read live out of the engine on
a clean profile:

```
ex_interp 0.1   cl_updaterate 102   rate 100000
cl_cmdrate 105  cl_cmdbackup 2      cl_lw 1   cl_lc 1
```

`ex_interp` is 0.1 - and 0.1 is the engine's own ceiling. FWGS clamps it into
`[1/cl_updaterate, 0.1]` and only ever forces it *up* to that floor, so the
buffer was already the largest the engine allows. Nothing to win here, and
raising it is not possible. Left alone.

## Bots were not the load either

`yb_quota_mode` is `fill` with `yb_quota 10`, so the quota counts *total*
players: eight humans means two bots, not twelve. The busy Friday scenario is
ten players on the map, the same as the idle one. Bot think cost never
entered it, and `yb_quota` was not touched.

## What was changed

**`sv_maxupdaterate` 102 -> 60**, in every mod's `server.cfg` (baked by the
mod Dockerfiles) and in `server/vanilla/server.cfg`.

The reasoning, not just the number: the client presents at most one snapshot
per rendered frame, and the frame loop is rAF-driven, so anything above the
display refresh is snapshots built, compressed, pushed through pion and
delta-decoded on the client purely to be discarded. 60 is not a tuned magic
value - it is the browser's own ceiling.

Capping on the **server** rather than in `userconfig.cfg` matters twice over:

- it clamps whatever a client asks for, so it needs no `valve.zip` rebuild
  and takes effect on the next deploy (or instantly via `pnpm run rc
  "sv_maxupdaterate 60"`, which is how it was measured);
- it covers players whose saved-settings snapshot replays an old
  `cl_updaterate` over the shipped one - see the settings-snapshot trap in
  docs/troubleshooting.md.

`cl_updaterate` in `server/config/userconfig.cfg` was moved to 60 to match, so
the client stops asking for something it cannot use. That half is tidiness and
needs a `pnpm run clientcfg`; the server cap is what does the work.

**`sys_ticrate` 100 -> 200**, same files. (Superseded the same day by
200 -> 1000; the reasoning below is still correct as far as it goes, and the
section "How fast the loop actually runs" explains why 200 was a local
minimum rather than the answer.)

`sys_ticrate` is what governs the dedicated loop on this engine. `fps_max`
does not, despite the server reporting `fps_max 72`: setting it to 30, to 500,
and setting `fps_override 1` and `host_framerate 0.005`, all moved the
measured frame cadence by exactly zero, while `sys_ticrate 500` took a
throwaway container's cadence from 52.5ms to 2.28ms. That makes `fps_max 72`
on a dedicated server a red herring worth not chasing again.

At 100 the loop does not track its own target. Raising it to 200 took the ping
column from p50 44ms / p95 53ms to p50 39ms / p95 50ms in back-to-back runs.

The surprise, and the reason it is worth writing down: **it costs less CPU,
not more** - 39-45% of a core at 100 against 32-37% at 200, with the same six
clients minutes apart. Whatever the loop does when it undershoots its target
is more expensive than simply running faster. 200 was picked over 500 because
500 had only been measured on an idle container, never under real clients.
That gap is what the later sweep closed.

## How fast the loop actually runs (2026-09-04, later the same day)

Ben asked whether `sys_ticrate 1000` - the competitive standard on Linux HLDS,
where league servers ran 1000 and sometimes 10000 - would cause problems here.
It does not, and the reason is not the one the folklore gives.

**The loop never reaches 1000. It tops out at about 425Hz.** Measured with a
throwaway container (own cmdpipe, no published ports) running a plugin that
counts `server_frame()` and histograms the `get_gametime()` deltas, ten bots on
`fy_iceworld`:

| `sys_ticrate` | achieved | achieved/target | frame gap p50 | p99 | engine CPU |
|---|---|---|---|---|---|
| 100 | 27/s | **0.27** | 52.5ms | 53.5ms | 11% |
| 200 (was shipped) | 122/s | **0.61** | 4.5ms | **52.5ms** | 32% |
| 250 | 251/s | 1.00 | 3.5ms | 3.5ms | 45% |
| 300 | 300/s | 1.00 | 3.0ms | 3.5ms | 34% |
| 400 | 391/s | 0.98 | 2.5ms | 3.5ms | 16% |
| 450 | 419/s | 0.93 | 2.0ms | 3.5ms | 9% |
| 500 | 419/s | 0.84 | 2.0ms | 3.5ms | 9% |
| **1000** | **426/s** | **0.43** | **2.0ms** | **3.0ms** | **9%** |
| 2000 | 434/s | 0.22 | 2.0ms | 3.0ms | 8% |
| 10000 | 424/s | 0.043 | 2.0ms | 3.0ms | 10% |

Two things fall out of that table and both matter more than the ping numbers.

**The engine busy-waits the gap between its own frame cost and the ticrate
period.** A frame costs it about 2.3ms of real work. Spin per second is then
roughly `(period - 2.3ms) x achieved rate`, and that predicts the measured CPU
almost exactly: at 250 it is `(4.0-2.3) x 251 = 427ms/s` against 45% measured,
at 300 `(3.33-2.3) x 300 = 309ms/s` against 34%, at 200 `(5.0-2.3) x 122 =
329ms/s` against 32%. At 450 and above the period is at or under the frame
cost, there is nothing left to wait for, and the spin disappears entirely.

So CPU against `sys_ticrate` is **not monotonic**. It peaks around 250 and then
falls off a cliff. This is the same non-linearity that made 200 cheaper than
100 in the first investigation, seen properly for the first time: the cheap
configurations are the very slow one and the ones at or past the ceiling, and
everything in between pays for waiting.

**Below 250 the loop also stalls.** At 100 and 200 the frame-gap p99 is 52.5ms
while the p50 is 4.5ms - the loop runs a burst of fast frames and then stops
dead for 52ms. That 52.5ms is the flat cadence the first investigation saw and
could not place. At 250 and above it never happens again. The shipped 200 was
therefore delivering about **120Hz of simulation, not 200**, with a 52ms hitch
in the tail of every hundred frames.

### What that is worth on the live server

Six real browser clients on `fy_iceworld`, the server's own `status` ping
column, paired back-to-back runs, `sv_maxupdaterate 60` throughout:

| `sys_ticrate` | run | ping p50 | p95 | max | engine CPU (of one core) | snapshots/s per client |
|---|---|---|---|---|---|---|
| 200 | a | 37 | 42 | 43 | 34.5% | 45.6 |
| 200 | b | 36 | 42 | 45 | 31.5% | 46.0 |
| 200 | c (drift re-check, ran last) | 43 | 47 | 50 | 40.9% | 47.3 |
| 500 | a | 38 | 44 | 46 | 18.6% | 44.7 |
| 500 | b | 37 | 45 | 48 | 19.6% | 43.8 |
| 1000 | a | 36 | 43 | 44 | 17.6% | 43.5 |
| 1000 | c | 45 | 51 | 51 | 15.4% | 44.2 |
| 1000 | d | 38 | 44 | 48 | 16.7% | 46.0 |
| 10000 | a | 43 | 51 | 51 | 15.7% | 44.2 |
| 10000 | b | 43 | 48 | 49 | 16.4% | 45.0 |

**The ping column does not move.** The spread within one ticrate is as wide as
the spread between ticrates: 200 gave p50 36 to 43 across three runs and 1000
gave p50 36 to 45. The drift re-check is the point - run last, after the
extremes, 200 came back at p50 43 / p95 47, which is indistinguishable from
what 1000 and 10000 had just produced. On ping alone the honest answer is **no
measurable difference**.

What *is* clean and repeatable is CPU: 200 costs roughly twice what anything at
or past the ceiling costs, in every pairing, including the two runs an hour
apart. And snapshots per client sit at 44-47/s at every single value, so a
faster loop does **not** put more packets on the wire. `sv_maxupdaterate 60`
holds, exactly as intended.

### The ten-client tail is the harness, not the box

Worth writing down because it looks alarming and is not. Four clean ten-client
runs:

| run | `sys_ticrate` | ping p50 | p95 | max | engine CPU |
|---|---|---|---|---|---|
| H200 | 200 | 48 | 96 | 175 | 32.5% |
| H1000 | 1000 | 43 | 117 | 174 | 22.4% |
| K200ten | 200 | 42 | **50** | 60 | 28.9% |
| CMB | 1000 | 41 | **49** | 50 | 20.1% |

Two of the four have a large tail and two have none, at both ticrates, minutes
apart. It is episodic, not a load threshold. Four things place it on the Mac:

- When it appears it is **common mode** - every client's ping rises in the same
  status poll and falls again together, rather than a few slow clients dragging
  a percentile. All ten clients' own frame loops were identical and healthy
  through it (rAF p50 26ms, out 35/s each).
- Through the worst episode the **engine CPU never moved**: flat 19-22% of a
  core, box steal 0.1%, run queue never above 5. The box was never busy.
- During it the **server-to-client** snapshot rate collapsed 37/s to 19/s while
  each client's **client-to-server** rate held at 36-38/s. Packets were not
  arriving; the server was not failing to send them.
- An independent game-shaped **UDP echo probe** run from the same Mac over the
  same uplink during a ten-client run, touching no game code and no engine
  thread, showed 0% loss and a rock-steady 25ms p50 but single-packet
  excursions to 60-170ms scattered right through the window. That path produces
  excursions the size of the whole "tail" on its own.

So: ten headless Chromes on one laptop behind one domestic uplink is not ten
players on ten machines on ten links, and the tail should not be projected onto
a real session. Do not re-chase it. The defensible ten-client numbers are the
clean pair, p50 41-42 / p95 49-50, which is the same as six.

### What was changed, and why 1000 and not 500

**`sys_ticrate` 200 -> 1000**, in every mod Dockerfile and
`server/vanilla/server.cfg`.

Not because the loop runs at 1000. It runs at about 425. The value is chosen to
sit **above the achievable ceiling under every load measured**, because that is
the condition under which the engine stops busy-waiting. 500 works today and
measured 18-20% against 1000's 15-18%, a small residual that is exactly what
the spin model predicts for a target only 18% above the ceiling. 1000 has
margin: if the box is ever quieter, or a future image is faster, 500 could fall
back inside the spin band and 1000 will not. 10000 measures identically to 1000
and buys nothing, so there is no case for it beyond novelty.

Net effect, six clients: simulation rate about 120Hz -> about 425Hz, engine CPU
31-41% -> 15-18% of a core, ping unchanged.

### What was tried and did nothing, this round

- **Raising the ticrate to improve ping.** It does not. Every value from 200 to
  10000 lands inside the run-to-run noise on the server's ping column. The win
  is simulation rate and CPU headroom, not latency. Anyone re-testing this
  should not expect the ping number to move.
- **10000.** Achieves the same 424/s as 1000 at the same CPU. The "10000 fps
  server" of the HLDS era has no analogue here; this engine's ceiling is a
  frame cost, not a scheduler granularity.
- **Reading the plugin's own `cpupct`.** `tickcount()` is not wall clock on
  this build, so that column is not a CPU measure. All CPU figures above come
  from `/proc/<pid>/stat` utime+stime over a fixed window.
- **Blaming round transitions for the ten-client tail.** Rounds fired every
  ~11s straight through both the spiking polls and the clean ones, so they are
  not it.

### Two traps that cost real runs

- **A live cvar does not survive a container restart, and `mp_timelimit 0` does
  not either.** A restart mid-investigation put the map back into rotation, so
  later runs were on `fy_pool_day` rather than `fy_iceworld`. Re-assert both
  after any restart and check `status.json`'s map before trusting a run.
- **Reused client aliases silently mix live and dead slots.** When a client
  drops and rejoins, the engine suffixes the name (`probe3` comes back as
  `probe3 (1)`) while the ghost holds the original for `sv_timeout` (600s). Two
  ten-client runs were really about eight live clients plus ghosts, and the
  ping column counted both. Give every run a unique alias prefix, and grep the
  captured `status` rows for `(1)` before believing a percentile.


## What was tried and did nothing

- **`cl_updaterate 60` on the client alone**, with the server still at 102:
  ping p95 57ms against a 73ms baseline, so some of the win, but strictly
  worse than the server-side cap (47ms) and it only reaches players whose
  saved settings do not override it. Not the lever.
- **`ex_interp 0.05`**: no measurable effect on the server ping column, which
  is expected - it is a pure client-side rendering setting. Reverted.
- **`cl_cmdbackup`**: left at the engine default of 2. It is insurance against
  lost usercmds, and the path loses nothing measurable, so there was nothing
  for it to buy.
- **`sv_unlag` and friends** (`sv_unlagsamples 1`, `sv_unlagpush 0`,
  `sv_maxunlag 0.5`): untouched. These govern hit registration, not movement
  reconciliation, and nobody reported hit-reg problems.
- **Anything on the Cloudflare hop**: it is not in the game path. Confirmed by
  the selected ICE candidate pair, not assumed from the Worker source.
- **`fps_max` on the server**: does nothing to the dedicated loop. See above.
- **Bot count**: not touched. `yb_quota` is in `fill` mode, so a busy Friday
  is the same ten players as a quiet one, and bot CPU is ~0.1% of a core each.

## Caveats on these numbers

- The load was six headless Chrome clients on one Mac, which pins that Mac's
  CPU: client frame rate in the harness sat at ~29fps, well under what a
  player on their own laptop gets. The **server-side** ping column is the
  metric quoted above precisely because it is not contaminated by that.
- One client network. The ~25ms floor and the occasional ~100ms path spike
  belong to that connection; other players' last miles will differ, and a
  player on office wifi can still see a spike no server setting can undo.
- `sv_maxupdaterate` was not swept below 60. 60 is justified by the display
  refresh rather than by a search, and going lower starts coarsening
  interpolation for no known gain.
- The sim tick was measured with a throwaway AMXX plugin counting
  `server_frame()` in an isolated container, and that container had **no
  connected clients** - only bots, which are server-side. It read a flat
  52.5ms cadence from 0 to 16 bots on both `fy_iceworld` and `de_dust2`, with
  zero long frames, so: no tick drops under bot load, and **`fy_iceworld` is
  not worse than `de_dust2`** (marginally better, if anything). But 52.5ms
  cannot be the populated server's rate, because a real client measurably
  receives 76 snapshots/sec. Read those numbers as characterising a
  client-less server. The usable proxy for a live one is the client's own
  received snapshot rate.
- Bot CPU is roughly +0.1% of a core per bot over a ~1.7% floor, and the host
  stayed 70-98% idle at every bot count. Bots are not the expensive thing.

## The on-screen readout

`net_graph` is now shipped on (`net_graph 3`, `net_graphpos 2` in
`server/config/userconfig.cfg`), with an off/ping/graph control on the
settings page. The earlier note there - "a permanent stats overlay is noise
for a casual game" - was right about the graph and wrong about the numbers: a
player who can read their own ping turns "it feels laggy" into "I'm on 180",
and that is the difference between a report we can act on and one we cannot.

The values are inverted from what the names suggest on this build, which is
worth writing down because guessing gets it backwards. Read off in-game
screenshots, 2026-09-04:

| | draws |
|---|---|
| `net_graph 1` | three lines of text plus a scrolling bar strip |
| `net_graph 2` | a large filled area graph on top of all of that - very busy |
| `net_graph 3` | four lines of text only, and the only one printing loss/choke |

So 3 is simultaneously the most informative and the least cluttered.
`net_graphpos 2` centres it along the bottom edge, clear of the ammo and
health numbers; pos 1 (the engine default) drops it on top of the ammo
counter.

`cl_showfps` went 1 -> 0 as part of this. Every non-zero `net_graph` prints
its own fps, so leaving `cl_showfps` on puts two fps numbers on screen at
once, sampled over different windows and disagreeing with each other - "30
fps" in the corner against "33.3 fps" in the block, verified in-game. That
reads as a bug. `net_graph` owns the readout; turning the stats off takes the
fps with them, which is what "off" should mean.

The settings control writes `net_graph` only, so if `cl_showfps` is ever
turned back on in `userconfig.cfg` the duplicate comes back for everyone who
has not set the cvar themselves.

## Getting it live

Both server cvars are already set on the running container, applied through
`rc.sh` during the measurements and left there:

```sh
pnpm run rc "sv_maxupdaterate 60" "sys_ticrate 1000"
```

A live `rc` set survives a `changelevel` but **not** a container restart -
`server.cfg` re-execs from the image on a fresh start, so until the mods are
rebuilt the box reverts to 102/100 on any restart, crash-heal or swap. The
deploy is what makes it stick. The client half (`cl_updaterate`, `net_graph`,
`cl_showfps`) needs a `pnpm run clientcfg` rebuild of `valve.zip` on top of
that, and players must hard-refresh.

## Re-measuring

The server's own ping column is the honest metric and needs no client
tooling:

```sh
pnpm run rc "status"     # ping column per connected human; bots print "Bot"
```

Sample it repeatedly during play and look at the **spread**, not the median.
A tight band is the goal; a median of 45 with excursions to 100 is the
failure mode this page is about.
