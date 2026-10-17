import { expect, type Page, test } from '@playwright/test'
import {
  buildPosition,
  clickSquare,
  engineBoard,
  expectBoardMatchesEngine,
  load,
  openSandbox,
  renderedBoard,
  sb,
  seatToMove,
  settle,
  turnIndicator,
} from './attack-interaction-helpers.ts'

const SHOT =
  '/tmp/claude-1000/-home-c9long-chess-game/bb6dac1d-5690-4e27-9699-e9c91353b39a/scratchpad/m2'

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

async function expectTurn(page: Page, label: string) {
  await settle(page)
  const eng = await engineBoard(page)
  const ind = await turnIndicator(page)
  expect(ind, `turn indicator ${label}`).toBe(eng.isOver ? null : eng.seatToMove)
  const rows = page.locator('.seat.to-move .name')
  if (eng.isOver) expect(await rows.count(), `panel ${label}`).toBe(0)
  else {
    expect(await rows.count(), `panel ${label}`).toBe(1)
    const panel = await rows.first().textContent()
    expect(panel?.toLowerCase().startsWith(eng.seatToMove), `panel ${label}`).toBe(true)
  }
}

test('FFA timeout: army removed (dissolves), turn skips the seat', async ({ page }) => {
  await sb(page, 'newGame', 'ffa')
  await settle(page)
  await expectTurn(page, 'start')
  // West abandons while South is to move (timeout is only legal for the seat to move).
  await sb(page, 'abandon', 'west')
  await page.waitForTimeout(400)
  const mid = await renderedBoard(page)
  console.log('dissolving west pieces mid-way:', mid.filter((r) => r.layer === 'dissolve').length)
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.statuses).toEqual(['active', 'removed', 'active', 'active'])
  expect(Object.values(eng.pieces).some((p) => p.startsWith('west'))).toBe(false)
  await expectBoardMatchesEngine(page, 'west removed')
  await expectTurn(page, 'after west timeout (S still to move)')
  await sb(page, 'play', 'e2e4')
  expect(await seatToMove(page)).toBe('north')
  await expectTurn(page, 'west skipped -> north')
  await sb(page, 'timeout', 'north')
  await settle(page)
  expect(await seatToMove(page)).toBe('east')
  await expectTurn(page, 'north timed out on its own turn -> east')
  await expectBoardMatchesEngine(page, 'north removed by timeout')
  await page.screenshot({ path: `${SHOT}/attack-int-ffa-removed.png` })
})

test('Teams timeout and abandon: armies frozen grey, turns skip, pieces stay', async ({ page }) => {
  await sb(page, 'newGame', 'teams')
  await settle(page)
  await sb(page, 'abandon', 'west')
  await settle(page)
  let eng = await engineBoard(page)
  expect(eng.statuses).toEqual(['active', 'frozen', 'active', 'active'])
  expect(Object.values(eng.pieces).filter((p) => p.startsWith('west')).length).toBe(16)
  await expectBoardMatchesEngine(page, 'west frozen')
  await expectTurn(page, 'S to move after W frozen')
  await sb(page, 'play', 'e2e4')
  await expectTurn(page, 'W skipped -> N')
  expect(await seatToMove(page)).toBe('north')
  await sb(page, 'play', 'e11e9')
  await expectTurn(page, 'N -> E')
  // East abandons on its own turn: frozen; team West+East has no active seat -> game over.
  await sb(page, 'timeout', 'east')
  await settle(page)
  eng = await engineBoard(page)
  console.log('after east timeout', eng.statuses, 'over', eng.isOver)
  await expectBoardMatchesEngine(page, 'east abandon')
  await expectTurn(page, 'after east abandon')
  await page.screenshot({ path: `${SHOT}/attack-int-teams-end.png` })
})

