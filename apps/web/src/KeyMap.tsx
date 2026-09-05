// The controls page of the tab screen: the player's own binds drawn onto a
// QWERTY keyboard and a mouse, with a line from every action to the key it is
// actually on.
//
// This used to be a two-column list of keys and labels at the bottom of the
// Escape menu. That is a fine reference for someone who already knows where
// the keys are, and close to useless for the person it was written for: half
// the regulars have not played 1.6 since school, and a row reading "duck
// ctrl" gives their hands nothing they did not already have to go and find. A
// picture of the board with a leader line from each action to its key is the
// same information in the shape the hands are already in.
//
// It lives on the tab screen rather than the Escape menu because that is the
// screen you are already holding when you have forgotten how to plant, and it
// costs a held key rather than leaving the round.
//
// Everything here is read from the player's OWN binds (currentBinds), never
// printed from a table, so a rebind moves the line. Anything bound to a key
// this drawing does not have - numpad, arrows, the keys nobody rebinds to -
// is listed under the drawing rather than silently dropped.
import { useMemo, useState, type FC } from "react";
import "./keymap.css";

export type KeyRow = { label: string; keys: string[] };

// --- what to teach ----------------------------------------------------------

// The running order of what a player needs, not everything that is bound: the
// stock config binds ~60 keys and a wall of them teaches nobody. One row can
// span several commands (move is four, weapons is five) and gets a line to
// each.
const KEYMAP: { label: string; cmds: string[] }[] = [
  { label: "move", cmds: ["+forward", "+moveleft", "+back", "+moveright"] },
  { label: "jump", cmds: ["+jump"] },
  { label: "duck", cmds: ["+duck"] },
  { label: "walk quietly", cmds: ["+speed"] },
  { label: "fire", cmds: ["+attack"] },
  { label: "zoom / alt fire", cmds: ["+attack2"] },
  { label: "reload", cmds: ["+reload"] },
  { label: "use, plant, defuse", cmds: ["+use"] },
  { label: "weapons", cmds: ["slot1", "slot2", "slot3", "slot4", "slot5"] },
  { label: "last weapon", cmds: ["lastinv"] },
  { label: "drop weapon", cmds: ["drop"] },
  { label: "buy menu", cmds: ["buy"] },
  // no scoreboard row here: TAB is unbound at boot and the page draws the
  // board itself, so there is no bind to read. It is appended below instead.
  { label: "chat, team chat", cmds: ["messagemode", "messagemode2"] },
  { label: "radio", cmds: ["radio1", "radio2", "radio3"] },
  { label: "spray", cmds: ["impulse 201"] },
  { label: "torch", cmds: ["impulse 100"] },
  { label: "join t, join ct", cmds: ["jointeam 1", "jointeam 2"] },
  { label: "spectate", cmds: ["jointeam 6"] },
  { label: "console", cmds: ["toggleconsole"] },
];

// Keys the stock config binds a command to SECOND, where the first one is not
// what anyone reaches for: +attack is on ENTER before MOUSE1, and the arrows
// shadow WASD. Skipped unless a command has nothing else.
const AWKWARD_KEYS = new Set(["ENTER", "UPARROW", "DOWNARROW", "LEFTARROW", "RIGHTARROW"]);

// Engine key names a player would not recognise on sight. Only needed for the
// keys that fall off the drawing and get listed under it - everything on the
// board carries its own printed cap.
export const KEYCAPS: Record<string, string> = {
  MOUSE1: "mouse 1",
  MOUSE2: "mouse 2",
  MOUSE3: "mouse 3",
  MWHEELUP: "wheel up",
  MWHEELDOWN: "wheel down",
  UPARROW: "up",
  DOWNARROW: "down",
  LEFTARROW: "left",
  RIGHTARROW: "right",
  ESCAPE: "esc",
  RIGHTBRACKET: "]",
  LEFTBRACKET: "[",
  SEMICOLON: ";",
};

