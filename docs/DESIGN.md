# Design system

A four-player chess game played around a four-sided table. The materials are walnut, brass,
enamel medallions and green baize, and the vocabulary is seats, nameplates and placings.
Tokens live in `apps/web/src/index.css` (`@theme`), primitives in `apps/web/src/components/ui.tsx`
(eager pages) and `overlay.tsx` (lazy code only: it pulls in Radix). The title comes only from
`APP_NAME`.

## Surfaces: the room and the table

| Token | Hex | Use |
| --- | --- | --- |
| `ink` | #1d1b19 | The room: landing, menus, account, history list, friends, sign-in |
| `baize` | #1f2a25 | The table: only where play happens (lobby table, game, replay, watch) |
| `panel` | #26231f | Rails and drawers on ink; every dialog, popover, sheet and toast |
| `baize-rail` | #283530 | Rails on baize (player panel, move list frame) |
| `baize-deep` | #18211d | Recessed areas on baize, if a well needs a solid colour |
| `panel-raised` | #2e2a25 | Tooltips, hovered rows on panel |
| `walnut` | #3a2a20 | Board and table frames |

**The baize hook.** Shell sets `data-surface="baize"` on `<html>` and on its own root for
`/match/*`, `/watch/*` and `/history/:matchId` (`isPlaySurface(pathname)` is exported from
`Shell.tsx`). The body then turns baize with a faint felt grain, and two surface-aware colours
follow the route:

- `bg-surface` is ink in the room and baize at the table.
- `bg-surface-rail` is panel in the room and baize-rail at the table.

Shared components (`Card`, `Panel`, `Alert`, `Nameplate`, the header) already use these. On a play
page, write `bg-surface-rail` instead of `bg-panel`. Don't hard-code `bg-ink` on play routes.
To style by surface in CSS, use `[data-surface="baize"] &`.

## Text, metal and status

