import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// No StrictMode: its double-run of effects would kick off the ~300MB
// valve.zip download twice in dev.
createRoot(document.getElementById('root')!).render(<App />)
