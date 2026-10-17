/**
 * @game/board: the PixiJS board renderer for the 4-player 16x16 game.
 *
 * ```ts
 * import { BoardView } from '@game/board'
 * const view = new BoardView({ onMoveIntent: (m) => send(m) })
 * await view.mount(element)
 * view.setPerspective('west')
 * view.setSnapshot(game.snapshot(), { events })
 * view.setInteractive('west')
 * view.setLegalMoves(game.legalMoves())
 * ```
 *
 * The renderer never decides legality; it only displays engine output and
 * reports the user's chosen move.
 */

export {
  type BoardOptions,
  BoardView,
  type BoardViewInit,
  type SetCheckOptions,
  type SetSnapshotOptions,
} from './BoardView.ts'
export * from './geometry.ts'
export { MoveIndex, type MoveTarget, PROMOTION_ORDER } from './moves.ts'
export {
  FROZEN_BASE,
  lightFor,
  type MarkerShape,
  outlineFor,
  SEAT_STYLES,
  type SeatStyle,
  seatColor,
} from './palette.ts'
export {
  type AnimationPlan,
  type PlannedCapture,
  type PlannedMove,
  type PlannedVanish,
  planTransition,
  type SoundCue,
  soundCues,
} from './plan.ts'
export type { SoundKind } from './sound.ts'
