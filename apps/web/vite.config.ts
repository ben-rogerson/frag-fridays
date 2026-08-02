import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `pnpm dev` proxies game traffic to the live box, so the local client
// plays against the real server.
const GAME_SERVER = 'http://149.28.172.74:27016'

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
    },
  },
})
