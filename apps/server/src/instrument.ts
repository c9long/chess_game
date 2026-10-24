/**
 * Error tracking preload: `node --import ./src/instrument.ts src/main.ts` (package.json and the
 * Dockerfile). Sentry's documented setup starts the SDK before Express and the http modules
 * load, so its instrumentation sees them. Without SENTRY_DSN this file does nothing and the SDK
 * is never imported. Invalid Sentry settings also leave it off here; loadConfig in main.ts then
 * reports them and refuses to start.
 */
import { sentryEnvSchema, sentrySettings, setErrorReporter } from './monitoring.ts'

const parsed = sentryEnvSchema.safeParse(process.env)
const settings = parsed.success ? sentrySettings(parsed.data) : undefined

if (settings) {
  const [Sentry, { SENTRY_PRIVACY_OPTIONS }] = await Promise.all([
    import('@sentry/node'),
    import('@game/config/error-scrub'),
  ])
  Sentry.init({
    dsn: settings.dsn,
    environment: settings.environment,
    // Errors only (rate 0): no sample rate at all, since any rate (even 0) turns spans on.
    ...(settings.tracesSampleRate > 0
      ? { tracesSampleRate: settings.tracesSampleRate }
      : { defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance() }),
    // No trace headers on outgoing requests (email, CAPTCHA and sign-in providers, bots).
    tracePropagationTargets: [],
    ...SENTRY_PRIVACY_OPTIONS,
    integrations: [
      // Error-level log lines are reported (logger.ts), the error handler's 500s among them,
      // so Express's automatic capture would only send them twice.
      Sentry.expressIntegration({ shouldHandleError: false }),
      // An unhandled rejection still ends the process, as it does without Sentry (Node's
      // default), after it is reported; Docker restarts the server.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
  })
  setErrorReporter(Sentry)
}
