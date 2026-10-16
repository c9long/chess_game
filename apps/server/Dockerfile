# syntax=docker/dockerfile:1
#
# Game/API server image (Express + Better Auth + Colyseus). Build from the repository root:
#
#   docker build -f apps/server/Dockerfile -t game-server .
#
# The server runs its TypeScript sources directly on Node 24 (type stripping). Workspace
# packages stay as real directories next to node_modules (pnpm symlinks), because Node does
# not strip types inside node_modules.

ARG RUST_VERSION=1.99
ARG NODE_VERSION=24

# 1. The rules engine compiled to WebAssembly (packages/rules/wasm).
FROM rust:${RUST_VERSION}-slim-bookworm AS wasm
RUN rustup target add wasm32-unknown-unknown
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version 0.2.129 --locked
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --target wasm32-unknown-unknown -p rules-wasm \
 && wasm-bindgen --target web --remove-name-section --remove-producers-section \
      --out-dir /out/wasm target/wasm32-unknown-unknown/release/rules_wasm.wasm

# 2. Production dependencies for the server and the workspace packages it uses.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/protocol/package.json packages/protocol/
COPY packages/rules/package.json packages/rules/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@game/server..." --filter "@game/db"

# 3. Runtime: sources + dependencies + the compiled rules engine.
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY apps/server/src apps/server/src
COPY packages/config/src packages/config/src
COPY packages/db/src packages/db/src
COPY packages/db/drizzle packages/db/drizzle
COPY packages/protocol/src packages/protocol/src
COPY packages/rules/src packages/rules/src
COPY --from=wasm /out/wasm packages/rules/wasm
USER node
EXPOSE 3000
# SIGTERM: stop accepting rooms, let running games finish (SHUTDOWN_DRAIN_MAX_SECONDS), exit.
STOPSIGNAL SIGTERM
CMD ["node", "apps/server/src/main.ts"]
