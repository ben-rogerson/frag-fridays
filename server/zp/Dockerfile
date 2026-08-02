FROM yohimik/cs-web-server-metpamx:latest

COPY addons cstrike/addons

USER root
RUN chmod +x cstrike/addons/amxmodx/scripting/compile.sh && chmod +x cstrike/addons/amxmodx/scripting/amxxpc && cd cstrike/addons/amxmodx/scripting \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/

USER xashds
