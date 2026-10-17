/**
 * Friends and challenges over REST (PLAN §3 "Friends"), for the web and native apps (session
 * cookie or bearer token). Registered accounts only; guests get ACCOUNT_REQUIRED. Every action
 * is here, so clients that can't hold the `social` room open can poll instead.
 */
import type { Database } from '@game/db'
import {
  blockBodySchema,
  CHALLENGES_PER_10_MIN,
  challengeBodySchema,
  FRIEND_REQUESTS_PER_HOUR,
  friendRequestBodySchema,
  type MatchRelationsResponse,
  PLAYER_SEARCHES_PER_MIN,
  type PlayerSearchResponse,
  PROFILE_VIEWS_PER_MIN,
  playerSearchQuerySchema,
  type SocialSettingsResponse,
  type SocialUser,
  socialSettingsBodySchema,
  usernameQuerySchema,
} from '@game/protocol'
import { type NextFunction, type Request, type Response, Router } from 'express'
import { z } from 'zod'
import type { Auth } from '../auth/auth.ts'
import type { AppConfig } from '../config.ts'
import { clientIp } from '../http/client-ip.ts'
import { fixedWindowLimiter } from '../http/security.ts'
import { requireSession, sessionOf } from '../http/session.ts'
import { requireCurrentAcceptance } from '../legal/routes.ts'
import { resolveTarget } from '../moderation/targets.ts'
import { blockedAmong, blockedByAmong } from './blocks.ts'
import { countsOf, matchSeatsOf, relationsOf, SocialError, usernameOf } from './friends.ts'
import {
  friendRequestPolicyOf,
  profileOf,
  searchPlayers,
  setFriendRequestPolicy,
} from './profiles.ts'
import type { SocialService } from './service.ts'

/** Ids in paths: Better Auth ids (letters, digits, `-`, `_`). */
const idParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** The signed-in registered user, from the session (set by `registeredOnly`). */
function me(res: Response): SocialUser {
  const user = sessionOf(res).user as ReturnType<typeof sessionOf>['user'] & {
    displayUsername?: string | null
    username?: string | null
  }
  return {
    userId: user.id,
    username: usernameOf({
      displayUsername: user.displayUsername ?? null,
      username: user.username ?? null,
      name: user.name,
    }),
  }
}

function registeredOnly(_req: Request, res: Response, next: NextFunction) {
  const user = sessionOf(res).user as { isAnonymous?: boolean | null; username?: string | null }
  if (user.isAnonymous || !user.username) {
    res.status(403).json({
      error: 'ACCOUNT_REQUIRED',
      message: 'Create an account to add friends.',
    })
    return
  }
  next()
}

