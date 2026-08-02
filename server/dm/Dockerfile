FROM yohimik/cs-web-server-metpamx:latest

# frag_dm.sma is compiled at build time by the toolchain the base image ships
# in scripting/ (same pattern as gg). CSDM was abandoned: its binary module
# signature-scans the original CS DLL and fails silently against this stack's
# reimplemented one - see docs/decisions.md.
COPY addons cstrike/addons

USER root
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/frag_dm.amxx ../plugins/ \
 && grep -qx 'frag_dm.amxx' ../configs/plugins.ini || echo 'frag_dm.amxx' >> ../configs/plugins.ini

# YaPB registers with METAMOD's plugins.ini (not AMXX's - third registration
# file, see docs/troubleshooting.md). Bots need write access to data/ at
# runtime (logs, learned files).
RUN echo 'linux addons/yapb/bin/yapb.so' >> cstrike/addons/metamod/plugins.ini \
 && mkdir -p cstrike/addons/yapb/data/logs cstrike/addons/yapb/data/pwf cstrike/addons/yapb/data/train \
 && chown -R xashds cstrike/addons/yapb

USER xashds
