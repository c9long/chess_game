#!/usr/bin/env bash
# Starts whatever part of the game is not running (docs/DEPLOY-CSCLUB.md). Safe to run any
# time; cron runs it at boot (@reboot). Also clears a previous stop.sh.
#
#   start.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

ensure_dirs
load_env
take_lock wait 120
rm -f "$RUN/stopped" "$RUN"/*.starts "$RUN"/*.looping # a manual start resets the crash-loop backoff
start_all
if wait_healthy 90; then
  say "the game is running (http://127.0.0.1:$SERVER_PORT/api/health is ok)"
else
  say "the server did not become healthy; last lines of $LOGS/server.log:"
  tail -n 30 "$LOGS/server.log" || true
  exit 1
fi
