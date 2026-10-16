// Strict runtime checks that engine output matches the hand-written types in
// ../types.ts exactly: same keys (no more, no fewer) and only allowed values.
import {
  CIV_IDS,
  DEFEAT_REASONS,
  GAME_MODES,
  type GameEvent,
  MOVE_FLAGS,
  type MoveView,
  NUM_SQUARES,
  PIECE_KINDS,
  SEAT_STATUSES,
  SEATS,
  type Snapshot,
  squareIndex,
  squareName,
  TEAMS,
} from '../types.ts'

type Obj = Record<string, unknown>

function fail(path: string, msg: string, value: unknown): never {
  throw new Error(`${path}: ${msg} (got ${JSON.stringify(value)})`)
}

function obj(v: unknown, keys: readonly string[], path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected object', v)
  const actual = Object.keys(v).sort()
  const expected = [...keys].sort()
  if (actual.join() !== expected.join()) fail(path, `expected keys ${expected.join(',')}`, actual)
  return v as Obj
}

function oneOf(v: unknown, values: readonly unknown[], path: string): void {
  if (!values.includes(v)) fail(path, `expected one of ${values.join('|')}`, v)
}

function bool(v: unknown, path: string): void {
  if (typeof v !== 'boolean') fail(path, 'expected boolean', v)
}

function uint(v: unknown, path: string): void {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail(path, 'expected uint', v)
}

function square(v: unknown, path: string): void {
  if (typeof v !== 'string' || !/^[a-l](1[0-2]|[1-9])$/.test(v)) fail(path, 'expected square', v)
  if (squareName(squareIndex(v as never)) !== v) fail(path, 'square helpers disagree', v)
}

function tuple4(v: unknown, path: string, each: (x: unknown, p: string) => void): void {
  if (!Array.isArray(v) || v.length !== 4) fail(path, 'expected 4-tuple', v)
  v.forEach((x, i) => {
    each(x, `${path}[${i}]`)
  })
}

function nullable(v: unknown, path: string, each: (x: unknown, p: string) => void): void {
  if (v !== null) each(v, path)
}

function piece(v: unknown, path: string): void {
  const o = obj(v, ['kind', 'owner'], path)
  oneOf(o.kind, PIECE_KINDS, `${path}.kind`)
  oneOf(o.owner, SEATS, `${path}.owner`)
}

function notation(v: unknown, path: string): void {
  if (typeof v !== 'string' || !/^[a-l]\d{1,2}[a-l]\d{1,2}[qrbn]?$/.test(v)) {
    fail(path, 'expected move notation', v)
  }
}

export function validateOutcome(v: unknown, path = 'outcome'): void {
  const o = obj(v, ['result', 'placements'], path)
  tuple4(o.placements, `${path}.placements`, (x, p) => {
    oneOf(x, [1, 2, 3, 4], p)
  })
  const r = o.result as Obj
  const rp = `${path}.result`
  switch (r?.type) {
    case 'ffa_winner':
      obj(r, ['type', 'seat'], rp)
      oneOf(r.seat, SEATS, `${rp}.seat`)
      break
    case 'ffa_move_limit_tie':
    case 'ffa_agreed_draw':
      obj(r, ['type', 'survivors'], rp)
      tuple4(r.survivors, `${rp}.survivors`, bool)
      break
    case 'teams_winner':
      obj(r, ['type', 'team'], rp)
      oneOf(r.team, TEAMS, `${rp}.team`)
      break
    case 'teams_draw':
    case 'teams_agreed_draw':
      obj(r, ['type'], rp)
      break
    default:
      fail(rp, 'unknown result type', r)
  }
}

