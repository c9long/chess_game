import { useEffect, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        options: {
          sitekey: string
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'flexible' | 'compact'
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
        },
      ): string
      remove(id: string): void
      reset(id: string): void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | undefined

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = undefined
      s.remove()
      reject(new Error('Turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget. Tokens are single-use: remount (change `key`) after each
 * submission to get a fresh one. If the check can't load or errors (blockers, network), it
 * says so and offers a retry instead of leaving the form silently disabled.
 */
export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  callback.current = onToken
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the effect on retry
  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false
    setFailed(false)
    const fail = () => {
      callback.current(null)
      if (!cancelled) setFailed(true)
    }
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return
        widgetId = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'flexible',
          callback: (t) => callback.current(t),
          'expired-callback': () => callback.current(null),
          'error-callback': fail,
        })
      })
      .catch(fail)
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, attempt])

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="flex min-h-[65px] w-full justify-center" data-testid="turnstile" />
      {failed ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-seat-south/50 bg-seat-south/10 px-4 py-3 text-sm"
          data-testid="turnstile-error"
        >
          <span>The anti-bot check couldn’t load. Disable content blockers or try again.</span>
          <button
            type="button"
            className="shrink-0 font-semibold text-gold hover:underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  )
}
