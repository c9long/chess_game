/**
 * The "Watch" link a player or spectator can share from the game screen: the `/watch/<room>`
 * page, which checks on its own who may watch (the server decides at matchmaking). The note
 * says who that is, so nobody shares a link expecting more than it allows.
 */
import { SPECTATOR_DELAY_ROUNDS } from '@game/protocol'

/** The absolute watch page URL for a match room. */
export function watchUrl(origin: string, roomId: string): string {
  return `${origin}/watch/${encodeURIComponent(roomId)}`
}

/** Who may open the link (the same rules as watching), and a ranked game's delay. */
export function watchLinkNote(state: {
  inviteOnly: boolean
  hasPassword: boolean
  ranked: boolean
}): string {
  const who = state.inviteOnly
    ? 'Only the invited players and the host’s friends can watch.'
    : state.hasPassword
      ? 'Watchers need the lobby password.'
      : 'Anyone signed in can watch.'
  const delay = state.ranked
    ? ` Ranked games are shown ${SPECTATOR_DELAY_ROUNDS} rounds behind.`
    : ''
  return `${who}${delay}`
}
