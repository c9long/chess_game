import { BOT_LEVELS, CIVILIZATIONS, TIME_CONTROLS } from '@game/config'

/**
 * Wire protocol version. Bump on any incompatible change to room names, join options,
 * messages or the synced state layout. Clients send it in their join options and the
 * server rejects a mismatch with `protocol_mismatch`.
 */
export const PROTOCOL_VERSION = 1

/** Colyseus room types. */
export const ROOM_NAMES = {
  /** Built-in realtime listing of public lobbies (Colyseus LobbyRoom). */
  lobby: 'lobby',
  /** One room per lobby; the same room carries the live game. */
  match: 'match',
  /**
   * Friends' presence and notifications (registered accounts): every signed-in client
   * `joinOrCreate`s it once and listens; actions go through REST (see social.ts).
   */
  social: 'social',
  /**
   * Spectators of one match room (read-only, PLAN §3). Not joined by name: a client sends
   * `joinById(<match room id>, { protocolVersion, spectate: true })` and matchmaking hands it
   * a seat in that match's watch room. Its state is the match state (delayed for ranked games,
   * see SPECTATOR_DELAY_ROUNDS) and it accepts no game messages.
   */
  watch: 'watch',
} as const

/** Most spectators one match room admits at a time (`spectators_full` after that). */
export const SPECTATORS_MAX = 20

/**
 * Ranked games: spectators see the game at least this many full rounds late (anti-cheat: a
 * player can't have a friend relay the live board). Casual and solo games are live.
 */
export const SPECTATOR_DELAY_ROUNDS = 2

/** Rematch: how long the other players have to answer a proposal (then it counts as no). */
export const REMATCH_TIMEOUT_MS = 60_000

/**
 * Rematch: how long a player who accepted keeps their seat in the new lobby before it is
 * opened to anyone (they join it as soon as it exists).
 */
export const REMATCH_SEAT_HOLD_MS = 30_000

/**
 * `rematchVotes` entries in the room state: not asked (a bot, an empty seat, or no proposal),
 * waiting, accepted, declined (or no answer in time, or left the room).
 */
export const REMATCH_VOTE = { notVoter: -1, pending: 0, accepted: 1, declined: 2 } as const

/**
 * Colyseus endpoint path on the API origin: matchmaking is `POST {path}/matchmake/...` and
 * the WebSocket is `{path}/{processId}/{roomId}`. In development the web app proxies `/api`.
 */
export const COLYSEUS_PATH = '/api/colyseus'

/** Seats in turn order; a seat number is an index into this list (0 = South). */
export const SEAT_NAMES = ['south', 'west', 'north', 'east'] as const
export type SeatName = (typeof SEAT_NAMES)[number]
/** Seat number 0..3 (South, West, North, East). */
export type SeatIndex = 0 | 1 | 2 | 3
export const SEAT_COUNT = 4

/** Teams mode: South+North (team 0) vs West+East (team 1). */
export function teamOfSeat(seat: SeatIndex): 0 | 1 {
  return (seat % 2) as 0 | 1
}

export const GAME_MODES = ['ffa', 'teams'] as const
export type GameModeId = (typeof GAME_MODES)[number]

export const TIME_CONTROL_IDS = Object.keys(TIME_CONTROLS) as (keyof typeof TIME_CONTROLS)[]
export type TimeControl = keyof typeof TIME_CONTROLS

/**
 * Time control id of singleplayer games (`kind: 'solo'`): no clocks run, nobody can flag,
 * and the game is never rated. Not valid for lobbies.
 */
export const UNTIMED = 'untimed' as const
export type Untimed = typeof UNTIMED

/** Whether a room's (or a stored match's) time control is untimed. */
export function isUntimed(timeControl: string): timeControl is Untimed {
  return timeControl === UNTIMED
}

/**
 * Room kinds: `lobby` (multiplayer, listed unless private, seats filled by people and bots)
 * or `solo` (singleplayer: the creator at South against three bots, never listed, untimed).
 */
export const MATCH_KINDS = ['lobby', 'solo'] as const
export type MatchKind = (typeof MATCH_KINDS)[number]

/** Name the server gives a solo room when the creator sends none. */
export const SOLO_DEFAULT_NAME = 'Practice vs bots'

/** `draft` is designed but not built yet: the server rejects it with `not_implemented`. */
export const PICK_MODES = ['blind', 'draft'] as const
export type PickMode = (typeof PICK_MODES)[number]

/**
 * Lobby/game phases (PLAN §3). `draft_ban`/`draft_pick` are reserved for draft mode.
 * - waiting: fewer than 4 seats filled
 * - civ_select: 4 seats filled; players pick civs and get ready
 * - countdown: start pressed, game begins at `countdownEndsAt`
 * - in_game, finished
 */
export const MATCH_PHASES = [
  'waiting',
  'civ_select',
  'draft_ban',
  'draft_pick',
  'countdown',
  'in_game',
  'finished',
] as const
export type MatchPhase = (typeof MATCH_PHASES)[number]

