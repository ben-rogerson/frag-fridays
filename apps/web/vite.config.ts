import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// `pnpm dev` proxies game traffic to the live box, so the local client
// plays against the real server.
const GAME_SERVER = 'http://149.28.172.74:27016'

// The war room's API answers on the control-plane container, not the game one.
// Point this at a local `node src/index.js` (server/mcp, ADMIN_TOKEN set) to
// work on the panel without touching the live box.
const ADMIN_API = process.env.ADMIN_API ?? 'http://149.28.172.74:27017'

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

// FF_FIXTURES=/path/to/dir answers /status.json and /info.json out of that
// directory instead of proxying the box's. The tab screen is a scoreboard, so
// checking its layout means checking it full of players, in a given mode, at a
// given window size - and the alternative is organising a match per screenshot.
// Dev only, like localPayload above. It takes the two routes off the proxy
// rather than racing it, so which middleware Vite installs first is moot.
const FIXTURES = process.env.FF_FIXTURES

function localFeed(): Plugin | false {
  const dir = FIXTURES
  return (
    !!dir && {
      name: 'ff-local-feed',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const name = req.url?.split('?')[0]
          if (name !== '/status.json' && name !== '/info.json') return next()
          try {
            const body = fs.readFileSync(dir + name)
            res.setHeader('content-type', 'application/json')
            res.setHeader('cache-control', 'no-store')
            return res.end(body)
          } catch {
            return next()
          }
        })
      },
    }
  )
}

const feedProxy = FIXTURES
  ? {}
  : {
      '/info.json': { target: GAME_SERVER },
      '/status.json': { target: GAME_SERVER },
    }

export default defineConfig({
  plugins: [react(), localPayload(), localFeed()],
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
      ...feedProxy,
      // in production the front-door Worker routes /admin-api the same way
      '/admin-api': { target: ADMIN_API },
    },
  },
})
