// The war room: the hidden control panel behind /#/warroom.
//
// It exists because the useful moment to fix a session is mid-session, on a
// phone, from the couch - not in an SSH window. Everything here maps to a real
// server action (server/mcp/src/admin.js): the pipe, YaPB's quota, docker
// compose. The panel never guesses - it paints /admin-api/state, which is the
// live status.json plus the container the box can actually see.
//
// Auth is one token, kept in localStorage and sent as x-ff-admin. There is no
// session, no cookie and no account: losing the token is the whole recovery
// story, and rotating it is an edit to /opt/cs16/mcp.env.
//
// Chrome is the matchday page's, one shade harder: this is the back of house,
// so panels are tighter, actions are labelled by what they do to players, and
// anything that drops the server has to be armed before it fires.
import { FC, useCallback, useEffect, useRef, useState } from "react";
import "@fontsource/black-ops-one";
import "./App.css";
import "./admin.css";

const TOKEN_KEY = "ff-admin-token";

type Player = { name: string; frags: number; bot: boolean };
type Status = {
  map: string;
  maxplayers: number;
  humans: number;
  bots: number;
  mapTimeLeft: number;
  roundTimeLeft: number;
  players: Player[];
};
type Job = {
  kind: string;
  detail: string | null;
  startedAt: number;
  finishedAt: number | null;
  ok: boolean | null;
  message: string | null;
};
// web/assets/session.json, the file the front page's countdown reads.
// `scheduled` is only there once the war room has moved the kickoff: it holds
// the time to put back (null where there was no file to start with).
type Session = {
  date: string;
  hour: number;
  minute: number;
  end?: string;
  scheduled?: { hour: number; minute: number; end: string | null } | null;
};
type State = {
  container: string;
  ps: string;
  mod: string;
  pipe: boolean;
  mode: string | null;
  status: Status | null;
  // age of status.json, written every 5s from a server frame. Frozen = the sim
  // has stopped, and every number in `status` is a photograph of when it did.
  // null where the box sent no Last-Modified: unknown, not fresh.
  statusAgeMs: number | null;
  statusStale: boolean;
  maps: string[];
  mods: string[];
  job: Job | null;
  session: Session | null;
};

// mod key -> what it is called on the site, so the panel and the front page
// name the same thing (App.tsx MODES, keyed by info.json instead)
const MOD_LABEL: Record<string, string> = {
  classical: "ClassicAl",
  cpl: "CPL Tournament",
  gg: "GunGame",
  dm: "Deathmatch",
  aim: "Aim Prac",
  css: "Source Maps",
  fy: "Fight Yard",
  awp: "Sniper",
};

// mods whose image bakes teambalance.amxx in - the Teams panel is dead
// weight anywhere else (mirrors TEAM_MODS in server/mcp/src/actions.js)
const TEAM_MODS = ["gg", "dm", "css", "fy", "awp", "classical"];

// Slots the bot fill leaves alone, mirroring yb_autovacate_keep_slots in every
// mod's yapb.cfg.
//
// Be honest about what this does and does not buy. It reserves room against
// players the server can SEE, which keeps an ordinary near-full night from
// having no room for one more person. It does NOT protect against the
// 2026-09-04 lockout: clients stalled mid-map-change hold engine slots that
// YaPB does not count, so the quota expands past this reserve into whatever
// they are not already holding (measured - see docs/troubleshooting.md). The
// guard for that is yb_join_delay plus changeMap clearing the bots outright.
//
// It is still worth setting, and worth setting HERE as well as in yapb.cfg:
// any non-zero yb_quota survives a changelevel (yb_ignore_cvars_on_changelevel,
// verified 2026-09-04), so a quota pushed to the ceiling once stays there until
// the container restarts. The panel is the only place that can be stopped.
// 4 on the 16-slot modes, 2 on CPL Tournament's 12, mirroring their yapb.cfg
// files. The same number would be the wrong number: CPL's slot count IS its
// format (10 for the teams plus 2 spare), so reserving 4 there would cap a
// warm-up fill at 8 and make filling a 5v5 quietly impossible.
const botReserveFor = (maxplayers: number) => (maxplayers >= 16 ? 4 : 2);
// 16 is also the API's own ceiling for a fill (server/mcp/src/admin.js), so a
// bigger server never lets the panel ask for something that would be refused
const botCapOf = (maxplayers: number | undefined) => {
  const slots = maxplayers ?? 16;
  return Math.min(16, Math.max(1, slots - botReserveFor(slots)));
};

