#!/usr/bin/env bash
# Restores a backup made by backup.sh (docs/DEPLOY-CSCLUB.md). THIS REPLACES ALL CURRENT
# GAME DATA with the backup's.
#
#   restore.sh BACKUP_FILE AGE_KEY_FILE
#
#   BACKUP_FILE   a game-<date>.sql.gz.age file (from ~/game/backups or downloaded with
#                 rclone copy <remote>/game-<date>.sql.gz.age .)
#   AGE_KEY_FILE  the private key from age-keygen (from your password manager). Delete it
#                 from this machine afterwards.
#
# Steps: decrypt and check the file, stop the server at once, recreate the database, load
# the dump, apply newer database migrations, re-delete accounts deleted since the backup
# (privacy law), start the server.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

[ $# -eq 2 ] || { sed -n '4,10p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
backup="$1" key="$2"
[ -f "$backup" ] || die "backup file $backup not found"
[ -f "$key" ] || die "key file $key not found"

ensure_dirs
load_env
db_is_local || die "restore.sh restores the private PostgreSQL only; with an external DATABASE_URL, restore with psql by hand (see the guide)"

# The decrypted dump stays in ~/game/run (only you can read it; /tmp may be small or shared).
tmp="$(mktemp -d "$RUN/restore.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
say "decrypting $backup"
"$TOOLS/bin/age" -d -i "$key" "$backup" | gunzip >"$tmp/restore.sql" ||
  die "could not decrypt/unpack the backup (wrong key file?)"
grep -q 'PostgreSQL database dump complete' "$tmp/restore.sql" ||
  die "the backup looks incomplete (no 'dump complete' line); not restoring it"

echo
echo "This deletes ALL current game data and replaces it with $(basename "$backup")."
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = RESTORE ] || die "cancelled; nothing was changed"

take_lock wait 120
touch "$RUN/stopped" # keep the watchdog away while the database is down
# From here on a failure leaves the game stopped; say so instead of exiting silently.
on_fail() {
  local rc=$?
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] && return 0
  printf '\nerror: the restore did not finish (exit %s). The game is STOPPED and the database may\n' "$rc" >&2
  printf 'be half-loaded. Fix the error above and run restore.sh again, or bring the game back\n' >&2
  printf 'as it is with: %s/start.sh\n' "$here" >&2
}
trap on_fail EXIT
stop_proc cloudflared 10
stop_server now
start_postgres
psql_su() { "$PG_BIN/psql" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -v ON_ERROR_STOP=1 -q "$@"; }
say "recreating database $DB_NAME"
"$PG_BIN/dropdb" -h "$PG_SOCKET_DIR" -p "$PG_PORT" --force --if-exists "$DB_NAME"
"$PG_BIN/createdb" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -O "$DB_USER" "$DB_NAME"
say "loading the backup"
# As the database owner, so every restored table belongs to the game's role.
psql_su -d "$DB_NAME" -c "SET ROLE \"$DB_USER\"" -f "$tmp/restore.sql" >/dev/null
rel="$(release_dir)"
node="$(node_bin "$(cat "$rel/NODE_VERSION")")"
url="$(db_url)"
# A backup made before the latest update lacks that update's database changes; apply them
# (only the missing ones) so the running release finds the tables it expects.
say "applying database migrations made since the backup"
(
  cd "$rel/app"
  DATABASE_URL="$url" "$node" packages/db/src/migrate-cli.ts 9>&-
  DATABASE_URL="$url" "$node" packages/db/src/seed-cli.ts 9>&-
)
say "re-deleting accounts deleted after the backup was taken"
(
  cd "$rel/app"
  DATABASE_URL="$url" "$node" apps/server/src/jobs/reapply-deletions-cli.ts 9>&-
)
trap 'rm -rf "$tmp"' EXIT # the data is restored; from here on it is a normal start
rm -f "$RUN/stopped"
start_all
if wait_healthy 90; then
  say "restore finished; the game is running again"
else
  say "restore finished but the server is not healthy; see $LOGS/server.log"
  exit 1
fi
