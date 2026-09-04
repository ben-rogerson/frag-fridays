#!/usr/bin/env python3
"""Build the in-game loading screen: server/custom/gfx/shell/{conback,loading}.tga.

Usage:
  make-conback.py            # write both TGAs
  make-conback.py --png OUT  # also keep the intermediate PNG, for eyeballing

The engine picks the basename off host.allow_console (conback when the console
is allowed, loading otherwise), so BOTH are written with identical bytes - the
two-different-backgrounds bug this replaced. See docs/decisions.md,
"Loading screen: one artwork under both basenames".

The art is the web page's own atmosphere at full bleed - palette and grid
pitches lifted from apps/web/DESIGN.md - carrying the masthead lockup top
right and the stack the server runs on bottom right. Nothing here is
time-bound: the strap this replaced stated a fixed weekly session time in a
file nobody rebuilds, and that is the mistake worth not repeating, not text
as such.

Pipeline: SVG -> headless Chrome screenshot at exactly 1512x982 -> raw BGR via
ImageMagick -> hand-packed TGA. The TGA header is written here rather than by
ImageMagick because the origin bit is the one thing that must not drift.

The atmosphere is one SVG; the wordmark and the logo rows sit over it as HTML
in the same document, because right-aligning a row of mark-plus-label pairs
means measuring text, and the browser already does that. Chrome screenshots
both layers as one image. Fonts and logos are embedded (base64 @font-face,
inline paths from scripts/brandmarks.py) - the render must not depend on the
network, or the day it hiccups the wordmark quietly falls back to Arial.
"""
import base64
import math
import os
import random
import struct
import subprocess
import sys
import tempfile

from brandmarks import CREST, MARKS

# 1512x982 is a fullscreen 14" MacBook Pro. The engine stretches the texture to
# the canvas with no letterboxing and #canvas is 100vw/100vh, so this is the
# aspect to author for - not 4:3, not 16:9. See the 2026-08-29 decision entry.
W, H = 1512, 982

# The console is open over this image while the map loads and its text runs
# top-to-bottom down the left column, so that column is held dark on purpose.
QUIET_W = 372

# Everything the overlay draws hangs off this one right margin, inside the
# viewfinder corners at 56/1456 so the brackets keep their own air.
MARGIN = 108

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "server", "custom", "gfx", "shell")
BASENAMES = ("conback.tga", "loading.tga")

# The masthead face, committed rather than read out of node_modules: this
# script has to render the same wordmark in a fresh clone with no install.
FONT = os.path.join(REPO, "assets", "black-ops-one-latin-400-normal.woff2")

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# apps/web/DESIGN.md
ACID, ACID_HOT, LINK = "#dce81e", "#f4ff3d", "#8fb6f0"
TEXT, MUTE, FAINT = "#d7e0f2", "#8b9ac0", "#7e8db8"

# What the box actually runs, confirmed against the Dockerfiles, the compose
# files and docs/setup.md - not a wishlist. A `None` mark is something with no
# official SVG going; it gets the page's news square instead of a logo.
#
# Rows are written out rather than left to flex wrapping so each one is a
# group you can read: the game, the box it runs on, the page that launches it.
TECH_ROWS = [
    [
        ("xash3d-fwgs", None),
        ("webassembly", "webassembly"),
        ("webrtc", "webrtc"),
        ("amx mod x", None),
        ("metamod-p", None),
        ("yapb", None),
    ],
    [
        ("go", "go"),
        ("docker", "docker"),
        ("ubuntu", "ubuntu"),
        ("vultr", "vultr"),
        ("cloudflare workers", "cloudflareworkers"),
    ],
    [
        ("react", "react"),
        ("typescript", "typescript"),
        ("vite", "vite"),
    ],
]

# The bloom is the composition's light source; streaks brighten towards it.
BLOOM_X, BLOOM_Y = 716, 452
# Radar cluster centre, off the top-right corner so only arcs land in frame.
RADAR_X, RADAR_Y = 1318, 116

# Fixed so a re-run reproduces the shipped file rather than a new random one.
SEED = 1337


def log(msg):
    print(f"[conback] {msg}", flush=True)


