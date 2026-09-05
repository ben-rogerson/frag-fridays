# Netcode

How latency and hit registration actually work on this stack, what is
configured, and why. Everything here is measured or read out of the engine
source; where something was expected to matter and did not, it says so - that
half of the record is the useful half.

Engine is **xash3d-fwgs 0.21** (`engine/common/com_strings.h:79`), server
native on the VPS, client compiled to WebAssembly and driven over WebRTC.
Source references below are against `FWGS/xash3d-fwgs` master `1442d14a`.

## What ships, and the one-line reason

| cvar | value | side | why |
|---|---|---|---|
| `sv_maxupdaterate` | **60** | server | the browser cannot draw more than it refreshes; above this the extra snapshots cost ping tail and buy nothing |
| `sv_minupdaterate` | 30 | server | floor |
| `sys_ticrate` | **1000** | server | sits above the loop's ~425Hz ceiling, which is the condition under which the engine stops busy-waiting |
| `sv_unlag` | 1 | server | lag compensation on |
| `sv_maxunlag` | 0.5 | server | caps the rewind's latency term |
| `sv_maxrate` / `rate` | 100000 | both | 100000 really is this engine's maximum, see below |
| `cl_updaterate` | **60** | client | matches the server cap so the client stops asking for what it cannot get |
| `cl_cmdrate` | 105 | client | inert - the engine clamps it to 100 and the browser's frame rate binds first |
| **`ex_interp`** | **0.1** | client | **load-bearing. Do not lower it. See "The one setting that really does move hit registration".** |

## The short version on hit registration

Ben asked for `cl_cmdrate 101` / `cl_updaterate 101` with a full server,
because that was the competitive standard on 100-tick GoldSrc and it gave him
the best hit registration. Tested on this stack, both halves come back
**no change**, for reasons specific to this engine:

- **`cl_cmdrate 101` is a no-op.** The engine clamps `cl_cmdrate` to 100
  client-side, so the shipped 105 and Ben's 101 are the *same number* once the
  engine has them. And the clamp does not bind anyway: one usercmd is built per
  rendered client frame, so the achievable command rate is the browser's frame
  rate. Measured across six harness runs, outbound packets per second divided
  by rendered frames per second was **0.973-0.984** - one command per frame,
  every time.
- **`cl_updaterate 101` (with the server cap raised to match) has no mechanism
  to help.** Lag compensation on this engine rewinds by replaying *the exact
  snapshots it sent that client* and lerping between them with the client's own
  reported interpolation amount. The server and the client interpolate the same
  two samples, so a wider snapshot spacing makes both coarse in the same way and
  cancels. There is no high-resolution-history-versus-interpolated-view mismatch
  for a denser send rate to close.

What *does* move hit registration on this build is `ex_interp`, and the
direction is the opposite of the folklore. That is the rest of this page.

## How hit registration actually works here

`SV_SetupMoveInterpolant()` (`engine/server/sv_pmove.c:680-834`) is the whole
of lag compensation. Three facts about it decide everything else.

**1. The position history is the sent-snapshot ring, not a per-frame buffer.**
It walks `cl->frames[]` (`sv_pmove.c:734`), the ring of datagrams already
transmitted to the shooting client. Entries are written once per transmitted
datagram (`sv_frame.c:529-530`, `frame->senttime = host.realtime`). There is no
per-frame backtrack buffer anywhere in the server, so the ~425Hz loop rate is
irrelevant to unlag resolution. Depth is `MULTIPLAYER_BACKUP` = **64 frames**
(`netchan.h:75`).

**2. The rewind target is latency plus the client's own reported interp.**

```c
lerp_msec = cl->lastcmd.lerp_msec * 0.001f;
if( lerp_msec > 0.1f )  lerp_msec = 0.1f;
if( lerp_msec < cl->next_messageinterval ) lerp_msec = cl->next_messageinterval;
finalpush = ( host.realtime - latency - lerp_msec ) + sv_unlagpush.value;
```
(`sv_pmove.c:721-730`)

`lerp_msec` is a **field of the usercmd** (`common/q_client.h:32`, delta-encoded
at `net_encode.c:57`), not a userinfo cvar. The client tells the server, in
every command, how far back it is drawing the world. That closed loop is what
keeps the two in agreement.

