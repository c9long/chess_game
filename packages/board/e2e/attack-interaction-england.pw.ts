import { expect, test } from '@playwright/test'
import {
  buildPosition,
  engineBoard,
  expectBoardMatchesEngine,
  load,
  openSandbox,
  renderedBoard,
  sb,
  settle,
} from './attack-interaction-helpers.ts'

// England (civ version 2): four Prime Ministers replace the king, queen and knights.

const ENGLAND_SOUTH = 'civ=england.2,canada.1,canada.1,canada.1'

test.beforeEach(async ({ page }) => {
  await openSandbox(page, { reducedMotion: true })
})

test('an England seat renders its Prime Ministers on the K, Q and N squares', async ({ page }) => {
  await sb(page, 'setCiv', 'south', 'england')
  await settle(page)
  const eng = await engineBoard(page)
  for (const sq of ['f1', 'h1', 'i1', 'k1']) expect(eng.pieces[sq]).toBe('south prime_minister')
  const ren = await renderedBoard(page)
  const pms = ren.filter((p) => p.kind === 'prime_minister').map((p) => `${p.variant} ${p.square}`)
  expect(pms.sort()).toEqual(['south f1', 'south h1', 'south i1', 'south k1'])
  await expectBoardMatchesEngine(page, 'england start')
  // A Prime Minister moves (knight leap) and is drawn on its new square.
  await sb(page, 'play', 'f1e3')
  await settle(page)
  await expectBoardMatchesEngine(page, 'after f1e3')
})

test('the check ring marks only the attacked Prime Minister', async ({ page }) => {
  // West's rook on m3 attacks the Prime Minister on c3; f1 and k1 are safe. South to move.
  const pos = buildPosition(
    'ffa',
    {
      c3: 'south prime_minister',
      f1: 'south prime_minister',
      k1: 'south prime_minister',
      m3: 'west rook',
      a16: 'west king',
      p16: 'north king',
      p1: 'east king',
    },
    `S AAAA - - 0 0 ${ENGLAND_SOUTH}`,
  )
  await load(page, pos)
  const glows = async () =>
    page.evaluate(() => {
      type N = { children: N[]; visible: boolean; label?: string; x: number; y: number }
      const g = globalThis as unknown as {
        __pixiApp: { stage: N }
        __sandbox: { view: { squareToClient(s: string): { x: number; y: number } | null } }
      }
      const root = g.__pixiApp.stage.children[0] as N
      return root.children.filter((c) => c.label?.startsWith('leaderGlow') && c.visible).length
    })
  const snap = await page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __sandbox: {
            snapshot: { attackedLeaderSquares: string[][]; leaderUnderAttack: boolean[] }
          }
        }
      ).__sandbox.snapshot,
  )
  expect(snap.leaderUnderAttack[0]).toBe(true)
  expect(snap.attackedLeaderSquares[0]).toEqual(['c3'])
  expect(await glows()).toBe(1)
  // Move the attacked one out of the line: no check left.
  await sb(page, 'play', 'c3c4')
  await settle(page)
  expect(await glows()).toBe(0)
})
