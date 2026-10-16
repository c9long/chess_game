# Overnight session log (2026-10-16, until 8:00 AM EDT)

What was completed while you slept, in order. Each item lists what changed, how it was
verified, and any decision taken on your behalf. Rule questions are listed in
[TODO.md](../TODO.md) under "Open rules questions" for you to confirm or change.

## Try it this morning

```sh
git pull
pnpm install
pnpm dev          # applies the new database migrations, then open http://localhost:5173
```

Things to try: the new landing page; **Play vs bots** (pick a civ, watch the bots' animated
moves, try **Resign** or **Offer draw**); create a **Ranked** lobby with a registered account;
the **Leaderboard**; the game and lobby on your phone (or a narrow browser window). A clean
`pnpm dev` start was checked at 7:37 (all three services up in 19 s, clean Ctrl-C shutdown).

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

### 3. Board animation polish (commit 3b6fe9b)

An art director recorded slow-motion frame captures of every kind of move, an implementer
reworked the animations, an independent reviewer checked visuals and frame rate (3 findings,
all fixed):

- **Moves** lift, arc and land with a small springy settle: sliders glide (230–360 ms by
  distance), knights hop.
- **Castling:** the king moves first, then the rook hops beside it so they never overlap.
- **Promotion:** the new piece pops in with a short flourish.
- **Captures:** the captured piece is knocked along the attacker's path, tilts and fades
  with chips in its seat colour, with a brief hit-stop.
- **Leader capture:** a stronger moment, then the army burns away outward from its leader
  (FFA) or frosts grey in a sweep (Teams).
- **Feedback:** the turn indicator hands over as a move lands, the last-move highlight follows
  the piece, movable pieces lift on hover, legal-move hints ripple in, illegal drops ease back.
- **Back-to-back moves** never teleport: a running animation finishes quickly, then the next
  plays.
- **Reduced motion** uses short cross-fades instead.
- Verified: 57 board unit tests, 45 board browser specs, frame strips reviewed by eye.

### 4. Resignation, draw offers, ranked Elo and a leaderboard (commits 3d714fa … 7c9d2c6)

- **Resign button** in every game (multiplayer and vs bots), with a confirm dialog that explains
  what happens in FFA (army removed) and Teams (pieces freeze, partner plays on), and mentions
  Elo in ranked games. You can keep watching after resigning.
- **Offer draw:** a card shows who offered and each remaining player's answer (Accepted /
  Waiting / Declined) with Accept and Decline buttons. Every player still in the game must
  accept; the offer lapses on a decline, when someone is knocked out, or after a full round;
  two-move cooldown after a failed offer. Bots answer automatically (accept only when clearly
  losing). Results show "Draw agreed" (or your own place if you were already out).
- **Ranked mode:** a Ranked toggle when creating a lobby (registered players only; guests get
  a "Create account" link; no bots). Traditional Elo from 1200 adapted for four players
  (pairwise by finishing order in FFA, team averages in Teams; FIDE K-factor). Casual games
  no longer change ratings. Ranked badge and a Ranked/Casual filter in the lobby browser,
  Elo changes on the result screen and in history, Elo cards (rating, games, best).
- **Leaderboard page** (header link): top players per mode and time control (5+ ranked games,
  usernames only).
- Legal drafts updated to describe ranked play, Elo and the public leaderboard.
- Verified: 258 server tests, 18 protocol tests, 47 browser tests. Three independent attackers
  (game integrity, Elo math, UX) found 21 issues, all fixed: e.g. a resignation or draw can no
  longer sneak in after the player to move ran out of time; two ranked games finishing at once
  no longer lose an Elo update.
- Note: Elo can drift by a point per game because each player's change is rounded separately.

### 5. UI round 1: landing page, sign-in and account pages, UI library choice (commits 7d744f4, dc0dbdc, 4bd1027)

- **Landing page:** a two-column hero (stacked on phones) with the title, clear buttons and four
  short value props, beside a **live 4-player board playing a calm game against itself** (using
  the real rules engine and the new animations). It loads after the page appears, is silent,
  pauses when off screen or in a hidden tab, and shows a still position with reduced motion.
  The nine civ emblems appear below as brass medallions.
- **Sign-in, sign-up and recovery pages** share one card style with the brand mark, show/hide
  password toggles and checks as you leave each field; sign-in offers passkeys first.
- **Account page:** clean cards with a side nav, status pills and an accessible passkey Rename
  dialog (replacing the browser prompt).
- **New fonts** (self-hosted Fraunces for headings, Inter for text), dark form controls,
  calmer disabled buttons.
- **UI libraries:** evaluated Radix, Base UI, React Aria, Ark and Headless UI (see
  `docs/ui-libraries.md`, with measured bundle sizes). Adopted **Radix primitives** styled with
  our own theme, plus **lucide-react** icons; Radix only loads with lazy pages so the first
  download stays small.
- Verified: web unit tests (18), the landing/auth/account browser specs, an independent
  art-direction, accessibility and performance review (all findings fixed).

### 6. UI round 2: game screen, results, lobby, lobby browser, leaderboard (commits 3880d2d, 298a954, ad64580)

- **Game screen:**
  - **Player cards:** seat-colour bars, tinted emblems, bot strength chips, a gold YOU chip,
    animated status pills (Resigned, Eliminated, Frozen), and **pieces lost** per player shown
    as small piece icons plus a −N figure.
  - **Turn banner:** names who is thinking ("England bot is thinking…") and pops in gold when
    it's your move; the browser tab title shows "● Your move" when the tab is in the background.
  - **Tablets and phones:** below 1024 px the screen becomes the board, the banner, a compact
    2×2 player strip and one row of buttons, fitting without scrolling. Board options sit
    behind a gear.
