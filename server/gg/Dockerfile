FROM yohimik/cs-web-server-metpamx:latest
COPY addons cstrike/addons
USER root
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/ \
 && grep -qx 'gungame.amxx' ../configs/plugins.ini || echo 'gungame.amxx' >> ../configs/plugins.ini

# YaPB registers with METAMOD's plugins.ini (not AMXX's - third registration
# file, see docs/troubleshooting.md). Bots need write access to data/ at
# runtime (logs, learned files).
RUN echo 'linux addons/yapb/bin/yapb.so' >> cstrike/addons/metamod/plugins.ini \
 && mkdir -p cstrike/addons/yapb/data/logs cstrike/addons/yapb/data/pwf cstrike/addons/yapb/data/train \
 && chown -R xashds cstrike/addons/yapb
USER xashds
