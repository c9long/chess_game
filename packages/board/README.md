# @game/board

The PixiJS 8 board renderer for the 4-player 16×16 game (M2), plus a dev-only hot-seat sandbox.

The renderer is framework-agnostic and never decides legality. It shows engine snapshots and legal moves from `@game/rules`, and reports the move the user picked. The host (the sandbox, the web app, or the server through the web app) applies that move and sends the resulting snapshot back.

## API

```ts
import { BoardView } from '@game/board'

const view = new BoardView({
  onMoveIntent: (move) => send(move), // engine notation: 'e2e4', 'e8e9q', 'i1k1'
  onSquareHover: (square) => {},      // 'e4' | null
  reducedMotion: false,               // these three can also be changed later with setOptions();
                                      // defaults to prefers-reduced-motion
  colorblindPatterns: false,
  sound: true,
  announce: true,                     // screen-reader live regions (default true)
  localSeat: 'west',                  // said as "You" / "your" (also setLocalSeat)
  announceOwnCheck: true,             // false: the viewer's check is said only on their turn
  announceTurn: true,                 // "Your move." (with the check) when the turn reaches localSeat
  onAnnounce: (text) => {},           // each text read in the moves region (e.g. for a result dialog)
  zoomButton: 'auto',                 // magnifier button while squares are < 32 px (true / false)
  onZoomChange: (zoom) => {},
})
await view.mount(element)             // fills the element and follows its size and devicePixelRatio
view.setPerspective('west')           // animated 90° turns; the local seat is always at the bottom
view.setSnapshot(snapshot, { events }) // events from applyMove/applyTimeout/applyAbandon (optional)
view.setInteractive('west')           // the seat the local user moves for, or null to only watch
view.setLegalMoves(game.legalMoves())
view.setCheck('west')                 // check indicator on West's leader square(s); null clears it
view.setZoom(2, { focus: 'e4' })      // 1 = whole board; clamped to view.zoomRange.max
view.toggleZoom()                     // the zoom button: one step in (squares ~44 px) or back out
view.destroy()
```

- **CSP.** The package imports `pixi.js/unsafe-eval` once (top of `BoardView.ts`), PixiJS 8's CSP-safe path: shaders and uniform uploads without `new Function`, so a page's Content-Security-Policy needs no `'unsafe-eval'` (the rules engine still needs `'wasm-unsafe-eval'`).

- **Check indicator.** `setCheck(seat | null, { sound? })` draws a vermilion ring with a light inner line, a vermilion wash and a pulsing glow on that seat's leader square(s) (a colour no seat uses, plus a cue that doesn't depend on hue), which come from the snapshot's `leaderSquares` (the engine's roster leader role, so a civ whose leader isn't a king works too). It follows the leader as it moves (when the leader itself moves, the marking moves to the new square once the slide lands, without a second sound); a glow is drawn for every leader square, however many; under reduced motion the ring and glow are steady. Turned on right after `setSnapshot`, it waits until that move lands and then plays the `check` sound (pass `sound: false` to skip it). The board never decides when to show it: the host owns that rule (the web app shows it only for the viewer's own seat, see `apps/web/src/lib/check-indicator.ts`). `checkSeat` and `checkSquares` read back what is shown.

- **Rejected intents.** If the host refuses a move, call `setSnapshot` again with the current snapshot and the piece slides back.
- **Animations.** These come from `planTransition(prev, next, events)` in `plan.ts`, a pure function that turns the board difference (made clearer by the events) into moves, castle rooks, captures (including en passant away from the destination), promotions, dissolving armies and status changes. Their timing comes from `motion.ts` (also pure): `moveTiming`, `scheduleMoves`, `castleTiming`, `contactTime`, `flightLift`, `blendPolicy` and friends.
- **Back-to-back snapshots.** A move still in flight when the next snapshot arrives is hurried (`Animator.hurry`: it continues from where it is and finishes within 90 ms), and the new move starts right after it. Nothing jumps. A catch-up of more than two plies is shown at once with a 150 ms cross-fade.
- **Pure helpers.** `geometry.ts` (perspective transforms, hit testing, cursor steps), `moves.ts` (`MoveIndex` over engine moves), `motion.ts` (timing and easing) and `palette.ts` (seat colours and markers) are unit-tested.
- **Bundler.** The piece and emblem SVGs from `@game/assets` are imported with Vite `?raw`, so the package needs a Vite-compatible bundler.

