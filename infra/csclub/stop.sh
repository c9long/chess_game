#!/usr/bin/env bash
# Stops the game and keeps the watchdog from restarting it until start.sh runs again
# (docs/DEPLOY-CSCLUB.md).
#
#   stop.sh          running games may finish first (up to SHUTDOWN_DRAIN_MAX_SECONDS)
#   stop.sh --now    stop at once (running games are aborted)
#   add --all        also stop PostgreSQL (e.g. before the machine's planned reboot)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

now="" all=""
for a in "$@"; do
  case "$a" in
    --now) now=now ;;
    --all) all=1 ;;
    *) sed -n '5,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
done

ensure_dirs
load_env
touch "$RUN/stopped" # first, so the watchdog leaves everything alone from here on
take_lock wait 120
# The server first, with the tunnel still up: players reach it only through the tunnel, so
# running games can finish only while cloudflared runs (the draining server opens no new
# games). The bots stay up until the server is gone, since running games use them.
stop_server "$now"
stop_proc cloudflared 10
stop_proc bot-service 10
[ -n "$all" ] && stop_postgres
say "stopped. Start again with: $here/start.sh"
