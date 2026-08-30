import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// `pnpm dev` proxies game traffic to the live box, so the local client
// plays against the real server.
const GAME_SERVER = 'http://149.28.172.74:27016'

// FF_PAYLOAD=/path/to/payload.zip serves that file as /valve.zip instead of
// proxying the box's. A payload layout change is otherwise untestable without
// building it on the server first and dropping whoever is connected; this
// plays the local archive against the live game server. Dev only.
function localPayload(): Plugin | false {
  const file = process.env.FF_PAYLOAD
  return (
    !!file && {
      name: 'ff-local-payload',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/valve.zip') return next()
          const stat = fs.statSync(file)
          const modified = stat.mtime.toUTCString()
          // the client revalidates its Cache Storage copy by Last-Modified,
          // so a dev server that never 304s hides the cached-boot path
          if (req.headers['if-modified-since'] === modified) {
            res.statusCode = 304
            res.setHeader('last-modified', modified)
            return res.end()
          }
          res.setHeader('content-type', 'application/zip')
          res.setHeader('content-length', String(stat.size))
          res.setHeader('last-modified', modified)
          fs.createReadStream(file).pipe(res)
        })
      },
    }
  )
}

export default defineConfig({
  plugins: [react(), localPayload()],
  build: {
    // deploy.sh rsyncs server/ to the box; the composes mount index.html
    // and assets/ from here over the image's stock client.
    outDir: '../../server/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    proxy: {
      '/websocket': { target: GAME_SERVER, ws: true },
      '/valve.zip': { target: GAME_SERVER },
      '/info.json': { target: GAME_SERVER },
      '/status.json': { target: GAME_SERVER },
    },
  },
})
