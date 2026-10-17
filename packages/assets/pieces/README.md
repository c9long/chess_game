# Chess pieces

One SVG per piece type: `king`, `queen`, `rook`, `bishop`, `knight`, `pawn`, plus `prime-minister` (England's special piece, civ version 2: the knight's head wearing the king's crown). The board renderer tints each piece with its seat colour (or the frozen grey) and adds its own lighting and shadow.

These are **original works** drawn for this project, in a classic Staunton-inspired style. They are not traced from or copied from any existing piece set.

## Two-tone contract (the renderer depends on this)

Every file has exactly this structure:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<title>King</title>
<g id="body" fill="currentColor"><path fill-rule="evenodd" d="..."/></g>
<g id="detail" fill="#1a1612"><path fill-rule="evenodd" d="..."/>...</g>
</svg>
```

- **`body`** is the piece's main mass. Its fill is the literal string `currentColor`.
- **`detail`** holds the outer outline plus all interior lines (collar separations, the queen's crown band, the bishop's slit, the knight's eye, nostril, mouth, cheek and mane). Its fill is the literal string `#1a1612`. It is drawn on top of `body`.
- Every shape is a **filled path** with `fill-rule="evenodd"`. There are no strokes, so line weight never depends on the renderer's scale settings.
- Each file has a `<title>` naming the piece, for accessibility.
- The files contain no other colours and no `<text>`, `<style>`, gradients, filters, masks, `<image>`, `<use>` or external references.

**Recolouring.** CSS custom properties and `currentColor` do not reach an SVG loaded through `<img>`, a texture loader or a canvas, so the renderer recolours by **string replacement** before rasterising:

```ts
const tinted = svg.replaceAll('currentColor', seatColour).replaceAll('#1a1612', detailColour)
```

Both tokens appear only in the two `fill` attributes, so the replacement is safe. When the SVG is inlined in HTML, `currentColor` also works directly from the CSS `color` property.

**Seat colours.** The set was checked in the four seat colours (`#c0392b`, `#2e6fd8`, `#d4a017`, `#1f9e6e`) and in a desaturated frozen grey (`#8f8b86`), on light (`#e8d9b5`) and dark (`#8a6a45`) squares, at 40, 80 and 256 px. The near-black detail colour separates every tint from both square colours. Keep `#1a1612` unless the board palette changes a lot.

## Geometry

- All pieces share one base: a two-tier plinth spanning x ≈ 59–197 (54% of the canvas) with its bottom edge at y ≈ 228. Base width and baseline are identical across the set, so pieces line up on a rank.
- Heights follow Staunton order. Ink tops are king 13, queen 26, bishop 42, knight 47, rook 67 and pawn 78 (y, out of 256); the Prime Minister's cross tops out near the queen (about 24).
- The **knight faces right**. To make it face left, mirror it with `scaleX(-1)` about the centre (x = 128). The same goes for the **Prime Minister**, which reuses the knight's head (scaled to 74% about its foot, without the mane line) under a wide copy of the king's crown and cross (115% of the king's width, 90% of its height, about a third of the piece). Its crown is drawn in front of the head, so the head's detail lines stop at the crown's edge; the crown has no upper band, and its size keeps the seat colour showing in the cup at 19–20 px squares (a phone's square size at 1× pixel density), so it reads as a crown rather than a dark bump. The lost-material row's 16 px glyph (outline stripped) keeps the crown-and-cross silhouette, which tells it apart from a knight.
- The king, queen, rook and pawn are **exactly mirror-symmetric** about x = 128: every coordinate has a mirror twin. The bishop's silhouette is symmetric too; only its diagonal slit, which is a separate path in `detail`, is not.
- The outline is 7 units wide, centred on the body edge, which is about 1 px at 40 px. Interior lines are 4.5–7 units wide.

## Source and rebuilding

The SVGs are generated. Do not hand-edit them. The source is [`../scripts/build-pieces.mjs`](../scripts/build-pieces.mjs): hand-tuned Bézier components (foot, step, collar, stem, rings, crown and so on) stacked back to front. The script:

1. unions the components into `body`;
2. outlines every edge that stays visible, plus the interior lines, as filled bands in `detail`;
3. mirrors the symmetric pieces exactly;
4. checks the result against the source geometry and checks symmetry before writing.

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

The first sheet shows every piece tinted by string replacement and rasterised through `<img>`, the same way the game does it. It covers the four seat colours plus frozen grey, on light and dark squares, at 19, 40, 80 and 256 px. The second sheet is the 16×16 starting position with 40 px squares (South as England, with Prime Ministers), with the North and East knights mirrored.

Don't use `scripts/render-svg.mjs` to review pieces. That sheet is built for single-colour emblems: it puts the near-black outline on near-black backgrounds, so it can't show the two-tone result.
