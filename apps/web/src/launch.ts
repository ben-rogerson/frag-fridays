import JSZip from 'jszip'
import filesystemURL from 'xash3d-fwgs/filesystem_stdio.wasm?url'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gles3URL from 'xash3d-fwgs/libref_gles3compat.wasm?url'
import menuURL from 'cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url'
import clientURL from 'cs16-client/cl_dll/client_emscripten_wasm32.wasm?url'
import serverURL from 'cs16-client/dlls/cs_emscripten_wasm32.wasm?url'
import extrasURL from 'cs16-client/extras.pk3?url'
import { Xash3DWebRTC } from './webrtc'

export type DownloadProgress = { received: number; total: number | null }

export async function downloadValveZip(
  onProgress: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  const res = await fetch('/valve.zip')
  if (!res.ok || !res.body) {
    throw new Error(`valve.zip download failed (HTTP ${res.status})`)
  }
  const total = Number(res.headers.get('content-length')) || null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress({ received, total })
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

export type LaunchStatus =
  | { phase: 'engine' }
  | { phase: 'unpacking'; done: number; total: number }

export async function launchGame(
  canvas: HTMLCanvasElement,
  zipBytes: Uint8Array,
  playerName: string,
  onStatus: (s: LaunchStatus) => void,
): Promise<Xash3DWebRTC> {
  const x = new Xash3DWebRTC({
    canvas,
    arguments: ['-windowed', '-game', 'cstrike'],
    libraries: {
      filesystem: filesystemURL,
      xash: xashURL,
      menu: menuURL,
      server: serverURL,
      client: clientURL,
      render: {
        gles3compat: gles3URL,
      },
    },
    dynamicLibraries: ['dlls/cs_emscripten_wasm32.wasm', '/rodir/filesystem_stdio.wasm'],
    filesMap: {
      'dlls/cs_emscripten_wasm32.wasm': serverURL,
      '/rodir/filesystem_stdio.wasm': filesystemURL,
    },
  })

  onStatus({ phase: 'engine' })
  // init() boots the wasm runtime and completes the WebRTC handshake; the zip
  // parse and extras fetch overlap with it.
  const [zip, extras] = await Promise.all([
    JSZip.loadAsync(zipBytes),
    fetch(extrasURL).then((r) => r.arrayBuffer()),
    x.init(),
  ])

  if (x.exited) throw new Error('engine exited during init')
  const fs = x.em!.FS

  const entries = Object.entries(zip.files).filter(([, file]) => !file.dir)
  let done = 0
  onStatus({ phase: 'unpacking', done, total: entries.length })
  await Promise.all(
    entries.map(async ([filename, file]) => {
      const path = '/rodir/' + filename
      const dir = path.split('/').slice(0, -1).join('/')
      fs.mkdirTree(dir)
      fs.writeFile(path, await file.async('uint8array'))
      done += 1
      if (done % 200 === 0 || done === entries.length) {
        onStatus({ phase: 'unpacking', done, total: entries.length })
      }
    }),
  )

  const extrasBytes = new Uint8Array(extras)
  fs.writeFile('/rodir/cstrike/extras.pk3', extrasBytes)
  fs.writeFile('/rodir/extras.pk3', extrasBytes)
  fs.writeFile('/extras.pk3', extrasBytes)

  fs.chdir('/rodir')
  x.main()
  x.Cmd_ExecuteString('_vgui_menus 0')
  x.Cmd_ExecuteString('touch_enable 1')
  if (playerName) {
    x.Cmd_ExecuteString(`name "${playerName}"`)
  }
  return x
}
