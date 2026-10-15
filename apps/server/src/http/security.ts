import type { NextFunction, Request, Response } from 'express'
import type { AppConfig } from '../config.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for our own cookie-authenticated routes (Better Auth checks its own): a
 * state-changing request that carries cookies must come from the web origin.
 */
export function requireTrustedOrigin(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || !req.headers.cookie) {
      next()
      return
    }
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer)
    if (origin !== config.webOrigin) {
      res.status(403).json({ error: 'INVALID_ORIGIN', message: 'Request origin not allowed.' })
      return
    }
    next()
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined
  try {
    return new URL(referer).origin
  } catch {
    return undefined
  }
}

/**
 * Small fixed-window per-key limiter for our own endpoints (Better Auth limits its own).
 * A request is counted when it arrives, so a burst of parallel requests can't all slip in
 * before the first one finishes. If `countIf(status)` rejects the final status the request
 * is refunded, so e.g. a mistyped date (400) doesn't use up the budget.
 */
export function fixedWindowLimiter(options: {
  windowMs: number
  max: number
  key: (req: Request) => string | undefined
  countIf?: (status: number) => boolean
}) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  const live = (k: string, now: number) => {
    const e = hits.get(k)
    return e && e.resetAt > now ? e : undefined
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const k = options.key(req) ?? 'unknown'
    const now = Date.now()
    if (hits.size > 10_000) {
      for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key)
    }
    let entry = live(k, now)
    if (entry && entry.count >= options.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
      res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests. Try again soon.' })
      return
    }
    if (entry) entry.count += 1
    else {
      entry = { count: 1, resetAt: now + options.windowMs }
      hits.set(k, entry)
    }
    const counted = entry
    if (options.countIf) {
      const countIf = options.countIf
      res.on('finish', () => {
        // Refund only within the same window (a new window started from zero anyway).
        if (!countIf(res.statusCode) && hits.get(k) === counted && counted.count > 0) {
          counted.count -= 1
        }
      })
    }
    next()
  }
}

/** Baseline security headers for API responses. */
export function securityHeaders(config: AppConfig) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
  }
}