/** Bot strength labels as strings on the wire ('600' ... '2400', 'max'). */
export const BOT_LEVEL_LABELS = BOT_LEVELS.map(String) as [string, ...string[]]
export type BotLevelLabel = `${(typeof BOT_LEVELS)[number]}`

export const CIV_SLUGS = CIVILIZATIONS.map((c) => c.slug) as [string, ...string[]]

/** Lobby name limits (the server also runs the name policy). */
export const LOBBY_NAME_MIN = 3
export const LOBBY_NAME_MAX = 40
export const LOBBY_PASSWORD_MAX = 64

/** Lobby names: letters (any script), digits, spaces and common punctuation. */
const LOBBY_NAME_CHARSET = /^[\p{L}\p{N} _.,!?'"&()+:#-]+$/u

/**
 * Normalizes a lobby name the way the server stores it: Unicode NFC, typographic quotes
 * (which phones and macOS insert automatically) turned into plain ones, and runs of
 * whitespace collapsed.
 */
export function normalizeLobbyName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201A\u201B\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The format rule for lobby names, shared by the web form (live feedback) and the server
 * (which also applies its moderation policy on top).
 */
export function checkLobbyNameFormat(
  raw: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = normalizeLobbyName(raw)
  if (name.length < LOBBY_NAME_MIN || name.length > LOBBY_NAME_MAX) {
    return { ok: false, reason: `Lobby names need ${LOBBY_NAME_MIN}–${LOBBY_NAME_MAX} characters.` }
  }
  if (!LOBBY_NAME_CHARSET.test(name)) {
    return {
      ok: false,
      reason: 'Use letters, numbers, spaces and simple punctuation (. , ! ? \' " & ( ) + : # -).',
    }
  }
  return { ok: true, name }
}

/**
 * Draw offers: after an offer of yours lapses or is declined, you must make this many more
 * moves before you may offer again.
 */
export const DRAW_OFFER_COOLDOWN_MOVES = 2

/**
 * Teams resignation votes: after a proposal of yours to resign the team lapses or your
 * teammate declines it, you must make this many more moves before you may propose again.
 */
export const TEAM_RESIGN_COOLDOWN_MOVES = 2

/**
 * Leaderboard (`GET /api/leaderboard`): players need at least this many ranked games in a
 * mode x time control to be listed there.
 */
export const LEADERBOARD_MIN_GAMES = 5
/** Leaderboard page size: default and maximum `limit`. */
export const LEADERBOARD_DEFAULT_LIMIT = 50
export const LEADERBOARD_MAX_LIMIT = 100

/** `drawVotes` entries in the room state: not a voter, waiting for an answer, accepted. */
export const DRAW_VOTE = { notVoter: -1, pending: 0, accepted: 1 } as const

/** Pre-game countdown after the host starts. */
export const DEFAULT_COUNTDOWN_MS = 3_000
/** Reconnect grace (PLAN §2). */
export const DEFAULT_RECONNECT_GRACE_MS = 60_000

/**
 * Error codes sent in `error` messages and as the matchmaking HTTP error (`{ error: code }`,
 * which the Colyseus SDK surfaces as the `MatchMakeError` message).
 */
export const ERROR_CODES = [
  // join / create (matchmaking)
  'unauthorized',
  'age_confirmation_required',
  'legal_acceptance_required',
  'username_required',
  'protocol_mismatch',
  'invalid_options',
  'invalid_password',
  'too_many_attempts',
  'room_not_found',
  'room_not_joinable',
  'room_full',
  'already_seated',
  'already_in_room',
  'kicked',
  'maintenance',
  // ranked lobbies: registered accounts only, no bots
  'account_required',
  'ranked_no_bots',
  // challenge lobbies (invite-only): someone not invited tried to join
  'not_invited',
  // lobby / game messages
  'invalid_message',
  'unknown_message',
  'not_host',
  'wrong_phase',
  'invalid_seat',
  'seat_occupied',
  'seat_empty',
  'not_a_bot',
  'civ_required',
  'civ_unavailable',
  'not_ready',
  'not_your_turn',
  'not_seated',
  'illegal_move',
  // resign / draw offers
  'not_playing',
  'draw_offer_pending',
  'draw_offer_cooldown',
  'no_draw_offer',
  'already_responded',
  // Teams resignation votes
  'resign_proposal_pending',
  'resign_proposal_cooldown',
  'no_resign_proposal',
  // spectators (watch rooms) and rematches
  'spectating',
  'spectators_full',
  'rematch_pending',
  'no_rematch',
  'not_implemented',
  'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/** WebSocket close codes the server uses when it removes a client. */
export const CLOSE_CODES = {
  kicked: 4100,
  seatLost: 4101,
  roomClosed: 4102,
  /** `social` room: the session it was opened with ended (signed out, revoked, expired) or
   * the account was deleted. Don't rejoin until signed in again. */
  sessionEnded: 4103,
} as const
