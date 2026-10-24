import { describe, expect, it } from 'vitest'
import { REDACTED, scrubSecrets } from './secrets.ts'

describe('scrubSecrets', () => {
  it('redacts secret-named values, auth headers and URL passwords', () => {
    const cases: [string, string][] = [
      ['password=hunter2', `password=${REDACTED}`],
      ['GET /verify-email?token=abc.def&x=1', `GET /verify-email?token=${REDACTED}&x=1`],
      ['{"newPassword":"pw","seat":1}', `{"newPassword":${REDACTED},"seat":1}`],
      ['session_token=xyz; theme=dark', `session_token=${REDACTED}; theme=dark`],
      ['cookie: a=b; c=d', `cookie: ${REDACTED}`],
      ['Authorization: Bearer abc.def', `Authorization: ${REDACTED}`],
      ['code=123456 then otp: 654321', `code=${REDACTED} then otp: ${REDACTED}`],
      ['https://u:pw@host/x', `https://${REDACTED}@host/x`],
    ]
    for (const [input, want] of cases) expect(scrubSecrets(input), input).toBe(want)
  })

  it('redacts every code in a JSON array', () => {
    const out = scrubSecrets('{"backupCodes":["abcd-1234","efgh-5678"],"ok":true}')
    expect(out).toBe(`{"backupCodes":${REDACTED},"ok":true}`)
    expect(scrubSecrets('backupCodes=[abcd-1234, efgh-5678] left')).toBe(
      `backupCodes=${REDACTED} left`,
    )
    expect(scrubSecrets(String.raw`{\"backupCodes\":[\"abcd-1234\",\"efgh-5678\"]}`)).toBe(
      String.raw`{\"backupCodes\":${REDACTED}}`,
    )
  })

  it('redacts secrets in JSON nested inside a JSON string', () => {
    const cases: [string, string][] = [
      [String.raw`{\"password\":\"hunter2\"}`, String.raw`{\"password\":${REDACTED}}`],
      [String.raw`"{\"token\":\"tok-1\"}"`, String.raw`"{\"token\":${REDACTED}}"`],
      [
        String.raw`body: "{\"newPassword\":\"two words\",\"seat\":1}"`,
        String.raw`body: "{\"newPassword\":${REDACTED},\"seat\":1}"`,
      ],
    ]
    for (const [input, want] of cases) expect(scrubSecrets(input), input).toBe(want)
  })

  it('redacts a bare password up to the end of the line or the next , ; or &', () => {
    const cases: [string, string][] = [
      ['password: correct horse battery', `password: ${REDACTED}`],
      ['password=two words ok\nnext line', `password=${REDACTED}\nnext line`],
      ['password=two words, seat=1', `password=${REDACTED}, seat=1`],
      ['newPassword: a b; theme=dark', `newPassword: ${REDACTED}; theme=dark`],
      ['/x?password=a b&next=1', `/x?password=${REDACTED}&next=1`],
      // Other secrets are single tokens, so the words after them stay.
      ['reconnectionToken: rt-1 rejected', `reconnectionToken: ${REDACTED} rejected`],
    ]
    for (const [input, want] of cases) expect(scrubSecrets(input), input).toBe(want)
  })

  it('redacts an auth scheme together with its credential', () => {
    const cases: [string, string][] = [
      ['authorization=Basic dXNlcjpwYXNz ok', `authorization=${REDACTED} ok`],
      ['proxy_authorization=Digest abc123, x=1', `proxy_authorization=${REDACTED}, x=1`],
      ['token=Bearer abc.def', `token=${REDACTED}`],
      [
        String.raw`{\"authorization\":\"Basic dXNlcjpwYXNz\"}`,
        String.raw`{\"authorization\":${REDACTED}}`,
      ],
    ]
    for (const [input, want] of cases) expect(scrubSecrets(input), input).toBe(want)
  })

  it("cuts a failed query's parameter values", () => {
    const out = scrubSecrets('Failed query: select 1 where "id" = $1\nparams: tok-9,u_1')
    expect(out).toBe(`Failed query: select 1 where "id" = $1\nparams: ${REDACTED}`)
  })

  it('leaves its own output as it is', () => {
    for (const s of [
      'password=two words, seat=1',
      '{"backupCodes":["a","b"]}',
      String.raw`{\"password\":\"x\"}`,
      'authorization=Basic abc',
    ]) {
      expect(scrubSecrets(scrubSecrets(s)), s).toBe(scrubSecrets(s))
    }
  })

  it('keeps names that only contain a short secret word', () => {
    for (const s of ['statusCode=500', 'barcode: 42', 'footprint=3']) {
      expect(scrubSecrets(s)).toBe(s)
    }
  })
})
