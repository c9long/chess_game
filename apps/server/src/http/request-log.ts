import type { NextFunction, Request, Response } from 'express'
import { type Logger, NOT_REPORTED } from '../logger.ts'

/**
 * Logs method, path (never the query string, which can hold tokens), status and timing.
 * Headers and bodies are never logged.
 */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
      logger[level](
        {
          // The error behind a 500 is reported where it is logged; a 503 is not an error.
          [NOT_REPORTED]: true,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms: Math.round(ms),
        },
        'request',
      )
    })
    next()
  }
}