## Look

- **Board.** A shader draws the board into a texture at device resolution, once per size and again only when a seat's status changes (a cheap GPU pass). It has pale maple and dark, greyed walnut squares (`BOARD_MATERIALS` in `palette.ts`, chosen so every seat colour stands apart from both; `palette.test.ts` checks the margins) with grain that changes from square to square and quietens on phone-sized squares, a walnut frame with mitred corners and a brass inlay line round the field, and a brass-edged enamel banner in the seat colour along each home edge, like the app's nameplates. No image files are used.
- **Pieces.** The `packages/assets` SVGs (body, brass trim and outline; see the colour contract in `packages/assets/pieces/README.md`) are lit with injected gradients, then rasterised into one atlas at device resolution. Each turned element of the body gets its own cylinder of light in the seat colour, the collar ring (and the king's cross and queen's finial) a brass gradient from `PIECE_TRIM` in `palette.ts` (a paler, polished brass on Gold pieces, which the plain brass would melt into, and dulled on frozen ones; a removed army's pieces leave the board), and the outline a near-black shade of the seat colour. The atlas holds each seat colour, frozen slate grey with an ice finish, soft shadows and colour-blind markers (the marker is the shape itself, in the seat colour, about a quarter of a square, tucked into the square's upper right corner, clear of the tallest heads). Gold and Jade get a heavier outline so they hold up on light maple.
- **Sizes.** Everything is sized in squares. A piece sprite is drawn at the square's size (`PIECE_SCALE`); the art's tallest ink box is 92% of its canvas and its base 72% wide, so a king spans about 92% of its square and neighbours keep a small gap. The frame is `BOARD_FRAME` (0.66) squares wide and the transparent margin outside it `BOARD_MARGIN` (0.42; it only has to clear the medallions, 1 square across, centred 0.8 of the frame out from the field), so the canvas is 18.16 squares across; a page that lines things up with the frame uses `BOARD_CANVAS_MARGIN`, the margin as a fraction of the canvas (all three in `geometry.ts`). Hit testing, the drag ghost, highlights, the check ring and capture effects are all sized from the square, and the promotion picker draws each choice at `PICKER_PIECE_SCALE` (0.9) of its tile.
- **Coordinates.** Shown on all four edges in the app's UI face (Inter, parchment on walnut), kept upright for the viewer, centred in the strip between the field and the banner (the banner runs from 0.6 to 0.82 of the frame). A label too wide for the strip (a two-digit rank on a phone's 20 px squares) is condensed, to at most 72% of its width, so it keeps 1 px clear of the field and the banner. `mount()` waits (at most 1.2 s) for the face to load, so labels are never cached in a fallback.
- **Emblems.** Each civ emblem is a brass glyph on an enamel medallion (a brushed brass bezel, an engraved line, an enamel field in the seat colour) on its seat's edge. Glyphs are always metal, never a light tint of the seat colour, so no seat/emblem pair can echo a flag.
- **Moves.** Pieces lift (scale and a spreading shadow), glide on a quick-take-off, soft-landing curve that lasts 230 to 360 ms depending on distance, and settle with a small squash. Knights hop in a screen-up arc. When castling, the rook takes off halfway through the leader's move and hops over it.
- **Captures.** The victim is knocked along the attacker's path, tilts, shrinks and fades, and chips in its colour scatter forward. All of this is drawn below the moving layer, so the attacker lands on top. A captured leader adds a brief hit-stop, a shockwave in its colour and a small board shake. Its army then burns away outward from the leader (one filter pass), and a Teams freeze spreads outward from the leader the same way.
- **Promotion.** The pawn rises and brightens, becomes the new piece at the peak under a ring in its seat's colour, and settles with an overshoot.
- **Turn.** The seat to move has a soft glow along its banner and a larger medallion ringed in gold (the gold that marks "to move" across the app); the other banners are dimmed. The hand-over cross-fades when the moving piece lands, not when the move is sent. A seat's status change (grey medallion and band) waits until its burn or freeze starts, then cross-fades.
- **Highlights.** One set of colours (`HIGHLIGHT` in `palette.ts`), shared with the app's tokens. Last move: a soft brass wash on both squares, with an inset edge in the mover's light colour. The origin fades in as the piece leaves and the destination as it lands. Move hints are dark translucent dots and light rings. They ripple in from the selected piece and fade out when it is deselected. A movable piece lifts slightly under the pointer; a selected one gets a gold wash and edge on its square and a soft halo that breathes. A dragged piece's drop square gets a parchment wash and edge. An illegal drop flashes the target square red, and the piece returns home still lifted, so it passes over other pieces. A leader in check (`setCheck`) gets a ring in the app's danger vermilion (with a light inner line) and a light wash on its square and a pulsing halo under the piece; nothing else on the board uses that colour.
- **Reduced motion.** Moves cross-fade: the piece fades out where it was and in on its new square, in 100 to 140 ms. Highlight and turn changes are short fades. There are no arcs, particles, shake or hit-stop.
- **Lighting.** A light pass in screen space, clipped to the board, so it stays put while the board turns.

