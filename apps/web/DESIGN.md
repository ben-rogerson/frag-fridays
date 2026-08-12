---
name: Frag Fridays
description: Counter-Strike 1.6 in your browser - a 2004 esports matchday page that is secretly the launcher
colors:
  ink-deep: "#080e1e"
  ink: "#0d1730"
  panel: "#121f3d"
  panel-hi: "#1a2b52"
  bevel-light: "#33497f"
  bevel-dark: "#05080f"
  acid: "#dce81e"
  acid-hot: "#f4ff3d"
  link: "#8fb6f0"
  text: "#d7e0f2"
  text-mute: "#8b9ac0"
  text-faint: "#7e8db8"
  live: "#4be381"
  alert: "#ff6b57"
  mode-classic: "#dce81e"
  mode-gungame: "#ff9d1e"
  mode-dm: "#ff4d5e"
  mode-kz: "#3fe0e8"
typography:
  display:
    fontFamily: "'Black Ops One', 'Arial Narrow', sans-serif"
    fontSize: "clamp(1.7rem, 4.5vw, 2.6rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.02em"
  title:
    fontFamily: "Tahoma, Verdana, 'Segoe UI', sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.14em"
  body:
    fontFamily: "Tahoma, Verdana, 'Segoe UI', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
  label:
    fontFamily: "Tahoma, Verdana, 'Segoe UI', sans-serif"
    fontSize: "0.62rem"
    fontWeight: 700
    letterSpacing: "0.12em"
rounded:
  none: "0"
  dot: "50%"
spacing:
  xs: "0.45rem"
  sm: "0.6rem"
  md: "0.9rem"
  lg: "1.4rem"
components:
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.none}"
  panel-bar:
    backgroundColor: "#24396b"
    textColor: "{colors.text}"
    typography: "{typography.title}"
    padding: "0.42rem 0.8rem"
  button-join:
    backgroundColor: "{colors.acid}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.none}"
    padding: "0.8rem 2.4rem"
  button-sound:
    backgroundColor: "#2c4278"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0.25rem 0.5rem"
  input-alias:
    backgroundColor: "#0a1226"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0.5rem 0.7rem"
  emblem-tile:
    backgroundColor: "#060b18"
    textColor: "{colors.acid}"
    rounded: "{rounded.none}"
---

# Design System: Frag Fridays

## Overview

**Creative North Star: "The Matchday"**

The loading screen is a CPL/HLTV-era esports matchday page for the weekly FRAG FRIDAYS event, and its connect flow IS the game download. The whole page is themed from the classic CS 1.6 splash wallpaper: a deep navy ground with acid-yellow scanline streaks drifting across it and radar arcs sweeping in the top-right. Every surface is period web furniture - steel-navy boxes with 1px bevelled borders and shouty title bars, hyperlink-blue map names, data tables, a visitor counter reading 001337 - but the page's energy comes from something about to happen: a sunken counter-cell clock counts down to Friday 2pm Sydney, the CURRENT MODE card announces the mode, and on the day the strip flips to LIVE NOW with real server numbers. The visitor's mode is Operate: read the countdown, type an alias into the server browser, hit CONNECT inside a minute.

The voice is dry and factual. There are NO written gags: the humour is the format played completely straight - a broadcast-grade matchday page for a six-person office server, real server data delivered like tournament coverage. Nothing winks, nothing announces the joke, and the workplace (Simply Wall St) never appears. The page refuses the launcher default of blurred keyart + centred logo + glowing button; the single acid-yellow CONNECT button is the largest, brightest thing on a page that otherwise looks like it was hand-built in Dreamweaver.

Density is high and type is small on purpose - Tahoma/Verdana at 11-13px is the period-native grammar of this world, not a lapse. Real data (countdown, live map/players/timers, top frag) beats decoration everywhere it can appear.

