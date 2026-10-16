import { ShieldCheck } from 'lucide-react'
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
 *
 * Pass `siteKey={config?.turnstileSiteKey}`: while the config is still loading (`undefined`)
 * the slot is already reserved, so nothing below it moves when the widget arrives. (A button
 * that moves just as it is clicked can have the click land in the widget's frame instead.)
 */
export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string | undefined
  onToken: (token: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  callback.current = onToken
  const [failed, setFailed] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the effect on retry
  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false
    let shown: ReturnType<typeof setTimeout> | undefined
    setFailed(false)
    setRendered(false)
    if (!siteKey) return
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
          callback: (t) => {
            setRendered(true)
            callback.current(t)
          },
          'expired-callback': () => callback.current(null),
          'error-callback': fail,
        })
        // The widget's frame takes a moment to paint; then the stand-in steps aside.
        shown = setTimeout(() => setRendered(true), 1200)
      })
      .catch(fail)
    return () => {
      cancelled = true
      if (shown) clearTimeout(shown)
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, attempt])

  return (
    <div className="flex flex-col gap-2">
      {/* Reserved 65px slot (the widget's height), with a quiet stand-in underneath until the
          widget's frame covers it, so the form doesn't jump when it loads. */}
      <div className="relative min-h-[65px] w-full">
        {failed ? null : (
          <div
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-center gap-2 rounded-lg border border-dashed border-parchment/15 text-xs text-parchment/60 transition-opacity duration-300 ${rendered ? 'opacity-0' : 'opacity-100'}`}
          >
            <ShieldCheck className="h-4 w-4 text-parchment/40" />
            Checking that you’re human…
          </div>
        )}
        {/* No line box around the widget's inline frame (`text-[0px] leading-none`): it would
            add a few pixels under the 65px frame and shift the form when the widget appears. */}
        <div
          ref={ref}
          className="relative flex min-h-[65px] w-full justify-center text-[0px] leading-none"
          data-testid="turnstile"
        />
      </div>
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
