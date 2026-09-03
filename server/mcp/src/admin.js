// The war room's back end: the HTTP API behind the web client's secret admin
// route (apps/web/src/Admin.tsx, reached at /#/warroom). Same container and
// the same actions.js as the MCP tools - this is the surface for driving the
// server by hand from a phone mid-session, where opening claude.ai or an SSH
// session is too slow.
//
// Auth: a bearer token in the x-ff-admin header (ADMIN_TOKEN in
// /opt/cs16/mcp.env), compared in constant time. Unlike the MCP secret the
// token does NOT ride the URL - the panel is our own fetch(), so it can set a
// header, which keeps the token out of Cloudflare's request logs. A bad token
// gets a bare 401 and counts towards a per-IP lockout.
//
// Route shape: /admin-api/* on ff.benrogerson.dev, proxied to this container
// by the front-door Worker (apps/web/proxy/worker.js).
import { createHash, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import {
  ActionError,
  mapcycle,
  rebalanceTeams,
  requirePipe,
  restartServer,
  runCommands,
  serverState,
  swapMod,
  swapTeams,
} from './actions.js'

const TOKEN = process.env.ADMIN_TOKEN
const MODS = ['vanilla', 'gg', 'dm', 'aim', 'css', 'fy', 'awp', 'zp']

const sha = (s) => createHash('sha256').update(String(s)).digest()
const tokenOk = (t) => Boolean(TOKEN) && timingSafeEqual(sha(t ?? ''), sha(TOKEN))

const log = (what, detail = '') =>
  console.log(`[${new Date().toISOString()}] admin ${what} ${detail}`.trim())

// Brute-force brake. The token is long and random, so this is belt-and-braces
// against a leaked-prefix guessing run: 10 misses from one IP and that IP is
// out for 15 minutes. In-memory on purpose - a restart clearing it is fine.
const MAX_MISSES = 10
const LOCKOUT_MS = 15 * 60_000
const misses = new Map()

function lockedOut(ip) {
  const m = misses.get(ip)
  if (!m) return false
  if (Date.now() - m.at > LOCKOUT_MS) {
    misses.delete(ip)
    return false
  }
  return m.count >= MAX_MISSES
}

function countMiss(ip) {
  const m = misses.get(ip)
  const fresh = !m || Date.now() - m.at > LOCKOUT_MS
  misses.set(ip, { count: fresh ? 1 : m.count + 1, at: Date.now() })
}

// The slow, destructive actions (mod swap, container restart) outlive an HTTP
// request: a swap takes 1-2 minutes and Cloudflare gives up at ~100s. So they
// run detached as a single job, the POST returns 202, and the panel watches
// `job` in /state until it lands. One at a time, always - two swaps at once
// would fight over port 27016.
let job = null

function startJob(kind, detail, work) {
  if (job && !job.finishedAt)
    throw new ActionError(`"${job.kind}" is already running - wait for it to finish.`, 409)
  job = { kind, detail, startedAt: Date.now(), finishedAt: null, ok: null, message: null }
  const mine = job
  work()
    .then((r) => {
      mine.ok = true
      mine.message = r
    })
    .catch((e) => {
      mine.ok = false
      mine.message = e.message ?? String(e)
    })
    .finally(() => {
      mine.finishedAt = Date.now()
      log(`job ${kind}`, mine.ok ? 'ok' : `FAILED: ${mine.message}`)
    })
  return job
}

// A handler's way of asking for a status code other than 200. Deliberately a
// class rather than a `{ status, body }` object: the payloads here have their
// own `status` and `body` fields and the two must never be confused.
class Reply {
  constructor(status, body) {
    this.status = status
    this.body = body
  }
}

// Player names come off the scoreboard and go back out as a console argument.
// GoldSrc tokenises on quotes and chains on ";", so anything that could close
// the quote or start a second command is refused rather than escaped - a name
// that trips this is a name to kick over SSH.
function safeName(name) {
  const n = String(name ?? '').trim()
  if (!n) throw new ActionError('No player name given.', 400)
  if (n.length > 32) throw new ActionError('Player name is too long.', 400)
  if (/["'`;\n\r\\]/.test(n))
    throw new ActionError(`"${n}" contains characters that cannot be sent to the console.`, 400)
  return n
}

// Same idea for the announce line: it rides inside an amx_csay command, and
// the whole pipe line has to fit the plugin's 192-byte buffer.
function safeMessage(message) {
  const m = String(message ?? '').replace(/[\n\r]+/g, ' ').trim()
  if (!m) throw new ActionError('Nothing to announce.', 400)
  if (/[;"]/.test(m)) throw new ActionError('Announcements cannot contain ; or "', 400)
  if (Buffer.byteLength(`amx_csay green ${m}`, 'utf8') > 180)
    throw new ActionError('Announcement is too long for the command pipe (keep it short).', 400)
  return m
}

const mapName = (map) => {
  const m = String(map ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,31}$/.test(m)) throw new ActionError(`"${m}" is not a valid map name.`, 400)
  return m
}

const intIn = (value, lo, hi, what) => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < lo || n > hi)
    throw new ActionError(`${what} must be a whole number between ${lo} and ${hi}.`, 400)
  return n
}

export function adminRouter() {
  const router = Router()

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store') // the zone cache is aggressive
    const ip = req.headers['cf-connecting-ip'] ?? req.ip ?? 'unknown'
    if (lockedOut(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
    if (!tokenOk(req.get('x-ff-admin'))) {
      countMiss(ip)
      log('auth miss', String(ip))
      return res.status(401).json({ error: 'Bad admin token.' })
    }
    misses.delete(ip)
    next()
  })

  // every handler ends here: ActionError carries the status it wants, anything
  // else is a bug and gets a 500 with its message (this box has one user).
  // A handler returning a Reply is choosing its own code; anything else is a
  // 200 payload, read as data and never as an envelope - /state's `status` is
  // the game's scoreboard, not an HTTP code.
  const handle = (fn) => async (req, res) => {
    try {
      const out = await fn(req)
      if (out instanceof Reply) res.status(out.status).json(out.body)
      else res.json(out ?? { ok: true })
    } catch (e) {
      res.status(e instanceof ActionError ? e.status : 500).json({ error: e.message ?? String(e) })
    }
  }

  const ok = (detail) => ({ ok: true, detail })

  // Everything the panel paints, in one poll: what is running, who is on it,
  // the live rotation, and whatever background job is in flight.
  router.get('/state', handle(async () => {
    const state = await serverState()
    return { ...state, maps: await mapcycle(), mods: MODS, job }
  }))

  // Cheap "is my token good" for the login gate, and the only route that is
  // useful while the game container is down.
  router.get('/whoami', handle(async () => ({ ok: true })))

  router.post('/announce', handle(async (req) => {
    const message = safeMessage(req.body?.message)
    log('announce', message)
    const { serial } = await runCommands([`amx_csay green ${message}`], { wait: 0 })
    return ok(`announced (#${serial})`)
  }))

  router.post('/map', handle(async (req) => {
    const map = mapName(req.body?.map)
    log('map', map)
    // warn first, then change - same courtesy as scripts/nextmap.sh, but the
    // 5s gap is one pipe write so a slow HTTP round trip can't split them
    const { serial } = await runCommands(
      [`amx_csay green Changing map to ${map}...`, `changelevel ${map}`],
      { wait: 0 },
    )
    return ok(`changing to ${map} (#${serial})`)
  }))

  router.post('/kick', handle(async (req) => {
    const name = safeName(req.body?.name)
    log('kick', name)
    // the engine's own kick, by name: AMXX's amx_kick needs an admin identity,
    // the console has none, and every name here came off the live scoreboard.
    // No log wait - the scoreboard the panel is already polling is the proof.
    const { serial } = await runCommands([`kick "${name}"`], { wait: 0 })
    return ok(`kicked ${name} (#${serial})`)
  }))

  // Bots are YaPB in `fill` quota mode: yb_quota is a TOTAL headcount target,
  // not a bot count, and the quota maintainer undoes any manual add/kick
  // within half a second. So the quota is the only durable control - the
  // panel spells it "fill to N", and clearing means quota 0 then kickall.
  router.post('/bots', handle(async (req) => {
    // input first: a bad number should say so whether or not the box is up
    const quota = req.body?.clear ? null : intIn(req.body?.quota, 0, 16, 'Bot fill')
    const { mod } = await requirePipe()
    if (quota === null) {
      log('bots', 'clear')
      const { serial } = await runCommands(['yb_quota 0', 'yb kickall'], { wait: 0 })
      return ok(`bots cleared on ${mod} (#${serial})`)
    }
    log('bots', `quota ${quota}`)
    const { serial } = await runCommands([`yb_quota ${quota}`], { wait: 0 })
    return ok(`filling to ${quota} players on ${mod} (#${serial})`)
  }))

  router.post('/rebalance', handle(async () => {
    log('rebalance')
    const { serial, result } = await rebalanceTeams()
    return ok(result ?? `rebalance sent (#${serial})`)
  }))

  // Sides flip, scores stay. Everyone is slain to respawn on the new side,
  // so this is a mid-round interruption - the panel arms the button.
  router.post('/swapteams', handle(async () => {
    log('swapteams')
    const { serial, result } = await swapTeams()
    return ok(result ?? `swap sent (#${serial})`)
  }))

  // The escape hatch: cmdpipe.js still blocks the engine-killers, so the worst
  // this does is set a silly cvar.
  router.post('/command', handle(async (req) => {
    const command = String(req.body?.command ?? '').trim()
    if (!command) throw new ActionError('No command given.', 400)
    log('command', command)
    const { serial, output } = await runCommands([command])
    return { ok: true, detail: `sent #${serial}`, output }
  }))

  router.post('/mode', handle(async (req) => {
    const mod = String(req.body?.mod ?? '')
    if (!MODS.includes(mod)) throw new ActionError(`Unknown mode "${mod}".`, 400)
    log('mode', mod)
    startJob('mode', mod, async () => {
      const { steps, ps } = await swapMod(mod)
      return `swapped to ${mod} - ${steps.join('; ')} - ${ps}`
    })
    return new Reply(202, { ok: true, detail: `swapping to ${mod}`, job })
  }))

  router.post('/restart', handle(async () => {
    log('restart')
    startJob('restart', null, async () => {
      const { container, ps } = await restartServer()
      return `restarted ${container} - ${ps}`
    })
    return new Reply(202, { ok: true, detail: 'restarting', job })
  }))

  return router
}

export const adminEnabled = () => Boolean(TOKEN)