test('Teams: freeze of the seat to move mid-turn, then partner keeps playing', async ({ page }) => {
  await sb(page, 'newGame', 'teams')
  await settle(page)
  await sb(page, 'play', 'e2e4')
  // West to move; West times out on its own turn.
  await sb(page, 'timeout', 'west')
  await settle(page)
  expect(await seatToMove(page)).toBe('north')
  await expectTurn(page, 'W frozen on own turn -> N')
  await expectBoardMatchesEngine(page, 'W frozen on own turn')
  // Clicking a frozen West piece does nothing.
  const before = await sb<string>(page, 'position')
  await clickSquare(page, 'b5')
  await clickSquare(page, 'd5')
  expect(await sb<string>(page, 'position')).toBe(before)
  // Abandon of South while North to move: South frozen, N then E then (S,W skipped) N.
  await sb(page, 'abandon', 'south')
  await settle(page)
  const eng = await engineBoard(page)
  console.log('after S abandon', eng.statuses, eng.isOver)
  await expectBoardMatchesEngine(page, 'S frozen too')
  await expectTurn(page, 'after S abandon')
})

test('Teams defeated seat (king captured) keeps its pieces and keeps taking turns', async ({
  page,
}) => {
  // West king exposed to South queen; South captures it.
  const pos = buildPosition(
    'teams',
    {
      i1: 'south king',
      a9: 'west king',
      a5: 'west rook',
      b8: 'west pawn',
      i16: 'north king',
      p9: 'east king',
      h9: 'south queen',
    },
    'S AAAA - - 0 0',
  )
  await load(page, pos)
  await sb(page, 'play', 'h9a9')
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.statuses[1]).toBe('defeated')
  await expectBoardMatchesEngine(page, 'west defeated (teams)')
  await expectTurn(page, 'after west king captured')
})

test('FFA king capture: army dissolves, next seat to move indicated', async ({ page }) => {
  const pos = buildPosition(
    'ffa',
    {
      i1: 'south king',
      a9: 'west king',
      a5: 'west rook',
      b8: 'west pawn',
      i16: 'north king',
      p9: 'east king',
      h9: 'south queen',
    },
    'S AAAA - - 0 0',
  )
  await load(page, pos)
  await sb(page, 'play', 'h9a9')
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.statuses[1]).toBe('removed')
  await expectBoardMatchesEngine(page, 'west removed by capture')
  await expectTurn(page, 'W removed -> N')
})

test('Game over hides the turn indicator', async ({ page }) => {
  await sb(page, 'newGame', 'ffa')
  await sb(page, 'abandon', 'west')
  await sb(page, 'abandon', 'north')
  await sb(page, 'abandon', 'east')
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.isOver).toBe(true)
  await expectBoardMatchesEngine(page, 'ffa over')
  expect(await turnIndicator(page)).toBeNull()
})

test('turn indicator follows the engine across a whole random game (FFA and Teams)', async ({
  page,
}) => {
  for (const mode of ['ffa', 'teams'] as const) {
    await sb(page, 'newGame', mode)
    await settle(page)
    let seed = mode === 'ffa' ? 7 : 11
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let i = 0; i < 30; i++) {
      const eng = await engineBoard(page)
      if (eng.isOver) break
      const r = rnd()
      if (i === 9) await sb(page, 'abandon', 'west')
      else if (i === 17) await sb(page, 'timeout', eng.seatToMove)
      else {
        const legal = await sb<string[]>(page, 'legal')
        // Prefer captures so seats get eliminated.
        const caps = legal.filter((m) => {
          // Squares are a1..p16: the destination is the second square in the move.
          const to = m.match(/^[a-p]\d{1,2}([a-p]\d{1,2})/)?.[1]
          return !!to && !!eng.pieces[to]
        })
        const pool = caps.length && r < 0.7 ? caps : legal
        await sb(page, 'play', pool[Math.floor(rnd() * pool.length)])
      }
      if (i % 4 === 0) {
        await expectTurn(page, `${mode} step ${i}`)
        await expectBoardMatchesEngine(page, `${mode} step ${i}`)
      }
    }
    await expectTurn(page, `${mode} end`)
    await expectBoardMatchesEngine(page, `${mode} end`)
  }
})