class AuthError extends Error {}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// the front page's own way of writing a kickoff: "1.30 pm", "2 pm"
const timeLabel = (hour: number, minute: number) =>
  `${hour % 12 || 12}${minute ? `.${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "am" : "pm"}`;

// session.json writes the slot's end as "15:00"; say it the same way as the
// kickoff so a panel line never reads in two clocks at once
const endLabel = (end: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(end ?? "");
  return m ? timeLabel(Number(m[1]), Number(m[2])) : null;
};

// YaPB names its bots "[BOT] Ivan"; the row already carries a bot chip, so the
// prefix is noise here. The real name is what gets sent to the console.
const botName = (p: Player) => p.name.replace(/^\[BOT\]\s*/, "");

function useToken() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const save = (t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(t);
  };
  return [token, save] as const;
}

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/admin-api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-ff-admin": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw new AuthError(data?.error ?? "Bad admin token");
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

/* --- the gate ---------------------------------------------------------- */

const Gate: FC<{ onToken: (t: string) => void }> = ({ onToken }) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await call(token, "/whoami");
      onToken(token);
    } catch (err) {
      setError(err instanceof AuthError ? "That token is not it." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="war war--gate">
      <form className="panel gate" onSubmit={submit}>
        <div className="panel__bar">
          <span>Server control</span>
          <span className="panel__barnote">authorised only</span>
        </div>
        <div className="panel__body gate__body">
          <label className="gate__label" htmlFor="ff-token">
            Admin token
          </label>
          <input
            id="ff-token"
            className="war__input"
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="paste it"
          />
          <button className="join join--war" type="submit" disabled={busy || !value.trim()}>
            {busy ? "Checking..." : "Unlock"}
          </button>
          {error && <p className="war__error">{error}</p>}
        </div>
      </form>
    </div>
  );
};

/* --- shared bits ------------------------------------------------------- */

const Panel: FC<{ title: string; note?: string; children: React.ReactNode }> = ({
  title,
  note,
  children,
}) => (
  <section className="panel war__panel">
    <div className="panel__bar">
      <span>{title}</span>
      {note && <span className="panel__barnote">{note}</span>}
    </div>
    <div className="panel__body war__body">{children}</div>
  </section>
);

// Anything that drops players takes two taps: the first arms the button and
// says what it costs, the second fires. A native confirm() would be simpler,
// but modal dialogs freeze the page this panel is served next to.
const Arm: FC<{ label: string; armed: string; onFire: () => void; disabled?: boolean }> = ({
  label,
  armed,
  onFire,
  disabled,
}) => {
  const [isArmed, setArmed] = useState(false);
  useEffect(() => {
    if (!isArmed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [isArmed]);
  return (
    <button
      type="button"
      className={`war__btn ${isArmed ? "war__btn--armed" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (isArmed) {
          setArmed(false);
          onFire();
        } else setArmed(true);
      }}
    >
      {isArmed ? armed : label}
    </button>
  );
};

/* --- the room ---------------------------------------------------------- */

