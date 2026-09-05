// Everything that actually touches the box, in one place. Two surfaces sit on
// top: the MCP tools (tools.js, for a connected Claude) and the admin panel's
// HTTP API (admin.js, for the web control room). Keeping the doing here means
// the two can never drift on what "swap the mod" or "kick a player" means.
//
// Failures throw ActionError with an HTTP-ish status: the tools turn that into
// an isError text result, the API into a JSON error body.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { CMDPIPE_MODS, sendCommands } from './cmdpipe.js'
import { docker, gameContainer, modOf, psLine, run, sleep } from './exec.js'

const GAME_ORIGIN = process.env.GAME_ORIGIN ?? 'http://host.docker.internal:27016'
const ROOT = '/opt/cs16'
// per-mod compose projects; cpl lives in ROOT. Every mod that can hold
// 27016 must be listed - swapMod's teardown loop reads this, and a mod
// missing here keeps the port and fails the swap.
const MOD_DIRS = ['gg', 'dm', 'zp', 'aim', 'css', 'fy', 'awp', 'classical']

export const MODS = ['cpl', 'classical', 'gg', 'dm', 'aim', 'css', 'fy', 'awp', 'zp']
// mods whose image bakes teambalance.amxx in (ff_rebalance / ff_swapteams).
// The dm clones and classical inherit it; cpl, zp and aim do not have the
// plugin - cpl because it runs the stock image unbuilt and compiles nothing.
const TEAM_MODS = new Set(['gg', 'dm', 'css', 'fy', 'awp', 'classical'])

export class ActionError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.status = status
  }
}

async function fetchJson(path) {
  try {
    const res = await fetch(GAME_ORIGIN + path, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// status.json plus HOW OLD it is, which is the one thing the file itself does
// not say: statusjson.amxx writes it every 5s from a server frame, so a
// timestamp that stops moving means the sim stopped running - the file's
// CONTENTS still read perfectly healthy (a full scoreboard, a map name) while
// nothing behind them is alive. Age comes off Last-Modified because this
// process and the game container share the host clock, so there is no skew to
// argue about; a server that sends no Last-Modified gives ageMs null, which
// every caller must read as "unknown", never as "fresh" and never as "stale".
export async function statusSnapshot() {
  try {
    const res = await fetch(GAME_ORIGIN + '/status.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return { status: null, ageMs: null }
    const lm = Date.parse(res.headers.get('last-modified') ?? '')
    return {
      status: await res.json(),
      ageMs: Number.isFinite(lm) ? Math.max(0, Date.now() - lm) : null,
    }
  } catch {
    return { status: null, ageMs: null }
  }
}

// Anything older than this and the plugin has missed at least two of its own
// 5s writes - a map load can eat one, nothing healthy eats three.
const STATUS_STALE_MS = 20_000
export const statusStale = (ageMs) => ageMs !== null && ageMs > STATUS_STALE_MS

// docker logs of the game container, last `lines`, decoded to plain text
export async function tailContainerLogs(container, args, lines) {
  const { stdout, stderr } = await docker(['logs', ...args, container])
  // the engine writes to stdout, but grab both streams like `2>&1` does
  const all = (stdout + stderr).split('\n').filter(Boolean)
  return all.slice(-lines).join('\n')
}

// The one running game container, or a 503 - nothing else here works without it.
export async function requireGame() {
  const container = await gameContainer()
  if (!container)
    throw new ActionError(
      'No container is publishing 27016 - the game server is down or mid-swap. ' +
        'If this persists, the box needs SSH attention.',
      503,
    )
  return { container, mod: modOf(container) }
}

// ...and the same, plus the running mod being one that reads the cmdpipe.
export async function requirePipe() {
  const { container, mod } = await requireGame()
  if (!CMDPIPE_MODS.has(mod))
    throw new ActionError(
      `Running mod is "${mod}", which has no cmdpipe plugin. Only ${[...CMDPIPE_MODS].join('/')} can take console commands remotely.`,
      409,
    )
  return { container, mod }
}

// Live snapshot: container, mod, and whatever the in-game plugins publish.
// status.json is written every 5s by statusjson.amxx, info.json is the mod's
// own blurb - both are served next to the web client, so they come over http.
export async function serverState() {
  const { container, mod } = await requireGame()
  const [ps, snap, info] = await Promise.all([
    psLine(container),
    statusSnapshot(),
    fetchJson('/info.json'),
  ])
  return {
    container,
    ps,
    mod,
    pipe: CMDPIPE_MODS.has(mod),
    mode: info?.mode ?? null,
    status: snap.status,
    // how stale the scoreboard is, so the panel can say "these numbers are
    // from four minutes ago" instead of painting them as live
    statusAgeMs: snap.ageMs,
    statusStale: statusStale(snap.ageMs),
  }
}

// The live rotation, read from the CONTAINER rather than the repo: the mod
// images shuffle mapcycle.txt on every start (entrypoint.sh), so the repo
// order is not the order being played. Cached per container - the admin panel
// polls every few seconds and this is a `docker exec` into the live game
// server, which the rotation (fixed for the container's life) does not earn.
const cycleCache = new Map()
const CYCLE_TTL = 5 * 60_000

export async function mapcycle() {
  const { container } = await requireGame()
  const hit = cycleCache.get(container)
  if (hit && Date.now() - hit.at < CYCLE_TTL) return hit.maps
  try {
    const { stdout } = await docker(['exec', container, 'cat', 'cstrike/mapcycle.txt'])
    const maps = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    cycleCache.clear() // one container at a time; don't grow across swaps
    cycleCache.set(container, { maps, at: Date.now() })
    return maps
  } catch {
    return [] // cpl's mount or a mid-restart exec - not worth failing a whole state read
  }
}

// --- the site's countdown ------------------------------------------------
// web/assets/session.json is the one thing the front page's clock reads: the
// coming Friday's kickoff, generated by scripts/session.sh out of
// data/sessions.json and served from the web dir every mod's container
// mounts. Moving the kickoff earlier is how the page goes live before its
// scheduled time - App.tsx reads a kickoff already past as a session running,
// until the slot's end - so the panel writes this file rather than adding a
// second switch the countdown would have to be taught about.
//
// The original kickoff rides along in `scheduled` so "back to 2.30 pm" is a
// rewrite of this file and not a guess; the page ignores keys it does not
// know. A later scripts/session.sh push overwrites the lot, which is the
// right answer: the schedule is the source of truth, this is one night's
// override.
const SESSION_FILE = `${ROOT}/web/assets/session.json`
const DEFAULT_SLOT_MINS = 60

// Sydney wall time - the schedule's timezone, and never the box's (UTC).
function sydneyNow(at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  )
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    hour: Number(p.hour),
    minute: Number(p.minute),
  }
}

const hhmm = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
const minutesOf = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? ''))
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null
}

