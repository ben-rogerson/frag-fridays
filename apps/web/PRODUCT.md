# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Workmates at Simply Wall St, mixed skill: a few old CS heads, many who haven't
touched an FPS in years, some who never have. They join the weekly Friday work
social session by opening a URL - at their desk or at home, usually on a work
laptop with a trackpad or a hastily found mouse.

## Product Purpose

Browser-playable Counter-Strike 1.6 for the weekly Friday work social. No
installs, no Steam accounts - players click a link and play. Success is
turnout plus zero friction: the maximum number of people click the URL and are
in-game within a minute, and nobody bounces at the loading screen out of
confusion or impatience.

## Positioning

Real CS 1.6 (GoldSrc compiled to WebAssembly via webxash3d-fwgs, networked
over WebRTC) in a browser tab - not a clone, not a demo. A neighbouring
product can't truthfully say "the actual 2003 game, zero install, on your work
laptop".

## Operating Context

- One shared server (Vultr VPS, Sydney) runs one mod at a time - vanilla,
  GunGame, deathmatch, or zombie plague - all on the same player URL.
- Sessions run Fridays from 2pm Sydney, announced and recapped in the work
  Slack; the page is the only join surface.
- The start page must download ~1GB-scale game files before play, so players
  spend real time on it every session - it doubles as the pre-match hype
  surface (live server status, tonight's mode, music).
- Bots keep the server populated; live status shows humans + bots, map, and
  timers.

## Capabilities and Constraints

- The page serves three jobs in sequence: download progress → name entry →
  Play (launches the engine fullscreen into the same tab's canvas).
- Live data available to the page: `/info.json` (tonight's mode, tagline,
  bullets) and `/status.json` (map, players, bots, frags, timers, refreshed
  every 5s).
- YouTube embeds only work via the Cloudflare Worker shim relay
  (`frag-friday-bg` on workers.dev); direct embeds fail from the IP-literal
  http origin. Sound requires a user gesture; the widget-relay mute/unmute
  plumbing in `App.tsx` handles this.
- Served from a plain http IP-literal origin (`http://149.28.172.74:27016`) -
  no HTTPS, so no clipboard API, no service workers, and browser gesture rules
  apply strictly.
- Errors the page must handle: download failure, engine failure, server drop
  (transport vs. kick), dead YouTube embed.
- The overlay must never block the game canvas once playing; the game owns
  fullscreen.

## Brand Commitments

- **Frag Fridays** name (renamed from Frag Friday, Aug 2026) and the Friday
  framing are fixed. Sessions kick off **Friday 2pm Sydney**.
- **Esports matchday framing**: the page is an event page for the weekly
  session (countdown to kickoff, main-event card, live data), not a passive
  fansite. Before kickoff the open server is framed as practice/warm-up, not
  the event itself.
- **No written gags**: the humour is the format played completely straight -
  period chrome, real data stated flatly. No invented one-liners, no
  workplace references (Simply Wall St must not appear on the page).
- **Crest artwork**: the supplied crest SVG above the title must be kept.
- **The frag-movie video with audio must be present** (currently the
  ANNIHILATION 2 YouTube embed with drum & bass audio) - as background
  artwork or otherwise; placement and treatment are a design decision.

## Evidence on Hand

- Live server data feeds (`/info.json`, `/status.json`) - real, not mocked.
- Season standings feed (`/assets/standings.json`) still generated on the box
  by `scripts/standings.sh`, but no longer shown on the page.
- Real server specs (1 vCPU / 2GB / Sydney) shown as a self-deprecating flex.
- Crest SVG artwork in `apps/web/src/App.tsx`.
- Sourced 1.6-era map screenshots (160x120) for every map in the mod
  mapcycles, bundled in `apps/web/src/assets/maps/` (kz_summercliff2 has no
  shot and falls back to a "no map image" tile).
- No testimonials, pricing, or marketing claims exist; do not invent any.

## Product Principles

- **Nobody bounces.** Every state of the page (downloading, ready, error,
  dropped) tells the player exactly what's happening and what to do next; the
  path to Play is never ambiguous or blocked.
- **The wait is the warm-up.** Download time is unavoidable, so the page turns
  it into pre-match hype rather than a spinner.
- **Straight-faced fun.** The charm comes from authentic period chrome and
  real data played straight; written jokes are out - they read as try-hard,
  not Australian.
- **Zero-install is sacred.** Nothing on the page may require an account,
  extension, or second tool; work-laptop constraints (http origin, trackpads)
  are the baseline.
- **Real data over decoration.** Live mode, map, player, and timer feeds beat
  invented content everywhere they can appear.
