/**
 * When to show the check indicator (decided rule; see docs/RULES.md "Check indicators").
 *
 * Self-check is legal and is never prevented or warned about in advance. The indicator is only
 * for the viewer's own seat (other players and spectators see none), and only:
 * - (a) `check`: it is the viewer's turn and their leader is under attack (someone else put
 *   them in check, or it is still attacked from before);
 * - (b) `self_check`: right after the viewer completes a move that leaves their own leader
 *   under attack. It stays until the leader is no longer attacked (when the viewer's turn
 *   comes round with it still attacked, it shows as `check`).
 * A check that opponents create while it isn't the viewer's turn is not shown until the
 * viewer's turn starts.
 *
 * "Under attack" always comes from the rules engine (`Snapshot.leaderUnderAttack`); this
 * module only decides visibility, never whether a leader is attacked.
 */

export type CheckNotice = 'none' | 'check' | 'self_check'

/** What the engine says about the position now shown (from its snapshot; seats as indexes). */
export interface CheckPosition {
  readonly ply: number
  readonly seatToMove: number
  readonly isOver: boolean
  readonly leaderUnderAttack: readonly boolean[]
}

/** The action that produced the position, when known (the server's `events` message). */
export interface CheckAction {
  readonly seat: number
  /** `move`, `timeout`, `abandon`, `resign`, `agreed_draw`, ... */
  readonly action: string
}

/** What carries over between positions. */
export interface CheckMemo {
  /** The viewer's own move left their leader attacked, and it has been attacked ever since. */
  readonly selfCheck: boolean
  /** The previous position seen (to recognise the viewer's own move without its events). */
  readonly prev: { readonly ply: number; readonly seatToMove: number } | null
}

export const INITIAL_CHECK: CheckMemo = { selfCheck: false, prev: null }

/**
 * The next memo and notice for a newly shown position.
 *
 * `action` is the action that produced `pos`, or `null` when unknown (first load, reconnect,
 * a state patch). Without it the viewer's own move is still recognised when the previous
 * position had the viewer to move and exactly one turn was taken since; anything else counts
 * as not the viewer's move, so an unexplained check is held back until the viewer's turn.
 */
export function nextCheck(
  memo: CheckMemo,
  viewer: number,
  pos: CheckPosition,
  action: CheckAction | null,
): { memo: CheckMemo; notice: CheckNotice } {
  const prev = { ply: pos.ply, seatToMove: pos.seatToMove }
  const attacked = viewer >= 0 && pos.leaderUnderAttack[viewer] === true
  if (viewer < 0 || pos.isOver || !attacked) {
    return { memo: { selfCheck: false, prev }, notice: 'none' }
  }
  const viewerMoved = action
    ? action.action === 'move' && action.seat === viewer
    : memo.prev !== null && memo.prev.seatToMove === viewer && pos.ply === memo.prev.ply + 1
  const selfCheck = memo.selfCheck || viewerMoved
  const notice: CheckNotice =
    pos.seatToMove === viewer ? 'check' : selfCheck ? 'self_check' : 'none'
  return { memo: { selfCheck, prev }, notice }
}
