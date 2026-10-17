#!/usr/bin/env bash
# Keeps the game running (docs/DEPLOY-CSCLUB.md). Cron runs it every minute:
#   * * * * * $HOME/game/current/scripts/watchdog.sh
#
# The subshells "( ... )" below keep one failing step from ending the whole check.
#
# Each run: starts anything that died, restarts the server if /api/health has failed 3
# minutes in a row, backs off when something keeps crashing, rotates big logs and warns
# when the disk is nearly full or the nightly backup has stopped working. It does nothing after stop.sh, or while install.sh,
# restore.sh or start.sh is working.
#
# Its log is ~/game/logs/watchdog.log. Only alerts (restarts, crash loops, low disk, failed
# backups) are also printed, so cron emails you those if the crontab has
# MAILTO=you@example.com.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

[ -d "$RUN" ] || exit 0
[ -f "$RUN/stopped" ] && exit 0
[ -L "$CURRENT" ] || exit 0
take_lock nowait || exit 0
load_env

log="$LOGS/watchdog.log"
alert() {
  say "$*" >>"$log"
  say "$*"
  notify "$*"
}
# Optional push alert (ALERT_WEBHOOK_URL in game.env): a Discord webhook gets JSON, any other
# URL (e.g. https://ntfy.sh/<secret-topic>) the plain text. The URL goes to curl on stdin,
# not the command line, because other users can read command lines with `ps`.
notify() {
  local url="${ALERT_WEBHOOK_URL:-}" msg
  [ -n "$url" ] || return 0
  msg="$(hostname -s 2>/dev/null || echo server): $*"
  if [[ "$url" == https://discord.com/api/webhooks/* || "$url" == https://discordapp.com/api/webhooks/* ]]; then
    msg="$(printf '%s' "$msg" | sed 's/[\\"]/\\&/g')"
    printf 'url = "%s"\n' "$url" | curl -fsS -m 15 -K - -H 'Content-Type: application/json' \
      --data-binary "{\"content\":\"$msg\"}" >/dev/null 2>>"$log" || note "could not send the alert to ALERT_WEBHOOK_URL"
  else
    printf 'url = "%s"\n' "$url" | curl -fsS -m 15 -K - --data-binary "$msg" >/dev/null 2>>"$log" ||
      note "could not send the alert to ALERT_WEBHOOK_URL"
  fi
}
note() { say "$*" >>"$log"; }

# Too many starts recently? 5 starts in 15 minutes = crash loop: then try only every 10
# minutes, and alert once instead of every minute.
crash_looping() {
  local name="$1" f="$RUN/$1.starts" now recent last
  [ -f "$f" ] || return 1
  now="$(date +%s)"
  recent="$(awk -v t=$((now - 900)) '$1 >= t' "$f" | wc -l)"
  [ "$recent" -ge 5 ] || {
    rm -f "$RUN/$name.looping"
    return 1
  }
  last="$(tail -n 1 "$f")"
  if [ ! -f "$RUN/$name.looping" ]; then
    touch "$RUN/$name.looping"
    alert "$name keeps crashing ($recent starts in 15 min); retrying every 10 min. Check $LOGS/$name.log"
  fi
  [ $((now - last)) -lt 600 ]
}

revive() {
  local name="$1" fn="$2"
  if [ "$name" = cloudflared ] && [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then return 0; fi
  pid_of "$name" >/dev/null && return 0
  crash_looping "$name" && return 0
  alert "$name was not running; starting it"
  if [ -f "$LOGS/$name.log" ]; then tail -n 5 "$LOGS/$name.log" | sed 's/^/    | /' >>"$log"; fi
  ("$fn") >>"$log" 2>&1 || alert "starting $name failed; see $log"
}

if db_is_local && ! pg_running; then
  alert "postgres was not running; starting it"
  (start_postgres) >>"$log" 2>&1 || alert "starting postgres failed; see $LOGS/postgres.log"
fi
revive bot-service start_bot
revive server start_server
revive cloudflared start_tunnel

# Health: a server that runs but stops answering (or loses the database) is restarted after
# 3 failed checks in a row. Skipped for 2 minutes after a start.
fails_f="$RUN/health-fails"
if pid_of server >/dev/null; then
  age=$(($(date +%s) - $(stat -c %Y "$RUN/server.pid")))
  if [ "$age" -gt 120 ]; then
    if server_healthy; then
      rm -f "$fails_f" "$RUN/server.looping"
    else
      fails=$(($(cat "$fails_f" 2>/dev/null || echo 0) + 1))
      echo "$fails" >"$fails_f"
      note "health check failed ($fails in a row)"
      if [ "$fails" -ge 3 ]; then
        alert "server failed its health check 3 minutes in a row; restarting it"
        rm -f "$fails_f"
        (stop_server now) >>"$log" 2>&1 || true
        (start_server) >>"$log" 2>&1 || alert "restarting the server failed; see $log"
      fi
    fi
  fi
fi

# Log rotation: anything over LOG_MAX_MB (default 20) is moved to .1 (keeping .1-.3).
# The processes append to their logs, so emptying the file in place is safe.
max=$((${LOG_MAX_MB:-20} * 1024 * 1024))
for f in "$LOGS"/*.log; do
  [ -f "$f" ] || continue
  [ "$(stat -c %s "$f")" -gt "$max" ] || continue
  rm -f "$f.3"
  [ -f "$f.2" ] && mv "$f.2" "$f.3"
  [ -f "$f.1" ] && mv "$f.1" "$f.2"
  cp "$f" "$f.1" && : >"$f"
  note "rotated $f"
done

# Disk: warn (once a day) below 1 GB free.
free_kb="$(df -Pk "$GAME_HOME" | awk 'NR==2 { print $4 }')"
if [ "${free_kb:-0}" -lt 1048576 ]; then
  today="$(date +%F)"
  if [ "$(cat "$RUN/disk-warned" 2>/dev/null || true)" != "$today" ]; then
    echo "$today" >"$RUN/disk-warned"
    alert "low disk space: $((free_kb / 1024)) MB free for $GAME_HOME"
  fi
fi

# Backups: backup.sh runs from cron and its errors only reach backup.log, so warn (once a
# day) when there has been no backup, or no off-site upload, for 2 days. The clock starts
# when the watchdog first runs, so a fresh install gets 2 days to set backups up.
[ -f "$RUN/backup-watch" ] || touch "$RUN/backup-watch"
if [ -n "$(find "$RUN/backup-watch" -mmin +2880 -print)" ]; then
  problem=""
  if [ -z "$(find "$BACKUPS" -maxdepth 1 -name 'game-*.sql.gz.age' -mmin -2880 -print -quit)" ]; then
    problem="no backup in the last 2 days (is BACKUP_AGE_RECIPIENT set? see $LOGS/backup.log)"
  elif [ -n "${BACKUP_REMOTE:-}" ] && [ -z "$(find "$RUN/offsite-ok" -mmin -2880 -print 2>/dev/null)" ]; then
    problem="no off-site backup upload in the last 2 days (see $LOGS/backup.log)"
  fi
  if [ -n "$problem" ] && [ "$(cat "$RUN/backup-warned" 2>/dev/null || true)" != "$(date +%F)" ]; then
    date +%F >"$RUN/backup-warned"
    alert "$problem"
  fi
fi
exit 0
