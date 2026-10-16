#!/usr/bin/env bash
# Nightly encrypted, off-site database backup (PLAN §9: 30-day rolling retention).
#
# Needs on the server: docker, age (https://age-encryption.org) and rclone configured with a
# remote for Cloudflare R2 or Backblaze B2 (docs/DEPLOY.md). Install from cron, e.g.:
#   15 3 * * *  /opt/game/infra/backup.sh >> /var/log/game-backup.log 2>&1
#
# Restore: see docs/DEPLOY.md ("Restoring a backup"); afterwards re-apply deletion_log so
# deleted accounts stay deleted.
set -euo pipefail

cd "$(dirname "$0")"
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${BACKUP_REMOTE:?set BACKUP_REMOTE in infra/.env, e.g. r2:game-backups}"
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT in infra/.env (an age public key)}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
file="/tmp/game-${stamp}.sql.gz.age"

docker compose -f docker-compose.yml --env-file .env exec -T postgres \
  pg_dump --format=plain --no-owner -U "${DB_USER:-game}" "${DB_NAME:-game}" \
  | gzip -9 \
  | age -r "${BACKUP_AGE_RECIPIENT}" -o "${file}"

rclone copy "${file}" "${BACKUP_REMOTE}/" --quiet
rm -f "${file}"
rclone delete "${BACKUP_REMOTE}/" --min-age "${RETENTION_DAYS}d" --quiet

echo "$(date -u +%FT%TZ) backup ${stamp} uploaded; older than ${RETENTION_DAYS} days removed"
