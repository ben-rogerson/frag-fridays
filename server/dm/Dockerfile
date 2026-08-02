FROM yohimik/cs-web-server-metpamx:latest

# frag_dm.sma is compiled at build time by the toolchain the base image ships
# in scripting/ (same pattern as gg). CSDM was abandoned: its binary module
# signature-scans the original CS DLL and fails silently against this stack's
# reimplemented one - see docs/decisions.md.
COPY addons cstrike/addons
# curated rotation. maps.ini is regenerated from it so the end-of-map vote
# only ever offers maps that are actually in the (trimmed) client valve.zip.
COPY mapcycle.txt cstrike/mapcycle.txt

USER root
RUN cp cstrike/mapcycle.txt cstrike/addons/amxmodx/configs/maps.ini
# amxx.cfg runs every map start, BEFORE configs/maps/<map>.cfg - so these are
# the baseline that per-map overrides (scoutzknivez low gravity) reset from.
RUN printf 'sv_gravity 800\nsv_airaccelerate 10\n' >> cstrike/addons/amxmodx/configs/amxx.cfg
# scoreboard/server-browser name (base image default: "My WebXash3D CS Server").
# Leading \n matters: the base image's server.cfg has no trailing newline.
RUN printf '\nhostname "Frag Friday"\n' >> cstrike/server.cfg
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/ \
 && grep -qx 'frag_dm.amxx' ../configs/plugins.ini || echo 'frag_dm.amxx' >> ../configs/plugins.ini
# remote console via compose-mounted command file - see scripting/cmdpipe.sma
RUN grep -qx 'cmdpipe.amxx' cstrike/addons/amxmodx/configs/plugins.ini \
 || echo 'cmdpipe.amxx' >> cstrike/addons/amxmodx/configs/plugins.ini

# YaPB registers with METAMOD's plugins.ini (not AMXX's - third registration
# file, see docs/troubleshooting.md). Bots need write access to data/ at
# runtime (logs, learned files).
RUN echo 'linux addons/yapb/bin/yapb.so' >> cstrike/addons/metamod/plugins.ini \
 && mkdir -p cstrike/addons/yapb/data/logs cstrike/addons/yapb/data/pwf cstrike/addons/yapb/data/train \
 && chown -R xashds cstrike/addons/yapb

USER xashds
