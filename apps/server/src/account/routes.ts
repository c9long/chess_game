import type { Database } from '@game/db'
import { Router } from 'express'
import { z } from 'zod'
import { type Auth, BACKUP_CODE_COUNT, FRESH_SESSION_MS } from '../auth/auth.ts'
import { GUEST_INTENT_COOKIE, GUEST_INTENT_MAX_AGE_S, signStamped } from '../auth/guest-link.ts'
import type { AppConfig } from '../config.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { cookieOptions } from '../legal/gate.ts'
import type { Logger } from '../logger.ts'
import { rowsOf } from '../social/friends.ts'
import type { SocialService } from '../social/service.ts'
import { anonymizeUser } from './anonymize.ts'
import { buildAccountExport } from './export.ts'
import { referenceCode } from './reference.ts'
import { stepUpMethods, verifyStepUp } from './step-up.ts'

/**
 * Deleting a registered account needs a session created within FRESH_SESSION_MS, or a
 * step-up: the current password, a passkey, or a two-step code (account/step-up.ts). Guests
 * have no credential to re-authenticate with, so for them the typed confirmation is enough
 * (PLAN §8 "Delete guest account").
 */
export { FRESH_SESSION_MS }

const deleteBody = z.object({
  confirm: z.literal('DELETE'),
  password: z.string().max(256).optional(),
  passkey: z.record(z.string(), z.unknown()).optional(),
  totpCode: z.string().max(16).optional(),
  backupCode: z.string().max(32).optional(),
})

export function accountRouter(deps: {
  config: AppConfig
  db: Database
  auth: Auth
  logger: Logger
  /** Told about deletions (former friends are notified, connections closed). */
  social?: SocialService
}) {
  const { config, db, auth, logger, social } = deps
  const router = Router()
  router.use(requireSession(auth))

  router.get('/export', async (_req, res) => {
    const { user } = sessionOf(res)
    const data = await buildAccountExport(db, user.id)
    if (!data) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const day = data.exportedAt.slice(0, 10)
    res.setHeader('Content-Disposition', `attachment; filename="account-export-${day}.json"`)
    res.setHeader('Cache-Control', 'no-store')
    res.type('application/json').send(JSON.stringify(data, null, 2))
  })

  /** Reference code for email requests, shown in Settings (PLAN §8). */
  router.get('/reference', (_req, res) => {
    const { user } = sessionOf(res)
    res.setHeader('Cache-Control', 'no-store')
    res.json({ code: referenceCode(config, user.id) })
  })

  /**
   * How many of the account's two-step backup codes are unused. Never the codes themselves:
   * they are stored encrypted and only decrypted here to count them.
   */
  router.get('/two-factor/backup-codes', async (_req, res) => {
    const { user } = sessionOf(res)
    res.setHeader('Cache-Control', 'no-store')
    if (!user.twoFactorEnabled) {
      res.json({ enabled: false, remaining: 0, total: BACKUP_CODE_COUNT })
      return
    }
    try {
      const { backupCodes } = await auth.api.viewBackupCodes({ body: { userId: user.id } })
      res.json({ enabled: true, remaining: backupCodes.length, total: BACKUP_CODE_COUNT })
    } catch {
      // No two-step row, or codes that can't be read (e.g. the auth secret changed): the count
      // is unknown, which is not the same as none left.
      res.json({ enabled: true, remaining: null, total: BACKUP_CODE_COUNT })
    }
  })

  /**
   * A guest asks to move its history into the account it signs in to next (password,
   * passkey, OAuth, incl. a 2FA step). Without this explicit choice, signing in from a guest
   * browser leaves the guest's games where they are (e.g. on a shared device).
   */
  router.post('/guest-upgrade-intent', (_req, res) => {
    const { user } = sessionOf(res)
    if (!user.isAnonymous) {
      res.status(400).json({ error: 'NOT_A_GUEST', message: 'Only guests can do this.' })
      return
    }
    res.cookie(
      GUEST_INTENT_COOKIE,
      signStamped(config, 'guest-intent', user.id),
      cookieOptions(config, GUEST_INTENT_MAX_AGE_S),
    )
    res.status(204).end()
  })

  router.delete('/guest-upgrade-intent', (_req, res) => {
    res.clearCookie(GUEST_INTENT_COOKIE, { path: '/', secure: config.isProduction })
    res.status(204).end()
  })

  router.delete('/', async (req, res) => {
    const parsed = deleteBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'CONFIRMATION_REQUIRED',
        message: 'Send {"confirm":"DELETE"} to delete this account.',
      })
      return
    }
    const { user, session } = sessionOf(res)
    const fresh = Date.now() - new Date(session.createdAt).getTime() <= FRESH_SESSION_MS
    if (!user.isAnonymous && !fresh) {
      const { password, passkey, totpCode, backupCode } = parsed.data
      const proof = { password, passkey, totpCode, backupCode }
      const result = await verifyStepUp({ auth, db, config, req, user, proof })
      if (!result.ok) {
        if (result.error === 'SESSION_NOT_FRESH') {
          const methods = await stepUpMethods(db, user)
          res.status(403).json({
            error: 'SESSION_NOT_FRESH',
            message:
              methods.length > 0
                ? 'For your security, confirm it’s you (or sign in again) before deleting your account.'
                : 'For your security, sign in again before deleting your account.',
            methods,
          })
          return
        }
        if (result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter))
        res.status(result.status).json({ error: result.error, message: result.message })
        return
      }
    }
    // Friends and anyone with a request to or from the user (their lists change).
    const counterparts = social ? (await rowsOf(db, user.id)).map((r) => r.userId) : []
    const result = await anonymizeUser(db, user.id, 'user_request')
    social?.accountDeleted(user.id, counterparts)
    logger.info({ event: 'account_deleted', guest: Boolean(user.isAnonymous) }, 'account deleted')
    for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token']) {
      res.clearCookie(name, { path: '/', secure: config.isProduction })
    }
    res.json({ deleted: true, label: result.label })
  })

  return router
}