const Room: FC<{ token: string; onLock: () => void }> = ({ token, onLock }) => {
  const [state, setState] = useState<State | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [feed, setFeed] = useState<{ at: number; text: string; bad?: boolean }[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [command, setCommand] = useState("");
  const [quota, setQuota] = useState(10);
  const quotaTouched = useRef(false);

  const say = (text: string, bad?: boolean) =>
    setFeed((f) => [{ at: Date.now(), text, bad }, ...f].slice(0, 12));

  const refresh = useCallback(async () => {
    try {
      const s = await call<State>(token, "/state");
      setState(s);
      setStateError(null);
      // the quota box follows the live headcount until it is touched - in
      // YaPB's fill mode that number IS the quota's effect, so it starts
      // honest instead of at some default that would yank the server
      if (!quotaTouched.current && s.status)
        setQuota(
          Math.min(botCapOf(s.status.maxplayers), s.status.humans + s.status.bots),
        );
    } catch (err) {
      if (err instanceof AuthError) return onLock();
      setStateError((err as Error).message);
    }
  }, [token, onLock]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // `urgent` skips the one-at-a-time gate and never claims `pending`. Only the
  // restart uses it: a verified map change now holds the panel for ~15s, and
  // the restart is precisely what an admin reaches for when a map change is
  // going wrong. Being told to wait for the thing that is failing is the
  // position this panel exists to avoid.
  const act = async (
    key: string,
    path: string,
    body: unknown,
    label: string,
    urgent = false,
  ) => {
    if (pending && !urgent) return;
    if (!urgent) setPending(key);
    try {
      const res = await call<{ detail?: string; output?: string }>(token, path, body);
      say(res.detail ? `${label} - ${res.detail}` : label);
      // only /command tails the console; when it caught anything, that IS the
      // answer the button was pressed for
      if (res.output) say(res.output.split("\n").slice(-4).join(" / "));
    } catch (err) {
      if (err instanceof AuthError) return onLock();
      say(`${label} failed - ${(err as Error).message}`, true);
    } finally {
      if (!urgent) setPending(null);
      refresh();
    }
  };

  const status = state?.status ?? null;
  const job = state?.job ?? null;
  const jobRunning = Boolean(job && !job.finishedAt);
  const pipe = state?.pipe ?? false;
  const humans = status?.players.filter((p) => !p.bot) ?? [];
  const bots = status?.players.filter((p) => p.bot) ?? [];
  const busy = Boolean(pending) || jobRunning;
  const teams = Boolean(state && TEAM_MODS.includes(state.mod));
  const botCap = botCapOf(status?.maxplayers);
  // CPL Tournament is the 5v5 match mode: it ships yb_quota 0, so an empty bot
  // panel is its correct resting state and a fill is a deliberate act (a short
  // side, a warm-up). Worth saying, because every other mod arrives with bots
  // in - ClassicAl included, which is the whole difference between the two.
  const matchMod = state?.mod === "cpl";
  const session = state?.session ?? null;
  // the kickoff has been moved iff the file carries what to put back
  const early = Boolean(session && session.scheduled !== undefined);
  const scheduled = session?.scheduled ?? null;

  return (
    <div className="war">
      <header className="war__head">
        <div className="war__title">
          <span className="war__eyebrow">Frag Fridays</span>
          <h1>War room</h1>
        </div>
        <div className="war__live">
          {state ? (
            <>
              <span className="war__mod">{MOD_LABEL[state.mod] ?? state.mod}</span>
              <span className="war__sep">/</span>
              <span>{status?.map ?? "map unknown"}</span>
              <span className="war__sep">/</span>
              <span>
                {status ? `${status.humans} human${status.humans === 1 ? "" : "s"} + ${status.bots} bots` : "no scoreboard"}
              </span>
              {status && status.mapTimeLeft > 0 && (
                <>
                  <span className="war__sep">/</span>
                  <span>{mmss(status.mapTimeLeft)} left</span>
                </>
              )}
            </>
          ) : (
            <span>{stateError ?? "reading the box..."}</span>
          )}
        </div>
        <div className="war__headbtns">
          <a className="war__ghost" href="/">
            Site
          </a>
          <button type="button" className="war__ghost" onClick={onLock}>
            Lock
          </button>
        </div>
      </header>

      {!pipe && state && (
        <p className="war__warn">
          {MOD_LABEL[state.mod] ?? state.mod} has no command pipe - announce, maps, kicks and bots
          are unavailable until the mode is swapped. Restart and mode swap still work.
        </p>
      )}
      {stateError && state && <p className="war__warn">{stateError}</p>}
      {/* The sim can stop while the container, the page and the scoreboard all
          stay green - see docs/troubleshooting.md. When it does, the panel is
          painting a photograph, the command pipe is not being read, and the
          only thing that helps is the restart button below. Say so. */}
      {state?.statusStale && (
        <p className="war__warn">
          The scoreboard has not moved for {Math.round((state.statusAgeMs ?? 0) / 1000)}s - the sim
          is not running. Commands will not be executed. Restart the server.
        </p>
      )}
      {job && (
        <p className={`war__job ${job.finishedAt ? (job.ok ? "war__job--ok" : "war__job--bad") : ""}`}>
          {jobRunning
            ? `${job.kind}${job.detail ? ` -> ${job.detail}` : ""} running... (a swap takes 1-2 minutes)`
            : `${job.kind}: ${job.message}`}
        </p>
      )}

      <div className="war__grid">
        <Panel title="On the server" note={status ? `${status.players.length}/${status.maxplayers}` : "offline"}>
          {humans.length === 0 && bots.length === 0 && <p className="war__empty">Nobody connected.</p>}
          <ul className="war__players">
            {[...humans, ...bots].map((p) => (
              <li key={`${p.bot ? "b" : "h"}-${p.name}`} className="war__player">
                <span className="war__pname">
                  {botName(p)}
                  {p.bot && <span className="war__bot">bot</span>}
                </span>
                <span className="war__frags">{p.frags}</span>
                {/* no kick for bots: YaPB's quota refills the slot within half
                    a second, so the honest control is the Bots panel */}
                {p.bot ? (
                  <span className="war__botpad" />
                ) : (
                  <button
                    type="button"
                    className="war__btn war__btn--slim"
                    disabled={busy || !pipe}
                    onClick={() => act(`kick-${p.name}`, "/kick", { name: p.name }, `Kicked ${p.name}`)}
                  >
                    {pending === `kick-${p.name}` ? "..." : "Kick"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Session" note={early ? "started early" : "the site's countdown"}>
          <p className="war__hint war__hint--lead">
            {!session
              ? "No session file on the box: the site is counting down to its default Friday slot."
              : early
                ? `Kickoff moved to ${timeLabel(session.hour, session.minute)}${
                    endLabel(session.end) ? `, slot ends ${endLabel(session.end)}` : ""
                  }. The front page reads LIVE NOW.`
                : `Kickoff ${timeLabel(session.hour, session.minute)}${
                    endLabel(session.end) ? `, slot ends ${endLabel(session.end)}` : ""
                  }. The front page is counting down to it.`}
          </p>
          {early ? (
            <button
              type="button"
              className="war__btn"
              disabled={busy}
              onClick={() =>
                act("sessionrestore", "/session/restore", {}, "Countdown back on schedule")
              }
            >
              {pending === "sessionrestore"
                ? "..."
                : scheduled
                  ? `Back to ${timeLabel(scheduled.hour, scheduled.minute)}`
                  : "Back to the scheduled time"}
            </button>
          ) : (
            <button
              type="button"
              className="war__btn war__btn--go"
              disabled={busy}
              onClick={() => act("sessionstart", "/session/start", {}, "Session started early")}
            >
              {pending === "sessionstart" ? "Starting..." : "Start now"}
            </button>
          )}
          <p className="war__hint">
            Starts the session on the site, not on the server - nobody is dropped and the box has
            been up all week. Pages already open pick it up within half a minute. Only Fridays: the
            countdown has no other day to point at.
          </p>
        </Panel>

        <Panel title="Teams" note={!state ? "offline" : teams ? "sides and headcount" : "not in this mode"}>
          <div className="war__row war__row--split">
            <button
              type="button"
              className="war__btn"
              disabled={busy || !pipe || !teams}
              onClick={() => act("rebalance", "/rebalance", {}, "Rebalanced teams")}
            >
              {pending === "rebalance" ? "..." : "Rebalance"}
            </button>
            <Arm
              label="Swap sides"
              armed="Swap everyone?"
              disabled={busy || !pipe || !teams}
              onFire={() => act("swapteams", "/swapteams", {}, "Swapped sides")}
            />
          </div>
          <p className="war__hint">
            Rebalance evens the headcount; swap flips every player to the other side. Both keep
            frags, and both respawn everyone where they stand - not mid-round if you can help it.
          </p>
        </Panel>

        <Panel
          title="Bots"
          note={matchMod ? "classic starts at zero" : "yapb fills to a total headcount"}
        >
          <div className="war__stepper">
            <button
              type="button"
              className="war__btn war__btn--step"
              disabled={busy || !pipe || quota <= 0}
              onClick={() => {
                quotaTouched.current = true;
                setQuota((q) => Math.max(0, q - 1));
              }}
            >
              -
            </button>
            <span className="war__quota">{quota}</span>
            <button
              type="button"
              className="war__btn war__btn--step"
              disabled={busy || !pipe || quota >= botCap}
              onClick={() => {
                quotaTouched.current = true;
                setQuota((q) => Math.min(botCap, q + 1));
              }}
            >
              +
            </button>
            <button
              type="button"
              className="war__btn war__btn--go"
              disabled={busy || !pipe}
              onClick={() => act("bots", "/bots", { quota }, `Filling to ${quota}`)}
            >
              {pending === "bots" ? "Sending..." : `Fill to ${quota}`}
            </button>
          </div>
          <p className="war__hint">
            {/* the gap is worked out rather than printed from the reserve: on
                a 24-slot mod the API's own ceiling of 16 is the binding one
                and the free slots are 8, not 4 */}
            Total players, not bots: each human who joins takes a bot's slot. Stops at {botCap},
            not {status?.maxplayers ?? 16} - the last {(status?.maxplayers ?? 16) - botCap} slots
            stay free for people the server can see. A player stuck mid-map-change is not one of
            them, so this is headroom, not the map-change guard.{" "}
            {quota === 0 ? "Zero means an empty server." : ""}
            {matchMod
              ? " CPL Tournament ships zero bots for the 5v5 - a fill lasts until the container restarts, then it is back to zero."
              : ""}
          </p>
          <button
            type="button"
            className="war__btn"
            disabled={busy || !pipe}
            onClick={() => {
              quotaTouched.current = true;
              setQuota(0);
              act("botsclear", "/bots", { clear: true }, "Cleared the bots");
            }}
          >
            {pending === "botsclear" ? "Clearing..." : "Clear all bots"}
          </button>
        </Panel>

        <Panel title="Announce" note="green centre-screen">
          <form
            className="war__row"
            onSubmit={(e) => {
              e.preventDefault();
              const message = announce.trim();
              if (!message) return;
              setAnnounce("");
              act("announce", "/announce", { message }, `Announced "${message}"`);
            }}
          >
            <input
              className="war__input"
              value={announce}
              maxLength={120}
              placeholder="message to everyone in game"
              onChange={(e) => setAnnounce(e.target.value)}
              disabled={!pipe}
            />
            <button type="submit" className="war__btn war__btn--go" disabled={busy || !pipe || !announce.trim()}>
              {pending === "announce" ? "..." : "Say"}
            </button>
          </form>
          <div className="war__chips">
            {["Last map of the session", "5 minutes left", "Swapping mode after this map"].map((m) => (
              <button key={m} type="button" className="war__chip" disabled={!pipe} onClick={() => setAnnounce(m)}>
                {m}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Map" note={state?.maps.length ? `${state.maps.length} in rotation` : "rotation unread"}>
          <ul className="war__maps">
            {(state?.maps ?? []).map((m) => (
              <li key={m}>
                <button
                  type="button"
                  className={`war__map ${m === status?.map ? "war__map--live" : ""}`}
                  disabled={busy || !pipe || m === status?.map}
                  onClick={() => act(`map-${m}`, "/map", { map: m }, `Map to ${m}`)}
                >
                  <span>{m}</span>
                  {m === status?.map && <span className="war__now">on now</span>}
                  {pending === `map-${m}` && <span className="war__now">changing...</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="war__hint">
            Warns the server, changes, then waits to see the new map come up with its players still
            on it - about 15 seconds before it answers. If it comes back red, the map change did
            not carry the players and the restart button is the fix.
          </p>
        </Panel>

        <Panel title="Mode" note="drops everyone">
          <div className="war__modes">
            {(state?.mods ?? []).filter((m) => m !== "zp").map((m) => {
              const live = m === state?.mod;
              return (
                <div key={m} className={`war__mode ${live ? "war__mode--live" : ""}`}>
                  <span className="war__modename">{MOD_LABEL[m] ?? m}</span>
                  {live ? (
                    <span className="war__now">running</span>
                  ) : (
                    <Arm
                      label="Swap"
                      armed="Drop everyone?"
                      disabled={busy}
                      onFire={() => act("mode", "/mode", { mod: m }, `Swapping to ${MOD_LABEL[m] ?? m}`)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="war__hint">
            A swap rebuilds the container: 1-2 minutes with nobody on the server. Don't do it
            mid-round.
          </p>
        </Panel>

        <Panel title="Console" note="the escape hatch">
          <form
            className="war__row"
            onSubmit={(e) => {
              e.preventDefault();
              const c = command.trim();
              if (!c) return;
              setCommand("");
              act("command", "/command", { command: c }, `Sent "${c}"`);
            }}
          >
            <input
              className="war__input war__input--mono"
              value={command}
              maxLength={190}
              placeholder="mp_friendlyfire 0"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => setCommand(e.target.value)}
              disabled={!pipe}
            />
            <button type="submit" className="war__btn war__btn--go" disabled={busy || !pipe || !command.trim()}>
              {pending === "command" ? "..." : "Run"}
            </button>
          </form>
          {/* The soft restart, above the hard one so the ladder reads in
              order. sv_restartround resets the round and respawns everyone
              where they stand: the fix for a wedged round (bots camped, an
              objective nobody can finish, someone stuck in spectate) that
              costs nobody their connection. It was !restart in chat until
              2026-09-05 - unadmin-gated, and mostly one player who only wanted
              to spawn (57 of the server's 90 round restarts were theirs).
              Players say /spawn for that now; this is the whole-server one. */}
          <Arm
            label="Restart round"
            armed="Restart the round?"
            disabled={busy || !pipe}
            onFire={() => act("restartround", "/restartround", {}, "Restarting the round")}
          />
          <p className="war__hint">
            Resets the round and respawns everyone where they stand - nobody is dropped, the map
            stays, and frags are kept. A player who is just dead or stuck in spectate can say
            /spawn instead of costing everyone a round.
          </p>
          {/* deliberately NOT gated on `busy`: this is the way out of a
              wedged sim, and a map change going wrong is when it is wanted */}
          <Arm
            label="Restart server"
            armed="Drop everyone?"
            disabled={jobRunning}
            onFire={() => act("restart", "/restart", {}, "Restarting the server", true)}
          />
          <p className="war__hint">
            Drops everyone; they come back through the page's reconnect button, and the zip is
            already cached so it is quick. It is the only fix for a sim that has stopped, or for a
            map change that left players on the loading screen. restart/quit/exit are refused by
            the pipe - they segfault this engine build.
          </p>
        </Panel>

        <Panel title="Feed" note="this session only">
          {feed.length === 0 ? (
            <p className="war__empty">Nothing sent yet.</p>
          ) : (
            <ul className="war__feed">
              {feed.map((f) => (
                <li key={f.at} className={f.bad ? "war__feedline war__feedline--bad" : "war__feedline"}>
                  <span className="war__feedtime">
                    {new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  {f.text}
                </li>
              ))}
            </ul>
          )}
          {state && <p className="war__ps">{state.ps}</p>}
        </Panel>
      </div>
    </div>
  );
};

const Admin: FC = () => {
  const [token, setToken] = useToken();
  useEffect(() => {
    document.title = "War room";
  }, []);
  return token ? <Room token={token} onLock={() => setToken(null)} /> : <Gate onToken={setToken} />;
};

export default Admin;
