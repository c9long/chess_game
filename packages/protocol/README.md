# @game/protocol

The versioned wire contract between the server (`apps/server`), the web client and, later,
the Unity client. `PROTOCOL_VERSION = 1`.

- `@game/protocol`: constants, join options, message schemas (zod), REST response types
- `@game/protocol/state`: the Colyseus schema of the `match` room state
- `@game/protocol/client`: typed `send`/`on` wrapper for an SDK room, clock helpers
- `schema/protocol.schema.json`: JSON Schema (2020-12) of every payload, for C# codegen.
  Regenerate with `pnpm --filter @game/protocol schema` (a test fails when it is stale).
  The room state is a Colyseus schema: generate C# with
  `schema-codegen packages/protocol/src/state.ts --csharp --output <dir>`.

## Connecting

Colyseus runs on the API's own server under `COLYSEUS_PATH = /api/colyseus`
(SDK endpoint: `https://api.<domain>/api/colyseus`; in development the web app's Vite proxy
forwards `/api`, WebSockets included). Matchmaking is `POST /api/colyseus/matchmake/...`.

Authentication is the Better Auth session: the cookie (web; the SDK sends credentials) or
`client.auth.token = <bearer token>` (native clients). Players must have confirmed their age,
accepted the current Terms/Privacy versions and (registered accounts) chosen a username.

| Room | Call | Options |
|---|---|---|
| `lobby` | `joinOrCreate('lobby')` | none. Colyseus LobbyRoom: `rooms` (full list), `+` `[roomId, listing]`, `-` roomId |
| `match` | `create('match', CreateOptions)` | lobby: `{ protocolVersion: 1, kind?: 'lobby', name, mode: 'ffa'\|'teams', timeControl: '10+0'\|'3+2', password?, pickMode?: 'blind' }` |
| `match` | `create('match', CreateOptions)` | solo: `{ protocolVersion: 1, kind: 'solo', name?, mode, timeControl: 'untimed', civ, botLevel }` |
| `match` | `joinById(roomId, JoinOptions)` | `{ protocolVersion: 1, password? }` |
| any | `reconnect(room.reconnectionToken)` | within the reconnect grace (60 s) |

Listing metadata (`listing.metadata`): `{ name, mode, timeControl, seatsFilled, locked, phase,
pickMode }` (`locked` = password-protected). Only lobbies are listed: a room leaves the list
(`-` roomId) when its game starts, and seated players rejoin it by id.

Solo games (`kind: 'solo'`, singleplayer): the creator plays South with `civ`; three bots at
`botLevel` sit at West, North and East with random civs (distinct from each other and from the
player's, from the enabled civs). The room is never listed, refuses everyone but its creator
(`room_not_joinable`; the creator reconnects and rejoins as usual), refuses lobby edits
(`setCiv`, `setReady`, bot, kick and swap messages: `wrong_phase`) and starts by itself (the usual countdown). `timeControl` is `UNTIMED`
(`'untimed'`), which lobbies can't use: no clock ever runs (`clock.runningSeat` stays -1, no
timeouts), and the game is unrated with no public or shadow rating. `name` defaults to
`SOLO_DEFAULT_NAME` ("Practice vs bots"). In v1 only solo rooms are untimed, so clients can
treat `state.timeControl === 'untimed'` as "solo".

Seat reservations: a matchmaking answer reserves a seat for 10 s; connect at once (the SDK
does). A user has one outstanding reservation at a time: a newer one for another room replaces
it, and connecting with the replaced one is refused (`already_in_room`; an expired one gives
`room_not_joinable`). Several reservations for the same room count as one pending seat.
Pending reservations count toward a lobby's free seats. The creator stays host (and gets seat
0) while their own reservation is pending, even if someone else connects first.

WebSocket upgrades carrying an `Origin` other than the web origin are refused (403); native
clients send no `Origin`.

Refused matchmaking answers HTTP 4xx/5xx with `{ error: <code> }`; the SDK's `MatchMakeError`
message is the code: `unauthorized`, `age_confirmation_required`, `legal_acceptance_required`,
`username_required`, `protocol_mismatch`, `invalid_options`, `invalid_password`,
`too_many_attempts` (5 wrong passwords per minute per IP and per room), `room_not_found`,
`room_not_joinable`, `room_full`, `already_seated`, `already_in_room` (one seat per user),
`kicked`, `maintenance`, `not_implemented` (`pickMode: 'draft'`).

## Client -> server messages (`room.send(type, payload)`)

