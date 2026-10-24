/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API (https://api.<domain>). Empty in dev: the Vite proxy serves /api. */
  readonly VITE_API_URL?: string
  /** '1' for the mobile app build (`build:native`): bearer-token auth, relative asset paths. */
  readonly VITE_NATIVE?: string
  /** DSN of the web app's Sentry project. Unset: no error tracking (the SDK isn't bundled). */
  readonly VITE_SENTRY_DSN?: string
  /** Environment name on error reports (default: the Vite mode, e.g. production). */
  readonly VITE_SENTRY_ENVIRONMENT?: string
  /** Release on error reports (the deploy workflow passes the commit). */
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
