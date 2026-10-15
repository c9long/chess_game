import type { Database } from '@game/db'
import type { Auth } from '../auth/auth.ts'
import { missingAcceptances } from '../legal/acceptances.ts'
import { joinError } from './errors.ts'

/** Who a room client is (`client.auth`). */
export interface PlayerAuth {
  userId: string
  displayName: string
  isGuest: boolean
}

/**
 * Resolves the Better Auth session from a matchmaking request: the session cookie (web) or
 * `Authorization: Bearer <token>` (native clients), and applies the same checks as
 * `requireCurrentAcceptance` plus the onboarding rules for playing: age confirmed, current
 * Terms/Privacy accepted, and (registered accounts) a username chosen.
 */
export async function resolvePlayer(
  auth: Auth,
  db: Database,
  headers: Headers,
): Promise<PlayerAuth> {
  const session = await auth.api.getSession({ headers }).catch(() => null)
  if (!session) throw joinError('unauthorized')
  const user = session.user as typeof session.user & {
    isAnonymous?: boolean | null
    username?: string | null
    displayUsername?: string | null
    ageConfirmed?: boolean | null
    deletedAt?: Date | null
  }
  if (user.deletedAt) throw joinError('unauthorized')
  if (!user.ageConfirmed) throw joinError('age_confirmation_required')
  if ((await missingAcceptances(db, user.id)).length > 0) {
    throw joinError('legal_acceptance_required')
  }
  const isGuest = Boolean(user.isAnonymous)
  if (!isGuest && !user.username) throw joinError('username_required')
  return {
    userId: user.id,
    displayName:
      (isGuest ? user.name : (user.displayUsername ?? user.username ?? user.name)) || 'Player',
    isGuest,
  }
}
