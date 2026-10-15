import { defineConfig, devices } from '@playwright/test'

// Attack specs for the board sandbox. Expects the sandbox dev server on SANDBOX_URL
// (default http://localhost:5237): `pnpm --filter @game/board exec vite --config sandbox/vite.config.ts --port 5237`.
export default defineConfig({
  testDir: '.',
  testMatch: /attack-interaction-.*\.pw\.ts/,
  outputDir:
    '/tmp/claude-1000/-home-c9long-chess-game/bb6dac1d-5690-4e27-9699-e9c91353b39a/scratchpad/m2/attack-int-results',
  workers: 2,
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.SANDBOX_URL ?? 'http://localhost:5237',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm exec vite preview --config sandbox/vite.config.ts --outDir /tmp/claude-1000/-home-c9long-chess-game/bb6dac1d-5690-4e27-9699-e9c91353b39a/scratchpad/m2/attack-int-dist --port 5237 --strictPort',
    cwd: '..',
    url: 'http://localhost:5237',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
})