/** Wraps an async handler: SocialError -> its status and code, bad input -> 400. */
function handle(fn: (req: Request, res: Response) => Promise<unknown> | unknown) {
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

export function socialRouter({
  config,
  db,
  auth,
  social,
}: {
  config: AppConfig
  db: Database
  auth: Auth
  social: SocialService
}) {
  const router = Router()
  const guard = [requireSession(auth), requireCurrentAcceptance(db), registeredOnly]
  const requestLimiter = fixedWindowLimiter({
    windowMs: 60 * 60_000,
    max: FRIEND_REQUESTS_PER_HOUR,
    key: byUser,
  })
  const blockLimiter = fixedWindowLimiter({ windowMs: 60 * 60_000, max: 60, key: byUser })
  const searchLimiter = fixedWindowLimiter({
    windowMs: 60_000,
    max: PLAYER_SEARCHES_PER_MIN,
    key: byUser,
  })
  // Registered viewers count per account; guests per client IP, since a guest session costs
  // nothing (otherwise one IP could mint a guest every few seconds and read ~5x as many).
  const profileLimiter = fixedWindowLimiter({
    windowMs: 60_000,
    max: PROFILE_VIEWS_PER_MIN,
    key: (req) => {
      const user = req.res?.locals.session?.user as
        | { id: string; isAnonymous?: boolean | null }
        | undefined
      if (user && !user.isAnonymous) return `user:${user.id}`
      return `ip:${clientIp(req, config) ?? 'unknown'}`
    },
  })
  const challengeLimiter = fixedWindowLimiter({
    windowMs: 10 * 60_000,
    max: CHALLENGES_PER_10_MIN,
    key: byUser,
  })

  router.get(
    '/friends',
    ...guard,
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.json(await social.list(me(res).userId))
    }),
  )

  /** Relation to every seat of a match you played in (for "Add friend" buttons). */
  router.get(
    '/friends/match/:matchId',
    ...guard,
    handle(async (req, res) => {
      const matchId = z.uuid().parse(req.params.matchId)
      const my = me(res).userId
      const { shared, seats } = await matchSeatsOf(db, matchId)
      if (!seats.some((s) => s.userId === my)) {
        throw new SocialError('NOT_FOUND', 404, 'That game was not found.')
      }
      const others: string[] = []
      for (const s of seats) if (s.userId && s.userId !== my) others.push(s.userId)
      const relations = await relationsOf(db, my, others)
      const blocked = await blockedAmong(db, my, others)
      const blockedBy = await blockedByAmong(db, my, others)
      const counts = await countsOf(db, my)
      const body: MatchRelationsResponse = {
        matchId,
        capReached: counts.friends >= social.options.maxFriends,
        outgoingFull: counts.outgoing >= social.options.maxOutgoing,
        seats: seats.map((s) => ({
          seat: s.seat,
          relation:
            s.userId === my
              ? 'self'
              : !shared || !s.userId || !s.registered || blockedBy.has(s.userId)
                ? 'ineligible'
                : (relations.get(s.userId) ?? 'none'),
          blocked: Boolean(s.userId && s.registered && blocked.has(s.userId)),
          blockable: Boolean(s.userId && s.registered && s.userId !== my),
        })),
      }
      res.setHeader('Cache-Control', 'no-store')
      res.json(body)
    }),
  )

  router.post(
    '/friends/requests',
    ...guard,
    requestLimiter,
    handle(async (req, res) => {
      const body = friendRequestBodySchema.parse(req.body)
      res.json(await social.request(me(res), body))
    }),
  )

  /** Your "who can send me friend requests" setting (Account page). */
  router.get(
    '/friends/settings',
    ...guard,
    handle(async (_req, res) => {
      const body: SocialSettingsResponse = {
        friendRequests: await friendRequestPolicyOf(db, me(res).userId),
      }
      res.setHeader('Cache-Control', 'no-store')
      res.json(body)
    }),
  )

  router.put(
    '/friends/settings',
    ...guard,
    handle(async (req, res) => {
      const body = socialSettingsBodySchema.parse(req.body)
      await setFriendRequestPolicy(db, me(res).userId, body.friendRequests)
      const out: SocialSettingsResponse = { friendRequests: body.friendRequests }
      res.json(out)
    }),
  )

  /**
   * Player search (registered accounts): prefix, then fuzzy matches on usernames. See
   * PlayerSearchResponse in @game/protocol for what is listed and what never is. On the
   * collection path (`/players?q=`), not `/players/search`, so it can never shadow the
   * profile of a player whose username is "search".
   */
  router.get(
    '/players',
    ...guard,
    searchLimiter,
    handle(async (req, res) => {
      const { q } = playerSearchQuerySchema.parse(req.query)
      const out = await searchPlayers(db, social.options, me(res).userId, q, {
        trigram: social.options.searchTrigram,
      })
      const body: PlayerSearchResponse = { query: q, ...out }
      res.setHeader('Cache-Control', 'no-store')
      res.json(body)
    }),
  )

  /**
   * A player's public profile (any signed-in viewer, guests included). Unknown, guest,
   * deleted and suspended accounts all answer the same 404.
   */
  router.get(
    '/players/:username',
    requireSession(auth),
    requireCurrentAcceptance(db),
    profileLimiter,
    handle(async (req, res) => {
      const name = usernameQuerySchema.safeParse(req.params.username)
      const viewer = sessionOf(res).user as { id: string; isAnonymous?: boolean | null }
      const profile = name.success
        ? await profileOf(db, social.options, viewer.isAnonymous ? undefined : viewer.id, name.data)
        : undefined
      if (!profile) throw new SocialError('NOT_FOUND', 404, 'Player not found.')
      res.setHeader('Cache-Control', 'no-store')
      res.json(profile)
    }),
  )

  router.post(
    '/friends/requests/:userId/accept',
    ...guard,
    handle(async (req, res) => {
      res.json(await social.accept(me(res), idParam.parse(req.params.userId)))
    }),
  )

  router.post(
    '/friends/requests/:userId/decline',
    ...guard,
    handle(async (req, res) => {
      await social.decline(me(res).userId, idParam.parse(req.params.userId))
      res.status(204).end()
    }),
  )

  /** Cancel your own pending request. */
  router.delete(
    '/friends/requests/:userId',
    ...guard,
    handle(async (req, res) => {
      await social.cancel(me(res).userId, idParam.parse(req.params.userId))
      res.status(204).end()
    }),
  )

  router.delete(
    '/friends/:userId',
    ...guard,
    handle(async (req, res) => {
      await social.remove(me(res).userId, idParam.parse(req.params.userId))
      res.status(204).end()
    }),
  )

  /**
   * Block a player (registered accounts only): the player in a seat of a game you played in,
   * or someone on your Friends page. Removes your friendship or request; see blocks.ts.
   */
  router.post(
    '/blocks',
    ...guard,
    blockLimiter,
    handle(async (req, res) => {
      const body = blockBodySchema.parse(req.body)
      const my = me(res).userId
      const target = await resolveTarget(db, my, body)
      if (!target.registered) {
        throw new SocialError('NOT_ELIGIBLE', 403, 'Only registered players can be blocked.')
      }
      res.json(await social.block(my, { userId: target.userId, username: target.name }))
    }),
  )

  router.delete(
    '/blocks/:userId',
    ...guard,
    handle(async (req, res) => {
      await social.unblock(me(res).userId, idParam.parse(req.params.userId))
      res.status(204).end()
    }),
  )

  /** Unblock the player in a seat of a game you played in (menus that know no user id). */
  router.delete(
    '/blocks/match/:matchId/:seat',
    ...guard,
    handle(async (req, res) => {
      const my = me(res).userId
      const target = await resolveTarget(db, my, {
        matchId: z.uuid().parse(req.params.matchId),
        seat: z.coerce.number().int().min(0).max(3).parse(req.params.seat) as 0 | 1 | 2 | 3,
      })
      await social.unblock(my, target.userId)
      res.status(204).end()
    }),
  )

  router.get(
    '/challenges',
    ...guard,
    handle(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.json(await social.challenges(me(res).userId))
    }),
  )

  router.post(
    '/challenges',
    ...guard,
    challengeLimiter,
    handle(async (req, res) => {
      const body = challengeBodySchema.parse(req.body)
      const challenge = await social.challenge(me(res), {
        friendIds: body.friendIds,
        mode: body.mode,
        timeControl: body.timeControl,
        roomId: body.roomId,
      })
      res.status(201).json({ challenge })
    }),
  )

  router.post(
    '/challenges/:id/decline',
    ...guard,
    handle((req, res) => {
      social.declineChallenge(idParam.parse(req.params.id), me(res).userId)
      res.status(204).end()
    }),
  )

  /** The challenger withdraws the invitation (the lobby stays open). */
  router.delete(
    '/challenges/:id',
    ...guard,
    handle((req, res) => {
      social.cancelChallenge(idParam.parse(req.params.id), me(res).userId)
      res.status(204).end()
    }),
  )

  return router
}
