FROM yohimik/cs-web-server-metpamx:0.1.3

COPY addons cstrike/addons

USER root
# amxx.cfg ships adverts that print over the game: a scrolling HUD line, and
# centre-screen imessage lines every amx_freq_imessage seconds - AMXX's own
# "This server is using AMX Mod X" plus a "Welcome to %hostname%" the base
# image carries. Both imessage lines are a banner across the middle of the
# screen mid-round, so drop every amx_imessage, not just the AMXX one.
# imessage.amxx stays loaded; with nothing registered it prints nothing.
RUN sed -i '/^amx_scrollmsg /d; /^amx_imessage /d' cstrike/addons/amxmodx/configs/amxx.cfg
RUN chmod +x cstrike/addons/amxmodx/scripting/compile.sh && chmod +x cstrike/addons/amxmodx/scripting/amxxpc && cd cstrike/addons/amxmodx/scripting \
 && ./compile.sh \
 && cp compiled/*.amxx ../plugins/

# the engine creates cstrike/custom.hpk - the spray/decal store - the first
# time a client uploads its decal, and DELETES the file again when it drops
# to a single entry, so it must create and unlink entries in cstrike/ itself;
# a pre-created writable file is not enough. Root-owned, every spray logged
# "FS_SysOpen: can't open file cstrike/custom.hpk: Permission denied" - three
# lines per map spawn with three humans on (seen 2026-08-28). Only the
# directory entry changes hands; the files inside stay root-owned.
RUN chown xashds cstrike

USER xashds
