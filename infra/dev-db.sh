#!/usr/bin/env bash
# Creates the local development database and role on an existing PostgreSQL install.
# Requires the current OS user to be a PostgreSQL superuser (peer auth), which is the
# default for a WSL/Ubuntu dev box where the user created their own role.
set -euo pipefail

DB_NAME="${DB_NAME:-game_dev}"
DB_USER="${DB_USER:-game}"
DB_PASSWORD="${DB_PASSWORD:-game_dev_password}"

psql -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

if ! psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
fi

echo "DATABASE_URL=postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
