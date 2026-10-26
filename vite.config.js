import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { createPlannerDevPlugin } from './server/planner/dev.js'

// https://vite.dev/config/
export default defineConfig({
  // The planner endpoint is dev-only and only mounts when
  // CODELENS_PLANNER_DEV_MOCK is set; production uses the Vercel function.
  plugins: [react(), createPlannerDevPlugin()],
})
