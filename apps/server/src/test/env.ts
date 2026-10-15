/** Test database (created by `DB_NAME=game_test infra/dev-db.sh`), reset on every run. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://game:game_dev_password@localhost:5432/game_test'
