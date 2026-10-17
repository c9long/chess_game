# UI libraries: evaluation and recommendation

Status: decided 2026-10-16. Scope: `apps/web` (React 19.3, Tailwind 4.3, Vite 8, PixiJS 8 board, Motion 14).

## Summary

- **Primitives: Radix UI** (the unified `radix-ui` package), wrapped in our own small components styled with our Tailwind tokens. We follow the shadcn/ui *pattern* (components we own, in our repo) but don't run the shadcn CLI or take its theme.
- **Icons: `lucide-react`.** Each icon is tree-shaken and costs about 0.3 kB gzipped.
- **Animation: Motion, only where CSS can't do the job.** That means the match screen (already used there) and choreography inside lazy chunks. Hover, focus, press, and dialog enter and exit use CSS transitions on `data-state` attributes.
- **Toasts: Radix Toast**, so every primitive comes from one library. Sonner is a reasonable alternative if the match team wants its stacking and promise API.
- **Selects: keep native `<select>`**, restyled with `appearance-none`, a chevron icon and `color-scheme: dark`. Native selects are the most accessible option on phones, and the DOB gate and lobby options are plain lists. Use Radix Select only when an option needs rich content.
- **Keep overlay primitives out of the entry chunk.** `components/ui.tsx` is imported by the eagerly loaded pages, so it never imports Radix. Overlays go in a separate module, `components/overlay.tsx`, that only lazy pages or lazily imported components use.

## Candidates

Versions are the newest stable releases at least two weeks old on 2026-10-16. Newer releases exist and are listed in brackets. Sizes were measured by us: each library's Dialog, Tooltip and Toast (or the nearest equivalents) were bundled with esbuild 0.25 (`--minify`, React external, production), then gzip -9. These are upper bounds, because whole component namespaces are exported. The method is described in the [Measurement](#measurement) section.

| | Radix UI | Base UI | React Aria Components | Ark UI | Headless UI | shadcn/ui |
|---|---|---|---|---|---|---|
| Package / version | `radix-ui` 1.6.7 [1.8.1, 2026-10-12] | `@base-ui/react` 1.8.0 [1.9.0] | `react-aria-components` 1.21.1 [1.22.1] | `@ark-ui/react` 5.39.2 [5.39.3] | `@headlessui/react` 2.2.10 | CLI `shadcn` 4.21; copies Base UI (default since July 2026), Radix or React Aria code into the repo |
| React 19 | Yes (peer `^19.0`) | Yes (`^19`) | Yes | Yes (`>=18`) | Yes (`^19`) | Same as the base it copies |
| Dialog / AlertDialog | Yes / yes | Yes / yes | Yes (Modal and Dialog, `role="alertdialog"`) | Yes | Dialog only | Yes |
| Tooltip | Yes | Yes | Yes | Yes | **No** | Yes |
| Toast | Yes (F8 hotkey, swipe) | Yes | **Alpha** (`UNSTABLE_Toast*`) | Yes | **No** | Base UI Toast (July 2026) or Sonner |
| Select / Menu | Yes / yes | Yes / yes | Yes / yes (best-in-class a11y) | Yes / yes | Listbox / Menu | Yes |
| Dialog alone, gz | **13.7 kB** | 23.4 kB | 21.8 kB | 19.8 kB | 16.8 kB | Same as base |
| Dialog + Tooltip + Toast, gz | **32.5 kB** | 51.2 kB | 37.0 kB | 40.8 kB | n/a | Same as base |
| Plus Select + Menu, gz | 44.3 kB | 75.7 kB | 69.0 kB | 58.8 kB | 43.0 kB (no tooltip or toast) | Same as base |
| Styling fit with Tailwind 4 | Unstyled. `data-state="open\|closed"` and `data-side` drive Tailwind variants. `asChild` lets our own `<Button>` or `<Link>` act as a trigger. | Unstyled. `data-open`, `data-starting-style` and `data-ending-style` give CSS-only enter and exit. The `render` prop plays the role of `asChild`. | Unstyled, with render props and `data-*` states. Its own `Button` and `Link` replace ours, which conflicts with our `ui.tsx` exports. | Unstyled, built on Zag state machines. `data-state` attributes. | Unstyled, with `data-open` and `data-closed`. | Brings its own CSS variable theme plus `cn`, `tailwind-merge` and `class-variance-authority` |
| Maintenance (as of Oct 2026) | WorkOS. Active: 1.7.0 (2026-10-05) and 1.8.x (2026-10-12) shipped this month. shadcn still fully supports it. | MUI team. Very active and the shadcn default. | Adobe. Very active, mature. | Chakra team. Active. | Tailwind Labs. Slow, with one release in 2026. | Very active |
| Install footprint | 6 MB | 20 MB | Large (`@react-aria/*` tree) | Moderate | Small | n/a |

