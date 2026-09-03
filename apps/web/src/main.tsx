import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// The admin panel is a hash route, not a path: the game containers only serve
// index.html and assets/, so a second HTML entry would never reach the box.
// The hash is not the security - the token behind it is (server/mcp/src/admin.js)
// - it just keeps the control room out of sight of anyone poking at the page.
// Loaded on demand, so the panel is a separate chunk and costs players nothing.
const ADMIN_ROUTE = '#/warroom'

const root = createRoot(document.getElementById('root')!)

// No StrictMode: its double-run of effects would kick off the ~300MB
// valve.zip download twice in dev.
if (window.location.hash === ADMIN_ROUTE) {
  document.body.classList.add('admin')
  import('./Admin').then(({ default: Admin }) => root.render(<Admin />))
} else {
  root.render(<App />)
}

// entering or leaving the route mid-session swaps a WASM game engine for a
// control panel - a reload is the only honest way to do that
window.addEventListener('hashchange', () => {
  if ((window.location.hash === ADMIN_ROUTE) !== document.body.classList.contains('admin'))
    window.location.reload()
})
