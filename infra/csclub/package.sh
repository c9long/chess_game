#!/usr/bin/env bash
# Builds a release file for the no-sudo deployment (docs/DEPLOY-CSCLUB.md). Run it on YOUR
# computer (anywhere with git and Docker), not on the server:
#
#   infra/csclub/package.sh            package the latest commit (HEAD)
#   infra/csclub/package.sh <commit>   package another commit, branch or tag
#
# Output: dist/csclub/game-release-<commit>.tar.gz (about 20 MB), containing
#   app/              the game server with its production node_modules and the rules engine
#                     (WebAssembly), exactly as in the server Docker image
#   bin/bot-service   the bot engine (a Linux x86_64 program)
#   scripts/          setup.sh, install.sh, ... (this folder)
#   VERSION, NODE_VERSION
#
# Only committed code is packaged (a clean `git archive`), so half-finished local edits
# never reach the server. The build uses the same Dockerfiles as the Docker deployment, so
# the server needs neither Docker nor Rust nor a compiler: only the Node.js that
# install.sh downloads.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ref="${1:-HEAD}"
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
command -v git >/dev/null || die "git is not installed"
command -v docker >/dev/null || die "Docker is not installed (https://docs.docker.com/engine/install/)"
docker info >/dev/null 2>&1 ||
  die "Docker is installed but not usable by you (is it running? are you in the docker group? try: sg docker -c '$0 $*')"

cd "$repo"
sha="$(git rev-parse --short=12 "$ref^{commit}" 2>/dev/null)" || die "unknown commit '$ref'"
if [ "$ref" = HEAD ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "note: you have uncommitted changes; they are NOT in this release (only commit $sha is)."
fi

work="$(mktemp -d)"
cids=()
cleanup() {
  for c in "${cids[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT

echo "› exporting commit $sha"
mkdir -p "$work/src"
git archive "$sha" | tar -x -C "$work/src"
# git archive stamps every file with the commit's time. The Docker builds share a cargo
# cache, so an older commit would look "up to date" and reuse a newer build of the rules
# engine. Fresh timestamps force our own crates to rebuild (dependencies stay cached).
find "$work/src/crates" -type f -exec touch {} +

server_img="game-release-server:$sha"
bot_img="game-release-bot-service:$sha"
echo "› building the bot-service image (first time: ~5 min)"
# --no-cache-filter: the Rust stages always run (the cargo cache keeps that incremental).
# Docker's layer cache alone has handed out stale engines: it can reuse a Rust build made
# from an older cargo cache state.
docker build -q --no-cache-filter build -f "$work/src/crates/bot-service/Dockerfile" \
  -t "$bot_img" "$work/src" >/dev/null
echo "› building the server image (first time: ~10 min)"
docker build -q --no-cache-filter wasm -f "$work/src/apps/server/Dockerfile" \
  -t "$server_img" "$work/src" >/dev/null

name="game-release-$sha"
out="$work/out/$name"
mkdir -p "$out/bin" "$out/scripts"

echo "› extracting the built files"
cid="$(docker create "$server_img")"
cids+=("$cid")
docker cp "$cid:/app" "$out/app"
docker run --rm --entrypoint node "$server_img" -p 'process.versions.node' >"$out/NODE_VERSION"
cid="$(docker create "$bot_img")"
cids+=("$cid")
docker cp "$cid:/usr/local/bin/bot-service" "$out/bin/bot-service"
echo "$sha" >"$out/VERSION"

# The deploy scripts of that commit; older commits that predate them get today's copy.
if [ -f "$work/src/infra/csclub/lib.sh" ]; then
  scripts="$work/src/infra/csclub"
else
  echo "note: commit $sha predates infra/csclub; using the scripts from your working copy"
  scripts="$repo/infra/csclub"
fi
cp "$scripts"/*.sh "$scripts"/*.example "$out/scripts/"
chmod 755 "$out"/scripts/*.sh "$out/bin/bot-service"
chmod 644 "$out/scripts/lib.sh"

for f in app/apps/server/src/main.ts app/packages/rules/wasm app/node_modules bin/bot-service; do
  [ -e "$out/$f" ] || die "the build is missing $f"
done

mkdir -p "$repo/dist/csclub"
tarball="$repo/dist/csclub/$name.tar.gz"
tar -czf "$tarball.partial" -C "$work/out" "$name"
mv "$tarball.partial" "$tarball"

# The images were only a means to an end; the build cache keeps the next build fast.
for c in "${cids[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
cids=()
docker rmi "$server_img" "$bot_img" >/dev/null 2>&1 || true

echo
echo "Release ready: $tarball ($(du -h "$tarball" | cut -f1); Node.js $(cat "$out/NODE_VERSION"))"
echo "Copy it to the server:  scp \"$tarball\" <you>@<server>:"
echo "Then on the server:     tar -xzf $name.tar.gz"
echo "  first time only:      $name/scripts/setup.sh   (then fill in ~/game/game.env)"
echo "  install / update:     $name/scripts/install.sh"
