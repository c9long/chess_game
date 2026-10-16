# @game/board

The PixiJS 8 board renderer for the 4-player 12×12 game (M2), plus a dev-only hot-seat sandbox.

The renderer is framework-agnostic and never decides legality. It shows engine snapshots and legal moves from `@game/rules`, and reports the move the user picked. The host (the sandbox, the web app, or the server through the web app) applies that move and sends the resulting snapshot back.

## API

```ts
import { BoardView } from '@game/board'

const view = new BoardView({
  onMoveIntent: (move) => send(move), // engine notation: 'c2c4', 'e6e7q', 'g1i1'
  onSquareHover: (square) => {},      // 'e4' | null
  showAttackedLeaderGlow: false,      // these four can also be changed later with setOptions()
  reducedMotion: false,               // defaults to prefers-reduced-motion
  colorblindPatterns: false,
  sound: true,
})
await view.mount(element)             // fills the element and follows its size and devicePixelRatio
view.setPerspective('west')           // animated 90° turns; the local seat is always at the bottom
view.setSnapshot(snapshot, { events }) // events from applyMove/applyTimeout/applyAbandon (optional)
view.setInteractive('west')           // the seat the local user moves for, or null to only watch
view.setLegalMoves(game.legalMoves())
view.destroy()
```

- **Rejected intents.** If the host refuses a move, call `setSnapshot` again with the current snapshot and the piece slides back.
- **Animations.** These come from `planTransition(prev, next, events)` in `plan.ts`, a pure function that turns the board difference (made clearer by the events) into moves, castle rooks, captures (including en passant away from the destination), promotions, dissolving armies and status changes. Their timing comes from `motion.ts` (also pure): `moveTiming`, `scheduleMoves`, `castleTiming`, `contactTime`, `flightLift`, `blendPolicy` and friends.
- **Back-to-back snapshots.** A move still in flight when the next snapshot arrives is hurried (`Animator.hurry`: it continues from where it is and finishes within 90 ms), and the new move starts right after it. Nothing jumps. A catch-up of more than two plies is shown at once with a 150 ms cross-fade.
- **Pure helpers.** `geometry.ts` (perspective transforms, hit testing, cursor steps), `moves.ts` (`MoveIndex` over engine moves), `motion.ts` (timing and easing) and `palette.ts` (seat colours and markers) are unit-tested.
- **Bundler.** The piece and emblem SVGs from `@game/assets` are imported with Vite `?raw`, so the package needs a Vite-compatible bundler.

## Look

- **Board.** A shader draws the board into a texture at device resolution, once per size and again only when a seat's status changes (a cheap GPU pass). It has maple and walnut squares with grain that changes from square to square, a rosewood frame with mitred corners and brass inlays, and a band in the seat colour along each home edge. No image files are used.
- **Pieces.** The `packages/assets` SVGs are lit with injected gradients, then rasterised into one atlas at device resolution. The atlas holds each seat colour, frozen slate grey with an ice finish, soft shadows and colour-blind markers (the marker is the shape itself, in the seat colour, at the piece's upper right). Gold and Jade get a heavier outline so they hold up on light maple.
- **Coordinates.** Shown on all four edges, kept upright for the viewer.
- **Emblems.** Each civ emblem is a brass glyph on an enamel medallion on its seat's edge. Glyphs are always metal, never a light tint of the seat colour, so no seat/emblem pair can echo a flag.
- **Moves.** Pieces lift (scale and a spreading shadow), glide on a quick-take-off, soft-landing curve that lasts 230 to 360 ms depending on distance, and settle with a small squash. Knights hop in a screen-up arc. When castling, the rook takes off halfway through the leader's move and hops over it.
- **Captures.** The victim is knocked along the attacker's path, tilts, shrinks and fades, and chips in its colour scatter forward. All of this is drawn below the moving layer, so the attacker lands on top. A captured leader adds a brief hit-stop, a shockwave in its colour and a small board shake. Its army then burns away outward from the leader (one filter pass), and a Teams freeze spreads outward from the leader the same way.
- **Promotion.** The pawn rises and brightens, becomes the new piece at the peak under a ring in its seat's colour, and settles with an overshoot.
- **Turn.** The seat to move has a pulsing glow along its band and a larger, ringed medallion; the other bands are dimmed. The hand-over cross-fades when the moving piece lands, not when the move is sent. A seat's status change (grey medallion and band) waits until its burn or freeze starts, then cross-fades.
- **Highlights.** Last move: a warm fill that is lighter on maple and stronger on walnut, with a rounded inset in the mover's light colour. The origin fades in as the piece leaves and the destination as it lands. Move hints are dark translucent dots and light rings. They ripple in from the selected piece and fade out when it is deselected. A movable piece lifts slightly under the pointer, and a selected one gets a soft halo that breathes. An illegal drop flashes the target square red, and the piece returns home still lifted, so it passes over other pieces. An attacked leader (option) gets a hot halo under the piece and a steady red border.
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

## Accessibility

- **Keyboard.** The canvas can take focus. Arrow keys move a cursor in screen directions, Enter or Space selects a piece and then moves it, and Escape cancels. In the promotion picker, the arrow keys choose a piece and Enter confirms.
- **Screen readers.** There is no announcer yet: the canvas only has an `aria-label`.
