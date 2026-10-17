# shellcheck shell=bash
# Shared helpers for the no-sudo deployment scripts in infra/csclub (docs/DEPLOY-CSCLUB.md).
# Sourced by the other scripts; not meant to be run directly.
#
# Everything lives under GAME_HOME (default ~/game):
#   game.env            settings and secrets (chmod 600)
#   tools/              Node.js, PostgreSQL, cloudflared, age, rclone (downloaded, no sudo)
#   releases/<version>/ unpacked releases made by package.sh
#   current, previous   symlinks to the running and the previous release
#   data/pg/            the PostgreSQL database files
#   run/                pid files, the Postgres socket, the lock file
#   logs/               one log per process, rotated by watchdog.sh
#   backups/            encrypted nightly dumps (backup.sh)

set -euo pipefail
umask 077

GAME_HOME="${GAME_HOME:-$HOME/game}"
TOOLS="$GAME_HOME/tools"
RUN="$GAME_HOME/run"
LOGS="$GAME_HOME/logs"
DATA="$GAME_HOME/data"
RELEASES="$GAME_HOME/releases"
BACKUPS="$GAME_HOME/backups"
CURRENT="$GAME_HOME/current"
# shellcheck disable=SC2034 # used by install.sh and status.sh
PREVIOUS="$GAME_HOME/previous"
ENV_FILE="${GAME_ENV_FILE:-$GAME_HOME/game.env}"
PGDATA_DIR="$DATA/pg"

# Pinned tool versions. Checksums were taken from the official downloads (cloudflared's
# matches its GitHub release notes; rclone's matches its SHA256SUMS file).
CLOUDFLARED_VERSION=2026.9.0 # same as the image in infra/docker-compose.yml
CLOUDFLARED_SHA256=53b7a7a5420d188758d24341294acb0d1bca54296548ac05e38811a694ac6134
AGE_VERSION=1.2.1
AGE_SHA256=7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50
RCLONE_VERSION=1.71.1
RCLONE_SHA256=417e3da236f3a12d292da4e7287d67b1df558b8c2b280d092e563958ed724be7
MICROMAMBA_VERSION=2.0.5-0
MICROMAMBA_SHA256=cdf5a2e18d213617b6c5c32d8763b4e8fc05f8173b4f4017997683cb984357eb
POSTGRES_MAJOR=16 # same major version as the postgres image in infra/docker-compose.yml

export PATH="$TOOLS/bin:$PATH"

say() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed on this machine. $2"
}

ensure_dirs() {
  mkdir -p "$GAME_HOME" "$TOOLS/bin" "$RUN" "$LOGS" "$DATA" "$RELEASES" "$BACKUPS"
  chmod 700 "$GAME_HOME" "$RUN" "$DATA" "$BACKUPS"
}

# --- settings ---------------------------------------------------------------------------

load_env() {
  [ -f "$ENV_FILE" ] || die "settings file $ENV_FILE not found. Run setup.sh first."
  local mode
  mode="$(stat -c %a "$ENV_FILE")"
  if [ "${mode: -2}" != "00" ]; then
    chmod 600 "$ENV_FILE" || die "$ENV_FILE is readable by other users; run: chmod 600 $ENV_FILE"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  SERVER_PORT="${SERVER_PORT:-39300}"
  BOT_PORT="${BOT_PORT:-39301}"
  PG_PORT="${PG_PORT:-39302}"
  DB_NAME="${DB_NAME:-game}"
  DB_USER="${DB_USER:-game}"
  BOT_WORKERS="${BOT_WORKERS:-2}"
  PG_BIN="${PG_BIN:-$TOOLS/pg/bin}"
  # Unix socket paths are limited to 107 bytes; set PG_SOCKET_DIR to a short path (e.g.
  # /tmp/$USER-game-pg) if GAME_HOME is deeply nested.
  PG_SOCKET_DIR="${PG_SOCKET_DIR:-$RUN/pg}"
}

