/** Position strings and move scripts for tests (all checked against the engine). */

/** South to move with j1/k1 cleared: i1k1 castles short. */
export const CASTLE_READY =
  'ffa 4nRnNnBnQnKnBnNnR4/4nPnPnPnPnPnPnPnP4/16/16/wRwP12ePeR/wNwP12ePeN/wBwP12ePeB/wKwP12ePeK/wQwP12ePeQ/wBwP12ePeB/wNwP12ePeN/wRwP12ePeR/16/16/4sPsPsPsPsPsPsPsP4/4sRsNsBsQsK2sR4 S AAAA Se1,Sl1,Wa5,Wa12,Ne16,Nl16,Ep5,Ep12 - 0 0'

/** FFA: South's queen on i1 can take North's king on i16; North also has a pawn on e15. */
export const KING_HUNT =
  'ffa 8nK7/4nP11/16/16/16/16/16/wK15/16/16/16/16/16/16/16/sK7sQ6eK S AAAA - - 0 0'

/**
 * From the start: South's e-pawn walks to e8 (one step before its promotion
 * line, rank 9) while the others shuffle knights.
 */
export const TO_PROMOTION = [
  'e2e4',
  'a6c7',
  'f16e14',
  'p6n7',
  'e4e5',
  'c7a6',
  'e14f16',
  'n7p6',
  'e5e6',
  'a6c7',
  'f16e14',
  'p6n7',
  'e6e7',
  'c7a6',
  'e14f16',
  'n7p6',
  'e7e8',
  'a6c7',
  'f16e14',
  'p6n7',
]

/**
 * En passant needs captures first on the 16×16 board (no pawn starts next to
 * another army's pawn), so it is set up directly: kings at home, South's e2
 * pawn and West's d4 pawn. After `e2e4`, West's `d4e3` takes en passant.
 */
export const EN_PASSANT_READY =
  'ffa 8nK7/16/16/16/16/16/16/wK14eK/16/16/16/16/3wP12/16/4sP11/8sK7 S AAAA - - 0 0'
