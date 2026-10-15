import initWasm, { initSync, rulesVersion } from '../wasm/rules_wasm.js'

/**
 * Location of the compiled engine. Vite turns this `new URL(..., import.meta.url)`
 * into a hashed asset URL; in Node it is a `file:` URL next to this package.
 */
const DEFAULT_WASM_URL = new URL('../wasm/rules_wasm_bg.wasm', import.meta.url)

/** Raw `.wasm` bytes. */
export type WasmBytes = Uint8Array | ArrayBuffer

/**
 * Where to load the engine from: a URL or path (fetched; `file:` URLs are read
 * from disk in Node) or the bytes themselves.
 */
export type WasmSource = URL | string | WasmBytes

/** Rules version these TypeScript types describe (checked against the engine on init). */
export const RULES_VERSION = 1

let initialized = false
let pending: Promise<void> | undefined

/** Whether the engine has been initialized. */
export function isRulesReady(): boolean {
  return initialized
}

/** Throws unless `initRules()` / `initRulesSync()` has completed. */
export function assertRulesReady(): void {
  if (!initialized) {
    throw new Error('@game/rules is not initialized: call `await initRules()` first')
  }
}

interface NodeFs {
  readFileSync(path: URL): Uint8Array
}

/**
 * Node's `fs`, looked up at runtime so bundlers never see a `node:` import
 * (`process.getBuiltinModule`, Node 22.3+). `undefined` in browsers.
 */
function nodeFs(): NodeFs | undefined {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process
  return proc?.getBuiltinModule?.('node:fs') as NodeFs | undefined
}

function finish(): void {
  const v = rulesVersion()
  if (v !== RULES_VERSION) {
    throw new Error(`@game/rules expects rules version ${RULES_VERSION}, engine has ${v}`)
  }
  initialized = true
}

/**
 * Loads the engine. Works in browsers (Vite: fetches the bundled `.wasm`) and
 * in Node (reads the `.wasm` from disk). Safe to call more than once.
 */
export function initRules(source?: WasmSource): Promise<void> {
  if (initialized) return Promise.resolve()
  pending ??= (async () => {
    const src = source ?? DEFAULT_WASM_URL
    const url =
      src instanceof URL ? src : typeof src === 'string' && URL.canParse(src) ? new URL(src) : null
    const fs = url?.protocol === 'file:' ? nodeFs() : undefined
    if (url && fs) {
      initSync({ module: fs.readFileSync(url) })
    } else {
      // Browsers: URLs and relative paths are fetched (streaming compile); bytes instantiate.
      await initWasm({ module_or_path: src })
    }
    finish()
  })().catch((err: unknown) => {
    pending = undefined
    throw err
  })
  return pending
}

/**
 * Loads the engine synchronously from bytes, or (Node only) from the bundled
 * `.wasm` file when no bytes are given. Use at server startup.
 */
export function initRulesSync(bytes?: WasmBytes): void {
  if (initialized) return
  let module: WasmBytes
  if (bytes) {
    module = bytes
  } else {
    const fs = nodeFs()
    if (!fs) {
      throw new Error(
        'initRulesSync() without bytes needs Node; in browsers use `await initRules()`',
      )
    }
    module = fs.readFileSync(DEFAULT_WASM_URL)
  }
  initSync({ module })
  finish()
}
