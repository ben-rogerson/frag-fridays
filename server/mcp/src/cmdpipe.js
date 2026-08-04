// Node port of scripts/rc.sh's write side. The cmdpipe.amxx plugin (gg/dm/kz
// images only) polls cmdpipe/cmd.txt every second and executes the lines when
// the serial on line 1 changes. The DIRECTORY is what's bind-mounted into the
// game container, so replacing the file via same-dir rename is safe (new
// inode, atomic swap) - never write cmd.txt in place.
import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'

const DIR = '/opt/cs16/cmdpipe'

// mods whose images bake in cmdpipe.amxx; vanilla/zp can't hear the pipe
export const CMDPIPE_MODS = new Set(['gg', 'dm', 'kz'])

// the plugin's line buffer is 192 bytes - refuse anything close to it
const MAX_CMD_BYTES = 190

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
    return serial
  })
}