export function validateSnapshot(v: unknown): asserts v is Snapshot {
  const s = obj(
    v,
    [
      'rulesVersion',
      'config',
      'board',
      'statuses',
      'seatToMove',
      'castling',
      'epTargets',
      'noProgress',
      'moveLimit',
      'ply',
      'defeats',
      'outcome',
      'isOver',
      'hash',
      'leaderUnderAttack',
    ],
    'snapshot',
  )
  uint(s.rulesVersion, 'rulesVersion')
  const c = obj(
    s.config,
    ['mode', 'civs', 'enPassant', 'moveLimitRounds', 'rulesVersion'],
    'config',
  )
  oneOf(c.mode, GAME_MODES, 'config.mode')
  tuple4(c.civs, 'config.civs', (x, p) => {
    const civ = obj(x, ['id', 'version'], p)
    oneOf(civ.id, CIV_IDS, `${p}.id`)
    uint(civ.version, `${p}.version`)
  })
  bool(c.enPassant, 'config.enPassant')
  uint(c.moveLimitRounds, 'config.moveLimitRounds')
  uint(c.rulesVersion, 'config.rulesVersion')
  if (!Array.isArray(s.board) || s.board.length !== NUM_SQUARES)
    fail('board', 'expected 144', s.board)
  s.board.forEach((x, i) => {
    nullable(x, `board[${i}]`, piece)
  })
  tuple4(s.statuses, 'statuses', (x, p) => {
    oneOf(x, SEAT_STATUSES, p)
  })
  oneOf(s.seatToMove, SEATS, 'seatToMove')
  tuple4(s.castling, 'castling', (x, p) => {
    const o = obj(x, ['long', 'short'], p)
    bool(o.long, `${p}.long`)
    bool(o.short, `${p}.short`)
  })
  tuple4(s.epTargets, 'epTargets', (x, p) => {
    nullable(x, p, (t, tp) => {
      const o = obj(t, ['skipped', 'pawn'], tp)
      square(o.skipped, `${tp}.skipped`)
      square(o.pawn, `${tp}.pawn`)
    })
  })
  uint(s.noProgress, 'noProgress')
  uint(s.moveLimit, 'moveLimit')
  uint(s.ply, 'ply')
  if (!Array.isArray(s.defeats) || s.defeats.length > 4)
    fail('defeats', 'expected array', s.defeats)
  s.defeats.forEach((x, i) => {
    const d = obj(x, ['seat', 'reason'], `defeats[${i}]`)
    oneOf(d.seat, SEATS, `defeats[${i}].seat`)
    oneOf(d.reason, DEFEAT_REASONS, `defeats[${i}].reason`)
  })
  nullable(s.outcome, 'outcome', validateOutcome)
  bool(s.isOver, 'isOver')
  if ((s.outcome === null) === s.isOver) fail('outcome', 'must be set exactly when isOver', s)
  if (typeof s.hash !== 'string' || !/^[0-9a-f]{16}$/.test(s.hash)) fail('hash', 'hex16', s.hash)
  tuple4(s.leaderUnderAttack, 'leaderUnderAttack', bool)
}

export function validateMove(v: unknown, path = 'move'): asserts v is MoveView {
  const m = obj(v, ['notation', 'from', 'to', 'promotion', 'flag', 'piece', 'capture'], path)
  notation(m.notation, `${path}.notation`)
  square(m.from, `${path}.from`)
  square(m.to, `${path}.to`)
  nullable(m.promotion, `${path}.promotion`, (x, p) => {
    oneOf(x, PIECE_KINDS, p)
  })
  oneOf(m.flag, MOVE_FLAGS, `${path}.flag`)
  oneOf(m.piece, PIECE_KINDS, `${path}.piece`)
  bool(m.capture, `${path}.capture`)
  const promo = m.promotion === null ? '' : m.promotion === 'knight' ? 'n' : String(m.promotion)[0]
  if (m.notation !== `${m.from}${m.to}${promo}`) fail(path, 'notation mismatch', m)
}

export function validateEvent(v: unknown, path = 'event'): asserts v is GameEvent {
  const e = v as Obj
  const seat = (): void => {
    oneOf(e.seat, SEATS, `${path}.seat`)
  }
  switch (e?.type) {
    case 'move_made':
      obj(e, ['type', 'seat', 'notation', 'from', 'to', 'promotion', 'flag', 'piece'], path)
      seat()
      notation(e.notation, `${path}.notation`)
      square(e.from, `${path}.from`)
      square(e.to, `${path}.to`)
      nullable(e.promotion, `${path}.promotion`, (x, p) => {
        oneOf(x, PIECE_KINDS, p)
      })
      oneOf(e.flag, MOVE_FLAGS, `${path}.flag`)
      oneOf(e.piece, PIECE_KINDS, `${path}.piece`)
      break
    case 'capture':
      obj(e, ['type', 'seat', 'square', 'captured'], path)
      seat()
      square(e.square, `${path}.square`)
      piece(e.captured, `${path}.captured`)
      break
    case 'en_passant':
      obj(e, ['type', 'seat', 'capturedSquare'], path)
      seat()
      square(e.capturedSquare, `${path}.capturedSquare`)
      break
    case 'promotion':
      obj(e, ['type', 'seat', 'square', 'kind'], path)
      seat()
      square(e.square, `${path}.square`)
      oneOf(e.kind, PIECE_KINDS, `${path}.kind`)
      break
    case 'castle':
      obj(e, ['type', 'seat', 'rookFrom', 'rookTo'], path)
      seat()
      square(e.rookFrom, `${path}.rookFrom`)
      square(e.rookTo, `${path}.rookTo`)
      break
    case 'pass':
      obj(e, ['type', 'seat', 'notation'], path)
      seat()
      oneOf(e.notation, ['--'], `${path}.notation`)
      break
    case 'defeat':
      obj(e, ['type', 'seat', 'reason'], path)
      seat()
      oneOf(e.reason, DEFEAT_REASONS, `${path}.reason`)
      break
    case 'army_removed':
    case 'frozen':
      obj(e, ['type', 'seat'], path)
      seat()
      break
    case 'game_ended':
      obj(e, ['type', 'outcome'], path)
      validateOutcome(e.outcome, `${path}.outcome`)
      break
    default:
      fail(path, 'unknown event type', e)
  }
}

export function validateEvents(v: unknown): asserts v is GameEvent[] {
  if (!Array.isArray(v)) fail('events', 'expected array', v)
  v.forEach((e, i) => {
    validateEvent(e, `events[${i}]`)
  })
}
