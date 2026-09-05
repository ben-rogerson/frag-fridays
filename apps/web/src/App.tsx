import { FC, Fragment, useEffect, useRef, useState } from "react";
import {
  clearSavedSettings,
  currentBinds,
  downloadValveZip,
  launchGame,
  leaveServer,
  persistSettings,
  removeSavedSetting,
  savedSettings,
  sendCommand,
  setSavedCvar,
} from "./launch";
import type { SavedSetting } from "./launch";
import { Xash3DWebRTC } from "./webrtc";
import type { DropKind } from "./webrtc";
// the tab screen owns the /status.json and /info.json shapes: it is by far
// their biggest consumer, and it is the reason the feed carries deaths, team
// and ping at all
import { TabScreen } from "./TabScreen";
import type { ModeInfo, ServerStatus } from "./TabScreen";
// A page-level display setting rather than a cvar, so it owns its own storage
// and its own tile - see Vibrance.tsx for why it is not in CONTROLS.
import { VibranceTweak } from "./Vibrance";
import "@fontsource/black-ops-one";
import "./App.css";

type Stage =
  // revalidating valve.zip against Cache Storage: a cached copy makes this the
  // whole wait, so no progress bar until we know there is a download to show
  | { id: "checking" }
  | { id: "downloading"; received: number; total: number | null; rate: number | null }
  | { id: "ready" }
  | { id: "engine" }
  | { id: "unpacking"; done: number; total: number }
  | { id: "playing" }
  // 'quit' is a leave, not a loss - see engineQuiet in webrtc.ts
  | { id: "dropped"; kind: DropKind }
  | { id: "crashed"; message: string }
  | { id: "error"; message: string };

const SEGMENTS = 24;

// status.json is rewritten every 5s from a server frame, and the clocks inside
// it always move - the same bytes coming back for this long means the sim has
// stopped, not that nothing happened. The fetch keeps succeeding either way.
const STATUS_FROZEN_MS = 30_000;
// How long carrying over into a new map is allowed to take before the page
// stops calling it loading and calls it stuck. A healthy carry-over is 1-3s;
// this rides out a big map on a slow link and is still nothing like the ten
// minutes a stalled client used to sit there for.
const CHANGE_STUCK_MS = 30_000;

// What changed, in the players' terms - the server is worked on between
// Fridays and nothing on the page said so.
//
// The bar for an entry: would a player have noticed the problem, or notice
// the change? If not it is filler, and filler makes the real entries
// cheaper. Freeing a slot on leave, fixing the spray store and reworking the
// standings columns all failed that test and were cut - real work, invisible
// from a player's seat. Flat facts only, newest first, no roadmap language.
//
// One line each, read at a glance: what a player gets, in the words they
// would use. No mechanism unless the mechanism is the point, no numbers a
// player cannot feel, and nothing that needs a second clause to land.
const NEWS: { label: string; items: string[] }[] = [
  {
    label: "5 sep",
    items: [
      "new mode - classicAl: classic rounds with $16000 every round, and when you die you watch the rest of it instead of staring at black",
      "the old classic is now cpl tournament - same match rules, a name that says what it is",
    ],
  },
  {
    label: "4 sep",
    items: [
      "map changes no longer strand you on the loading screen - your slot is held",
      "much less rubber banding: on a full server the worst pings halved. your ping is on screen now",
      "bots clear out of the way at the top of a new map so your reload lands",
      "tab draws a proper scoreboard - fits your screen, ordered by kills, with the mode's rules",
      "classic is the 5v5 match mode: cpl and esl era rules, friendly fire on, no bots, $800 start",
      "holding tab no longer sets the sound off",
      "if you ever set ex_interp, it was costing you half your shots on moving targets. the page clears it",
      "crash and rejoin and you get your own name and seat back, not \"you (1)\"",
      "the game starts at 20% volume instead of full",
      "the loading screen carries the frag fridays logo instead of a blue screen",
    ],
  },
  {
    label: "30 aug",
    items: [
      "three more modes under more game modes: source maps, fight yard (fy_ only) and sniper (awp and knife)",
      "hold tab to see how long the friday session has left, or how long until it starts",
      "the esc menu lists your controls - the keys you actually have bound",
      "esc opens the match menu windowed too, not just in fullscreen",
    ],
  },
  {
    label: "29 aug",
    items: [
      "esc opens a match menu - resume, or leave the server, with the round still running behind it",
      "quitting with exit no longer looks like a crash - you get a rejoin button",
      "your settings are on this page: sensitivity, hand and the rest",
    ],
  },
  {
    label: "28 aug",
    items: [
      "a player leaving no longer restarts the server and drops everyone mid-round",
      "reconnect works instead of landing on a black screen",
      "a crash now gives you a reload button instead of freezing the tab",
    ],
  },
  {
    label: "21 aug",
    items: ["bots fill the server to 10 - each human who joins bumps one"],
  },
];

// Background: a plain YouTube playlist of CS 1.6 frag movies, autoplaying
// muted (the only autoplay browsers allow) and looping, starting on a
// random track each load (the shim picks it - see there). YouTube's own
// controls are left on, so players unmute, skip to the next video or go
// fullscreen through the player itself - the page adds no chrome of its own.
//
// The embed goes through a relay page (apps/web/shim, a Cloudflare Worker):
// YouTube refuses embeds from IP-literal http origins like the game server
// (widget onError 150), but accepts them from the shim's workers.dev domain.
// The shim relays widget postMessage traffic both ways, so the error
// fallback below sees onError exactly as if the player were embedded here.
const PLAYLIST_ID = "PLvwKS1s3ePT9xTAxDVGON6RAutiBm4hoZ";
const VIDEO_SHIM = "https://frag-friday-bg.floral-math-a059.workers.dev";

const mb = (bytes: number) => Math.round(bytes / 1048576);

type WeekPlayer = {
  name: string;
  kills: number;
  deaths: number;
  kd: number;
  plants?: number;
  time?: number;
};

// season standings, aggregated from the box's kill logs by
// scripts/standings.sh after each session. Ships in the build and is
// refreshed in place on the box, so one fetch is enough.
type Standings = {
  generated: string;
  // time is seconds on the server, from enter/disconnect log intervals;
  // optional so a stale standings.json from before the field existed parses
  // plants = bombs the player planted that detonated; optional like time
  season: {
    name: string;
    sessions: number;
    kills: number;
    deaths: number;
    kd: number;
    plants?: number;
    time?: number;
  }[];
  // one row per Friday since the first session. mvp is null and players
  // empty for a week with nothing in the logs; note states why a week's
  // figures are partial (or that none were recorded)
  weeks: {
    date: string;
    mvp: string | null;
    kills: number;
    players?: WeekPlayer[];
    note?: string;
  }[];
};

