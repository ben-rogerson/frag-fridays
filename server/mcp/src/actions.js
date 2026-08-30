// Everything that actually touches the box, in one place. Two surfaces sit on
// top: the MCP tools (tools.js, for a connected Claude) and the admin panel's
// HTTP API (admin.js, for the web control room). Keeping the doing here means
// the two can never drift on what "swap the mod" or "kick a player" means.
//
// Failures throw ActionError with an HTTP-ish status: the tools turn that into
// an isError text result, the API into a JSON error body.
import { existsSync } from 'node:fs'
import { CMDPIPE_MODS, sendCommands } from './cmdpipe.js'
import { docker, gameContainer, modOf, psLine, run, sleep } from './exec.js'

const GAME_ORIGIN = process.env.GAME_ORIGIN ?? 'http://host.docker.internal:27016'
const ROOT = '/opt/cs16'
// per-mod compose projects; vanilla lives in ROOT. Every mod that can hold
// 27016 must be listed - swapMod's teardown loop reads this, and a mod
// missing here keeps the port and fails the swap.
const MOD_DIRS = ['gg', 'dm', 'zp', 'aim', 'css', 'fy', 'awp']

export const MODS = ['vanilla', 'gg', 'dm', 'aim', 'css', 'fy', 'awp', 'zp']

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
  const [ps, status, info] = await Promise.all([
    psLine(container),
    fetchJson('/status.json'),
    fetchJson('/info.json'),
  ])
  return { container, ps, mod, pipe: CMDPIPE_MODS.has(mod), mode: info?.mode ?? null, status }
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
    return [] // vanilla's mount or a mid-restart exec - not worth failing a whole state read
  }
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

export async function rebalanceTeams() {
  const { mod } = await requireGame()
  if (mod !== 'gg' && mod !== 'dm')
    throw new ActionError(
      `Running mod is "${mod}" - the teambalance plugin is baked into gg and dm only.`,
      409,
    )
  const res = await runCommands(['ff_rebalance'])
  const line = res.output
    .split('\n')
    .filter((l) => l.includes('[rebalance]'))
    .pop()
  return { ...res, result: line ?? null }
}

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
  await run('docker', ['compose', '--profile', 'vanilla', 'down', '--remove-orphans'], {
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
  if (mod === 'vanilla') {
    await run('docker', ['compose', '--profile', 'vanilla', 'up', '-d'], {
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
