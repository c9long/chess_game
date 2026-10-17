#!/usr/bin/env bash
# One-time setup of a Linux machine where you have no sudo (docs/DEPLOY-CSCLUB.md).
# Safe to run again: every step checks what is already done.
#
#   scripts/setup.sh
#
# It creates ~/game (or $GAME_HOME), writes ~/game/game.env with fresh random secrets,
# downloads cloudflared, age, rclone and PostgreSQL into ~/game/tools, and creates the
# database. It never needs root and never touches anything outside ~/game.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

[ "$(id -u)" -ne 0 ] || die "run this as your normal user, not root"
require_x86_64
for c in curl tar gzip sha256sum flock awk sed od; do
  need_cmd "$c" "Ask the machine's admins (syscom) to install it."
done
command -v setsid >/dev/null 2>&1 ||
  say "note: 'setsid' is missing; processes will be started with nohup only (still fine)"

ensure_dirs

# --- settings file -----------------------------------------------------------------------
random_hex() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$here/game.env.example" ] || die "game.env.example not found next to setup.sh"
  cp "$here/game.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  sed -i \
    -e "s/^DB_PASSWORD=$/DB_PASSWORD=$(random_hex)/" \
    -e "s/^BETTER_AUTH_SECRET=$/BETTER_AUTH_SECRET=$(random_hex)/" \
    -e "s/^IP_HASH_SECRET=$/IP_HASH_SECRET=$(random_hex)/" \
    "$ENV_FILE"
  say "created $ENV_FILE with new random secrets (save a copy in your password manager)"
  created_env=1
fi
load_env

# --- tools -------------------------------------------------------------------------------
ensure_cloudflared
ensure_age
ensure_rclone
# pg_dump is needed for backups even with an external database.
ensure_postgres_bin

# --- ports -------------------------------------------------------------------------------
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
check_port() {
  local name="$1" port="$2" ours="$3"
  if [ "$ours" = yes ]; then return 0; fi
  if port_busy "$port"; then
    die "port $port ($name) is already used by another program on this machine. Pick another free port for $(echo "$name" | tr a-z- A-Z_)_PORT in $ENV_FILE and run setup.sh again."
  fi
}
check_port server "$SERVER_PORT" "$(pid_of server >/dev/null && echo yes || echo no)"
check_port bot "$BOT_PORT" "$(pid_of bot-service >/dev/null && echo yes || echo no)"

# --- database ----------------------------------------------------------------------------
if db_is_local; then
  db_url >/dev/null # validates DB_USER, DB_NAME and DB_PASSWORD
  if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
    check_port pg "$PG_PORT" no
    say "creating the database cluster in $PGDATA_DIR"
    mkdir -p "$PGDATA_DIR"
    chmod 700 "$PGDATA_DIR"
    # Local socket: only this OS user (peer). TCP: 127.0.0.1 with a password (scram), because
    # on a shared machine other users can reach 127.0.0.1 too.
    "$PG_BIN/initdb" -D "$PGDATA_DIR" --encoding=UTF8 --no-locale \
      --auth-local=peer --auth-host=scram-sha-256 >"$LOGS/initdb.log" 2>&1 ||
      die "initdb failed; see $LOGS/initdb.log"
    cat >>"$PGDATA_DIR/postgresql.conf" <<CONF

# --- added by infra/csclub/setup.sh ---
listen_addresses = '127.0.0.1'
# Small, shared machine: modest memory, and logs go to ~/game/logs/postgres.log.
shared_buffers = 128MB
max_connections = 50
CONF
  fi
  start_postgres
  psql_su() { "$PG_BIN/psql" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
  # Role and database, idempotently. The password always follows game.env.
  if [ "$(psql_su -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" != 1 ]; then
    psql_su -c "CREATE ROLE \"$DB_USER\" LOGIN"
  fi
  # Through stdin, not -c/-v: other users can read command lines with `ps`.
  psql_su <<<"ALTER ROLE \"$DB_USER\" PASSWORD '$DB_PASSWORD';"
  if [ "$(psql_su -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != 1 ]; then
    psql_su -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\""
    say "created database $DB_NAME"
  fi
else
  say "using the external database in DATABASE_URL (no private PostgreSQL)"
fi

cat <<EOF

Setup finished. Everything lives in $GAME_HOME.
EOF
if [ "${created_env:-0}" = 1 ]; then
  cat <<EOF

Next:
  1. Fill in the rest of $ENV_FILE (domains, tunnel token, Turnstile, Resend,
     BACKUP_AGE_RECIPIENT):   nano $ENV_FILE
  2. Install the release:     $here/install.sh
EOF
else
  cat <<EOF

Next: install or update the release with  $here/install.sh
EOF
fi