def surveyor_marks():
    """CS crosshair ticks on the major grid intersections, right of the quiet column."""
    rng = random.Random(SEED)
    out = []
    for gx in range(QUIET_W - 20, W, 176):
        for gy in range(0, H, 176):
            if rng.random() < 0.42:
                continue
            o = 0.10 + rng.random() * 0.14
            out.append(
                f'<g transform="translate({gx},{gy})" stroke="{ACID}" '
                f'stroke-opacity="{o:.2f}" stroke-width="1">'
                f'<path d="M-9 0H-3M3 0H9M0 -9V-3M0 3V9"/></g>'
            )
    return "\n".join(out)


def streak_band(y0, y1, count, seed, hot=0):
    """A band of horizontal acid streaks - the splash wallpaper's signature.

    Thin streaks read as light and take the higher opacity; thick ones are
    haze and stay faint. `hot` adds blown-out streaks near the bloom, each
    drawn twice (a blurred halo under a hard core) so they glow without a
    filter over the whole image.
    """
    rng = random.Random(seed)
    out = []
    for _ in range(count):
        y = rng.randint(y0, y1)
        x = rng.randint(140, 720)
        w = min(rng.randint(360, 1160), W - 36 - x)
        t = rng.choice([1, 1, 1, 1, 2, 2, 3, 5])
        near = 1.0 - min(abs(y - BLOOM_Y) / 440.0, 1.0)
        o = rng.uniform(0.15, 0.30) + 0.26 * near if t <= 2 else rng.uniform(0.07, 0.16)
        out.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{t}" '
            f'fill="url(#streak)" opacity="{min(o, 0.66):.2f}"/>'
        )
    for _ in range(hot):
        y = BLOOM_Y + rng.choice([-1, 1]) * rng.randint(8, 150)
        x = rng.randint(280, 540)
        w = min(rng.randint(680, 1120), W - 36 - x)
        t = rng.choice([1, 2])
        out.append(
            f'<g filter="url(#soft)"><rect x="{x}" y="{y - 1}" width="{w}" '
            f'height="{t + 3}" fill="url(#hotstreak)" opacity="0.30"/></g>'
        )
        out.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{t}" '
            f'fill="url(#hotstreak)" opacity="{rng.uniform(0.6, 0.85):.2f}"/>'
        )
    return "\n".join(out)


def light_shafts():
    """Cool blue-white shafts, rotated off-vertical - the splash's depth cue."""
    return "\n".join(
        f'<rect x="{x}" y="-340" width="{w}" height="1700" '
        f'fill="url(#shaft)" opacity="{o}"/>'
        for x, w, o in [
            (500, 26, 0.055), (596, 96, 0.028), (752, 14, 0.072), (838, 160, 0.02),
            (1032, 42, 0.046), (1148, 74, 0.026), (1288, 18, 0.06),
        ]
    )


def sweep_arc(r, a0, a1, opacity, width=2):
    """One arc of the radar sweep, angles in degrees clockwise from east."""
    x0 = RADAR_X + r * math.cos(math.radians(a0))
    y0 = RADAR_Y + r * math.sin(math.radians(a0))
    x1 = RADAR_X + r * math.cos(math.radians(a1))
    y1 = RADAR_Y + r * math.sin(math.radians(a1))
    return (
        f'<path d="M{x0:.1f} {y0:.1f} A{r} {r} 0 0 1 {x1:.1f} {y1:.1f}" fill="none" '
        f'stroke="{ACID}" stroke-opacity="{opacity}" stroke-width="{width}"/>'
    )


def radar_sweep():
    """Each ring lit brightest at the leading edge and decaying behind it.

    A filled sector was tried first and read as a hard yellow triangle, not a
    sweep - the arcs carry the motion and the corner stays quiet.
    """
    return "\n".join([
        sweep_arc(196, 104, 146, 0.34), sweep_arc(196, 146, 170, 0.13),
        sweep_arc(322, 102, 144, 0.30), sweep_arc(322, 144, 168, 0.11),
        sweep_arc(452, 100, 138, 0.19), sweep_arc(452, 138, 160, 0.07),
        sweep_arc(596, 102, 130, 0.10),
    ])


def radar_blips():
    return "".join(
        f'<rect x="{x - 4}" y="{y - 4}" width="8" height="8" '
        f'fill="{ACID}" fill-opacity="{o}"/>'
        for x, y, o in [(1120, 232, 0.55), (1042, 148, 0.35),
                        (1188, 352, 0.28), (1268, 206, 0.22)]
    )


