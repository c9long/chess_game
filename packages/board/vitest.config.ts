import { defineConfig } from 'vitest/config'

// Unit tests only. Playwright specs live in e2e/ and run with their own config.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
