import { Game, initRules, type MoveView, type Seat } from '@game/rules'
import { type Browser, expect, type Page, test } from '@playwright/test'
import {
  type BoardHook,
  chooseCiv,
  playMove,
  position,
  startAsGuest,
  YOUR_TURN,
} from './helpers.ts'

/**
 * The check indicator (docs/RULES.md "Check indicators"): only for the viewer's own seat,
 * shown when their turn starts with their leader under attack ("Check! Your leader is under
 * attack" in the turn banner) and right after their own move leaves their leader attacked
 * ("Your leader is in check", until it is no longer attacked). Moves are never prevented.
 * The board marks the leader's square(s); the dev-only hook reports which.
 */

const CHECK_TEXT = 'Check! Your leader is under attack'
const SHOTS = process.env.E2E_SCREENSHOTS

const checkSquares = (page: Page) =>
  page.evaluate(() => (window as unknown as { __board: BoardHook }).__board.checkSquares())

test.beforeAll(async () => {
  await initRules()
})

/** Engine view of the position the page's board shows. */
async function engineAt(page: Page): Promise<Game> {
  return Game.fromPosition(await position(page))
}

async function expectNoIndicator(page: Page) {
  await expect(page.getByTestId('self-check-notice')).toHaveCount(0)
  await expect(page.getByTestId('turn-banner')).not.toHaveAttribute('data-check', 'true')
  await expect.poll(() => checkSquares(page)).toEqual([])
}

/**
 * A move for `seat` (to move in `game`) that leaves its own leader under attack, preferring
 * one the very next seat can't punish at once (so the notice stays up a little longer).
 */
function selfCheckMove(game: Game, seat: Seat): MoveView | null {
  let fallback: MoveView | null = null
  // No promotions: the board would ask which piece.
  for (const m of game.legalMoves().filter((x) => x.promotion === null)) {
    const g = game.clone()
    try {
      g.applyMove(m.notation)
      if (g.snapshot().isOver || !g.leaderUnderAttack(seat)) continue
      const leaders = new Set<string>(g.leaderSquares(seat))
      if (g.legalMoves().some((r) => leaders.has(r.to))) fallback ??= m
      else return m
    } finally {
      g.free()
    }
  }
  return fallback
}

/** A move that keeps `seat`'s leader safe, taking the king's walk east when it can. */
function safeMove(game: Game, seat: Seat, preferred: readonly string[]): MoveView {
  const safe = game.legalMoves().filter((m) => {
    if (m.promotion !== null) return false
    const g = game.clone()
    try {
      g.applyMove(m.notation)
      return !g.snapshot().isOver && !g.leaderUnderAttack(seat)
    } finally {
      g.free()
    }
  })
  const pick = safe.find((m) => preferred.includes(m.notation)) ?? safe[0]
  if (!pick) throw new Error('no safe move')
  return pick
}

