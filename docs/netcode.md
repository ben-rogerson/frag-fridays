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
- **`sys_ticrate` 100 -> 200.** The dedicated loop does not track its own
  target at 100. Raising it lowered the median ping *and* lowered CPU.

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

**`sys_ticrate` 100 -> 200**, same files.

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
500 has only been measured on an idle container, never under real clients.

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
pnpm run rc "sv_maxupdaterate 60" "sys_ticrate 200"
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