// "2h 05m" / "47m" - server time is hours-coarse, minutes are enough
const playTime = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad2(m % 60)}m` : `${m}m`;
};

// "2026-08-07" -> "fri 7 aug", the kickoffLabel grammar
// kills as a share of kills + deaths - a ratio reads badly past 1.0, a
// percentage says "won 84% of the trades" in one glance
const kdPct = (kills: number, deaths: number) =>
  kills + deaths === 0 ? "-" : `${Math.round((100 * kills) / (kills + deaths))}%`;

// the season table is a leaderboard, not a census - past the top 10 the
// rows are people who dropped in once, and they push the weekly panels
// off the screen
const SEASON_ROWS = 10;

// the podium wears medals instead of rank digits
const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
const rankLabel = (i: number) =>
  i < 3 ? <span className="standings__medal">{MEDALS[i]}</span> : String(i + 1);

// the one table body shared by the weekly tables
const PlayerRows: FC<{ players: WeekPlayer[] }> = ({ players }) => (
  <>
    <thead>
      <tr>
        <th className="standings__num">#</th>
        <th>player</th>
        <th className="standings__num">k / d</th>
        <th className="standings__num">k/d %</th>
        <th className="standings__num">plants</th>
        <th className="standings__num">time</th>
      </tr>
    </thead>
    <tbody>
      {players.map((p, i) => (
        <tr key={p.name}>
          <td className="standings__num standings__rank">{rankLabel(i)}</td>
          <td className="standings__player">{p.name}</td>
          <td className="standings__num">
            {p.kills} / {p.deaths}
          </td>
          <td className="standings__num">{kdPct(p.kills, p.deaths)}</td>
          <td className="standings__num">{p.plants ? p.plants : "-"}</td>
          <td className="standings__num">{p.time !== undefined ? playTime(p.time) : "-"}</td>
        </tr>
      ))}
    </tbody>
  </>
);

const sessionDateLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`)
    .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "")
    .toLowerCase();

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// server browser timeleft cell. Round timer first, map time in brackets - but
// only mention whichever of the two the server is actually running, so we never
// print a bare "-" next to a real clock.
const timeleft = ({ roundTimeLeft, mapTimeLeft }: { roundTimeLeft: number; mapTimeLeft: number }) => {
  const round = roundTimeLeft >= 0 ? mmss(roundTimeLeft) : null;
  const map = mapTimeLeft > 0 ? mmss(mapTimeLeft) : null;
  if (round && map) return `${round} (${map} total)`;
  if (round) return round;
  if (map) return `${map} total`;
  return "-";
};
const pad2 = (n: number) => String(n).padStart(2, "0");

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Rolls a live number up from 0 on first mount - the broadcast scoreboard
// filling in when the strip flips to LIVE. Later feed updates snap.
const CountUp: FC<{ value: number }> = ({ value }) => {
  const [shown, setShown] = useState(REDUCED_MOTION ? value : 0);
  const animatedRef = useRef(false);
  useEffect(() => {
    if (REDUCED_MOTION || animatedRef.current) {
      animatedRef.current = true;
      setShown(value);
      return;
    }
    animatedRef.current = true;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
};

// One scoreboard counter cell. When its digit changes, the reel remounts
// (key) carrying both glyphs: the old one rolls out of the sunken window and
// the incoming one flashes hot, then decays back to acid - a phosphor tick.
// Reduced-motion kills both animations in CSS; the reel then just shows the
// current glyph.
function ClockDigit({ d }: { d: string }) {
  const prevRef = useRef(d);
  const prev = prevRef.current;
  useEffect(() => {
    prevRef.current = d;
  });
  const changed = prev !== d;
  return (
    <span className="clock__digit">
      <span className="clock__reel" key={changed ? prev + d : d}>
        <span className={`clock__glyph${changed ? " clock__glyph--in" : ""}`}>{d}</span>
        {changed && <span className="clock__glyph clock__glyph--out">{prev}</span>}
      </span>
    </span>
  );
}

// A row of counter-cell groups joined by blinking scoreboard colons.
// Shared by the pre-kickoff countdown and the live map-time clock.
const ClockRow: FC<{ groups: [number, string][] }> = ({ groups }) => (
  <>
    {groups.map(([value, unit], gi) => (
      <Fragment key={unit}>
        {gi > 0 && (
          <span className="clock__sep" aria-hidden="true">
            :
          </span>
        )}
        <span className="clock__group">
          <span className="clock__cells" aria-hidden="true">
            {pad2(value)
              .split("")
              .map((d, i) => (
                <ClockDigit d={d} key={i} />
              ))}
          </span>
          <span className="clock__unit">{unit}</span>
        </span>
      </Fragment>
    ))}
  </>
);

// --- session clock ------------------------------------------------------
// Sessions kick off Friday afternoons Sydney time, but the exact slot moves
// week to week. /assets/session.json (editable on the box without a
// rebuild, same serving path as standings.json) names the next kickoff:
// {"date":"2026-08-21","hour":14,"minute":0}. It only applies while its
// date matches the coming Friday, so a stale file falls back to the
// default below and can never show last week's time. Its "end" closes the
// slot: the strip reads LIVE until then, counting the session down, and
// afterwards the countdown rolls to next week. A file with no usable end
// falls back to the half hour the slot used to be assumed to run.
const SESSION_DAY = 5; // Friday
const SESSION_HOUR = 13;
const SESSION_MINUTE = 30;
const SESSION_LENGTH_MS = 30 * 60_000;

type HourMinute = { hour: number; minute: number };

const parseHHMM = (v: unknown): HourMinute | null => {
  const m = typeof v === "string" ? /^(\d{1,2}):(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
};

let sessionOverride: { date: string; hour: number; minute: number; end: HourMinute | null } | null =
  null;

// Re-read on a slow poll, not just at load: the war room can move tonight's
// kickoff to now (an early start), and a page already open should flip to
// LIVE by itself rather than waiting for someone to reload it. A 404 is an
// answer - the override is gone, fall back to the default slot - but a blip
// or a bad gateway is not, and keeps whatever we last read.
const loadSession = () =>
  fetch("/assets/session.json", { cache: "no-store" })
    .then((r) => {
      if (r.status === 404) return null;
      if (!r.ok) return undefined; // couldn't ask; not an answer
      return r.json().catch(() => null); // bad json -> default time
    })
    .then((j) => {
      if (j === undefined) return;
      sessionOverride =
        j && typeof j.date === "string" && Number.isFinite(j.hour)
          ? {
              date: j.date,
              hour: j.hour,
              minute: Number.isFinite(j.minute) ? j.minute : 0,
              end: parseHHMM(j.end),
            }
          : null;
    })
    .catch(() => {});
loadSession();

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// the override only ever applies to its own Friday - see the note above
const overrideFor = (kickoff: Date) =>
  sessionOverride && sessionOverride.date === dateKey(kickoff) ? sessionOverride : null;

// stamp the kickoff time onto a Date already set to the right Friday
const applyKickoffTime = (kickoff: Date) => {
  const o = overrideFor(kickoff);
  kickoff.setHours(o ? o.hour : SESSION_HOUR, o ? o.minute : SESSION_MINUTE, 0, 0);
};

// when that Friday's slot is over. An end that isn't after kickoff is a bad
// file, not a session that ran backwards, so it falls back with the rest.
const sessionEnd = (kickoff: Date) => {
  const o = overrideFor(kickoff);
  if (o?.end) {
    const end = new Date(kickoff);
    end.setHours(o.end.hour, o.end.minute, 0, 0);
    if (end.getTime() > kickoff.getTime()) return end;
  }
  return new Date(kickoff.getTime() + SESSION_LENGTH_MS);
};

type SessionClock =
  | { id: "live"; msLeft: number; mins: number; secs: number }
  | {
      id: "countdown";
      msLeft: number;
      days: number;
      hours: number;
      mins: number;
      secs: number;
      isToday: boolean;
      kickoffLabel: string; // e.g. "fri 7 aug"
      timeLabel: string; // e.g. "1.30 pm", "2 pm" - this week's actual slot
    };

// The page's energy tracks the countdown: calm midweek, charged on matchday,
// climbing through the final hour, held breath in the last minute, then the
// on-air flip. Applied as data-tier on the overlay; CSS does the rest.
type Tier = "idle" | "matchday" | "finalhour" | "final60" | "live";

const clockTier = (c: SessionClock): Tier => {
  if (c.id === "live") return "live";
  if (c.msLeft < 60_000) return "final60";
  if (c.msLeft < 3_600_000) return "finalhour";
  if (c.isToday) return "matchday";
  return "idle";
};

// QA override: ?t-minus=90 opens the page 90 seconds before kickoff (0 or
// negative lands on the live state) so every escalation tier can be checked
// on any day of the week. Absent in normal use.
const DEBUG_KICKOFF = (() => {
  const v = new URLSearchParams(window.location.search).get("t-minus");
  return v === null ? null : Date.now() + Number(v) * 1000;
})();

// QA override: ?mode=dm previews that mode's signal colours on any week.
// Theme only - the card still reads real content from info.json.
const DEBUG_MODE = new URLSearchParams(window.location.search).get("mode");
// Same idea, for the map carry-over cards: `?mapload=de_nuke` paints the
// banner, `&mapstate=stuck` and `&mapstate=frozen` the two stuck sheets. That
// state is otherwise only reachable while a session is actually falling over,
// which is the worst possible time to discover it renders badly.
const DEBUG_MAPLOAD = new URLSearchParams(window.location.search).get("mapload");
const DEBUG_MAPSTATE = new URLSearchParams(window.location.search).get("mapstate");

// QA override: ?tab draws the tab screen over the page with no game behind it.
// Its whole job is holding up at any window size, and joining a server to look
// at it is both slow and impossible to do at eight resolutions in a row.
// ?tab=classic / ?tab=combined force a shape regardless of the live mod.
const DEBUG_TAB = new URLSearchParams(window.location.search).get("tab");

// A Date whose local fields mimic Sydney wall time. Fine for a countdown:
// it's recomputed from scratch every tick, so DST edges self-correct.
const sydneyNow = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" }));

// mins can pass 59 on a long slot, so it is not wrapped to the hour
const liveFrom = (ms: number): SessionClock => {
  const s = Math.ceil(ms / 1000);
  return { id: "live", msLeft: ms, mins: Math.floor(s / 60), secs: s % 60 };
};

const countdownFrom = (
  ms: number,
  isToday: boolean,
  kickoffLabel: string,
  timeLabel: string,
): SessionClock => ({
  id: "countdown",
  msLeft: ms,
  days: Math.floor(ms / 86_400_000),
  hours: Math.floor(ms / 3_600_000) % 24,
  mins: Math.floor(ms / 60_000) % 60,
  secs: Math.floor(ms / 1_000) % 60,
  isToday,
  kickoffLabel,
  timeLabel,
});

function sessionClock(): SessionClock {
  if (DEBUG_KICKOFF !== null) {
    const ms = DEBUG_KICKOFF - Date.now();
    // past kickoff the debug session runs the default half hour, so
    // ?t-minus=-1740 opens on a session with a minute left in it
    if (ms <= 0) return liveFrom(Math.max(0, SESSION_LENGTH_MS + ms));
    return countdownFrom(ms, true, "today", "1.30 pm");
  }
  const now = sydneyNow();
  const kickoff = new Date(now);
  kickoff.setDate(kickoff.getDate() + ((SESSION_DAY - now.getDay() + 7) % 7));
  applyKickoffTime(kickoff);
  if (kickoff.getTime() <= now.getTime()) {
    const end = sessionEnd(kickoff);
    if (now.getTime() < end.getTime()) return liveFrom(end.getTime() - now.getTime());
    kickoff.setDate(kickoff.getDate() + 7);
    applyKickoffTime(kickoff); // next week may have its own slot (or the default)
  }
  const h = kickoff.getHours();
  const m = kickoff.getMinutes();
  const ms = kickoff.getTime() - now.getTime();
  return countdownFrom(
    ms,
    ms < 86_400_000 && kickoff.getDay() === now.getDay(),
    kickoff
      .toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
      .replace(",", "")
      .toLowerCase(),
    `${h % 12 || 12}${m ? "." + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`,
  );
}

// --- map imagery --------------------------------------------------------
// Sourced 1.6-era screenshots (160x120, the classic server-browser thumb
// size), bundled at build time and keyed by lowercase map name. Maps with
// no shot on hand get the flat "no map image" tile.
const MAP_SHOTS = import.meta.glob("./assets/maps/*.jpg", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const mapShot = (map: string): string | null =>
  MAP_SHOTS[`./assets/maps/${map.toLowerCase()}.jpg`] ?? null;

// thumb in a sunken well; the well inset has to be painted over the img
const MapShot: FC<{ map: string }> = ({ map }) => {
  const shot = mapShot(map);
  return (
    <span className="mapshot">
      {shot ? (
        <img src={shot} alt="" width={160} height={120} loading="lazy" />
      ) : (
        <span className="mapshot__none">no map image</span>
      )}
    </span>
  );
};

// --- mode roster --------------------------------------------------------
// One mod runs at a time; /info.json announces the live one. The roster is
// static because the offering changes rarely - blurbs and rules are taken
// from each mod's real info.json copy (server/<mod>/info.json), map pools
// from its mapcycle.txt (cpl's lives in server/cpl/mapcycle.txt).
type ModeEmblem = FC;
type ModeEntry = {
  key: string;
  match: RegExp; // matches the live info.json mode string
  name: string;
  blurb: string;
  rules: string[];
  emblem: ModeEmblem;
  pool?: string[];
  bots?: boolean; // the mod fills empty slots with bots
  fresh?: boolean; // just added - carries a "new" chip until it stops being news
  // the match mode: fixed teams, no bots, a real ruleset. Carries a "5v5"
  // chip so the roster says which mode is the serious one without a word of
  // copy claiming it.
  tournament?: boolean;
};

// emblems: one 2.5px-stroke linework family, coloured via currentColor
const GunGameEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M3 35h8v-8h8v-8h8v-8h8" />
    <path d="M29 5h7v7" />
  </svg>
);

const DeathmatchEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="20" cy="20" r="11" />
    <path d="M20 3v7M20 30v7M3 20h7M30 20h7" />
    <circle cx="20" cy="20" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

// CPL Tournament: the same defusal shield the mode has always worn, now a
// tournament crest - the slash is replaced by a pentagram drawn in one
// unbroken stroke, five points for the five a side. It is the only emblem in
// the set with a mark INSIDE it, which is what makes it read as the flagship
// without leaving the one-stroke-linework family. The star runs thinner than
// the family's 2.5 so it stays legible at the 18px roster size.
const CplEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20 3l14 5v10c0 9-6 15-14 19-8-4-14-10-14-19V8z" />
    <path
      d="M20 12l4.41 13.57L12.87 17.18h14.26L15.59 25.57z"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

// ClassicAl: the same shield, because it is the same game - but the crest
// inside is an eye rather than a star. That is the whole difference between
// the two modes in one mark: when you die here you get to keep watching.
const ClassicAlEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M20 3l14 5v10c0 9-6 15-14 19-8-4-14-10-14-19V8z" />
    <path d="M11 19c3.6-4.2 14.4-4.2 18 0-3.6 4.2-14.4 4.2-18 0z" strokeWidth="1.8" />
    <circle cx="20" cy="19" r="2.6" strokeWidth="1.8" />
  </svg>
);

const AimEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M34 6L12 28l6 6L36 12z" />
    <path d="M8 24l14 14" />
  </svg>
);

// Source Maps: one map sheet traced over another - a remake of a map that
// already existed somewhere else
const SourceMapsEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M14 5h21v21" />
    <path d="M5 14h21v21H5z" />
  </svg>
);

// Fight Yard: two sides closing on each other inside a walled yard
const FightYardEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M4 6h32v28H4z" />
    <path d="M13 14l6 6-6 6" />
    <path d="M27 14l-6 6 6 6" />
  </svg>
);

// Sniper: a scope sitting on a rifle line - deliberately not the DM
// targeting circle, which has its ticks outside and a filled centre
const SniperEmblem: ModeEmblem = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    <circle cx="27" cy="13" r="7" />
    <path d="M27 6v14M20 13h14" />
    <path d="M22 18L6 34" />
    <path d="M6 27v7h7" />
  </svg>
);

// The two modes whose tab screen splits by side. Both are round-based with
// real teams; everything else on the card is a free-for-all in team clothing.
const TEAM_BOARD_MODES = new Set(["classical", "cpl"]);

const MODES: ModeEntry[] = [
  // ClassicAl leads the roster because it is the one people actually play on
  // a Friday: Classic's rounds with the match rules taken off. Order here is
  // the order of the MORE GAME MODES rows.
  //
  // `match` is tested top-down against the live info.json mode string, so the
  // two Classic-family regexes have to stay disjoint: /classic\s*al/ does not
  // match "CPL Tournament" and /cpl|tournament/ does not match "ClassicAl".
  // Do NOT reintroduce a bare /classic/ here - it would swallow both.
  {
    key: "classical",
    match: /classic\s*al/i,
    name: "ClassicAl",
    blurb: "classic rounds, full wallet, and you get to watch",
    rules: [
      "$16000 every round - buy whatever you want",
      "no fade to black - spectate whoever is still alive",
      "1:45 rounds, 6s freeze, one life",
      "5v5 with bots - one leaves per human",
      "10 minute maps",
    ],
    emblem: ClassicAlEmblem,
    bots: true,
    fresh: true,
    // CPL's seven, plus the three casual maps already in gg's and dm's
    // rotations - so the valve.zip keep-list (the union of every mapcycle) is
    // unchanged and this needed no clientcfg.
    pool: [
      "de_dust2",
      "de_inferno",
      "de_nuke",
      "de_train",
      "de_cbble",
      "de_aztec",
      "de_dust",
      "cs_office",
      "cs_italy",
      "cs_assault",
    ],
  },
  {
    key: "cpl",
    match: /cpl|tournament/i,
    name: "CPL Tournament",
    blurb: "5v5 on match rules - no bots, no respawn",
    rules: [
      "five a side, humans only",
      "15 rounds a half, first to 16",
      "1:45 rounds, $800 start, friendly fire on",
      "dead players see black until the round ends",
    ],
    emblem: CplEmblem,
    tournament: true,
    // the era's pool, cut to maps this server already ships. dust2, inferno,
    // nuke, train and cbble are in every league's rotation for the whole
    // decade; aztec and dust come and go. docs/classic-rules.md has the years.
    pool: ["de_dust2", "de_inferno", "de_nuke", "de_train", "de_cbble", "de_aztec", "de_dust"],
  },
  {
    key: "gungame",
    match: /gun\s*game/i,
    name: "GunGame",
    blurb: "every kill levels you up - 23 weapons to the top",
    rules: ["knife kills steal a level", "instant respawn", "5v5 with bots - one leaves per human", "10 minute maps"],
    emblem: GunGameEmblem,
    bots: true,
    pool: [
      "aim_map",
      "de_dust2",
      "cs_assault",
      "de_dust",
      "cs_italy",
      "de_inferno",
      "cs_office",
      "de_aztec",
      "de_cbble",
      "fy_iceworld",
      "fy_pool_day",
      "scoutzknivez",
      "de_rats",
      "de_train",
      "cs_prospeedball",
      "cs_deagle5",
    ],
  },
  {
    key: "dm",
    match: /death\s*match/i,
    name: "Deathmatch",
    blurb: "team deathmatch, instant respawn",
    rules: ["pick your guns with /guns", "instant respawn", "5v5 with bots - one leaves per human", "10 minute maps"],
    emblem: DeathmatchEmblem,
    bots: true,
    pool: [
      "fy_pool_day",
      "de_dust2",
      "de_dust",
      "cs_assault",
      "de_nuke",
      "de_cbble",
      "cs_office",
      "fy_iceworld",
      "aim_map",
      "scoutzknivez",
      "de_rats",
      "de_train",
      "cs_prospeedball",
      "cs_deagle5",
    ],
  },
  {
    key: "aim",
    match: /aim/i,
    name: "Aim Prac",
    blurb: "gun down the knife horde - humans hold CT",
    rules: [
      "16 knife bots, all on T",
      "humans defend as CT - guns free",
      "pick your guns with /guns",
      "instant respawn",
    ],
    emblem: AimEmblem,
    bots: true,
    pool: [
      "de_dust2",
      "cs_assault",
      "de_dust",
      "cs_italy",
      "cs_office",
      "de_inferno",
      "de_aztec",
      "de_cbble",
      "de_nuke",
      "de_train",
    ],
  },
  {
    key: "css",
    // "Source Maps" - keep this ahead of nothing else that matches /source/
    match: /source/i,
    name: "Source Maps",
    blurb: "CS:S and CS:GO maps remade for 1.6",
    rules: [
      "pick your guns with /guns",
      "instant respawn",
      "cache, mirage and dust2 as 1.6 geometry",
      "5v5 with bots - one leaves per human",
    ],
    emblem: SourceMapsEmblem,
    bots: true,
    fresh: true,
    pool: ["css_dust2_go", "css_mirage_go", "css_cache", "de_bank_csgo", "css_bycastor", "css_deagle"],
  },
  {
    key: "fy",
    match: /fight\s*yard/i,
    name: "Fight Yard",
    blurb: "fy_ maps only - small yards, guns on the floor",
    rules: [
      "pick your guns with /guns",
      "instant respawn",
      "1 minute rounds - the yards are tiny",
      "some maps hand out their own floor guns",
    ],
    emblem: FightYardEmblem,
    bots: true,
    fresh: true,
    pool: ["fy_iceworld", "fy_desert", "fy_pool_day", "fy_houses", "fy_snow", "fy_nuketown"],
  },
  {
    key: "awp",
    match: /sniper/i,
    name: "Sniper",
    blurb: "AWP and knife, nothing else",
    rules: [
      "AWP only - no /guns, no buying",
      "knife and grenades still work",
      "instant respawn",
      "5v5 with bots - one leaves per human",
    ],
    emblem: SniperEmblem,
    bots: true,
    fresh: true,
    pool: ["awp_city", "awp_dust", "awp_sunburn"],
  },
];

