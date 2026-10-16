# LinkedLists's Chess Game

A four-player chess variant on a 12×12 board. Each player picks a civilization before the match. Free-for-All and 2v2 Teams are both supported, with timed games, bots at selectable strength, and accounts shared with a future Unity/Steam client.

> Working title. The display name lives in [`packages/config`](packages/config/src/index.ts) (`APP_NAME`).

## Documents

| Document | Purpose |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Master plan: stack, rules, data model, infrastructure & costs (with plain-language explanations) |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Step-by-step guide to putting the game online |
| [TODO.md](TODO.md) | Single source of truth for all work, planned and completed |
| [CLAUDE.md](CLAUDE.md) | Standing instructions for AI assistants working in this repo |

## Repository layout

```
crates/     Rust: rules engine (shared by browser, server, bots, and future Unity client), bot engine
apps/       web (React + PixiJS) and server (Node + Colyseus + Better Auth)
packages/   shared TypeScript packages (config, protocol, db, rules = WASM rules engine)
docs/       plan, rules, legal drafts
```

## Development prerequisites

- Node.js 24 (`.nvmrc`) and pnpm 10
- Rust stable via rustup (`rust-toolchain.toml` pins components and the `wasm32-unknown-unknown` target)
- `wasm-bindgen-cli` at the exact version of the `wasm-bindgen` crate in `Cargo.lock`:
  `cargo install wasm-bindgen-cli --version 0.2.129 --locked`
- PostgreSQL 16+

```sh
pnpm install
pnpm check        # lint + WASM build + typecheck + tests (TypeScript)
cargo test        # Rust tests
pnpm build:wasm   # only rebuild the rules engine for @game/rules (packages/rules/wasm, gitignored)
```

## Running locally

One command sets up and starts everything (local Postgres database, rules-engine build,
bot-service, game server and web app):

```sh
pnpm install
pnpm dev          # then open http://localhost:5173
```

`pnpm dev` creates `apps/server/.env` from the example if needed, runs `infra/dev-db.sh`,
migrates and seeds the database, builds the WebAssembly rules engine on first run, then starts
bot-service on :7700, the API on :3000 and the web app on :5173. Ctrl-C stops all three.
`DEV_CLOCK_BASE_MS=15000 pnpm dev` shortens every clock for quick end-to-end checks.

The individual steps, if you want to run them separately:

```sh
infra/dev-db.sh                         # role + game_dev database
DB_NAME=game_test infra/dev-db.sh       # database for server integration tests
DB_NAME=game_e2e_test infra/dev-db.sh   # database for Playwright E2E
cp apps/server/.env.example apps/server/.env
DATABASE_URL=postgres://game:game_dev_password@localhost:5432/game_dev pnpm --filter @game/db migrate
DATABASE_URL=postgres://game:game_dev_password@localhost:5432/game_dev pnpm --filter @game/db seed
pnpm --filter @game/server dev          # API on http://localhost:3000
pnpm --filter @game/web dev             # web on http://localhost:5173 (proxies /api to :3000)
pnpm test:e2e                           # starts its own API (:3100) and web (:5174)
```

### Lobbies, live games and bots

Colyseus (lobbies and live games) runs on the same server under `/api/colyseus`; the wire
contract is documented in [`packages/protocol`](packages/protocol/README.md). Bots get their
moves from `bot-service`:

```sh
cargo run --release -p bot-service      # listens on 127.0.0.1:7700 (BOT_BIND to change)
# in apps/server/.env:
BOT_SERVICE_URL=http://127.0.0.1:7700
```

Without `BOT_SERVICE_URL` (or when bot-service is busy or down) bots play quick local moves.
The real-bot integration test runs only when the variable is set:
`BOT_SERVICE_URL=http://127.0.0.1:7700 pnpm --filter @game/server test`.

In development, emails are not sent. They are kept in memory and readable at
`GET /api/dev/mail?to=<address>` (development/test only, loopback only). Turnstile uses
Cloudflare's always-pass test keys unless real keys are configured. Every server variable is
documented in [`apps/server/.env.example`](apps/server/.env.example). `NODE_ENV` has no
default (the copied `.env` sets `development`), and `NODE_ENV=production` refuses to start
without real secrets, https `API_PUBLIC_URL`/`WEB_ORIGIN`, `PASSKEY_RP_ID`, a separate
`IP_HASH_SECRET`, `TRUST_CLOUDFLARE=true` and rate limiting on.

After a backup restore, re-apply `deletion_log` (`reapplyDeletionLog` in
`apps/server/src/account/anonymize.ts`) so deleted accounts stay deleted.

