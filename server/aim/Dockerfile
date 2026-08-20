FROM yohimik/cs-web-server-metpamx:0.1.3

# Aim Prac: dm's frag_dm.sma with dm_bot_knives on - 20 knife-only YaPB bots
# on T (yapb.cfg: quota 20, join_team t, jasonmode, autovacate off), humans
# forced to CT by forcect.sma. No teambalance.amxx on purpose: a rebalance
# would shove knife bots onto CT.
COPY addons cstrike/addons
# curated rotation. maps.ini is regenerated from it so the end-of-map vote
# only ever offers maps that are actually in the (trimmed) client valve.zip.
COPY mapcycle.txt cstrike/mapcycle.txt

USER root
RUN cp cstrike/mapcycle.txt cstrike/addons/amxmodx/configs/maps.ini
# amxx.cfg runs every map start. limitteams/autoteambalance off: stock CS
# blocks joining the larger team mid-map ("only 1 team change is allowed"),
# and 20vs7 IS the mode - the engine must never "fix" it.
# dm_bot_knives 1 is what turns frag_dm's bot handling into the knife horde.
RUN printf 'sv_gravity 800\nsv_airaccelerate 10\nmp_limitteams 0\nmp_autoteambalance 0\nmp_friendlyfire 0\nmp_roundtime 5\ndm_only ""\ndm_map_guns 0\ndm_bot_knives 1\n' >> cstrike/addons/amxmodx/configs/amxx.cfg
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
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/ \
 && grep -qx 'frag_dm.amxx' ../configs/plugins.ini || echo 'frag_dm.amxx' >> ../configs/plugins.ini
# remote console via compose-mounted command file - see scripting/cmdpipe.sma
RUN grep -qx 'cmdpipe.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'cmdpipe.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini
# !restart chat command - see scripting/chatrestart.sma
RUN grep -qx 'chatrestart.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'chatrestart.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini
# humans can only join CT - see scripting/forcect.sma
RUN grep -qx 'forcect.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'forcect.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

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
