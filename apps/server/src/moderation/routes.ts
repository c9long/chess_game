/**
 * Reports (any signed-in player, guests included) and the admin review queue (ADMIN_USER_IDS
 * only; every admin endpoint checks it on the server). See ModerationService.
 */
import type { Database } from '@game/db'
import { reportBodySchema, resolveReportBodySchema } from '@game/protocol'
import { type NextFunction, type Request, type Response, Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import { fixedWindowLimiter } from '../http/security.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { requireCurrentAcceptance } from '../legal/routes.ts'
import { SocialError } from '../social/friends.ts'
import type { ModerationService } from './service.ts'

const idParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res)
    } catch (err) {
      if (err instanceof SocialError) {
        res.status(err.status).json({ error: err.code, message: err.message })
      } else if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'That request was not valid.' })
      } else {
        next(err)
      }
    }
  }
}

const byUser = (req: Request) => (req.res?.locals.session?.user.id as string | undefined) ?? 'anon'

export function moderationRouter({
  db,
  auth,
  moderation,
}: {
  db: Database
  auth: Auth
  moderation: ModerationService
}) {
  const router = Router()
  const signedIn = [requireSession(auth), requireCurrentAcceptance(db)]
  // A burst guard in front of the per-day limit kept in the database.
  const reportLimiter = fixedWindowLimiter({ windowMs: 10 * 60_000, max: 20, key: byUser })

  /** Report a player (registered players and guests). */
  router.post(
    '/reports',
    ...signedIn,
    reportLimiter,
    handle(async (req, res) => {
      const body = reportBodySchema.parse(req.body)
      await moderation.report(sessionOf(res).user.id, body)
      res.status(201).json({ ok: true })
    }),
  )

  const adminOnly = (_req: Request, res: Response, next: NextFunction) => {
    if (!moderation.isAdmin(sessionOf(res).user.id)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admins only.' })
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    next()
  }
  const admin = [requireSession(auth), adminOnly]

  router.get(
    '/admin/me',
    ...admin,
    handle(async (_req, res) => {
      res.json({ admin: true })
    }),
  )

  router.get(
    '/admin/reports',
    ...admin,
    handle(async (_req, res) => {
      res.json(await moderation.queue())
    }),
  )

  router.post(
    '/admin/reports/:id/dismiss',
    ...admin,
    handle(async (req, res) => {
      await moderation.dismiss(z.uuid().parse(req.params.id), sessionOf(res).user.id)
      res.status(204).end()
    }),
  )

  router.post(
    '/admin/reports/:id/resolve',
    ...admin,
    handle(async (req, res) => {
      const { action } = resolveReportBodySchema.parse(req.body)
      await moderation.resolve(z.uuid().parse(req.params.id), sessionOf(res).user.id, action)
      res.status(204).end()
    }),
  )

  router.post(
    '/admin/users/:userId/unsuspend',
    ...admin,
    handle(async (req, res) => {
      await moderation.unsuspend(idParam.parse(req.params.userId), sessionOf(res).user.id)
      res.status(204).end()
    }),
  )

  return router
}