// the Vultr box (update if the VPS is ever resized). `was` is the pre-resize
// value - rows that carry one render as a before -> after delta so the
// upgrade reads as real numbers, not a claim.
type ServerSpec = { label: string; value: string; was?: string };
const SERVER_UPGRADED_ON = "19 aug 2026";
const SERVER_SPECS: ServerSpec[] = [
  { label: "vCPUs", value: "2 vCPUs", was: "1 vCPU" },
  { label: "RAM", value: "4096.00 MB", was: "2048.00 MB" },
  { label: "Storage", value: "50 GB NVMe", was: "25 GB NVMe" },
  { label: "Bandwidth", value: "102.11 GB" },
  { label: "Location", value: "Sydney, AU \u{1F1E6}\u{1F1FA}" },
];

// crest above the heading (supplied artwork, recoloured via currentColor)
const CrestLogo: FC = () => (
  <svg viewBox="0 0 48 48" className="crest" aria-hidden="true">
    <path
      fill="currentColor"
      d="M43,10.077c-0.506-0.001-1.216-0.054-1.717,0.024c-0.746,0.132-1.506-0.086-2.258-0.109 c-0.011-0.184,0.129-0.513,0.122-0.696c-0.141-0.018-0.281-0.028-0.417-0.06c-0.127-0.457-0.078-0.939-0.093-1.408 c-0.072-0.001-0.217-0.004-0.289-0.006c-0.023,0.534-0.021,1.068-0.027,1.602c-0.185-0.151-0.314-0.444-0.583-0.423L30.392,9 c-0.388,0.042-0.691-0.223-1.004-0.41c-0.03-0.246-0.069-0.49-0.117-0.732c-0.22,0.303-0.24,0.691-0.321,1.048 c-0.584,0.116-1.161,0.443-1.756,0.495c-0.052-0.344-0.107-0.687-0.145-1.034c0.315-0.152,0.669-0.254,0.93-0.502 c0.307-0.898-0.048-1.832-0.251-2.71C27.099,4.697,26.402,4.292,25.677,4h-1.042v0c-0.716,0.234-1.429,0.617-1.836,1.291 c-0.63,0.989-0.717,2.259-0.321,3.357c-0.056,0.038-0.168,0.116-0.224,0.156c-0.682-0.54-1.625-0.273-2.278,0.18 c-0.948,0.719-1.454,1.895-1.664,3.055c-0.217,0.983-0.12,1.992-0.004,2.98c-0.392,0.097-0.794,0.116-1.193,0.146 c-0.167,0.007-0.378,0.074-0.396,0.273c-0.12,0.782-0.031,1.586-0.192,2.363c-0.104,0.498-0.171,1.004-0.154,1.514 c0.437,0.099,0.877,0.194,1.316,0.287c-0.3,0.138-0.645,0.236-0.859,0.509c-0.188,1.261,0.26,2.504,0.22,3.769 c-0.22,0.192-0.495,0.365-0.567,0.673c-0.135,0.363,0.08,0.732,0.027,1.103c-0.051,0.404,0.04,0.806,0.169,1.184 c0.121,0.317,0.02,0.657-0.028,0.98c-0.142,0.836-0.305,1.674-0.34,2.523c-0.028,0.448,0.127,0.91-0.016,1.345 c-0.466,1.068-1.249,1.959-1.663,3.054c-0.183,0.504-0.09,1.08-0.353,1.558c-0.281,0.538-0.669,1.069-0.634,1.714 c-0.031,0.437,0.317,0.829,0.17,1.266c-0.218,0.891-0.437,1.783-0.679,2.669c-0.164,0.589-0.195,1.234-0.012,1.822 c0.245,0.129,0.521,0.172,0.789,0.23h1.031c0.333-0.031,0.663-0.087,0.996-0.134c0.096-0.462-0.017-0.913-0.173-1.343 c-0.194-1.084-0.021-2.236,0.52-3.192c0.187-0.248,0.527-0.344,0.66-0.64c0.199-0.423,0.294-0.886,0.476-1.316 c0.256-0.612,0.606-1.187,0.766-1.838c0.089-0.356-0.013-0.721,0.019-1.081c0.097-0.399,0.276-0.79,0.57-1.078 c0.394-0.369,0.548-0.934,0.979-1.269c0.294-0.22,0.308-0.614,0.37-0.951c0.058-0.446,0.203-0.873,0.364-1.29 c0.229-0.577,0.387-1.21,0.828-1.665c0.28-0.293,0.42-0.683,0.522-1.071c0.175,0.339,0.315,0.715,0.596,0.981 c0.315,0.158,0.774,0.073,0.965,0.434c0.549,0.836,0.59,1.312,1.141,2.148c0.263,0.519,0.897,0.392,1.366,0.406 c0.27,0.371,0.571,0.478,0.481,0.928c-0.017,0.507-0.445,0.898-0.385,1.417c0.047,1.056,0.125,2.121,0.399,3.144 c0.096,0.477,0.344,0.915,0.352,1.411c0.012,0.574-0.097,1.514-0.212,2.081c-0.28,0.759-0.471,1.553-0.507,2.366 c0.662,0.39,1.426-0.006,2.118,0.225c0.759,0.251,1.555,0.341,2.35,0.326c0.489-0.009,0.979-0.057,1.46-0.132 c0.003-0.277,0.093-0.578-0.033-0.837c-0.4-0.473-1.069-0.475-1.555-0.802c-0.393-0.354-0.714-0.786-1.042-1.201 c-0.277-0.326,0.094-0.777,0.083-1.188c0.004-0.624,0.001-1.267,0.231-1.855c0.17-0.468,0.113-0.974,0.021-1.451 c-0.124-0.587,0.086-1.166,0.14-1.747c0.078-0.792,0.134-1.586,0.184-2.38c0.036-0.453-0.119-0.885-0.229-1.316 c-0.065-0.406-0.451-0.635-0.564-1.02c-0.662-1.826-1.268-3.329-2.572-4.785c-0.501-0.499-0.754-1.333-0.45-2.004 c0.282,0.077,0.562,0.162,0.848,0.234c0.305-0.411,0.603-0.865,0.652-1.393c0.05-0.544,0.065-1.091,0.113-1.635 c0.022-0.593,0.15-1.204-0.003-1.786c-0.1-0.398-0.493-0.57-0.797-0.772c0.073-0.277,0.147-0.552,0.212-0.831 c1.003,0.489,1.933,1.198,3.056,1.372c0.301,0.046,0.623,0.19,0.922,0.052c0.412-0.198,0.73-0.544,1.09-0.822 c0.652-0.513,0.562-1.449,0.789-2.181c0.222-0.086,0.448-0.165,0.673-0.249c-0.148-0.649-0.406-1.305-0.318-1.982 c0.27-0.369,0.611-0.59,0.892-0.951c0.201-0.274,0.549-0.345,0.866-0.337c0.955-0.005,1.911,0.012,2.867,0.001 c0.031-0.139-0.082,0.139-0.048,0c0.994,0.057,1.989-0.159,2.985-0.035c0.621,0.107,1.455,0.063,2.079,0.017 C43.024,10.8,43.008,10.26,43,10.077z M30.703,13.574c-0.189-0.338-0.472-0.656-0.528-1.046c0.03-0.041,0.092-0.12,0.122-0.16h0 c0.406-0.043,0.815-0.016,1.222,0.004C31.256,12.778,30.978,13.176,30.703,13.574z M30.644,12.266 c0.27-0.138,0.357-0.423,0.392-0.71c0.217-0.011,0.435-0.018,0.655-0.023c0.008,0.211,0.015,0.42,0.023,0.631 C31.362,12.243,31.001,12.242,30.644,12.266z"
    />
    <path
      fill="currentColor"
      d="M43 23h-7v-2h9c-.131-.793-.66-1.501-1.395-1.808-.493-.226-1.044-.19-1.57-.19L36 19c-1 0-2 1-2 2v2c.055.998 1 2 2 2h7v2h-9c.134.637.47 1.237 1.018 1.593.48.346 1.083.424 1.657.407H43c1 0 2-1 2-2v-2C45 24 44.12 23.019 43 23zM5 21h8c0-1.105-.895-2-2-2H5c-1.105 0-2 .895-2 2v6c0 1.105.895 2 2 2h6c1.105 0 2-.895 2-2H5V21z"
    />
  </svg>
);

function stageProgress(stage: Stage): number | null {
  switch (stage.id) {
    case "checking":
      return null;
    case "downloading":
      return stage.total ? stage.received / stage.total : null;
    case "unpacking":
      return stage.total ? stage.done / stage.total : null;
    case "ready":
    case "engine":
    case "playing":
      return 1;
    case "dropped":
    case "crashed":
    case "error":
      return 0;
  }
}

function stageLabel(stage: Stage): string {
  switch (stage.id) {
    case "checking":
      return "checking for a cached copy of valve.zip…";
    // the period download-dialog readout: real transfer rate and a flat
    // time estimate, straight off the byte stream
    case "downloading": {
      const rate = stage.rate === null ? "" : ` - ${(stage.rate / 1048576).toFixed(1)} MB/s`;
      if (!stage.total) return `valve.zip - ${mb(stage.received)} MB${rate}`;
      const secsLeft =
        stage.rate !== null && stage.rate > 0
          ? Math.max(1, Math.round((stage.total - stage.received) / stage.rate))
          : null;
      const est =
        secsLeft === null
          ? ""
          : secsLeft > 90
            ? ` - est. ${Math.round(secsLeft / 60)} min left`
            : // 5s steps past 10s so the estimate reads steady, not twitchy
              ` - est. ${secsLeft > 10 ? Math.round(secsLeft / 5) * 5 : secsLeft} sec left`;
      return `valve.zip - ${mb(stage.received)} / ${mb(stage.total)} MB${rate}${est}`;
    }
    case "ready":
      return "download complete - no install, no Steam.";
    case "engine":
      return "starting engine, connecting to server…";
    case "unpacking":
      return `unpacking files - ${stage.done} / ${stage.total}`;
    case "playing":
      return "";
    case "dropped":
      if (stage.kind === "quit") return "you left the game";
      return stage.kind === "transport"
        ? "connection to the server was lost"
        : "you were dropped from the server";
    case "crashed":
      return `the game engine crashed - ${stage.message}`;
    case "error":
      return stage.message;
  }
}

/* --- your settings ------------------------------------------------------ */