Libraries for supporting jobs:

| Job | Choice | Version | Size (gz) | Why |
|---|---|---|---|---|
| Icons | `lucide-react` | 1.49.0 (2026-09-29) [1.58.0] | Nine icons: 2.9 kB | Tree-shaken per icon, `currentColor`, consistent 24px grid and 1.5–2px stroke. It replaces the hand-drawn `KeyIcon` in SignIn. |
| Toasts (alternative) | `sonner` | 2.0.8 | 9.6 kB | Imperative `toast()`, stacking, promise toasts and an `unstyled` mode with `classNames`. Use it only if Radix Toast is too low-level for Match. |
| Animation | `motion` (installed) | 14.2.0 | `motion` + `AnimatePresence`: 46.8 kB. `LazyMotion` + `m`: 31.0 kB. | Too heavy for the entry chunk, so use it only in lazy chunks. Match already pays for it. |

## Recommendation: Radix UI

We need accessible dialogs, confirm dialogs, tooltips, toasts and, later, a header menu. Across those needs, Radix gives the best ratio of accessibility to bytes and fits our code best.

1. **Size.** Dialog, Tooltip and Toast together come to 32 kB gzipped, against 37 to 51 kB for the alternatives. Our entry chunk is 116.5 kB gzipped today (measured with `vite build` on 2026-10-16), so the difference matters if a primitive ever ends up in it.
2. **Fit.** `asChild` lets our existing `Button` and `Link` act as triggers, so `ui.tsx` keeps its API. Its `data-state` attributes work with Tailwind 4 variants (`data-[state=open]:animate-…`). It ships no styles to override.
3. **Accessibility.** Focus trapping and return, `aria-modal`, scroll lock, Escape and outside-click dismissal, `aria-describedby` wiring, tooltips that open on keyboard focus, and a toast viewport with a hotkey and live region. That covers everything the hand-rolled dialogs in `Play.tsx` and `GameActions.tsx` partly re-implement today.
4. **Maintenance.** It shipped 1.7 and 1.8 this month, accepts React 19 as a peer, and shadcn keeps it as a first-class base. Its stewardship has had a quiet period before (after the WorkOS acquisition), so the wrappers below keep Radix behind our own API. If we ever switch to Base UI, which deliberately mirrors Radix's API, we would only change one file.

Why not the others:

- **Base UI** is the strongest alternative and the shadcn default. It costs 1.6 to 1.7 times as much as Radix for the same three primitives (its Tooltip alone is 34 kB gzipped, because it bundles the interactions layer of floating-ui), and we have no need for its extra components. Reconsider it if Radix stalls.
- **React Aria Components** has the best accessibility engineering, but its Toast is still alpha. It also wants its own `Button` and `Link` throughout, which clashes with `ui.tsx`.
- **Ark UI** is good, but larger than Radix with no feature we need on top.
- **Headless UI** has no Tooltip or Toast and releases slowly.
- **shadcn/ui** is a distribution method, not a library. Its theme layer (CSS variables, `cn`, `tailwind-merge`, `cva`) would compete with our `@theme` tokens. We copy its ideas, not its files.

## What to adopt now, and where

The rules: `components/ui.tsx` keeps every existing export and prop and never imports `radix-ui`, so the entry chunk doesn't grow. New overlay primitives live in `components/overlay.tsx`.

**Now (this UI round, files we own):**

