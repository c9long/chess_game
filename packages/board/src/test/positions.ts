/** Position strings and move scripts for tests (all checked against the engine). */

/** South to move with h1/i1 cleared: g1i1 castles short. */
export const CASTLE_READY =
  'ffa 2nRnNnBnQnKnBnNnR2/2nPnPnPnPnPnPnPnP2/wRwP8ePeR/wNwP8ePeN/wBwP8ePeB/wKwP8ePeK/wQwP8ePeQ/wBwP8ePeB/wNwP8ePeN/wRwP8ePeR/2sPsPsPsPsPsPsPsP2/2sRsNsBsQsK2sR2 S AAAA Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10 - 0 0'

/** FFA: South's queen on g1 can take North's king on g12; North also has a pawn on c11. */
export const KING_HUNT = 'ffa 6nK5/2nP9/12/12/12/wK11/12/12/12/12/12/sK5sQ4eK S AAAA - - 0 0'

/** From the start: South's e-pawn walks to e6 while the others shuffle knights. */
export const TO_PROMOTION = [
  'e2e4',
  'a4c5',
  'd12e10',
  'l4j5',
  'e4e5',
  'c5a4',
  'e10d12',
  'j5l4',
  'e5e6',
  'a4c5',
  'd12e10',
  'l4j5',
]

/** From the start: West double-steps b6-d6 past South's d5 pawn (en passant on c6). */
export const TO_EN_PASSANT = ['d2d4', 'a4c5', 'd12e10', 'l4j5', 'd4d5', 'b6d6', 'e10d12', 'j5l4']
