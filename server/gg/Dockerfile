FROM yohimik/cs-web-server-metpamx:latest
COPY addons cstrike/addons
USER root
RUN cd cstrike/addons/amxmodx/scripting \
 && chmod +x compile.sh amxxpc \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/ \
 && grep -qx 'gungame.amxx' ../configs/plugins.ini || echo 'gungame.amxx' >> ../configs/plugins.ini
USER xashds