- **Result screen:** placements reveal from 4th to 1st with gold, silver and bronze medals,
  confetti for a win (none with reduced motion), and a counting Elo change in ranked games.
  It is keyboard-friendly: focus stays inside and Escape closes it.
- **Lobby:**
  - equal seat cards and distinct bot cards with a strength meter;
  - a host crown and a host menu;
  - pulsing open seats and a start checklist;
  - an invite field with copy feedback;
  - a line-up countdown with a sweeping ring;
  - on phones, your civ picker first and a fixed Ready/Start bar.
- **Lobby browser:** responsive cards with mode, time, Ranked and Private chips, animated
  updates and an illustrated empty state.
- **History** rows with medals and Elo pills; a **leaderboard podium** with your row
  highlighted; a **phone header menu**; quick page fades.
- **Speed:** only the running clock redraws each tick (the panel used to redraw 10 times a second).
- Verified: 49 browser tests including new phone/tablet layout checks, web typecheck, lint,
  unit tests; an independent art-direction, accessibility and performance review
  (12 findings, all fixed).

### 7. UI round 3: sign-out fix, accessible dialogs, keyboard civ picker, seated civs on lobby cards (commits 798241f … 9d18ce4)

- **Sign-out fix:** signing out from the account page sometimes landed on the sign-in page
  instead of home (and made one browser test flaky). Now it always lands on the landing page;
  proven with repeated sign-outs under a 6× CPU slowdown.
- **Proper dialogs instead of browser pop-ups:**
  - Leave game, Resign, Remove passkey and the private-lobby password prompt now use
    accessible dialogs: focus stays inside, Escape closes, and focus returns to the button
    you pressed.
  - The reasons on disabled Resign and Offer draw buttons are now tooltips you can reach with
    the keyboard.
- **Civ picker keyboard navigation:** the arrow keys move between civs, Home/End jump to the
  ends, and Space/Enter pick.
- **Lobby cards show the seated players' civ emblems,** updated live, beside seat dots that
  match the actual seats.
- Verified: an independent review (3 findings, all fixed), 53 browser tests, web/protocol/server
  tests.

### 8. Browser-tab icon and page titles (final small item)

- A proper tab icon in the game's mark (it had none), and readable tab titles per page
  ("Lobbies · …", "Match history · …", "Game · …").
- Verified: web build, lint, typecheck, and the landing, singleplayer and guest browser specs
  (including a new title/icon check).
- The README now opens with a short "What's in the game" feature list.

### 9. Accessibility audit (final item, 7:10–7:40)

- Ran **axe** (the standard automated accessibility checker, WCAG 2 A/AA) on 13 screens:
  landing (signed out/in), sign-in, sign-up, guest start, terms, lobby browser, lobby room,
  a game, history, leaderboard, account. Labels, names, headings, landmarks and ARIA were all
  clean; the only problems were **text contrast** (30 elements): faded gold labels, light grey
  hints, footer links, unrated rating cards, small seat-colour text. All fixed: small seat
  labels use a lighter tint of the seat colour, faded text is more opaque.
- New test `e2e/tests/ui-a11y.spec.ts` fails if any serious or critical issue returns.
- Fixed a lint failure introduced by the new tab icon.
- Not covered: text on cards that have their own gradient backgrounds (axe can't measure it).
- Verified: the full browser suite again (56 tests including the new one), web and board
  unit tests, lint, typecheck.

### 10. Not-found page and no-JavaScript message (7:38–7:40)

- The "page not found" screen now matches the app (brand mark, short explanation, buttons back
  to the start or to the lobbies, its own tab title) instead of a bare line of text.
- Browsers with JavaScript turned off see a short explanation instead of a blank page.
- Verified: lint, typecheck, build, landing and accessibility browser specs (7 passed).

## Final verification (on `main`)

Run at 7:07 AM on the final code, everything green:

| Check | Result |
|---|---|
| Lint (Biome, 300 files) | clean |
| Rust: fmt, clippy (no warnings), tests | 409 passed |
| Rules engine TypeScript wrapper | 30 passed |
| Protocol | 18 passed |
| Board renderer | 57 passed |
| Web app | 22 passed |
| Server (real Postgres) | 258 passed, 2 skipped (need a running bot-service) |
| Browser end-to-end (Playwright) | 53 passed (56 after the last items, rerun at 7:36) |

Everything is committed and pushed to `main` in small, described commits.

## Not done / left for you

- **Rules questions to confirm** (TODO.md, "Open rules questions"): the en passant rule;
  "Abandon = timeout" after the 60-second reconnect grace; that a stalemated or timed-out
  player's leader no longer keeps a Teams team alive; the attacked-leader glow default (off);
  FFA move-limit placements; and the Teams resignation decision taken tonight (player-only).
- **Draw-offer lapse timing:** an offer lapses once every other voter has had a turn and it is
  the offerer's turn again. Change `lapseReason()` on the server if you want it stricter.
- **Idle singleplayer games** stay open while the tab is connected (no hidden timeout, since you
  asked for no timers). Tell me if you want an inactivity limit.
- **Mobile:** the game, lobby and pages now work at phone and tablet sizes, but touch-specific
  controls and installing as an app (PWA) are not done (still in TODO.md).
- **Move log, chat, spectating and replays** remain designed-but-not-built, as originally
  requested (in TODO.md).
- **Game-message toasts** were not moved onto the new toast component (they sit over the board
  corner and let clicks pass through, which the new component would change).
- **Deployment** still needs your accounts (domain, Cloudflare, OVHcloud, Resend); see
  `docs/DEPLOY.md`.
- **Before a public launch:** attorney review of the legal drafts, trademark search, final art
  (see TODO.md, "Before public release").
