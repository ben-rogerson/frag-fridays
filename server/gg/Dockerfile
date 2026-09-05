FROM yohimik/cs-web-server-metpamx:0.1.3
COPY addons cstrike/addons
# curated rotation. maps.ini is regenerated from it so the end-of-map vote
# only ever offers maps that are actually in the (trimmed) client valve.zip.
COPY mapcycle.txt cstrike/mapcycle.txt
USER root
RUN cp cstrike/mapcycle.txt cstrike/addons/amxmodx/configs/maps.ini
# amxx.cfg runs every map start, BEFORE configs/maps/<map>.cfg - so these are
# the baseline that per-map overrides (scoutzknivez low gravity, small-map
# round time) reset from.
RUN printf 'sv_gravity 800\nsv_airaccelerate 10\nmp_friendlyfire 0\nmp_roundtime 5\n' >> cstrike/addons/amxmodx/configs/amxx.cfg
# amxx.cfg ships adverts that print over the game: a scrolling HUD line, and
# centre-screen imessage lines every amx_freq_imessage seconds - AMXX's own
# "This server is using AMX Mod X" plus a "Welcome to %hostname%" the base
# image carries. Both imessage lines are a banner across the middle of the
# screen mid-round, so drop every amx_imessage, not just the AMXX one.
# imessage.amxx stays loaded; with nothing registered it prints nothing.
RUN sed -i '/^amx_scrollmsg /d; /^amx_imessage /d' cstrike/addons/amxmodx/configs/amxx.cfg
# scoreboard/server-browser name (base image default: "My WebXash3D CS Server").
# Leading \n matters: the base image's server.cfg has no trailing newline.
RUN printf '\nhostname "Frag Fridays"\n' >> cstrike/server.cfg
# HL kill logging - one line per frag into cstrike/logs (compose-mounts
# /opt/cs16/logs/<mod> so files survive restarts); feeds the Friday recap
RUN printf 'log on\nmp_logfile 1\n' >> cstrike/server.cfg
# browsers freeze the WASM game loop in background tabs, so alt-tabbed players
# go network-silent; the engine default (65s) kicked them. 600s = 10 min grace.
RUN printf 'sv_timeout 600\n' >> cstrike/server.cfg
# same reasoning for the idle detector: alt-tabbed players send no input and
# trip Game_idle_kick otherwise
RUN printf 'mp_autokick 0\n' >> cstrike/server.cfg
# rate ceilings for the client rates userconfig.cfg asks for (rate 100000,
# cl_updaterate 60). These are SERVER cvars - they did nothing in
# userconfig.cfg, which only ever reaches the browser client.
# sv_maxcmdrate/sv_mincmdrate are not cvars in this engine (verified against
# xash.wasm); cl_cmdrate is clamped by the engine itself.
#
# sv_maxupdaterate 60, not 102 - measured 2026-09-04, see docs/netcode.md.
# The browser client's frame loop is rAF-driven, so it can never present more
# than one snapshot per display refresh; at 102 the server was building and
# sending ~76 snapshots/sec per client that the client could only throw away.
# The cap belongs HERE and not in userconfig.cfg because this cvar clamps
# whatever a client asks for: it needs no valve.zip rebuild, and it covers
# players whose saved-settings snapshot replays an old cl_updaterate over the
# shipped one. With 6 clients on fy_iceworld the server's own ping column went
# from p50 45-48ms / p95 73-104ms to p50 43-48ms / p95 47-48ms. The median
# barely moved; the TAIL collapsed, and the tail is what players read as
# rubber banding. Engine CPU on the box fell 45.6% -> 40.0% of a core.
RUN printf 'sv_maxrate 100000\nsv_minrate 25000\nsv_maxupdaterate 60\nsv_minupdaterate 30\n' >> cstrike/server.cfg
# sys_ticrate 1000, not the stock 100 - measured 2026-09-04, docs/netcode.md.
# sys_ticrate is what actually governs the dedicated loop on this engine
# (fps_max does NOT - setting it to 30 or 500 moved the measured frame cadence
# by exactly zero, so the fps_max 72 the server reports is a red herring).
# 1000 is NOT a claim that the loop runs at 1000: it tops out near 425Hz on
# this box. It is set above that ceiling on purpose. The engine busy-waits the
# gap between its ~2.3ms frame cost and the sys_ticrate period, so cost is
# roughly (period - 2.3ms) x achieved rate - which means CPU against ticrate is
# NOT monotonic. It peaks around 250 (45% of a core) and collapses once the
# period reaches the frame cost. Any target at or above the ceiling removes the
# wait entirely.
# Measured, six browser clients on fy_iceworld: at the previous 200 the loop
# achieved only ~120Hz (with a 52ms hitch at p99) for 31-41% of a core; at 1000
# it achieves ~425Hz for 15-18%. The ping column does not move - the win is
# simulation rate and CPU headroom, not latency, and anyone re-testing this
# should not expect ping to change. 500 also works but sits only ~18% above the
# ceiling; 1000 keeps margin if the box is ever quieter. 10000 measures
# identically to 1000 and buys nothing.
RUN printf 'sys_ticrate 1000\n' >> cstrike/server.cfg
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/ \
 && grep -qx 'gungame.amxx' ../configs/plugins.ini || echo 'gungame.amxx' >> ../configs/plugins.ini