def build_svg():
    return f"""<!doctype html><meta charset="utf-8">
<style>html,body{{margin:0;padding:0;background:#060b18}}svg{{display:block}}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
  <filter id="soft" x="-20%" y="-400%" width="140%" height="900%">
    <feGaussianBlur stdDeviation="3.5"/></filter>

  <linearGradient id="ground" x1="0.1" y1="0" x2="0.7" y2="1">
    <stop offset="0" stop-color="#13244e"/><stop offset="0.42" stop-color="#0b1430"/>
    <stop offset="1" stop-color="#05091a"/></linearGradient>
  <radialGradient id="pool" cx="0.55" cy="0.43" r="0.62">
    <stop offset="0" stop-color="#31569b" stop-opacity="0.72"/>
    <stop offset="0.45" stop-color="#16264f" stop-opacity="0.30"/>
    <stop offset="1" stop-color="#05091a" stop-opacity="0"/></radialGradient>
  <radialGradient id="bloom" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fdffb4" stop-opacity="0.62"/>
    <stop offset="0.07" stop-color="{ACID_HOT}" stop-opacity="0.38"/>
    <stop offset="0.24" stop-color="#c3d426" stop-opacity="0.16"/>
    <stop offset="0.58" stop-color="#8a9a30" stop-opacity="0.055"/>
    <stop offset="1" stop-color="{ACID}" stop-opacity="0"/></radialGradient>
  <radialGradient id="radarglow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="{ACID}" stop-opacity="0.10"/>
    <stop offset="0.55" stop-color="{ACID}" stop-opacity="0.028"/>
    <stop offset="1" stop-color="{ACID}" stop-opacity="0"/></radialGradient>
  <linearGradient id="shaft" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7fa8e8" stop-opacity="0"/>
    <stop offset="0.35" stop-color="#a8c8ff" stop-opacity="1"/>
    <stop offset="0.62" stop-color="#7fa8e8" stop-opacity="0.7"/>
    <stop offset="1" stop-color="#7fa8e8" stop-opacity="0"/></linearGradient>

  <!-- the page's CPL briefing grid: 44px fine, 176px major -->
  <pattern id="fine" width="44" height="44" patternUnits="userSpaceOnUse">
    <path d="M44 0V44M0 44H44" stroke="{LINK}" stroke-opacity="0.075" stroke-width="1"/></pattern>
  <pattern id="major" width="176" height="176" patternUnits="userSpaceOnUse">
    <path d="M176 0V176M0 176H176" stroke="{LINK}" stroke-opacity="0.145" stroke-width="1"/></pattern>
  <linearGradient id="gridfade" x1="0" y1="0.1" x2="1" y2="0.6">
    <stop offset="0" stop-color="#fff" stop-opacity="0.10"/>
    <stop offset="0.34" stop-color="#fff" stop-opacity="0.95"/>
    <stop offset="0.8" stop-color="#fff" stop-opacity="0.55"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0.20"/></linearGradient>
  <mask id="gridmask"><rect width="{W}" height="{H}" fill="url(#gridfade)"/></mask>

  <linearGradient id="streak" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{ACID}" stop-opacity="0"/>
    <stop offset="0.22" stop-color="{ACID}" stop-opacity="1"/>
    <stop offset="0.7" stop-color="{ACID_HOT}" stop-opacity="1"/>
    <stop offset="1" stop-color="{ACID_HOT}" stop-opacity="0"/></linearGradient>
  <linearGradient id="hotstreak" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{ACID}" stop-opacity="0"/>
    <stop offset="0.28" stop-color="{ACID_HOT}" stop-opacity="1"/>
    <stop offset="0.5" stop-color="#ffffe6" stop-opacity="1"/>
    <stop offset="0.78" stop-color="{ACID_HOT}" stop-opacity="0.8"/>
    <stop offset="1" stop-color="{ACID}" stop-opacity="0"/></linearGradient>

  <linearGradient id="quiet" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#03060f" stop-opacity="0.90"/>
    <stop offset="0.5" stop-color="#03060f" stop-opacity="0.58"/>
    <stop offset="1" stop-color="#03060f" stop-opacity="0"/></linearGradient>
  <radialGradient id="vig" cx="0.55" cy="0.44" r="0.80">
    <stop offset="0.42" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.70"/></radialGradient>
  <pattern id="crt" width="3" height="3" patternUnits="userSpaceOnUse">
    <rect width="3" height="1" fill="#000" fill-opacity="0.14"/></pattern>

  <clipPath id="frame"><rect width="{W}" height="{H}"/></clipPath>
</defs>

<g clip-path="url(#frame)">
  <rect width="{W}" height="{H}" fill="url(#ground)"/>
  <rect width="{W}" height="{H}" fill="url(#pool)"/>

  <g transform="rotate(-19 {W // 2} {H // 2})">{light_shafts()}</g>

  <g mask="url(#gridmask)">
    <rect width="{W}" height="{H}" fill="url(#fine)"/>
    <rect width="{W}" height="{H}" fill="url(#major)"/>
  </g>
  {surveyor_marks()}

  <circle cx="{RADAR_X}" cy="{RADAR_Y}" r="700" fill="url(#radarglow)"/>
  <g transform="translate({RADAR_X},{RADAR_Y})">
    <g fill="none" stroke="{LINK}" stroke-opacity="0.20">
      <circle r="196"/><circle r="322"/><circle r="452"/><circle r="596"/><circle r="760"/>
    </g>
    <g stroke="{LINK}" stroke-opacity="0.115">
      <path d="M-820 0H820M0 -820V820"/>
      <path d="M-580 -580L580 580M580 -580L-580 580"/>
    </g>
  </g>
  {radar_sweep()}{radar_blips()}

  <ellipse cx="{BLOOM_X}" cy="{BLOOM_Y}" rx="620" ry="268" fill="url(#bloom)"/>
  {streak_band(96, 340, 17, SEED + 1)}
  {streak_band(360, 556, 12, SEED + 2, hot=6)}
  {streak_band(600, 868, 18, SEED + 3)}

  <g stroke="{LINK}" stroke-opacity="0.34" stroke-width="2" fill="none">
    <path d="M56 96V56H96"/><path d="M1456 56H1416M1456 56V96"/>
    <path d="M56 886V926H96"/><path d="M1456 926H1416M1456 926V886"/>
  </g>

  <rect x="0" y="0" width="{QUIET_W}" height="{H}" fill="url(#quiet)"/>
  <rect width="{W}" height="{H}" fill="url(#vig)"/>
  <rect width="{W}" height="{H}" fill="url(#crt)"/>
</g></svg>
"""