# A DATABASE_URL in game.env means an external database (e.g. the CSC's `ceo postgresql`
# service); otherwise the scripts run their own PostgreSQL on 127.0.0.1:PG_PORT.
db_is_local() { [ -z "${DATABASE_URL:-}" ]; }

db_url() {
  if db_is_local; then
    [ -n "${DB_PASSWORD:-}" ] || die "DB_PASSWORD is empty in $ENV_FILE"
    # It goes into a URL and into SQL unescaped, so letters, digits, - and _ only.
    [[ "$DB_PASSWORD" =~ ^[A-Za-z0-9_-]+$ ]] ||
      die "DB_PASSWORD in $ENV_FILE may contain only letters, digits, - and _"
    [[ "$DB_USER$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] ||
      die "DB_USER and DB_NAME in $ENV_FILE may contain only letters, digits and _"
    printf 'postgres://%s:%s@127.0.0.1:%s/%s' "$DB_USER" "$DB_PASSWORD" "$PG_PORT" "$DB_NAME"
  else
    printf '%s' "$DATABASE_URL"
  fi
}

# --- downloads --------------------------------------------------------------------------

# download URL DEST [SHA256]
download() {
  local url="$1" dest="$2" sum="${3:-}" tmp
  tmp="$(mktemp "$dest.XXXXXX")"
  if ! curl -fsSL --retry 3 --connect-timeout 20 -o "$tmp" "$url"; then
    rm -f "$tmp"
    die "download failed: $url (is the machine online?)"
  fi
  if [ -n "$sum" ] && ! echo "$sum  $tmp" | sha256sum -c --status -; then
    rm -f "$tmp"
    die "checksum mismatch for $url; refusing to use it"
  fi
  mv "$tmp" "$dest"
}

require_x86_64() {
  [ "$(uname -m)" = x86_64 ] || die "these scripts download x86_64 (amd64) programs; this machine is $(uname -m)"
}

node_bin() { printf '%s/node-v%s/bin/node' "$TOOLS" "$1"; }

# ensure_node VERSION: the exact Node.js the release was built and tested with.
ensure_node() {
  local ver="$1" dir="$TOOLS/node-v$1" name="node-v$1-linux-x64.tar.gz" tmp sums want
  [ -x "$dir/bin/node" ] && return 0
  say "installing Node.js $ver into $dir"
  tmp="$(mktemp -d "$TOOLS/.download.XXXXXX")"
  download "https://nodejs.org/dist/v$ver/SHASUMS256.txt" "$tmp/SHASUMS256.txt"
  sums="$tmp/SHASUMS256.txt"
  want="$(awk -v n="$name" '$2 == n { print $1 }' "$sums")"
  [ -n "$want" ] || die "Node.js $ver has no $name download"
  download "https://nodejs.org/dist/v$ver/$name" "$tmp/$name" "$want"
  mkdir -p "$tmp/x"
  tar -xzf "$tmp/$name" -C "$tmp/x"
  rm -rf "$dir"
  mv "$tmp/x/node-v$ver-linux-x64" "$dir"
  rm -rf "$tmp"
}

ensure_cloudflared() {
  local dest="$TOOLS/bin/cloudflared"
  if [ -x "$dest" ] && "$dest" --version 2>/dev/null | grep -q "$CLOUDFLARED_VERSION"; then return 0; fi
  say "installing cloudflared $CLOUDFLARED_VERSION"
  download "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/cloudflared-linux-amd64" \
    "$dest" "$CLOUDFLARED_SHA256"
  chmod 755 "$dest"
}

ensure_age() {
  if [ -x "$TOOLS/bin/age" ] && "$TOOLS/bin/age" --version 2>/dev/null | grep -q "$AGE_VERSION"; then return 0; fi
  say "installing age $AGE_VERSION"
  local tmp
  tmp="$(mktemp -d "$TOOLS/.download.XXXXXX")"
  download "https://github.com/FiloSottile/age/releases/download/v$AGE_VERSION/age-v$AGE_VERSION-linux-amd64.tar.gz" \
    "$tmp/age.tgz" "$AGE_SHA256"
  tar -xzf "$tmp/age.tgz" -C "$tmp"
  install -m 755 "$tmp/age/age" "$tmp/age/age-keygen" "$TOOLS/bin/"
  rm -rf "$tmp"
}

ensure_rclone() {
  if [ -x "$TOOLS/bin/rclone" ] && "$TOOLS/bin/rclone" version 2>/dev/null | grep -q "v$RCLONE_VERSION"; then return 0; fi
  say "installing rclone $RCLONE_VERSION"
  local tmp name="rclone-v$RCLONE_VERSION-linux-amd64"
  tmp="$(mktemp -d "$TOOLS/.download.XXXXXX")"
  download "https://downloads.rclone.org/v$RCLONE_VERSION/$name.zip" "$tmp/rclone.zip" "$RCLONE_SHA256"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$tmp/rclone.zip" -d "$tmp"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I -m zipfile -e "$tmp/rclone.zip" "$tmp"
  else
    rm -rf "$tmp"
    say "warning: neither unzip nor python3 is available, so rclone was not installed (off-site backup upload disabled)"
    return 0
  fi
  install -m 755 "$tmp/$name/rclone" "$TOOLS/bin/rclone"
  rm -rf "$tmp"
}

# PostgreSQL without sudo: conda-forge's build, installed with micromamba into tools/pg.
ensure_postgres_bin() {
  if [ -x "$PG_BIN/pg_ctl" ] && [ -x "$PG_BIN/pg_dump" ]; then return 0; fi
  [ "$PG_BIN" = "$TOOLS/pg/bin" ] || die "PG_BIN=$PG_BIN has no pg_ctl/pg_dump"
  local mm="$TOOLS/bin/micromamba"
  if ! [ -x "$mm" ]; then
    say "installing micromamba $MICROMAMBA_VERSION (used only to fetch PostgreSQL)"
    download "https://github.com/mamba-org/micromamba-releases/releases/download/$MICROMAMBA_VERSION/micromamba-linux-64" \
      "$mm" "$MICROMAMBA_SHA256"
    chmod 755 "$mm"
  fi
  say "installing PostgreSQL $POSTGRES_MAJOR into $TOOLS/pg (a few minutes)"
  MAMBA_ROOT_PREFIX="$TOOLS/mamba" "$mm" create --yes --quiet --prefix "$TOOLS/pg" \
    --override-channels --channel conda-forge "postgresql=$POSTGRES_MAJOR" >/dev/null ||
    die "could not install PostgreSQL with micromamba (see the output above)"
  MAMBA_ROOT_PREFIX="$TOOLS/mamba" "$mm" clean --all --yes >/dev/null 2>&1 || true
  [ -x "$PG_BIN/pg_ctl" ] || die "PostgreSQL install finished but $PG_BIN/pg_ctl is missing"
}

# --- processes --------------------------------------------------------------------------
#
# Each long-running process has run/<name>.pid. A pid counts only while that process is
# alive AND its command line still contains the expected marker, so a pid reused by an
# unrelated process after a reboot is never mistaken for ours.

marker_for() {
  case "$1" in
    server) echo "apps/server/src/main.ts" ;;
    bot-service) echo "bin/bot-service" ;;
    cloudflared) echo "cloudflared" ;;
    *) die "unknown process $1" ;;
  esac
}

