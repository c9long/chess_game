import { API_ORIGIN, retryAfterSeconds } from './auth-client.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly body: unknown
  /** Seconds to wait, from a 429's Retry-After header. */
  readonly retryAfter: number | undefined

  constructor(
    status: number,
    body: { error?: string; code?: string; message?: string } | null,
    retryAfter?: number,
  ) {
    super(body?.message ?? `Request failed (${status})`)
    this.status = status
    this.code = body?.error ?? body?.code
    this.body = body
    this.retryAfter = retryAfter
  }
}

/** "Too many attempts. Try again in 7 seconds." (or "...in 2 minutes."). */
export function tooManyAttempts(seconds: number | undefined): string {
  if (!seconds) return 'Too many attempts. Please wait a moment and try again.'
  const amount =
    seconds < 90
      ? `${seconds} second${seconds === 1 ? '' : 's'}`
      : `${Math.ceil(seconds / 60)} minutes`
  return `Too many attempts. Try again in ${amount}.`
}

/** JSON call to our own (non-Better-Auth) API routes, with cookies. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'include',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? null : JSON.stringify(init.body),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'))
    throw new ApiError(res.status, json, Number.isFinite(retry) && retry > 0 ? retry : undefined)
  }
  return json as T
}

export interface PublicConfig {
  appName: string
  turnstileSiteKey: string
  oauthProviders: OAuthProvider[]
  legalVersions: Record<'terms' | 'privacy', string>
  username: { minLength: number; maxLength: number; description: string }
  passwordMinLength: number
  /** Development only: emails are stored in the dev mailbox (/dev/mail) instead of sent. */
  devMailbox?: boolean
}

export type OAuthProvider = 'google' | 'discord' | 'github' | 'microsoft'

export interface LegalStatus {
  /** The signed-in user the server saw for this request, or null when signed out. */
  userId?: string | null
  required: Record<'terms' | 'privacy', string>
  accepted: Partial<Record<'terms' | 'privacy', string>>
  needsAcceptance?: boolean
  ageConfirmed: boolean
  blocked: boolean
}

export function acceptCurrentLegal(versions: PublicConfig['legalVersions']) {
  return api<{ recorded: boolean }>('/api/legal/acceptances', {
    body: {
      documents: Object.entries(versions).map(([document, version]) => ({ document, version })),
    },
  })
}

/** Better Auth error → readable message. */
export function authErrorMessage(
  error:
    | {
        message?: string | undefined
        code?: string | undefined
        status?: number | undefined
        error_description?: string | undefined
        retryAfter?: number | undefined
      }
    | null
    | undefined,
) {
  if (!error) return 'Something went wrong. Please try again.'
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_USERNAME_OR_PASSWORD':
      return 'That sign-in did not match an account.'
    case 'INVALID_PASSWORD':
      return 'That password is incorrect.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Please verify your email first. We just sent you a new link.'
    case 'USERNAME_IS_ALREADY_TAKEN':
    case 'USERNAME_IS_ALREADY_TAKEN_PLEASE_TRY_ANOTHER':
      return 'That username is taken.'
    case 'INVALID_USERNAME':
    case 'USERNAME_TOO_SHORT':
    case 'USERNAME_TOO_LONG':
      return 'That username isn’t allowed. Use 3–20 letters, numbers and underscores.'
    case 'MISSING_RESPONSE':
    case 'VERIFICATION_FAILED':
      return 'The anti-bot check failed. Please wait for it to finish and try again.'
    case 'ACCOUNT_LOCKED':
      return `Too many wrong passwords for this account. ${tooManyAttempts(error.retryAfter).replace('Too many attempts. ', '')} You can also reset your password.`
    case 'PASSKEY_NOT_FOUND':
      return 'That passkey isn’t registered to an account any more. Sign in another way.'
    case 'PREVIOUSLY_REGISTERED':
    case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
      return 'This device already has a passkey for your account.'
    case 'AUTH_CANCELLED':
    case 'ERROR_CEREMONY_ABORTED':
      return 'The passkey request was cancelled.'
    case 'AUTHENTICATION_FAILED':
    case 'FAILED_TO_VERIFY_REGISTRATION':
      return 'The passkey check didn’t complete. Please try again.'
    case 'SESSION_NOT_FRESH':
      return 'For your security, sign in again first.'
  }
  if (error.status === 429) return tooManyAttempts(retryAfterSeconds())
  return error.message || error.error_description || 'Something went wrong. Please try again.'
}

/**
 * Better Auth OAuth error codes passed back as ?error= on the sign-in page. `ageDone` is false
 * when this browser hasn't been through the age screen: the sign-in page no longer requires it,
 * so a new account can't be created from there and the visitor is pointed to Create account
 * (which asks first) rather than to the Terms box.
 */
export function oauthErrorMessage(code: string | null, ageDone = true): string | undefined {
  if (!code) return undefined
  if (!ageDone && (code === 'unable_to_create_user' || code === 'AGE_CONFIRMATION_REQUIRED')) {
    return 'There’s no account for that sign-in yet. To make one, choose Create account.'
  }
  switch (code) {
    case 'unable_to_create_user':
    case 'LEGAL_ACCEPTANCE_REQUIRED':
      return 'Please tick the box to accept the Terms of Service, then try again.'
    case 'access_denied':
      return 'Sign-in was cancelled.'
    default:
      return 'That sign-in didn’t work. Please try again.'
  }
}
