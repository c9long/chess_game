import { expect, type Page, test } from '@playwright/test'
import {
  buildPosition,
  clickSquare,
  dragSquare,
  engineBoard,
  expectBoardMatchesEngine,
  load,
  openSandbox,
  promoPicker,
  renderedBoard,
  type Seat,
  sb,
  setPerspective,
  settle,
} from './attack-interaction-helpers.ts'

test.beforeEach(async ({ page }) => {
  await openSandbox(page)
})

const CASTLE_PIECES = {
  g1: 'south king',
  c1: 'south rook',
  j1: 'south rook',
  a7: 'west king',
  a3: 'west rook',
  a10: 'west rook',
  g12: 'north king',
  c12: 'north rook',
  j12: 'north rook',
  l7: 'east king',
  l3: 'east rook',
  l10: 'east rook',
}
const CASTLE_REST = 'S AAAA Sc1,Sj1,Wa3,Wa10,Nc12,Nj12,El3,El10 - 0 0'

async function setTimeScale(page: Page, v: number) {
  await page.evaluate((v) => {
    ;(
      globalThis as unknown as { __sandbox: { view: { timeScale: number } } }
    ).__sandbox.view.timeScale = v
  }, v)
}

const CASTLES: [Seat, string, string, string, string][] = [
  ['south', 'g1', 'i1', 'j1', 'h1'],
  ['west', 'a7', 'a5', 'a3', 'a6'],
  ['north', 'g12', 'e12', 'c12', 'f12'],
  ['east', 'l7', 'l9', 'l10', 'l8'],
]

test('castling (click) for every seat: final state matches engine', async ({ page }) => {
  await load(page, buildPosition('ffa', CASTLE_PIECES, CASTLE_REST))
  await expectBoardMatchesEngine(page, 'castle start')
  for (const [seat, kFrom, kTo, rFrom, rTo] of CASTLES) {
    await setPerspective(page, seat)
    await clickSquare(page, kFrom)
    await clickSquare(page, kTo)
    await settle(page)
    const eng = await engineBoard(page)
    expect(eng.pieces[kTo]).toBe(`${seat} king`)
    expect(eng.pieces[rTo]).toBe(`${seat} rook`)
    expect(eng.pieces[rFrom]).toBeUndefined()
    await expectBoardMatchesEngine(page, `${seat} castle`)
  }
})

async function sampleMotion(page: Page, squares: { kFrom: string; rFrom: string; kTo: string }) {
  // Sample while the step is slowed down (the rook takes off halfway through the
  // leader's move); record where the king and rook are drawn.
  const samples: { king: string; kingOff: number; kingLayer: string; rook: string[] }[] = []
  for (let i = 0; i < 16; i++) {
    const ren = await renderedBoard(page)
    const king = ren.find((r) => r.kind === 'king' && r.variant === 'south')
    const rooks = ren.filter((r) => r.kind === 'rook' && r.variant === 'south')
    samples.push({
      king: king?.square ?? '-',
      kingOff: king?.off ?? -1,
      kingLayer: king?.layer ?? '-',
      rook: rooks.map((r) => `${r.square}@${r.off.toFixed(2)}/${r.layer}`),
    })
    await page.waitForTimeout(250)
  }
  void squares
  return samples
}

test('castling via API animates both king and rook', async ({ page }) => {
  await load(page, buildPosition('ffa', CASTLE_PIECES, CASTLE_REST))
  await setTimeScale(page, 0.05)
  await sb(page, 'play', 'g1i1')
  const samples = await sampleMotion(page, { kFrom: 'g1', rFrom: 'j1', kTo: 'i1' })
  await setTimeScale(page, 1)
  console.log('API castle samples', JSON.stringify(samples))
  expect(samples.some((s) => s.kingLayer === 'moving' && s.kingOff > 0.2)).toBe(true)
  expect(
    samples.some((s) => s.rook.some((r) => r.includes('/moving') && !r.includes('@0.00'))),
  ).toBe(true)
  await expectBoardMatchesEngine(page, 'after API castle')
})

test('castling via click-to-move animates the king (does not teleport)', async ({ page }) => {
  await load(page, buildPosition('ffa', CASTLE_PIECES, CASTLE_REST))
  await setTimeScale(page, 0.05)
  await clickSquare(page, 'g1')
  await clickSquare(page, 'i1')
  const samples = await sampleMotion(page, { kFrom: 'g1', rFrom: 'j1', kTo: 'i1' })
  await setTimeScale(page, 1)
  console.log('click castle samples', JSON.stringify(samples))
  // While slowed 20x the 180 ms king slide takes 3.6 s: the king must be seen between squares.
  expect(
    samples.some((s) => s.kingOff > 0.2),
    'king never seen mid-slide',
  ).toBe(true)
  await expectBoardMatchesEngine(page, 'after click castle')
})

