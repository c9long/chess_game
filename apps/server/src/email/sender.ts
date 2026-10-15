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
 * tokens) and keeps it in memory for the guarded dev mail endpoint.
 */
export class MemoryEmailSender implements EmailSender {
  readonly name = 'memory'
  private nextId = 1
  private readonly messages: StoredEmail[] = []
  private readonly logger: Logger | undefined
  private readonly limit: number

  constructor(logger?: Logger, limit = 500) {
    this.logger = logger
    this.limit = limit
  }

  async send(message: EmailMessage): Promise<void> {
    this.messages.push({ ...message, id: this.nextId++, sentAt: new Date().toISOString() })
    if (this.messages.length > this.limit) this.messages.shift()
    this.logger?.info({ kind: message.kind }, 'email stored in dev mailbox')
  }

  /** Messages for one recipient (case-insensitive), oldest first. */
  list(to?: string): StoredEmail[] {
    if (!to) return [...this.messages]
    const want = to.toLowerCase()
    return this.messages.filter((m) => m.to.toLowerCase() === want)
  }

  clear(): void {
    this.messages.length = 0
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
