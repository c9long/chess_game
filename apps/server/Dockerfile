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
# Before copying the sources, so this slow install stays cached across code changes. Keep the
# version equal to the wasm-bindgen crate in Cargo.lock (crates/rules-wasm pins it).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version 0.2.129 --locked
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
# The target dir is a build cache shared between builds. COPY keeps the files' original
# mtimes, so building an OLDER checkout (a rollback) would look "up to date" to cargo and
# reuse the newer engine. Touching our own crates forces them to rebuild; dependencies stay
# cached.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    find crates -type f -exec touch {} + \
 && cargo build --release --locked --target wasm32-unknown-unknown -p rules-wasm \
 && wasm-bindgen --target web --remove-name-section --remove-producers-section \
      --out-dir /out/wasm target/wasm32-unknown-unknown/release/rules_wasm.wasm

# 2. Production dependencies for the server and the workspace packages it uses.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
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
# The lockfile resolves better-auth's and @colyseus/schema's *optional* peer dependencies
# (vitest, vite, drizzle-kit, react, typescript, ...) because the workspace has them as dev
# tools, so a --prod install still brings them in. The server never loads them at runtime;
# dropping them halves node_modules (~255 MB -> ~120 MB). @sentry/node also depends on its
# bundler plugins (oxc-parser, the `sentry` CLI, ~22 MB), which only its build-tool entry
# points (@sentry/node/vite, ...) import.
RUN cd node_modules/.pnpm && rm -rf \
      typescript@* vite@* vitest@* @vitest+* esbuild@* @esbuild+* @esbuild-kit+* \
      drizzle-kit@* rolldown@* @rolldown+* lightningcss* tsx@* react@* react-dom@* \
      @types+* @sentry+bundler-plugins@* oxc-parser@* @oxc-parser+* @oxc-project+* sentry@* \
 && find /app/node_modules -type f \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.[cm]ts' \) -delete \
 && find /app/node_modules -xtype l -delete

# 3. Runtime: sources + dependencies + the compiled rules engine.
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production
# The server runs with plain `node`; npm, npx and corepack are not needed at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
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
# The preload starts error tracking first when SENTRY_DSN is set (src/instrument.ts).
CMD ["node", "--import", "./apps/server/src/instrument.ts", "apps/server/src/main.ts"]
