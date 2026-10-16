import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Alert, Button, Field } from '../components/ui.tsx'

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
            className="break-all font-semibold text-gold underline underline-offset-2"
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
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">
        Local development
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Dev mailbox</h1>
      <p className="mt-2 text-sm text-parchment/65">
        On your computer the server doesn’t send email. Every verification and password-reset email
        lands here instead. Click the link inside to continue. This page updates by itself and
        doesn’t exist on the live site.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Field
          label="Show emails sent to"
          type="email"
          placeholder="all addresses"
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

      <div className="mt-6">
        {status === 'unavailable' ? (
          <Alert>
            The dev mailbox isn’t available. Check that the server is running in development (`pnpm
            dev`), that `RESEND_API_KEY` is empty and `DEV_MAIL_ENDPOINT=true` in apps/server/.env,
            and that you opened this page on localhost.
          </Alert>
        ) : messages.length === 0 && status === 'ok' ? (
          <div className="rounded-2xl border border-dashed border-parchment/15 px-6 py-14 text-center text-parchment/60">
            No emails yet{filter ? ` for ${filter}` : ''}. Sign up or ask for a password reset and
            the email appears here within a second or two.
          </div>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="dev-mailbox">
            {messages.map((m) => (
              <li key={m.id} className="rounded-2xl border border-parchment/10 bg-panel/85 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{m.subject}</h2>
                  <span className="text-xs text-parchment/50">
                    {new Date(m.sentAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-parchment/55">To: {m.to}</p>
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-parchment/85">
                  <Linkified text={m.text} />
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
