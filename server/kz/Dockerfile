FROM yohimik/cs-web-server-metpamx:0.1.3

# kz.sma is compiled at build time by the toolchain the base image ships in
# scripting/ (same pattern as gg/dm). No YaPB here on purpose: bots cannot
# climb and an unknown-map graph download buys nothing on jump maps.
COPY addons cstrike/addons
# curated rotation. maps.ini is regenerated from it so the end-of-map vote
# only ever offers maps that are actually in the (trimmed) client valve.zip.
COPY mapcycle.txt cstrike/mapcycle.txt

USER root
RUN cp cstrike/mapcycle.txt cstrike/addons/amxmodx/configs/maps.ini
# amxx.cfg runs every map start, BEFORE configs/maps/<map>.cfg. KZ standard
# physics: stock gravity, airaccelerate 10. limitteams/autoteambalance off so
# the plugin's everyone-on-CT policy never fights the stock team logic (the
# rotation's kz maps ship zero T spawn points).
RUN printf 'sv_gravity 800\nsv_airaccelerate 10\nmp_limitteams 0\nmp_autoteambalance 0\nmp_friendlyfire 0\nmp_roundtime 9\n' >> cstrike/addons/amxmodx/configs/amxx.cfg
# stock amxx.cfg ships AMX Mod X adverts (scrolling HUD line + centre-screen
# "This server is using AMX Mod X" every 3 min) - strip them
RUN sed -i '/^amx_scrollmsg /d; /^amx_imessage "This server is using/d' cstrike/addons/amxmodx/configs/amxx.cfg
# scoreboard/server-browser name (base image default: "My WebXash3D CS Server").
# Leading \n matters: the base image's server.cfg has no trailing newline.
RUN printf '\nhostname "Frag Fridays"\n' >> cstrike/server.cfg
# HL logging - kz.sma writes one kz_finish line per completed run into
# cstrike/logs (compose-mounts /opt/cs16/logs/kz); feeds the Friday recap
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
 && grep -qx 'kz.amxx' ../configs/plugins.ini || echo 'kz.amxx' >> ../configs/plugins.ini
# remote console via compose-mounted command file - see scripting/cmdpipe.sma
RUN grep -qx 'cmdpipe.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'cmdpipe.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

# live status for the web loading screen - see scripting/statusjson.sma.
# The plugin writes into the statically-served public/ dir; pre-create the
# file writable so the dir itself can stay root-owned.
RUN grep -qx 'statusjson.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'statusjson.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini
RUN touch public/status.json && chown xashds public/status.json

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