test('plain click-to-move pawn is animated (does not teleport)', async ({ page }) => {
  await setTimeScale(page, 0.05)
  await clickSquare(page, 'e2')
  await clickSquare(page, 'e4')
  const offs: number[] = []
  for (let i = 0; i < 6; i++) {
    const ren = await renderedBoard(page)
    const moved = ren.filter((r) => r.kind === 'pawn' && r.variant === 'south' && r.off > 0.02)
    offs.push(moved.length ? Math.max(...moved.map((m) => m.off)) : 0)
    await page.waitForTimeout(250)
  }
  await setTimeScale(page, 1)
  console.log('click e2e4 off-centre samples', offs)
  expect(
    offs.some((o) => o > 0.2),
    'pawn never seen between e2 and e4',
  ).toBe(true)
})

test('en passant removes the double-stepped pawn (South pawn, West captures)', async ({ page }) => {
  const pos = buildPosition(
    'ffa',
    {
      g1: 'south king',
      e2: 'south pawn',
      f2: 'south pawn',
      a7: 'west king',
      d4: 'west pawn',
      g12: 'north king',
      l7: 'east king',
      h5: 'east pawn',
    },
    'S AAAA - - 0 0',
  )
  await load(page, pos)
  await setPerspective(page, 'south')
  await dragSquare(page, 'e2', 'e4')
  await settle(page)
  await setPerspective(page, 'west')
  const legal = await sb<string[]>(page, 'legal')
  expect(legal).toContain('d4e3')
  await dragSquare(page, 'd4', 'e3')
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.pieces.e4).toBeUndefined()
  expect(eng.pieces.e3).toBe('west pawn')
  expect(eng.pieces.h5).toBe('east pawn')
  expect(eng.pieces.f2).toBe('south pawn')
  await expectBoardMatchesEngine(page, 'after en passant')
})

test('en passant: North double-step, East captures', async ({ page }) => {
  const pos = buildPosition(
    'ffa',
    {
      g1: 'south king',
      a7: 'west king',
      g12: 'north king',
      h11: 'north pawn',
      l7: 'east king',
      i9: 'east pawn',
      e9: 'south rook',
    },
    'N AAAA - - 0 0',
  )
  await load(page, pos)
  await setPerspective(page, 'north')
  await clickSquare(page, 'h11')
  await clickSquare(page, 'h9')
  await settle(page)
  await setPerspective(page, 'east')
  const legal = await sb<string[]>(page, 'legal')
  expect(legal).toContain('i9h10')
  await clickSquare(page, 'i9')
  await clickSquare(page, 'h10')
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.pieces.h9).toBeUndefined()
  expect(eng.pieces.h10).toBe('east pawn')
  expect(eng.pieces.e9).toBe('south rook')
  await expectBoardMatchesEngine(page, 'after N/E en passant')
})

test('en passant that also promotes (East g9xf10 e.p. onto file f)', async ({ page }) => {
  const pos = buildPosition(
    'ffa',
    {
      g1: 'south king',
      a7: 'west king',
      g12: 'north king',
      f11: 'north pawn',
      l7: 'east king',
      g9: 'east pawn',
    },
    'N AAAA - - 0 0',
  )
  await load(page, pos)
  await sb(page, 'play', 'f11f9')
  await settle(page)
  await setPerspective(page, 'east')
  await clickSquare(page, 'g9')
  await clickSquare(page, 'f10')
  await settle(page)
  const picker = await promoPicker(page)
  expect(picker?.map((t) => t.kind).sort()).toEqual(['bishop', 'knight', 'queen', 'rook'])
  const r = picker?.find((t) => t.kind === 'rook')
  await page.mouse.click(r?.x ?? 0, r?.y ?? 0)
  await settle(page)
  const eng = await engineBoard(page)
  expect(eng.pieces.f9).toBeUndefined()
  expect(eng.pieces.f10).toBe('east rook')
  await expectBoardMatchesEngine(page, 'ep promotion')
})

