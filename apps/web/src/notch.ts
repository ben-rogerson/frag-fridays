import type { CSSProperties } from "react";

// The tick on a slider track marking the value the server ships. Without it a
// player who drags a dial has no way back to the default except remembering the
// number, and every one of these controls is a setting they are meant to feel
// free to poke at.
//
// Handed to the track as a 0-1 fraction rather than a percentage because the
// thumb does not travel the full width of the track: its centre runs from half
// a thumb in to half a thumb from the end, so the CSS has to do the same inset
// arithmetic (see .tweak__range in App.css) and needs the raw fraction to do it
// with. A percentage here would put the notch a few pixels off the thumb at
// both ends of the track, which is exactly where it is being compared.
export function notchStyle(min: number, max: number, def: number): CSSProperties {
  const f = max > min ? (def - min) / (max - min) : 0;
  // a default outside its own slider's range is a bug in the control table, not
  // something to draw half off the end of the track
  if (f < 0 || f > 1) return {};
  return { "--ff-notch": f } as CSSProperties;
}
