/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API (https://api.<domain>). Empty in dev: the Vite proxy serves /api. */
  readonly VITE_API_URL?: string
  /** '1' for the mobile app build (`build:native`): bearer-token auth, relative asset paths. */
  readonly VITE_NATIVE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
