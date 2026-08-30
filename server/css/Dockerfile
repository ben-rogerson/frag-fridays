FROM yohimik/cs-web-server-metpamx:0.1.3

# Source Maps: dm's rules on CS:S/CS:GO maps remade for 1.6. Same baseline as
# dm - four of the six carry real bombsites, so mp_roundtime 5 still bites
# (frag_dm strips the C4, so a round can only ever end on the timer).
COPY addons cstrike/addons
# curated rotation. maps.ini is regenerated from it so the end-of-map vote
# only ever offers maps that are actually in the (trimmed) client valve.zip.
COPY mapcycle.txt cstrike/mapcycle.txt

USER root
RUN cp cstrike/mapcycle.txt cstrike/addons/amxmodx/configs/maps.ini
# amxx.cfg runs every map start, BEFORE configs/maps/<map>.cfg - so these are
# the baseline that per-map overrides (scoutzknivez low gravity) reset from.
# limitteams/autoteambalance off: stock CS blocks joining the larger team
# mid-map ("only 1 team change is allowed"), which locks humans out of a
# bot-filled deathmatch. Uneven teams don't matter in DM.
RUN printf 'sv_gravity 800\nsv_airaccelerate 10\nmp_limitteams 0\nmp_autoteambalance 0\nmp_friendlyfire 0\nmp_roundtime 5\ndm_only ""\ndm_map_guns 0\n' >> cstrike/addons/amxmodx/configs/amxx.cfg
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
# cl_updaterate 102). These are SERVER cvars - they did nothing in
# userconfig.cfg, which only ever reaches the browser client.
# sv_maxcmdrate/sv_mincmdrate are not cvars in this engine (verified against
# xash.wasm); cl_cmdrate is clamped by the engine itself.
RUN printf 'sv_maxrate 100000\nsv_minrate 25000\nsv_maxupdaterate 102\nsv_minupdaterate 30\n' >> cstrike/server.cfg
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
# ff_rebalance / ff_swapteams server commands (cmdpipe-driven) - see scripting/teambalance.sma
RUN grep -qx 'teambalance.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'teambalance.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

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
