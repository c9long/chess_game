import { describe, expect, it } from 'vitest'
import {
  REDACTED,
  SENTRY_PRIVACY_OPTIONS,
  scrubData,
  scrubEvent,
  scrubText,
} from './error-scrub.ts'
import { SECRET_KEYS } from './secrets.ts'

describe('scrubText', () => {
  it('redacts email and IP addresses', () => {
    expect(scrubText('no user ana.b+x@mail.example.co.uk here')).toBe('no user [email] here')
    expect(scrubText('from 203.0.113.9 and 2001:db8:85a3:0:0:8a2e:370:7334')).toBe(
      'from [ip] and [ip]',
    )
    expect(scrubText('peer ::ffff:10.1.2.3 / fe80::1')).toBe('peer [ip] / [ip]')
  })

  it('keeps clock times, versions and Rust paths', () => {
    for (const s of ['at 12:34:56', 'v1.2.3', 'rules_core::board::Board', 'localhost:3000']) {
      expect(scrubText(s)).toBe(s)
    }
  })

  it('drops query strings, which can carry tokens, codes or names', () => {
    expect(scrubText('see https://play.x/verify-email?token=abc.def&next=/play now')).toBe(
      'see https://play.x/verify-email now',
    )
    expect(scrubText('/device?user_code=ABCD-EFGH')).toBe('/device')
    expect(scrubText('"/api/auth/callback/google?code=4/0Ab&state=xyz&scope=email"')).toBe(
      '"/api/auth/callback/google"',
    )
    // Colyseus: the WebSocket URL carries the session and the reconnection token.
    expect(
      scrubText(
        'wss://api.x/api/colyseus/p1/r1?sessionId=s1&reconnectionToken=r1:t0k&_authToken=j',
      ),
    ).toBe('wss://api.x/api/colyseus/p1/r1')
    // OAuth-style fragments too, and links nested in a parameter go with it.
    expect(scrubText('/cb#access_token=t&state=s')).toBe('/cb')
    expect(scrubText('/sign-in?callbackURL=%2Fdevice%3Fuser_code%3DABCD&x=1')).toBe('/sign-in')
    expect(scrubText('/x?redirect=https%3A%2F%2Fp.x%2Fr%3Ftoken%3Dsecret')).toBe('/x')
  })

  it('drops any query string or fragment from a URL, whatever its shape', () => {
    const cases: [string, string][] = [
      ['GET /api/x?a[b]=x 500', 'GET /api/x 500'],
      ['/api/x?=x', '/api/x'],
      ['https://play.x/find?alice', 'https://play.x/find'],
      ['/api/x?foo&token=abc', '/api/x'],
      ['/rules#castling', '/rules'],
      ['https://play.x/#/u/alice', 'https://play.x/'],
      ['"/cb#state"', '"/cb"'],
      ['/?q', '/'],
    ]
    for (const [input, want] of cases) expect(scrubText(input), input).toBe(want)
  })

  it('keeps question marks and hashes outside URLs', () => {
    for (const s of [
      'really? yes',
      'what?alice',
      'div#root > button.x',
      '#f00',
      'and/or? yes',
      '3/4? no',
    ]) {
      expect(scrubText(s)).toBe(s)
    }
  })

  it('redacts usernames and one-time tokens in paths', () => {
    expect(scrubText('https://play.x/u/alice?tab=games')).toBe(`https://play.x/u/${REDACTED}`)
    expect(scrubText('GET /api/players/alice')).toBe(`GET /api/players/${REDACTED}`)
    expect(scrubText('/api/auth/reset-password/tok123?callbackURL=/x')).toBe(
      `/api/auth/reset-password/${REDACTED}`,
    )
    expect(scrubText('/match/abc123')).toBe('/match/abc123')
  })

  it('redacts user ids in the friends, blocks and admin user paths', () => {
    expect(scrubText('DELETE /api/friends/u_8f2k')).toBe(`DELETE /api/friends/${REDACTED}`)
    expect(scrubText('/api/friends/requests/u_8f2k/accept')).toBe(
      `/api/friends/requests/${REDACTED}/accept`,
    )
    expect(scrubText('/api/blocks/u_8f2k/x')).toBe(`/api/blocks/${REDACTED}/x`)
    expect(scrubText('POST /api/admin/users/u_8f2k/unsuspend')).toBe(
      `POST /api/admin/users/${REDACTED}/unsuspend`,
    )
    for (const s of [
      '/api/friends',
      '/api/friends/requests',
      '/api/friends/settings',
      '/api/friends/match/m1',
      '/api/blocks/match/m1/2',
      '/api/admin/reports/r1/dismiss',
    ]) {
      expect(scrubText(s)).toBe(s)
    }
  })

  it('redacts database query parameters and key values', () => {
    const failed =
      'Failed query: insert into "session" ("token", "user_id") values ($1, $2)\n' +
      'params: 9fK2xTokenValue,u_123'
    const out = scrubText(failed)
    expect(out).toMatch(/^Failed query: insert into "session"/)
    expect(out.endsWith(`params: ${REDACTED}`)).toBe(true)
    expect(out).not.toMatch(/9fK2xTokenValue|u_123/)
    expect(scrubText('Key (username)=(alice_99) already exists.')).toBe(
      `Key (username)=(${REDACTED}) already exists.`,
    )
  })

  it('redacts secrets written as key: value, JSON, headers and URL passwords', () => {
    const cases: [string, string][] = [
      ['{"password":"hunter2","seat":1}', `{"password":${REDACTED},"seat":1}`],
      ['{"reconnectionToken":"abcd"}', `{"reconnectionToken":${REDACTED}}`],
      ['reconnectionToken: rt-1 rejected', `reconnectionToken: ${REDACTED} rejected`],
      ['Authorization: Bearer abc.def', `Authorization: ${REDACTED}`],
      ['sent Bearer abc.def', `sent Bearer ${REDACTED}`],
      ['cookie: better-auth.session_token=xyz; a=b', `cookie: ${REDACTED}`],
      ['postgres://bob:hunter2@db:5432/game', `postgres://${REDACTED}@db:5432/game`],
      // The logger's secret names: sign-in codes and captcha answers, not `statusCode`.
      ['bad code: 123456, otp=654321', `bad code: ${REDACTED}, otp=${REDACTED}`],
      ['x-captcha-response: abc', `x-captcha-response: ${REDACTED}`],
      ['statusCode: 500', 'statusCode: 500'],
    ]
    for (const [input, want] of cases) expect(scrubText(input), input).toBe(want)
  })

  it('leaves already scrubbed text as it is', () => {
    for (const s of ['password=hunter2 ok', 'Authorization: Bearer x', '/u/alice?q=1']) {
      expect(scrubText(scrubText(s)), s).toBe(scrubText(s))
    }
  })

  it('redacts percent-encoded emails', () => {
    expect(scrubText('GET /api/x/alice%40example.com')).toBe('GET /api/x/[email]')
  })

  it('redacts the labels DOM breadcrumbs copy from the page', () => {
    expect(scrubText('div.menu > button[aria-label="More for alice"][type="button"] > svg')).toBe(
      `div.menu > button[aria-label="${REDACTED}"][type="button"] > svg`,
    )
    expect(scrubText('button[title="Challenge alice"] > img[alt="alice avatar"]')).toBe(
      `button[title="${REDACTED}"] > img[alt="${REDACTED}"]`,
    )
  })
})

