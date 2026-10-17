#!/usr/bin/env bash
# Shows what is running (docs/DEPLOY-CSCLUB.md).
#
#   status.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

load_env
row() { printf '  %-12s %s\n' "$1" "$2"; }
if [ -L "$CURRENT" ]; then
  rel="$(readlink -f "$CURRENT")"
  echo "release:   $(cat "$rel/VERSION")  ($rel)"
  [ -L "$PREVIOUS" ] && echo "previous:  $(cat "$(readlink -f "$PREVIOUS")/VERSION" 2>/dev/null || echo '?')"
else
  echo "release:   none installed"
fi
[ -f "$RUN/stopped" ] && echo "state:     STOPPED by stop.sh (the watchdog will not restart anything)"
echo "processes:"
if db_is_local; then
  if pg_running; then row postgres "running (127.0.0.1:$PG_PORT)"; else row postgres "NOT running"; fi
else
  row postgres "external (DATABASE_URL)"
fi
for p in bot-service server cloudflared; do
  if pid="$(pid_of "$p")"; then row "$p" "running (pid $pid)"
  elif [ "$p" = cloudflared ] && [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then row "$p" "off (no CLOUDFLARE_TUNNEL_TOKEN)"
  else row "$p" "NOT running"; fi
done
if serve_web_app; then
  echo "web app:   served by this server (SERVE_WEB_APP=true; ${WEB_ORIGIN:-WEB_ORIGIN not set})"
else
  echo "web app:   elsewhere, e.g. Cloudflare Pages (SERVE_WEB_APP=false; ${WEB_ORIGIN:-WEB_ORIGIN not set})"
fi
if [ -L "$CURRENT" ] && server_healthy; then echo "health:    ok"; else echo "health:    FAILING (see $LOGS/server.log)"; fi
echo "disk:      $(df -h "$GAME_HOME" | awk 'NR==2 { print $4 " free" }'); game uses $(du -sh "$GAME_HOME" 2>/dev/null | cut -f1)"
latest="$(find "$BACKUPS" -maxdepth 1 -name 'game-*.sql.gz.age' -printf '%f\n' 2>/dev/null | sort | tail -n 1)"
echo "backup:    ${latest:-none yet}"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if [ -f "$RUN/offsite-ok" ]; then
    echo "off-site:  last upload $(date -d "@$(stat -c %Y "$RUN/offsite-ok")" '+%F %H:%M') to $BACKUP_REMOTE"
  else
    echo "off-site:  no upload yet to $BACKUP_REMOTE"
  fi
else
  echo "off-site:  not set up (BACKUP_REMOTE is empty)"
fi
