// Builds the rules engine to WebAssembly and generates the JS glue in ./wasm:
//   cargo build --release --target wasm32-unknown-unknown -p rules-wasm
//   wasm-bindgen --target web --out-dir packages/rules/wasm
//   wasm-opt (optional, only if installed)
// Requires Rust (rustup, wasm32-unknown-unknown target) and wasm-bindgen-cli
// at exactly the version of the wasm-bindgen crate in Cargo.lock.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(pkgDir, '../..')
const outDir = join(pkgDir, 'wasm')
const input = join(root, 'target/wasm32-unknown-unknown/release/rules_wasm.wasm')
const wasmFile = join(outDir, 'rules_wasm_bg.wasm')

// rustup installs to ~/.cargo/bin, which is not always on PATH for scripts.
const env = { ...process.env }
const cargoBin = join(homedir(), '.cargo', 'bin')
if (existsSync(cargoBin)) env.PATH = `${cargoBin}${delimiter}${env.PATH ?? ''}`

function run(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: root, env, stdio: 'inherit' })
  } catch (err) {
    console.error(`@game/rules: \`${cmd} ${args.join(' ')}\` failed`)
    process.exit(typeof err.status === 'number' ? err.status : 1)
  }
}

function output(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: root, env, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8')
const crateVersion = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1]
const cliVersion = output('wasm-bindgen', ['--version'])?.split(' ')[1]
if (!cliVersion) {
  console.error(
    `wasm-bindgen CLI not found. Install it with: cargo install wasm-bindgen-cli --version ${crateVersion} --locked`,
  )
  process.exit(1)
}
if (crateVersion && cliVersion !== crateVersion) {
  console.error(
    `wasm-bindgen CLI ${cliVersion} does not match the wasm-bindgen crate ${crateVersion} in Cargo.lock.\n` +
      `Install the matching CLI: cargo install wasm-bindgen-cli --version ${crateVersion} --locked --force`,
  )
  process.exit(1)
}

run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'rules-wasm'])

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
run('wasm-bindgen', [
  '--target',
  'web',
  '--out-dir',
  outDir,
  '--out-name',
  'rules_wasm',
  '--remove-name-section',
  '--remove-producers-section',
  input,
])

// Release builds set REQUIRE_WASM_OPT=1: a missing or failing wasm-opt is then an error, not a warning.
const requireOpt = process.env.REQUIRE_WASM_OPT === '1'
if (output('wasm-opt', ['--version'])) {
  const tmp = `${wasmFile}.opt`
  try {
    execFileSync('wasm-opt', ['-O3', wasmFile, '-o', tmp], {
      env,
      stdio: 'inherit',
    })
    renameSync(tmp, wasmFile)
  } catch {
    rmSync(tmp, { force: true })
    if (requireOpt) throw new Error('@game/rules: wasm-opt failed (REQUIRE_WASM_OPT=1)')
    console.warn('@game/rules: wasm-opt failed; keeping the unoptimized module')
  }
} else if (requireOpt) {
  throw new Error('@game/rules: wasm-opt (binaryen) not found (REQUIRE_WASM_OPT=1)')
} else {
  console.warn(
    '\n@game/rules: WARNING wasm-opt (binaryen) not found; the module is NOT size-optimized.\n' +
      '  Install binaryen version_132 or newer (github.com/WebAssembly/binaryen/releases; distro packages\n' +
      '  can be too old) before release builds.\n',
  )
}

const size = statSync(wasmFile).size
const gz = gzipSync(readFileSync(wasmFile)).length
console.log(
  `@game/rules: wasm/rules_wasm_bg.wasm ${(size / 1024).toFixed(1)} KiB (${(gz / 1024).toFixed(1)} KiB gzip)`,
)
