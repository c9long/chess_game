#!/usr/bin/env node
// One-command local development: `pnpm dev`.
//
// 1. Creates apps/server/.env from .env.example if it is missing.
// 2. Makes sure the local Postgres role/database exist, then migrates and seeds them.
// 3. Builds the WebAssembly rules engine if it has not been built yet.
// 4. Starts bot-service (Rust, release build), the API/game server and the web app, with
//    each line of output prefixed by its source. Ctrl-C stops everything.
//
// Then open http://localhost:5173.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://game:game_dev_password@localhost:5432/game_dev'
const BOT_BIND = process.env.BOT_BIND ?? '127.0.0.1:7700'
const cargoBin = join(process.env.HOME ?? '', '.cargo', 'bin')
const env = { ...process.env, PATH: `${cargoBin}:${process.env.PATH}`, FORCE_COLOR: '1' }

function step(label, cmd, args, extraEnv = {}) {
  console.log(`\x1b[2m›\x1b[0m ${label}`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extraEnv } })
  if (r.status !== 0) {
    console.error(`\n✗ ${label} failed. See the output above.`)
    process.exit(r.status ?? 1)
  }
}

const serverEnv = join(root, 'apps/server/.env')
if (!existsSync(serverEnv)) {
  copyFileSync(join(root, 'apps/server/.env.example'), serverEnv)
  console.log('› created apps/server/.env from .env.example')
}

if (!process.env.DATABASE_URL) step('preparing the local database', 'bash', ['infra/dev-db.sh'])
step('migrating the database', 'pnpm', ['--filter', '@game/db', 'migrate'], { DATABASE_URL })
step('seeding the civilization catalog', 'pnpm', ['--filter', '@game/db', 'seed'], {
  DATABASE_URL,
})
if (!existsSync(join(root, 'packages/rules/wasm/rules_wasm_bg.wasm'))) {
  step('building the rules engine (WebAssembly)', 'pnpm', ['build:wasm'])
}

const COLORS = { bots: '35', server: '36', web: '33' }
const children = []

function run(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = `\x1b[${COLORS[name]}m${name.padEnd(6)}│\x1b[0m `
  const pipe = (stream, out) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) out.write(`${prefix}${line}\n`)
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`${prefix}exited (${signal ?? code}); stopping the others`)
      shutdown(code ?? 1)
    }
  })
  children.push(child)
}

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM')
  setTimeout(() => process.exit(code), 1500).unref()
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('bots', 'cargo', ['run', '--release', '-q', '-p', 'bot-service'], { BOT_BIND })
run('server', 'pnpm', ['--filter', '@game/server', 'dev'], {
  DATABASE_URL,
  BOT_SERVICE_URL: process.env.BOT_SERVICE_URL ?? `http://${BOT_BIND}`,
})
run('web', 'pnpm', ['--filter', '@game/web', 'dev'])

console.log('\n  Open \x1b[1mhttp://localhost:5173\x1b[0m  (Ctrl-C to stop)\n')