1. Add `lucide-react@1.49.0` (exact pin) to `apps/web/package.json`, for:
   - a password visibility toggle (Eye and EyeOff) in `Field` when `type="password"`, with no new required props;
   - the key icon in SignIn's passkey button, replacing the inline `KeyIcon`;
   - icons in the landing value props and in Account card headers.
2. Add `radix-ui@1.6.7` (exact pin) and create `components/overlay.tsx` with:
   - `Dialog`: title, description, body and actions, styled like `Card`;
   - `ConfirmDialog`: an AlertDialog with a confirm and cancel `Button`, and an optional `tone="danger"`;
   - `Tooltip` and `TooltipProvider`: a short delay, a parchment-on-panel bubble with an arrow, and no use on touch-only content;
   - `ToastViewport` and `useToast`: for the match team to adopt later.

   The first consumer in our files is Account's **passkey rename** (today `window.prompt`). It becomes a `Dialog` with a `Field`, in its own small component loaded through `React.lazy` from `Account.tsx`. Account is eagerly loaded, so this keeps Radix out of the entry chunk.
3. **Do not** replace Account's passkey **remove** `window.confirm` in this round. `e2e/tests/attack-mfa.spec.ts` asserts a native `dialog` event (`expect(dialog).toBe(true)`), and that spec belongs to another team. Switching to `ConfirmDialog` needs that assertion changed in the same commit.

**Done in this round (2026-10-16):**

- Installed, exact pins: `radix-ui` 1.6.7, `lucide-react` 1.49.0, and two self-hosted variable fonts, `@fontsource-variable/fraunces` 5.3.0 (display) and `@fontsource-variable/inter` 5.3.0 (body). Only the weight axis is loaded; the browser downloads just the latin subsets it needs (about 37 kB and 48 kB), with `font-display: swap`.
- `components/overlay.tsx`: `Dialog`, `DialogClose`, `ConfirmDialog` (`tone="danger"`), `Tooltip`, `TooltipProvider`, `ToastViewport` and `useToast`. Enter and exit animations are CSS keyframes on `data-state` (`animate-pop-in`, `animate-overlay-in` and friends in `index.css`).
- First consumer: `components/PasskeyRenameDialog.tsx`, loaded with `React.lazy` from Account, replaces the `window.prompt` rename. Passkey removal moved to `ConfirmDialog` in round 3 (below). A dialog opened without a Radix `Trigger` has nothing to return focus to, so `Dialog` takes `returnFocusTo` (a ref to the opening button) and `onClosed` (runs after the exit animation, so the parent can unmount it then).
- `components/ui.tsx` (same exports and props, plus optional additions): `Field` gets a show/hide toggle for `type="password"` and an optional `valid` check mark; `PageTitle` gets an optional `align="center"`; new exports `cx`, `buttonBase`, `buttonSizes`, `buttonVariants`, `linkButtonClass(variant, className, size)` (for router links styled as buttons) and `Pill`. `Button` takes an optional `size` (`'sm'` = `h-9 px-3`, default `'md'` = `h-11 px-5`): use it rather than `h-*`/`px-*` in `className` to make a button smaller, because without a class merger a smaller utility in `className` loses to the size classes by CSS order. Buttons have 150 ms transitions, a 1 px press and a neutral disabled style; `Alert` has an icon.
- Global (`index.css`): `color-scheme: dark`, a gold `::selection`, one focus ring for everything (`:focus-visible`, 2 px gold, 2 px offset, in `@layer base` so `outline-none` utilities still win), a fluid `text-display` / `text-title` scale, balanced headings, `.checkbox` and `.select` restyles of the native controls, and a page background that scrolls with the page instead of `background-attachment: fixed`.
- Measured after the round (`vite build`, 2026-10-16): the entry `index-*.js` is 125.7 kB gzipped. That includes the other team's work in progress and about 25 lucide icons (roughly 7 kB). Radix, PixiJS and the emblem art are not in it: the rename dialog chunk (with Radix Dialog) is 13.8 kB, and the landing demo board chunk is 1.9 kB on top of the PixiJS chunks the match screen already uses.

