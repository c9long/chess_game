import type { Database } from '@game/db'
import { fromNodeHeaders } from 'better-auth/node'
import { Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import { GUEST_INTENT_COOKIE, GUEST_INTENT_MAX_AGE_S, signStamped } from '../auth/guest-link.ts'
import type { AppConfig } from '../config.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { cookieOptions } from '../legal/gate.ts'
import type { Logger } from '../logger.ts'
import { anonymizeUser } from './anonymize.ts'
import { buildAccountExport } from './export.ts'
import { referenceCode } from './reference.ts'

/**
 * Deleting a registered account needs a session created within this window, or the current
 * password. Guests have no credential to re-authenticate with, so for them the typed
 * confirmation is enough (PLAN §8 "Delete guest account").
 */
export const FRESH_SESSION_MS = 24 * 60 * 60 * 1000

const deleteBody = z.object({
  confirm: z.literal('DELETE'),
  password: z.string().max(256).optional(),
})

export function accountRouter(deps: {
  config: AppConfig
  db: Database
  auth: Auth
  logger: Logger
}) {
  const { config, db, auth, logger } = deps
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
      let confirmed = false
      if (parsed.data.password) {
        try {
          await auth.api.verifyPassword({
            body: { password: parsed.data.password },
            headers: fromNodeHeaders(req.headers),
          })
          confirmed = true
        } catch {
          res
            .status(403)
            .json({ error: 'INVALID_PASSWORD', message: 'That password is incorrect.' })
          return
        }
      }
      if (!confirmed) {
        res.status(403).json({
          error: 'SESSION_NOT_FRESH',
          message:
            'For your security, enter your password (or sign in again) before deleting your account.',
        })
        return
      }
    }
    const result = await anonymizeUser(db, user.id, 'user_request')
    logger.info({ event: 'account_deleted', guest: Boolean(user.isAnonymous) }, 'account deleted')
    for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token']) {
      res.clearCookie(name, { path: '/', secure: config.isProduction })
    }
    res.json({ deleted: true, label: result.label })
  })

  return router
}