// One key per command in the row, ready to draw. Rows nothing is bound to drop
// out entirely - an empty row would just read as a broken menu. Engine key
// names go out as they came in (uppercase): the drawing matches on them and
// prints its own caps.
export const keymapRows = (binds: Map<string, string[]>): KeyRow[] => {
  // a bind can carry a whole script (userconfig's join binds are
  // `jointeam 1; joinclass 1`), so the first clause is an alias for it
  const byCmd = new Map<string, string[]>();
  for (const [cmd, keys] of binds) {
    for (const alias of new Set([cmd, cmd.split(";")[0].trim()])) {
      byCmd.set(alias, [...(byCmd.get(alias) ?? []), ...keys]);
    }
  }
  const rows = KEYMAP.map(({ label, cmds }) => ({
    label,
    keys: cmds
      .map((cmd) => {
        const keys = byCmd.get(cmd) ?? [];
        return keys.find((k) => !AWKWARD_KEYS.has(k)) ?? keys[0];
      })
      .filter((k): k is string => Boolean(k)),
  })).filter((row) => row.keys.length > 0);
  // ours, not the engine's - the page reads these keys itself. Tab is unbound
  // in the engine (see launchGame) and Escape was never bound to anything.
  rows.push({ label: "this screen", keys: ["TAB"] });
  rows.push({ label: "match menu", keys: ["ESCAPE"] });
  return rows;
};

// --- the drawing ------------------------------------------------------------

// One board, in viewBox units, sized so the type on it survives being scaled
// down to the width of the panel. Everything is derived from U: move the
// keyboard and the leader lines follow, because nothing here is measured
// against a number typed twice.
const U = 44; // one key pitch
const GAP = 5; // ink between two caps
const KX = 302; // left edge of the key block
const KY = 88;
const W = 1290;
const H = 470;
// The drawing's shape, exported because the tab screen has to ask how tall
// this page WANTS to be before it has drawn it - measuring the page instead
// would make the pin depend on the box the pin sets (see TabScreen's measure).
export const KEYMAP_ASPECT = W / H;
// the main block is 15 units wide in every row, which is what makes a
// keyboard look like a keyboard rather than a stack of rows
const ROW_Y = [0, 1.55, 2.55, 3.55, 4.55, 5.55];
// where a label column's text sits, and where its leader leaves from
const LEFT_TEXT = 258;
const LEFT_LINE = 268;
const RIGHT_LINE = 1130;
const RIGHT_TEXT = 1140;
const LABEL_TOP = 34;
const LABEL_BOT = 436;

// The mouse, to the right of the board.
const MX = 1002;
const MY = 126;
const MW = 104;
const MH = 190;
const BTN_H = 76;
const WHEEL_W = 16;
const WHEEL_H = 20;

// [engine names for this key, width in units, printed cap, small type?]
type Cap = [string[], number, string, boolean?];

const chars = (s: string): Cap[] => [...s].map((c) => [[c.toUpperCase()], 1, c]);
const fns = (a: number, b: number): Cap[] =>
  Array.from({ length: b - a + 1 }, (_, i) => [[`F${a + i}`], 1, `f${a + i}`, true] as Cap);
// a run of blank units, so the F row lands over the keys it lines up with
const gap = (w: number): Cap => [[], w, ""];

