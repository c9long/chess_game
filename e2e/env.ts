/**
 * Ports and database used only by the E2E run (separate from dev and unit tests).
 * Overridable so several E2E runs can work side by side (e.g. parallel agent workflows):
 * E2E_API_PORT, E2E_WEB_PORT, E2E_DATABASE_URL. Auxiliary servers some specs start use
 * E2E_AUX_API_PORT and E2E_AUX_WEB_PORT, by default derived from these (API + 2, web + 1);
 * set them when a neighbouring port is taken by another program.
 */
export const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 3100)
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174)
export const E2E_WEB_ORIGIN = `http://localhost:${E2E_WEB_PORT}`
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://game:game_dev_password@localhost:5432/game_e2e_test'
/** Second, restartable API/web pair for specs that need one (restart-session). */
export const E2E_AUX_API_PORT = Number(process.env.E2E_AUX_API_PORT ?? E2E_API_PORT + 2)
export const E2E_AUX_WEB_PORT = Number(process.env.E2E_AUX_WEB_PORT ?? E2E_WEB_PORT + 1)
/**
 * The E2E API treats this user id as a moderation admin (ADMIN_USER_IDS). No account has it
 * until a spec creates one (moderation.spec inserts it into the E2E database).
 */
export const E2E_ADMIN_USER_ID = 'e2e-admin'
