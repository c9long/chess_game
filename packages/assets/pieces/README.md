# Chess pieces

One SVG per piece type: `king`, `queen`, `rook`, `bishop`, `knight`, `pawn`, plus `prime-minister` (England's own piece, civ version 2, ability Magna Carta: the knight's head wearing a small brass crown with the king's cross). The board renderer tints each piece with its seat colour (or the frozen grey), lights it and adds its shadow.

These are **original works** drawn for this project: lacquered, turned-wood pieces in a chunky Staunton cut, with a brass collar. They are not traced from or copied from any existing piece set.

## Colour contract (the renderer depends on this)

Every file has exactly this structure:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<title>King</title>
<g id="body" fill="currentColor"><path fill-rule="evenodd" d="..."/><path .../>...</g>
<g id="trim" fill="#b8913f"><path fill-rule="evenodd" d="..."/></g>
<g id="detail" fill="#1a1612"><path fill-rule="evenodd" d="..."/>...</g>
</svg>
```

- **`body`** is the piece's mass, in the seat colour. Its fill is the literal string `currentColor`. Its **first path is the whole silhouette**. The paths after it are the *turnings*: the visible part of each turned element (foot, step, stem, crown cup, ball, the horse's head), which together tile the silhouette. The renderer's gradients use `objectBoundingBox` units, so each turning is lit as a cylinder of its own, which is what makes the pieces read as turned wood. A consumer that fills every body path flat still gets a clean silhouette, because the turnings lie inside the first path.
- **`trim`** is the brass: a collar ring below the head of every piece, plus the king's cross, the queen's finial ball and the Prime Minister's crown (circlet and cross). Its fill is the literal string `#b8913f`. It is drawn on top of `body` (the body silhouette also covers the trim's area, so dropping the trim group leaves no hole).
- **`detail`** holds the outer outline plus all interior lines (the edges between turnings, the queen's crown band, the bishop's slit, the knight's eye, nostril, mouth, cheek and mane). Its fill is the literal string `#1a1612`. It is drawn last, so it also edges the brass.
- Every shape is a **filled path** with `fill-rule="evenodd"`. There are no strokes, so line weight never depends on the renderer's scale settings.
- Each file has a `<title>` naming the piece, for accessibility.
- The files contain no other colours and no `<text>`, `<style>`, gradients, filters, masks, `<image>`, `<use>` or external references.

Each of the three tokens appears exactly once, in its group's `fill` attribute (`packages/board/src/svg.test.ts` checks this), so string replacement is safe.

**Recolouring.** CSS custom properties and `currentColor` do not reach an SVG loaded through `<img>`, a texture loader or a canvas, so consumers recolour by **string replacement** before rasterising:

- The board (`shadePieceSvg` in `packages/board/src/svg.ts`) gives the body a lit seat-colour gradient and a sheen, the trim a brass gradient and the detail a near-black shade of the seat colour. The brass tones come from `PIECE_TRIM` in `palette.ts`: the app's brass on live pieces, a paler, polished brass on the Gold seat's pieces (the plain brass would melt into their ochre body) and a dulled brass on frozen ones. A removed army's pieces leave the board, so there is no removed tone. The colour-blind markers are drawn over the result.
- `flatPieceSvg` recolours all three tokens flat (the trim follows the body unless given).
- Small glyphs beside text (the lost-material row, the civ card's piece tile) drop the trim and detail groups and keep a one-colour silhouette in `currentColor`: `pieceSilhouetteSvg`, which `apps/web/src/lib/piece-sprites.ts` imports from `@game/board/svg` (string helpers only, no renderer).

When the SVG is inlined in HTML, `currentColor` also works directly from the CSS `color` property.

**Seat colours.** The set was checked in the four seat colours and frozen slate, lit the way the board lights it, on maple (`#eadcc0`) and walnut (`#654d3c`) squares at 19, 22, 24, 40, 80 and 256 px at 1× density. The near-black detail colour separates every tint, and the brass, from both square colours.

## Geometry

- All pieces share one base: a wide foot and a deep rounded step, spanning x ≈ 36–220 with the outline (72% of the canvas), bottom edge at y ≈ 246. The base is stacked in front of everything, so stems and the knight's neck tuck in behind it. Base width and baseline are identical across the set, so pieces line up on a rank.
- Heights follow Staunton order, in a compressed range so every piece is big on a phone's 20 px square. Ink tops (with the outline) are king 10, queen 19.5, Prime Minister 20, bishop 27.5, knight 29, rook 48 and pawn 67 (y, out of 256). Ink heights are king 92% of the canvas, queen 88%, Prime Minister 88%, bishop 85%, knight 85%, rook 77% and pawn 70%; the pawn is still 39.5 units (3 px at 19 px) shorter than the bishop. The board draws the sprite at the square's size, so a king spans about 92% of its square.
- Heads are big: the crown, coronet, mitre, battlements and horse head take roughly the top third of each piece, and the brass collar sits just below. The silhouettes are made to stay distinct on 19–22 px squares (a phone at 1× density): the king's cross, the queen's five balls, the rook's three merlons, the bishop's pointed mitre and ball, the horse's two ears, long face and deep throat notch, the pawn's big round head, the Prime Minister's brass cross over a horse's head.
- The **knight faces right**. To make it face left, mirror it with `scaleX(-1)` about the centre (x = 128). The same goes for the **Prime Minister**, which is the knight's own head (scaled to 90% about its foot, with a smooth poll in place of the ears: beside the cross's stem they would only be a smudge of outline), with the jaw notch kept as a real cut-out of the silhouette, wearing a brass circlet on the poll and the king's cross standing on it (both in `trim`, drawn in front of the head, so the head's detail lines stop at their edge). Inside the head only the knight's eye, mouth and mane line remain. The lost-material row's 14 px glyph (trim and outline stripped) keeps the cross-over-a-horse's-head silhouette, which tells it apart from a knight.
- The king, queen, rook and pawn are **exactly mirror-symmetric** about x = 128 (body, turnings, trim and detail): every coordinate has a mirror twin. The bishop's silhouette is symmetric too; only its diagonal slit, which is a separate path in `detail`, is not.
- The outline is 8 units wide, centred on the body edge, which is about 1.25 px at 40 px. Interior lines are 4.5–6.5 units wide.

## Source and rebuilding

The SVGs are generated. Do not hand-edit them. The source is [`../scripts/build-pieces.mjs`](../scripts/build-pieces.mjs): hand-tuned Bézier components (foot, step, stem, collar, crown, head and so on) stacked back to front, some tagged `brass` (the trim). The script:

1. unions the components into the body silhouette, and emits the visible part of each one as a turning;
2. collects the visible part of the `brass` components into `trim`;
3. outlines every edge that stays visible, plus the interior lines (clipped off the brass and the base), as filled bands in `detail`;
4. mirrors the symmetric pieces exactly;
5. checks the result against the source geometry, checks symmetry, and checks that every ink box stays on the canvas and sits on the shared baseline, before writing.

Geometry operations use Skia (`canvaskit-wasm`). It is deliberately not a workspace dependency, so install it in a temporary folder to rebuild:

```sh
npm install --prefix /tmp/ck canvaskit-wasm@0.40.0
cd packages/assets
CANVASKIT_DIR=/tmp/ck node scripts/build-pieces.mjs
# or only some pieces:
PIECES=prime-minister CANVASKIT_DIR=/tmp/ck node scripts/build-pieces.mjs
```

## Review

Render the set before merging any change, and look at it at board size and at full size:

```sh
cd packages/assets
node scripts/render-pieces.mjs /tmp/pieces.png /tmp/pieces-board.png
```

The first sheet shows every piece tinted by string replacement (body to the seat colour, trim to brass) and rasterised through `<img>`. It covers the four seat colours plus frozen grey, on maple and walnut squares, at 19, 22, 40, 80 and 256 px. It shows flat colours; the board adds the lighting. To judge the lit result, look at the sandbox or the game at 1× and 2× density. The second sheet is the 16×16 starting position with 40 px squares (South as England, with Prime Ministers), with the North and East knights mirrored.

Don't use `scripts/render-svg.mjs` to review pieces. That sheet is built for single-colour emblems: it puts the near-black outline on near-black backgrounds, so it can't show the three-tone result.
