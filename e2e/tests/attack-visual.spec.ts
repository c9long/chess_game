import { expect, type Page, test } from '@playwright/test'
import { passAgeScreen, signUpAndVerify } from './helpers.ts'

const OUT =
  process.env.SHOT_DIR ??
  '/tmp/claude-1000/-home-c9long-chess-game/bb6dac1d-5690-4e27-9699-e9c91353b39a/scratchpad/shots'
const log = (...a: unknown[]) => console.log('[attack-visual]', ...a)

const sizes = [
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 },
]

async function shoot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
}

for (const { w, h } of sizes) {
  test(`screens at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    const tag = `${w}`
    await page.goto('/')
    await expect(page.getByTestId('dob-form')).toBeVisible()
    await shoot(page, `${tag}-01-dob`)
    await page.getByTestId('dob-month').selectOption('2')
    await page.getByTestId('dob-day').selectOption('31')
    await page.getByTestId('dob-year').fill('2000')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await shoot(page, `${tag}-02-dob-error`)
    await passAgeScreen(page)
    await shoot(page, `${tag}-03-landing`)
    await page.goto('/sign-in')
    await page.waitForTimeout(1500)
    await shoot(page, `${tag}-04-sign-in`)
    await page.goto('/sign-up')
    await page.getByLabel('Username').fill('x!')
    await page.getByLabel('Password').fill('short')
    await page.waitForTimeout(1500)
    await shoot(page, `${tag}-05-sign-up-errors`, true)
    await page.goto('/guest')
    await page.waitForTimeout(1500)
    await shoot(page, `${tag}-06-guest`)
    await page.goto('/forgot-password')
    await shoot(page, `${tag}-07-forgot`)
    await page.goto('/reset-password?token=abc')
    await shoot(page, `${tag}-08-reset`)
    await page.goto('/terms')
    await shoot(page, `${tag}-09-terms`)
    await page.goto('/nope')
    await shoot(page, `${tag}-10-404`)
    await page.goto('/verify-email?token=bad')
    await page.waitForTimeout(800)
    await shoot(page, `${tag}-11-verify-bad`)
    await page.goto('/two-factor')
    await shoot(page, `${tag}-12-two-factor`)

    await page.context().clearCookies()
    const creds = await signUpAndVerify(page)
    await shoot(page, `${tag}-13-landing-signed-in`)
    await page.getByTestId('nav-account').click()
    const tf = page.getByTestId('two-factor')
    await tf.getByTestId('two-factor-password').fill(creds.password)
    await tf.getByTestId('two-factor-start').click()
    await expect(tf.getByTestId('totp-secret')).toBeVisible()
    await shoot(page, `${tag}-14-account-2fa-setup`, true)
    await page.goto('/device')
    await shoot(page, `${tag}-15-device`)
  })
}

test('mobile 390 width overflow check', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await passAgeScreen(page)
  for (const p of ['/', '/sign-in', '/sign-up', '/guest', '/terms', '/privacy']) {
    await page.goto(p)
    await page.waitForTimeout(800)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    log('overflow at 390', p, overflow)
    await shoot(page, `390-${p.replace(/\//g, '_') || 'root'}`)
  }
})

test('keyboard: tab order and visible focus on sign-up, sign-in, landing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await passAgeScreen(page)
  for (const p of ['/', '/sign-in', '/sign-up']) {
    await page.goto(p)
    await page.waitForTimeout(1500)
    const rows: string[] = []
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const cs = getComputedStyle(el)
        const name =
          el.getAttribute('aria-label') ||
          (el as HTMLInputElement).labels?.[0]?.textContent?.trim().slice(0, 25) ||
          el.textContent?.trim().slice(0, 25) ||
          el.tagName
        const ring =
          (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px'
            ? `outline ${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`
            : '') + (cs.boxShadow !== 'none' ? ` shadow ${cs.boxShadow.slice(0, 60)}` : '')
        return `${el.tagName} "${name}" focus-style: ${ring || 'NONE'}`
      })
      if (info) rows.push(info)
      if (i === 3 || i === 7) await shoot(page, `focus${p.replace(/\//g, '_')}-${i}`)
    }
    log(`tab order ${p}:`, rows)
  }
})

test('focus ring close-ups: primary button, footer link, clickwrap checkbox', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await passAgeScreen(page)
  await page.goto('/')
  const targets = [
    page.getByRole('link', { name: 'Play as Guest' }),
    page.getByRole('contentinfo').getByRole('link', { name: 'Terms of Service' }),
  ]
  for (const [i, t] of targets.entries()) {
    await t.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const box = await t.boundingBox()
    if (box)
      await page.screenshot({
        path: `${OUT}/ring-${i}.png`,
        clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 },
      })
  }
  await page.goto('/guest')
  const cb = page.getByTestId('clickwrap-checkbox')
  await cb.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const box = await cb.boundingBox()
  if (box)
    await page.screenshot({
      path: `${OUT}/ring-2.png`,
      clip: { x: box.x - 12, y: box.y - 12, width: 300, height: box.height + 24 },
    })
  await page.getByTestId('clickwrap-checkbox').check()
  const cont = page.getByTestId('guest-continue')
  await expect(cont).toBeEnabled()
  await cont.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const b2 = await cont.boundingBox()
  if (b2)
    await page.screenshot({
      path: `${OUT}/ring-3.png`,
      clip: { x: b2.x - 12, y: b2.y - 12, width: b2.width + 24, height: b2.height + 24 },
    })
  log('continue outline:', await cont.evaluate((el) => getComputedStyle(el).outline))
})
