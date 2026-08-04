# pressbox

Headless-Chromium spectator for the WASM CS 1.6 server. Loads the same URL
players use, presses F3 (bound to `jointeam 6` in `server/config/userconfig.cfg`),
and screenshots the game canvas on an interval. A tiny HTTP viewer on
`:27060` serves the latest frame.

## Why not native HLTV?

The upstream `yohimik/webxash3d-fwgs` server is WebRTC-only - it doesn't
speak the GoldSrc UDP netchannel that HLTV/SourceTV proxies attach through
(verified: A2S UDP queries also get no reply, same protocol). A browser
spectator is the only route that reuses the actual client stack.

## Operate

Runs as a sibling compose project (like `mcp/`). Bring up / tear down
independently of mod swaps:

```sh
pnpm run pressbox up      # build + start
pnpm run pressbox down    # stop + remove
pnpm run pressbox status  # docker ps + /health
pnpm run pressbox logs    # tail container logs
pnpm run pressbox shot    # download latest.png to ./pressbox-shot.png
```

## Viewer

- Index: <http://149.28.172.74:27060/>
- Latest PNG: <http://149.28.172.74:27060/latest.png>
- Health: <http://149.28.172.74:27060/health>

## Slot cost

The pressbox joins as a real client and consumes ONE slot of the running
mod's `maxplayers` (14 -> 13 for humans). Bring it down before session
start if you want that slot back.

## Tuning

Compose env vars (no rebuild needed):

| Var | Default | Notes |
| --- | ------- | ----- |
| `SHOT_INTERVAL_MS` | 5000 | screenshot cadence |
| `JOIN_DELAY_MS` | 60000 | wait after page load before pressing F3 |
| `STALL_RELOAD_AFTER` | 24 | consecutive identical frames before force-reload (splash-stall recovery) |
| `SPEC_KEY` | F3 | must match the bind in userconfig.cfg |
| `VIEWPORT_W` / `VIEWPORT_H` | 1280 / 720 | canvas render size |
