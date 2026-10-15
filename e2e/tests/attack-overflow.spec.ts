import { test } from '@playwright/test'
import { passAgeScreen } from './helpers.ts'

test('which element overflows /privacy at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await passAgeScreen(page)
  await page.goto('/privacy')
  await page.waitForTimeout(800)
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out: string[] = []
    for (const el of document.querySelectorAll('.legal-doc *')) {
      const b = el.getBoundingClientRect()
      if (
        b.right > vw + 1 &&
        !(
          el.parentElement &&
          el.parentElement.getBoundingClientRect().right > vw + 1 &&
          el.parentElement.closest('.legal-doc') !== el.parentElement &&
          out.length > 0
        )
      )
        out.push(
          `${el.tagName} right=${Math.round(b.right)} ${(el.textContent ?? '').slice(0, 60)}`,
        )
    }
    return out.slice(0, 8)
  })
  console.log('[attack-overflow]', r)
})
