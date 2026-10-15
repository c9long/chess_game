import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './return-to.ts'

describe('safeReturnTo', () => {
  it('keeps same-origin paths with their query', () => {
    expect(safeReturnTo('/device?user_code=ABCD-EFGH')).toBe('/device?user_code=ABCD-EFGH')
    expect(safeReturnTo('/account')).toBe('/account')
  })

  it('refuses anything that could leave the site or loop', () => {
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/sign-in',
      '/two-factor',
      '/x\r\nSet-Cookie: a=b',
      undefined,
      42,
    ]) {
      expect(safeReturnTo(bad)).toBe('/')
    }
  })
})