// The engine's cfg files die with the page, so the client saves a diff of
// everything the player changed and replays it on the next boot (launch.ts).
// That diff was invisible and permanent: a sensitivity poked into the console
// once came back every session with no way to drop it again. This panel is
// that diff made visible - one chip per override, deselect to drop it - plus
// controls for the handful of settings worth changing outside the game.
// `quote` is for values with spaces (an rgb triplet): the console needs them
// quoted, everything in here compares and displays them bare.
type ControlBase = {
  cvar: string;
  label: string;
  def: string;
  quote?: boolean;
  // a caveat the player needs BEFORE picking, printed under the control
  note?: string;
};
type Control = ControlBase &
  (
    | { kind: "range"; min: number; max: number; step: number; percent?: boolean }
    | { kind: "choice"; swatch?: boolean; options: { value: string; label: string }[] }
  );

// `def` must match what server/config/userconfig.cfg ships: a control moved
// back to it drops the override instead of pinning today's default forever.
// Sliders run first, then the pick-one controls: the grid fills row by row,
// so grouping by shape keeps every row one kind of dial instead of stepping
// between a track and a row of chips at every column.
const CONTROLS: Control[] = [
  {
    // Deliberately NOT narrowed to the 0-2 the volume and brightness dials sit
    // in: the shipped default is 2.0, so a slider that stopped at 2 would pin
    // every player at its maximum and cut off anyone running high sens. 0.5-4
    // is the band 1.6 players actually live in.
    cvar: "sensitivity",
    label: "mouse sensitivity",
    def: "2.0",
    kind: "range",
    min: 0.5,
    max: 4,
    step: 0.1,
  },
  {
    // scoped aim (awp, scout) relative to the hip sensitivity above
    cvar: "zoom_sensitivity_ratio",
    label: "zoom sensitivity",
    def: "1.0",
    kind: "range",
    min: 0.5,
    max: 2,
    step: 0.05,
  },
  { cvar: "xhair_size", label: "crosshair size", def: "2", kind: "range", min: 1, max: 6, step: 1 },
  // Was 0-3. Past 2 the picture goes flat grey rather than brighter, so the
  // slider stops there and spends its travel on the range that does something;
  // shipped 1 then sits mid-track. A value above 2 saved before this (or typed
  // into the console) still shows its real number in the readout, with the
  // thumb parked at the end.
  { cvar: "brightness", label: "brightness", def: "1", kind: "range", min: 0, max: 2, step: 0.1 },
  {
    // 1 is the engine's maximum, so this stays a 0-1 slider (shown as 0-100%)
    // rather than the 0-2 the rest of the dials use. def tracks the shipped
    // `volume 0.2` - loud enough at a desk, quiet enough not to announce the
    // game to the room.
    cvar: "volume",
    label: "game volume",
    def: "0.2",
    kind: "range",
    min: 0,
    max: 1,
    step: 0.05,
    percent: true,
  },
  {
    cvar: "cl_righthand",
    label: "gun hand",
    def: "1",
    kind: "choice",
    // Measured 2026-08-29, not assumed: joined with no cl_righthand override
    // saved (the chips listed only cl_cmdrate, cl_dlmax and sensitivity), so
    // the engine ran the shipped `cl_righthand 1` from userconfig.cfg - and
    // the viewmodel drew on the RIGHT. 1 is right-handed. Leave it: this
    // order puts left first AND leaves right (the shipped default, def "1")
    // as the selected chip.
    options: [
      { value: "0", label: "left" },
      { value: "1", label: "right" },
    ],
  },
  {
    // the code-drawn crosshair cs16-client actually uses; the stock sprite
    // fallback (cl_crosshair_color) only draws if xhair is unavailable, which
    // it never is in this build, so one cvar covers it
    cvar: "xhair_color",
    label: "crosshair colour",
    def: "50 250 50 255",
    quote: true,
    kind: "choice",
    swatch: true,
    options: [
      { value: "50 250 50 255", label: "green" },
      { value: "0 220 255 255", label: "cyan" },
      { value: "255 230 0 255", label: "yellow" },
      { value: "255 40 40 255", label: "red" },
      { value: "255 255 255 255", label: "white" },
    ],
  },
  {
    // The browser canvas draws at native window resolution, so 1.6's stock HUD
    // text is tiny on a laptop screen. Shipping a bigger one for everybody was
    // tried and reverted (userconfig.cfg, 2026-08-21): the vgui-less scoreboard
    // scales its text with this cvar but lays rows out at fixed unscaled
    // spacing, so ANY value above 1 overlaps the rows. That is a trade a
    // player can make for themselves, so it lives here with the cost spelled
    // out rather than in the shipped config.
    //
    // 1.5 is a half-step in size and a whole-step in softness: the font is a
    // GL-stretched bitmap, so only integer scales land on texel boundaries.
    // It stays because the jump from 1 to 2 is a big one on a small laptop
    // screen, and soft-but-readable beats tiny - but it is the pick that
    // looks worst, so it is offered, not defaulted.
    //
    // FWGS extension, present in this build's engine. The saved diff replays
    // after main() and before `connect`, and the HUD builds its fonts at
    // connect, so a pick here is live for the whole session.
    cvar: "hud_fontscale",
    label: "hud text size",
    def: "1",
    note: "medium is a soft half-step - the font stretches, whole sizes stay sharp",
    kind: "choice",
    options: [
      { value: "1", label: "normal" },
      { value: "1.5", label: "medium" },
      { value: "2", label: "big" },
    ],
  },
  {
    // Shipped on (net_graph 3 in userconfig.cfg) after the 2026-09-04 lag
    // session - see docs/netcode.md. A player who can read their own ping
    // turns "it feels laggy" into "I'm on 180", which is a report worth
    // acting on; this control is for the people who would rather not see it.
    //
    // The values are inverted from what the names suggest on this build, and
    // these were read off in-game screenshots rather than assumed: 3 is four
    // lines of TEXT ONLY (fps, ping in ms, in/out kb/s, loss and choke) and
    // is the least cluttered of the three, while 2 stacks a large filled area
    // graph on top of the same text. 1 sits between them and is dropped -
    // three chips, and it adds nothing 3 does not already say.
    cvar: "net_graph",
    label: "network stats",
    def: "3",
    kind: "choice",
    options: [
      { value: "0", label: "off" },
      { value: "3", label: "ping" },
      { value: "2", label: "graph" },
    ],
  },
  {
    // Bullet holes and blood splatter. Shipped FULL (r_decals 4096 in
    // userconfig.cfg) after measuring the cost on fy_pool_day and not finding
    // one - see docs/decisions.md. This control exists anyway because that
    // measurement is one M1 Pro, and the laptops people actually join on are
    // not that.
    //
    // Only reduces, and cannot do otherwise: the engine clamps r_decals to
    // mp_decals at every level load, and userconfig.cfg ships that ceiling at
    // 4096. A value at or below it survives every map change (verified), and
    // nothing a player picks here can raise the count past what the server
    // config intends.
    cvar: "r_decals",
    label: "bullet holes",
    def: "4096",
    note: "off is the cheapest picture if your machine is struggling - it takes the blood with it",
    kind: "choice",
    options: [
      { value: "0", label: "off" },
      { value: "300", label: "some" },
      { value: "4096", label: "full" },
    ],
  },
];

const CONTROL_BY_CVAR = new Map(CONTROLS.map((c) => [c.cvar, c]));

// host_writeconfig quotes its values and writes floats long-hand
// (sensitivity "3.500000"), so everything on the way out gets unwrapped and
// everything on the way in is written plain - the console takes either.
const unquote = (v: string) => v.replace(/^"([\s\S]*)"$/, "$1").trim();
const tidy = (n: number) => String(Math.round(n * 100) / 100);
const controlNum = (c: Control, value: string) => {
  const n = parseFloat(unquote(value));
  return Number.isNaN(n) ? parseFloat(c.def) : n;
};

// A choice matches on value, not spelling: a saved line comes back however the
// engine last wrote it, and a number can come back long-hand ("1.500000") or
// bare ("1.5"). Only both-sides-numeric compares numerically - an rgb triplet
// is a string and stays one.
const asNum = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? parseFloat(v) : null);
const sameValue = (a: string, b: string) => {
  const [x, y] = [asNum(a), asNum(b)];
  return x !== null && y !== null ? x === y : a === b;
};

const showValue = (c: Control, value: string): string => {
  const v = unquote(value);
  if (c.kind === "choice") return c.options.find((o) => sameValue(o.value, v))?.label ?? v;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return c.percent ? `${Math.round(n * 100)}%` : tidy(n);
};

