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
`Authorization: Bearer <token>` on the matchmaking request (native clients;
`client.auth.token = <token>` does this, but also copies the token into the WebSocket URL, so
the web app's mobile build sets the header on `client.http.options.headers` instead). Players must have confirmed their age,
accepted the current Terms/Privacy versions and (registered accounts) chosen a username.

| Room | Call | Options |
|---|---|---|
| `lobby` | `joinOrCreate('lobby')` | none. Colyseus LobbyRoom: `rooms` (full list), `+` `[roomId, listing]`, `-` roomId |
| `match` | `create('match', CreateOptions)` | lobby: `{ protocolVersion: 1, kind?: 'lobby', name, mode: 'ffa'\|'teams', timeControl: '10+0'\|'3+2', password?, pickMode?: 'blind', ranked?: boolean }` |
| `match` | `create('match', CreateOptions)` | solo: `{ protocolVersion: 1, kind: 'solo', name?, mode, timeControl: 'untimed', civ, botLevel }` |
| `match` | `joinById(roomId, JoinOptions)` | `{ protocolVersion: 1, password? }` |
| `social` | `joinOrCreate('social')` | none. Registered accounts only: friends' presence and notifications (see "Friends and challenges") |
| any | `reconnect(room.reconnectionToken)` | within the reconnect grace (`reconnectGraceMs`, 60 s by default) |

A `match` reconnect through matchmaking also needs the session of the account that holds the
seat (cookie or bearer, as for joining): the token alone is refused (`unauthorized`, or
`not_seated` for another account), so a token left behind in a shared browser can't take the
seat over. The SDK's automatic reconnection of a dropped socket goes straight to the WebSocket
and isn't affected.

Listing metadata (`listing.metadata`): `{ name, mode, timeControl, seatsFilled, locked, phase,
pickMode, ranked, civs, occupied }` (`locked` = password-protected; `civs` = the civ slug of each
seat in seat order South, West, North, East, `''` for an open seat or a civ not chosen yet;
`occupied` = whether each seat, in the same order, is taken by a human or a bot; both updated
whenever a seat or civ changes). Only lobbies are listed: a room leaves the list
(`-` roomId) when its game starts, and seated players rejoin it by id.

Ranked lobbies (`ranked: true`, default false): Elo-rated (see REST below). Guests can't
create or join one (`account_required`), bots can't be added (`addBot` answers
`ranked_no_bots`), and solo games can't be ranked (`invalid_options`). Casual lobbies are
never rated, whoever plays. `state.ranked` and `metadata.ranked` say which a room is.

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

