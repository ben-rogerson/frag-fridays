// The tab screen: our own scoreboard, drawn over the canvas while Tab is held.
//
// Why it is here and not in an AMXX plugin. The engine's own vgui-less
// scoreboard scales its TEXT with hud_fontscale but lays its ROWS out at fixed
// unscaled spacing, so anything above hud_fontscale 1 overlaps them - the
// caveat the settings panel used to carry. Nothing server-side fixes that: a
// plugin can only reach the HUD through hudmessage/DHUD, whose one and only
// layout primitive is "put this string at this fraction of the screen", which
// is worse at resolution independence than the thing being replaced, not
// better. Drawn in the page it is ordinary CSS: one fluid type unit (--tsu),
// every measurement in em off it, so rows and glyphs scale together by
// construction and the layout is correct at any window size.
//
// The engine's scoreboard is not drawn over, it is switched off: launchGame
// unbinds TAB, so +showscores never fires and this is the only scoreboard in
// the build. The page reads the key itself (see tabHeld in App.tsx).
//
// Data comes from /status.json, the same feed the loading screen polls, which
// statusjson.amxx now writes every second with deaths, team and ping.
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import { loadoutsFor, type Loadout } from "./buy";
import "./tabscreen.css";

// each mod's compose mounts its own /info.json next to the client
export type ModeInfo = { mode: string; tagline?: string; bullets?: string[] };

// written every second by the statusjson.amxx plugin into the served public/
// dir. deaths/team/ping are optional on the way in: a box still running the
// old plugin answers without them and the scoreboard just prints dashes
// rather than nothing at all.
export type ServerStatus = {
  map: string;
  maxplayers: number;
  humans: number;
  bots: number;
  mapTimeLeft: number; // seconds; 0 = no timelimit
  roundTimeLeft: number; // seconds; -1 = no live round timer (none yet, or expired with no new round)
  players: {
    name: string;
    frags: number;
    bot: boolean;
    deaths?: number;
    team?: number; // 1 = T, 2 = CT, 3 = spectator, 0 = still picking
    ping?: number;
  }[];
};

type Row = ServerStatus["players"][number];

const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

// Kills first, then fewest deaths, then alphabetical - 1.6's own order, and
// the only one that makes a combined non-classic list mean anything. Names
// break the tie so a table of tied bots stops reshuffling on every poll.
const byScore = (a: Row, b: Row) =>
  b.frags - a.frags ||
  (a.deaths ?? 0) - (b.deaths ?? 0) ||
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

// Alias match is loose on purpose: the engine trims and mangles names on the
// way to the server (leading spaces, duplicates get a suffix), and getting the
// highlight wrong costs nothing while missing it entirely is the common case.
const isYou = (row: Row, you: string) =>
  !row.bot && !!you && row.name.trim().toLowerCase() === you.trim().toLowerCase();

// The side tag for a row of the combined list. team 0 is a real value, not a
// gap - it is "connected, still on the join screen", which the whole server
// reads as during warm-up - and so is a row from a box whose plugin sends no
// team for that player. Both are "no side yet", and the board already spells
// that "-" in the deaths and ping columns, so it spells it that way here too.
const sideTag = (p: Row) => {
  const side = p.team === 1 ? "t" : p.team === 2 ? "ct" : null;
  return (
    <div className={`tabscreen__tag${side ? ` tabscreen__tag--${side}` : ""}`}>{side ?? "-"}</div>
  );
};

// How long a clicked button stays lit. Long enough to register as a response,
// short enough that a player buying gun then armour does not see the first
// button still glowing and wonder whether the second one went.
const FLASH_MS = 900;

