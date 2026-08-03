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

The loading screen is a CPL/HLTV-era esports matchday page for the weekly FRAG FRIDAYS event, and its connect flow IS the game download. The whole page is themed from the classic CS 1.6 splash wallpaper: a deep navy ground with acid-yellow scanline streaks drifting across it and radar arcs sweeping in the top-right. Every surface is period web furniture - steel-navy boxes with 1px bevelled borders and shouty title bars, hyperlink-blue nav links, data tables, partner ads, a visitor counter reading 001337 - but the page's energy comes from something about to happen: a sunken counter-cell clock counts down to Friday 2:30pm Sydney, the MAIN EVENT card announces the mode, and on the day the strip flips to LIVE NOW with real server numbers. The visitor's mode is Operate: read the countdown, type an alias into the server browser, hit CONNECT inside a minute.

The voice is dry and factual. There are NO written gags: the humour is the format played completely straight - a broadcast-grade matchday page for a six-person office server, spec-sheet ad copy for fake retro hardware, real kill-log standings delivered like tournament results. Nothing winks, nothing announces the joke, and the workplace (Simply Wall St) never appears. The page refuses the launcher default of blurred keyart + centred logo + glowing button; the single acid-yellow CONNECT button is the largest, brightest thing on a page that otherwise looks like it was hand-built in Dreamweaver.

Density is high and type is small on purpose - Tahoma/Verdana at 11-13px is the period-native grammar of this world, not a lapse. Real data (countdown, live map/players/timers, top frag, season standings) beats decoration everywhere it can appear.

**Key Characteristics:**
- Deep navy wallpaper ground with animated acid scanline streaks and a sweeping radar arc
- Bevelled 1px-border panels with uppercase title bars - raised chrome vs sunken wells
- One acid-yellow action per screen; hyperlink blue for everything navigational
- Tahoma/Verdana body at 11-13px; Black Ops One reserved for the masthead
- Event tension carried by real data: countdown clock, LIVE state, standings
- No written gags - period chrome and flat factual copy carry the humour
- Hard edges everywhere; the only circles are live-status dots

## Colors

The CS 1.6 splash wallpaper reduced to a working palette: layered navies for ground and chrome, one acid yellow for action and light, hyperlink blue for the web-chrome fiction.

