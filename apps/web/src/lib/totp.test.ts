import { describe, expect, it } from 'vitest'
import { normalizeTotpUri, totpSecret } from './totp.ts'

describe('normalizeTotpUri', () => {
  const raw =
    "otpauth://totp/LinkedList's+Chess+Game:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=LinkedList%27s+Chess+Game&algorithm=SHA1&digits=6&period=30"

  it('re-encodes spaces as %20 in the label and issuer', () => {
    const out = normalizeTotpUri(raw)
    expect(out).not.toContain('+')
    expect(out).toContain("issuer=LinkedList's%20Chess%20Game")
    expect(out.startsWith("otpauth://totp/LinkedList's%20Chess%20Game:me%40example.com?")).toBe(
      true,
    )
    expect(out).toContain('secret=JBSWY3DPEHPK3PXP')
  })

  it('extracts the secret', () => {
    expect(totpSecret(raw)).toBe('JBSWY3DPEHPK3PXP')
  })
})
