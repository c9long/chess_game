import { createHmac, timingSafeEqual } from 'node:crypto'

/** HMAC-signed JSON cookie values: base64url(json).base64url(hmac). */
export function signValue(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyValue<T>(value: string | undefined, secret: string): T | undefined {
  if (!value) return undefined
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return undefined
  const body = value.slice(0, dot)
  const mac = Buffer.from(value.slice(dot + 1))
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'))
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return undefined
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return undefined
  }
}

/** Minimal Cookie header parser (first occurrence wins). */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    if (name in out) continue
    const raw = part.slice(eq + 1).trim()
    try {
      out[name] = decodeURIComponent(raw)
    } catch {
      out[name] = raw
    }
  }
  return out
}
