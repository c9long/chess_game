import { ServerError } from '@colyseus/core'
import type { ErrorCode } from '@game/protocol'

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  unauthorized: 401,
  age_confirmation_required: 403,
  legal_acceptance_required: 403,
  username_required: 403,
  invalid_password: 403,
  kicked: 403,
  account_required: 403,
  not_invited: 403,
  too_many_attempts: 429,
  protocol_mismatch: 400,
  invalid_options: 400,
  room_not_found: 404,
  room_not_joinable: 409,
  room_full: 409,
  already_seated: 409,
  already_in_room: 409,
  maintenance: 503,
  not_implemented: 501,
}

/**
 * A refused join/create. Thrown from `onAuth`/`onJoin`; the matchmaking route answers with
 * the HTTP status and `{ error: code }` (the SDK's MatchMakeError message is the code).
 */
export function joinError(code: ErrorCode): ServerError {
  return new ServerError(HTTP_STATUS[code] ?? 400, code)
}

/** A refused lobby/game message; the room answers with an `error` message. */
export class GameError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
  }
}