// Chip text for one saved line. Settings this panel knows get their friendly
// name; anything else (a bind changed in-game, a cvar typed into the console)
// still shows up as itself rather than being hidden from the player.
const describe = (s: SavedSetting): { label: string; value: string } => {
  if (s.key.startsWith("bind ")) {
    const cmd = s.value.match(/^("?)(\S+?)\1\s+([\s\S]*)$/);
    const key = s.key.slice(5).toLowerCase();
    return { label: `bind ${key}`, value: unquote(cmd ? cmd[3] : s.value) };
  }
  if (s.key.startsWith("unbind ")) {
    return { label: "unbound key", value: s.key.slice(7).toLowerCase() };
  }
  const c = CONTROL_BY_CVAR.get(s.cvar);
  if (!c) return { label: s.cvar, value: unquote(s.value) };
  return { label: c.label, value: showValue(c, s.value) };
};

const SettingsPanel: FC = () => {
  const [saved, setSaved] = useState<SavedSetting[]>(savedSettings);
  const reread = () => setSaved(savedSettings());
  // a cvar line keys on its own name, so this is the whole lookup
  const savedValue = (c: Control) => saved.find((s) => s.key === c.cvar)?.value;

  const set = (c: Control, value: string) => {
    const same =
      c.kind === "choice" ? sameValue(value, c.def) : controlNum(c, value) === parseFloat(c.def);
    setSavedCvar(c.cvar, same ? null : c.quote ? `"${value}"` : value);
    reread();
  };

  return (
    <section id="settings" className="panel front__settings" aria-label="your settings">
      <h2 className="panel__bar">
        your settings
        <span className="panel__barnote">saved in this browser - applied every time you join</span>
      </h2>
      <div className="panel__body tweaks">
        <div>
          <p className="card__ruleslabel tweaks__savedlabel">
            <span>your changes, applied on join</span>
            {saved.length > 0 && (
              <button
                type="button"
                className="tweaks__clear"
                onClick={() => {
                  clearSavedSettings();
                  reread();
                }}
              >
                clear all
              </button>
            )}
          </p>
          {saved.length > 0 ? (
            <ul className="chips">
              {saved.map((s) => {
                const d = describe(s);
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      className="chip chip--set"
                      title={s.line}
                      aria-label={`remove ${d.label} ${d.value}`}
                      onClick={() => {
                        removeSavedSetting(s.key);
                        reread();
                      }}
                    >
                      <span className="chip__tick" aria-hidden="true">
                        ✓
                      </span>
                      <span className="chip__label">{d.label}</span>
                      <span className="chip__value">{d.value}</span>
                      <span className="chip__x" aria-hidden="true">
                        ×
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="chips__none">
              nothing changed yet - you play on the settings the server ships
            </p>
          )}
        </div>

        <div className="tweaks__grid">
          {/* First because the grid groups by shape (sliders, then pick-one
              rows) and this is a slider - not because it outranks sensitivity.
              It is the only control here that is the page rather than the
              engine, so it is not in CONTROLS and renders itself. */}
          <VibranceTweak />
          {CONTROLS.map((c) => {
            const raw = savedValue(c);
            const value = raw ?? c.def;
            return (
              <div className={`tweak${raw ? " tweak--set" : ""}`} key={c.cvar}>
                <p className="tweak__head">
                  <span className="tweak__label">{c.label}</span>
                  {/* a slider needs its number spelled out; the picked chip
                      below already reads as the value for a choice */}
                  {c.kind === "range" && <span className="tweak__value">{showValue(c, value)}</span>}
                </p>
                {c.kind === "range" ? (
                  <input
                    type="range"
                    className="tweak__range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={controlNum(c, value)}
                    aria-label={c.label}
                    onChange={(e) => set(c, e.target.value)}
                  />
                ) : (
                  <span className="tweak__choices" role="group" aria-label={c.label}>
                    {c.options.map((o) => {
                      const on = sameValue(unquote(value), o.value);
                      return (
                        <button
                          type="button"
                          key={o.value}
                          className={`chip chip--pick${on ? " chip--on" : ""}`}
                          aria-pressed={on}
                          title={c.swatch ? o.label : undefined}
                          aria-label={c.swatch ? o.label : undefined}
                          onClick={() => set(c, o.value)}
                        >
                          {c.swatch ? (
                            <span
                              className="chip__swatch"
                              style={{ background: `rgb(${o.value.split(" ").slice(0, 3).join(",")})` }}
                            />
                          ) : (
                            o.label
                          )}
                        </button>
                      );
                    })}
                  </span>
                )}
                {c.note && <p className="tweak__note">{c.note}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

// --- keymap -----------------------------------------------------------------
// Half the regulars have not played 1.6 since school and cannot remember the
// keys, so the match menu lists them. The keys are read from the player's OWN
// binds (see currentBinds), not printed from a table here - a rebind has to
// show up or the list is worse than nothing.
//
// This is the running order of what a player needs, not everything that is
// bound: the stock config binds ~60 keys and a wall of them teaches nobody.
// One row can span several commands (move is four, weapons is five) and lists
// a key for each, in order.
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

// Engine key names a player would not recognise on sight
const KEYCAPS: Record<string, string> = {
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

// One key per command in the row, ready to render. Rows nothing is bound to
// drop out entirely - an empty row would just read as a broken menu.
const keymapRows = (binds: Map<string, string[]>): { label: string; keys: string[] }[] => {
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
      .filter((k): k is string => Boolean(k))
      .map((k) => KEYCAPS[k] ?? k.toLowerCase()),
  })).filter((row) => row.keys.length > 0);
  // ours, not the engine's - the page reads these keys itself. Tab is unbound
  // in the engine (see launchGame) and Escape was never bound to anything.
  rows.push({ label: "scoreboard", keys: ["tab"] });
  rows.push({ label: "this menu", keys: ["esc"] });
  return rows;
};

const App: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zipRef = useRef<Uint8Array | null>(null);
  const xashRef = useRef<Xash3DWebRTC | null>(null);
  const startedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [stage, setStage] = useState<Stage>({ id: "checking" });
  const [videoDead, setVideoDead] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem("ff-name") ?? "");
  const [nameNeeded, setNameNeeded] = useState(false);
  const aliasRef = useRef<HTMLInputElement>(null);
  const [modeInfo, setModeInfo] = useState<ModeInfo | null>(null);
  // which roster row is unfolded in "more game modes"; one at a time so the
  // card stays a card, not a scroll
  const [openMode, setOpenMode] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [standings, setStandings] = useState<Standings | null>(null);
  // weeks that actually produced results; unlogged Fridays stay in the
  // breakdown but never count as sessions
  const played = standings?.weeks.filter((w) => w.mvp) ?? [];
  // measured round-trip of the last successful status poll; pollTick remounts
  // the masthead livedot so it blips once per real answer from the box
  const [ping, setPing] = useState<number | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [clock, setClock] = useState<SessionClock>(sessionClock);
  // true only when the countdown hit zero on-screen - gates the one-shot
  // on-air sting (radar burst, LIVE NOW flicker); a page merely loaded
  // mid-session gets the calm live state
  const [wentLive, setWentLive] = useState(false);
  const prevClockRef = useRef<SessionClock>(clock);
  // Escape menu. Only possible because the engine no longer reacts to Escape
  // at all (the GameUI menu is not loaded - see ENGINE_LIBRARIES in
  // launch.ts). Before that, Escape opened a menu the build could not draw
  // and the render loop died; three attempts to SWALLOW the key failed, and
  // the one that swallowed pointerlockchange broke mouse look outright. This
  // handler swallows nothing - see the effect below.
  const [paused, setPaused] = useState(false);
  // the keymap the menu lists, read from the engine when the menu opens rather
  // than held in state all session: a player can rebind mid-match
  const [keys, setKeys] = useState<{ label: string; keys: string[] }[]>([]);
  // true for as long as an overlay owns the cursor - see the release effect
  const holdCursorRef = useRef(false);
  // Tab held down: the session clock and the buy pad ride the scoreboard key
  const [tabHeld, setTabHeld] = useState(false);
  // whether the engine had the mouse when Tab went down, so releasing Tab
  // gives back what it took and does not grab a cursor that was already free
  const lockAtTabDownRef = useRef(false);
  // Whether the page got fullscreen when Play asked for it, which is not the
  // same as being fullscreen: Escape drops the page out of it without asking.
  // Resume reads this to know whether to put fullscreen back or leave a
  // player whose request was refused windowed.
  const wantFullscreenRef = useRef(false);
  // when the last fullscreen transition happened, and when the page last gave
  // the pointer lock up of its own accord - see the pointer-lock effect
  const fsChangeAtRef = useRef(0);
  const codeUnlockedAtRef = useRef(0);

  useEffect(() => {
    const t = window.setInterval(() => setClock(sessionClock()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // the kickoff itself can move under an open page - see loadSession
  useEffect(() => {
    const t = window.setInterval(loadSession, 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // A genuine zero-crossing, not just any countdown -> live flip: the tick
    // before has to have been a countdown with nothing left on it. Otherwise
    // a page opened mid-session fires the sting anyway, because the first
    // tick runs before /assets/session.json has answered and a week whose
    // slot is not the compiled default reads as "not started" until it does.
    const prev = prevClockRef.current;
    if (prev.id === "countdown" && prev.msLeft < 1500 && clock.id === "live") setWentLive(true);
    prevClockRef.current = clock;
  }, [clock]);

  // While LIVE the scoreboard cells count the map's remaining time instead:
  // resynced to the feed on every poll, ticked down locally between polls.
  // null = the mod runs no map timelimit, and the cells sit out.
  const [mapClock, setMapClock] = useState<number | null>(null);
  useEffect(() => {
    setMapClock(serverStatus && serverStatus.mapTimeLeft > 0 ? serverStatus.mapTimeLeft : null);
  }, [serverStatus]);
  useEffect(() => {
    if (clock.id !== "live") return;
    const t = window.setInterval(
      () => setMapClock((m) => (m === null ? null : Math.max(0, m - 1))),
      1000,
    );
    return () => window.clearInterval(t);
  }, [clock.id]);

  // The engine's SDL layer registers its own document-level fullscreenchange
  // handlers when the game boots (after this mount effect, so ours run first).
  // Letting them fire corrupts the menu's console font (GetFontTall()==0) and
  // the next menu draw traps wasm with "RuntimeError: remainder by zero" -
  // exactly what Esc does in fullscreen, since Chrome exits fullscreen AND
  // opens the game menu on the same keypress. Swallow the event before it
  // reaches SDL; the engine still adapts to the new canvas size through the
  // window resize path, which handles fullscreen transitions fine.
  useEffect(() => {
    const onFsChange = (e: Event) => {
      fsChangeAtRef.current = Date.now();
      e.stopImmediatePropagation();
    };
    // Chrome fires the webkit-prefixed event too, and SDL listens to both
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  const enterFullscreen = () => {
    wantFullscreenRef.current = true;
    // a refused request is no state to restore later
    document.documentElement.requestFullscreen?.().catch(() => {
      wantFullscreenRef.current = false;
    });
  };

  // Live server snapshot. It used to stop once in-game; it now carries the tab
  // screen too, so it keeps running through a match - see pollEvery below for
  // the cadence. info.json rides the same poll so a mod swap updates the match
  // panel (and the tab screen's briefing) on an already-open page. Parse
  // failures (mid-write reads, plugin absent) just skip the tick and the last
  // good snapshot stands.
  const playing = stage.id === "playing";

  // The scoreboard and the session clock are on screen only while Tab is down.
  // Tab is where a player already looks for match state, so the number is
  // asked for rather than played around - and the rest of the time the screen
  // is the game's.
  //
  // Unlike the Escape handler below, this one SWALLOWS the key, and has to.
  // Holding a key is auto-repeat: the browser fires keydown tens of times a
  // second for as long as it is held, and a scoreboard is held for seconds at
  // a time. Ignoring `repeat` keeps that out of React, but not out of the
  // engine - capture phase means we see the event first, which is not the same
  // as stopping it, and SDL's own window-level handlers were still taking
  // every one of those repeats and feeding them to the engine, where they were
  // retriggering sound. (launchGame unbinds TAB, so the engine has nothing
  // useful to do with the key - but "nothing useful" is not "nothing".)
  // stopImmediatePropagation is what actually stops SDL seeing it, the same
  // reason the fullscreenchange handler above needs it; preventDefault stops
  // the browser walking focus off the canvas on the way past. Both keydown and
  // keyup are swallowed, because a lone keyup is an event into the engine too.
  //
  // Not while the pause menu is open: that is an ordinary dialog with
  // focusable buttons, so Tab there is the browser's business, not ours.
  useEffect(() => {
    if (!playing || paused) return;
    const swallow = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      swallow(e);
      // a held key is one state change, not a hundred
      if (!e.repeat) {
        // Remember whether the mouse was ours to take before the buy pad
        // frees it. A player who is already unlocked - windowed, clicked
        // outside the canvas - did not ask for the game to grab their cursor
        // just because they glanced at the score, so Tab release must give
        // back exactly what Tab press took and nothing more.
        lockAtTabDownRef.current = Boolean(document.pointerLockElement);
        setTabHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      swallow(e);
      setTabHeld(false);
      // Hand the mouse back here rather than in the hold effect's cleanup,
      // for the reason `resume` documents: the cleanup has not run at this
      // point, so its pointerlockchange listener is still live and would
      // bounce the lock straight back out. Dropping the flag first is what
      // makes the request stick. A keyup is a user gesture, so the browser
      // accepts the request the same way it accepts one from a click.
      if (lockAtTabDownRef.current) {
        holdCursorRef.current = false;
        try {
          canvasRef.current?.requestPointerLock?.();
        } catch {
          /* refused - a click on the canvas relocks */
        }
      }
    };
    // the keyup that never comes: alt-tab away holding Tab, or the browser
    // moving focus out of the page on that very press. No relock on this
    // path: the page does not have focus, so the request would be refused
    // anyway, and a player who has alt-tabbed away wants their cursor.
    const clear = () => setTabHeld(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      setTabHeld(false);
    };
  }, [playing, paused]);

  // Capture phase on window so nothing can stop the event before we see it -
  // but we only READ it. No preventDefault (the browser still exits
  // fullscreen and pointer lock, which is what frees the cursor for the
  // buttons), no stopPropagation, no interference with SDL. The engine gets
  // the keypress exactly as it does today and does nothing with it.
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat) return;
      setPaused((open) => !open);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [playing]);

  // The engine gives the lock up on its own whenever it wants the cursor back -
  // opening the ~ console is the one players hit - and that must not raise the
  // menu over it. Note when the lock is released BY CODE (the engine's
  // SDL_SetRelativeMouseMode lands on document.exitPointerLock, as does the
  // hold below) so the effect can tell those apart from the browser taking it
  // away. The wrapper only timestamps and calls straight through: no swallowed
  // events, no changed behaviour.
  useEffect(() => {
    const orig = document.exitPointerLock;
    if (!orig) return;
    document.exitPointerLock = function patched(this: Document) {
      codeUnlockedAtRef.current = Date.now();
      return orig.call(this);
    };
    return () => {
      document.exitPointerLock = orig;
    };
  }, []);

  // ...but windowed, that keypress never arrives. Chrome eats the Escape that
  // exits pointer lock and dispatches nothing, so a windowed player pressing
  // Escape only ever got their cursor back and no menu. The lock going away is
  // the signal, then. (Fullscreen keeps working through the handler above -
  // Escape leaves fullscreen there and the key does reach the page. Both paths
  // only ever OPEN the menu, so the two firing on one keypress is a no-op.)
  // Losing the lock any other way - alt-tab, a click outside the canvas -
  // leaves a free cursor over a round that is still running, which is the
  // state this menu exists for, so it opens for those too.
  //
  // Not while Tab is held either. The buy pad frees the cursor deliberately
  // and keeps freeing it for as long as the key is down (see the hold effect),
  // and every one of those releases is an unlock this handler would otherwise
  // read as "the player wants the menu". The codeUnlockedAtRef stamp does
  // suppress each one on its own - the hold goes through the patched
  // exitPointerLock - but only because they happen to land inside its 600ms
  // window, which is not something a scoreboard held for ten seconds should
  // be relying on. Saying so outright is the difference between working and
  // working by accident.
  useEffect(() => {
    if (!playing || paused || tabHeld) return;
    const onLockChange = () => {
      if (document.pointerLockElement) return;
      // entering or leaving fullscreen drops the lock by itself; that is not
      // a request for the menu
      if (Date.now() - fsChangeAtRef.current < 600) return;
      if (Date.now() - codeUnlockedAtRef.current < 600) return;
      setPaused(true);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => document.removeEventListener("pointerlockchange", onLockChange);
  }, [playing, paused, tabHeld]);

  // Escape frees the cursor, but not for long: the engine asks for it
  // straight back. emscripten's _emscripten_request_pointerlock queues a
  // DEFERRED requestPointerLock when it cannot lock on the spot
  // (JSEvents.deferredCalls) and runs the queue inside the next user event,
  // so moving to the menu and clicking a button re-captured the mouse - the
  // pointer vanished and the click landed in the game. Hold the cursor for
  // as long as the menu is up by handing the lock straight back whenever
  // something takes it. This still swallows nothing: no preventDefault, no
  // stopPropagation, the engine sees every event it saw before (the attempt
  // that swallowed pointerlockchange is the one that broke mouse look).
  //
  // The buy pad needs exactly the same thing for exactly the same reason, so
  // the condition is "some overlay wants the cursor", not "the menu is open".
  // A click on a buy button is a user event, which is precisely when
  // emscripten runs its deferred lock request, so without this the first
  // click would buy the gun AND take the mouse back mid-purchase.
  //
  // The visible cost is a one-frame flicker per click - lock granted, then
  // released again by the listener below - which the pause menu has always
  // had and nobody has reported.
  const cursorFree = paused || (playing && tabHeld);

  useEffect(() => {
    if (!cursorFree) return;
    holdCursorRef.current = true;
    const release = () => {
      if (holdCursorRef.current && document.pointerLockElement) document.exitPointerLock?.();
    };
    release(); // in case the overlay opened with the lock still held
    document.addEventListener("pointerlockchange", release);
    return () => {
      holdCursorRef.current = false;
      document.removeEventListener("pointerlockchange", release);
    };
  }, [cursorFree]);

  useEffect(() => {
    if (!paused) return;
    setKeys(keymapRows(currentBinds(xashRef.current)));
  }, [paused]);

  // The tab screen's buy pad. Every command goes through sendCommand, which
  // refuses to touch a console whose connection has gone - see the note above
  // persistSettings in launch.ts. That refusal is the whole reason this
  // returns a boolean: a dead link is the one case where the player must be
  // told the ask did not leave the building, because the alternative is them
  // clicking AK four times into a void while a bot shoots them.
  //
  // Sent one at a time and in order. Cmd_ExecuteString is synchronous, so the
  // chain is already in flight before this returns; there is no queue to
  // drain and no frame to wait for.
  const buy = (cmds: string[]): boolean => {
    let sent = false;
    for (const cmd of cmds) sent = sendCommand(xashRef.current, cmd) || sent;
    return sent;
  };

  const resume = () => {
    // drop the hold first: the effect's cleanup has not run yet at this point,
    // and its listener would bounce the lock we are about to ask for
    holdCursorRef.current = false;
    setPaused(false);
    // Escape drops the page out of fullscreen and no page can cancel that, so
    // Resume puts it back for a player who was in it - the click is the user
    // gesture that makes the request legal, which is also why closing the menu
    // with a second Escape cannot do it: a keypress the page did not act on is
    // not a gesture the browser accepts, so that path stays windowed until the
    // next Resume click.
    if (wantFullscreenRef.current && !document.fullscreenElement) enterFullscreen();
    // SDL enters relative mouse mode when the lock is GRANTED, so asking for
    // it here is the same thing a click on the canvas does - it can only give
    // the engine back the mouse, never take it away.
    try {
      canvasRef.current?.requestPointerLock?.();
    } catch {
      /* refused (mid fullscreen transition) - a click on the canvas relocks */
    }
  };

  // Hand the slot back before the reload, same as the pagehide path, so the
  // server frees it now instead of holding it for sv_timeout (600s). The
  // reload is what returns the lobby: the engine has no "back to menu" left
  // and valve.zip comes off Cache Storage, so it costs an unpack.
  const leaveMatch = () => {
    const x = xashRef.current;
    if (x) leaveServer(x);
    location.reload();
  };

  // This polls while PLAYING too, which it did not used to. status.json is the
  // page's only view of the server once the engine has the screen, and without
  // it a map change is completely invisible: the lobby overlay is hidden, the
  // canvas sits on the engine's loading screen, and nothing anywhere says a
  // word about what is happening or whether it is going to finish. That is
  // what stranded the 2026-09-04 session - see docs/troubleshooting.md.
  //
  // `at` is when the payload last CHANGED, not when it was last fetched.
  // statusjson.amxx writes the file from a server frame every 1s (0.2.0; it
  // was 5s when this was written) and the clocks inside it always move, so
  // identical bytes for half a minute mean the sim has stopped - while the
  // fetch itself keeps succeeding and every number in the file keeps reading
  // perfectly healthy.
  const statusSeenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [serverFrozen, setServerFrozen] = useState(false);

  // Poll cadence, in ms. The lobby wants a heartbeat; a match wants the
  // scoreboard to be true when it is asked for, and nothing in between - so
  // the feed idles at 15s during play and only quickens while Tab is down.
  // (The plugin writes the file every second, so 1s is as live as it gets.)
  const pollEvery = !playing ? 5000 : tabHeld ? 1000 : 15_000;

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      const t0 = performance.now();
      fetch("/status.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : null))
        .then((text) => {
          if (cancelled || text === null) return;
          const s = JSON.parse(text) as ServerStatus;
          if (!s?.map) return;
          if (text !== statusSeenRef.current.text)
            statusSeenRef.current = { text, at: Date.now() };
          setServerFrozen(Date.now() - statusSeenRef.current.at > STATUS_FROZEN_MS);
          setServerStatus(s);
          setPing(Math.round(performance.now() - t0));
          setPollTick((n) => n + 1);
        })
        .catch(() => {});
      fetch("/info.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((info: ModeInfo | null) => {
          if (!cancelled && info?.mode) setModeInfo(info);
        })
        .catch(() => {});
    };
    poll();
    const t = window.setInterval(poll, pollEvery);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [pollEvery]);

  // --- carrying over into a new map --------------------------------------
  //
  // A map change keeps everyone connected: the engine reconnects the client
  // to the same server on the new level, and the player is supposed to land
  // in it a second or two later. When that handshake stalls the client is
  // stuck on a loading screen the page cannot see, the server is fine and
  // still talking (so the drop watchdog never fires), and the slot is held
  // for the full sv_timeout - which is how six people spent a session
  // watching nothing on 2026-09-04.
  //
  // The tell is in status.json: the server's map name changed, and this
  // player is NOT in its player list. That list is written from
  // get_players(), which only counts clients that have actually spawned in,
  // so "my name is missing from the new map" is the server saying it has not
  // seen us arrive - not a guess made in the page.
  const myNameRef = useRef("");
  // the map we have been confirmed present in; null until the first poll
  const inMapRef = useRef<string | null>(null);
  // the map we are being carried into but have not been seen in yet
  const [changing, setChanging] = useState<string | null>(null);
  useEffect(() => {
    const alias = myNameRef.current;
    // no alias, no way to find ourselves on a scoreboard - say nothing rather
    // than assume the worst about every map change (play() always sets one,
    // this is only here so a future path that does not can never show a card
    // that will never clear)
    if (!playing || !alias || !serverStatus?.map) return;
    const map = serverStatus.map;
    // whatever map the first poll of a session finds is the one we joined
    if (inMapRef.current === null) {
      inMapRef.current = map;
      return;
    }
    // the engine hands out "Name (1)" when an alias is already taken, so a
    // prefix match is the honest test rather than an exact one
    const here = serverStatus.players.some(
      (p) => !p.bot && (p.name === alias || p.name.startsWith(`${alias} (`)),
    );
    if (here) {
      inMapRef.current = map;
      setChanging(null);
    } else if (map !== inMapRef.current) {
      setChanging(map);
    }
  }, [serverStatus, playing]);

  // a carry-over that has not landed in this long is not slow, it is stuck
  const [changeStuck, setChangeStuck] = useState(false);
  useEffect(() => {
    setChangeStuck(false);
    if (!changing) return;
    const t = window.setTimeout(() => setChangeStuck(true), CHANGE_STUCK_MS);
    return () => window.clearTimeout(t);
  }, [changing]);

  // the standings file is weekly data - one fetch, no poll. Absent file
  // (fresh box, script never run) just leaves the panel unrendered.
  useEffect(() => {
    fetch("/assets/standings.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Standings | null) => {
        if (s?.season) setStandings(s);
      })
      .catch(() => {});
  }, []);

  // tab title carries tonight's mode, e.g. "Classic Mode | Frag Fridays";
  // plain "Frag Fridays" (from index.html) until info.json answers
  useEffect(() => {
    if (!modeInfo) return;
    const name = MODES.find((m) => m.match.test(modeInfo.mode))?.name ?? modeInfo.mode;
    document.title = `${name} Mode | Frag Fridays`;
  }, [modeInfo]);

  // YouTube refuses embeds from some origins (error 150/153 - e.g. IP-literal
  // http origins since late 2025). Detect via the widget API and drop the
  // iframe so players get the offline notice instead of YouTube's error box.
  // The widget only reports errors after a 'listening' handshake. Errors are
  // all we listen for now - playback itself is the player's own business.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      try {
        const d = JSON.parse(e.data);
        if (d.event === "onError" || d.info?.playerErrorCode) setVideoDead(true);
      } catch {
        /* not a widget message */
      }
    };
    window.addEventListener("message", onMsg);
    const handshake = setInterval(() => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: "ff", channel: "widget" }),
        "*",
      );
    }, 1000);
    return () => {
      window.removeEventListener("message", onMsg);
      clearInterval(handshake);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // transfer rate over a sliding ~3s window of progress samples; needs
    // ~0.8s of history before it reads as a rate rather than a spike
    const samples: { t: number; received: number }[] = [];
    // a cached zip still streams its bytes back out of Cache Storage, and that
    // read is not a download - it gets no bar and no MB/s readout
    let fromCache = false;
    downloadValveZip(
      (p) => {
        if (cancelled || fromCache) return;
        const now = performance.now();
        samples.push({ t: now, received: p.received });
        while (samples.length > 1 && now - samples[0].t > 3000) samples.shift();
        const span = now - samples[0].t;
        const rate = span > 800 ? ((p.received - samples[0].received) / span) * 1000 : null;
        setStage({ id: "downloading", ...p, rate });
      },
      (source) => {
        if (cancelled) return;
        fromCache = source === "cache";
        // the first progress callback lands a beat later, so open the bar here
        if (!fromCache) setStage({ id: "downloading", received: 0, total: null, rate: null });
      },
    )
      .then((bytes) => {
        if (cancelled) return;
        zipRef.current = bytes;
        setStage({ id: "ready" });
      })
      .catch((err: Error) => {
        if (!cancelled) setStage({ id: "error", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const play = async () => {
    if (startedRef.current || !zipRef.current || !canvasRef.current) return;
    // quotes/semicolons would escape the `name "..."` console command
    const playerName = name
      .replace(/["';\\]/g, "")
      .trim()
      .slice(0, 31);
    // no alias, no connect - every entry point (button, Enter, double-click)
    // lands here, so the nudge covers them all
    if (!playerName) {
      setNameNeeded(true);
      aliasRef.current?.focus();
      return;
    }
    startedRef.current = true;
    // the alias the server will know us by, which is how the page recognises
    // itself in status.json's player list - see the carry-over effect above
    myNameRef.current = playerName;
    // the Play gesture also covers the fullscreen request
    enterFullscreen();
    localStorage.setItem("ff-name", playerName);
    try {
      xashRef.current = await launchGame(
        canvasRef.current,
        zipRef.current,
        playerName,
        (s) =>
          setStage(
            s.phase === "engine"
              ? { id: "engine" }
              : { id: "unpacking", done: s.done, total: s.total },
          ),
        (kind) => {
          // the engine may still hold the pointer when the server vanishes
          document.exitPointerLock?.();
          // a crash goes silent, so the watchdog fires ~10s later - it must
          // not downgrade "crashed" (reload only) to "dropped" (offers a
          // reconnect the dead engine can never honour)
          setStage((s) => (s.id === "crashed" ? s : { id: "dropped", kind }));
        },
        (message) => {
          document.exitPointerLock?.();
          setStage({ id: "crashed", message });
        },
      );
      zipRef.current = null;
      // a drop during launch must not be clobbered by the launch resolving
      setStage((s) => (s.id === "dropped" || s.id === "crashed" ? s : { id: "playing" }));
      // snapshot in-game settings every 30s, plus when the tab hides or the
      // page unloads, so they survive reloads. play() runs once, so these
      // never stack.
      const persist = () => {
        if (xashRef.current) persistSettings(xashRef.current);
      };
      window.setInterval(persist, 30_000);
      // settings first, then hand the slot back - a reload fires pagehide, so
      // the reconnect button no longer leaves its own ghost behind
      window.addEventListener("pagehide", () => {
        persist();
        if (xashRef.current) leaveServer(xashRef.current);
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") persist();
      });
    } catch (err) {
      setStage({ id: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Always a full reload. The in-engine `retry` looked cheaper - it kept the
  // unpacked filesystem - but it does not work after a drop: this wasm build's
  // render loop dies on the disconnect (the UI_DrawString crash in backlog
  // item 2), so `retry` lands on a black screen with an engine that never
  // reaches the wire. Seen live 2026-08-28: the server logged no connect
  // attempt at all from a player clicking reconnect, the silence watchdog
  // re-fired ~10s later, and they looped between black screen and drop
  // screen. A reload rebuilds the engine, and valve.zip comes from Cache
  // Storage, so the cost is an unpack and not a 316MB download.
  const reconnect = () => {
    location.reload();
  };

  const progress = stageProgress(stage);
  const filled = progress === null ? 0 : Math.round(progress * SEGMENTS);
  // humans only - a bot topping the board isn't news, and bots never rank;
  // fragless leaders stay hidden (no "top frag: X (0)")
  const humans = serverStatus?.players.filter((p) => !p.bot) ?? [];
  const best = humans.length > 0 ? humans.reduce((a, b) => (b.frags > a.frags ? b : a)) : null;
  const topFrag = best && best.frags > 0 ? best : null;
  // which roster entry is live; unmatched modes (a future mod) still render
  // from info.json with the fallback emblem
  const liveMode = modeInfo ? (MODES.find((m) => m.match.test(modeInfo.mode)) ?? null) : null;
  const HeroEmblem = liveMode?.emblem ?? CplEmblem;
  const tier = clockTier(clock);
  // What the in-game clock says, and whether it says anything at all: the
  // slot's remaining time while the session runs, and on matchday before
  // kickoff the wait for it. Every other day it stays off the screen - a
  // Tuesday warm-up does not need a three-day countdown over the game.
  const slotClock =
    clock.id === "live"
      ? {
          lead: "session",
          time: `${clock.mins}:${pad2(clock.secs)}`,
          tail: "left",
          aria: `session time remaining: ${clock.mins} minutes ${clock.secs} seconds`,
        }
      : clock.isToday
        ? {
            lead: "session in",
            time: clock.hours
              ? `${clock.hours}:${pad2(clock.mins)}:${pad2(clock.secs)}`
              : `${clock.mins}:${pad2(clock.secs)}`,
            tail: null,
            aria: `session starts in ${clock.hours} hours ${clock.mins} minutes ${clock.secs} seconds`,
          }
        : null;
  // each mode broadcasts in its own signal colour; classic acid until the
  // live mode is known (or an unmatched future mod runs)
  const themeMode = DEBUG_MODE ?? liveMode?.key ?? "cpl";
  // What the carry-over cards below paint, in one place: the live state, or
  // whatever the ?mapload debug params ask for. Both stand down for the match
  // menu, which the player opened on purpose.
  const loadingMap = DEBUG_MAPLOAD ?? (playing && !paused ? changing : null);
  const loadingStuck = DEBUG_MAPLOAD ? DEBUG_MAPSTATE !== null : changeStuck;
  const loadingFrozen = DEBUG_MAPLOAD ? DEBUG_MAPSTATE === "frozen" : serverFrozen;

  // Which shape the tab screen takes. The two Classic-family modes are the
  // only ones where the teams are the story; gungame, dm, aim, source maps,
  // fight yard and sniper are all effectively free-for-alls in team clothing,
  // and the table anyone there actually reads is one list ordered by kills.
  // An unknown mod (info.json missing) keeps the teams, which is what stock
  // 1.6 would do.
  const classicBoard =
    DEBUG_TAB === "combined"
      ? false
      : DEBUG_TAB === "classic" || TEAM_BOARD_MODES.has(liveMode?.key ?? "cpl");
  const modeName = liveMode?.name ?? modeInfo?.mode ?? "Frag Fridays";

  return (
    <>
      <canvas id="canvas" ref={canvasRef} />
      <div
        className={`overlay${playing ? " overlay--hidden" : ""}`}
        data-tier={tier}
        data-mode={themeMode}
      >
        <div className="tacgrid" aria-hidden="true">
          <span className="tacgrid__mark" style={{ top: "21%", left: "6%" }} data-coord="B2" />
          <span className="tacgrid__mark" style={{ top: "58%", left: "90%" }} data-coord="G6" />
          <span className="tacgrid__mark" style={{ top: "84%", left: "11%" }} data-coord="C9" />
          <span className="tacgrid__frame" />
        </div>
        <div className={`radar${wentLive ? " radar--burst" : ""}`} aria-hidden="true" />
        <div className="streaks" aria-hidden="true" />
        <div className="page">
          <header className="masthead">
            <div className="masthead__brand">
              <CrestLogo />
              <h1 className="masthead__logo">
                FRAG<span>FRIDAYS</span>
              </h1>
            </div>
            <p className="masthead__facts">
              <span className="masthead__game">counter-strike 1.6</span>
              <span className="masthead__when">every friday &middot; sydney server</span>
            </p>
          </header>

          <section
            id="session"
            className={`event${clock.id === "live" ? " event--live" : ""}${
              tier === "final60" ? " event--imminent" : ""
            }${wentLive ? " event--onair" : ""}`}
            aria-label="next session"
          >
            {clock.id === "live" ? (
              <>
                <p className="event__label">
                  <span className="event__livetitle">
                    <span className="livedot" aria-hidden="true" />
                    live now
                  </span>
                  {serverStatus ? (
                    <span className="event__meta">
                      <span className="event__map">{serverStatus.map}</span> &middot;{" "}
                      <CountUp value={serverStatus.humans} />{" "}
                      {serverStatus.humans === 1 ? "player" : "players"} in &middot;{" "}
                      <CountUp value={serverStatus.bots} /> bots
                    </span>
                  ) : null}
                  {/* the slot's own clock - the map clock below is a different
                      number and players read them as the same one otherwise */}
                  <span className="event__when">
                    {clock.mins}:{pad2(clock.secs)} left in this session
                  </span>
                </p>
                {mapClock !== null && (
                  <p
                    className="event__clock"
                    role="timer"
                    aria-label={`map time remaining ${mmss(mapClock)}`}
                  >
                    <span className="event__clocklabel" aria-hidden="true">
                      map
                      <br />
                      time
                    </span>
                    <ClockRow
                      groups={[
                        [Math.min(99, Math.floor(mapClock / 60)), "min"],
                        [mapClock % 60, "sec"],
                      ]}
                    />
                  </p>
                )}
              </>
            ) : (
              <>

                <p className="event__label">
                  <span className="event__title">
                    {clock.isToday ? "matchday" : "next session"}
                  </span>
                  <span className="event__when">
                    {clock.isToday ? "today" : clock.kickoffLabel} &middot; {clock.timeLabel} sydney
                  </span>
                  {/* the box runs all week - joining before kickoff is warm-up,
                      not the event. only claimed once a poll has answered. */}
                  {serverStatus && (
                    <span className="event__practice">
                      <span className="livedot" aria-hidden="true" />
                      practice open now - warm up before kickoff
                    </span>
                  )}
                </p>

                <p
                  className="event__clock"
                  role="timer"
                  aria-label={`time until next session: ${clock.days} days ${clock.hours} hours ${clock.mins} minutes`}
                >
                  <ClockRow
                    groups={(
                      [
                        [clock.days, "days"],
                        [clock.hours, "hrs"],
                        [clock.mins, "min"],
                        [clock.secs, "sec"],
                      ] as [number, string][]
                    )
                      // the days group drops off on matchday for a tighter clock
                      .filter(([value, unit]) => !(unit === "days" && value === 0))}
                  />
                </p>
              </>
            )}
          </section>

          <main className="front">
            <section id="card" className="panel front__card" aria-label="Current Mode">
              <h2 className="panel__bar">Current Mode</h2>
              <div className="panel__body">
                {modeInfo ? (
                  <div className="card__mode">
                    <div className="card__hero">
                      <span className="card__emblem" aria-hidden="true">
                        <HeroEmblem />
                      </span>
                      <div className="card__herotext">
                        <p className="card__name">
                          {liveMode?.name ?? modeInfo.mode}
                          {liveMode?.fresh && <span className="newbadge">new</span>}
                          {liveMode?.tournament && <span className="matchbadge">5v5</span>}
                          {liveMode?.bots && <span className="botbadge">bots</span>}
                        </p>
                        {modeInfo.tagline && <p className="card__tagline">{modeInfo.tagline}</p>}
                      </div>
                    </div>
                    {modeInfo.bullets && modeInfo.bullets.length > 0 && (
                      <div className="card__rules">
                        <p className="card__ruleslabel">rules</p>
                        <ul className="card__rulelist">
                          {modeInfo.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="card__pending">reading the card from the server…</p>
                )}
              </div>
              {liveMode?.pool && (
                <>
                  <h3 className="card__subbar">
                    the map pool
                    <span className="card__subnote">
                      {liveMode.pool.length} map cycle (voting enabled)
                    </span>
                  </h3>
                  <ul className="pool">
                    {liveMode.pool.map((m) => {
                      const isOn = serverStatus?.map.toLowerCase() === m;
                      return (
                        <li className={`pool__tile${isOn ? " pool__tile--live" : ""}`} key={m}>
                          <MapShot map={m} />
                          <span className="pool__name">
                            {isOn && <span className="livedot" aria-hidden="true" />}
                            {m}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              <h3 className="card__subbar">
                more game modes
                <span className="card__subnote">changing mode requires reboot (~1min)</span>
              </h3>
              {/* the live mode already headlines the card, so its row sits out.
                  Each row unfolds into that mode's setup sheet - rules and map
                  pool in the same grammar as tonight's card above. */}
              <ul className="rotation">
                {MODES.filter((m) => m.key !== liveMode?.key).map((m) => {
                  const Emblem = m.emblem;
                  const open = openMode === m.key;
                  return (
                    <li
                      className={`rotation__item${open ? " rotation__item--open" : ""}`}
                      data-mode={m.key}
                      key={m.key}
                    >
                      <button
                        type="button"
                        className="rotation__row"
                        aria-expanded={open}
                        aria-controls={`mode-preview-${m.key}`}
                        onClick={() => setOpenMode(open ? null : m.key)}
                      >
                        <span className="rotation__emblem" aria-hidden="true">
                          <Emblem />
                        </span>
                        <span className="rotation__name">
                          {m.name}
                          {m.fresh && <span className="newbadge">new</span>}
                          {m.tournament && <span className="matchbadge">5v5</span>}
                          {m.bots && <span className="botbadge">bots</span>}
                        </span>
                        <span className="rotation__blurb">{m.blurb}</span>
                        <span className="rotation__caret" aria-hidden="true">
                          <svg
                            viewBox="0 0 40 40"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                          >
                            <path d="M15 11l10 9-10 9" />
                          </svg>
                        </span>
                      </button>
                      <div
                        className={`rotation__panel${open ? " rotation__panel--open" : ""}`}
                        id={`mode-preview-${m.key}`}
                        aria-hidden={!open}
                      >
                        <div className="rotation__clip">
                          <div className="rotation__preview">
                            <p className="card__ruleslabel">rules</p>
                            <ul className="card__rulelist">
                              {m.rules.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                            {m.pool && (
                              <>
                                <p className="card__ruleslabel rotation__poollabel">
                                  the map pool - {m.pool.length} maps
                                </p>
                                <ul className="pool pool--preview">
                                  {m.pool.map((map) => (
                                    <li className="pool__tile" key={map}>
                                      <MapShot map={map} />
                                      <span className="pool__name">{map}</span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section id="servers" className="panel front__servers" aria-label="server browser">
              <h2 className="panel__bar">
                server browser
                {clock.id === "countdown" && serverStatus && (
                  <span className="panel__barnote">open for practice</span>
                )}
              </h2>
              <div className="panel__body panel__body--flush">
                <table className="servers">
                  <thead>
                    <tr>
                      <th>server</th>
                      <th>map</th>
                      <th>players</th>
                      <th>timeleft</th>
                      <th>ping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serverStatus ? (
                      <tr
                        className="servers__row"
                        onDoubleClick={() => {
                          if (stage.id === "ready") play();
                        }}
                      >
                        <td className="servers__name">
                          <span className="livedot" aria-hidden="true" />
                          Frag Fridays #1 - Sydney &middot;{" "}
                          {clock.id === "live" ? "LIVE" : "PRACTICE"}
                        </td>
                        <td className="servers__map">{serverStatus.map}</td>
                        <td className="nowrap">
                          {serverStatus.humans}
                          {serverStatus.bots > 0 ? `+${serverStatus.bots} bots` : ""} /{" "}
                          {serverStatus.maxplayers}
                        </td>
                        <td className="nowrap">{timeleft(serverStatus)}</td>
                        <td className="nowrap">{ping !== null ? `${ping} ms` : "-"}</td>
                      </tr>
                    ) : (
                      <tr>
                        <td className="servers__scanning" colSpan={5}>
                          scanning for servers…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* who's on the box right now - humans only, bots are just a
                    count in the players column */}
                {humans.length > 0 && (
                  <p className="servers__foot servers__foot--roster">
                    {clock.id === "live" ? "in game right now" : "warming up now"}:{" "}
                    {humans.map((p, i) => (
                      <Fragment key={p.name}>
                        {i > 0 && ", "}
                        <strong>{p.name}</strong>
                      </Fragment>
                    ))}
                  </p>
                )}

                <div className="browser__lower">
                  {(stage.id === "checking" ||
                    stage.id === "downloading" ||
                    stage.id === "ready") && (
                    <div className={`browser__strip${nameNeeded ? " browser__strip--needed" : ""}`}>
                      <label className="browser__striplabel" htmlFor="alias">
                        your alias:
                      </label>
                      <input
                        id="alias"
                        ref={aliasRef}
                        className="browser__stripinput"
                        value={name}
                        onChange={(e) => {
                          setNameNeeded(false);
                          setName(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && stage.id === "ready") play();
                        }}
                        placeholder="Player"
                        maxLength={31}
                        spellCheck={false}
                        aria-invalid={nameNeeded || undefined}
                      />
                      {/* ignites once, when the download lands; retry and
                          reconnect below stay flat - recovery isn't a show */}
                      {stage.id === "ready" && (
                        <button className="join join--ignite join--strip" onClick={play}>
                          » {clock.id === "live" ? "join live" : "warm up"} «
                        </button>
                      )}
                    </div>
                  )}
                  {nameNeeded && (
                    <span className="alias__needed" role="alert">
                      pick an alias first
                    </span>
                  )}
                  <div className="browser__action">
                    {stage.id === "error" ? (
                      <>
                        <p className="status status--error">{stageLabel(stage)}</p>
                        <button className="join" onClick={() => location.reload()}>
                          retry download
                        </button>
                      </>
                    ) : stage.id === "dropped" ? (
                      <>
                        {/* kill-feed red is for things that went wrong; leaving
                            on purpose is not one of them */}
                        <p className={stage.kind === "quit" ? "status" : "status status--error"}>
                          {stageLabel(stage)}
                        </p>
                        {/* same button either way (the engine is gone, so it is
                            a fresh boot), but nobody who typed `exit` lost a
                            connection - they are going back in, not recovering */}
                        <button className="join" onClick={reconnect}>
                          {stage.kind === "quit" ? "rejoin" : "reconnect"}
                        </button>
                      </>
                    ) : stage.id === "crashed" ? (
                      <>
                        <p className="status status--error">{stageLabel(stage)}</p>
                        {/* the engine is gone - only a fresh boot gets back in,
                            and the zip comes off Cache Storage so it is quick */}
                        <button className="join" onClick={() => location.reload()}>
                          reload
                        </button>
                      </>
                    ) : stage.id === "ready" || stage.id === "checking" ? (
                      // nothing to measure yet, so nothing that looks like it
                      <p className="status">{stageLabel(stage)}</p>
                    ) : (
                      <>
                        <div
                          className={`bar${progress === null ? " bar--indeterminate" : ""}`}
                          role="progressbar"
                          aria-label="downloading valve.zip"
                          aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
                        >
                          {Array.from({ length: SEGMENTS }, (_, i) => (
                            <span key={i} className={i < filled ? "seg seg--on" : "seg"} />
                          ))}
                        </div>
                        <p className="status">{stageLabel(stage)}</p>
                      </>
                    )}
                  </div>
                </div>

                {topFrag && (
                  <p className="servers__foot">
                    {clock.id === "live" ? "top frag right now" : "top frag in warm-up"}:{" "}
                    <strong>{topFrag.name}</strong> ({topFrag.frags})
                  </p>
                )}
              </div>
            </section>

            <SettingsPanel />

            {/* the league table only exists once standings.json has answered -
                the page never invents results */}
            {standings && (
              <section
                id="standings"
                className="panel front__standings"
                aria-label="season standings"
              >
                <h2 className="panel__bar">
                  season standings
                  <span className="panel__barnote">humans only - bots never rank</span>
                </h2>
                <div className="panel__body panel__body--flush">
                  {standings.season.length > 0 ? (
                    <>
                      <table className="standings standings--season">
                        <thead>
                          <tr>
                            <th className="standings__num">#</th>
                            <th>player</th>
                            <th className="standings__num">sessions</th>
                            <th className="standings__num">k / d</th>
                            <th className="standings__num">k/d %</th>
                            <th className="standings__num">plants</th>
                            <th className="standings__num">time</th>
                            <th className="standings__num">mvps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.season.slice(0, SEASON_ROWS).map((p, i) => {
                            const mvps = standings.weeks.filter((w) => w.mvp === p.name).length;
                            return (
                              <tr key={p.name}>
                                <td className="standings__num standings__rank">{rankLabel(i)}</td>
                                <td className="standings__player">{p.name}</td>
                                <td className="standings__num">{p.sessions}</td>
                                <td className="standings__num">
                                  {p.kills} / {p.deaths}
                                </td>
                                <td className="standings__num">{kdPct(p.kills, p.deaths)}</td>
                                <td className="standings__num">{p.plants ? p.plants : "-"}</td>
                                <td className="standings__num">
                                  {p.time !== undefined ? playTime(p.time) : "-"}
                                </td>
                                <td className="standings__num">{mvps > 0 ? mvps : "-"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {played.length > 0 && (
                        <p className="standings__foot">
                          {played.length} {played.length === 1 ? "session" : "sessions"} played
                          &middot; last mvp: <strong>{played[played.length - 1].mvp}</strong> (
                          {played[played.length - 1].kills} kills,{" "}
                          {sessionDateLabel(played[played.length - 1].date)})
                        </p>
                      )}
                      {/* week by week, newest first, each week folded so the
                          season table keeps the stage. A Friday with nothing
                          in the logs keeps its row so the gap is stated, not
                          hidden; a partial week says what's missing */}
                      {standings.weeks
                        .map((w, i) => ({ ...w, n: i + 1 }))
                        .reverse()
                        .map((w) => {
                          const hasTable = !!w.players && w.players.length > 0;
                          return (
                            <details key={w.date} className="week">
                              <summary className={`card__subbar week__bar${hasTable ? "" : " week__bar--empty"}`}>
                                <span>
                                  week {w.n} &middot; {sessionDateLabel(w.date)}
                                </span>
                                <span className="card__subnote">
                                  {w.mvp
                                    ? `mvp ${w.mvp} (${w.kills} kills)`
                                    : (w.note ?? "no stats recorded")}
                                </span>
                              </summary>
                              {hasTable && (
                                <table className="standings standings--week">
                                  <PlayerRows players={w.players!} />
                                </table>
                              )}
                              {w.mvp && w.note && <p className="standings__foot">{w.note}</p>}
                            </details>
                          );
                        })}
                    </>
                  ) : (
                    <p className="standings__none">
                      no ranked results yet - the table publishes after the first friday session
                    </p>
                  )}
                </div>
              </section>
            )}

            <aside className="front__aside">
              <section id="demos" className="panel" aria-label="now streaming">
                <h2 className="panel__bar panel__bar--player">
                  <span className="panel__file">frag_movies.m3u</span>
                </h2>
                {!videoDead && stage.id !== "playing" ? (
                  <div className="player">
                    <iframe
                      ref={iframeRef}
                      className="player__vid"
                      src={`${VIDEO_SHIM}/?list=${PLAYLIST_ID}`}
                      allow="autoplay; encrypted-media; fullscreen"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                      title="frag movies"
                    />
                  </div>
                ) : (
                  <div className="player player--dead">
                    <p>stream offline.</p>
                  </div>
                )}
              </section>

              <section className="panel" aria-label="server hardware">
                <h2 className="panel__bar">
                  server hardware
                  {/* only claimed once a status poll has actually answered - the
                      page never says "online" about a box it hasn't heard from */}
                  {serverStatus && (
                    <span className="panel__online">
                      <span className="livedot livedot--blip" key={pollTick} aria-hidden="true" />
                      server online
                    </span>
                  )}
                </h2>
                <div className="panel__body">
                  <div className="specs__figure">
                    <img
                      className="specs__photo"
                      src="/assets/server-hardware.jpg"
                      alt="The actual server: a dusty Compaq ProLiant tower labelled CS 1.6 SERVER"
                      loading="lazy"
                    />
                    {/* early-2000s product-ad sticker; decorative, the facts are in the table */}
                    <span className="specs__burst" aria-hidden="true">
                      <span className="specs__burst-new">new!</span>
                      <span className="specs__burst-sub">2× spec</span>
                    </span>
                  </div>
                  <dl className="specs">
                    {SERVER_SPECS.map(({ label, value, was }) => (
                      <div className={was ? "specs__row specs__row--up" : "specs__row"} key={label}>
                        <dt>{label}</dt>
                        <dd>
                          {was ? (
                            <>
                              <s className="specs__was">{was}</s>
                              <span className="specs__arrow" aria-hidden="true">
                                →
                              </span>
                              <span className="specs__now">{value}</span>
                            </>
                          ) : (
                            value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="specs__note">
                    <span className="specs__flag">upgraded</span>
                    resized {SERVER_UPGRADED_ON} - double the cores, ram and disk.
                  </p>
                </div>
              </section>
            </aside>
          </main>

          <section className="panel news" aria-label="Server news">
            <h2 className="panel__bar">
              Server News
              <span className="panel__barnote">worked on between fridays</span>
            </h2>
            <div className="panel__body news__body">
              {NEWS.map((entry) => (
                <div className="news__entry" key={entry.label}>
                  <p className="card__ruleslabel">{entry.label}</p>
                  <ul className="card__rulelist news__list">
                    {entry.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <footer className="footer">
            <p>© 2026 frag fridays &middot; best viewed at 1024×768</p>
            <p className="footer__counter" aria-hidden="true">
              you are visitor{" "}
              {["0", "0", "1", "3", "3", "7"].map((d, i) => (
                <span className="footer__digit" key={i}>
                  {d}
                </span>
              ))}
            </p>
          </footer>
        </div>
      </div>
      {/* how long the Friday session has left, over the game, for as long as
          Tab is held. The page's own clock is behind the canvas once you are
          playing, and mid-match the only thing anyone wants from it is this
          number - so it rides in on the scoreboard key and leaves with it, at
          the top of the screen, clear of the 1.6 HUD (which keeps to the
          corners and the bottom). Outside .overlay because that is hidden
          while playing. */}
      {playing && tabHeld && slotClock && (
        <div
          // the last five minutes and the last minute read the same whether
          // they are the end of the session or the wait for its start
          className={`slotclock${clock.msLeft < 300_000 ? " slotclock--last" : ""}${
            clock.msLeft < 60_000 ? " slotclock--final" : ""
          }`}
          data-mode={themeMode}
          role="timer"
          aria-label={slotClock.aria}
        >
          <span className="slotclock__label" aria-hidden="true">
            {slotClock.lead}
          </span>
          <span className="slotclock__time" aria-hidden="true">
            {slotClock.time}
          </span>
          {slotClock.tail && (
            <span className="slotclock__label" aria-hidden="true">
              {slotClock.tail}
            </span>
          )}
        </div>
      )}
      {/* Carrying over into a new map. Two states, and the split matters: a
          healthy carry-over is a second or two, so it gets a banner that never
          covers the game or takes the pointer; one that has stopped being
          loading gets the full sheet, because at that point there is nothing
          to play behind it and there IS something to press. Both outside
          .overlay - that is hidden while playing - and both stand down for the
          match menu, which the player opened on purpose. */}
      {loadingMap && !loadingStuck && (
        <div className="mapload" role="status" aria-live="polite">
          <span className="mapload__label">loading</span>
          <span className="mapload__map">{loadingMap}</span>
          <span className="mapload__label">you keep your slot</span>
        </div>
      )}
      {loadingMap && loadingStuck && (
        <div
          className="pause"
          data-mode={themeMode}
          role="dialog"
          aria-modal="true"
          aria-label="Map change stuck"
        >
          <div className="pause__card">
            <p className="pause__title">still loading</p>
            <p className="pause__mapname">{loadingMap}</p>
            {/* Which of the two it is, said plainly, because the fix differs:
                a frozen server needs someone to restart it and nothing the
                player does will help, while a live server the player has not
                rejoined is fixed by going back and coming in again. The page
                can tell them apart - status.json either keeps moving or it
                does not - so it should not fudge them into one message. */}
            {loadingFrozen ? (
              <p className="pause__note">
                the server has stopped answering - it is not going to finish loading until someone
                restarts it. nothing here is your end.
              </p>
            ) : (
              <p className="pause__note">
                the map is up and the server is running, but your game has not come back from the
                change. rejoining reloads the page and hands your slot back.
              </p>
            )}
            <button className="join pause__resume" onClick={leaveMatch} autoFocus>
              {loadingFrozen ? "back to the lobby" : "rejoin"}
            </button>
          </div>
        </div>
      )}
      {/* The scoreboard. Ours, not the engine's - launchGame unbinds TAB, so
          +showscores never fires and this is the only board in the build. Same
          key, same moment, laid out in CSS so it holds at any resolution. */}
      {((playing && tabHeld) || DEBUG_TAB !== null) && (
        <TabScreen
          status={serverStatus}
          info={modeInfo}
          modeName={modeName}
          themeMode={themeMode}
          classic={classicBoard}
          you={name}
          mapLeft={mapClock}
          // In the ?tab= QA view there is no engine to sell anything, but the
          // pad is a whole row of the panel and changes what fits above it, so
          // it has to be there to lay the screen out against. Its buttons then
          // report the dead console they honestly have.
          onBuy={playing ? buy : DEBUG_TAB !== null ? () => false : undefined}
        />
      )}
      {playing && paused && (
        <div
          className="pause"
          data-mode={themeMode}
          role="dialog"
          aria-modal="true"
          aria-label="Match menu"
        >
          <div className="pause__card">
            <p className="pause__title">match menu</p>
            <p className="pause__note">
              the round is still running - you are still in the server
            </p>
            <button className="join pause__resume" onClick={resume} autoFocus>
              resume
            </button>
            <button className="pause__leave" onClick={leaveMatch}>
              leave server
            </button>
            {keys.length > 0 && (
              <div className="keymap">
                <p className="keymap__title">your controls</p>
                <dl className="keymap__list">
                  {keys.map((row) => (
                    <div className="keymap__row" key={row.label}>
                      <dt className="keymap__keys">
                        {row.keys.map((k, i) => (
                          <kbd className="key" key={`${k}-${i}`}>
                            {k}
                          </kbd>
                        ))}
                      </dt>
                      <dd className="keymap__label">{row.label}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default App;
