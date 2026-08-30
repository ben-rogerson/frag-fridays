import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `pnpm dev` proxies game traffic to the live box, so the local client
// plays against the real server.
const GAME_SERVER = 'http://149.28.172.74:27016'

// The war room's API answers on the control-plane container, not the game one.
// Point this at a local `node src/index.js` (server/mcp, ADMIN_TOKEN set) to
// work on the panel without touching the live box.
const ADMIN_API = process.env.ADMIN_API ?? 'http://149.28.172.74:27017'

export default defineConfig({
  plugins: [react()],
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
      // in production the front-door Worker routes /admin-api the same way
      '/admin-api': { target: ADMIN_API },
    },
  },
})
