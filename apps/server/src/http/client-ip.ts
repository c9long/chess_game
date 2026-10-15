import { createHmac } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AppConfig } from '../config.ts'

/** Header Better Auth reads the client IP from when not behind Cloudflare. */
export const FORWARDED_HEADER = 'x-forwarded-for'
export const CLOUDFLARE_HEADER = 'cf-connecting-ip'

function stripMapped(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

/**
 * Resolves the real client IP. Behind Cloudflare (TRUST_CLOUDFLARE=true; the firewall
 * only admits Cloudflare) it is CF-Connecting-IP; otherwise the TCP peer address.
 */
export function clientIp(req: Request, config: AppConfig): string | undefined {
  if (config.trustCloudflare) {
    const cf = req.headers[CLOUDFLARE_HEADER]
    if (typeof cf === 'string' && cf.trim()) return cf.trim()
    return undefined
  }
  const peer = req.socket.remoteAddress
  return peer ? stripMapped(peer) : undefined
}

/**
 * When not trusting Cloudflare, overwrite any client-supplied X-Forwarded-For with the
 * TCP peer address, so Better Auth's rate limiter can't be dodged with a spoofed header.
 */
export function normalizeForwardedFor(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!config.trustCloudflare) {
      const ip = clientIp(req, config)
      if (ip) req.headers[FORWARDED_HEADER] = ip
      else delete req.headers[FORWARDED_HEADER]
    }
    next()
  }
}

/** Keyed hash of an IP for legal_acceptances (never the raw address). */
export function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null
  return createHmac('sha256', secret).update(ip).digest('hex')
}
