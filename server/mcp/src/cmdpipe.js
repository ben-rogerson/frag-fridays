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