### Primary
- **Acid Scanline Yellow** (`--acid`, #dce81e): the wallpaper's streak colour. Owns the single primary action (JOIN SERVER), the mode chip, lit progress segments, the news square bullets, counter digits and the crest. Rare by design.
- **Hot Acid** (`--acid-hot`, #f4ff3d): the top edge of acid gradients, hover/focus outlines, and link hover colour. Never used as a fill on its own.

### Secondary
- **Fansite Hyperlink Blue** (`--link`, #8fb6f0): nav links and map names - anything that reads as "a link on a 2004 website". Also the radar-ring colour at 7% alpha.

### Neutral
- **Midnight Ground** (`--ink-deep`, #080e1e): the page ground, darkest layer; also the text colour on acid fills.
- **Ambient Navy** (`--ink`, #0d1730): the upper band of the overlay gradient.
- **Panel Steel-Navy** (`--panel`, #121f3d): panel body fill.
- **Raised Chrome Navy** (`--panel-hi`, #1a2b52): navbar and title-bar gradient tops - the "raised" chrome tier.
- **Bevel Highlight** (`--bevel-light`, #33497f): top/left border edge of raised chrome; at 0.28-0.4 alpha it becomes every hairline divider on the page.
- **Bevel Shadow** (`--bevel-dark`, #05080f): bottom/right border edge of raised chrome; top/left edge of sunken wells.
- **Phosphor White** (`--text`, #d7e0f2): primary text, a cool CRT off-white.
- **Muted Slate Blue** (`--text-mute`, #8b9ac0): secondary copy, table headers, status lines.
- **Faint Slate** (`--text-faint`, #7e8db8): tertiary furniture - captions, footers, dead links, placeholders.

### Tertiary
- **Live Signal Green** (`--live`, #4be381): "server online", livedots and their glow. Means one thing: connected and alive.
- **Kill-Feed Red** (`--alert`, #ff6b57): error and dropped-connection status text only.

### Named Rules
**The One Acid Action Rule.** Acid yellow is the action colour and there is exactly one acid action per screen. JOIN SERVER (or its retry/reconnect stand-in) owns it; everything else that borrows acid is small - a chip, a bullet, a digit, a lit segment. Never introduce a second acid button.

## Typography

**Display Font:** Black Ops One (with Arial Narrow fallback), self-hosted via @fontsource
**Body Font:** Tahoma (with Verdana, Segoe UI fallbacks)

**Character:** A stencilled military display face for the masthead only, over the small, dense, aliased-feeling system type of a 2004 fansite. The body face never gets big; the display face never appears twice.

### Hierarchy
- **Display** (400, clamp(1.7rem, 4.5vw, 2.6rem), line-height 1, letter-spacing 0.02em): the FRAGFRIDAYS masthead. Nowhere else.
- **Title** (700, 0.72rem, uppercase, letter-spacing 0.14em): panel title bars ("MAIN EVENT", "SERVER BROWSER", "SEASON STANDINGS").
- **Body** (400, 0.74-0.85rem, i.e. roughly 11-13px): all copy, headlines, table cells, status lines. Live numbers always take `font-variant-numeric: tabular-nums`.
- **Label** (700, 0.58-0.62rem, uppercase, letter-spacing 0.1-0.18em): wide-tracked micro-labels - table headers, ad captions, alias label, spec keys, "server online".

### Named Rules
**The Period Type Rule.** Tahoma/Verdana at 11-13px is the world's native grammar, deliberate and fixed. Do not scale body copy up for "readability polish", swap in a modern webfont, or loosen the micro-label tracking - hierarchy comes from weight, case and tracking, never size inflation.

## Layout

A centred 1000px page (`max-width: 1000px`, padding 1.4rem 1.25rem 2rem) floating over two fixed atmosphere layers: a 720px radar-ring cluster bleeding off the top-right with a 24s conic sweep, and two bands of horizontal acid streaks drifting on a 14s alternate loop. Both are pointer-transparent and killed under `prefers-reduced-motion`.

Vertical order: masthead (crest + logo + "server online"), lowercase navbar, session strip (countdown clock or LIVE state), front-page grid, leaderboard ad, footer. The grid is two columns (`1fr 300px`, 0.9rem gaps) with named areas:

```
'card      aside'
'servers   aside'
'standings standings'
```

The MAIN EVENT card stacks above the SERVER BROWSER (which owns the alias toolbar, live server row, and the download-progress → CONNECT action zone) in the main column; the 300px aside holds the media-player panel, server-hardware boxout and box ad. SEASON STANDINGS spans full width below both columns; the leaderboard partner ad sits between the grid and the footer.

One breakpoint at 760px: the grid collapses to a single column reordered card → servers → aside → standings, the session strip stacks and its clock digits shrink, the masthead online badge and navbar schedule note disappear, and the server table drops its round/map-time columns (columns 4+) so the essentials fit a phone.

Spacing rhythm is tight and boxy: 0.9rem between grid modules, 0.42-0.45rem bar padding, 0.45-0.55rem × 0.8rem table cells, 1rem panel body padding.

## Elevation & Depth

A hybrid: depth is carried first by the bevel border grammar, second by soft black drop shadows that lift chrome off the wallpaper, and third by glow - which is strictly reserved. There are no modern layered-shadow stacks; everything reads like Win2000-era widget chrome.

### Shadow Vocabulary
- **Panel lift** (`box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45)`): panels sitting on the wallpaper.
- **Chrome lift** (`box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4)`): navbar and ad bodies.
- **Bar sheen** (`inset 0 1px 0 rgba(255, 255, 255, 0.07)`): the 1px top highlight inside title bars.
- **Well inset** (`inset 0 2px 4px rgba(0, 0, 0, 0.55)`): sunken wells - the alias input and the progress bar trough.
- **Acid glow** (`0 0 22px rgba(220, 232, 30, 0.28)`, hover `0 0 30px rgba(244, 255, 61, 0.45)`): JOIN SERVER only.
- **Live glow** (`0 1px 4px rgba(0, 0, 0, 0.6), 0 0 6px var(--live)`): livedots; lit progress segments take `0 0 6px rgba(220, 232, 30, 0.5)`.

### Named Rules
**The Bevel Grammar Rule.** Light comes from the top-left. Raised chrome (panels, navbar, buttons, ads) takes `border: 1px solid var(--bevel-light)` with bottom/right overridden to `var(--bevel-dark)`. Sunken wells (inputs, progress troughs, counter digits) invert it: dark top/left, light bottom/right, plus the well inset shadow. Every box on the page declares raised or sunken; there is no flat-bordered third state.

**The Powered Glow Rule.** Glow means powered. Only live or energised things emit light: the livedot, the JOIN SERVER button, lit progress segments. Text, panels and static chrome never glow.

## Shapes

Hard edges everywhere. `border-radius` appears exactly once in the system - the 7px livedot circles (`border-radius: 50%`) - so a circle always means a live signal. Everything else is a sharp-cornered rectangle with a 1px bevel border. News bullets are literal 5px drawn squares in acid. Gradients are always vertical (180deg) two-or-three-stop chrome shading, never decorative colour blends. No pills, no rounded cards, no soft anything.

## Components

### Panels
The page's atom: a fansite content box.
- **Corner Style:** square (0)
- **Background:** Panel Steel-Navy (#121f3d), raised bevel borders
- **Title bar:** vertical gradient #24396b → #182a52, uppercase 0.72rem/700 tracked 0.14em, bar sheen inset, bottom border bevel-dark; optional right-aligned lowercase bar note in Muted Slate (0.62rem)
- **Shadow Strategy:** panel lift
- **Internal Padding:** 1rem 0.9rem 0.9rem, or flush (0) for tables and video

### Buttons
- **Shape:** square, bevel-bordered
- **Primary (CONNECT / `.join`):** acid gradient (#f4ff3d → #dce81e 55% → #b8c313), Midnight Ground text at 1.05rem/700 uppercase tracked 0.14em, padding 0.8rem 2.4rem, acid bevel (#f8ffa0 light edge, #7a820c dark edge), resting acid glow. Copy is decorated download-link style: "» connect «". Lives in the server browser's action zone; doubles as retry/reconnect in error states.
- **Hover / Focus:** `filter: brightness(1.12)` + hotter glow; focus-visible adds a 2px Hot Acid outline offset 2px; active nudges down 1px.
- **Secondary (sound toggle / `.sound`, fullscreen / `.fs`):** small bevel chrome buttons - navy gradient (#2c4278 → #1d2f5c) or translucent navy, Phosphor White text/icon at 0.62rem uppercase, inline 2px-stroke SVG icons, hover brightens via filter, same Hot Acid focus outline.

### Main Event Card (signature)
The fight card for the live mode. Hero row: a 56px sunken emblem tile (inverted bevel + well inset on #060b18) holding the mode's 2.5px-stroke linework emblem in acid, beside the mode name at 1.2rem/700 uppercase tracked 0.14em over its tagline in Muted Slate. Rules render as a RULES spec sheet - an auto-fit two-column list with acid "»" markers. Below, THE ROTATION: a flush sub-bar (micro-label on a faint wash) over one row per roster mode - small emblem (Faint Slate; acid when live), bold name, blurb in Faint Slate. The live row takes a livedot, an acid wash at 5% alpha, and its blurb reads "on the server now" in Live Signal Green. Mode emblems are one stroke family (staircase, crosshair, shield, peaks-with-flag), coloured via currentColor, never filled illustrations.

### Inputs / Fields
- **Style (alias input):** sunken well - #0a1226 fill, inverted bevel, well inset shadow, Phosphor White text at 0.85rem, Faint Slate placeholder, paired with a wide-tracked uppercase micro-label ("YOUR ALIAS:")
- **Focus:** border turns acid (`border-color: var(--acid)`), no outline - the bevel itself lights up
- **Width:** min(240px, 60vw)

### Progress Bar
GoldSrc-style chunky segmented download bar sunk into a bevelled well: 24 flex segments (13px tall, 3px gaps) in a sunken trough. Off segments are acid at 8% alpha; lit segments take the acid gradient plus segment glow. Indeterminate state pulses all segments with staggered delays so it reads as activity, not completion. Status line below in Muted Slate with tabular numerals; errors switch it to Kill-Feed Red.

### Session Strip + Countdown Clock (signature)
A raised chrome band between navbar and grid holding the event state - a vertical navy gradient (#1a2b52 → #121f3d → #0f1a38) with bar sheen, taller than its neighbours so it reads as the peak of the scroll. Countdown: a wide-tracked (0.22em) uppercase label ("NEXT SESSION" / "MATCHDAY") led by a 5px acid news-square, with a lowercase when-line, against a scoreboard clock - paired sunken counter cells (acid digits at 2rem/700 tabular on #060b18, inverted bevel, well inset; 1.4rem wrapping on mobile) grouped under 0.58rem tracked unit labels (days/hrs/min/sec); the days group drops off on matchday. Live: the label becomes LIVE NOW in Live Signal Green with a livedot over the real server meta (map in Hyperlink Blue, humans, bots) in tabular numerals. Ticks every second. Cell groups are joined by scoreboard colons in acid at half strength, blinking on the seconds beat; every cell faintly holds a phosphor ghost "8" (acid at 8%) under the lit glyph, like an LCD's unlit segments. The clock never leaves on matchday: when the strip flips LIVE the same counter cells switch referent and count down the live map's remaining time (real `mapTimeLeft`, resynced each poll, ticked locally between polls), tagged by a stacked "MAP TIME" micro-label; mods with no timelimit drop the cells and keep the meta line.

**The Fuse Rule (escalation tiers).** The countdown is a fuse: a `data-tier` on the overlay (idle / matchday / finalhour / final60 / live, derived from the session clock) drives the whole page's energy. Idle is the calm baseline (24s radar sweep, streaks at 0.75 opacity). Matchday brightens the streaks and quickens the radar (17s). The final hour charges the strip's bevel chrome in acid and runs the radar at 10s. The final minute pulls the streaks back to 0.45 while the clock runs hot (Hot Acid glyphs, cell glow) - the page holds its breath. On air (live) the strip's chrome reads in Live Signal Green, the radar settles at 13s and the streaks return bright. Hitting zero on-screen fires one-shot stings gated so a mid-session page load never replays them: a green radar double-sweep burst, a steps() flicker on LIVE NOW, an acid band sweeping the strip, and the live meta counting up from the real feed. All tier stings honour `prefers-reduced-motion`; tier changes ease over ~1.6s so escalation breathes rather than snaps. A `?t-minus=<seconds>` query override exists for QA of every tier.

### Tables (server browser / standings)
Data tables: uppercase micro-label headers on a faint white wash, bevel-dark underline; cells 0.8rem with tabular numerals; row hover washes Hyperlink Blue at 5% alpha; map names in Hyperlink Blue; livedot before the server name; row dividers in Bevel Highlight at 35% alpha. The server browser owns the connect flow: an alias toolbar above the table (sunken input on a washed row), the live server row (double-click connects), then the action zone - download progress bar → CONNECT button - with an optional top-frag footer line in Faint Slate. The standings table adds a rank column in Muted Slate; the leader row alone takes an acid wash at 5% alpha with the leader's name in acid. Empty state is a flat factual line ("no results yet - the first table publishes after friday's session.").

### Navigation
Lowercase text links in Hyperlink Blue on a raised chrome bar (panel-hi gradient); hover/focus turns Hot Acid with underline. Right edge carries the schedule note ("fridays 2:30 pm · sydney") in Muted Slate.

### Partner Ads (signature)
Fake retro gamer hardware in authentic ad chrome: a 0.58rem wide-tracked "OFFICIAL PARTNER" caption above a raised bevel body (#18294e → #101d3a gradient), inline SVG product artwork with drop shadow, spec-sheet copy in Muted Slate with the brand name in Phosphor White - the specs ARE the period flavour ("400 dpi optical sensor. no ball to clean."). Never real trademarks, never the workplace. Leaderboard (horizontal, above the footer) and box (stacked, centred, in the aside) variants.

### Footer Counter (signature)
"you are visitor" followed by six sunken single-digit cells: acid digits on #060b18 in inverted-bevel boxes, tabular numerals. Reads 001337.

### Named Rules
**The Straight Face Rule.** The humour is the format played straight - an event page far too professional for its six-person server, delivered through real site furniture with real data. NO written gags or invented one-liners anywhere: copy states facts flatly (specs, schedules, results). Never label the joke, never add a winking emoji, never let anything break the operating path to CONNECT.

## Do's and Don'ts

### Do:
- **Do** give every box a bevel verdict: raised (light top/left, dark bottom/right) or sunken (inverted + `inset 0 2px 4px rgba(0, 0, 0, 0.55)`).
- **Do** keep acid yellow scarce - one acid action per screen, with only micro-accents (bullets, digits, chip, lit segments) borrowing it.
- **Do** set all live numbers (players, timers, frags, MB counts) in `font-variant-numeric: tabular-nums`.
- **Do** write site furniture in lowercase (nav, bar notes, status lines) and reserve UPPERCASE for wide-tracked titles and micro-labels.
- **Do** use a plain hyphen "-" in all copy; the em dash is banned everywhere.
- **Do** ship real data into the chrome - countdown, live map, player counts, timers, top frag and kill-log standings beat invented content wherever they can appear.
- **Do** honour `prefers-reduced-motion` for every ambient animation (radar sweep, streak drift, livedot pulse).

### Don't:
- **Don't** use `border-radius` on anything except livedot circles - no rounded cards, pills or soft corners.
- **Don't** add a second glowing element; glow belongs to live/powered things only (livedot, JOIN SERVER, lit segments).
- **Don't** enlarge body type past ~13px or introduce any font beyond the Tahoma/Verdana stack and the masthead-only Black Ops One.
- **Don't** style the page like a modern launcher - no blurred keyart, no centred hero logo, no glassmorphism, no layered soft shadows.
- **Don't** write jokes: no invented one-liners, no workplace references (Simply Wall St never appears), no winking copy. Flat facts only; the format carries the humour.
- **Don't** use em dashes in any copy - "-" only.