def font_face():
    """The masthead face as a base64 @font-face - headless Chrome has no network."""
    if not os.path.exists(FONT):
        raise SystemExit(
            f"missing {os.path.relpath(FONT, REPO)} - without it the wordmark "
            "renders in Arial Narrow and nothing complains"
        )
    b64 = base64.b64encode(open(FONT, "rb").read()).decode()
    return (
        '@font-face{font-family:"Black Ops One";font-style:normal;font-weight:400;'
        f'src:url(data:font/woff2;base64,{b64}) format("woff2")}}'
    )


def tech_item(label, mark):
    """One mark-plus-label pair; things with no official SVG get the news square."""
    glyph = (
        f'<svg viewBox="0 0 24 24"><path d="{MARKS[mark]}"/></svg>'
        if mark
        else '<span class="sq"></span>'
    )
    return f'<span class="tech">{glyph}{label}</span>'


def overlay():
    """Masthead lockup top right, the stack bottom right, both on one right margin.

    HTML rather than SVG text: these are rows of mark-plus-label pairs and the
    browser is the thing that knows how wide a label is. Nothing here is
    time-bound, and both blocks sit far right of QUIET_W.
    """
    crest = "".join(f'<path d="{d}"/>' for d in CREST)
    techs = "".join(
        f'<div class="row">{"".join(tech_item(*t) for t in row)}</div>'
        for row in TECH_ROWS
    )
    return (
        '<div class="brand">'
        f'<div class="lock"><svg class="crest" viewBox="0 0 48 48">{crest}</svg>'
        '<div class="wordmark">FRAG<b>FRIDAYS</b></div></div>'
        '<div class="rule"></div>'
        '<div class="game">counter-strike 1.6</div></div>'
        '<div class="stack"><div class="stacklabel">running on</div>'
        f'<div class="rows">{techs}</div></div>'
    )