**Key Characteristics:**
- Deep navy wallpaper ground with animated scanline streaks and a sweeping radar arc in the live mode's signal colour
- Every game mode broadcasts in its own signal colour: classic acid yellow, GunGame ember orange, Deathmatch kill-feed crimson, KZ ice cyan - the whole accent role remaps per week
- Bevelled 1px-border panels with uppercase title bars - raised chrome vs sunken wells
- One acid-yellow action per screen; hyperlink blue for everything navigational
- Tahoma/Verdana body at 11-13px; Black Ops One reserved for the masthead
- Event tension carried by real data: countdown clock, LIVE state, server feed
- Season and practice standings parsed from the box's kill logs - real results only, humans only, bots never rank
- No written gags - period chrome and flat factual copy carry the humour
- Hard edges everywhere; the only circles are live-status dots

## Colors

The CS 1.6 splash wallpaper reduced to a working palette: layered navies for ground and chrome, one acid yellow for action and light, hyperlink blue for the web-chrome fiction.

### Primary
- **The Accent Role** (`--accent` / `--accent-hot` / `--accent-deep` / `--accent-edge-*`, remapped by `data-mode` on the overlay): the page's single signal colour. Owns the primary action (CONNECT), the scanline streaks, radar sweep, clock digits, crest, mode emblem, rules markers, bots chip, lit progress segments, news squares, counter digits, and focus outlines. Every usage runs through the role tokens (`rgb(var(--accent-rgb) / a)` for alphas), never a raw hex.
- **Mode Signal Colours**: each game mode broadcasts in its own hue, applied by `data-mode` (from the live `/info.json` mode; `?mode=<key>` QA override):
  - classic - **Acid Scanline Yellow** (`--mode-classic`, #dce81e): the wallpaper's streak colour, the baseline until the live mode is known
  - gungame - **Ember Orange** (`--mode-gungame`, #ff9d1e): weapon heat, climbing the ladder
  - dm - **Kill-Feed Crimson** (`--mode-dm`, #ff4d5e)
  - kz - **Ice Cyan** (`--mode-kz`, #3fe0e8): cliff air
- **Hot Accent** (`--acid-hot` at baseline, #f4ff3d): the top edge of accent gradients, hover/focus outlines. Never used as a fill on its own.

### Secondary
- **Fansite Hyperlink Blue** (`--link`, #8fb6f0): map names - anything that reads as "a link on a 2004 website". Also the radar-ring colour at 7% alpha.

### Neutral
- **Midnight Ground** (`--ink-deep`, #080e1e): the page ground, darkest layer; also the text colour on acid fills.
- **Ambient Navy** (`--ink`, #0d1730): the upper band of the overlay gradient.
- **Panel Steel-Navy** (`--panel`, #121f3d): panel body fill.
- **Raised Chrome Navy** (`--panel-hi`, #1a2b52): title-bar gradient tops - the "raised" chrome tier.
- **Bevel Highlight** (`--bevel-light`, #33497f): top/left border edge of raised chrome; at 0.28-0.4 alpha it becomes every hairline divider on the page.
- **Bevel Shadow** (`--bevel-dark`, #05080f): bottom/right border edge of raised chrome; top/left edge of sunken wells.
- **Phosphor White** (`--text`, #d7e0f2): primary text, a cool CRT off-white.
- **Muted Slate Blue** (`--text-mute`, #8b9ac0): secondary copy, table headers, status lines.
- **Faint Slate** (`--text-faint`, #7e8db8): tertiary furniture - captions, footers, dead links, placeholders.

### Tertiary
- **Live Signal Green** (`--live`, #4be381): "server online", livedots and their glow. Means one thing: connected and alive.
- **Kill-Feed Red** (`--alert`, #ff6b57): error and dropped-connection status text only.

### Named Rules
**The One Accent Action Rule.** The mode's signal colour is the action colour and there is exactly one accent action per screen. JOIN SERVER (or its retry/reconnect stand-in) owns it; everything else that borrows the accent is small - a chip, a bullet, a digit, a lit segment. Never introduce a second accent button.

**The Mode Signal Rule.** One mode, one hue, the whole page. The live mode's colour remaps the entire accent role - atmosphere, clock, chrome, action - via `data-mode`; nothing keeps last week's colour. Live Signal Green and Kill-Feed Red (errors) never remap: live means live and broken means broken in every mode, including Deathmatch (whose crimson accent is deliberately hotter and fuller than the salmon `--alert`). In the MORE GAME MODES roster, each row wears its own mode's hue when hovered or unfolded - the only place two signal colours may coexist. The fullscreen toggle sits outside the overlay and stays acid in all modes. New modes must pick a hue distinct from all four plus live green and alert red, and pass 4.5:1 for `--ink-deep` text on the accent fill and the accent on `#060b18` wells.

## Typography

**Display Font:** Black Ops One (with Arial Narrow fallback), self-hosted via @fontsource
**Body Font:** Tahoma (with Verdana, Segoe UI fallbacks)

**Character:** A stencilled military display face for the masthead only, over the small, dense, aliased-feeling system type of a 2004 fansite. The body face never gets big; the display face never appears twice.

### Hierarchy
- **Display** (400, clamp(1.7rem, 4.5vw, 2.6rem), line-height 1, letter-spacing 0.02em): the FRAGFRIDAYS masthead. Nowhere else.
- **Title** (700, 0.72rem, uppercase, letter-spacing 0.14em): panel title bars ("CURRENT MODE", "SERVER BROWSER", "SEASON STANDINGS").
- **Body** (400, 0.74-0.85rem, i.e. roughly 11-13px): all copy, headlines, table cells, status lines. Live numbers always take `font-variant-numeric: tabular-nums`.
- **Label** (700, 0.58-0.62rem, uppercase, letter-spacing 0.1-0.18em): wide-tracked micro-labels - table headers, alias label, spec keys, "server online".

### Named Rules
**The Period Type Rule.** Tahoma/Verdana at 11-13px is the world's native grammar, deliberate and fixed. Do not scale body copy up for "readability polish", swap in a modern webfont, or loosen the micro-label tracking - hierarchy comes from weight, case and tracking, never size inflation.

## Layout

A centred 1000px page (`max-width: 1000px`, padding 1.4rem 1.25rem 2rem) floating over three fixed atmosphere layers: a CPL-style tactical briefing grid (fine 1px hyperlink-blue lines at 44px pitch with a heavier major every 176px, masked to fade behind the centre column, static, opacity riding the fuse via `--grid-o`) carrying CS-crosshair surveyor marks with ghosted grid coordinates in the accent (desktop only) and hyperlink-blue viewfinder corner brackets; a 720px radar-ring cluster bleeding off the top-right with a 24s conic sweep and scope lines through its centre; and two bands of horizontal acid streaks drifting on a 14s alternate loop. All are pointer-transparent and the animated pair is killed under `prefers-reduced-motion`.

Vertical order: masthead (crest + logo + "server online"), session strip (countdown clock or LIVE state), front-page grid, footer. The grid is two columns (`1fr 300px`, 0.9rem gaps) with named areas:

```
'servers   aside'
'card      aside'
'standings aside'
```

The SERVER BROWSER leads the main column so CONNECT sits above the fold; the CURRENT MODE card follows, and the SEASON STANDINGS league table closes the column. The 300px aside holds the media-player panel and the server-hardware boxout.

One breakpoint at 760px: the grid collapses to a single column reordered servers → card → standings → aside, the session strip stacks and its clock digits shrink, the masthead online badge disappears, the server table drops its round/map-time columns (columns 4+), and the standings drop their sessions/time/mvp columns so the essentials fit a phone.

Spacing rhythm is tight and boxy: 0.9rem between grid modules, 0.42-0.45rem bar padding, 0.45-0.55rem × 0.8rem table cells, 1rem panel body padding.

## Elevation & Depth

A hybrid: depth is carried first by the bevel border grammar, second by soft black drop shadows that lift chrome off the wallpaper, and third by glow - which is strictly reserved. There are no modern layered-shadow stacks; everything reads like Win2000-era widget chrome.

### Shadow Vocabulary
- **Panel lift** (`box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45)`): panels sitting on the wallpaper.
- **Chrome lift** (`box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4)`): raised chrome that floats off the wallpaper (the session strip).
- **Bar sheen** (`inset 0 1px 0 rgba(255, 255, 255, 0.07)`): the 1px top highlight inside title bars.
- **Well inset** (`inset 0 2px 4px rgba(0, 0, 0, 0.55)`): sunken wells - the alias input and the progress bar trough.
- **Accent glow** (`0 0 22px rgb(var(--accent-rgb) / 0.28)`, hover `0 0 30px rgb(var(--accent-hot-rgb) / 0.45)`): JOIN SERVER only, in the mode's signal colour.
- **Live glow** (`0 1px 4px rgba(0, 0, 0, 0.6), 0 0 6px var(--live)`): livedots; lit progress segments take `0 0 6px rgb(var(--accent-rgb) / 0.5)`.

### Named Rules
**The Bevel Grammar Rule.** Light comes from the top-left. Raised chrome (panels, buttons) takes `border: 1px solid var(--bevel-light)` with bottom/right overridden to `var(--bevel-dark)`. Sunken wells (inputs, progress troughs, counter digits) invert it: dark top/left, light bottom/right, plus the well inset shadow. Every box on the page declares raised or sunken; there is no flat-bordered third state.

**The Powered Glow Rule.** Glow means powered. Only live or energised things emit light: the livedot, the JOIN SERVER button, lit progress segments. Text, panels and static chrome never glow.

## Shapes

Hard edges everywhere. `border-radius` appears exactly once in the system - the 7px livedot circles (`border-radius: 50%`) - so a circle always means a live signal. Everything else is a sharp-cornered rectangle with a 1px bevel border. News bullets are literal 5px drawn squares in acid. Gradients are always vertical (180deg) two-or-three-stop chrome shading, never decorative colour blends. No pills, no rounded cards, no soft anything.

## Components

### Panels
The page's atom: a fansite content box.
- **Corner Style:** square (0)
- **Background:** Panel Steel-Navy (#121f3d), raised bevel borders
- **Title bar:** vertical gradient #24396b → #182a52, uppercase 0.72rem/700 tracked 0.14em, bar sheen inset, bottom border bevel-dark; optional right-aligned lowercase bar note in Muted Slate (0.62rem). A CRT scanline texture overlays the gradient beneath the text (1px near-black lines on a 3px pitch plus a faint top-half sheen, the whole layer at 0.55 opacity) - texture, not glow: it deepens the chrome without lighting it
- **Shadow Strategy:** panel lift
- **Internal Padding:** 1rem 0.9rem 0.9rem, or flush (0) for tables and video

### Buttons
- **Shape:** square, bevel-bordered
- **Primary (CONNECT / `.join`):** acid gradient (#f4ff3d → #dce81e 55% → #b8c313), Midnight Ground text at 1.05rem/700 uppercase tracked 0.14em, padding 0.8rem 2.4rem, acid bevel (#f8ffa0 light edge, #7a820c dark edge), resting acid glow. Copy is decorated download-link style: "» connect «". Lives in the server browser's action zone; doubles as retry/reconnect in error states. When the download lands and the button first appears it ignites - a 0.7s one-shot fluorescent-tube strike (`steps(1)`: dark, two flickers, then the resting glow) marking the moment CONNECT becomes powered. Ignition fires only on download completion, never on retry/reconnect (recovery isn't a show), is killed under `prefers-reduced-motion`, and the button is clickable from its first frame.
- **Hover / Focus:** `filter: brightness(1.12)` + hotter glow; focus-visible adds a 2px Hot Acid outline offset 2px; active nudges down 1px.
- **Secondary (sound toggle / `.sound`, fullscreen / `.fs`):** small bevel chrome buttons - navy gradient (#2c4278 → #1d2f5c) or translucent navy, Phosphor White text/icon at 0.62rem uppercase, inline 2px-stroke SVG icons, hover brightens via filter, same Hot Acid focus outline.

### Current Mode Card (signature)
The fight card for the live mode. Hero row: a 56px sunken emblem tile (inverted bevel + well inset on #060b18) holding the mode's 2.5px-stroke linework emblem in acid, beside the mode name at 1.2rem/700 uppercase tracked 0.14em over its tagline in Muted Slate. Rules render as a RULES spec sheet - an auto-fit two-column list with acid "»" markers. Below, MORE GAME MODES: a flush sub-bar (micro-label on a faint wash) over one row per non-live roster mode - the live mode already headlines the card, so its row sits out - small emblem in Faint Slate, bold name, blurb in Faint Slate. Mode emblems are one stroke family (staircase, crosshair, shield, peaks-with-flag), coloured via currentColor, never filled illustrations.

### Inputs / Fields
- **Style (alias input):** sunken well - #0a1226 fill, inverted bevel, well inset shadow, Phosphor White text at 0.85rem, Faint Slate placeholder, paired with a wide-tracked uppercase micro-label ("YOUR ALIAS:")
- **Focus:** border turns acid (`border-color: var(--acid)`), no outline - the bevel itself lights up
- **Width:** min(240px, 60vw)

### Progress Bar
GoldSrc-style chunky segmented download bar sunk into a bevelled well: 24 flex segments (13px tall, 3px gaps) in a sunken trough. Off segments are acid at 8% alpha; lit segments take the acid gradient plus segment glow. Indeterminate state pulses all segments with staggered delays so it reads as activity, not completion. Status line below in Muted Slate with tabular numerals; errors switch it to Kill-Feed Red. While downloading, the status line is a period download-dialog readout: real transfer rate (sliding ~3s window, one decimal MB/s) and a flat time estimate ("est. 45 sec left", 5-second steps past 10s so it reads steady; minutes past 90s) - real numbers off the byte stream, never invented.

### Session Strip + Countdown Clock (signature)
A raised chrome band between masthead and grid holding the event state - a vertical navy gradient (#1a2b52 → #121f3d → #0f1a38) with bar sheen, taller than its neighbours so it reads as the peak of the scroll. Countdown: a wide-tracked (0.22em) uppercase label ("NEXT SESSION" / "MATCHDAY") led by a 5px acid news-square, with a lowercase when-line and - once a status poll has answered - a Live Signal Green practice invite ("practice open now - warm up before kickoff") framing pre-kickoff joins as warm-up, against a scoreboard clock - paired sunken counter cells (acid digits at 2rem/700 tabular on #060b18, inverted bevel, well inset; 1.4rem wrapping on mobile) grouped under 0.58rem tracked unit labels (days/hrs/min/sec); the days group drops off on matchday. Live: the label becomes LIVE NOW in Live Signal Green with a livedot over the real server meta (map in Hyperlink Blue, humans, bots) in tabular numerals. Ticks every second. Cell groups are joined by scoreboard colons in acid at half strength, blinking on the seconds beat; every cell faintly holds a phosphor ghost "8" (acid at 8%) under the lit glyph, like an LCD's unlit segments. The clock never leaves on matchday: when the strip flips LIVE the same counter cells switch referent and count down the live map's remaining time (real `mapTimeLeft`, resynced each poll, ticked locally between polls), tagged by a stacked "MAP TIME" micro-label; mods with no timelimit drop the cells and keep the meta line.

**The Fuse Rule (escalation tiers).** The countdown is a fuse: a `data-tier` on the overlay (idle / matchday / finalhour / final60 / live, derived from the session clock) drives the whole page's energy. Idle is the calm baseline (24s radar sweep, streaks at 0.75 opacity). Matchday brightens the streaks and quickens the radar (17s). The final hour charges the strip's bevel chrome in acid and runs the radar at 10s. The final minute pulls the streaks back to 0.45 while the clock runs hot (Hot Acid glyphs, cell glow) - the page holds its breath. On air (live) the strip's chrome reads in Live Signal Green, the radar settles at 13s and the streaks return bright. Hitting zero on-screen fires one-shot stings gated so a mid-session page load never replays them: a green radar double-sweep burst, a steps() flicker on LIVE NOW, an acid band sweeping the strip, and the live meta counting up from the real feed. All tier stings honour `prefers-reduced-motion`; tier changes ease over ~1.6s so escalation breathes rather than snaps. A `?t-minus=<seconds>` query override exists for QA of every tier.

### Tables (server browser)
Data tables: uppercase micro-label headers on a faint white wash, bevel-dark underline; cells 0.8rem with tabular numerals; row hover washes Hyperlink Blue at 5% alpha; map names in Hyperlink Blue; livedot before the server name; row dividers in Bevel Highlight at 35% alpha. The server browser owns the connect flow: an alias toolbar above the table (sunken input on a washed row), the live server row (double-click connects), a human-roster line under the table whenever anyone is on ("in game right now" while live, "warming up now" before kickoff - names bold in Faint Slate prose, bots stay a count in the players column; closed off by a table-row divider so the connect zone keeps its own band), then the action zone - download progress bar → CONNECT button - with an optional top-frag footer line in Faint Slate ("top frag right now" while live, "top frag in warm-up" before kickoff).

### League Tables (standings)
The SEASON STANDINGS panel closes the main column: tournament coverage for a six-person server, played completely straight. The tables share the server browser's grammar (micro-label headers on a faint wash, 0.8rem cells, blue hover wash, Bevel Highlight row dividers) with two additions: numeric columns are right-aligned, and every figure is tabular. Season columns run rank / player / sessions / kills / deaths / k-d / time / mvps; time renders coarse ("47m", "2h 05m"), empty mvp cells read "-". Rank digits sit in Faint Slate. Below the table a footer line in Faint Slate states the session count and last MVP; with no sessions yet the panel holds a single flat line ("no ranked results yet - the table publishes after the first friday session"). During the practice period a flush PRACTICE STANDINGS sub-bar (bar note "warm-up frags - reset at kickoff", dated once a session exists) adds a second, shorter table - rank / player / kills / deaths / k-d / time; it sits out entirely while the strip reads LIVE. The panel renders only once `/assets/standings.json` has answered - the page never invents results - and both tables rank humans only.

**The Earned Crown Rule.** Only the season leader wears the mode's signal colour, and only on the rank digit (plus a bold name) - a micro-accent, never a second accent action. The practice leader takes no accent at all: warm-up frags earn no crown.

### Map Imagery
Real 1.6-era map screenshots (160x120, the classic server-browser thumb size) bundled per map name in `src/assets/maps/`, always framed by the `mapshot` well: a sunken tile (inverted bevel on #060b18) whose well-inset shadow is painted over the image by an overlay pane. One placement: THE MAP POOL - a flush thumbnail-gallery strip in the CURRENT MODE card showing tonight's mode's real mapcycle, names below in Hyperlink Blue at 0.68rem. The map running on the server takes a livedot and its name in Live Signal Green. A map with no shot on hand renders the flat "no map image" tile in Faint Slate - never a stretched or invented image. Screenshots are the only bitmaps in the system; everything else stays inline SVG.

### Footer Counter (signature)
"you are visitor" followed by six sunken single-digit cells: acid digits on #060b18 in inverted-bevel boxes, tabular numerals. Reads 001337.

### Named Rules
**The Straight Face Rule.** The humour is the format played straight - an event page far too professional for its six-person server, delivered through real site furniture with real data. NO written gags or invented one-liners anywhere: copy states facts flatly (specs, schedules, results). Never label the joke, never add a winking emoji, never let anything break the operating path to CONNECT.

## Do's and Don'ts

### Do:
- **Do** give every box a bevel verdict: raised (light top/left, dark bottom/right) or sunken (inverted + `inset 0 2px 4px rgba(0, 0, 0, 0.55)`).
- **Do** keep acid yellow scarce - one acid action per screen, with only micro-accents (bullets, digits, chip, lit segments) borrowing it.
- **Do** set all live numbers (players, timers, frags, MB counts) in `font-variant-numeric: tabular-nums`.
- **Do** write site furniture in lowercase (bar notes, status lines) and reserve UPPERCASE for wide-tracked titles and micro-labels.
- **Do** use a plain hyphen "-" in all copy; the em dash is banned everywhere.
- **Do** ship real data into the chrome - countdown, live map, player counts, timers, top frag and season standings beat invented content wherever they can appear.
- **Do** honour `prefers-reduced-motion` for every ambient animation (radar sweep, streak drift, livedot pulse).

### Don't:
- **Don't** use `border-radius` on anything except livedot circles - no rounded cards, pills or soft corners.
- **Don't** add a second glowing element; glow belongs to live/powered things only (livedot, JOIN SERVER, lit segments).
- **Don't** enlarge body type past ~13px or introduce any font beyond the Tahoma/Verdana stack and the masthead-only Black Ops One.
- **Don't** style the page like a modern launcher - no blurred keyart, no centred hero logo, no glassmorphism, no layered soft shadows.
- **Don't** write jokes: no invented one-liners, no workplace references (Simply Wall St never appears), no winking copy. Flat facts only; the format carries the humour.
- **Don't** use em dashes in any copy - "-" only.
