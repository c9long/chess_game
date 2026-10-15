/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API (https://api.<domain>). Empty in dev: the Vite proxy serves /api. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
