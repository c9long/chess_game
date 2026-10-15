import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import { fixedWindowLimiter } from './security.ts'

function fakeRes() {
  const listeners: (() => void)[] = []
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      res.headers[k] = v
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json() {
      return res
    },
    on(_event: 'finish', fn: () => void) {
      listeners.push(fn)
    },
    finish(status: number) {
      res.statusCode = status
      for (const fn of listeners) fn()
    },
  }
  return res
}

describe('fixedWindowLimiter', () => {
  it('counts requests on arrival, so a parallel burst cannot exceed the limit', () => {
    const limit = fixedWindowLimiter({ windowMs: 60_000, max: 3, key: () => 'ip' })
    const passed: ReturnType<typeof fakeRes>[] = []
    let refused = 0
    for (let i = 0; i < 10; i++) {
      const res = fakeRes()
      let next = false
      limit(
        {} as Request,
        res as unknown as Response,
        (() => {
          next = true
        }) as NextFunction,
      )
      if (next) passed.push(res)
      else if (res.statusCode === 429) refused++
    }
    expect(passed).toHaveLength(3)
    expect(refused).toBe(7)
  })

  it('refunds requests whose final status countIf rejects', () => {
    const limit = fixedWindowLimiter({
      windowMs: 60_000,
      max: 1,
      key: () => 'ip',
      countIf: (status) => status !== 400,
    })
    const run = (status: number) => {
      const res = fakeRes()
      let next = false
      limit(
        {} as Request,
        res as unknown as Response,
        (() => {
          next = true
        }) as NextFunction,
      )
      if (next) res.finish(status)
      return next
    }
    expect(run(400)).toBe(true)
    expect(run(400)).toBe(true)
    expect(run(200)).toBe(true)
    expect(run(200)).toBe(false)
  })
})
