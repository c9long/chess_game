/**
 * The `social` room: one realtime channel per signed-in registered client, for friends'
 * presence and notifications (friend requests, challenges). Clients only listen; every action
 * is a REST call. Authenticated like match rooms (session cookie, or a bearer token on native
 * clients). The room has no state; several instances are fine, since pushes go through the
 * process-wide SocialHub.
 */
import { type AuthContext, type Client, Room } from '@colyseus/core'
import { joinError } from '../game/errors.ts'
import {
  type ConnectionSession,
  type PlayerAuth,
  resolvePlayerSession,
} from '../game/player-auth.ts'
import type { SocialService } from './service.ts'

/** Open social connections per user (tabs and devices). */
export const MAX_SOCIAL_CONNECTIONS = 8

type SocialAuth = PlayerAuth & { session: ConnectionSession }
type SocialClient = Client<{ auth: SocialAuth }>

export class SocialRoom extends Room<{ client: SocialClient }> {
  /** Set by `attachGameServer` before the room type is defined. */
  static social: SocialService

  override maxClients = 10_000
  override maxMessagesPerSecond = 5

  static override async onAuth(_token: string, _options: unknown, context: AuthContext) {
    if (!context.req) throw joinError('unauthorized')
    const social = SocialRoom.social
    const { player, session } = await resolvePlayerSession(
      social.game.auth,
      social.db,
      context.headers,
    )
    if (player.isGuest) throw joinError('account_required')
    if (social.hub.connectionCount(player.userId) >= MAX_SOCIAL_CONNECTIONS) {
      throw joinError('too_many_attempts')
    }
    // Kept so the connection closes when that session ends (sign-out, revoke, expiry).
    return { ...player, session } satisfies SocialAuth
  }

  override onCreate() {
    // Never in the lobby browser.
    void this.setMatchmaking({ unlisted: true }).catch(() => {})
    // Nothing to send: actions are REST calls.
    this.onMessage('*', () => {})
  }

  override onJoin(client: SocialClient, _options: unknown, auth?: SocialAuth) {
    const player = auth ?? client.auth
    if (!player) throw joinError('unauthorized')
    SocialRoom.social.hub.attach(player.userId, client, player.session)
  }

  override onLeave(client: SocialClient) {
    const userId = client.auth?.userId
    if (userId) SocialRoom.social.hub.detach(userId, client)
  }
}