// Aliases matter: the engine writes `[` as either "[" or "LEFTBRACKET"
// depending on where the bind came from, and both have to light the same cap.
const LAYOUT: Cap[][] = [
  [
    [["ESCAPE", "ESC"], 1, "esc", true],
    gap(1),
    ...fns(1, 4),
    gap(0.5),
    ...fns(5, 8),
    gap(0.5),
    ...fns(9, 12),
  ],
  [
    [["`", "TILDE", "BACKQUOTE"], 1, "`"],
    ...chars("1234567890"),
    [["-", "MINUS"], 1, "-"],
    [["=", "EQUALS"], 1, "="],
    [["BACKSPACE"], 2, "bksp", true],
  ],
  [
    [["TAB"], 1.5, "tab", true],
    ...chars("qwertyuiop"),
    [["LEFTBRACKET", "["], 1, "["],
    [["RIGHTBRACKET", "]"], 1, "]"],
    [["\\", "BACKSLASH"], 1.5, "\\"],
  ],
  [
    [["CAPSLOCK"], 1.75, "caps", true],
    ...chars("asdfghjkl"),
    [["SEMICOLON", ";"], 1, ";"],
    [["'", "APOSTROPHE"], 1, "'"],
    [["ENTER"], 2.25, "enter", true],
  ],
  [
    [["SHIFT"], 2.25, "shift", true],
    ...chars("zxcvbnm"),
    [[",", "COMMA"], 1, ","],
    [[".", "PERIOD"], 1, "."],
    [["/", "SLASH"], 1, "/"],
    [["SHIFT"], 2.75, "shift", true],
  ],
  [
    [["CTRL"], 1.25, "ctrl", true],
    [[], 1.25, "win", true],
    [["ALT"], 1.25, "alt", true],
    [["SPACE"], 6.25, "space", true],
    [["ALT"], 1.25, "alt", true],
    [[], 1.25, "win", true],
    [[], 1.25, "menu", true],
    [["CTRL"], 1.25, "ctrl", true],
  ],
];

type Box = { x: number; y: number; w: number; h: number };
type Part = Box & { ids: string[]; cap: string; small: boolean };

// Laid out once at module load: the geometry cannot change, only which key is
// lit.
const PARTS: Part[] = [];
for (const [r, row] of LAYOUT.entries()) {
  let u = 0;
  for (const [ids, w, cap, small] of row) {
    if (cap !== "") {
      PARTS.push({
        ids,
        cap,
        small: !!small,
        x: KX + u * U,
        y: KY + ROW_Y[r] * U,
        w: w * U - GAP,
        h: U - GAP,
      });
    }
    u += w;
  }
}

// Two buttons with the wheel column between them, the wheel split into up,
// click and down: five regions, which is the whole of what the engine can bind
// on a mouse. No printed caps - a 16-unit wheel has no room for a word, and
// the leader lines are what name these anyway.
const MOUSE_PARTS: Part[] = [
  { ids: ["MOUSE1"], cap: "", small: false, x: MX, y: MY, w: (MW - WHEEL_W) / 2, h: BTN_H },
  {
    ids: ["MOUSE2"],
    cap: "",
    small: false,
    x: MX + (MW + WHEEL_W) / 2,
    y: MY,
    w: (MW - WHEEL_W) / 2,
    h: BTN_H,
  },
  {
    ids: ["MWHEELUP"],
    cap: "",
    small: false,
    x: MX + (MW - WHEEL_W) / 2,
    y: MY + 10,
    w: WHEEL_W,
    h: WHEEL_H,
  },
  {
    ids: ["MOUSE3"],
    cap: "",
    small: false,
    x: MX + (MW - WHEEL_W) / 2,
    y: MY + 10 + WHEEL_H,
    w: WHEEL_W,
    h: WHEEL_H,
  },
  {
    ids: ["MWHEELDOWN"],
    cap: "",
    small: false,
    x: MX + (MW - WHEEL_W) / 2,
    y: MY + 10 + 2 * WHEEL_H,
    w: WHEEL_W,
    h: WHEEL_H,
  },
];

const ALL_PARTS = [...PARTS, ...MOUSE_PARTS];

// engine key name -> every place it is drawn. SHIFT, CTRL and ALT are two
// caps each, and both light: either one really does duck.
const WHERE = new Map<string, Part[]>();
for (const p of ALL_PARTS) {
  for (const id of p.ids) WHERE.set(id, [...(WHERE.get(id) ?? []), p]);
}

const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;

// A leader with horizontal tangents at both ends: it leaves the label
// sideways and arrives at the key sideways, so a fan of four lines into WASD
// stays four readable curves instead of a star.
const leader = (ax: number, ay: number, bx: number, by: number) => {
  const dx = (bx - ax) * 0.45;
  return `M${ax} ${ay}C${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}`;
};