| Type | Payload | Who / when |
|---|---|---|
| `setCiv` | `{ civ }` (civ slug, duplicates allowed) | seated human, lobby |
| `setReady` | `{ ready }` (needs a civ) | seated human, lobby |
| `addBot` | `{ seat: 0-3, level: '600'…'2400'\|'max' }` (random enabled civ) | host, lobby |
| `removeBot` | `{ seat }` | host, lobby |
| `setBotCiv` | `{ seat, civ }` | host, lobby |
| `kick` | `{ seat }` (kicked users can't rejoin this lobby) | host, lobby |
| `swapSeats` | `{ a, b }` (teams: S+N vs W+E) | host, lobby |
| `startGame` | `{}` (4 seats, all civs, all humans ready and connected) | host, `civ_select` |
| `move` | `{ move }` (rules-core notation, e.g. `c2c4`, `c6c7q`) | seat to move, `in_game` |
| `syncClock` | `{}` | anyone |

Reserved (answered with `error { code: 'not_implemented', requestType }`): `resign`,
`offerDraw`, `respondDraw`, `takeback*`, `chat.*`.

## Server -> client messages

| Type | Payload |
|---|---|
| `welcome` | `{ protocolVersion, roomId, sessionId, seat (-1 = none), isHost }` on join and reconnect |
| `events` | `{ seq, action: 'move'\|'timeout'\|'abandon', seat, notation, events: GameEvent[], positionString, seatToMove, clock }` after every game action |
| `clock` | `{ remainingMs: [S,W,N,E], runningSeat, serverTimestamp, turnStartedAt }` on game start, every 5 s, on `syncClock` |
| `gameOver` | `{ matchId, result, placements, endReason, rated, ratings: ({ before, after } \| null)[] }` once saved (`rated` is false if no public rating could be applied, e.g. a participant deleted their account; `state.rated` follows) |
| `error` | `{ code, message?, requestType? }` |
| `kicked` | `{ reason }`, then the connection closes with code 4100 |

`GameEvent` is the `@game/rules` event union (`move_made`, `capture`, `en_passant`,
`promotion`, `castle`, `pass`, `defeat`, `army_removed`, `frozen`, `game_ended`). Clients
rebuild the position with `Game.fromPosition(positionString)` for snapshots and legal moves.
Render clocks with `remainingNow(sync, Date.now(), offset)` from `@game/protocol/client`.

## Room state (`MatchState`)

`protocolVersion, name, mode, timeControl, pickMode, hasPassword, hostSeat, phase,
countdownEndsAt, seats[4], matchId, rated, positionString, seatToMove, actionSeq, clock,
lastEvents[], result, reconnectGraceMs`

- `seats[i]` (0 = South, 1 = West, 2 = North, 3 = East): `occupied, sessionId, displayName,
  isGuest, isBot, botLevel, civ, ready, connected, graceDeadline, team, status`. User ids are
  never synced; a client finds its seat by `sessionId` (or the `welcome` message).
- `phase`: `waiting` → `civ_select` (4 seats filled) → [`draft_ban` → `draft_pick`: reserved]
  → `countdown` (3 s) → `in_game` → `finished`.
- `clock`: `remainingMs[4], runningSeat, serverTimestamp, turnStartedAt, incrementMs`.
- `lastEvents`: the latest action's events, flattened (`type, seat, notation, from, to,
  square, piece, pieceOwner, promotion, flag, reason`).
- `result`: `type` (`ffa_winner`, `ffa_move_limit_tie`, `teams_winner`, `teams_draw`,
  `aborted`), `winnerSeat, winnerTeam, endReason, placements[4]`.
- `endReason`: `last_standing`, `team_eliminated`, `move_limit` for a finished game; for an
  aborted (unrated) one `server_shutdown`, `server_restart`,
  `persist_failed` (the result couldn't be saved), `resimulation_mismatch`, `room_disposed`.

## Game rules on the server

- Clocks: only the seat to move runs; a real move pays the elapsed time, then gets the
  increment; automatic passes cost nothing; timeouts/abandons get no increment; frozen and
  removed seats never run again. A flag falls exactly on time (server timer).
- Disconnects: the seat shows `connected: false` and `graceDeadline`; after the grace an
  in-game seat is abandoned (= timeout, PLAN §2), a lobby seat is freed. A consented leave
  during a game abandons immediately.
- Bot pacing: a bot's move (bot-service or local fallback) is applied no earlier than
  `BOT_MIN_MOVE_MS` (server config, default 700) after the previous action, 2.2× that after an
  action that defeated, froze or removed an army, so clients play each animation; the think
  time overlaps the wait. In timed games the wait runs on the bot's clock, is skipped when the
  bot has under 10 s and never exceeds a quarter of its remaining time. Untimed games ask
  bot-service with a virtual 10-minute clock (no increment). While a seated human still takes
  turns or is connected (e.g. eliminated and watching), bots keep their level and pacing; once
  no human takes turns and none is connected, they finish with quick unpaced local moves.
- Untimed (solo) rooms: a server drain aborts a running untimed game at once instead of
  waiting for it.
- Bots move once bot-service answers (and the pacing allows); when it is saturated, slow or
  down, or misses a deadline taken from the bot's own clock, the room plays a quick local move
  (a leader capture, else a capture, else a random legal move), so a bot never flags waiting
  for it.
  Once no human takes turns any more, the bots finish the game with local moves only.
- Clock durations are measured on the server's monotonic clock; `serverTimestamp` and
  `turnStartedAt` are wall-clock ms for display.

## REST

- `GET /api/matches?limit=20&before=<cursor>`: your finished/aborted matches (`MatchListResponse`;
  solo games have `timeControl: 'untimed'`, `rated: false`)
- `GET /api/matches/:id`: players and the full event log, participants only (`MatchDetailResponse`)
- `GET /api/ratings/me`: your public ratings (`RatingsResponse`)

Ratings: OpenSkill Plackett–Luce over placements, per mode × time control. Display rating =
`round(900 + 30 × (mu − 3 sigma))` (900 for a new player; 400 points ≈ 10:1 odds between
established players). Rated games need four registered humans; casual games with bots update
a hidden shadow rating against fixed bot anchors (`bot_level_anchors`); guests are never rated.