# remote console via compose-mounted command file - see scripting/cmdpipe.sma
RUN grep -qx 'cmdpipe.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'cmdpipe.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini
# ff_rebalance / ff_swapteams server commands (cmdpipe-driven) - see scripting/teambalance.sma
RUN grep -qx 'teambalance.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'teambalance.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

# a crashed player's old session holds their slot AND their name for
# sv_timeout (600s), so they come back as "Name (1)" and the standings and
# the recap count them as two people - see scripting/ff_rejoin.sma
RUN grep -qx 'ff_rejoin.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'ff_rejoin.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

# live status for the web loading screen - see scripting/statusjson.sma.
# The plugin writes into the statically-served public/ dir; pre-create the
# file writable so the dir itself can stay root-owned.
RUN grep -qx 'statusjson.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'statusjson.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini
RUN touch public/status.json && chown xashds public/status.json

# spectator camera: dead players land in their killer's own first-person view
# instead of the free-fly camera the dll drops them into, and the two
# map-overview modes are out of the jump cycle - they are a black screen on every
# map with no overviews/<map>.bmp, which is 16 of the 30 maps across our
# rotations. See scripting/ff_specmode.sma.
RUN grep -qx 'ff_specmode.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'ff_specmode.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

# YaPB registers with METAMOD's plugins.ini (not AMXX's - third registration
# file, see docs/troubleshooting.md). Bots need write access to data/ at
# runtime (logs, learned files).
RUN echo 'linux addons/yapb/bin/yapb.so' >> cstrike/addons/metamod/plugins.ini \
 && mkdir -p cstrike/addons/yapb/data/logs cstrike/addons/yapb/data/pwf cstrike/addons/yapb/data/train \
 && chown -R xashds cstrike/addons/yapb
# the engine writes <map>.bsp.ztmp into cstrike/maps when a client is missing
# a file and asks for it in-band; a root-owned dir makes that write a fatal
# Xash error that crash-loops the server on every such connect
RUN chown xashds cstrike/maps

# the engine creates cstrike/custom.hpk - the spray/decal store - the first
# time a client uploads its decal, and DELETES the file again when it drops
# to a single entry, so it must create and unlink entries in cstrike/ itself;
# a pre-created writable file is not enough. Root-owned, every spray logged
# "FS_SysOpen: can't open file cstrike/custom.hpk: Permission denied" - three
# lines per map spawn with three humans on (seen 2026-08-28). Only the
# directory entry changes hands; the files inside stay root-owned.
RUN chown xashds cstrike

# AMXX creates logs/L<date>.log at map start; without a writable logs dir it
# fails and disables its own logging for the map
RUN mkdir -p cstrike/addons/amxmodx/logs && chown xashds cstrike/addons/amxmodx/logs

# shuffle the rotation on every container start and boot into the shuffled
# first map - see entrypoint.sh. mapcycle.txt must be writable by the runtime
# user for the in-place shuffle.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown xashds cstrike/mapcycle.txt
ENTRYPOINT ["/entrypoint.sh"]

USER xashds
