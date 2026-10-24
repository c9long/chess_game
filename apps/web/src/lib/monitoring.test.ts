import { SENTRY_PRIVACY_OPTIONS } from '@game/config/error-scrub'
import type { BrowserOptions, ErrorEvent } from '@sentry/browser'
import { describe, expect, it } from 'vitest'
import { errorTrackingOptions } from './monitoring.ts'

type Integration = Extract<BrowserOptions['integrations'], unknown[]>[number]

const DSN = 'https://pubkey@o42.ingest.us.sentry.io/4507'

describe('errorTrackingOptions', () => {
  it('names the environment after the build mode unless one is given', () => {
    expect(errorTrackingOptions({ dsn: DSN, mode: 'production' })).toMatchObject({
      dsn: DSN,
      environment: 'production',
    })
    const o = errorTrackingOptions({
      dsn: DSN,
      mode: 'production',
      environment: 'staging',
      release: 'abc123',
    })
    expect(o.environment).toBe('staging')
    expect(o.release).toBe('abc123')
    expect(errorTrackingOptions({ dsn: DSN, mode: 'production' })).not.toHaveProperty('release')
  })

  it('collects no personal data and adds no replay, tracing or profiling', () => {
    const o = errorTrackingOptions({ dsn: DSN, mode: 'production' })
    expect(o.dataCollection).toEqual(SENTRY_PRIVACY_OPTIONS.dataCollection)
    expect(o.dataCollection?.userInfo).toBe(false)
    expect(o).not.toHaveProperty('tracesSampleRate')
    expect(o).not.toHaveProperty('replaysSessionSampleRate')
    expect(o).not.toHaveProperty('profilesSampleRate')
    const named = (name: string) => ({ name }) as Integration
    const pick = o.integrations as (defaults: Integration[]) => Integration[]
    expect(pick([named('GlobalHandlers'), named('BrowserSession')]).map((i) => i.name)).toEqual([
      'GlobalHandlers',
    ])
  })

  it('scrubs events, with their breadcrumbs, before they are sent', () => {
    const o = errorTrackingOptions({ dsn: DSN, mode: 'production' })
    expect(o).not.toHaveProperty('beforeBreadcrumb')
    const event = {
      type: undefined,
      message: 'no account for bob@example.com',
      user: { ip_address: '{{auto}}' },
      request: {
        url: 'https://play.x/device?user_code=ABCD-EFGH',
        headers: { 'User-Agent': 'UA', Referer: 'https://play.x/reset-password?token=t' },
      },
      breadcrumbs: [
        { category: 'navigation', data: { to: '/u/alice' } },
        // Click breadcrumbs copy element labels, which carry players' and lobbies' names.
        { category: 'ui.click', message: 'li > button[aria-label="More for alice"]' },
      ],
    } as ErrorEvent
    const sent = o.beforeSend?.(event, {}) as ErrorEvent
    expect(sent.message).toBe('no account for [email]')
    expect(sent.user).toBeUndefined()
    expect(sent.request).toEqual({ url: 'https://play.x/device', headers: { 'User-Agent': 'UA' } })
    expect(sent.breadcrumbs).toEqual([
      { category: 'navigation', data: { to: '/u/[redacted]' } },
      { category: 'ui.click', message: 'li > button[aria-label="[redacted]"]' },
    ])
  })
})
