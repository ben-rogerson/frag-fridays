// --- digital vibrance --------------------------------------------------------
//
// "Digital vibrance" is an NVIDIA control-panel setting, not a game one. There
// is no cvar for it and there never was: it is a saturation boost applied by
// the display driver, after the game has finished drawing. 1.6 players have run
// it at 60-100% since the CPL era for one reason - the maps are sand and
// concrete, the player models are sand and concrete, and pushing the colour
// apart is what lifts a body out of a wall at distance.
//
// The engine draws into a canvas element in a web page here, so the page can do
// the driver's old job. A CSS `filter` on that canvas is the same operation in
// the same place in the pipeline: it runs on the composited output, on the GPU,
// after the frame is drawn and before it is presented. The engine never hears
// about it, and it costs no frame rate - measured, see docs/decisions.md.
//
// WHY `saturate()` AND NOT A COLOUR MATRIX. NVIDIA's dial is a chroma gain in a
// YCbCr-ish space, i.e. a colour matrix with Rec.601 luma weights. CSS
// `saturate()` is the same operation with Rec.709 weights. Both were run over a
// real fy_pool_day frame at +20%: mean difference 0.31 of 255 per channel, max
// 6. Indistinguishable, and `saturate()` is one browser-native primitive with
// no SVG filter element to keep alive in the DOM. Contrast was tried alongside
// it and dropped - it darkens the corners these maps are already full of, which
// is the opposite of the point.
//
// WHERE IT IS APPLIED. On `#canvas` only, via a custom property this module
// writes on the root element (see index.css). Never on a parent: the scoreboard,
// the match menu and the whole lobby overlay are sibling page elements drawn
// over the canvas, and a filter one level up would tint those too. Targeting the
// canvas element also means it survives everything the canvas survives - the
// element is React-owned and never recreated, and fullscreen is requested on the
// document element, so neither path can drop the filter.
import { useSyncExternalStore, type FC } from "react";

import { notchStyle } from "./notch";

// The dial. 1 is off - the picture the engine drew, untouched. The range stops
// at +20%: past that the orange maps go to poster paint, so the travel is spent
// on the band that is actually worth living in rather than on headroom nobody
// should use. Finer steps than the old 0.05 to match - a fifth of the range
// needs a fifth of the granularity to still feel like a dial.
export const VIBRANCE_MIN = 1;
export const VIBRANCE_MAX = 1.2;
export const VIBRANCE_STEP = 0.01;

// Shipped at +10%, mid-track. Enough to separate a model from sand at range,
// and it leaves room to go up as well as down from where players land.
export const VIBRANCE_DEFAULT = 1.1;

// Its own localStorage key, deliberately NOT the `ff-settings-v2` cvar bucket
// the rest of the settings panel writes to. Everything in that bucket is a cfg
// line replayed into the engine console on the next boot (see launch.ts); a
// page-level display setting replayed there would be an unknown command every
// session, and would show up in the saved-overrides chips as a cvar nobody can
// explain. Different kind of setting, different drawer.
const KEY = "ff-vibrance";

const clamp = (n: number) => Math.min(VIBRANCE_MAX, Math.max(VIBRANCE_MIN, n));

// a slider hands back its value as a string, so compare with a tolerance rather
// than betting on 1 + 10 * 0.01 landing exactly on 1.1
const isDefault = (v: number) => Math.abs(v - VIBRANCE_DEFAULT) < 0.001;

function read(): number {
  try {
    const n = parseFloat(localStorage.getItem(KEY) ?? "");
    return Number.isFinite(n) ? clamp(n) : VIBRANCE_DEFAULT;
  } catch {
    return VIBRANCE_DEFAULT; // storage blocked - shipped default it is
  }
}

// `none` rather than `saturate(1)` at the default-off end: an identity filter is
// still a filter, and it would put the canvas on a compositing path it does not
// otherwise need for no visible gain.
const css = (v: number) => (v > 1.001 ? `saturate(${v})` : "none");

let current = read();
const listeners = new Set<() => void>();

export function applyVibrance() {
  document.documentElement.style.setProperty("--ff-vibrance", css(current));
}

export function getVibrance() {
  return current;
}

export function setVibrance(v: number) {
  current = clamp(v);
  try {
    // the default is not an override: store nothing, so a later change to
    // VIBRANCE_DEFAULT reaches players who never touched the slider
    if (isDefault(current)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(current));
  } catch {
    /* storage blocked - the setting still applies for this session */
  }
  applyVibrance();
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useVibrance = () => useSyncExternalStore(subscribe, getVibrance, getVibrance);


// Shown as the boost, not the multiplier: "+20%" is the number a player who has
// ever opened the NVIDIA panel already has in their head, and 1.2 is not.
export const showVibrance = (v: number) =>
  v <= 1.001 ? "off" : `+${Math.round((v - 1) * 100)}%`;

// One tile, same markup and classes as the cvar controls it sits beside - it is
// the same kind of dial to a player, whatever it is behind the panel.
//
// No saved-override chip, unlike every control in CONTROLS. The chips are the
// engine diff made visible - the lines that replay into the console on join -
// and this replays into nothing. `tweak--set` on the readout is the whole
// override indicator, and "clear all" above deliberately leaves it alone: it
// clears what the engine will be told, and this is never told to the engine.
export const VibranceTweak: FC = () => {
  const v = useVibrance();
  const set = !isDefault(v);
  return (
    <div className={`tweak${set ? " tweak--set" : ""}`}>
      <p className="tweak__head">
        <span className="tweak__label">digital vibrance</span>
        <span className="tweak__value">{showVibrance(v)}</span>
      </p>
      <input
        type="range"
        className="tweak__range"
        min={VIBRANCE_MIN}
        max={VIBRANCE_MAX}
        step={VIBRANCE_STEP}
        value={v}
        style={notchStyle(VIBRANCE_MIN, VIBRANCE_MAX, VIBRANCE_DEFAULT)}
        aria-label="digital vibrance"
        onChange={(e) => setVibrance(parseFloat(e.target.value))}
      />
      <p className="tweak__note">
        the old nvidia dial, done by the page - pulls players off the sand.
        brightness washes colour out as it goes up, this puts it back.
      </p>
    </div>
  );
};
