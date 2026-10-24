import type { NextFunction, Request, Response } from 'express'
import type { Logger } from '../logger.ts'

/** The last middleware: a 4xx (bad or oversized JSON) is the client's, anything else is ours. */
export function errorHandler(logger: Logger) {
  return (err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500
    const clientError = status >= 400 && status < 500
    if (!clientError) logger.error({ path: req.path, err }, 'unhandled error')
    res.status(clientError ? status : 500).json({ error: clientError ? 'BAD_REQUEST' : 'INTERNAL' })
  }
}
