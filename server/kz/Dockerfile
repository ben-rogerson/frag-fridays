FROM yohimik/cs-web-server-metpamx:latest

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
# scoreboard/server-browser name (base image default: "My WebXash3D CS Server").
# Leading \n matters: the base image's server.cfg has no trailing newline.
RUN printf '\nhostname "Frag Friday"\n' >> cstrike/server.cfg
# HL logging - kz.sma writes one kz_finish line per completed run into
# cstrike/logs (compose-mounts /opt/cs16/logs/kz); feeds the Friday recap
RUN printf 'log on\nmp_logfile 1\n' >> cstrike/server.cfg
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

USER xashds