describe('scrubEvent', () => {
  const event = {
    event_id: 'e1',
    message: 'failed for bob@example.com',
    user: { id: 'u1', email: 'bob@example.com', ip_address: '{{auto}}', username: 'bob' },
    request: {
      url: 'https://api.x/api/auth/verify-email?token=secret',
      method: 'POST',
      query_string: 'token=secret',
      cookies: { 'better-auth.session_token': 's' },
      data: { password: 'hunter22', email: 'bob@example.com' },
      headers: {
        Cookie: 'a=b',
        Authorization: 'Bearer t',
        'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
        Referer: 'https://play.x/reset-password?token=t',
        'X-Forwarded-For': '203.0.113.9',
        'CF-Connecting-IP': '203.0.113.9',
      },
      env: { REMOTE_ADDR: '203.0.113.9' },
    },
    exception: {
      values: [{ type: 'Error', value: 'no account for 203.0.113.9 (bob@example.com)' }],
    },
    extra: { room: 'r1', token: 'abc', email: 'bob@example.com', note: 'ip 198.51.100.7' },
    contexts: { browser: { name: 'Chrome', version: '120.0.0.0' } },
    sdk: { name: 'sentry.javascript.browser', settings: { infer_ip: 'never' } },
    breadcrumbs: [
      { category: 'fetch', data: { url: '/device?user_code=AB-CD', method: 'GET', body: 'pw' } },
      { category: 'navigation', data: { from: '/u/alice', to: '/play' } },
      { category: 'console', message: 'signed in as bob@example.com' },
    ],
  }

  it('drops the user, cookies, bodies, query strings and unsafe headers', () => {
    const out = scrubEvent(event)
    expect(out).not.toHaveProperty('user')
    expect(out.request).toEqual({
      url: 'https://api.x/api/auth/verify-email',
      method: 'POST',
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' },
    })
  })

  it('scrubs text everywhere, but not SDK version metadata', () => {
    const out = scrubEvent(event)
    expect(out.message).toBe('failed for [email]')
    expect(out.exception.values[0]?.value).toBe('no account for [ip] ([email])')
    expect(out.extra).toEqual({ room: 'r1', note: 'ip [ip]' })
    expect(out.contexts.browser.version).toBe('120.0.0.0')
    expect(out.sdk.settings.infer_ip).toBe('never')
    expect(out.breadcrumbs[0]?.data).toEqual({ url: '/device', method: 'GET' })
    expect(out.breadcrumbs[1]?.data?.from).toBe(`/u/${REDACTED}`)
    expect(out.breadcrumbs[2]?.message).toBe('signed in as [email]')
    expect(JSON.stringify(out)).not.toMatch(/bob|hunter22|secret|203\.0\.113/)
  })

  it('scrubs contexts, except the SDK-made version fields', () => {
    const out = scrubEvent({
      contexts: {
        os: { name: 'Linux', kernel_version: '5.15.167.4-microsoft-standard-WSL2' },
        runtime: { name: 'node', version: 'v24.1.0' },
        pino: { msg: 'login alice@x.com from 7.7.7.7' },
        custom: { reconnection: 'r1', reconnectionToken: 'tok' },
        trace: { data: { 'url.full': '/device?user_code=AB', 'client.address': '7.7.7.7' } },
      },
    })
    expect(out.contexts).toEqual({
      os: { name: 'Linux', kernel_version: '5.15.167.4-microsoft-standard-WSL2' },
      runtime: { name: 'node', version: 'v24.1.0' },
      pino: { msg: 'login [email] from [ip]' },
      custom: { reconnection: 'r1' },
      trace: { data: { 'url.full': '/device', 'client.address': '[ip]' } },
    })
  })

  it('drops objects nested too deep to scrub', () => {
    let deep: Record<string, unknown> = { email: 'deep@x.co', note: 'deep@x.co' }
    for (let i = 0; i < 15; i++) deep = { child: deep }
    const out = JSON.stringify(scrubEvent({ extra: deep }))
    expect(out).not.toContain('deep@x.co')
    expect(out).toContain(REDACTED)
  })

  it('drops user id fields in extra and contexts', () => {
    const ids = { userId: 'u1', user_id: 'u2', targetUserId: 'u3', blocked_user_id: 'u4' }
    const out = scrubEvent({
      extra: { ...ids, 'enduser.id': 'u5', room: 'r1' },
      contexts: { pino: { ...ids, seat: 1 }, trace: { data: { 'enduser.id': 'u5', x: 1 } } },
    })
    expect(out.extra).toEqual({ room: 'r1' })
    expect(out.contexts).toEqual({ pino: { seat: 1 }, trace: { data: { x: 1 } } })
    // Ids that are not a user's stay.
    expect(scrubEvent({ extra: { matchId: 'm1', sessionId: 's1' } }).extra).toEqual({
      matchId: 'm1',
      sessionId: 's1',
    })
  })

  it('drops every field the logger redacts', () => {
    const extra = Object.fromEntries(SECRET_KEYS.map((k) => [k, 'x']))
    expect(scrubEvent({ extra: { ...extra, seat: 1 } }).extra).toEqual({ seat: 1 })
  })

  it('is the beforeSend of the shared SDK options, which collect nothing personal', () => {
    expect(SENTRY_PRIVACY_OPTIONS.beforeSend).toBe(scrubEvent)
    expect(SENTRY_PRIVACY_OPTIONS.beforeSendSpan).toBe(scrubData)
    expect(SENTRY_PRIVACY_OPTIONS.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    })
  })

  it('returns a copy', () => {
    const before = JSON.stringify(event)
    scrubEvent(event)
    expect(JSON.stringify(event)).toBe(before)
  })
})

describe('scrubData', () => {
  it('drops span attributes that name the user, a query string or a credential', () => {
    expect(
      scrubData({
        name: 'GET /api/players/alice',
        attributes: {
          'http.request.method': 'GET',
          'url.full': 'https://api.x/device?user_code=AB',
          'url.query': 'user_code=AB',
          'user.id': 'u1',
          'user.name': 'alice',
          'client.address': '203.0.113.9',
          'http.request.header.cookie': 'a=b',
        },
      }),
    ).toEqual({
      name: `GET /api/players/${REDACTED}`,
      attributes: {
        'http.request.method': 'GET',
        'url.full': 'https://api.x/device',
        'client.address': '[ip]',
      },
    })
  })

  it('drops bodies', () => {
    expect(scrubData({ name: 'POST /api/x', data: { body: '{"a":1}', status_code: 500 } })).toEqual(
      { name: 'POST /api/x', data: { status_code: 500 } },
    )
  })
})
