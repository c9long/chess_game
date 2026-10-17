import { APP_NAME } from '@game/config'
import type { EmailMessage } from './sender.ts'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const IGNORE_FOOTER = "If you didn't ask for this, you can ignore this email."

function layout(
  heading: string,
  body: string,
  action: string,
  link: string,
  footer = IGNORE_FOOTER,
): string {
  return `<!doctype html><html><body style="margin:0;background:#1d1b19;font-family:system-ui,sans-serif;color:#f4efe6">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#2a2724;border-radius:12px;padding:32px">
<tr><td><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>
<p style="line-height:1.5;opacity:.85">${body}</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#d4a017;color:#1d1b19;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action)}</a></p>
<p style="font-size:12px;opacity:.6;word-break:break-all">${escapeHtml(link)}</p>
<p style="font-size:12px;opacity:.6">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`
}

export function verificationEmail(to: string, link: string): EmailMessage {
  return {
    kind: 'verify-email',
    to,
    subject: `Verify your email for ${APP_NAME}`,
    text: `Confirm your email address for ${APP_NAME}:\n\n${link}\n\nIf you didn't create an account, ignore this email.`,
    html: layout(
      'Confirm your email',
      `Welcome to ${escapeHtml(APP_NAME)}. Confirm this address to finish creating your account.`,
      'Verify email',
      link,
    ),
  }
}

export function resetPasswordEmail(to: string, link: string): EmailMessage {
  return {
    kind: 'reset-password',
    to,
    subject: `Reset your ${APP_NAME} password`,
    text: `Someone asked to reset the password for your ${APP_NAME} account:\n\n${link}\n\nIf it wasn't you, ignore this email.`,
    html: layout(
      'Reset your password',
      'Use the button below to choose a new password. The link expires in one hour.',
      'Choose a new password',
      link,
    ),
  }
}

/**
 * Sent to an existing account's address when someone signs up with it. The person signing
 * up sees the same "check your email" response either way (no account enumeration).
 */
export function accountExistsEmail(
  to: string,
  signInLink: string,
  resetLink: string,
): EmailMessage {
  return {
    kind: 'account-exists',
    to,
    subject: `You already have a ${APP_NAME} account`,
    text: `Someone (hopefully you) tried to create a new ${APP_NAME} account with this email address, but it already has an account.\n\nSign in: ${signInLink}\nForgot your password? Reset it: ${resetLink}\n\nIf this wasn't you, you can ignore this email. Nothing has changed.`,
    html: layout(
      'You already have an account',
      `Someone (hopefully you) tried to create a new ${escapeHtml(APP_NAME)} account with this address, but it already has one. Sign in instead, or <a href="${escapeHtml(resetLink)}" style="color:#d4a017">reset your password</a> if you forgot it. If this wasn't you, nothing has changed.`,
      'Sign in',
      signInLink,
    ),
  }
}

/** "17 Oct 2026, 14:05 UTC": a fixed zone, since we don't know the reader's. */
export function formatUtc(d: Date): string {
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })
  return `${date}, ${time} UTC`
}

/**
 * Sent to the account owner when the per-account throttle pauses password sign-in after
 * repeated wrong passwords (auth/throttle.ts). It names no IP address, device or location,
 * and the person typing the passwords sees the same response whether or not it was sent.
 * The lock is short, so it leads with the duration; the UTC time is there for later reading.
 */
export function signInLockedEmail(
  to: string,
  {
    unlocksAt,
    lockMinutes,
    twoFactorEnabled,
    resetLink,
    securityLink,
  }: {
    unlocksAt: Date
    lockMinutes: number
    twoFactorEnabled: boolean
    resetLink: string
    securityLink: string
  },
): EmailMessage {
  const when = formatUtc(unlocksAt)
  const duration = `about ${lockMinutes} minute${lockMinutes === 1 ? '' : 's'}`
  const advice = twoFactorEnabled
    ? 'Two-step verification is on, so a password alone can’t sign in. If it wasn’t you, we still suggest choosing a new password.'
    : 'If it wasn’t you, we suggest choosing a new password and turning on two-step verification.'
  return {
    kind: 'sign-in-locked',
    to,
    subject: `Password sign-in to your ${APP_NAME} account was paused`,
    text: [
      `Someone entered the wrong password for your ${APP_NAME} account several times in a row, so we paused password sign-in to protect it.`,
      `Password sign-in works again in ${duration} (after ${when}). Passkeys and password reset keep working in the meantime.`,
      `None of these attempts signed in. ${advice}`,
      `Reset your password: ${resetLink}`,
      twoFactorEnabled ? '' : `Two-step verification: ${securityLink}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    html: layout(
      'Password sign-in paused',
      `Someone entered the wrong password for your ${escapeHtml(APP_NAME)} account several times in a row, so we paused password sign-in to protect it. It works again in <strong>${escapeHtml(duration)}</strong> (after ${escapeHtml(when)}); passkeys and password reset keep working.<br><br>None of these attempts signed in. ${
        twoFactorEnabled
          ? escapeHtml(advice)
          : `If it wasn’t you, we suggest choosing a new password and turning on <a href="${escapeHtml(securityLink)}" style="color:#d4a017">two-step verification</a>.`
      }`,
      'Reset your password',
      resetLink,
      'You get this email at most once an hour. No action is needed if it was you.',
    ),
  }
}
