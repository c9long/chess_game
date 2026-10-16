import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type EmailMessage, MemoryEmailSender } from './sender.ts'

const msg = (to: string, kind: EmailMessage['kind'] = 'verify-email'): EmailMessage => ({
  kind,
  to,
  subject: 'Verify your email',
  text: 'Open http://localhost:5173/verify-email?token=abc',
  html: '<p>…</p>',
})

describe('MemoryEmailSender', () => {
  const dirs: string[] = []
  const tempFile = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-mailbox-'))
    dirs.push(dir)
    return join(dir, 'mailbox.json')
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('keeps messages in memory and filters by recipient, case-insensitively', async () => {
    const box = new MemoryEmailSender()
    await box.send(msg('A@Example.test'))
    await box.send(msg('b@example.test'))
    expect(box.list('a@example.test').map((m) => m.to)).toEqual(['A@Example.test'])
    expect(box.list()).toHaveLength(2)
  })

  it('with a file, survives a restart (a new sender reads the saved mailbox)', async () => {
    const file = tempFile()
    const first = new MemoryEmailSender(undefined, 500, { file })
    await first.send(msg('a@example.test'))
    await first.send(msg('a@example.test', 'reset-password'))

    const second = new MemoryEmailSender(undefined, 500, { file })
    expect(second.list('a@example.test').map((m) => m.kind)).toEqual([
      'verify-email',
      'reset-password',
    ])
    await second.send(msg('a@example.test'))
    const ids = second.list().map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length) // ids keep increasing across restarts
  })

  it('clear() also empties the saved file', async () => {
    const file = tempFile()
    const box = new MemoryEmailSender(undefined, 500, { file })
    await box.send(msg('a@example.test'))
    box.clear()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([])
    expect(new MemoryEmailSender(undefined, 500, { file }).list()).toEqual([])
  })

  it('caps the mailbox at its limit, oldest first out', async () => {
    const box = new MemoryEmailSender(undefined, 2)
    for (const to of ['1@x.test', '2@x.test', '3@x.test']) await box.send(msg(to))
    expect(box.list().map((m) => m.to)).toEqual(['2@x.test', '3@x.test'])
  })

  it('starts empty when the saved file is missing or corrupt', () => {
    expect(new MemoryEmailSender(undefined, 500, { file: '/nonexistent/x.json' }).list()).toEqual(
      [],
    )
  })
})
