#!/usr/bin/env bash
# Nightly encrypted, off-site database backup (PLAN §9: 30-day rolling retention).
#
# Needs on the server: docker, age (https://age-encryption.org) and rclone configured with a
# remote for Cloudflare R2 or Backblaze B2 (docs/DEPLOY.md). Install from cron, e.g.:
#   15 3 * * *  /opt/game/infra/backup.sh >> /var/log/game-backup.log 2>&1
#
#   infra/backup.sh             dump, encrypt, upload, then delete remote backups older than
#                               BACKUP_RETENTION_DAYS
#   infra/backup.sh --dry-run   dump and encrypt only; keeps the file in BACKUP_DRY_RUN_DIR
#                               (default: the current directory) and never calls rclone.
#                               Use it to test the dump and your age key before setting up
#                               the remote.
#
# Settings come from infra/.env (GAME_ENV_FILE overrides the path). COMPOSE_PROJECT_NAME
# selects a non-default compose project, e.g. a test stack.
#
# Restore: see docs/DEPLOY.md ("Restoring a backup"); afterwards re-apply deletion_log so
# deleted accounts stay deleted.
set -euo pipefail

dry_run=false
case "${1:-}" in
  --dry-run) dry_run=true ;;
  "") ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

out_dir="${BACKUP_DRY_RUN_DIR:-$PWD}"
cd "$(dirname "$0")"
env_file="${GAME_ENV_FILE:-.env}"
set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT in infra/.env (an age public key)}"
if [ "${dry_run}" = false ]; then
  : "${BACKUP_REMOTE:?set BACKUP_REMOTE in infra/.env, e.g. r2:game-backups}"
fi
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
name="game-${stamp}.sql.gz.age"
if [ "${dry_run}" = true ]; then
  file="${out_dir}/${name}"
else
  file="$(mktemp -d)/${name}"
  # Never leave a partial or uploaded dump behind, even when a step fails.
  trap 'rm -rf "$(dirname "${file}")"' EXIT
fi

docker compose -f docker-compose.yml --env-file "${env_file}" exec -T postgres \
  pg_dump --format=plain --no-owner -U "${DB_USER:-game}" "${DB_NAME:-game}" \
  | gzip -9 \
  | age -r "${BACKUP_AGE_RECIPIENT}" -o "${file}"

if [ "${dry_run}" = true ]; then
  echo "$(date -u +%FT%TZ) dry run: wrote ${file} ($(wc -c < "${file}") bytes); nothing uploaded"
  exit 0
fi

rclone copy "${file}" "${BACKUP_REMOTE}/" --quiet
# Only this script's files, so other objects in the bucket are never touched.
rclone delete "${BACKUP_REMOTE}/" --include 'game-*.sql.gz.age' --min-age "${RETENTION_DAYS}d" --quiet

echo "$(date -u +%FT%TZ) backup ${stamp} uploaded; older than ${RETENTION_DAYS} days removed"
