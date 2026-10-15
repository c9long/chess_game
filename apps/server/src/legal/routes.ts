import { LEGAL_VERSIONS, type LegalDocument } from '@game/config'
import { type Database, legalAcceptances, users } from '@game/db'
import { desc, eq } from 'drizzle-orm'
import { type NextFunction, type Request, type Response, Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import type { AppConfig } from '../config.ts'
import { clientIp, hashIp } from '../http/client-ip.ts'
import { fixedWindowLimiter } from '../http/security.ts'
import { loadSession, requireSession, sessionOf } from '../http/session.ts'
import { acceptedVersions, missingAcceptances, recordAcceptances } from './acceptances.ts'
import { classifyDateOfBirth } from './age.ts'
import {
  AGE_BLOCK_COOKIE,
  AGE_BLOCK_MAX_AGE_S,
  AGE_OK_COOKIE,
  AGE_OK_MAX_AGE_S,
  cookieOptions,
  LEGAL_PENDING_COOKIE,
  LEGAL_PENDING_MAX_AGE_S,
  NEUTRAL_REFUSAL,
  type PendingAcceptance,
  readGate,
  signAgeOk,
  signPending,
} from './gate.ts'

const documentSchema = z.enum(Object.keys(LEGAL_VERSIONS) as [LegalDocument, ...LegalDocument[]])
const acceptanceItem = z.object({ document: documentSchema, version: z.string().max(32) })
const acceptanceBody = z.union([
  acceptanceItem,
  z.object({ documents: z.array(acceptanceItem).min(1).max(10) }),
])
const ageBody = z.object({ dateOfBirth: z.string().max(10) })

/**
 * For routes that need a fully onboarded player (lobbies and games, M4+): requires a session
 * that has accepted the current Terms/Privacy versions, so the clickwrap is enforced on the
 * server and not only by the web client's gate.
 */
export function requireCurrentAcceptance(db: Database) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const session = res.locals.session
    if (!session) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in first.' })
      return
    }
    const missing = await missingAcceptances(db, session.user.id)
    if (missing.length > 0) {
      res.status(403).json({
        error: 'LEGAL_ACCEPTANCE_REQUIRED',
        message: 'Please accept the current Terms of Service and Privacy Policy first.',
        missing,
      })
      return
    }
    next()
  }
}

export function legalRouter({ config, db, auth }: { config: AppConfig; db: Database; auth: Auth }) {
  const router = Router()

  router.get('/versions', (_req, res) => {
    res.json({ versions: LEGAL_VERSIONS })
  })

  /** Required versions plus what the signed-in user (if any) has accepted. */
  router.get('/status', async (req, res) => {
    const gate = readGate(config, req.headers.cookie)
    const session = await loadSession(auth, req)
    const accepted = session ? await acceptedVersions(db, session.user.id) : {}
    const missing = (Object.keys(LEGAL_VERSIONS) as LegalDocument[]).filter(
      (d) => accepted[d] !== LEGAL_VERSIONS[d],
    )
    res.json({
      required: LEGAL_VERSIONS,
      accepted,
      needsAcceptance: session ? missing.length > 0 : undefined,
      ageConfirmed: session ? Boolean(session.user.ageConfirmed) : Boolean(gate.ageOk),
      ageBand: (session ? session.user.ageBand : gate.ageOk?.band) ?? null,
      blocked: gate.blocked,
    })
  })

  /**
   * Neutral age screen. Receives the full date of birth, decides 13+ and the age band here,
   * and discards the date: only the band and today's date are kept. Under-13 answers get a
   * neutral refusal, store nothing, and set a cookie that blocks an immediate retry.
   */
  router.post(
    '/age-confirmation',
    fixedWindowLimiter({
      windowMs: 60_000,
      max: 10,
      key: (req) => clientIp(req, config),
      // A mistyped date (400) doesn't count against the limit.
      countIf: (status) => status !== 400,
    }),
    async (req: Request, res: Response) => {
      const parsed = ageBody.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_DATE', message: 'Enter a valid date.' })
        return
      }
      const gate = readGate(config, req.headers.cookie)
      const refuse = () => {
        res.clearCookie(AGE_OK_COOKIE, { path: '/' })
        res.cookie(AGE_BLOCK_COOKIE, '1', cookieOptions(config, AGE_BLOCK_MAX_AGE_S))
        res.status(403).json({ allowed: false, error: 'NOT_AVAILABLE', message: NEUTRAL_REFUSAL })
      }
      if (gate.blocked) {
        refuse()
        return
      }
      const age = classifyDateOfBirth(parsed.data.dateOfBirth)
      if (age.result === 'invalid') {
        res.status(400).json({ error: 'INVALID_DATE', message: 'Enter a valid date.' })
        return
      }
      if (age.result === 'under') {
        refuse()
        return
      }
      const now = new Date()
      res.cookie(
        AGE_OK_COOKIE,
        signAgeOk(config, age.band, now),
        cookieOptions(config, AGE_OK_MAX_AGE_S),
      )
      const session = await loadSession(auth, req)
      if (session && !session.user.ageConfirmed) {
        await db
          .update(users)
          .set({ ageConfirmed: true, ageBand: age.band, ageConfirmedAt: now })
          .where(eq(users.id, session.user.id))
      }
      res.json({ allowed: true })
    },
  )

  /**
   * Clickwrap acceptance. With a session the acceptance is recorded immediately; it is
   * also kept in a short-lived signed cookie so an account created next (signup, guest,
   * guest upgrade) gets it recorded at creation.
   */
  router.post('/acceptances', async (req, res) => {
    const parsed = acceptanceBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_BODY', message: 'Unknown document.' })
      return
    }
    const items = 'documents' in parsed.data ? parsed.data.documents : [parsed.data]
    const stale = items.filter((i) => LEGAL_VERSIONS[i.document] !== i.version)
    if (stale.length > 0) {
      res.status(409).json({
        error: 'VERSION_MISMATCH',
        message: 'These documents have changed. Please review the current versions.',
        required: LEGAL_VERSIONS,
      })
      return
    }
    const now = new Date()
    const gate = readGate(config, req.headers.cookie)
    const pending: PendingAcceptance = { ...(gate.pending ?? {}), at: now.toISOString() }
    for (const i of items) pending[i.document] = i.version
    res.cookie(
      LEGAL_PENDING_COOKIE,
      signPending(config, pending),
      cookieOptions(config, LEGAL_PENDING_MAX_AGE_S),
    )

    const session = await loadSession(auth, req)
    if (!session) {
      res.status(202).json({ recorded: false, pending: true })
      return
    }
    const ipHash = hashIp(clientIp(req, config), config.ipHashSecret)
    await recordAcceptances(db, session.user.id, items, now, ipHash)
    res.status(201).json({ recorded: true })
  })

  router.get('/acceptances', requireSession(auth), async (_req, res) => {
    const { user } = sessionOf(res)
    const rows = await db
      .select({
        document: legalAcceptances.document,
        version: legalAcceptances.version,
        kind: legalAcceptances.kind,
        acceptedAt: legalAcceptances.acceptedAt,
      })
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, user.id))
      .orderBy(desc(legalAcceptances.acceptedAt))
    res.json({ acceptances: rows })
  })

  return router
}
