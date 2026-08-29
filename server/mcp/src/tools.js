// The six tools. Destructive ones (restart_server, swap_mod) shout it in
// their descriptions AND require confirm: true, so a connected Claude checks
// with the owner before dropping players.
import { existsSync } from 'node:fs'
import * as z from 'zod'
import { CMDPIPE_MODS, sendCommands } from './cmdpipe.js'
import { docker, gameContainer, modOf, psLine, run, sleep } from './exec.js'

const GAME_ORIGIN = process.env.GAME_ORIGIN ?? 'http://host.docker.internal:27016'
const ROOT = '/opt/cs16'
const MOD_DIRS = ['gg', 'dm', 'zp'] // per-mod compose projects; vanilla lives in ROOT

const text = (t) => ({ content: [{ type: 'text', text: t }] })
const errText = (t) => ({ content: [{ type: 'text', text: t }], isError: true })
const log = (tool, detail = '') =>
  console.log(`[${new Date().toISOString()}] ${tool} ${detail}`.trim())

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
async function tailContainerLogs(container, args, lines) {
  const { stdout, stderr } = await docker(['logs', ...args, container])
  // the engine writes to stdout, but grab both streams like `2>&1` does
  const all = (stdout + stderr).split('\n').filter(Boolean)
  return all.slice(-lines).join('\n')
}

