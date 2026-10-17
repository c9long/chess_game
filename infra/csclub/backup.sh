#!/usr/bin/env bash
# Nightly encrypted database backup for the no-sudo deployment (docs/DEPLOY-CSCLUB.md).
#
#   backup.sh            dump, encrypt with age, keep BACKUP_LOCAL_DAYS days in
#                        ~/game/backups, and, if BACKUP_REMOTE is set, upload with rclone and
#                        delete remote copies older than BACKUP_RETENTION_DAYS
#   backup.sh --local    skip the upload even if BACKUP_REMOTE is set
#
# From cron:  15 3 * * *  $HOME/game/current/scripts/backup.sh >> $HOME/game/logs/backup.log 2>&1
#
# Backups are encrypted to BACKUP_AGE_RECIPIENT (an age public key). The matching private
# key must NOT be on this machine; keep it in your password manager. Restore: restore.sh.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

upload=1
case "${1:-}" in
  --local) upload=0 ;;
  "") ;;
  *) sed -n '4,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

ensure_dirs
load_env
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || die "set BACKUP_AGE_RECIPIENT in $ENV_FILE (the age1... public key from age-keygen)"
[ -x "$TOOLS/bin/age" ] || die "age is missing; run setup.sh"
[ -x "$PG_BIN/pg_dump" ] || die "pg_dump is missing; run setup.sh"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
file="$BACKUPS/game-$stamp.sql.gz.age"
part="$file.partial"
trap 'rm -f "$part"' EXIT

if db_is_local; then
  pg_running || die "postgres is not running, so there is nothing to back up (start.sh)"
  dump=("$PG_BIN/pg_dump" -h "$PG_SOCKET_DIR" -p "$PG_PORT" -d "$DB_NAME")
else
  # The password goes through the environment, not the command line (`ps` shows those).
  # shellcheck disable=SC2031 # only start_server changes it, in its own subshell
  url="$DATABASE_URL"
  if [[ "$url" =~ ^(postgres(ql)?://[^:/@]+):([^@]*)@(.*)$ ]]; then
    pw="${BASH_REMATCH[3]}"
    PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
    export PGPASSWORD
    url="${BASH_REMATCH[1]}@${BASH_REMATCH[4]}"
  fi
  dump=("$PG_BIN/pg_dump" -d "$url")
fi
"${dump[@]}" --format=plain --no-owner 9>&- | gzip -9 | "$TOOLS/bin/age" -r "$BACKUP_AGE_RECIPIENT" -o "$part"
mv "$part" "$file"
say "backup written: $file ($(stat -c %s "$file") bytes)"

find "$BACKUPS" -maxdepth 1 -name 'game-*.sql.gz.age' -mtime "+${BACKUP_LOCAL_DAYS:-7}" -delete

if [ "$upload" = 1 ] && [ -n "${BACKUP_REMOTE:-}" ]; then
  [ -x "$TOOLS/bin/rclone" ] || die "rclone is missing; run setup.sh"
  "$TOOLS/bin/rclone" copy "$file" "$BACKUP_REMOTE/" --quiet
  touch "$RUN/offsite-ok" # watchdog.sh warns when this gets old
  # Only this script's files, so other objects in the bucket are never touched.
  "$TOOLS/bin/rclone" delete "$BACKUP_REMOTE/" --include 'game-*.sql.gz.age' \
    --min-age "${BACKUP_RETENTION_DAYS:-30}d" --quiet
  say "uploaded to $BACKUP_REMOTE; remote copies older than ${BACKUP_RETENTION_DAYS:-30} days removed"
elif [ "$upload" = 1 ]; then
  say "BACKUP_REMOTE is empty: this backup exists only on this machine"
fi
