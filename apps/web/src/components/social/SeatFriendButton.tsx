import type { MatchStateJson } from '@game/protocol/state'
import type { ReactNode } from 'react'
import { isGuest, useAppState } from '../../lib/app-state.tsx'
import { useMatchStore } from '../../lib/match.ts'
import { sendFriendRequest, useMatchRelations } from '../../lib/social.ts'
import { seatName } from '../match/labels.ts'
import { FriendButton } from './FriendButton.tsx'
import { PlayerMenu } from './PlayerMenu.tsx'

/**
 * Per seat of a live or finished game (the player cards and the result screen): "Add friend"
 * for other registered players, and the "⋮" menu (Block / Unblock, Report) for every other
 * person. Returns null for yourself, bots, solo games and before the game starts. Guests get
 * Report only. Sending a request back to someone who asked you accepts theirs, so both friend
 * actions are the same call.
 */
export function useSeatFriendActions(
  state: MatchStateJson,
  untimed: boolean,
): (seat: number, compact: boolean) => ReactNode {
  const { session } = useAppState()
  const mySessionId = useMatchStore((s) => s.room?.sessionId)
  const registered = Boolean(session) && !isGuest(session?.user)
  const enabled = registered && !untimed
  const relations = useMatchRelations(state.matchId, enabled)
  return (seat, compact) => {
    const info = state.seats[seat]
    if (!info?.occupied || info.isBot || untimed || !state.matchId || !session) return null
    const rel = relations?.seats.find((s) => s.seat === seat)
    if (rel?.relation === 'self' || (mySessionId && info.sessionId === mySessionId)) return null
    if (registered && !rel) return null // relations still loading
    const blocked = rel?.blocked ?? false
    const friendable = rel && rel.relation !== 'ineligible' && !blocked
    const add = () => sendFriendRequest(state.matchId, seat)
    const tag = `${compact ? 'card' : 'result'}`
    return (
      <span className="flex shrink-0 items-center gap-1">
        {friendable && relations ? (
          <FriendButton
            name={info.displayName}
            relation={rel.relation}
            capReached={relations.capReached}
            outgoingFull={relations.outgoingFull}
            onAdd={add}
            onAccept={add}
            compact={compact}
            shortOnPhones
            testId={`${tag}-friend-${seatName(seat)}`}
          />
        ) : null}
        <PlayerMenu
          name={info.displayName}
          target={{ matchId: state.matchId, seat: seat as 0 | 1 | 2 | 3 }}
          viewerRegistered={registered}
          targetRegistered={rel ? rel.blockable : !info.isGuest}
          blocked={blocked}
          reportable
          compact={compact}
          testId={`${tag}-menu-${seatName(seat)}`}
        />
      </span>
    )
  }
}
