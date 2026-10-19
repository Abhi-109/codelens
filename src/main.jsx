import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Router } from './router.jsx'
import Site from './routes.jsx'
import { initTheme } from './theme.js'

// Paint the stored (or system) theme before the first frame; index.html has
// already done this once, and doing it again here is idempotent.
initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <Site />
    </Router>
  </StrictMode>,
)
