import { readFileSync, writeFileSync } from 'node:fs'
import { APP_NAME } from '@game/config'
import { Resend } from 'resend'
import type { Logger } from '../logger.ts'

export type EmailKind = 'verify-email' | 'reset-password' | 'account-exists'

export interface EmailMessage {
  kind: EmailKind
  to: string
  subject: string
  text: string
  html: string
}

export interface EmailSender {
  readonly name: string
  send(message: EmailMessage): Promise<void>
}

export interface StoredEmail extends EmailMessage {
  id: number
  sentAt: string
}

/**
 * Development/test sender: logs that a message was sent (never its contents, which hold
 * tokens) and keeps it for the guarded dev mailbox (`GET /api/dev/mail`, shown in the web app
 * at /dev/mail). In development the messages are also saved to a local file so the server's
 * watch-mode restarts don't wipe them.
 */
export class MemoryEmailSender implements EmailSender {
  readonly name = 'memory'
  private nextId = 1
  private readonly messages: StoredEmail[] = []
  private readonly logger: Logger | undefined
  private readonly limit: number
  private readonly file: string | undefined
  private readonly viewUrl: string | undefined

  constructor(
    logger?: Logger,
    limit = 500,
    options: { file?: string | undefined; viewUrl?: string | undefined } = {},
  ) {
    this.logger = logger
    this.limit = limit
    this.file = options.file
    this.viewUrl = options.viewUrl
    if (this.file) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as StoredEmail[]
        if (Array.isArray(saved)) {
          this.messages.push(...saved.slice(-limit))
          this.nextId = Math.max(0, ...this.messages.map((m) => m.id)) + 1
        }
      } catch {
        // No saved mailbox yet (or unreadable): start empty.
      }
    }
  }

  async send(message: EmailMessage): Promise<void> {
    this.messages.push({ ...message, id: this.nextId++, sentAt: new Date().toISOString() })
    if (this.messages.length > this.limit) this.messages.shift()
    this.save()
    this.logger?.info(
      { kind: message.kind, ...(this.viewUrl ? { readAt: this.viewUrl } : {}) },
      'email stored in dev mailbox (not sent)',
    )
  }

  private save(): void {
    if (!this.file) return
    try {
      writeFileSync(this.file, JSON.stringify(this.messages))
    } catch (err) {
      this.logger?.warn({ err: (err as Error).message }, 'could not save the dev mailbox file')
    }
  }

  /** Messages for one recipient (case-insensitive), oldest first. */
  list(to?: string): StoredEmail[] {
    if (!to) return [...this.messages]
    const want = to.toLowerCase()
    return this.messages.filter((m) => m.to.toLowerCase() === want)
  }

  clear(): void {
    this.messages.length = 0
    this.save()
  }
}

export class ResendEmailSender implements EmailSender {
  readonly name = 'resend'
  private readonly client: Resend
  private readonly from: string
  private readonly logger: Logger | undefined

  constructor(apiKey: string, from: string, logger?: Logger) {
    this.client = new Resend(apiKey)
    this.from = from
    this.logger = logger
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: `${APP_NAME} <${this.from}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
    if (error) {
      this.logger?.error({ kind: message.kind, err: error.name }, 'email send failed')
      throw new Error(`email send failed: ${error.name}`)
    }
    this.logger?.info({ kind: message.kind }, 'email sent')
  }
}
