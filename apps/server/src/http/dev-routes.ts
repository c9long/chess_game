import type { Request, Response } from 'express'
import { Router } from 'express'
import type { MemoryEmailSender } from '../email/sender.ts'

function isLoopback(req: Request): boolean {
  const a = req.socket.remoteAddress ?? ''
  const fromLoopback = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
  // Also require a local Host header, so a web page can't reach the mailbox through DNS
  // rebinding (its requests would carry the attacker's host name).
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  return fromLoopback && localHost
}

/**
 * Development/test-only mailbox for E2E tests. Mounted only when DEV_MAIL_ENDPOINT is on
 * (never in production; config refuses it) and only answers loopback clients.
 */
export function devMailRouter(mailbox: MemoryEmailSender) {
  const router = Router()
  router.use((req: Request, res: Response, next) => {
    if (!isLoopback(req)) {
      res.status(404).end()
      return
    }
    next()
  })
  router.get('/mail', (req, res) => {
    const to = typeof req.query.to === 'string' ? req.query.to : undefined
    res.setHeader('Cache-Control', 'no-store')
    res.json({ messages: mailbox.list(to) })
  })
  router.delete('/mail', (_req, res) => {
    mailbox.clear()
    res.status(204).end()
  })
  return router
}