type Lead = { label: string; d: string; dot: [number, number] };
type Placed = { label: string; side: "l" | "r"; y: number };

const spread = (n: number) =>
  n <= 1
    ? [(LABEL_TOP + LABEL_BOT) / 2]
    : Array.from({ length: n }, (_, i) => LABEL_TOP + (i * (LABEL_BOT - LABEL_TOP)) / (n - 1));

// Which side of the board each action's label goes, where down the column it
// sits, and the curve from it to every key it names.
//
// Sides are decided by where the keys ARE (everything left of the board's
// middle goes left), then evened up, so the drawing re-balances itself around
// a rebind instead of holding a hand-written column order that a rebind would
// make wrong. Within a column the order is top-to-bottom by key, which is what
// keeps the leaders from crossing each other.
const layOut = (rows: KeyRow[]) => {
  const owner = new Map<string, string>(); // engine key name -> the action on it
  const known: { label: string; parts: Part[][]; mx: number; my: number }[] = [];
  const extras: KeyRow[] = [];

  for (const row of rows) {
    const parts = row.keys.map((k) => WHERE.get(k) ?? []).filter((p) => p.length > 0);
    if (parts.length === 0) {
      extras.push(row);
      continue;
    }
    for (const k of row.keys) if (WHERE.has(k) && !owner.has(k)) owner.set(k, row.label);
    known.push({
      label: row.label,
      parts,
      mx: parts.reduce((n, p) => n + cx(p[0]), 0) / parts.length,
      my: parts.reduce((n, p) => n + cy(p[0]), 0) / parts.length,
    });
  }

  // left of the board's middle wants a left-hand label; the split is then
  // pulled to even so one column cannot run off the bottom of the drawing
  const sorted = [...known].sort((a, b) => a.mx - b.mx);
  const half = Math.ceil(sorted.length / 2);
  const cols = {
    l: sorted.slice(0, half).sort((a, b) => a.my - b.my || a.mx - b.mx),
    r: sorted.slice(half).sort((a, b) => a.my - b.my || a.mx - b.mx),
  };

  const placed: Placed[] = [];
  const leads: Lead[] = [];
  for (const side of ["l", "r"] as const) {
    const col = cols[side];
    const ys = spread(col.length);
    col.forEach((item, i) => {
      const ly = ys[i];
      const ax = side === "l" ? LEFT_LINE : RIGHT_LINE;
      placed.push({ label: item.label, side, y: ly });
      for (const insts of item.parts) {
        // where a key is drawn twice, the leader goes to whichever cap is
        // nearer the label - the other one lights up all the same
        const p = insts.reduce((best, q) =>
          Math.abs(cx(q) - ax) < Math.abs(cx(best) - ax) ? q : best,
        );
        const bx = side === "l" ? p.x : p.x + p.w;
        leads.push({ label: item.label, d: leader(ax, ly, bx, cy(p)), dot: [bx, cy(p)] });
      }
    });
  }
  return { owner, placed, leads, extras };
};

// --- the component ----------------------------------------------------------