**Done in round 3 (2026-10-16):**

- These dialogs moved to `overlay.tsx` (focus trap, Escape, focus back on the opening button through `returnFocusTo`): the Play page's private-lobby password prompt (`Dialog`, test ids `join-password` / `join-submit` kept), the resign dialog (`Dialog`, test ids `resign-dialog` / `resign-confirm` kept), "Leave this game?" (`ConfirmDialog`, `leave-dialog` / `leave-confirm`) and passkey removal (`ConfirmDialog` in the lazily loaded `PasskeyRemoveDialog.tsx`, `passkey-remove-dialog` / `passkey-remove-confirm`; `attack-mfa.spec.ts` now checks the in-page dialog). `Dialog` and `ConfirmDialog` take `testId`; `ConfirmDialog` also takes `returnFocusTo`, `onClosed` and `confirmTestId`. The game-over result dialog is still hand-rolled (see Later).
- The Resign and Offer draw hints are `Tooltip`s. A disabled button gets no pointer or focus events, so the wrapper is the trigger and is focusable while the button is disabled; the visible `draw-hint` line stays.
- `CivPicker` (a 3x3 grid with a roving `tabIndex`) was replaced by `CivSelect` on 2026-10-16 (see "Civ dropdown" below).

**Civ dropdown (2026-10-16):**