// The file as written, or null for missing/unreadable/not the shape the page
// reads - all of which mean the same thing here: the page is on its compiled
// default and there is nothing to move back to.
export function readSession() {
  try {
    const j = JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
    return typeof j?.date === 'string' && Number.isFinite(j.hour) ? j : null
  } catch {
    return null
  }
}

const writeSession = (s) => writeFileSync(SESSION_FILE, `${JSON.stringify(s)}\n`)

// Kick off now. Only ever today's session: the page counts to Fridays, so a
// file dated anything else is ignored by it and writing one would look like a
// dead button.
export function startSessionNow() {
  const now = sydneyNow()
  if (now.weekday !== 'Fri')
    throw new ActionError(
      `The site's clock only counts to Friday, and it is ${now.weekday} in Sydney - starting now would not show up on the page.`,
      409,
    )
  const file = readSession()
  const today = file && file.date === now.date ? file : null
  if (today?.scheduled)
    throw new ActionError('The session is already started early - put it back first.', 409)

  const nowMins = now.hour * 60 + now.minute
  const scheduledEnd = minutesOf(today?.end)
  // keep the slot's own end where there is still session left in it; an
  // already-finished (or missing) slot gets an hour from now rather than the
  // page's 30-minute fallback, which would close a just-started session
  const endMins =
    scheduledEnd !== null && scheduledEnd > nowMins ? scheduledEnd : nowMins + DEFAULT_SLOT_MINS
  const end = hhmm(Math.floor(endMins / 60) % 24, endMins % 60)
  writeSession({
    date: now.date,
    hour: now.hour,
    minute: now.minute,
    end,
    // what to put back, and null where there was no file to begin with
    scheduled: today ? { hour: today.hour, minute: today.minute, end: today.end ?? null } : null,
  })
  return {
    kickoff: hhmm(now.hour, now.minute),
    end,
    scheduled: today ? hhmm(today.hour, today.minute) : null,
  }
}

// Back to the schedule: the kickoff `scheduled` remembers, or no file at all
// where this started one.
export function restoreSession() {
  const file = readSession()
  if (!file || file.scheduled === undefined)
    throw new ActionError('The countdown is already on its scheduled time.', 409)
  const s = file.scheduled
  if (!s) {
    rmSync(SESSION_FILE, { force: true })
    return { kickoff: null }
  }
  writeSession({
    date: file.date,
    hour: s.hour,
    minute: s.minute,
    ...(s.end ? { end: s.end } : {}),
  })
  return { kickoff: hhmm(s.hour, s.minute) }
}

