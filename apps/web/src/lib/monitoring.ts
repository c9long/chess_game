import { SENTRY_PRIVACY_OPTIONS } from '@game/config/error-scrub'
import { type BrowserOptions, captureException, init } from '@sentry/browser'

export interface ErrorTrackingEnv {
  dsn: string
  environment?: string | undefined
  release?: string | undefined
  /** Vite's build mode, the default environment name. */
  mode: string
}

export function errorTrackingOptions(env: ErrorTrackingEnv): BrowserOptions {
  return {
    dsn: env.dsn,
    environment: env.environment || env.mode,
    ...(env.release ? { release: env.release } : {}),
    ...SENTRY_PRIVACY_OPTIONS,
    // No session ping on every page load: Sentry hears from a browser only when something fails.
    integrations: (defaults) => defaults.filter((i) => i.name !== 'BrowserSession'),
  }
}

/** Starts the SDK and reports the errors main.tsx caught before it loaded. */
export function startErrorTracking(early: readonly unknown[] = []): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  init(
    errorTrackingOptions({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
      release: import.meta.env.VITE_SENTRY_RELEASE,
      mode: import.meta.env.MODE,
    }),
  )
  for (const err of early) captureException(err)
}
