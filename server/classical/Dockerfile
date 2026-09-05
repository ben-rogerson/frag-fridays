FROM yohimik/cs-web-server-metpamx:0.1.3

# ClassicAl: Classic's round structure with the match rules taken off.
#
# It is CPL Tournament's twin and deliberately NOT a dm clone - there is no
# frag_dm.amxx here, because that plugin's whole job is instant respawn,
# mp_freezetime 0 and mp_timelimit 10 forced from plugin_init, which would
# overwrite the ruleset below on every map. Rounds, buying and one life are
# the point; what changes is that you can watch after you die, everyone is
# rich, bots fill the server and the map moves on a clock.
#
# Full rules and where every CPL number came from: docs/classic-rules.md.
COPY addons cstrike/addons
# curated rotation. maps.ini is regenerated from it so the end-of-map vote
# only ever offers maps that are actually in the (trimmed) client valve.zip.
COPY mapcycle.txt cstrike/mapcycle.txt

USER root
RUN cp cstrike/mapcycle.txt cstrike/addons/amxmodx/configs/maps.ini
# THIS BLOCK IS THE RULESET, and it is in amxx.cfg on purpose. AMXX execs
# amxx.cfg at EVERY map start; server.cfg execs ONCE, at container start (a
# changelevel does not re-run it - measured 2026-09-04). Classic learned that
# the hard way: a box-side amxx.cfg carrying casual values silently outranked
# its server.cfg on every map after the first. Put a gameplay cvar here or it
# only holds for one map.
#
# Deltas from CPL Tournament (server/cpl/server.cfg), and nothing else:
#   fadetoblack/forcecamera/forcechasecam 0 - the whole reason this mode
#     exists. Dead players watch whoever is still alive instead of a black
#     screen. classic-rules.md already names 0 as a legitimate era value.
#   startmoney 16000 - the engine's ceiling, so every round is a full buy.
#   timelimit 10 / maxrounds 0 - maps rotate on the clock like every other
#     mode here, so a 30-minute block sees three of them instead of one half.
#   freezetime 6 - 15s of standing still is a tenth of a 10-minute map.
#   limitteams 0 - mechanical, not taste: stock CS blocks joining the larger
#     team ("only 1 team change is allowed"), which locks a human out of a
#     bot-filled server. Same reason dm runs 0.
# friendlyfire stays 1 and autoteambalance stays 0: this is still Classic.
# hostagepenalty 0 because cs_office, cs_italy and cs_assault are in the pool
# and a stray shot should not kick anybody.
# sv_gravity/sv_airaccelerate are the baseline any per-map override resets from.
RUN printf 'sv_gravity 800\nsv_airaccelerate 10\nmp_roundtime 1.75\nmp_freezetime 6\nmp_buytime .25\nmp_c4timer 35\nmp_startmoney 16000\nmp_maxrounds 0\nmp_winlimit 0\nmp_timelimit 10\nmp_friendlyfire 1\nmp_autoteambalance 0\nmp_limitteams 0\nmp_tkpunish 0\nmp_hostagepenalty 0\nmp_fadetoblack 0\nmp_forcecamera 0\nmp_forcechasecam 0\nallow_spectators 1\n' >> cstrike/addons/amxmodx/configs/amxx.cfg
# stock amxx.cfg ships AMX Mod X adverts (scrolling HUD line + centre-screen
# "This server is using AMX Mod X" every 3 min) - strip them
RUN sed -i '/^amx_scrollmsg /d; /^amx_imessage "This server is using/d' cstrike/addons/amxmodx/configs/amxx.cfg
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
# no mode plugin to register here - scripting/ holds only the four the whole
# server runs, and each registers itself below.
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/
# remote console via compose-mounted command file - see scripting/cmdpipe.sma
RUN grep -qx 'cmdpipe.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'cmdpipe.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini
# ff_rebalance / ff_swapteams server commands (cmdpipe-driven) - see
# scripting/teambalance.sma. This is what CPL Tournament cannot have: it runs
# the stock image unbuilt and compiles nothing, so its half-time swap is ten
# people rejoining by hand (docs/backlog.md item 16).
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