// Write commands to the pipe and hand back whatever the console said. The
// plugin polls once a second, so nothing is visible for a few seconds; `wait`
// 0 skips the log read entirely (for callers that only care it was sent).
export async function runCommands(commands, { wait = 3500, lines = 25 } = {}) {
  const { container, mod } = await requirePipe()
  let serial
  try {
    serial = await sendCommands(commands)
  } catch (e) {
    throw new ActionError(e.message, 400)
  }
  if (!wait) return { serial, container, mod, output: '' }
  await sleep(wait)
  const since = `${Math.ceil(wait / 1000) + 3}s`
  return { serial, container, mod, output: await tailContainerLogs(container, ['--since', since], lines) }
}

// --- changing the map ----------------------------------------------------
// This is the one action that has actually stranded a session (2026-09-04,
// see docs/troubleshooting.md), so it is the one action that checks its own
// work instead of reporting "sent" and walking away.
//
// Two things are deliberate here:
//
// 1. The warning and the changelevel are TWO pipe writes with a gap, which is
//    the shape scripts/nextmap.sh has always used and never broken. They used
//    to be one write, and cmdpipe.amxx runs every line of a write in the same
//    server frame - so `amx_csay` broadcast a HUD message to every client and
//    `changelevel` tore the level down before that frame ended. Both times
//    that ran against a full server, every carried-over client stalled in the
//    engine's resource handshake and never spawned. One write is the only
//    thing that path did which the (always-fine) rotation changelevel does
//    not, so it is not something to keep for tidiness.
// 2. It waits for status.json to say the new map is up AND that the humans
//    are still there. When clients stall, the map itself comes up perfectly:
//    the server logs a clean Spawn Server, the panel's scoreboard refills
//    with bots, and the only tell is that the humans are gone from it. An
//    admin told "Changed map to de_nuke" in that state has been told the
//    opposite of what happened.
const MAP_WARN_MS = 4000 // players get the csay before the screen goes
const MAP_LAND_MS = 20_000 // a big map spawns in ~3s; this is the give-up point
const MAP_SETTLE_MS = 8000 // clients that are coming back are back inside this

export async function changeMap(map) {
  await requirePipe()
  const before = await statusSnapshot()
  // A sim that has stopped writing status.json has also stopped reading the
  // cmdpipe, so the command would be accepted and never run. Say so rather
  // than queue a change into a server that cannot make it.
  if (statusStale(before.ageMs))
    throw new ActionError(
      `The server has not updated its scoreboard for ${Math.round(before.ageMs / 1000)}s - the sim is not running, so a map change would not be executed. Restart the server first.`,
      409,
    )
  const humansBefore = before.status?.humans ?? 0

  const send = async (commands) => {
    try {
      return await sendCommands(commands)
    } catch (e) {
      throw new ActionError(e.message, 400)
    }
  }
  await send([`amx_csay green Changing map to ${map}...`])
  await sleep(MAP_WARN_MS)
  const serial = await send([`changelevel ${map}`])

  const deadline = Date.now() + MAP_LAND_MS
  let snap = before
  while (Date.now() < deadline) {
    await sleep(1500)
    snap = await statusSnapshot()
    if (snap.status?.map === map) break
  }
  if (snap.status?.map !== map) {
    // No status.json at all is not evidence of a failed map change - it is a
    // mod with no statusjson plugin, or a web dir that is not being served.
    // Say what is actually known rather than reporting a failure that did not
    // happen; an unverifiable change is still better news than a wrong one.
    if (!snap.status)
      return { serial, map, humansBefore, humansAfter: null, verified: false }
    throw new ActionError(
      `Sent "changelevel ${map}" (#${serial}) but the server is still on ${snap.status.map} after ${MAP_LAND_MS / 1000}s. The command pipe or the sim is wedged - restart the server.`,
      409,
    )
  }

  if (humansBefore === 0) return { serial, map, humansBefore, humansAfter: 0 }

  await sleep(MAP_SETTLE_MS)
  const after = await statusSnapshot()
  const humansAfter = after.status?.humans ?? 0
  if (humansAfter === 0) {
    // The lockout, caught in the act - and the one moment it is unambiguous,
    // so this is where it gets repaired rather than only reported.
    //
    // The bots are the door. Stalled clients hold their engine slots for
    // sv_timeout (600s) and YaPB CANNOT SEE THEM (measured 2026-09-04: its
    // quota maths counts only clients the game DLL has put in the server, so
    // it reads the server as empty and expands to fill every slot they are
    // not already holding). No yb_autovacate_keep_slots value can reserve
    // against a headcount that does not include them. What does work is
    // taking the bots out: the slots the stalled clients are NOT holding go
    // free immediately and the players' own reloads land.
    //
    // yb kickall alone would be undone by the quota maintainer within a
    // second, so the quota has to come down with it. It puts itself back:
    // YaPB re-reads its config on changelevel and specifically exempts a
    // quota of zero from yb_ignore_cvars_on_changelevel (config.cpp, "preserve
    // quota number if it's zero"), so the NEXT map change restores whatever
    // yapb.cfg says. Measured both ways 2026-09-04: a runtime quota of 6
    // survived a changelevel, a runtime quota of 0 came back as the config's.
    // So this opens the doors now and heals itself, with no botless server
    // left behind for someone to notice on Monday.
    try {
      await sendCommands(['yb_quota 0', 'yb kickall'])
    } catch {
      // best effort: the message below is still the important part, and a
      // pipe that refuses this is a pipe the admin needs to know about
    }
    throw new ActionError(
      `${map} is up, but all ${humansBefore} players are stuck on the loading screen and never rejoined. ` +
        'Their slots stay held for 10 minutes, so I have cleared the bots to open the rest of the server - ' +
        'tell people to reload the page and they will get back in. The bots come back by themselves at the ' +
        'next map change. Restart the server if you want the held slots back now.',
      409,
    )
  }
  return { serial, map, humansBefore, humansAfter }
}