- `parchment` #f4efe6 is primary text. Secondary text is `text-muted` (#c4bdb1). Meta, hints and
  captions are `text-faint` (#a59e93, at least 4.8:1 on every surface). With opacity, the floor
  is `parchment/65` on rails and `parchment/60` on ink, panel and baize. Axe checks contrast.
- `brass` #c9a55a is for engraved edges and quiet ornament: `border-rule-brass` on plates, panels
  and dialogs, the current-page bar, and info icons. It is never used for a button fill.
- `gold` #d4a017 marks the **one** primary action per screen (`Button` `primary`). It also
  marks "to move" and the winner. A second gold button on a screen is a bug.
- Seat colours (`seat-south/west/north/east`, plus `-light` tints for text) appear only where
  they identify a seat. Use `SEAT_CLASSES[seat]` and `SeatDot` from `ui.tsx`.
- `danger` vermilion is for check warnings only.
- Status colours are deliberately not seat colours: `destructive` and `destructive-light`
  (errors, destructive buttons), `ok` (success) and `warn` (warnings).
- Rules: `border-rule` (neutral row separators), `border-rule-strong` (inputs, dashed empty
  states), `border-rule-brass` (engraved edges).

## Type

Fraunces sets headings **and every name**: players, civs, the account name in the header.
Names read like engraved plates. Inter sets everything else. Use `tabular-nums` for clocks,
ratings and counts, and never monospace. Keep body copy at `max-w-[65ch]`.

| Class | Size | Use |
| --- | --- | --- |
| `text-display` | 44–72px fluid | Landing title only |
| `text-title` | 24–36px fluid | Page h1 (`PageTitle`) |
| `text-heading` | 21px | Section h2, dialog titles, empty-state titles |
| `text-lead` | 18px | Panel titles, names in rows, lead paragraphs |
| `text-body` | 16px | Body copy and inputs |
| `text-ui` | 14px | Controls, labels, table cells |
| `text-caption` | 12px | Hints, captions, footer |

## Radius, shadow, motion

- **Radius by hierarchy:** `rounded-plate` (4px) for nameplates and checkboxes,
  `rounded-control` (6px) for buttons, inputs and alerts, `rounded-panel` (10px) for panels,
  cards, popovers and toasts, and `rounded-sheet` (16px) for dialogs and bottom sheets. Use
  `rounded-full` only for chips, dots and avatars.
- **Shadows that read on dark:** `shadow-rim` (a top highlight on rails), `shadow-plate`,
  `shadow-well` (recessed), `shadow-lift` (overlays) and `shadow-gold` (the primary button).
- **Motion:** only in answer to an action (opening, confirming, a move), plus at most one
  orchestrated moment per screen. `prefers-reduced-motion` and the in-app preference cut all
  durations, so don't add motion that carries meaning on its own.
- **Focus:** a 2px gold outline from the base layer. Don't remove it. Inputs draw their own ring.

## Which primitive when

| Need | Use |
| --- | --- |
| The screen's main action | `<Button>` (primary), or `linkButtonClass('primary')` for a link |
| Other real choices | `variant="secondary"` (brass outline) |
| Cancel, back, minor tools | `variant="quiet"` (`ghost` is the old name) |
| Delete, resign, remove | `variant="danger"`. Confirm with `ConfirmDialog tone="danger"` |
| Sizes | `size`: `sm`, `md` or `lg`. Never shrink with `h-*` in `className` |
| Text input | `<Field label hint error valid>`. For bare controls use `inputClass` (with `.select` on `<select>`) |
| Link in running copy | `className={textLinkClass}` |
| Page h1 | `<PageTitle title subtitle actions>` (one per page) |
| Section inside a page | `<SectionHeading title description actions ruled>` |
| A list (history, friends, sessions, standings) | `<RuleList>` with `<RuleRow leading title detail trailing name>` |
| A group of controls | `<Panel tone title titleId actions>`, tone `rail`, `well` or `plain` |
| A standalone form block on ink | `<Card>` |
| Nothing to show yet | `<EmptyState title action>` with a sentence that invites the action |
| Inline message | `<Alert tone>`: `error`, `info`, `success` or `warning` |
| Tag | `<Pill tone>` (sentence case) |
| A seat or player | `<Nameplate seat name detail emblem trailing state size>` |
| Four players | `<SeatTable north west east south>{centre}</SeatTable>` |
| Modal, confirm, popover, phone sheet, tooltip, toast | `Dialog`, `ConfirmDialog`, `Popover`, `BottomSheet`, `Tooltip`, `useToast` from `overlay.tsx` |

Prefer rows separated by rules over grids of identical rounded cards.

## Seats around a table

Wherever four players appear (lobby, game, result, replay, watch), seat them the way the
homepage does: North at the top, West and East along the sides, South at the bottom, as seen
from the viewer's seat. Seat indices are `SEAT_ORDER = ['south', 'west', 'north', 'east']`,
which is also the turn order.

```tsx
<SeatTable
  stackBelow="lg"
  north={<Nameplate seat="north" name="Japan bot" detail="1200" />}
  west={<Nameplate seat="west" name="Ada" detail="To move" state="to-move" trailing={<Clock />} />}
  east={<Nameplate seat="east" name="United States" detail="Out" state="out" />}
  south={<Nameplate seat="south" name="You" detail="Mali" emblem={<CivEmblem civ="mali" />} />}
>
  <div className="w-[var(--board)]">{board}</div>
</SeatTable>
```

- `Nameplate` `state` is `idle`, `to-move` (gold edge, gold detail), `out` (struck through,
  dimmed) or `won` (gold). The seat colour runs down its inner edge. Plates size to their
  content, so give them a width (`w-56`, `w-full`) when they should line up.
- `SeatTable` centre: give it an explicit width, because its column sizes to it. Below
  `stackBelow` (`sm`, `md`, `lg` or `never`), North stays above and South below the centre, and
  West and East move under it side by side.
- For plates drawn along a board edge (rotated, like the landing demo), use `Nameplate` inside
  the page's own positioning; the plate itself doesn't rotate.

## Banned

- Tracked all-caps eyebrow labels, and all-caps labels generally (`uppercase`, `tracking-[…]`).
- Meta strings joined with `·` ("Guest · name", "Free-for-all · Untimed"). Use separate
  elements, a comma, or a second line.
- Labels shaped as "WORD — fragment", and `→` appended to links or buttons.
- Numbered markers on things that aren't a sequence.
- Identical soft-shadow card grids, gradient washes as decoration, glows behind buttons.
- Accenting one word of a heading.
- National flags or flag-derived colour layouts for civilizations.

## Copy

Use plain, active, sentence-case copy. Buttons say what happens ("Start game", "Send request").
Errors say what went wrong and how to fix it, and don't apologise. Empty states invite an action.
An action keeps its name through the flow: the "Resign" button leads to a "Resign" confirmation.

## Screenshots to check after a visual change

Take each at 1280×800 and 390×844, open every image, and run axe (`wcag2a`, `wcag2aa`):

1. Landing, signed out and as a guest.
2. Sign-in, sign-up with field errors, Play as Guest.
3. Play (vs bots panel and lobby list), then a lobby room.
4. A live game: your move, a check warning, the resign dialog, board settings, game over.
5. Watch and a replay (`/history/:id`): baize backdrop, seats placed around the board.
6. History, Leaderboard, Friends (empty and with rows), Profile, Account.
7. The header: current page, guest name, the mobile menu open at 390, and no horizontal overflow.