const PROMOS: { seat: Seat; from: string; to: string; toMove: string }[] = [
  { seat: 'south', from: 'f6', to: 'f7', toMove: 'S' },
  { seat: 'west', from: 'f5', to: 'g5', toMove: 'W' },
  { seat: 'north', from: 'h7', to: 'h6', toMove: 'N' },
  { seat: 'east', from: 'g8', to: 'f8', toMove: 'E' },
]
const CHOOSE = ['knight', 'bishop', 'rook', 'queen']

for (const [i, p] of PROMOS.entries()) {
  test(`promotion picker for ${p.seat}: roster choices and applies the chosen piece`, async ({
    page,
  }) => {
    const pieces: Record<string, string> = {
      g1: 'south king',
      a7: 'west king',
      g12: 'north king',
      l7: 'east king',
      [p.from]: `${p.seat} pawn`,
    }
    await load(page, buildPosition('ffa', pieces, `${p.toMove} AAAA - - 0 0`))
    await setPerspective(page, p.seat)
    const legal = await sb<string[]>(page, 'legal')
    const engineChoices = legal.filter((m) => m.startsWith(`${p.from}${p.to}`))
    await clickSquare(page, p.from)
    await clickSquare(page, p.to)
    await settle(page)
    const picker = await promoPicker(page)
    expect(picker, 'picker did not open').not.toBeNull()
    const kinds = (picker ?? []).map((t) => t.kind)
    console.log(p.seat, 'engine', engineChoices, 'picker', kinds)
    expect(kinds.length).toBe(engineChoices.length)
    expect(new Set(kinds)).toEqual(new Set(['queen', 'rook', 'bishop', 'knight']))
    expect((picker ?? []).every((t) => t.variant === p.seat)).toBe(true)
    await page.screenshot({
      path: `/tmp/claude-1000/-home-c9long-chess-game/bb6dac1d-5690-4e27-9699-e9c91353b39a/scratchpad/m2/attack-int-promo-${p.seat}.png`,
    })
    const choose = CHOOSE[i] as string
    const tile = (picker ?? []).find((t) => t.kind === choose)
    expect(tile).toBeTruthy()
    await page.mouse.click(tile?.x ?? 0, tile?.y ?? 0)
    await settle(page)
    const eng = await engineBoard(page)
    expect(eng.pieces[p.to]).toBe(`${p.seat} ${choose}`)
    expect(await promoPicker(page)).toBeNull()
    await expectBoardMatchesEngine(page, `${p.seat} promoted`)
  })
}

test('promotion picker: Escape cancels and the pawn returns', async ({ page }) => {
  await load(
    page,
    buildPosition(
      'ffa',
      { g1: 'south king', a7: 'west king', g12: 'north king', l7: 'east king', f6: 'south pawn' },
      'S AAAA - - 0 0',
    ),
  )
  await dragSquare(page, 'f6', 'f7')
  await settle(page)
  expect(await promoPicker(page)).not.toBeNull()
  await page.keyboard.press('Escape')
  await settle(page)
  expect(await promoPicker(page)).toBeNull()
  expect((await engineBoard(page)).pieces.f6).toBe('south pawn')
  await expectBoardMatchesEngine(page, 'promo cancelled')
})

test('promotion by capture onto the promotion line (South f6xg7)', async ({ page }) => {
  await load(
    page,
    buildPosition(
      'ffa',
      {
        g1: 'south king',
        a7: 'west king',
        g12: 'north king',
        l7: 'east king',
        f6: 'south pawn',
        g7: 'north knight',
      },
      'S AAAA - - 0 0',
    ),
  )
  await clickSquare(page, 'f6')
  await clickSquare(page, 'g7')
  await settle(page)
  const picker = await promoPicker(page)
  expect(picker?.length).toBe(4)
  const q = picker?.find((t) => t.kind === 'queen')
  await page.mouse.click(q?.x ?? 0, q?.y ?? 0)
  await settle(page)
  expect((await engineBoard(page)).pieces.g7).toBe('south queen')
  await expectBoardMatchesEngine(page, 'capture-promotion')
})

test('undo after castle / en passant / promotion re-renders the engine position', async ({
  page,
}) => {
  await load(page, buildPosition('ffa', CASTLE_PIECES, CASTLE_REST))
  await sb(page, 'play', 'g1i1')
  await settle(page)
  await page.getByRole('button', { name: 'Undo' }).click()
  await settle(page)
  await expectBoardMatchesEngine(page, 'undo castle')
  await sb(page, 'play', 'g1e1')
  await sb(page, 'play', 'a7a9')
  await settle(page)
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await settle(page)
  await expectBoardMatchesEngine(page, 'undo two castles')
})