export const KeyMap: FC<{ rows: KeyRow[] }> = ({ rows }) => {
  // hover reads the board, a click keeps one action lit - which is the only
  // way to read it on a touch screen, and the only way to keep it lit while
  // the other hand finds the key
  const [hover, setHover] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const on = hover ?? pin;
  const { owner, placed, leads, extras } = useMemo(() => layOut(rows), [rows]);

  const lit = (p: Part) => p.ids.some((id) => owner.get(id) === on);
  const bound = (p: Part) => p.ids.some((id) => owner.has(id));
  const actionOf = (p: Part) => p.ids.map((id) => owner.get(id)).find(Boolean) ?? null;

  const cls = (p: Part) =>
    `km__key${bound(p) ? " km__key--bound" : ""}${lit(p) ? " km__key--on" : ""}`;

  const hit = (label: string | null) =>
    label
      ? {
          onPointerEnter: () => setHover(label),
          onPointerLeave: () => setHover((h) => (h === label ? null : h)),
          onClick: () => setPin((p) => (p === label ? null : label)),
        }
      : {};

  return (
    <div className={`keymap${on ? " keymap--lit" : ""}`}>
      {/* the stage is what bounds the drawing: it takes whatever height the
          page has left, and the SVG scales to fit inside it rather than
          setting a height of its own and being clipped by the panel */}
      <div className="keymap__stage">
        <svg
          className="keymap__svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="your controls, drawn on a keyboard"
        >
          <defs>
            {/* the two buttons run right into the corners of the shell, so they
                are cut to its outline rather than drawn as squares inside it */}
            <clipPath id="km-mouse">
              <rect x={MX} y={MY} width={MW} height={MH} rx={50} ry={46} />
            </clipPath>
          </defs>

          {/* fills first, then leaders over them, then the printed caps: a
              leader that had to duck behind four keycaps to reach the fifth
              would read as four separate lines */}
          <g className="km__fills">
            {PARTS.map((p, i) => (
              <rect className={cls(p)} key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={5} />
            ))}
          </g>

          <rect className="km__shell" x={MX} y={MY} width={MW} height={MH} rx={50} ry={46} />
          <g className="km__fills" clipPath="url(#km-mouse)">
            {MOUSE_PARTS.map((p, i) => (
              <rect className={cls(p)} key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={3} />
            ))}
          </g>
          <rect className="km__outline" x={MX} y={MY} width={MW} height={MH} rx={50} ry={46} />

          <g className="km__leads">
            {leads.map((l, i) => (
              <g className={`km__lead${l.label === on ? " km__lead--on" : ""}`} key={i}>
                <path d={l.d} />
                <circle cx={l.dot[0]} cy={l.dot[1]} r={3.2} />
              </g>
            ))}
          </g>

          <g className="km__caps">
            {PARTS.map((p, i) => (
              <text
                className={`km__cap${p.small ? " km__cap--small" : ""}${
                  lit(p) ? " km__cap--on" : ""
                }${bound(p) ? " km__cap--bound" : ""}`}
                key={i}
                x={cx(p)}
                y={cy(p)}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {p.cap}
              </text>
            ))}
          </g>

          <g className="km__labels">
            {placed.map((l) => (
              <text
                className={`km__label${l.label === on ? " km__label--on" : ""}`}
                key={l.label}
                x={l.side === "l" ? LEFT_TEXT : RIGHT_TEXT}
                y={l.y}
                textAnchor={l.side === "l" ? "end" : "start"}
                dominantBaseline="central"
                {...hit(l.label)}
              >
                {l.label}
              </text>
            ))}
          </g>

          {/* the hit targets, over everything: a cap or a leader in front of a
              key would otherwise take the pointer off it mid-hover */}
          <g className="km__hits">
            {ALL_PARTS.filter(bound).map((p, i) => (
              <rect
                key={i}
                x={p.x}
                y={p.y}
                width={p.w}
                height={p.h}
                {...hit(actionOf(p))}
              >
                <title>{actionOf(p)}</title>
              </rect>
            ))}
          </g>
        </svg>
      </div>

      <p className="keymap__hint">
        {pin ? "click again to let it go" : "hover a key or an action - click to keep it lit"}
      </p>

      {/* bound somewhere this drawing has no cap for - numpad, the arrows,
          whatever a player has reached for. Better said plainly under the
          board than quietly missing from it. */}
      {extras.length > 0 && (
        <dl className="keymap__extra">
          {extras.map((r) => (
            <div key={r.label}>
              <dt>
                {r.keys.map((k, i) => (
                  <kbd className="key" key={`${k}-${i}`}>
                    {KEYCAPS[k] ?? k.toLowerCase()}
                  </kbd>
                ))}
              </dt>
              <dd>{r.label}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* the drawing is an image as far as a screen reader is concerned, so
          the same binds go out as a list it can actually read */}
      <dl className="keymap__sr">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.keys.map((k) => KEYCAPS[k] ?? k.toLowerCase()).join(", ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
