import { defineConfig } from '@playwright/test'
export const site = process.env.E2E_SITE || 'http://localhost:4186'
export const backend = process.env.E2E_API || 'http://localhost:4187'

export default defineConfig({
  testDir: './tests',
  timeout: 165_000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  workers: 3,
  use: { baseURL: site, trace: 'retain-on-failure' },
  webServer: process.env.E2E_SITE ? undefined : [
    { command: 'npm start', url: backend + '/health', env: { PORT: '4187', FRONTEND_ORIGINS: site, LOCAL_DATA_DIR: '.local/e2e-' + Date.now() }, timeout: 30_000 },
    { command: 'npm run dev -- --port 4186', url: site, env: { VITE_BACKEND_URL: backend }, timeout: 30_000 },
  ],
})