// The buy pad. One click per loadout, each one a short chain of console
// commands sent straight down the player's own connection (see buy.ts).
//
// Deliberately stateless for now: it does not know your money, whether you
// are alive, or whether the buy window is still open, because none of that is
// on the wire yet - status.json carries no per-player money or buyzone. The
// server refuses what you cannot afford or are not allowed, silently, exactly
// as it does when you mistype in the console. So a button here means "ask",
// not "you got it", and the flash says the ask was sent, nothing more. That
// is an honest thing to show and it is most of the value: the beginner's
// problem is not knowing they can afford an AK, it is not finding one.
//
// When money and buyzone do land in the feed, the greying and the countdown
// hang off this component without moving it.
const BuyPad: FC<{
  team: number | undefined;
  onBuy: (cmds: string[]) => boolean;
  padRef: React.Ref<HTMLDivElement>;
}> = ({ team, onBuy, padRef }) => {
  // id of the loadout last clicked, and whether the console took it
  const [flash, setFlash] = useState<{ id: string; ok: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const click = (l: Loadout) => {
    const ok = onBuy(l.cmds);
    setFlash({ id: l.id, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  const kits = loadoutsFor(team);

  return (
    <div className="tabscreen__buy" ref={padRef}>
      <div className="tabscreen__buyhead">
        <span>buy</span>
        <span className="tabscreen__buyhint">click while holding tab</span>
      </div>
      <div className="tabscreen__kits">
        {kits.map((l) => {
          const lit = flash?.id === l.id;
          return (
            <button
              type="button"
              key={l.id}
              className={`tabscreen__kit${lit ? (flash.ok ? " is-sent" : " is-dead") : ""}`}
              // Pointer, not click: the engine is still running underneath and
              // the sooner this leaves the browser the better. onPointerDown
              // also sidesteps the focus ring a real click would leave on a
              // button inside an overlay that vanishes on keyup.
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                click(l);
              }}
            >
              <span className="tabscreen__kitname">{l.label}</span>
              <span className="tabscreen__kitdetail">{lit ? (flash.ok ? "sent" : "no link") : l.detail}</span>
              <span className="tabscreen__kitprice">${l.price}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const PAGES = ["scoreboard", "briefing"] as const;

// One wheel notch on a mouse is 100+ deltaY; a trackpad flick is a spray of
// 1-10s. Accumulating to a threshold makes both feel like one page turn.
const WHEEL_STEP = 40;

export type TabScreenProps = {
  status: ServerStatus | null;
  info: ModeInfo | null;
  /** roster name for the live mod, e.g. "GunGame" */
  modeName: string;
  /** data-mode key, so the panel wears the mode's signal colour */
  themeMode: string;
  /** the Classic-family modes split into two teams; every other mode is one list by kills */
  classic: boolean;
  /** the player's own alias, for the highlighted row */
  you: string;
  /** map time remaining, ticked locally by App between polls */
  mapLeft: number | null;
  /** Send a loadout's console commands. Returns false when the console was
   *  not safe to touch, which the pad shows rather than hides. Absent in the
   *  ?tab= QA view, where there is no engine and the pad is not drawn. */
  onBuy?: (cmds: string[]) => boolean;
};

export const TabScreen: FC<TabScreenProps> = ({
  status,
  info,
  modeName,
  themeMode,
  classic,
  you,
  mapLeft,
  onBuy,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const briefRef = useRef<HTMLDivElement>(null);
  // false = board and briefing stack in one screen; true = they are two pages
  // and the wheel turns between them
  const [paged, setPaged] = useState(false);
  const [page, setPage] = useState(0);
  // px height the pages area is pinned to once it IS paged, so turning a page
  // does not resize the panel under the player's eyes. Without it the box
  // snaps to whichever page is showing and the two read as separate popups
  // rather than two pages of one screen.
  const [pageH, setPageH] = useState<number | null>(null);

  const players = (status?.players ?? []).filter((p) => (p.team ?? 1) !== 3);
  const spectators = (status?.players ?? []).filter((p) => p.team === 3);
  // Your own side, for picking which rifle the pad offers. Same loose name
  // match as the row highlight, and the same reasoning applies: getting it
  // wrong offers a T an M4 (which the server refuses, harmlessly), while
  // insisting on certainty would leave the pad blank for everyone during the
  // seconds after joining when it is most wanted. undefined means "no side
  // known", which loadoutsFor answers with the side-neutral kits.
  const yourTeam = (status?.players ?? []).find((p) => isYou(p, you))?.team;
  // Spectators get no pad: there is no side to buy for and the server would
  // refuse every one of these. Its presence changes the fit, so the measure
  // below depends on it.
  const hasPad = Boolean(onBuy) && yourTeam !== 3;
  const bullets = info?.bullets ?? [];
  const hasBrief = Boolean(info?.tagline || bullets.length);
  // A box still running the pre-0.2.0 statusjson sends no team at all. Falling
  // back to the combined list there beats a team split that would pile every
  // player onto one side and leave the other reading "no players".
  const hasTeams = players.some((p) => p.team !== undefined);
  const splitTeams = classic && hasTeams;
  // The combined list is one ranking by kills and stays that way, but in a
  // deathmatch-family mode the side still decides who you are shooting - and
  // with mp_autoteambalance off in dm it is not even a safe guess from the
  // ordering. So each row carries a side tag. Same fallback as above: no team
  // data anywhere means the column is not drawn at all, rather than a stripe
  // of dashes down a board that never had sides to begin with.
  const sideTags = !splitTeams && hasTeams;
  // the classic board splits by side, so a player who has not got one belongs to neither
  // block - and used to fall through both and vanish off the board completely.
  // That is not a rare state: team 0 is "connected, still on the join screen",
  // which is what everybody looks like for the first seconds after joining and
  // therefore most of warm-up, which is exactly when people hold Tab to see
  // who has turned up. On the mode whose board is the match record, a player
  // silently missing is the worst possible failure.
  //
  // They get a line rather than a third block. A block would need a side band
  // and a team total, and both would say they are a team when the whole point
  // is that they have not picked one; they also have no score worth a column
  // yet, having not started. So: the same furniture as the spectators line
  // directly under it, which is already the board's way of saying "on the
  // server, not in a side right now". Only for the split shape - the combined
  // list already ranks everybody.
  const joining = splitTeams ? players.filter((p) => p.team !== 1 && p.team !== 2) : [];

  // Does the briefing fit under the board, or does it need its own page?
  //
  // Measured against the frame (viewport minus its padding), never against the
  // panel: the panel's height depends on `paged`, so measuring it would feed
  // the answer back into the question and oscillate. Both pages stay mounted
  // in every state - the inactive one goes absolute+hidden, which keeps its
  // height readable - so the numbers below mean the same thing either way.
  useLayoutEffect(() => {
    if (!hasBrief) {
      setPaged(false);
      setPageH(null);
      return;
    }
    const measure = () => {
      const frame = frameRef.current;
      const board = boardRef.current;
      const brief = briefRef.current;
      if (!frame || !board || !brief) return;
      // the strip only exists when paged, so it is allowed for rather than
      // measured - 3em covers its own height plus the gap under it. The
      // panel's border and padding are the other 1.5em.
      const em = parseFloat(getComputedStyle(frame).fontSize) || 14;
      // The buy pad hangs below the pages and is not part of either, so its
      // height is chrome as far as the fit is concerned. Measured rather than
      // allowed for: it is one row of buttons on a wide panel and two on a
      // narrow one, so a constant here would overflow the panel at exactly
      // the sizes where there is least room to spare.
      const chrome =
        (barRef.current?.offsetHeight ?? 0) + (padRef.current?.offsetHeight ?? 0) + 4.5 * em;
      const avail = frame.clientHeight;
      const need = chrome + board.offsetHeight + brief.offsetHeight;
      // Hysteresis, and it is load-bearing: the two states dress the briefing
      // differently (a divider appears when it is stacked, a heading when it
      // is a page), so the same content measures a line or two apart in each.
      // Without a dead band, a window sized exactly on the boundary would page
      // and un-page forever.
      setPaged((was) => (was ? need + 3 * em > avail : need > avail));
      // the taller page wins the height, never more than there is room for
      setPageH(Math.min(Math.max(board.offsetHeight, brief.offsetHeight), avail - chrome));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (padRef.current) ro.observe(padRef.current);
    if (boardRef.current) ro.observe(boardRef.current);
    if (briefRef.current) ro.observe(briefRef.current);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, [hasBrief, hasPad]);

  // a screen that stopped having two pages must not be left showing page two
  useEffect(() => {
    if (!paged) setPage(0);
  }, [paged]);

  // Wheel turns the page. mwheelup/mwheeldown are unbound in userconfig.cfg
  // (stock invnext/invprev caused accidental weapon switches), so nothing in
  // the game wants this event and taking it costs the player nothing.
  useEffect(() => {
    if (!paged) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      // over the lobby (the ?tab= QA view) this would scroll the page behind
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < WHEEL_STEP) return;
      const dir = acc > 0 ? 1 : -1;
      acc = 0;
      setPage((p) => Math.min(PAGES.length - 1, Math.max(0, p + dir)));
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [paged]);

  const teamRows = (team: number) => players.filter((p) => p.team === team).sort(byScore);
  const teamScore = (rows: Row[]) => rows.reduce((n, p) => n + p.frags, 0);

  // The band doubles as the column header, the way 1.6's own does: the side
  // (or "players") and its score on the left, k/d/ping over the columns they
  // label. Band and rows are separate grids sharing one --cols template, so
  // the ranked and unranked shapes stay aligned without a table layout.
  const band = (label: string, score: number, ranked: boolean) => (
    <div className="tabscreen__band">
      {ranked && <div className="tabscreen__rank" />}
      {/* the side column needs no heading - the tags say what they are */}
      {ranked && sideTags && <div />}
      <div className="tabscreen__side">
        {label} <strong>{score}</strong>
      </div>
      <div className="tabscreen__num">k</div>
      <div className="tabscreen__num">d</div>
      <div className="tabscreen__num tabscreen__num--ping">ping</div>
    </div>
  );

  const row = (p: Row, rank?: number) => (
    <div
      className={`tabscreen__row${isYou(p, you) ? " tabscreen__row--you" : ""}${
        p.bot ? " tabscreen__row--bot" : ""
      }`}
      key={`${p.name}-${rank ?? ""}`}
    >
      {rank !== undefined && <div className="tabscreen__rank">{rank}</div>}
      {rank !== undefined && sideTags && sideTag(p)}
      <div className="tabscreen__name">{p.name}</div>
      <div className="tabscreen__num">{p.frags}</div>
      <div className="tabscreen__num">{p.deaths ?? "-"}</div>
      {/* 1.6 prints BOT where a bot's ping would go; so do we */}
      <div className="tabscreen__num tabscreen__num--ping">
        {p.bot ? "bot" : (p.ping ?? "-")}
      </div>
    </div>
  );

  const teamBlock = (team: 1 | 2, label: string, side: "t" | "ct") => {
    const rows = teamRows(team);
    return (
      <div className={`tabscreen__team tabscreen__team--${side}`}>
        {band(label, teamScore(rows), false)}
        {rows.length ? (
          rows.map((p) => row(p))
        ) : (
          <div className="tabscreen__empty">no players</div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`tabscreen${paged ? " tabscreen--paged" : ""}`}
      data-mode={themeMode}
      role="region"
      aria-label="scoreboard"
    >
      <div className="tabscreen__frame" ref={frameRef}>
        <div className="tabscreen__panel">
          <div className="panel__bar tabscreen__bar" ref={barRef}>
            <span className="tabscreen__title">{modeName}</span>
            <span className="tabscreen__map">{status?.map ?? "-"}</span>
            <span className="tabscreen__clocks">
              {status && status.roundTimeLeft >= 0 && (
                <span className="tabscreen__clock">
                  round <strong>{clock(status.roundTimeLeft)}</strong>
                </span>
              )}
              {mapLeft !== null && (
                <span className="tabscreen__clock">
                  map <strong>{clock(mapLeft)}</strong>
                </span>
              )}
            </span>
          </div>

          {paged && (
            <div className="tabscreen__strip">
              {PAGES.map((label, i) => (
                <span
                  className={`tabscreen__tab${i === page ? " tabscreen__tab--on" : ""}`}
                  key={label}
                >
                  {label}
                </span>
              ))}
              <span className="tabscreen__hint">scroll to change</span>
            </div>
          )}

          <div
            className="tabscreen__pages"
            style={paged && pageH ? { minHeight: `${Math.round(pageH)}px` } : undefined}
          >
            {/* both pages stay mounted in both states - see the measure above */}
            <div className="tabscreen__page" data-on={!paged || page === 0} ref={boardRef}>
              {splitTeams ? (
                <>
                  {teamBlock(2, "counter-terrorists", "ct")}
                  {teamBlock(1, "terrorists", "t")}
                </>
              ) : (
                <div
                  className={`tabscreen__team tabscreen__team--all${
                    sideTags ? " tabscreen__team--sides" : ""
                  }`}
                >
                  {band("players", players.length, true)}
                  {players.length ? (
                    [...players].sort(byScore).map((p, i) => row(p, i + 1))
                  ) : (
                    <div className="tabscreen__empty">no players</div>
                  )}
                </div>
              )}
              {joining.length > 0 && (
                <p className="tabscreen__specs">
                  joining: {joining.map((p) => p.name).join(", ")}
                </p>
              )}
              {spectators.length > 0 && (
                <p className="tabscreen__specs">
                  spectating: {spectators.map((p) => p.name).join(", ")}
                </p>
              )}
            </div>

            <div className="tabscreen__page" data-on={!paged || page === 1} ref={briefRef}>
              {hasBrief && (
                <div className="tabscreen__brief">
                  <p className="tabscreen__briefhead">{modeName}</p>
                  {info?.tagline && <p className="tabscreen__tagline">{info.tagline}</p>}
                  {bullets.length > 0 && (
                    <ul className="tabscreen__rules">
                      {bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Outside the pages, so turning to the briefing does not take the
              guns away - the pad is the reason a beginner opened this screen
              and it should never be a page they have to find. Spectators get
              nothing to click: there is no side to buy for and the server
              would refuse every one of these. */}
          {hasPad && <BuyPad team={yourTeam} onBuy={onBuy!} padRef={padRef} />}
        </div>
      </div>
    </div>
  );
};