pid_of() {
  local f="$RUN/$1.pid" pid
  [ -f "$f" ] || return 1
  pid="$(cat "$f" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -qF -- "$(marker_for "$1")" || return 1
  echo "$pid"
}

# clean_env NAME...: in a subshell, drop every exported variable except the basics and the
# names given, so each process sees only the settings it needs (the bot and the tunnel never
# see the auth secrets; the server never sees the tunnel token or backup settings).
clean_env() {
  local v keep=" PATH HOME USER LOGNAME LANG LC_ALL TZ $* "
  for v in $(compgen -e); do
    case "$keep" in
      *" $v "*) ;;
      *) unset "$v" 2>/dev/null || true ;;
    esac
  done
}

# The server's settings: every name in game.env except the ones meant for other processes.
server_env_names() {
  grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | tr -d = |
    grep -vxE 'CLOUDFLARE_TUNNEL_TOKEN|BACKUP_[A-Z_]*|ALERT_[A-Z_]*|DB_PASSWORD|DB_USER|DB_NAME|PG_[A-Z_]*|SERVER_PORT|BOT_PORT|BOT_WORKERS|LOG_MAX_MB|COMPOSE_PROFILES' || true
}

# launch NAME LOGFILE CMD...: start CMD detached from the terminal (it survives logout and
# the cron job that started it). fd 9 (the lock) is closed so the child never holds it.
launch() {
  local name="$1" log="$2"
  shift 2
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid "$@" >>"$log" 2>&1 </dev/null 9>&- &
  else
    nohup "$@" >>"$log" 2>&1 </dev/null 9>&- &
  fi
  echo $! >"$RUN/$name.pid"
  date +%s >>"$RUN/$name.starts"
  tail -n 20 "$RUN/$name.starts" >"$RUN/$name.starts.tmp" && mv "$RUN/$name.starts.tmp" "$RUN/$name.starts"
}

