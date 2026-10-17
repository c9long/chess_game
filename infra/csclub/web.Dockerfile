# syntax=docker/dockerfile:1
#
# The built web app for a release (infra/csclub/package.sh), for the single-origin option
# where the game server also serves the web app (WEB_DIST_DIR; docs/DEPLOY-CSCLUB.md). Same
# build as .github/workflows/deploy-web.yml. Build from the repository root:
#
#   docker build -f infra/csclub/web.Dockerfile -t game-web .
#
# The result holds only /web (apps/web/dist). VITE_API_URL stays empty by default, so the
# app calls the origin it was loaded from.

ARG RUST_VERSION=1.99
ARG NODE_VERSION=24

# 1. The rules engine compiled to WebAssembly, exactly as in apps/server/Dockerfile.
FROM rust:${RUST_VERSION}-slim-bookworm AS wasm
RUN rustup target add wasm32-unknown-unknown
# Keep the version equal to the wasm-bindgen crate in Cargo.lock (crates/rules-wasm pins it).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version 0.2.129 --locked
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
# Touch our own crates so a shared cargo cache never hands back a newer commit's engine.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    find crates -type f -exec touch {} + \
 && cargo build --release --locked --target wasm32-unknown-unknown -p rules-wasm \
 && wasm-bindgen --target web --remove-name-section --remove-producers-section \
      --out-dir /out/wasm target/wasm32-unknown-unknown/release/rules_wasm.wasm

# 2. The web app.
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN corepack enable
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=wasm /out/wasm packages/rules/wasm
ARG VITE_API_URL=""
RUN VITE_API_URL="$VITE_API_URL" pnpm --filter @game/web build \
 && test -f apps/web/dist/index.html

# 3. Only the files (package.sh copies /web out of a container made from this image).
FROM scratch
COPY --from=build /src/apps/web/dist /web
CMD ["/web"]
