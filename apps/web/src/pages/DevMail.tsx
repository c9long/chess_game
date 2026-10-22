import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  Alert,
  Button,
  EmptyState,
  Field,
  PageTitle,
  RuleList,
  textLinkClass,
} from '../components/ui.tsx'

interface StoredEmail {
  id: number
  kind: string
  to: string
  subject: string
  text: string
  sentAt: string
}

/** Turns the URLs in a plain-text email into links (everything else stays text). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one message
            key={i}
            href={part}
            className={`${textLinkClass} font-medium break-all`}
            data-testid="dev-mail-link"
          >
            {part}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one message
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * Development-only mailbox (route registered only in dev builds). Locally the server never
 * sends email: verification and password-reset messages are stored and listed here.
 */
export function DevMail() {
  const [params, setParams] = useSearchParams()
  const filter = params.get('to') ?? ''
  const [messages, setMessages] = useState<StoredEmail[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'unavailable'>('loading')

  const load = useCallback(async () => {
    try {
      const q = filter ? `?to=${encodeURIComponent(filter)}` : ''
      const res = await fetch(`/api/dev/mail${q}`, { credentials: 'include' })
      if (!res.ok) {
        setStatus('unavailable')
        return
      }
      const body = (await res.json()) as { messages: StoredEmail[] }
      setMessages([...body.messages].reverse())
      setStatus('ok')
    } catch {
      setStatus('unavailable')
    }
  }, [filter])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(id)
  }, [load])

  async function clear() {
    await fetch('/api/dev/mail', { method: 'DELETE', credentials: 'include' })
    await load()
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <PageTitle
        title="Dev mailbox"
        subtitle="On this computer the server doesn’t send email. Every verification and password-reset email lands here instead: open it and follow the link inside. The list updates by itself, and this page doesn’t exist on the live site."
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Show emails sent to"
          type="email"
          placeholder="All addresses"
          value={filter}
          onChange={(e) =>
            setParams(e.target.value ? { to: e.target.value } : {}, { replace: true })
          }
          className="min-w-64 flex-1"
        />
        <Button variant="secondary" onClick={clear}>
          Clear mailbox
        </Button>
      </div>

      <div className="mt-8">
        {status === 'unavailable' ? (
          <Alert>
            The dev mailbox isn’t available. Check that the server is running in development (`pnpm
            dev`), that `RESEND_API_KEY` is empty and `DEV_MAIL_ENDPOINT=true` in apps/server/.env,
            and that you opened this page on localhost.
          </Alert>
        ) : messages.length === 0 && status === 'ok' ? (
          <EmptyState title={filter ? `No emails for ${filter} yet` : 'No emails yet'}>
            Sign up or ask for a password reset, and the email appears here within a second or two.
          </EmptyState>
        ) : (
          <RuleList data-testid="dev-mailbox">
            {messages.map((m) => (
              <li key={m.id} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-body font-semibold text-parchment">{m.subject}</h2>
                  <span className="text-caption text-faint tabular-nums">
                    {new Date(m.sentAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-0.5 text-ui break-all text-faint">To: {m.to}</p>
                <pre className="mt-3 max-w-[72ch] font-sans text-ui leading-relaxed break-words whitespace-pre-wrap text-muted">
                  <Linkified text={m.text} />
                </pre>
              </li>
            ))}
          </RuleList>
        )}
      </div>
    </div>
  )
}
