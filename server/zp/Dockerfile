FROM yohimik/cs-web-server-metpamx:0.1.3

COPY addons cstrike/addons

USER root
# stock amxx.cfg ships AMX Mod X adverts (scrolling HUD line + centre-screen
# "This server is using AMX Mod X" every 3 min) - strip them
RUN sed -i '/^amx_scrollmsg /d; /^amx_imessage "This server is using/d' cstrike/addons/amxmodx/configs/amxx.cfg
RUN chmod +x cstrike/addons/amxmodx/scripting/compile.sh && chmod +x cstrike/addons/amxmodx/scripting/amxxpc && cd cstrike/addons/amxmodx/scripting \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/

USER xashds