- The 3x3 civ grid (`CivPicker`, `lib/grid-nav.ts`) is gone: the roster will grow past 100 civs, so civs are chosen from `components/CivSelect.tsx`, a game-style dropdown. Closed, it is a 56 px row (emblem medallion, name, gold chevron; "Choose a civilization" when empty). Open, a Radix `Popover` holds a search box and a scrolling list of 56 px rows (medallion, name, a check on the chosen one), at most 27rem tall and never taller than the space Radix reports, at least 17rem wide, flipping above the trigger when there's no room below. It replaces the Play page's "Play vs bots" grid, the lobby's "Your civilization" grid and the host's native `<select>` for a bot's civ (seat menu, `size="md"`).
- This is the "option needs rich content" case from the Selects rule above, so it uses Radix. It imports `radix-ui`, so the same lazy-only rule as `overlay.tsx` applies: it is used only by the lazy Play page and the lazy match screen.
- Accessibility follows the WAI-ARIA 1.2 combobox pattern: the trigger is a select-only `combobox` button (`aria-haspopup="listbox"`, `aria-expanded`, named by the visible heading plus the current civ); in the popover the search input is an editable `combobox` that points at the highlighted `option` with `aria-activedescendant`, so focus stays in the search box. Down/Up/Home/End or a typed character on the trigger open the list (typing pre-fills the search: typeahead); in the list, arrows (no wrap), Page Up/Down (5 rows), Home and End move the highlight, Enter or a click chooses, Escape and Tab close, and focus returns to the trigger. Matching is case- and accent-insensitive ("eng" or "ÉNG" find England) and highlights the first name, then word, starting with the text; a polite live region announces the match count. Touch devices open on the list rather than the search box, so the on-screen keyboard doesn't cover it.
- The pure parts (folding, filtering, best match, list navigation) are in `lib/civ-select.ts`, unit-tested against a synthetic 120-civ roster. A civ with no emblem art yet shows a monogram in its medallion.
- Test ids: the trigger is `civ-select` (a bot's is `civ-select-<seat>`, e.g. `civ-select-west`) with the chosen slug in `data-value`; the list is `<id>-list`, the search box `<id>-search`, and each row keeps `civ-<slug>`. E2E specs choose a civ with `chooseCiv(page, slug, scope?, testId?)` from `e2e/tests/helpers.ts`; `civ-select.spec.ts` covers the keyboard, phone layout and the bot seat menu.

**Later (other teams' files, once they choose to):**

| Where | Today | Replace with |
|---|---|---|
| `components/match/GameOver.tsx` result dialog (`role="dialog"`, hand-rolled) | Local `useDialogFocus`: manual Tab trap and Escape handling | `Dialog` (keep its test ids and the board-visible layout) |
| `pages/Match.tsx` toasts (`data-testid="toast"`) | Custom list, bottom-left over the board in a game and click-through (`pointer-events-none`) so a toast never blocks a move | `ToastViewport` once it supports that placement and click-through (keep the test id on each toast root) |
| Other `title=` hints ("Draft mode… coming soon", `RankedBadge`, private-lobby lock, lobby card civ emblems) | Native `title`, which keyboard and touch users can't reach | `Tooltip`, plus visible text on touch |

## Constraints the e2e specs impose

Playwright's `getByLabel`, `getByRole(…, { name })` and `getByText` match **substrings** by default, so new copy can break strict mode:

- The password toggle must **not** have an `aria-label` containing "password". `getByLabel('Password')` appears 18 times and would match "Show password". Instead, use a visually hidden `<span>` inside the button ("Show" or "Hide", plus `aria-controls` and `aria-pressed`), because button content is not a label.
- Don't add new labels containing "Email", "Username" or "Password" to the sign-in, sign-up or reset pages.
- The signed-out landing page must have exactly one link named "Play as Guest", one "Sign in" and one "Create account". A repeated call-to-action band at the bottom would break `guest.spec.ts` and `helpers.ts`. The guest landing page keeps "Create account and keep your history".
- A button placed directly under the Turnstile widget can lose a click that lands right after the token arrives if Playwright has just scrolled the page: the widget is a cross-origin iframe, and its hit-test area lags the scroll by a frame. `attack-auth.spec.ts` ("check-email resend") trips over this when the page above the widget grows. The auth cards therefore keep their original height from `sm` up: the brand mark sits on the card's top edge instead of adding a row, and the extra top padding that keeps it clear of the title is offset by moving the card up by the same amount (`AuthCard.tsx`).
- Keep the test ids `signed-in`, `display-name`, `play` and `play-vs-bots` on the landing page (the singleplayer and resign-draw specs click `play-vs-bots` there). Keep `passkey-sign-in`, `keep-guest`, `clickwrap-checkbox`, `oauth-*`, `passkeys`, `add-passkey`, `passkey-row`, `delete-confirm`, `account-name`, `guest-reference` and `reference-code`.

## Measurement

```sh
# scratch dir, outside the repo
npm i react@19.3.1 react-dom@19.3.1 radix-ui@1.6.7 @base-ui/react@1.8.0 \
  react-aria-components@1.21.1 @ark-ui/react@5.39.2 @headlessui/react@2.2.10 \
  sonner@2.0.8 lucide-react@1.49.0 esbuild@0.25.10
# entry e.g.: export { Dialog, Tooltip, Toast } from 'radix-ui'
esbuild entry.js --bundle --minify --format=esm --external:react --external:react-dom \
  --external:react/jsx-runtime --define:process.env.NODE_ENV='"production"' | gzip -9 | wc -c
```

Single primitives, gzipped: Radix Tooltip 19.2 kB, Toast 12.1 kB, AlertDialog 14.1 kB. Base UI Tooltip 34.3 kB, Toast 26.3 kB, AlertDialog 23.4 kB. Shared internals mean that combining primitives costs less than the sum.

Current web build, for reference (`vite build`, 2026-10-16): the entry `index-*.js` is 116.5 kB gzipped, CSS is 8.6 kB, the lazy `CivEmblem` chunk (nine inlined SVGs) is 29.2 kB, `Match` is 145 kB, and the rules wasm is 126 kB gzipped (267 kB raw).

## Sources

- npm registry metadata (versions, release dates, peer ranges), queried 2026-10-16
- shadcn/ui changelog: [Base UI as the Default (July 2026)](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default), [Toast (July 2026)](https://ui.shadcn.com/docs/changelog/2026-07-toast), [React Aria (July 2026)](https://ui.shadcn.com/docs/changelog/2026-07-react-aria), [Unified Radix UI package (Feb 2026)](https://ui.shadcn.com/docs/changelog)
- [React Aria Toast docs](https://react-spectrum.adobe.com/react-aria/Toast.html) (still alpha, `UNSTABLE_` exports)
