# Civilization emblems

One single-colour SVG glyph per civ, shown beside usernames, in civ pick and on seat frames. The game tints each glyph with the seat colour and the UI adds any frame or badge around it.

These are **original works** drawn for this project. They do not trace or copy any game's art. They are placeholder-quality originals: before release, check each one against the Civ VI reference art and then produce the final original art, as tracked in [TODO.md](../../../TODO.md) ("Confirm each civ emblem against Civ VI reference art, then produce final original art for all 9").

## Set

| Slug | Subject | Deliberately avoids |
| --- | --- | --- |
| `canada` | 11-point maple leaf with negative-space veins | The national flag and its red bars; the flag leaf's exact proportions |
| `usa` | Bald eagle, wings raised, head in profile | Stars and stripes, shield, arrows and olive branch, Great Seal composition |
| `china` | Coiled dragon reaching for a flaming pearl | Stars, the national flag and emblem, Tiananmen, red/gold banding |
| `japan` | Five-petal sakura crest (kamon style) | The sun disc, rising-sun rays, the imperial chrysanthemum seal |
| `germany` | Oak sprig: three leaves and two acorns | The eagle (Bundesadler), the Iron Cross, the black-red-gold tricolour |
| `russia` | Firebird with a folk-art plume tail | The double-headed eagle, hammer and sickle, the white-blue-red tricolour |
| `england` | Tudor double rose | St George's cross, the royal arms and lions, the Union Jack |
| `france` | Heraldic fleur-de-lis | The tricolour, Marianne, the Gallic rooster as a state seal |
| `mali` | Bamana Chiwara antelope headdress on its base | The green-gold-red tricolour and any national colour bands |

## House style (all new emblem art must follow this)

**File**
- One standalone SVG with `xmlns`, `viewBox="0 0 256 256"`, and no `width` or `height` attributes.
- Put `fill="currentColor"` on the root `<svg>` and leave every shape unfilled, so it inherits that colour. Use no other colours.
- Use only filled `<path>` (or basic shape) elements. Do not use `<text>`, strokes, gradients, filters, masks, `<image>`/raster data, `<use>`/external references or `<style>`.
- Draw interior detail as negative space (`fill-rule="evenodd"` cut-outs or gaps between shapes), never as a second colour.

**Composition**
- Draw the glyph alone, with no enclosing circle, shield or badge.
- Fit it inside the central ~216 × 216 safe area (about x/y 20–236) and centre it optically.
- Match visual weight across the set. The current set measures 20–34% ink on the 256² canvas (32–55% of its own bounding box). New art should land in that band and look as heavy as its neighbours when placed side by side. (The original brief aimed for 35–50% canvas coverage. Open subjects like leaves and animals read correctly lighter than that, so judge the set side by side rather than by the number alone.)

**Craft**
- Use smooth cubic Bézier outlines, with sharp corners only where a point is intended.
- Keep exact symmetry where the subject is symmetrical (mirror or rotate one generated half).
- Keep strokes, struts and gaps at least ~6 units wide at 256. Thinner detail is allowed only as large-size enrichment that disappears cleanly at small sizes.
- The silhouette must read at 24 px, and the detail must hold up at 256 px. Aim for stylised-heraldic-but-modern, not clip-art.
- Do not use national flags, flag layouts, stripe or star arrangements, or political or state symbols (see the "avoids" column).

**Review**
Render the whole set together and look at it before merging:

```sh
cd packages/assets
node scripts/render-svg.mjs /tmp/emblems.png emblems/*.svg
```

The sheet shows each emblem at 24/48/128/256 px on light and dark backgrounds and in all four seat colours.
