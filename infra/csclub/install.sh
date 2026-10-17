#!/usr/bin/env bash
# Installs a release made by package.sh and switches the game over to it
# (docs/DEPLOY-CSCLUB.md).
#
#   install.sh                      install the release this script came with
#   install.sh game-release-X.tar.gz  install that release file (or an unpacked directory)
#   install.sh --rollback           switch back to the previous release
#   add --now                       restart at once instead of letting running games finish
#
# Steps: unpack into ~/game/releases/<version>, install its Node.js, apply database
# migrations, stop the old server (running games may finish first, up to
# SHUTDOWN_DRAIN_MAX_SECONDS), switch ~/game/current, start everything, check health.
#
# It keeps running in the background if your SSH connection drops; progress is in
# ~/game/logs/install.log.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=lib.sh
. "$here/lib.sh"

usage() {
  sed -n '5,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

source_arg="" mode=install now=""
for a in "$@"; do
  case "$a" in
    --rollback) mode=rollback ;;
    --now) now=now ;;
    -h | --help) usage ;;
    -*) usage ;;
    *) source_arg="$a" ;;
  esac
done

ensure_dirs
load_env

# Re-run detached from the terminal, so a dropped SSH connection can't stop an install
# halfway (for example while the old server is still letting games finish).
if [ -z "${GAME_INSTALL_DETACHED:-}" ]; then
  if [ -n "$source_arg" ]; then source_arg="$(readlink -f "$source_arg")"; fi
  log="$LOGS/install.log"
  touch "$log"
  offset=$(($(stat -c %s "$log") + 1))
  args=()
  [ "$mode" = rollback ] && args+=(--rollback)
  [ -n "$now" ] && args+=(--now)
  [ -n "$source_arg" ] && args+=("$source_arg")
  detach=(nohup)
  command -v setsid >/dev/null 2>&1 && detach+=(setsid)
  GAME_INSTALL_DETACHED=1 "${detach[@]}" "$here/install.sh" "${args[@]}" >>"$log" 2>&1 </dev/null &
  pid=$!
  echo "(running in the background as pid $pid; if you disconnect it carries on. Log: $log)"
  tail -c "+$offset" -f --pid="$pid" "$log" 2>/dev/null || true
  wait "$pid" && exit 0
  status=$?
  echo "install failed (exit $status); see $log" >&2
  exit "$status"
fi

take_lock wait 120

switch_to() {
  local target="$1" old=""
  [ -L "$CURRENT" ] && old="$(readlink -f "$CURRENT")"
  if [ "$old" = "$target" ] && pid_of server >/dev/null; then
    say "release $(cat "$target/VERSION") is already running"
  else
    stop_server "$now"
    stop_proc cloudflared 10
    stop_proc bot-service 10
    if [ -n "$old" ] && [ "$old" != "$target" ]; then ln -sfn "$old" "$PREVIOUS"; fi
    ln -sfn "$target" "$CURRENT.new" && mv -T "$CURRENT.new" "$CURRENT"
    rm -f "$RUN/stopped"
    start_all
  fi
  say "waiting for the server to report healthy"
  if wait_healthy 120; then
    say "release $(cat "$target/VERSION") is live and healthy"
  else
    say "the server is not healthy. Last lines of $LOGS/server.log:"
    tail -n 30 "$LOGS/server.log" || true
    [ -L "$PREVIOUS" ] && say "to go back: $GAME_HOME/current/scripts/install.sh --rollback"
    exit 1
  fi
}

if [ "$mode" = rollback ]; then
  [ -L "$PREVIOUS" ] || die "there is no previous release to roll back to"
  target="$(readlink -f "$PREVIOUS")"
  [ -d "$target" ] || die "the previous release $target no longer exists"
  say "rolling back to release $(cat "$target/VERSION") (database migrations are not undone)"
  check_web_app "$target"
  ensure_node "$(cat "$target/NODE_VERSION")"
  switch_to "$target"
  exit 0
fi

# --- unpack -----------------------------------------------------------------------------
[ -n "$source_arg" ] || source_arg="$(cd "$here/.." && pwd)"
tmp=""
cleanup() { if [ -n "$tmp" ]; then rm -rf "$tmp"; fi; }
trap cleanup EXIT
if [ -f "$source_arg" ]; then
  tmp="$(mktemp -d "$RELEASES/.unpack.XXXXXX")"
  tar -xzf "$source_arg" -C "$tmp" || die "could not unpack $source_arg"
  src="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
elif [ -d "$source_arg" ]; then
  src="$(readlink -f "$source_arg")"
else
  die "$source_arg is neither a release file nor a release directory"
fi
for f in VERSION NODE_VERSION bin/bot-service app/apps/server/src/main.ts scripts/lib.sh; do
  [ -e "$src/$f" ] || die "$source_arg is not a complete release (missing $f). Make one with infra/csclub/package.sh"
done
version="$(cat "$src/VERSION")"
[[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad VERSION in the release: $version"
target="$RELEASES/$version"
if [ "$src" != "$target" ]; then
  if [ -d "$target" ]; then
    say "release $version is already unpacked; reusing it"
  else
    say "unpacking release $version"
    rm -rf "$target.partial"
    if [ -n "$tmp" ]; then
      mv "$src" "$target.partial"
    else
      mkdir -p "$target.partial" && cp -a "$src/." "$target.partial/"
    fi
    mv "$target.partial" "$target"
  fi
fi

# --- prepare ----------------------------------------------------------------------------
# Before anything changes: with SERVE_WEB_APP=true the release must carry the web app.
check_web_app "$target"
ensure_node "$(cat "$target/NODE_VERSION")"
node="$(node_bin "$(cat "$target/NODE_VERSION")")"
start_postgres
say "applying database migrations and seeding the catalog"
(
  cd "$target/app"
  DATABASE_URL="$(db_url)" "$node" packages/db/src/migrate-cli.ts 9>&-
  DATABASE_URL="$(db_url)" "$node" packages/db/src/seed-cli.ts 9>&-
) || die "database migration failed; the old release is still running"

switch_to "$target"

# Keep the current, the previous and the newest other release; delete older ones.
keep_cur="$(readlink -f "$CURRENT")"
keep_prev=""
if [ -L "$PREVIOUS" ]; then keep_prev="$(readlink -f "$PREVIOUS")"; fi
n=0
while IFS= read -r dir; do
  [ "$dir" = "$keep_cur" ] || [ "$dir" = "$keep_prev" ] && continue
  n=$((n + 1))
  if [ "$n" -gt 1 ]; then
    say "removing old release $(basename "$dir")"
    rm -rf "$dir"
  fi
done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '.*' ! -name '*.partial' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