**3. The server re-does the client's own lerp between the same two snapshots.**

```c
lerpFrac = (finalpush - frame->senttime) / (frame2->senttime - frame->senttime);
VectorMA( state->origin, lerpFrac, newpos, curpos );
```
(`sv_pmove.c:786-829`, positions taken from `svs.packet_entities[]` - the exact
states serialised into those packets)

So the server reconstructs *what the player saw*, not where the target truly
was. That is lag compensation working correctly, and it is why snapshot spacing
cancels out of the registration path.

### The one setting that really does move hit registration

The closed loop in fact 2 depends on the client reporting its interpolation
amount honestly. **The deployed browser client does not.**

The shipped wasm predates upstream fix `1bd8513fc` (2026-08-15, "fix lerp_msec
calculation, caused by converting ex_interp value to milliseconds where seconds
were expected"). Confirmed directly against the discriminating format string
that patch changed, read out of the deployed binary:

```sh
$ grep -aoE "cl_updaterate minimum is %[a-z], resetting to default \(?[^ ]{0,14}" \
    /xashds/public/assets/xash-CAtKZwSO.wasm
cl_updaterate minimum is %f, resetting to default (20)      # pre-fix wording
```

The pre-fix code multiplies by 1000 a value that is already in the units it
wants, so the bound always saturates:

```c
interpolation_time = cl_interp.value * 1000.0;                            // 0.1 -> 100.0
interpolation_time = bound( min_interp, interpolation_time, max_interp ); // -> always 0.1
cmd->lerp_msec = CL_DriftInterpolationAmount( interpolation_time * 1000 );// -> always 100
```

**The client reports `lerp_msec = 100` unconditionally, whatever `ex_interp`
is.** Therefore:

- At the shipped **`ex_interp 0.1`**: the client really is drawing 100ms in the
  past and really does report 100ms. Client and server agree exactly.
  Registration is correct - **by luck, not by design.**
- At **any lower `ex_interp`**: the client draws at `now - ex_interp` but still
  claims 100ms, so the server rewinds too far by the difference.

What that costs, measured against a real 60-second firefight trace (14 bots on
`fy_iceworld`, positions logged every server frame), converting the timing
mismatch into world units of aim error at moments where the target is actually
moving:

| rewind mismatch | mean | p50 | p90 | p95 | max | outside body (>16u) | outside head (>5u) |
|---|---|---|---|---|---|---|---|
| 16.7ms | 3.77u | 3.96u | 7.16u | 9.02u | 16.9u | 0.4% | 35.0% |
| 25ms | 5.65u | 5.00u | 10.7u | 13.5u | 25.2u | 2.3% | 50.1% |
| 50ms | 11.2u | 10.0u | 21.4u | 27.0u | 50.4u | 17.5% | 83.4% |
| **83.3ms** (`ex_interp 0` at updaterate 60) | **18.5u** | **16.1u** | 35.0u | 43.0u | 84.0u | **50.5%** | 91.5% |
| 100ms (`ex_interp` at its floor, high updaterate) | 22.1u | 20.1u | 42.0u | 51.6u | 100.9u | 68.7% | 93.8% |

A standing player's bounding box is 32 units wide, so 16 units is the half
width - the point at which a shot placed on the centre of what you saw leaves
the target altogether.

**Setting `ex_interp 0` on this build puts roughly half of all shots at a
moving target outside the body hitbox.** That is precisely the "my shots do not
register" complaint, and the widely circulated CS 1.6 rates guides that tell you
to set `ex_interp 0` and let the engine work it out will *cause* it here. On
stock GoldSrc that advice is sound; on this build it is actively harmful, and
the difference is a client bug that has since been fixed upstream but is not in
the deployed wasm.

The clamp itself works as documented - `CL_ComputeClientInterpolationAmount()`
(`cl_main.c:488-523`) forces `ex_interp` **up** to `1/cl_updaterate` and **down**
to `MAX_EX_INTERP` 0.1, rewrites the cvar, and re-runs every client frame. So
`ex_interp 0` does not stay 0; it becomes 16.7ms at updaterate 60. It is the
*reporting* that stays wrong, not the clamping.

**Defence in place:** `ex_interp` is `FCVAR_ARCHIVE`, so `host_writeconfig`
persists it and the settings-snapshot machinery in `apps/web/src/launch.ts`
would replay a hand-typed value forever. It is now in that file's
`ENGINE_OWNED` set alongside `cl_cmdrate` and `cl_dlmax`, which strips it out of
new snapshots *and* out of snapshots already in a player's `localStorage`, so
the shipped 0.1 always wins. It is deliberately **not** offered on the settings
page: there is no value a player could pick that is better than 0.1, and
several that quietly halve their damage.

Revisit all of this if the client is ever bumped past the `1bd8513fc` fix.
After that fix, lower `ex_interp` becomes safe and probably desirable, and this
whole section inverts.

## Why raising the update rate does not buy hit registration

Beyond the cancellation above, three independent measurements say the same
thing.

**The send rate would barely move, and only if both sides change.**
`sv_maxupdaterate` is a floor on the send *interval*, not a target:
`SV_CheckUpdateRate` (`sv_client.c:1704-1719`) takes the slower of the client's
request and the server's cap. The shipped `cl_updaterate 60` therefore pins the
rate at 60 no matter what the server cap says - raising only the cap does
nothing at all. And with both raised, the server never achieved the number
anyway: at `sv_maxupdaterate 102` a connected client measured **74.8-76.8
snapshots/sec**, not 102. So "101" in practice means about 76.

**The extra snapshots would carry no new information.** Player origins only
change on the physics cadence, which is driven by arriving usercmds. Measured
on the trace, bot origins changed on 4.9% of server frames with a median
interval of **23.1ms (43.2Hz)**, tight (p10 22.8ms, p90 23.8ms). Not a bot-AI
throttle: a control run at `yb_think_fps 90` gave 43.1Hz, identical. Human
clients update at their own frame rate, which the harness measured at 28-37fps.
Either way the source motion is at or below 60Hz, so snapshots above 60Hz
largely re-send positions that have not changed.

**Even ignoring all of that, the spacing error is negligible.** Simulating what
a client would draw at each snapshot rate against the trace's own ground truth,
scored only at moments where the target is moving:

| snapshot rate | mean | p50 | p95 | p99 | max | outside body (>16u) | outside head (>5u) |
|---|---|---|---|---|---|---|---|
| 30 | 0.85u | 0.48u | 2.72u | 3.54u | 9.4u | 0.000% | 0.017% |
| 43 | 0.89u | 0.39u | 3.32u | 4.08u | 5.6u | 0.000% | 0.005% |
| **60 (shipped)** | 0.78u | 0.29u | 2.99u | 3.77u | 8.4u | **0.000%** | 0.003% |
| 80 | 0.67u | 0.20u | 2.68u | 3.49u | 7.4u | 0.000% | 0.002% |
| 100 | 0.58u | 0.13u | 2.40u | 3.23u | 6.7u | 0.000% | 0.001% |
| 101 | 0.57u | 0.12u | 2.38u | 3.22u | 6.4u | 0.000% | 0.001% |

Going from 60 to 100 moves the p95 from 3.0 units to 2.4 units and never once
puts a shot outside a 32-unit-wide hitbox at any rate tested. Against the 16-unit
median error the `ex_interp` mismatch produces, this is three orders of
magnitude away from mattering. (Caveat: the trace's own motion is 43Hz, so rates
above that are partly measuring the staircase rather than real curvature - which
only reinforces the point that there is nothing up there to resolve.)

**100 versus 101 is noise and should not be re-litigated.** They differ by one
snapshot per second. On the synthetic worst-case torture trace they scored mean
0.79u versus 0.78u and body-miss 1.865% versus 1.796% - a difference smaller
than the run-to-run spread. `sv_maxupdaterate 100` and `101` are the same
setting. (`cl_updaterate` is clamped to `[10, 102]` client-side, `client.h:105`,
so 101 and 102 are both legal and both pointless here.)

### And raising it has a real cost

- **The measured ping tail.** Dropping `sv_maxupdaterate` 102 -> 60 is what took
  the server's ping column from p95 **73-104ms to ~50ms** (below). Going back up
  spends that win.
- **It shrinks the lag-compensation window.** The 64-frame history covers
  `64 x snapshot interval`: **1.07s at 60Hz, but only 0.64s at 100Hz**. If
  `latency + interp` overruns it - and `sv_maxunlag 0.5` plus 0.1 interp is
  0.6s, inside 0.64s by a whisker - unlag is **abandoned entirely** for that
  shot (`sv_pmove.c:765-771`). A higher update rate makes lag compensation fail
  *earlier* for exactly the high-ping players who need it most.

So the trade the sweep was meant to price turns out to be one-sided: the
hit-registration column is flat and the cost column is not.

## Where the latency actually comes from

WebRTC-tunnelled, not raw UDP, so it is worth knowing which hop owns which
milliseconds before touching any cvar. Measured floor to ceiling:

- **The internet path: ~25ms, and it is clean.** A game-shaped UDP probe (60
  packets/sec, 200-byte payloads, 90 seconds, throwaway echo container on the
  box) returned p50 25.0ms, p95 27.7ms, p99 42.0ms, max 98.3ms, **0% loss**.
  Rate-independent - same shape at 20/s and 100/s - so it is ambient last-mile
  jitter, not congestion.
- **The VPS's own network contributes nothing.** From the box: 0% loss, 0.66ms
  average, 0.037ms mdev to 1.1.1.1 over 200 packets.
- **Do not trust ICMP here.** `ping` to the box reported 3% loss at 10/s. The UDP
  probe over the same path at the same moment lost nothing. That 3% was ICMP
  rate-limiting, and believing it would have sent the whole investigation after
  a packet-loss problem that does not exist.
- **The WebRTC transport adds ~0 at the median.** Candidate-pair
  `currentRoundTripTime` was 24.0-25.7ms across every run - the same as the raw
  UDP p50. The selected pair is `prflx/udp` straight to
  `149.28.172.74:27038`; no relay, and the Cloudflare Worker carries only the
  page, `valve.zip` and the signalling socket, never game packets.
- **The rest is quantisation.** One server tick plus up to one client frame. The
  browser's frame loop is `requestAnimationFrame`-driven, so on a 60Hz display
  that is up to ~17ms on its own. ~25 + ~10 + ~8 is the ~43ms floor the
  scoreboard shows, and no config reaches it.

Note that the ~43ms ping the scoreboard shows is **not** the same thing as the
100ms of interpolation delay every client carries. Ping is the round trip;
`ex_interp` is a deliberate rendering delay on top of it, and lag compensation
is what stops that delay costing you shots.

## What the two server cvars bought

Six connected browser clients on `fy_iceworld`, 140-150s sampling, the server's
own `status` ping column:

| | before | after |
|---|---|---|
| ping p50 | 45-48ms | **39ms** |
| ping p95 | **73-104ms** | **50ms** |
| ping max | 74-116ms | 51ms |
| snapshots/sec per client | 76.5 | 48.9 |
| engine CPU (of one core) | 44-47% | **32-37%** |

The baseline was run twice and its p95 came out 73 then 104. The fixed config
run twice came out 50 and 47. That instability across identical baseline runs
*is* the "fluctuating between 30 and 100" players reported - the point is not
just that the numbers are lower, it is that they stop moving.

Contribution of each, six clients:

| `sv_maxupdaterate` | `sys_ticrate` | p50 | p95 | max | CPU |
|---|---|---|---|---|---|
| 102 (was shipped) | 100 (was shipped) | 45-48 | 73-104 | 74-116 | 44-47% |
| 60 | 100 | 43-48 | 47-53 | 48-53 | 39-45% |
| **60** | **200** | **39** | **50** | **51** | **32-37%** |

The last two rows were run back to back against the same clients, so the
tick-rate row is not drift.

### How fast the server loop actually runs

`sys_ticrate` governs the dedicated loop on this engine; `fps_max` does not,
despite the server reporting `fps_max 72`. Setting `fps_max` to 30, to 500, and
setting `fps_override 1` and `host_framerate 0.005` all moved the measured
cadence by exactly zero, while `sys_ticrate 500` took a throwaway container's
cadence from 52.5ms to 2.28ms.

**The loop never reaches 1000. It tops out at about 425Hz.** Throwaway
container, plugin counting `server_frame()`, ten bots on `fy_iceworld`:

| `sys_ticrate` | achieved | achieved/target | gap p50 | p99 | engine CPU |
|---|---|---|---|---|---|
| 100 | 27/s | 0.27 | 52.5ms | 53.5ms | 11% |
| 200 | 122/s | 0.61 | 4.5ms | **52.5ms** | 32% |
| 250 | 251/s | 1.00 | 3.5ms | 3.5ms | 45% |
| 300 | 300/s | 1.00 | 3.0ms | 3.5ms | 34% |
| 400 | 391/s | 0.98 | 2.5ms | 3.5ms | 16% |
| 450 | 419/s | 0.93 | 2.0ms | 3.5ms | 9% |
| 500 | 419/s | 0.84 | 2.0ms | 3.5ms | 9% |
| **1000** | **426/s** | 0.43 | **2.0ms** | **3.0ms** | **9%** |
| 2000 | 434/s | 0.22 | 2.0ms | 3.0ms | 8% |
| 10000 | 424/s | 0.043 | 2.0ms | 3.0ms | 10% |

**The engine busy-waits the gap between its own frame cost and the ticrate
period.** A frame costs about 2.3ms. Spin per second is roughly
`(period - 2.3ms) x achieved rate`, which predicts the measured CPU almost
exactly: at 250, `(4.0-2.3) x 251 = 427ms/s` against 45% measured; at 300,
`(3.33-2.3) x 300 = 309ms/s` against 34%; at 200, `(5.0-2.3) x 122 = 329ms/s`
against 32%. At 450 and above the period is at or under the frame cost, there is
nothing left to wait for, and the spin disappears.

So CPU against `sys_ticrate` is **not monotonic**. It peaks around 250 and then
falls off a cliff. The cheap configurations are the very slow one and the ones
at or past the ceiling; everything in between pays for waiting.

**Below 250 the loop also stalls.** At 100 and 200 the frame-gap p99 is 52.5ms
while the p50 is 4.5ms - a burst of fast frames, then a dead stop for 52ms. At
250 and above it never happens again. The old shipped 200 was delivering about
**120Hz of simulation, not 200**, with a 52ms hitch in the tail of every hundred
frames.

1000 is chosen to sit **above the achievable ceiling under every load
measured**, because that is the condition under which the spin disappears. 500
works today (18-20% against 1000's 15-18%) but has no margin; if the box is ever
quieter or a future image faster, 500 could fall back inside the spin band and
1000 will not. 10000 measures identically to 1000 and buys nothing.

Six real browser clients, `sv_maxupdaterate 60` throughout:

| `sys_ticrate` | run | p50 | p95 | max | CPU | snapshots/s |
|---|---|---|---|---|---|---|
| 200 | a | 37 | 42 | 43 | 34.5% | 45.6 |
| 200 | b | 36 | 42 | 45 | 31.5% | 46.0 |
| 200 | c (drift re-check, last) | 43 | 47 | 50 | 40.9% | 47.3 |
| 500 | a | 38 | 44 | 46 | 18.6% | 44.7 |
| 500 | b | 37 | 45 | 48 | 19.6% | 43.8 |
| 1000 | a | 36 | 43 | 44 | 17.6% | 43.5 |
| 1000 | c | 45 | 51 | 51 | 15.4% | 44.2 |
| 1000 | d | 38 | 44 | 48 | 16.7% | 46.0 |
| 10000 | a | 43 | 51 | 51 | 15.7% | 44.2 |
| 10000 | b | 43 | 48 | 49 | 16.4% | 45.0 |

**The ping column does not move.** The spread within one ticrate is as wide as
between ticrates. The drift re-check is the point: run last, 200 came back at
p50 43 / p95 47, indistinguishable from what 1000 and 10000 had just produced.
What *is* clean and repeatable is CPU - 200 costs roughly twice what anything at
or past the ceiling costs, in every pairing. Snapshots per client sit at 44-47/s
at every value, so a faster loop does **not** put more packets on the wire.

Net effect, six clients: simulation about 120Hz -> about 425Hz, engine CPU
31-41% -> 15-18% of a core, ping unchanged.

## What was tried and did nothing

The most valuable list on this page. In rough order of how tempting each was.

- **`cl_cmdrate` at any value.** Clamped to 100 client-side
  (`cl_main.c:911-915`), and inert anyway: `CL_CreateCmd` builds one usercmd per
  rendered frame (`cl_main.c:759-772`) and `cl_cmdrate` only gates transmission,
  batching held-back commands into the next packet rather than dropping them. The
  achievable rate is `min(fps, 100)` and fps binds. Measured out/rAF ratio
  0.973-0.984 across six runs. The "cmdrate = fps + 5" rule from the rates guides
  is fine reasoning, but applied honestly to a 60fps browser client it gives ~65,
  not 101 - and any number at or above the frame rate behaves identically.
- **`sv_maxcmdrate` / `sv_mincmdrate`.** Not cvars in this engine. Confirmed
  against the shipped binary, not just the source: a `grep -aoE` over
  `/xashds/xash` for the whole `sv_*rate` family returns
  `sv_maxrate sv_minrate sv_maxupdaterate sv_minupdaterate sv_unlag sv_maxunlag
  sv_unlagpush sv_unlagsamples` and no cmdrate pair. `cl_cmdrate` is unclamped
  server-side because there is nothing to clamp it with.
- **`sv_maxupdaterate` above 60.** See the whole section above. No hit-reg
  mechanism, negligible spacing error, costs ping tail and shrinks the unlag
  window.
- **`rate` above 20000.** The rates guides assert a hard GoldSrc maximum of
  20000. **Not true on this engine:** `MAX_RATE` is 100000 (`netchan.h:33`),
  applied at `sv_client.c:1816-1819`, and a connected client reads back
  `rate 100000` cleanly. It is also moot - measured inbound traffic is only
  15.5KB/s per client at `sv_maxupdaterate` 102 and 10KB/s at 60, with a flat
  ~200 bytes per packet, so bandwidth is nowhere near binding and is not what
  limits the snapshot rate. Additionally `SV_CheckRate` is a no-op in master
  (every branch returns `rate`), so `sv_maxrate`/`sv_minrate` currently clamp
  nothing - though that was not verified against the deployed binary.
- **`ex_interp 0`, and lowering `ex_interp` generally.** The single most
  dangerous piece of inherited advice on this build. See above: it costs a median
  16 units of aim error and puts half of all shots at a moving target outside the
  hitbox. Left at 0.1 and now protected from settings snapshots.
- **`ex_interp 0.05`**: no measurable effect on the server ping column, which is
  expected - ping and interpolation are different things. Reverted. (This was
  measured before the `lerp_msec` bug was understood; on the registration side it
  was actively harmful, which the ping column could never have shown.)
- **`cl_updaterate 60` on the client alone**, server still at 102: ping p95 57ms
  against a 73ms baseline, so some of the win, but strictly worse than the
  server-side cap (47ms) and it only reaches players whose saved settings do not
  override it.
- **`sys_ticrate` for ping.** Every value from 200 to 10000 lands inside the
  run-to-run noise on the ping column. The win is simulation rate and CPU
  headroom, not latency.
- **`sys_ticrate 10000`.** Achieves the same 424/s as 1000 at the same CPU. The
  "10000 fps server" of the HLDS era has no analogue here; this engine's ceiling
  is a frame cost, not a scheduler granularity.
- **`fps_max` on the server.** Does nothing to the dedicated loop.
- **`cl_cmdbackup`.** Left at the engine default 2. Insurance against lost
  usercmds; the path loses nothing measurable.
- **`sv_unlagsamples`.** Does *not* size the history, contrary to the obvious
  reading of the name - it is only how many past frames are averaged when
  estimating ping (`sv_client.c:1127`), clamped to `[1, 16]`. Default 1. The
  history depth is the fixed 64-frame `MULTIPLAYER_BACKUP`.
- **The data channels.** First suspect, and wrong. A reliable ordered channel
  head-of-line blocks on any loss, which looks exactly like rubber banding. Both
  server-created channels read `ordered=false maxRetransmits=0
  maxPacketLifeTime=null` - unreliable and unordered, correct for a game, and
  goxash3d's own choice. `apps/web/src/webrtc.ts` only receives these via
  `ondatachannel`, so there is nothing on our side to change.
- **Anything on the Cloudflare hop.** Not in the game path. Confirmed by the
  selected ICE candidate pair, not assumed from the Worker source.
- **Bot count.** `yb_quota` is in `fill` mode, so the quota counts *total*
  players: eight humans means two bots, not twelve. A busy Friday is the same ten
  players on the map as a quiet one. Bot CPU is ~+0.1% of a core each over a
  ~1.7% floor.
- **Blaming round transitions for the ten-client ping tail.** Rounds fired every
  ~11s straight through both the spiking polls and the clean ones.
- **Reading a plugin's own `cpupct`.** `tickcount()` is not wall clock on this
  build. All CPU figures here come from `/proc/<pid>/stat` utime+stime over a
  fixed window.

## The ten-client tail is the harness, not the box

Worth keeping because it looks alarming and is not. Four clean ten-client runs:

| run | `sys_ticrate` | p50 | p95 | max | engine CPU |
|---|---|---|---|---|---|
| H200 | 200 | 48 | 96 | 175 | 32.5% |
| H1000 | 1000 | 43 | 117 | 174 | 22.4% |
| K200ten | 200 | 42 | **50** | 60 | 28.9% |
| CMB | 1000 | 41 | **49** | 50 | 20.1% |

Two of four have a large tail and two have none, at both ticrates, minutes
apart. Episodic, not a load threshold. Four things place it on the Mac:

- When it appears it is **common mode** - every client's ping rises in the same
  status poll and falls together, rather than a few slow clients dragging a
  percentile. All ten clients' own frame loops stayed healthy through it.
- Through the worst episode the **engine CPU never moved**: flat 19-22% of a
  core, box steal 0.1%, run queue never above 5.
- During it the **server-to-client** snapshot rate collapsed 37/s to 19/s while
  each client's **client-to-server** rate held at 36-38/s. Packets were not
  arriving; the server was not failing to send them.
- An independent game-shaped **UDP echo probe** from the same Mac over the same
  uplink during a ten-client run, touching no game code, showed 0% loss and a
  steady 25ms p50 but single-packet excursions to 60-170ms scattered right
  through the window.

Ten headless Chromes on one laptop behind one domestic uplink is not ten players
on ten machines. Do not project this onto a real session, and do not re-chase
it. The defensible ten-client numbers are the clean pair, p50 41-42 / p95 49-50,
the same as six.

## Caveats on these numbers

- Client load was six to ten headless Chrome clients on one Mac, which pins that
  Mac's CPU: harness client frame rate sat at 28-37fps, below what a player on
  their own laptop gets. The **server-side** ping column is quoted throughout
  precisely because it is not contaminated by that.
- One client network. The ~25ms floor and the occasional ~100ms path spike belong
  to that connection.
- **No trustworthy sixteen-client number exists.** See below.
- `sv_maxupdaterate` was not swept below 60. 60 is justified by the display
  refresh rather than by a search.
- The hit-registration analysis is driven by a bot trace. Bot motion updates at
  43Hz; a human's updates at their own frame rate. Both are at or below 60Hz, so
  the conclusion about snapshot rates above 60 holds either way, but a
  human-driven trace would be a better ground truth if this is ever revisited.
- The `ex_interp` error table is computed from the timing mismatch and the
  measured motion, not from counting missed shots in a live game. It is a
  mechanism calculation with real motion as input, and it has not been confirmed
  by a controlled shooting test.

### Why there is no full-server number

Ben asked for this "with a full server", 16 slots. It was not produced, and the
honest reason is that the measurement would have been dominated by the test rig
rather than the server.

Ten headless Chromes on one Mac already produce a ping tail that was traced to
the Mac and the uplink, not the box - engine CPU flat through the worst of it,
and an independent UDP probe touching no game code showing the same excursions.
Sixteen would be worse, and any tail it produced would be unattributable.

The usual split - bots for simulation load plus a few well-resourced real clients
for measurement - does not rescue it either, because bots are server-side: they
never receive a snapshot, so they exercise nothing that `sv_maxupdaterate`
touches. A bot-loaded server measures CPU honestly and update-rate effects not at
all.

This matters less than it looks, because the decisive findings do not depend on
client count: `cl_cmdrate`'s clamp and the one-command-per-frame behaviour are
properties of the client, and the lag-compensation path is a property of the
server's code. Neither changes at 16 players. What a genuine 16-player test
*would* add is the cost side - how much worse the ping tail gets at a raised
cap under real load - and since the recommendation is to not raise the cap, that
number is not needed to act.

## Two traps that cost real runs

- **A live cvar does not survive a container restart, and `mp_timelimit 0` does
  not either.** A restart mid-investigation put the map back into rotation, so
  later runs were on `fy_pool_day` rather than `fy_iceworld`. Re-assert both
  after any restart and check the map before trusting a run.
- **Reused client aliases silently mix live and dead slots.** When a client drops
  and rejoins, the engine suffixes the name (`probe3` comes back as `probe3 (1)`)
  while the ghost holds the original for `sv_timeout` (600s). Two ten-client runs
  were really about eight live clients plus ghosts, and the ping column counted
  both. Give every run a unique alias prefix, and grep captured `status` rows for
  `(1)` before believing a percentile.

## The on-screen readout

`net_graph` ships on (`net_graph 3`, `net_graphpos 2`), with an off/ping/graph
control on the settings page. A player who can read their own ping turns "it
feels laggy" into "I'm on 180", and that is the difference between a report we
can act on and one we cannot.

The values are inverted from what the names suggest on this build, read off
in-game screenshots:

| | draws |
|---|---|
| `net_graph 1` | three lines of text plus a scrolling bar strip |
| `net_graph 2` | a large filled area graph on top of all of that - very busy |
| `net_graph 3` | four lines of text only, and the only one printing loss/choke |

So 3 is simultaneously the most informative and the least cluttered.
`net_graphpos 2` centres it along the bottom edge, clear of the ammo and health
numbers; pos 1 (the engine default) drops it on the ammo counter.

`cl_showfps` went 1 -> 0 as part of this. Every non-zero `net_graph` prints its
own fps, so leaving `cl_showfps` on puts two disagreeing fps numbers on screen at
once - "30 fps" in the corner against "33.3 fps" in the block, verified in-game.
That reads as a bug. `net_graph` owns the readout.

## Getting it live

Server cvars reach everyone on the next deploy, or instantly:

```sh
pnpm run rc "sv_maxupdaterate 60" "sys_ticrate 1000"
```

A live `rc` set survives a `changelevel` but **not** a container restart -
`server.cfg` re-execs from the image, so until the mods are rebuilt the box
reverts on any restart, crash-heal or swap. The deploy is what makes it stick.

Client-side settings are slower to land, and that asymmetry is itself an argument
about where to put a setting. `server/config/userconfig.cfg` only reaches players
after `pnpm run clientcfg` rebuilds `valve.zip` **and** they hard-refresh; the
`ENGINE_OWNED` guard in `apps/web/src/launch.ts` is app code and needs a
`pnpm run deploy`. A server-side change is live immediately for everybody; a
client-side one is not.

## Re-measuring

The server's own ping column is the honest latency metric and needs no client
tooling:

```sh
pnpm run rc "status"     # ping column per connected human; bots print "Bot"
```

Sample repeatedly during play and look at the **spread**, not the median. A tight
band is the goal; a median of 45 with excursions to 100 is the failure mode.

For hit registration, do **not** re-measure the ping column - it cannot see the
thing. The method that worked was: log every player's origin every server frame
from an AMXX plugin in a throwaway container, then compute offline (a) what a
client would draw at a given snapshot rate and (b) what a given client/server
timing mismatch costs in world units, scoring both only at moments when the
target is actually moving. That produces a number in units against a known hitbox
width, is deterministic, and needs a single recording, so it is immune to the
run-to-run drift that makes the ping column so noisy.
