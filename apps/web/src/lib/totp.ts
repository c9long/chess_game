/**
 * Better Auth form-encodes spaces in the otpauth URI as "+", which some authenticator apps
 * show literally. Re-encode issuer and label with %20 before drawing the QR code.
 */
export function normalizeTotpUri(uri: string): string {
  try {
    const url = new URL(uri)
    const rawLabel = url.pathname.replace(/^\/+(totp\/)?/, '')
    const label = decodeURIComponent(rawLabel.replaceAll('+', ' '))
    // URLSearchParams already decodes "+" as a space.
    const params = [...url.searchParams.entries()]
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    return `otpauth://totp/${encodeURIComponent(label).replaceAll('%3A', ':')}?${params}`
  } catch {
    return uri
  }
}

/** The base32 secret, for manual entry when the QR code can't be scanned. */
export function totpSecret(uri: string): string | undefined {
  try {
    return new URL(uri).searchParams.get('secret') ?? undefined
  } catch {
    return undefined
  }
}