// ff_rebalance / ff_swapteams both answer on the console with one [tag] line;
// hand it back so the caller can show what the plugin actually did rather
// than "sent".
async function teamCommand(command, tag) {
  const { mod } = await requireGame()
  if (!TEAM_MODS.has(mod))
    throw new ActionError(
      `Running mod is "${mod}" - the teambalance plugin is baked into ${[...TEAM_MODS].join('/')} only.`,
      409,
    )
  const res = await runCommands([command])
  // the console line comes back wrapped in the container's structured log -
  // timestamp, ANSI codes, an escaped closing quote. Keep the plugin's own
  // sentence and nothing else: this string goes straight into the panel feed.
  const said = res.output.match(new RegExp(`\\[${tag}\\][^"\\\\\\n]*`, 'g'))
  return { ...res, result: said?.at(-1) ?? null }
}

export const rebalanceTeams = () => teamCommand('ff_rebalance', 'rebalance')

// Everyone changes sides at once - the fix for a map that ran one-sided,
// where evening the headcount is not the problem.
export const swapTeams = () => teamCommand('ff_swapteams', 'swapteams')

export async function tailLogs(lines) {
  const { container } = await requireGame()
  const out = await tailContainerLogs(container, ['--tail', String(lines)], lines)
  return { container, output: out || '(log is empty)' }
}

export async function restartServer() {
  const { container } = await requireGame()
  await docker(['restart', container], { timeout: 120_000 })
  await sleep(3000)
  return { container, ps: await psLine(container) }
}

// DROPS EVERYONE. Mirrors deploy.sh: warn, down everything that could hold
// 27016, build+up the target, then assert exactly one container on the port.
export async function swapMod(mod) {
  if (!MODS.includes(mod)) throw new ActionError(`Unknown mod "${mod}".`, 400)
  const steps = []
  // heads-up to anyone in-game, same as scripts/swap.sh
  const current = await gameContainer()
  if (current && CMDPIPE_MODS.has(modOf(current))) {
    await sendCommands([`amx_csay green Switching server to ${mod} - back in a couple of minutes`])
    await sleep(8000)
    steps.push('warned players via csay, waited 8s')
  }
  // down everything that could hold 27016 (mirrors deploy.sh; never touches mcp/)
  await run('docker', ['compose', '--profile', 'cpl', 'down', '--remove-orphans'], {
    cwd: ROOT,
    timeout: 120_000,
  })
  for (const m of MOD_DIRS) {
    if (!existsSync(`${ROOT}/${m}/docker-compose.yml`)) continue
    await run('docker', ['compose', 'down', '--remove-orphans'], {
      cwd: `${ROOT}/${m}`,
      timeout: 120_000,
    })
  }
  steps.push('all game containers down')
  // up the target (build contexts are already on the box from the last deploy)
  if (mod === 'cpl') {
    await run('docker', ['compose', '--profile', 'cpl', 'up', '-d'], {
      cwd: ROOT,
      timeout: 300_000,
    })
  } else {
    await run('docker', ['compose', 'build'], { cwd: `${ROOT}/${mod}`, timeout: 300_000 })
    await run('docker', ['compose', 'up', '-d'], { cwd: `${ROOT}/${mod}`, timeout: 120_000 })
  }
  steps.push(`${mod} up`)
  // the deploy.sh invariant: exactly one container may publish 27016
  await sleep(3000)
  const { stdout } = await docker(['ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}'])
  const on27016 = stdout.split('\n').filter((l) => l.includes('27016'))
  if (on27016.length !== 1)
    throw new ActionError(
      `PORT CHECK FAILED: ${on27016.length} containers on 27016 (expected exactly 1).\n${stdout}\nFix over SSH before players connect.`,
      500,
    )
  return { steps, ps: on27016[0] }
}
