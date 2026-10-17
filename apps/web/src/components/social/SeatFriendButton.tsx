import type { MatchStateJson } from '@game/protocol/state'
import type { ReactNode } from 'react'
import { isGuest, useAppState } from '../../lib/app-state.tsx'
import { sendFriendRequest, useMatchRelations } from '../../lib/social.ts'
import { seatName } from '../match/labels.ts'
import { FriendButton } from './FriendButton.tsx'

/**
 * "Add friend" buttons for the other registered players of a live or finished game (the
 * player cards and the result screen). Returns, per seat, the button or null (yourself, bots,
 * guests, solo games, and guests viewing). Sending a request back to someone who asked you
 * accepts theirs, so both actions are the same call.
 */
export function useSeatFriendActions(
  state: MatchStateJson,
  untimed: boolean,
): (seat: number, compact: boolean) => ReactNode {
  const { session } = useAppState()
  const enabled = Boolean(session) && !isGuest(session?.user) && !untimed
  const relations = useMatchRelations(state.matchId, enabled)
  return (seat, compact) => {
    const relation = relations?.seats.find((s) => s.seat === seat)?.relation
    const info = state.seats[seat]
    if (!relations || !relation || !info || relation === 'self' || relation === 'ineligible') {
      return null
    }
    const add = () => sendFriendRequest(state.matchId, seat)
    return (
      <FriendButton
        name={info.displayName}
        relation={relation}
        capReached={relations.capReached}
        outgoingFull={relations.outgoingFull}
        onAdd={add}
        onAccept={add}
        compact={compact}
        shortOnPhones
        testId={`${compact ? 'card' : 'result'}-friend-${seatName(seat)}`}
      />
    )
  }
}
