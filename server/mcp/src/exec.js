// Thin promisified wrappers around the docker CLI (the host daemon is
// reachable through the mounted socket). Errors carry stderr so tool
// results show what actually went wrong.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export async function run(cmd, args, { timeout = 30_000, cwd } = {}) {
  try {
    const { stdout, stderr } = await pExecFile(cmd, args, {
      timeout,
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { stdout, stderr }
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim()
    throw new Error(
      `${cmd} ${args.join(' ')} failed${err.killed ? ' (timeout)' : ''}: ${detail || err.message}`,
    )
  }
}

export const docker = (args, opts) => run('docker', args, opts)

// The running game container is whichever one publishes the player port.
// Returns null when nothing is on 27016 (mid-swap, or the box is down).
export async function gameContainer() {
  const { stdout } = await docker([
    'ps',
    '--filter',
    'publish=27016',
    '--format',
    '{{.Names}}',
  ])
  return stdout.split('\n').find(Boolean) ?? null
}

// gg-xash3d-1 -> gg, cs16-vanilla-1 -> vanilla (same idiom as the scripts)
export const modOf = (container) => {
  const prefix = container.split('-')[0]
  return prefix === 'cs16' ? 'vanilla' : prefix
}

export async function psLine(container) {
  const { stdout } = await docker([
    'ps',
    '--filter',
    `name=${container}`,
    '--format',
    '{{.Names}}\t{{.Status}}\t{{.Ports}}',
  ])
  return stdout.trim()
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