## Performance notes

- Resizes scale the existing scene at once and re-rasterise textures only after the size has been stable for 150 ms. A hidden container (zero size) stops the ticker; showing it resumes without a rebuild if the size is unchanged.
- A `devicePixelRatio` change (zoom, moving to another screen) is caught with a resolution media query and re-rasterises at the new density.
- MSAA is only enabled below 2x density (at 2x+ it costs hundreds of MB of VRAM for no visible gain). The board shadow and lighting are rasterised at reduced resolution.
- When only the idle turn glow (or a selected piece's halo) moves, the ticker is capped at 30 fps; it runs uncapped during animations and input.
- Animated decorations are pre-drawn and only change alpha, scale or position: sprites from pooled textures (move hints, glows), and Graphics drawn once per size or per move (selection, last move). Per-frame code allocates nothing. Coloured capture debris uses a second particle pool with normal blending.
- Every layer of the root container has a `label` (`pieces`, `moving`, `captures`, and so on) for tests and devtools.
- After a WebGL context loss and restore, the board surface is drawn again.
- `destroy()` frees every texture and canvas the view created. A destroyed view can't be mounted again; create a new one.

## Sandbox (dev only, never deployed)

```sh
pnpm build:wasm                    # once, builds the rules engine
pnpm --filter @game/board sandbox  # http://localhost:5180
```

The sandbox gives you hot-seat play for all four seats, an FFA/Teams switch, a perspective switcher (with an optional "follow turn"), and timeout and abandon buttons for each seat. It also has a civ picker per seat, the option toggles, an event log, seat statuses, undo, and loading or copying a position string. `window.__sandbox` exposes helpers for scripted checks: `play`, `playAll`, `timeout`, `abandon`, `loadPosition`, `setPerspective`, `setOptions`, and `view.timeScale` to slow animations down for screenshots.

## Zoom and touch (phones)

On a 390 px phone the 16×16 board gets about 21 px squares, so the board zooms and pans itself (a camera in `camera.ts`, pure and unit-tested; hit testing goes through the same transform, so taps and drops land right at every zoom).

| Input | Does |
| --- | --- |
| One finger (or the mouse) on a movable piece | Selects it; dragging carries it (never pans) |
| Tap a legal target | Moves there (touch: on release, so a second finger can still cancel it) |
| One finger dragged anywhere else, when zoomed | Pans the board (a selection is kept) |
| Two fingers | Pinch to zoom, move to pan; cancels whatever the first finger started (a drag goes home) |
| Double tap on one empty square (nothing selected) | Zooms in there to the one-tap zoom, or back out (never on pieces, never across two squares) |
| Zoom button (lower-right corner of the board) | One-handed: zoom in toward the selection, the keyboard cursor or your leader; tap again for the whole board. Only its visible disc takes taps. At 1x it sits in the frame's corner, off the squares: on phone-sized boards, where the frame and margin are narrower than the disc, it shrinks to as little as 24 px and slides up to 8 px out past the board's corner into the page gutter (`zoomDiscFit` in `camera.ts`) |
| Ctrl/⌘ + wheel, trackpad pinch | Zoom around the pointer; a plain wheel pans while zoomed |
| `+` / `-` / `0` | Zoom in toward the cursor / out / whole board |

- **Limits.** The one-tap zoom aims for squares of about 44 px (at least 1.5×); zooming stops at about 76 px squares (2× to 4×). A pinch past either limit meets a rubber band and springs back when the fingers lift; the board edge never comes inside the viewport.
- **Staying oriented.** Selecting a piece pans just enough to show its legal targets (the piece itself always stays in view); dragging a piece near the viewport edge pans that way; the keyboard cursor is kept in view. While the board's own edge coordinates are out of view, small coordinates follow the visible columns and rows along the bottom and left edges. Turning to another perspective keeps the same board point in the middle.
- **Sharpness.** Once the zoom has been still for 220 ms the board surface, pieces, labels and medallions are re-rasterised for it (no layout change, animations keep running; the surface stays within 4096 device px).
- **Motion.** Zoom and pan animate for 260 ms (instant under reduced motion); pinch and pan follow the fingers directly.
- **Touch polish.** No text selection, callout menu, tap highlight or browser zoom on the board; taps and drops just off a legal target count as that target, and a tap just off one of your movable pieces selects it (`TOUCH_SLOP_PX`). The renderer's resolution is capped at 2 on phones and tablets (coarse pointer), 3 elsewhere.

## Accessibility

- **Keyboard.** The canvas can take focus (a gold focus ring for keyboard focus, which also shows the cursor on your leader). The arrow keys move a cursor in screen directions (a white ring inside a dark one, drawn above the pieces); Enter or Space picks up a piece and then places it; Escape puts it down (pressed again, it hides the cursor and says so; an arrow key shows it again). Against the board's edge the cursor stays put and says "Edge of the board". In the promotion picker the arrow keys choose a piece, Enter confirms and Escape cancels. `+`, `-` and `0` zoom.
- **Screen readers.** Two visually hidden polite live regions sit next to the canvas (`announce.ts`):
  - *Moves* (`data-board-announcer="moves"`): every step from `setSnapshot` in plain words, from the engine's events: "West: knight b7 to c9", "…, takes North's pawn", "…, promotes to queen", "South castled: king i1 to k1, rook l1 to j1", "Check: North's king is under attack.", "East is defeated: out of time.", "Game over. South wins." Steps that arrive close together (bots replying) are read as one announcement (700 ms quiet, 2.5 s at most); a move made on this board (or by `localSeat`) is confirmed after 150 ms ("You: …"; there is no separate "Move sent."). When the turn reaches `localSeat`, the batch is read at once ending with "Your move." (or "Your move. Check: your king is under attack."), and the end of the game is read at once too, so the moves that caused a turn, check or result are always heard first. A seat with several leaders is told again when another one comes under attack. A game that a host ends as a draw the moment a player is knocked out (a solo game) is said as "You were eliminated, so the game ends here. West, North and East share first place.", not as an agreed draw. A step without events (a resync) is described only when it is one move. `view.announcements` reads back what was said.
  - *Cursor* (`data-board-announcer="cursor"`): answers the keyboard at once: the square under the cursor ("e4, empty, move here", "b7, West knight", "i1, your king"), picking up ("Picked up pawn on e2: 2 moves."), refusals ("Not your turn. West to move."), the promotion choices ("rook, 2 of 4") and zoom.
