/**
 * Move choice for the landing page's self-playing demo board. Every rule decision comes from
 * the engine: the candidates are `game.legalMoves()`, and "can the next seat take this piece
 * right away?" is answered by applying the move to a cloned game and asking for the next
 * seat's legal moves. This file only scores those moves so the game looks pleasant: captures
 * by material, castling, promotion and early development; no early leader walks, few hanging
 * pieces, plus a little seeded randomness. It is not a bot and never decides legality.
 */
import {
  type CivId,
  type Game,
  type MoveView,
  type PieceKind,
  SEATS,
  type Snapshot,
  seatIndex,
  squareIndex,
} from '@game/rules'

const VALUE: Record<PieceKind, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3.25,
  rook: 5,
  queen: 9,
  // Taking a leader knocks a whole army out: always worth it.
  king: 30,
  // One of England's four Prime Ministers (only the last one knocks the army out).
  prime_minister: 5,
}

/** Small deterministic PRNG (mulberry32), so a seed replays the same game. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The games the landing page cycles through: civs per seat and the seed of the move picker's
 * randomness. Fixed, so every one of them is covered by demo-moves.test.ts (no army falls
 * early, the game ends). Only civs with the standard army appear: for them the civ is just an
 * emblem, so a seed replays the same game whatever civs it shows. (England, whose Prime
 * Ministers change the game, was swapped out when it got its Magna Carta ability.)
 */
export const DEMO_GAMES: readonly {
  readonly civs: readonly [CivId, CivId, CivId, CivId]
  readonly seed: number
}[] = [
  { civs: ['france', 'japan', 'mali', 'canada'], seed: 7936 },
  { civs: ['france', 'china', 'usa', 'germany'], seed: 15855 },
  { civs: ['russia', 'mali', 'japan', 'canada'], seed: 23774 },
  { civs: ['canada', 'germany', 'china', 'france'], seed: 31694 },
  { civs: ['usa', 'russia', 'china', 'mali'], seed: 39612 },
]

/** How many of the best-looking candidates get the (costlier) look-ahead check. */
const LOOKAHEAD = 16

/**
 * Leaving one's own leader attacked is legal in this game (leaders are captured, not mated),
 * but an army falling to a blunder is not pretty. This outweighs any capture, so a leader is
 * only left hanging when nothing saves it.
 */
const LEADER_HANGS = 40

export interface DemoContext {
  /** The starting position, to recognise pieces that haven't moved yet. */
  readonly start: Snapshot
  readonly random: () => number
}

/** Quick score from the current position only. */
function quickScore(move: MoveView, snap: Snapshot, ctx: DemoContext): number {
  let score = 0
  const round = snap.ply / 4
  if (move.capture) {
    const victim = snap.board[squareIndex(move.to)]
    // En passant: the destination is empty, the victim is a pawn.
    score += victim ? VALUE[victim.kind] : VALUE.pawn
    // Prefer taking with the cheaper piece.
    score -= VALUE[move.piece] * 0.05
  }
  if (move.promotion) score += move.promotion === 'queen' ? 8 : 2
  if (move.flag === 'castle') score += 2.2
  const startPiece = ctx.start.board[squareIndex(move.from)]
  const unmoved =
    startPiece !== null &&
    startPiece !== undefined &&
    startPiece.kind === move.piece &&
    startPiece.owner === snap.seatToMove
  if (round < 10 && unmoved && (move.piece === 'knight' || move.piece === 'bishop')) {
    score += 1.1
  }
  if (round < 6 && move.piece === 'pawn' && unmoved)
    score += move.flag === 'double_step' ? 0.6 : 0.3
  // Later on, pawns marching keep the game moving instead of pieces shuffling.
  if (round >= 10 && move.piece === 'pawn' && !move.capture) score += 0.35
  if (move.piece === 'king' && move.flag !== 'castle' && !move.capture) {
    score -= round < 14 ? 1.6 : 0.4
  }
  if (move.piece === 'queen' && round < 8 && !move.capture) score -= 0.7
  if ((move.piece === 'rook' || move.piece === 'queen') && round < 6 && !move.capture) {
    score -= 0.4
  }
  return score + ctx.random() * 0.6
}

/**
 * Picks the move to play for the seat to move, or null when there is none (game over).
 */
export function pickDemoMove(game: Game, ctx: DemoContext): MoveView | null {
  const moves = game.legalMoves()
  if (moves.length === 0) return null
  const snap = game.snapshot()
  const me = snap.seatToMove
  const scored = moves.map((m) => ({ m, s: quickScore(m, snap, ctx) })).sort((a, b) => b.s - a.s)
  // With the leader attacked, every move gets the look-ahead, so an escape is always found.
  const ranked = game.leaderUnderAttack(me) ? scored : scored.slice(0, LOOKAHEAD)

  let best = ranked[0] as { m: MoveView; s: number }
  let bestScore = Number.NEGATIVE_INFINITY
  for (const cand of ranked) {
    let score = cand.s
    const probe = game.clone()
    try {
      probe.applyMove(cand.m.notation)
      // Can whoever moves next take the piece on its new square straight away?
      const replies = probe.legalMoves()
      const hit = replies.some((r) => r.capture && r.to === cand.m.to)
      if (hit) {
        const mover = cand.m.promotion ?? cand.m.piece
        score -= VALUE[mover] * 0.85
      }
      if (probe.leaderUnderAttack(me)) score -= LEADER_HANGS
      // Attacking the leader of a seat that doesn't move next hands a third seat the kill
      // before the victim can react: legal, but it ends armies abruptly.
      const after = probe.snapshot()
      for (const seat of SEATS) {
        if (seat === me || seat === after.seatToMove) continue
        if (after.leaderUnderAttack[seatIndex(seat)]) score -= 6
      }
    } catch {
      score -= 100
    } finally {
      probe.free()
    }
    if (score > bestScore) {
      bestScore = score
      best = cand
    }
  }
  return best.m
}

/**
 * Plays up to `plies` demo moves at once, for the still position shown under reduced motion.
 * It stops early rather than show a position where an army has already fallen.
 */
export function playStillPosition(game: Game, ctx: DemoContext, plies: number): void {
  for (let i = 0; i < plies; i++) {
    const move = pickDemoMove(game, ctx)
    if (!move) return
    const probe = game.clone()
    try {
      probe.applyMove(move.notation)
      if (probe.snapshot().statuses.some((s) => s !== 'active')) return
    } finally {
      probe.free()
    }
    game.applyMove(move.notation)
  }
}
