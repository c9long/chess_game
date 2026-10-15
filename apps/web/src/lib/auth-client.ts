import { passkeyClient } from '@better-auth/passkey/client'
import {
  anonymousClient,
  deviceAuthorizationClient,
  inferAdditionalFields,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const API_ORIGIN =
  (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') || window.location.origin

let onTwoFactor: (() => void) | undefined
let lastRetryAfterS: number | undefined

/** Seconds from the last 429 response's X-Retry-After header (Better Auth rate limits). */
export function retryAfterSeconds(): number | undefined {
  return lastRetryAfterS
}

/** Lets the router decide where the 2FA challenge lives. */
export function setTwoFactorHandler(handler: () => void) {
  onTwoFactor = handler
}

export const authClient = createAuthClient({
  baseURL: `${API_ORIGIN}/api/auth`,
  fetchOptions: {
    credentials: 'include',
    onError(ctx) {
      if (ctx.response.status === 429) {
        const v = Number(ctx.response.headers.get('x-retry-after'))
        lastRetryAfterS = Number.isFinite(v) && v > 0 ? Math.ceil(v) : undefined
      }
    },
  },
  plugins: [
    usernameClient(),
    anonymousClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        onTwoFactor?.()
      },
    }),
    passkeyClient(),
    deviceAuthorizationClient(),
    inferAdditionalFields({
      user: {
        ageConfirmed: { type: 'boolean', required: false, input: false },
        ageBand: { type: 'string', required: false, input: false },
        ageConfirmedAt: { type: 'date', required: false, input: false },
        deletedAt: { type: 'date', required: false, input: false },
      },
    }),
  ],
})

export type SessionData = typeof authClient.$Infer.Session

/** Header carrying the Turnstile token on protected auth calls. */
export const captchaHeaders = (token: string) => ({ headers: { 'x-captcha-response': token } })