test('singleplayer: self-check is allowed and shows the check indicator', async ({ page }) => {
  test.setTimeout(150_000)
  await startAsGuest(page)
  await page.getByTestId('play-vs-bots').click()
  const panel = page.getByTestId('vs-bots')
  await chooseCiv(page, 'mali', panel)
  await panel.getByTestId('start-solo').click()
  await expect(page.getByTestId('board')).toBeVisible({ timeout: 20_000 })

  // South walks its leader toward East's pawns and knights (j2j4, i1j2, j2k3, k3l4, l4m4),
  // then steps into an attack as soon as the engine offers a move that does. The bots play as
  // they like in between, so every turn checks what the engine says first.
  const walk = ['j2j4', 'i1j2', 'j2k3', 'k3l4', 'l4m4']
  let selfChecked = false
  for (let turn = 0; turn < 12 && !selfChecked; turn++) {
    await expect(page.getByTestId('turn-banner')).toHaveText(YOUR_TURN, { timeout: 30_000 })
    const game = await engineAt(page)
    try {
      const snap = game.snapshot()
      if (snap.leaderUnderAttack[0]) {
        // A bot gave check: shown as the turn starts, on the leader's square.
        await expect(page.getByTestId('turn-banner')).toHaveText(CHECK_TEXT)
        await expect.poll(() => checkSquares(page)).toEqual(snap.leaderSquares[0])
      } else {
        await expect(page.getByTestId('turn-banner')).toHaveText('Your move')
        await expectNoIndicator(page)
      }
      const bad = selfCheckMove(game, 'south')
      if (bad) {
        // The move is not blocked or warned about: it simply goes through.
        await playMove(page, bad.from, bad.to)
        selfChecked = true
        const after = await engineAt(page)
        const leader = after.leaderSquares('south')
        expect(after.leaderUnderAttack('south')).toBe(true)
        after.free()
        // Right after the move: the notice, and the leader's square marked on the board.
        await expect(page.getByTestId('self-check-notice')).toHaveText('Your leader is in check')
        await expect.poll(() => checkSquares(page)).toEqual(leader)
        await expect(page.getByTestId('turn-banner')).not.toHaveText(YOUR_TURN)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/check-self.png` })
      } else {
        const mv = safeMove(game, 'south', walk)
        await playMove(page, mv.from, mv.to)
      }
    } finally {
      game.free()
    }
  }
  expect(selfChecked, 'found a self-check move within 12 turns').toBe(true)

  // It stays until the leader is no longer attacked. Then either a bot took it (the game
  // ends and the indicator goes with it), a bot blocked or chased off the attacker (South's
  // turn, no indicator), or South's turn comes round still attacked (banner check).
  const banner = page.getByTestId('turn-banner')
  await expect(banner).toHaveText(/^(Game over|Your move|Check! Your leader is under attack)$/, {
    timeout: 30_000,
  })
  const text = await banner.textContent()
  if (text === 'Game over') {
    await expectNoIndicator(page)
  } else {
    const game = await engineAt(page)
    const attacked = game.leaderUnderAttack('south')
    const leader = game.leaderSquares('south')
    game.free()
    expect(text).toBe(attacked ? CHECK_TEXT : 'Your move')
    await expect(page.getByTestId('self-check-notice')).toHaveCount(0)
    await expect.poll(() => checkSquares(page)).toEqual(attacked ? leader : [])
  }
})

async function guestPages(browser: Browser, n: number): Promise<Page[]> {
  const pages: Page[] = []
  for (let i = 0; i < n; i++) {
    const page = await (await browser.newContext()).newPage()
    await startAsGuest(page)
    pages.push(page)
  }
  return pages
}

test('check indicators are only for the viewer, from their turn or after their own move', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  // Four people, so every move is scripted: bots could give check (or open and close the
  // lines this test relies on) at random. West and North (who move between South and East)
  // only push far-away pawns, which never attack or shield a leader.
  const [south, west, north, east] = (await guestPages(browser, 4)) as [Page, Page, Page, Page]
  await south.goto('/play')
  await south.getByTestId('lobby-name').fill('Check table')
  await south.getByTestId('create-lobby').click()
  await expect(south.getByRole('heading', { name: 'Check table' })).toBeVisible()
  // Each joins the first free seat in seat order: West, North, then East.
  for (const [seat, p] of [
    ['west', west],
    ['north', north],
    ['east', east],
  ] as const) {
    await p.goto(south.url())
    await expect(p.getByRole('heading', { name: 'Check table' })).toBeVisible()
    await expect(south.getByTestId(`seat-${seat}`).getByTestId('seat-name')).toHaveText(
      /^Guest-\d{4}$/,
    )
  }
  const everyone = [south, west, north, east]
  for (const [i, p] of everyone.entries()) {
    await chooseCiv(p, ['mali', 'france', 'japan', 'china'][i] as string)
    await p.getByTestId('ready').click()
  }
  await south.getByTestId('start-game').click()
  for (const p of everyone) await expect(p.getByTestId('board')).toBeVisible()

  /** West and North take their turns (no leader is attacked before or after). */
  async function quietRound(westMove: [string, string], northMove: [string, string]) {
    for (const [p, [from, to]] of [
      [west, westMove],
      [north, northMove],
    ] as const) {
      await expect(p.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
      await expectNoIndicator(p)
      await playMove(p, from, to)
    }
  }

  // Round 1: South opens j2 (the p8-i1 diagonal is still closed by East's o7 pawn); East then
  // moves that pawn, so East's queen on p8 attacks South's leader on i1 as South's turn starts.
  await expect(south.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await playMove(south, 'j2', 'j4')
  await quietRound(['b12', 'c12'], ['e15', 'e14'])
  await expect(east.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await playMove(east, 'o7', 'n7')

  // (a) Someone else put South in check: South's banner says so and i1 is marked. East (the
  // attacker) and the other players see no check indicator at all.
  await expect(south.getByTestId('turn-banner')).toHaveText(CHECK_TEXT)
  await expect(south.getByTestId('turn-banner')).toHaveAttribute('data-check', 'true')
  await expect.poll(() => checkSquares(south)).toEqual(['i1'])
  await expect(south.getByTestId('self-check-notice')).toHaveCount(0)
  for (const p of [east, west, north]) await expectNoIndicator(p)
  if (SHOTS) {
    await south.waitForTimeout(500)
    await south.screenshot({ path: `${SHOTS}/check-turn.png` })
  }

  // (b) South ignores it (allowed: nothing stops the move): a self-check, so South now sees
  // "Your leader is in check" while the others move; still nothing for East.
  await playMove(south, 'e2', 'e3')
  await expect(south.getByTestId('self-check-notice')).toHaveText('Your leader is in check')
  await expect(south.getByTestId('turn-banner')).not.toHaveAttribute('data-check', 'true')
  await expect.poll(() => checkSquares(south)).toEqual(['i1'])
  await expectNoIndicator(east)
  // The live region announces the self-check (the visual pill is aria-hidden).
  await expect(south.getByTestId('check-announcer')).toHaveText('Your leader is in check')
  if (SHOTS) {
    await south.screenshot({ path: `${SHOTS}/check-self-desktop.png` })
    await south.setViewportSize({ width: 390, height: 844 })
    await south.waitForTimeout(300)
    await south.screenshot({ path: `${SHOTS}/check-self-phone.png`, fullPage: true })
    await south.setViewportSize({ width: 1280, height: 720 })
  }

  // The notice stays while the others move and the leader is still attacked.
  await quietRound(['b11', 'c11'], ['f15', 'f14'])
  await expect(south.getByTestId('self-check-notice')).toHaveText('Your leader is in check')

  // East leaves the leader be; South's turn comes round with it still attacked: banner check.
  await expect(east.getByTestId('turn-banner')).toHaveText('Your move', { timeout: 20_000 })
  await expectNoIndicator(east)
  await playMove(east, 'o5', 'n5')
  await expect(south.getByTestId('turn-banner')).toHaveText(CHECK_TEXT)
  await expect(south.getByTestId('self-check-notice')).toHaveCount(0)
  await expect.poll(() => checkSquares(south)).toEqual(['i1'])

  // South blocks on k3: the leader is safe and every indicator goes away. Nobody else ever
  // saw one.
  await playMove(south, 'k2', 'k3')
  for (const p of everyone) await expectNoIndicator(p)
})
