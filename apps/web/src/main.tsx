import { APP_NAME } from '@game/config'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App.tsx'
import './index.css'

document.title = APP_NAME

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')

// Optional error tracking (VITE_SENTRY_DSN; lib/monitoring.ts). Errors before the SDK loads,
// such as a crash in the first render (React reports those to the window), are kept and sent
// once it starts. Builds without a DSN drop this block and the SDK chunk entirely.
if (import.meta.env.VITE_SENTRY_DSN) {
  const early: unknown[] = []
  const keep = (e: ErrorEvent | PromiseRejectionEvent) => {
    if (early.length < 20) early.push('reason' in e ? e.reason : (e.error ?? e.message))
  }
  window.addEventListener('error', keep)
  window.addEventListener('unhandledrejection', keep)
  const start = () =>
    void import('./lib/monitoring.ts')
      .then((m) => {
        window.removeEventListener('error', keep)
        window.removeEventListener('unhandledrejection', keep)
        m.startErrorTracking(early)
      })
      .catch(() => {}) // offline or a new deploy: the page works without it
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 5_000 })
  else setTimeout(start, 2_000)
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
