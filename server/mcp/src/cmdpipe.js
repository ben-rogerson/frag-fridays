// Node port of scripts/rc.sh's write side. The cmdpipe.amxx plugin (mod-dir
// images only - not cpl/zp) polls cmdpipe/cmd.txt every second and runs
// the lines when the serial on line 1 changes. The DIRECTORY is what's bind-mounted into the
// game container, so replacing the file via same-dir rename is safe (new
// inode, atomic swap) - never write cmd.txt in place.
import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const DIR = '/opt/cs16/cmdpipe'

// mods that can hear the pipe: the mod images bake cmdpipe.amxx in, and
// cpl gets it from the box-side mods/zp/{plugins,configs} mounts (seeded
// 2026-08-03, registered in that plugins.ini - re-verified 2026-08-30). Only
// zp, whose mount is the abandoned template, is deaf.
export const CMDPIPE_MODS = new Set(['cpl', 'classical', 'gg', 'dm', 'aim', 'css', 'fy', 'awp'])

// the plugin's line buffer is 192 bytes - refuse anything close to it
const MAX_CMD_BYTES = 190

// The plugin polls once a second and only ever sees what cmd.txt holds AT
// that moment: a second write inside the same window replaces the first,
// which then never runs and never errors. Verified 2026-08-30 - four
// back-to-back pairs, the first of every pair lost. The war room felt this
// as "announce does nothing": /announce returns without waiting, so the next
// button press could land its write inside the same second and take the
// announcement with it.
//
// So a write waits out the poll interval of the one before it. Every write
// from this process goes through withPipeLock, so pacing there is enough for
// the panel and the MCP tools. It cannot help against a write from OUTSIDE
// the process (scripts/rc.sh, a cron job) landing in the same second - those
// are human-paced and rare, and the real cure would be an ack from the
// plugin rather than a serial it can miss.
const POLL_SETTLE_MS = 1500
let lastWriteAt = 0

// commands that crash or kill this Xash3D build if fed via the pipe:
// "restart" segfaults the engine (observed 2026-08-04); quit/exit/killserver
// stop it on purpose. The container comes back but everyone is dropped.
// GoldSrc chains commands with ";", so every segment's first token is checked.
const BLOCKED_COMMANDS = new Set(['restart', '_restart', 'quit', 'exit', 'killserver'])

export function blockedCommand(command) {
  for (const segment of command.split(';')) {
    const word = segment.trim().split(/\s+/)[0]?.toLowerCase()
    if (word && BLOCKED_COMMANDS.has(word)) return word
  }
  return null
}

// promise-chain mutex: console_command and swap_mod share the serial file,
// and this process must never race itself on read-increment-write
let chain = Promise.resolve()
export function withPipeLock(fn) {
  const next = chain.then(fn)
  chain = next.catch(() => {})
  return next
}

export async function sendCommands(commands) {
  for (const c of commands) {
    if (c.includes('\n')) throw new Error('newlines are not allowed in a command')
    if (Buffer.byteLength(c, 'utf8') > MAX_CMD_BYTES)
      throw new Error(`command exceeds ${MAX_CMD_BYTES} bytes: ${c.slice(0, 40)}...`)
    const blocked = blockedCommand(c)
    if (blocked)
      throw new Error(
        `"${blocked}" is blocked: it crashes or kills the engine on this Xash3D build. ` +
          'For a fresh round use "changelevel <current map>"; for a full restart use the restart_server tool.',
      )
  }
  return withPipeLock(async () => {
    const since = Date.now() - lastWriteAt
    if (since < POLL_SETTLE_MS) await delay(POLL_SETTLE_MS - since)
    let prev = 0
    try {
      prev = parseInt((await readFile(`${DIR}/cmd.txt`, 'utf8')).split('\n')[0], 10) || 0
    } catch {
      // missing file: first write ever, start from 1
    }
    const serial = Math.max(prev, 0) + 1 // plugin ignores serials <= 0
    const tmp = `${DIR}/.cmd.${randomBytes(6).toString('hex')}`
    await writeFile(tmp, [String(serial), ...commands].join('\n') + '\n', { mode: 0o644 })
    await rename(tmp, `${DIR}/cmd.txt`)
    lastWriteAt = Date.now()
    return serial
  })
}
