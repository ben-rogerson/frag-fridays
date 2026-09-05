# Frag Fridays

Browser-hosted CS 1.6 server. `server/` mirrors `/opt/cs16` on the box,
`apps/web/` is the loading screen and the WASM client that boots from it.

Start with `server/README.md` (what lives where, and the one real hazard),
`docs/decisions.md` (why anything is the way it is) and
`docs/troubleshooting.md`.

## Reference

- **CS 1.6 cvar list** - https://txdv.github.io/cstrike-cvarlist/

  The full engine + game dll cvar list. Use it to look up a cvar, but always
  check the name actually exists in THIS stack before shipping it: the engine
  is xash3d-fwgs and the client is cs16-client, not retail GoldSrc, and both
  drop and add cvars. `strings` over `apps/web/node_modules/xash3d-fwgs/dist/xash.wasm`
  (engine) and `.../cs16-client/dist/cstrike/cl_dlls/client_emscripten_wasm32.wasm`
  (client dll) settles it in one command. This is how `sv_maxcmdrate` was found
  to be a no-op here.