export function registerTools(server) {
  server.registerTool(
    'server_status',
    {
      title: 'Server status',
      description:
        'What is live on the Frag Fridays box right now: running mod, container ' +
        'uptime, current map, players (humans and bots, names, frags) and the ' +
        'map/round clocks. Read-only, always safe.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      log('server_status')
      const container = await gameContainer()
      if (!container)
        return errText(
          'No container is publishing 27016 - the game server is down or mid-swap. ' +
            '`docker ps` via tail_logs will not help; if this persists, the box needs SSH attention.',
        )
      const [ps, status, info] = await Promise.all([
        psLine(container),
        fetchJson('/status.json'),
        fetchJson('/info.json'),
      ])
      const lines = [`container: ${ps}`, `mod: ${modOf(container)} (${info?.mode ?? 'mode unknown'})`]
      if (status) {
        lines.push(
          `map: ${status.map} | players: ${status.humans} humans + ${status.bots} bots / ${status.maxplayers}`,
          `mapTimeLeft: ${status.mapTimeLeft}s | roundTimeLeft: ${status.roundTimeLeft}s`,
        )
        if (status.players?.length)
          lines.push(
            'scoreboard: ' +
              status.players
                .map((p) => `${p.name}${p.bot ? ' [BOT]' : ''} ${p.frags}`)
                .join(', '),
          )
      } else {
        lines.push('status.json unreachable (game web server not answering - normal for a few seconds after a restart)')
      }
      return text(lines.join('\n'))
    },
  )

  server.registerTool(
    'console_command',
    {
      title: 'Console command',
      description:
        'Send console commands to the LIVE game server via the cmdpipe (works on ' +
        'gg/dm only - vanilla and zp have no pipe). Examples: "changelevel de_dust2", ' +
        '"amx_csay green Hello", "amx_votemap de_dust2 fy_iceworld", cvar sets like ' +
        '"yb_quota 6". changelevel does NOT drop players. "restart", "quit", ' +
        '"exit" and "killserver" are blocked - restart segfaults this Xash3D ' +
        'build; use changelevel for a fresh round or restart_server for a real ' +
        'restart. Output capture is ' +
        'best-effort: an empty result right after a map change usually means the ' +
        'plugin swallowed the serial - safe to resend.',
      inputSchema: z.object({
        commands: z
          .array(z.string().min(1).max(190))
          .min(1)
          .max(20)
          .describe('Console commands, executed in order in one pipe write'),
      }),
    },
    async ({ commands }) => {
      log('console_command', JSON.stringify(commands))
      const container = await gameContainer()
      if (!container) return errText('No game container on 27016 - nothing is reading the pipe.')
      const mod = modOf(container)
      if (!CMDPIPE_MODS.has(mod))
        return errText(
          `Running mod is "${mod}", which has no cmdpipe plugin. Only gg/dm can take console commands remotely.`,
        )
      let serial
      try {
        serial = await sendCommands(commands)
      } catch (e) {
        return errText(e.message)
      }
      await sleep(3500)
      const out = await tailContainerLogs(container, ['--since', '6s'], 25)
      return text(
        `sent #${serial} to ${container}\n` +
          (out ? `console output:\n${out}` : 'no console output captured (may still have executed - check tail_logs or resend)'),
      )
    },
  )

  server.registerTool(
    'rebalance_teams',
    {
      title: 'Rebalance teams',
      description:
        'Force an immediate team rebalance on the live server: evens the T/CT ' +
        'headcount, moving bots first, then the lowest-frag humans. Moved ' +
        'players respawn instantly on their new side - nobody is dropped, safe ' +
        'mid-session. Needs the teambalance plugin, baked into gg and dm only.',
      inputSchema: z.object({}),
    },
    async () => {
      log('rebalance_teams')
      const container = await gameContainer()
      if (!container) return errText('No game container on 27016 - nothing is reading the pipe.')
      const mod = modOf(container)
      if (mod !== 'gg' && mod !== 'dm')
        return errText(
          `Running mod is "${mod}" - the teambalance plugin is baked into gg and dm only.`,
        )
      let serial
      try {
        serial = await sendCommands(['ff_rebalance'])
      } catch (e) {
        return errText(e.message)
      }
      await sleep(3500)
      const out = await tailContainerLogs(container, ['--since', '6s'], 25)
      const result = out
        .split('\n')
        .filter((l) => l.includes('[rebalance]'))
        .pop()
      return text(
        `sent #${serial} to ${container}\n` +
          (result ??
            (out
              ? `no [rebalance] line captured - console output:\n${out}`
              : 'no console output captured (may still have executed - check tail_logs or resend)')),
      )
    },
  )

  server.registerTool(
    'tail_logs',
    {
      title: 'Tail server logs',
      description:
        'Last N lines of the running game container\'s log (engine console, AMXX, ' +
        'kill feed). Read-only, always safe.',
      inputSchema: z.object({
        lines: z.number().int().min(1).max(500).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ lines }) => {
      log('tail_logs', String(lines))
      const container = await gameContainer()
      if (!container) return errText('No game container on 27016.')
      const out = await tailContainerLogs(container, ['--tail', String(lines)], lines)
      return text(out || '(log is empty)')
    },
  )

  server.registerTool(
    'restart_server',
    {
      title: 'Restart game server',
      description:
        'DESTRUCTIVE: restarts the running game container. ALL CONNECTED PLAYERS ' +
        'ARE DROPPED and the server is gone for ~60-90 seconds. The known use is ' +
        'clearing the join-wedge (new joins stuck in "Connect" with climbing ' +
        'lastmsg). ALWAYS ask the owner before calling this.',
      inputSchema: z.object({
        confirm: z.literal(true).describe('Must be true - confirms the owner approved the restart'),
      }),
      annotations: { destructiveHint: true },
    },
    async () => {
      const container = await gameContainer()
      log('restart_server', container ?? 'none')
      if (!container) return errText('No game container on 27016 - nothing to restart.')
      await docker(['restart', container], { timeout: 120_000 })
      await sleep(3000)
      const ps = await psLine(container)
      return text(`restarted ${container}\n${ps}\nGive it ~60s before players rejoin.`)
    },
  )

  server.registerTool(
    'swap_mod',
    {
      title: 'Swap game mod',
      description:
        'DESTRUCTIVE: swaps the running mod (vanilla/gg/dm/zp). DROPS ALL ' +
        'PLAYERS and takes 1-2 minutes (longer on a cold image cache - if the ' +
        'call times out, do NOT retry; check server_status instead). ALWAYS ask ' +
        'the owner before calling this.',
      inputSchema: z.object({
        mod: z.enum(['vanilla', 'gg', 'dm', 'zp']),
        confirm: z.literal(true).describe('Must be true - confirms the owner approved the swap'),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ mod }) => {
      log('swap_mod', mod)
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
        return errText(
          `PORT CHECK FAILED: ${on27016.length} containers on 27016 (expected exactly 1).\n${stdout}\nFix over SSH before players connect.`,
        )
      return text(`swapped to ${mod}\n${steps.join('; ')}\n${on27016[0]}`)
    },
  )
}