release_dir() {
  [ -L "$CURRENT" ] || die "no release installed yet. Run install.sh with a release first."
  readlink -f "$CURRENT"
}

# Not `pg_ctl status`: that only checks that the pid in postmaster.pid is alive. After a
# reboot the pid can belong to another of our processes (cron starts the same things in the
# same order every boot), and then postgres would never be started again.
pg_pid() {
  local pid
  pid="$(head -n 1 "$PGDATA_DIR/postmaster.pid" 2>/dev/null)" || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q postgres || return 1
  echo "$pid"
}
pg_running() { pg_pid >/dev/null; }

start_postgres() {
  db_is_local || return 0
  [ -f "$PGDATA_DIR/PG_VERSION" ] || die "no database in $PGDATA_DIR. Run setup.sh first."
  pg_running && return 0
  # Left over from a crash or reboot (no postgres runs with that pid). PostgreSQL itself
  # refuses to start while the old pid happens to be alive, so remove the stale lock files.
  if [ -f "$PGDATA_DIR/postmaster.pid" ]; then
    say "removing a stale postgres lock file (left over from a crash or reboot)"
    rm -f "$PGDATA_DIR/postmaster.pid" "$PG_SOCKET_DIR"/.s.PGSQL."$PG_PORT".lock
  fi
  [ $((${#PG_SOCKET_DIR} + 18)) -le 107 ] ||
    die "the socket path $PG_SOCKET_DIR is too long for PostgreSQL; set PG_SOCKET_DIR=/tmp/$(id -un)-game-pg in $ENV_FILE"
  mkdir -p "$PG_SOCKET_DIR"
  chmod 700 "$PG_SOCKET_DIR"
  say "starting postgres on 127.0.0.1:$PG_PORT"
  # listen_addresses (127.0.0.1 only) is in postgresql.conf (setup.sh). Port and socket come
  # from game.env, so changing them needs no other edit.
  "$PG_BIN/pg_ctl" start -D "$PGDATA_DIR" -l "$LOGS/postgres.log" -w -t 120 -s \
    -o "-p $PG_PORT -k '$PG_SOCKET_DIR'" 9>&- ||
    die "postgres did not start; see $LOGS/postgres.log"
}

stop_postgres() {
  db_is_local || return 0
  pg_running || return 0
  say "stopping postgres"
  "$PG_BIN/pg_ctl" stop -D "$PGDATA_DIR" -m fast -w -t 120 -s
}

start_bot() {
  pid_of bot-service >/dev/null && return 0
  local rel
  rel="$(release_dir)"
  say "starting bot-service on 127.0.0.1:$BOT_PORT ($BOT_WORKERS workers)"
  (
    local bind="127.0.0.1:$BOT_PORT" workers="$BOT_WORKERS"
    clean_env
    export BOT_BIND="$bind" BOT_WORKERS="$workers" BOT_LOG_FORMAT=json BOT_LOG=info
    # Lower CPU priority: searches never starve the game server (or other users of the box).
    launch bot-service "$LOGS/bot-service.log" nice -n 10 "$rel/bin/bot-service"
  )
}

start_server() {
  pid_of server >/dev/null && return 0
  local rel node url
  rel="$(release_dir)"
  node="$(node_bin "$(cat "$rel/NODE_VERSION")")"
  [ -x "$node" ] || die "Node.js $(cat "$rel/NODE_VERSION") is missing; run install.sh again"
  url="$(db_url)"
  say "starting server on 127.0.0.1:$SERVER_PORT (release $(cat "$rel/VERSION"))"
  (
    cd "$rel/app"
    local port="$SERVER_PORT" bot_url="http://127.0.0.1:$BOT_PORT"
    # shellcheck disable=SC2046 # one variable name per word
    clean_env $(server_env_names)
    export NODE_ENV=production HOST=127.0.0.1 PORT="$port" DATABASE_URL="$url" \
      BOT_SERVICE_URL="$bot_url" TRUST_CLOUDFLARE=true RATE_LIMIT_ENABLED=true
    launch server "$LOGS/server.log" "$node" "$rel/app/apps/server/src/main.ts"
  )
}

start_tunnel() {
  [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ] || return 0
  pid_of cloudflared >/dev/null && return 0
  say "starting cloudflared (Cloudflare Tunnel)"
  (
    local token="$CLOUDFLARE_TUNNEL_TOKEN"
    clean_env
    # The token goes in the environment, not the command line: other users can read command
    # lines with `ps`, but not another user's environment.
    export TUNNEL_TOKEN="$token"
    launch cloudflared "$LOGS/cloudflared.log" "$TOOLS/bin/cloudflared" tunnel --no-autoupdate run
  )
}

# stop_proc NAME TIMEOUT_SECONDS: SIGTERM, wait, then a second SIGTERM and finally SIGKILL.
stop_proc() {
  local name="$1" timeout="$2" pid i=0
  pid="$(pid_of "$name")" || {
    rm -f "$RUN/$name.pid"
    return 0
  }
  kill -TERM "$pid" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$i" -ge "$timeout" ]; then
      say "$name did not exit after ${timeout}s; forcing it"
      kill -TERM "$pid" 2>/dev/null || true # the server treats a second signal as "exit now"
      sleep 5
      kill -KILL "$pid" 2>/dev/null || true
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  rm -f "$RUN/$name.pid"
}

# stop_server [now]: by default running games may finish (up to SHUTDOWN_DRAIN_MAX_SECONDS).
stop_server() {
  pid_of server >/dev/null || return 0
  if [ "${1:-}" = now ]; then
    say "stopping server now (running games are aborted)"
    stop_proc server 10
  else
    local drain="${SHUTDOWN_DRAIN_MAX_SECONDS:-2700}"
    say "stopping server: no new games; running games may finish (up to $((drain / 60)) min)"
    stop_proc server "$((drain + 60))"
  fi
}

server_healthy() {
  local rel node
  rel="$(release_dir)"
  node="$(node_bin "$(cat "$rel/NODE_VERSION")")"
  "$node" -e "fetch('http://127.0.0.1:$SERVER_PORT/api/health',{signal:AbortSignal.timeout(5000)}).then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))" 9>&-
}

wait_healthy() {
  local i
  for i in $(seq 1 "${1:-90}"); do
    server_healthy && return 0
    pid_of server >/dev/null || return 1
    sleep 1
  done
  return 1
}

start_all() {
  start_postgres
  start_bot
  start_server
  start_tunnel
}

# --- locking ----------------------------------------------------------------------------
# One script at a time changes processes: install, start, stop, restore and the watchdog.

take_lock() {
  exec 9>"$RUN/lock"
  if [ "${1:-wait}" = nowait ]; then
    flock -n 9
  else
    flock -w "${2:-60}" 9 || die "another game script (install, restore, backup or the watchdog) is running; try again in a minute"
  fi
}
