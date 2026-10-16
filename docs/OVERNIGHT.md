# Overnight session log (2026-10-16, until 8:00 AM EDT)

What was completed while you slept, in order. Each item lists what changed, how it was
verified, and any decision taken on your behalf. Rule questions are listed in
[TODO.md](../TODO.md) under "Open rules questions" for you to confirm or change.

## Decisions taken on your behalf

- **Singleplayer setup:** you pick your civ, the bots' strength (one ELO level for all three,
  default 1200) and Free-for-All or Teams (default FFA). The three bots get random civs that
  differ from each other and from yours. No clocks; singleplayer games are never rated.
- **Bot pacing:** each bot move lands at least ~0.7 s after the previous move, so every
  animation plays out. This applies to multiplayer too. In timed games the pause counts on the
  bot's own clock (skipped when the bot is low on time, so it can never lose on time because of
  it). Configurable via `BOT_MIN_MOVE_MS`.
- **Resignation in Free-for-All:** your army is removed, exactly like running out of time.
- **Resignation in Teams:** only you resign. Your pieces freeze in place (like a Teams timeout)
  and your partner plays on. (This answers the open question "Teams resignation: player-only or
  whole team?" with "player-only"; change it if you prefer.)
- **When you can resign:** any time, not only on your turn.
- **Draw by agreement:** every player still in the game must accept (removed or frozen armies
  don't vote). In Free-for-All the survivors share first place and defeated players keep their
  placements (same as the move-limit rule); in Teams it is a draw.
- **Draw offers:** one open offer at a time; it lapses after one full round (when the offerer's
  turn comes again) or as soon as anyone declines; after a declined offer the same player must
  make two more moves before offering again.
- **Bots and draw offers:** a bot accepts only when it is clearly losing (its material at most
  80% of the strongest opponent's; in Teams, its team against the enemy team). So you can get
  a draw against bots, but only from a winning position.
- **Ranked mode:** lobbies are created Ranked or Casual. Ranked needs four signed-in players
  (no guests, no bots). Casual games are no longer rated. Ratings use traditional Elo starting
  at 1200, with FIDE's K-factor (40 for the first 30 games, 20 after, 10 at 2400+).
  Free-for-All is scored as six head-to-head comparisons by finishing order (each player's change
  divided by 3); Teams uses each team's average rating. Separate ratings per mode and time
  control. The hidden rating used to calibrate bot strength is kept.
- **Leaderboard:** a public top-players page per mode and time control.

## Completed

### 1. Resignation and agreed draws in the rules engine (commits 91e7982, c64ed12, d34fc0b)

- The Rust rules engine (the single source of game rules) can now apply a resignation for any
  player still in the game, on or off their turn, and end a game by agreed draw.
  `draw_voters` reports which players must agree.
- Exposed to the browser and the server through WebAssembly (`Game.applyResign`,
  `Game.applyAgreedDraw`, `Game.drawVoters`).
- `docs/RULES.md` has new "Resigning" and "Draw by agreement" sections for players.
- Verified: 409 Rust tests (17 new rule tests, 30 independent spec-derived "attack" tests, and
  the self-play fuzz test now injecting hundreds of random resignations and draws), 30
  TypeScript tests.
- The buttons and draw-offer flow in the game are a separate step (server + UI), below.

### 2. Singleplayer "Play vs bots" and smooth, paced bot moves (commits 44ca721 … b57edfc)

- **Play vs bots** panel at the top of the Play page and a button on the home screen: choose
  your civ, the bots' strength and FFA or Teams. Three bots with random, distinct civs take
  West, North and East. A short line-up screen, then the game. No clocks anywhere ("Untimed"),
  never rated, never listed or joinable by others; history shows "Untimed · vs bots".
- **Bot moves no longer land instantly:** each bot move is applied at least 0.7 s after the
  previous move (about 1.5 s after a player is eliminated, so the dissolve animation finishes).
  This applies to multiplayer too. Bots keep this pacing while you watch after being
  eliminated; they only finish instantly when nobody is watching.
- Leaving a game now really leaves it (it used to put you back in your seat).
- Verified: 197 server tests (13 new), 15 protocol tests, 37 browser tests including a new
  singleplayer suite that checks bot moves arrive at least 0.5 s apart.
- Reviewed by three independent attackers (server, visual, spec); 13 findings, 11 fixed,
  1 partly fixed (an idle singleplayer tab keeps its game open: no hidden timeout, because you
  asked for no timers), 1 rejected as stale.

## Not done / left for you

_(Filled in at the end.)_
