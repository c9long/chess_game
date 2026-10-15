import { defineConfig, devices } from '@playwright/test'
import { E2E_API_PORT, E2E_WEB_ORIGIN, E2E_WEB_PORT } from './env.ts'

export default defineConfig({
  testDir: './tests',
  // Flows share one server-side rate limiter keyed by client IP (all 127.0.0.1 here).
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: E2E_WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node start-server.ts',
      url: `http://127.0.0.1:${E2E_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: `pnpm --filter @game/web exec vite --port ${E2E_WEB_PORT} --strictPort`,
      url: E2E_WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${E2E_API_PORT}` },
    },
  ],
})