WebSocket upgrades carrying an `Origin` other than the web origin (or one of the mobile app
origins in the server's `NATIVE_ORIGINS`, e.g. `capacitor://localhost`, `https://localhost`)
are refused (403); native desktop clients send no `Origin`. `NATIVE_ORIGINS` is empty by
default.

Refused matchmaking answers HTTP 4xx/5xx with `{ error: <code> }`; the SDK's `MatchMakeError`
message is the code: `unauthorized`, `age_confirmation_required`, `legal_acceptance_required`,
`username_required`, `protocol_mismatch`, `invalid_options`, `invalid_password`,
`too_many_attempts` (5 wrong passwords per minute per IP and per room), `room_not_found`,
`room_not_joinable`, `room_full`, `already_seated`, `already_in_room` (one seat per user),
`kicked`, `maintenance`, `account_required` (a guest creating or joining a ranked lobby, or
joining `social`), `not_invited` (joining a challenge lobby you weren't invited to),
`not_implemented` (`pickMode: 'draft'`).

## Client -> server messages (`room.send(type, payload)`)

| Type | Payload | Who / when |
|---|---|---|
| `setCiv` | `{ civ }` (civ slug, duplicates allowed) | seated human, lobby |
| `setReady` | `{ ready }` (needs a civ) | seated human, lobby |
| `addBot` | `{ seat: 0-3, level: '600'…'2400'\|'max' }` (random enabled civ; `ranked_no_bots` in ranked lobbies) | host, lobby |
| `removeBot` | `{ seat }` | host, lobby |
| `setBotCiv` | `{ seat, civ }` | host, lobby |
| `kick` | `{ seat }` (kicked users can't rejoin this lobby) | host, lobby |
| `swapSeats` | `{ a, b }` (teams: S+N vs W+E) | host, lobby |
| `startGame` | `{}` (4 seats, all civs, all humans ready and connected) | host, `civ_select` |
| `move` | `{ move }` (rules-core notation, e.g. `e2e4`, `e8e9q`) | seat to move, `in_game` |
| `resign` | `{}` (FFA: resigns at once; Teams: proposes resigning the team to the teammate, or agrees to the teammate's pending proposal) | any seat still taking turns, any time in `in_game` (not only on its turn) |
| `offerDraw` | `{}` | a draw voter (seat still taking turns), no offer pending, no cooldown, `in_game` |
| `respondDraw` | `{ accept: boolean }` | a voter still pending on the current offer, `in_game` |
| `respondResign` | `{ accept: boolean }` | Teams: the teammate of a seat whose resignation proposal is pending, `in_game` |
| `syncClock` | `{}` | anyone |

Reserved (answered with `error { code: 'not_implemented', requestType }`): `takeback*`,
`chat.*`.

Refusals of the game messages: `wrong_phase` (not in game), `not_seated`, `not_playing` (the
seat no longer takes turns: removed or frozen; also a non-voter answering an offer),
`draw_offer_pending` (an offer already waits), `draw_offer_cooldown` (`message`: how many
more moves), `no_draw_offer`, `already_responded` (the offerer, or a voter who accepted;
also a proposer answering its own resignation proposal), `resign_proposal_pending` (your
Teams resignation proposal already waits), `resign_proposal_cooldown` (`message`: how many
more moves), `no_resign_proposal` (no proposal from your teammate to answer, or FFA).

## Server -> client messages

| Type | Payload |
|---|---|
| `welcome` | `{ protocolVersion, roomId, sessionId, seat (-1 = none), isHost }` on join and reconnect |
| `events` | `{ seq, action: 'move'\|'timeout'\|'abandon'\|'resign'\|'agreed_draw', seat, notation, events: GameEvent[], positionString, seatToMove, clock }` after every game action (`GAME_ACTIONS`; for `agreed_draw`, `seat` is the voter whose acceptance completed it and `events` is the `game_ended` event) |
| `drawEvent` | `{ type: 'offered'\|'accepted'\|'declined'\|'lapsed', seat, offerSeat, reason?: 'round'\|'voters_changed' }` on every change to the draw offer (`seat`: who acted; for `lapsed`, the offerer) |
| `resignEvent` | Teams: `{ type: 'proposed'\|'accepted'\|'declined'\|'lapsed'\|'immediate', seat, team: 0\|1, reason?: 'round'\|'voters_changed', outSeat? }` on every change to a resignation proposal (`seat`: who acted; for `lapsed` and `immediate`, the proposer; `outSeat`: for a `voters_changed` lapse, the teammate who stopped taking turns). `accepted` and `immediate` are followed by the `events` message with action `resign` |
| `clock` | `{ remainingMs: [S,W,N,E], runningSeat, serverTimestamp, turnStartedAt }` on game start, every 5 s, on `syncClock` |
| `gameOver` | `{ matchId, result, placements, endReason, rated, ratings: ({ before, after } \| null)[] }` once saved (`ratings` are Elo before/after per seat; `rated` is true only for a ranked game whose Elo was applied, false if it couldn't be, e.g. a participant deleted their account; `state.rated` follows) |
| `error` | `{ code, message?, requestType? }` |
| `kicked` | `{ reason }`, then the connection closes with code 4100 |

`GameEvent` is the `@game/rules` event union (`move_made`, `capture`, `en_passant`,
`promotion`, `castle`, `pass`, `defeat`, `army_removed`, `frozen`, `game_ended`). Clients
rebuild the position with `Game.fromPosition(positionString)` for snapshots and legal moves.
Render clocks with `remainingNow(sync, Date.now(), offset)` from `@game/protocol/client`.

## Room state (`MatchState`)

`protocolVersion, name, mode, timeControl, pickMode, hasPassword, hostSeat, phase,
countdownEndsAt, seats[4], matchId, rated, positionString, seatToMove, actionSeq, clock,
lastEvents[], result, reconnectGraceMs, drawOfferSeat, drawVotes[4], drawOfferActionSeq,
drawCooldowns[4], ranked, teamResignSeat[2], teamResignCooldowns[4], inviteOnly` (the four
draw fields, `ranked`, the two resignation-vote fields and `inviteOnly` were appended in
protocol v1; older decoders ignore them). `inviteOnly`: a challenge lobby (see below).

- `seats[i]` (0 = South, 1 = West, 2 = North, 3 = East): `occupied, sessionId, displayName,
  isGuest, isBot, botLevel, civ, ready, connected, graceDeadline, team, status`. User ids are
  never synced; a client finds its seat by `sessionId` (or the `welcome` message).
- `phase`: `waiting` → `civ_select` (4 seats filled) → [`draft_ban` → `draft_pick`: reserved]
  → `countdown` (3 s) → `in_game` → `finished`.
- `clock`: `remainingMs[4], runningSeat, serverTimestamp, turnStartedAt, incrementMs`.
- `lastEvents`: the latest action's events, flattened (`type, seat, notation, from, to,
  square, piece, pieceOwner, promotion, flag, reason`).
- `drawOfferSeat`: seat of the pending draw offer, or -1. `drawVotes[i]` (`DRAW_VOTE`): -1 not
  a voter, 0 pending, 1 accepted (all -1 without an offer). `drawOfferActionSeq`: `actionSeq`
  when the offer was made (0 without one). `drawCooldowns[i]`: moves seat i must still make
  before it may offer again (`DRAW_OFFER_COOLDOWN_MOVES` = 2 after its offer lapses or is
  declined).
- `teamResignSeat[t]` (Teams; t = 0 South+North, 1 West+East): the seat whose proposal to
  resign the team waits for its teammate's answer, or -1 (always -1 in FFA).
  `teamResignCooldowns[i]`: moves seat i must still make before it may propose again
  (`TEAM_RESIGN_COOLDOWN_MOVES` = 2 after its proposal lapses or is declined).
- `result`: `type` (`ffa_winner`, `ffa_move_limit_tie`, `ffa_agreed_draw`, `teams_winner`,
  `teams_draw`, `teams_agreed_draw`, `aborted`), `winnerSeat, winnerTeam, endReason,
  placements[4]`.
- `endReason`: `last_standing`, `team_eliminated`, `team_resigned` (Teams: a team resigned),
  `move_limit`, `agreed_draw` for a finished game; for an
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
- Resign (FFA): any seat still taking turns may resign at any time in game
  (`Game.applyResign`): its army is removed. A resign by the seat to move ends its turn with
  no increment; an off-turn resign leaves the running clock alone. The resigned player keeps
  their seat in the room as a spectator (no more turns, resigns or offers) and may leave
  without further effect. Persisted as a `resign` match event (an action replayed by the
  re-simulation).
- Resign (Teams) is a vote with the teammate. `resign` from a seat still taking turns
  (DEFEATED-but-playing seats included) proposes it: `teamResignSeat[team]` is set and the
  teammate answers with `respondResign` (a bot teammate answers after `BOT_MIN_MOVE_MS`,
  agreeing only when its team is clearly losing by the draw heuristic below). Agreed: the
  server applies `Game.applyResign(proposer)`, which resigns the whole team; the game ends at
  once with the other team winning (placements 1/2, end reason `team_resigned`; in ranked
  games a loss for both). Declined: nothing happens and both play on. A teammate who no
  longer takes turns (frozen) can't be asked, so the team resigns at once (`immediate`). An
  unanswered proposal lapses after one full round (as draw offers) or when the proposer or
  the teammate stops taking turns. After a decline or lapse the proposer must make 2 more
  moves before proposing again (an immediate resignation with a frozen teammate never waits). One proposal per team at a time; a draw offer and a
  resignation proposal can be pending together. A flag that already fell is settled first.
  Persisted as `resign_proposal` and `resign_response` match events, and the final `resign`
  action (seat: the proposer, payload `team: true` plus `acceptedBy` or `immediate`), which
  the re-simulation replays. Leaving the game (or a disconnect past the grace) still freezes
  only the leaver's seat.
- Draw offers: only a draw voter (`Game.drawVoters()`: seats still taking turns) may offer,
  one offer at a time. The offerer's vote counts as accepted; every other voter is pending.
  When every voter has accepted, the server applies `Game.applyAgreedDraw()` and the game
  ends (`ffa_agreed_draw` / `teams_agreed_draw`, end reason `agreed_draw`). The offer ends
  without a draw when anyone declines (`drawEvent` `declined`), when the voters change (a
  defeat out of the game, a removal or a freeze: `lapsed`/`voters_changed`) or after one full
  round (every other voter took a turn since the offer and the turn is back with the offerer,
  or the offerer's turn came round as an automatic pass: `lapsed`/`round`). After a lapse or
  decline the offerer must make 2 more moves before offering again; other seats aren't affected. Persisted as `draw_offer` and `draw_response`
  match events; an agreed draw's `game_end` event carries `agreedDraw: true` and is the action
  the re-simulation replays.
- Bots as voters answer after a paced delay (`BOT_MIN_MOVE_MS`, then half that more for each
  further bot): they accept only when clearly losing, i.e. when the material in play (P1 N3 B3
  R5 Q9, England's Prime Ministers M4, a king excluded, frozen pieces not counted) of their own army (Teams: their team) is
  at most 80% of the strongest other remaining player's (Teams: the enemy team's); otherwise
  they decline.
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
  solo games have `timeControl: 'untimed'`, `rated: false`; `ranked` says the game was played in a
  ranked lobby, `rated` that its Elo was applied, so an aborted ranked game is `ranked`, not `rated`)
- `GET /api/matches/:id`: players and the full event log, participants only (`MatchDetailResponse`)
- `GET /api/ratings/me`: your Elo ratings, `{ mode, timeControl, rating, gamesPlayed, peak }`
  per mode × time control you have played ranked (`RatingsResponse`)
- `GET /api/leaderboard?mode=ffa|teams&tc=10%2B0|3%2B2&limit=1..100` (public, no session;
  defaults FFA, 10+0, 50): top registered players with at least `LEADERBOARD_MIN_GAMES` (5)
  ranked games in that rating, by Elo; `{ mode, timeControl, minGames, entries: [{ rank,
  username, rating, gamesPlayed, peak }] }` (`LeaderboardResponse`; equal ratings share a
  rank). Usernames only; deleted accounts and guests never appear. Encode `+` in `tc` (`%2B`);
  a bare `+` (decoded as a space) is accepted too.

Ratings: only ranked lobbies are rated, with 4-player Elo per mode × time control (start
1200; K 40 for the first 30 games, then 20, 10 once the peak reached 2400). FFA: every pair of
players is a mini-game (1 / 0.5 / 0 by placement), Δ = round(K / 3 × Σ(S − E)). Teams: team
rating = mean of the two players, standard Elo team vs team, Δ = round(K × (S − E)) per
player. Agreed draws and move-limit ties are ties; aborted games are unrated. Casual games
with bots update a hidden OpenSkill shadow rating against fixed bot anchors
(`bot_level_anchors`), never exposed; guests are never rated.

## Friends and challenges

Registered accounts only (guests get `403 { error: 'ACCOUNT_REQUIRED' }` from every endpoint
below and `account_required` from the `social` room). Every action is a REST call, so a client
can also just poll; the `social` room adds live presence and notifications. All endpoints take
the session cookie (web) or `Authorization: Bearer <token>` (native apps); limits are in
`social.ts` (`FRIENDS_MAX` 50, `FRIEND_REQUESTS_OUTGOING_MAX` 10, `FRIEND_REQUESTS_PER_HOUR` 20,
`CHALLENGE_MAX_INVITEES` 3, `CHALLENGE_TTL_MS` 5 min).

**Who can be added:** only someone you are playing with right now (a running game) or finished a
game with: both seated in the same match. A lobby that never started doesn't count, nor do
aborted games, bots, guests or deleted accounts. Requests name the other player by match and
seat, so user ids are never needed to add someone (and can't be guessed to spam strangers).

### REST

| Call | Body / answer |
|---|---|
| `GET /api/friends` | `FriendsResponse`: `{ friends: [{ userId, username, online, since }], incoming: [{ user, createdAt }], outgoing: [...], blocked: [{ userId, username, since }], limits: { maxFriends, maxOutgoing, maxBlocked } }` |
| `GET /api/friends/match/:matchId` | participants only: `MatchRelationsResponse` `{ matchId, capReached, outgoingFull, seats: [{ seat, relation, blocked }] }`, relation `self` \| `ineligible` \| `none` \| `outgoing` \| `incoming` \| `friends`; `blocked`: you blocked that player |
| `POST /api/friends/requests` | `{ matchId, seat }` → `{ relation: 'outgoing' \| 'friends', user }` (`friends`: they had asked you, so it is accepted at once) |
| `POST /api/friends/requests/:userId/accept` | → `{ relation: 'friends', user }` |
| `POST /api/friends/requests/:userId/decline` | → 204 |
| `DELETE /api/friends/requests/:userId` | cancel your own request → 204 |
| `DELETE /api/friends/:userId` | remove a friend → 204 |
| `GET /api/challenges` | `{ incoming: Challenge[], outgoing: Challenge[] }` (incoming: still waiting for your answer) |
| `POST /api/challenges` | `{ friendIds: 1-3 ids, mode: 'ffa' \| 'teams', timeControl: '10+0' \| '3+2' }` → 201 `{ challenge }`; then `joinById(challenge.roomId, { protocolVersion })` within the 10 s seat reservation |
| `POST /api/challenges/:id/decline` | → 204 |
| `DELETE /api/challenges/:id` | the challenger withdraws it → 204 (the lobby stays open) |

`GET /api/matches` opponents carry `friend`: the same relation for registered opponents of
finished games, `null` otherwise (also while you block them); `blocked` (you blocked them, or
`null` when blocking doesn't apply: bots, guests, deleted accounts, or you are a guest); and
`reportable` (a person, not a bot or a deleted account). Refusals are `{ error, message }` with the codes in
`SOCIAL_ERROR_CODES` (`NOT_ELIGIBLE`, `FRIEND_CAP` / `TARGET_FRIEND_CAP` (both sides are checked
when a request is accepted), `OUTGOING_CAP`, `ALREADY_FRIENDS`, `ALREADY_REQUESTED`,
`NOT_FRIENDS`, `ALREADY_IN_ROOM`, `CHALLENGE_CLOSED`, `RATE_LIMITED` (429, per user), ...).

### `social` room

`joinOrCreate('social')` once per signed-in app; keep it open and rejoin with backoff when it
closes (disable the SDK's token reconnect: `room.reconnection.enabled = false`; a fresh join is
always fine). At most 8 connections per user (more: `too_many_attempts`). The room has no state and takes no messages.
The connection belongs to the session it was opened with: when that session ends (sign-out,
revoked sessions, password reset, expiry; checked at once on deletion and every minute as a
safety net) or the account is deleted, the server closes it with code 4103
(`CLOSE_CODES.sessionEnded`), and a rejoin with the old cookie or token gets `unauthorized`.
Server → client messages (`socialMessageSchemas`):

| Type | Payload |
|---|---|
| `presence` | `{ userId, online }`: a friend came online or went offline (offline after a 5 s grace, so reloads don't flicker) |
| `friendRequest` | `{ user, createdAt }`: someone asked you |
| `friendAccepted` | `{ user, online }`: you are now friends |
| `friendsChanged` | `{}`: refetch `GET /api/friends` (a removal, a cancelled or declined request, or another device of yours acted) |
| `challenge` | `Challenge`: a friend challenged you (join the lobby, or decline over REST). Co-invitees who aren't your friends come without `userId` (name and status only) |
| `challengeUpdate` | to the challenger: `{ challengeId, user, status: 'declined' \| 'joined' \| 'expired' }` |
| `challengeClosed` | `{ challengeId, reason }`: `expired`, `started` (its game began), `closed` (the lobby closed), `cancelled` (withdrawn, or replaced by a newer challenge), or `answered` (only to an invitee whose other tab or device joined or declined: drop the prompt) |

### Usernames

Better Auth's sign-up (`/api/auth/sign-up/email`) and choosing a username (`/api/auth/update-user`
with `username`, for accounts without one) answer `400 { code: 'USERNAME_UNAVAILABLE', message:
"That username isn’t available. Try another." }` for profane or reserved names (staff words,
`Guest…`, `Player…`, bot names, the app's name). The message never says which rule matched.
Format problems keep Better Auth's own codes (`USERNAME_TOO_SHORT`, `INVALID_USERNAME`, ...).
Usernames can't be changed during the beta. A suspended account's sign-in answers
`403 { code: 'ACCOUNT_SUSPENDED' }`.

### Blocking and reporting

Types and limits in `moderation.ts` (`BLOCKS_MAX` 500, `REPORTS_PER_DAY` 10, `REPORT_NOTE_MAX`
500). A target (`PlayerTarget`) is either `{ matchId, seat }` (a game you played in: live card,
result screen, history row) or `{ userId }` (someone on your Friends page: a friend, a request
either way, or a player you blocked). Any other user id gets `404 NOT_FOUND`.

| Call | Body / answer |
|---|---|
| `POST /api/blocks` | registered accounts only (`ACCOUNT_REQUIRED` for guests): `PlayerTarget` → `{ user }`. Removes any friendship or request between you, ends open challenges between you, and pushes `friendsChanged` to both. Blocking twice is fine. Guests and bots can't be blocked (`NOT_ELIGIBLE`); `BLOCK_CAP` (409) past `BLOCKS_MAX`; 60 per hour per user |
| `DELETE /api/blocks/:userId` | unblock → 204 (404 when not blocked) |
| `DELETE /api/blocks/match/:matchId/:seat` | unblock the player in that seat of a game you played in → 204 |
| `POST /api/reports` | any signed-in player, guests included: `PlayerTarget & { reason, note? }`, reason `offensive_username` \| `harassment` \| `cheating` \| `other` → 201 `{ ok: true }`. `ALREADY_REPORTED` (409): you have an open report about that player for that game (or without a game); `RATE_LIMITED` (429): `REPORTS_PER_DAY` reached |

While A blocks B, B's friend requests to A get exactly the `NOT_ELIGIBLE` answer any ineligible
player gets, and a challenge naming A gets `NOT_FRIENDS` (as for any non-friend), so a block is
never revealed; A's requests to B get `BLOCKED` (409, "unblock them first"). Presence goes to
friends only, so neither sees the other online. A block never removes anyone from a running
game. The reported player is never told about a report or who filed it.

### Admin review queue

Only user ids in the server's `ADMIN_USER_IDS` (comma list, empty by default); everyone else gets
`403 { error: 'FORBIDDEN' }` from every call (401 without a session). The web page is
`/admin/reports`.

| Call | Body / answer |
|---|---|
| `GET /api/admin/me` | `{ admin: true }` (or 403) |
| `GET /api/admin/reports` | `AdminReportsResponse`: `{ reports: AdminReport[] (open, oldest first: reason, note, matchId, createdAt, reported { userId, name, reportedName, isGuest, deleted, suspendedAt, openReports, totalReports, openReporters }, reporter { userId, name }), suspended: [{ userId, name, suspendedAt }] }` |
| `POST /api/admin/reports/:id/dismiss` | → 204 (404 when no longer open) |
| `POST /api/admin/reports/:id/resolve` | `{ action: 'warn' \| 'rename' \| 'suspend' }` → 204. `warn` is recorded only; `rename` clears the username (the account shows "Player-1234" and must choose a new username, so matchmaking answers `username_required` until it does); `suspend` refuses every sign-in (`403 ACCOUNT_SUSPENDED` from Better Auth), deletes all sessions (bearer tokens included), closes `social` connections and frees any pre-game lobby seat (`kicked` with reason `suspended`); a running game goes on. Admins can't be suspended (400) |
| `POST /api/admin/users/:userId/unsuspend` | → 204 (404 when not suspended) |

### Challenge lobbies

`POST /api/challenges` creates a casual `match` room hosted by the challenger: never listed, no
password, `state.inviteOnly = true`. Only the challenger and the invited friends can take a
seat; anyone else gets `not_invited`. The host fills empty seats with bots as usual. The
invitation ends after 5 minutes, when the game starts or when the lobby closes; after it
expires (or is withdrawn) only players already seated can come back. A challenge also ends for
an invitee when the friendship does (either side removes the other) or an account is deleted:
the invitee gets `challengeClosed` (`cancelled`), the challenger `challengeUpdate` (`expired`),
and the invitee can no longer join unless already seated. Ranked challenges are not
available yet.