def build_page():
    """The art with the overlay over it - one document, one screenshot."""
    return f"""<!doctype html><meta charset="utf-8">
<style>
{font_face()}
html,body{{margin:0;padding:0;background:#060b18}}
svg{{display:block}}
.overlay{{position:absolute;inset:0;font-family:Tahoma,Verdana,"Segoe UI",sans-serif}}

/* the same lockup the page wears, scaled up off its 54px crest / 42px logo */
.brand{{position:absolute;top:74px;right:{MARGIN}px;
  display:flex;flex-direction:column;align-items:flex-end}}
.lock{{display:flex;align-items:center;gap:20px}}
.crest{{width:66px;height:66px;fill:{ACID};
  filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6))}}
.wordmark{{font-family:"Black Ops One",sans-serif;font-size:52px;line-height:1;
  letter-spacing:0.02em;color:{TEXT};text-shadow:0 3px 8px rgba(0,0,0,0.7)}}
.wordmark b{{font-weight:400;color:{ACID}}}
.rule{{width:100%;height:1px;margin:18px 0 11px;
  background:linear-gradient(90deg,rgba(143,182,240,0),rgba(143,182,240,0.5))}}
.game{{font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;
  color:{MUTE};text-shadow:0 2px 5px rgba(0,0,0,0.8)}}

/* a colophon, not a sponsor board: one flat slate weight, no brand colours */
.stack{{position:absolute;right:{MARGIN}px;bottom:118px;
  display:flex;flex-direction:column;align-items:flex-end;gap:14px}}
.stacklabel{{font-size:11px;font-weight:700;letter-spacing:0.24em;
  text-transform:uppercase;color:{FAINT}}}
.rows{{display:flex;flex-direction:column;align-items:flex-end;gap:10px}}
.row{{display:flex;justify-content:flex-end;gap:24px}}
.tech{{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700;
  letter-spacing:0.12em;text-transform:uppercase;color:{MUTE};
  text-shadow:0 2px 5px rgba(0,0,0,0.8)}}
.tech svg{{width:17px;height:17px;fill:{LINK};opacity:0.62}}
.sq{{width:17px;display:flex;justify-content:center}}
.sq::before{{content:"";width:6px;height:6px;background:{LINK};opacity:0.45}}
</style>
{build_svg()}
<div class="overlay">{overlay()}</div>
"""


def render(tmp, keep_png=None):
    """SVG -> PNG in headless Chrome, at exactly 1512x982 device pixels."""
    html = os.path.join(tmp, "art.html")
    png = keep_png or os.path.join(tmp, "art.png")
    with open(html, "w") as f:
        f.write(build_page())
    log(f"rendering {W}x{H} in headless Chrome")
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
         "--force-device-scale-factor=1", f"--window-size={W},{H}",
         f"--screenshot={png}", f"file://{html}"],
        check=True, capture_output=True,
    )
    if not os.path.exists(png):
        raise SystemExit("chrome produced no screenshot - is the app at CHROME?")
    return png


def pack_tga(png, tmp):
    """Raw BGR from the PNG into a TGA the engine reads the same way as the old one.

    Type 2 (uncompressed truecolor), 24-bit, descriptor 0x20 = top-left origin.
    ImageMagick can write TGA, but its origin handling is exactly the byte that
    must not drift, so the 18-byte header is written by hand.
    """
    raw = os.path.join(tmp, "art.bgr")
    subprocess.run(["magick", png, "-depth", "8", f"BGR:{raw}"], check=True)
    px = open(raw, "rb").read()
    if len(px) != W * H * 3:
        raise SystemExit(f"expected {W * H * 3} bytes of BGR, got {len(px)}")
    header = struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, W, H, 24, 0x20)
    return header + px


def main():
    keep_png = None
    if "--png" in sys.argv:
        keep_png = os.path.abspath(sys.argv[sys.argv.index("--png") + 1])

    with tempfile.TemporaryDirectory() as tmp:
        png = render(tmp, keep_png)
        if keep_png:
            log(f"kept png at {keep_png}")
        tga = pack_tga(png, tmp)

    os.makedirs(OUT_DIR, exist_ok=True)
    for name in BASENAMES:
        path = os.path.join(OUT_DIR, name)
        with open(path, "wb") as f:
            f.write(tga)
        log(f"wrote {os.path.relpath(path, REPO)} ({len(tga) / 1e6:.1f} MB)")
    log("both basenames are byte-identical - if they ever diverge, that is the bug")
    log("ship it: scripts/deploy.sh, then pnpm run clientcfg to rebuild valve.zip")


if __name__ == "__main__":
    main()
