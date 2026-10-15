import { fromNodeHeaders } from 'better-auth/node'
import type { NextFunction, Request, Response } from 'express'
import type { Auth } from '../auth/auth.ts'

export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

declare global {
  namespace Express {
    interface Locals {
      session?: AuthSession
    }
  }
}

export async function loadSession(auth: Auth, req: Request): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
}

/** Rejects with 401 unless the request carries a valid session cookie or bearer token. */
export function requireSession(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = await loadSession(auth, req)
    if (!session) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in first.' })
      return
    }
    res.locals.session = session
    next()
  }
}

export function sessionOf(res: Response): AuthSession {
  const s = res.locals.session
  if (!s) throw new Error('requireSession middleware missing')
  return s
}
