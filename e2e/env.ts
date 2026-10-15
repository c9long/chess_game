/** Ports and database used only by the E2E run (separate from dev and unit tests). */
export const E2E_API_PORT = 3100
export const E2E_WEB_PORT = 5174
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://game:game_dev_password@localhost:5432/game_e2e_test'
