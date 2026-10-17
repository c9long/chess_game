/**
 * Accessible overlay primitives (dialogs, confirm dialogs, tooltips, toasts) built on Radix UI
 * and styled with our tokens. See docs/ui-libraries.md.
 *
 * Bundle rule: import this module only from lazily loaded code (a lazy page, or a component
 * loaded with React.lazy), never from an eagerly loaded page or from ui.tsx, so Radix stays out
 * of the entry chunk.
 */
import { X } from 'lucide-react'
import { AlertDialog, Dialog as RadixDialog, Tooltip as RadixTooltip, Toast } from 'radix-ui'
import {
  createContext,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { Button, cx } from './ui.tsx'

const overlayClass =
  'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in'

const contentClass =
  'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem-var(--safe-left)-var(--safe-right))] max-w-md -translate-x-1/2 -translate-y-1/2 ' +
  // Tall dialogs scroll inside the screen's safe area (notch and home indicator).
  'max-h-[calc(100dvh-2rem-var(--safe-top)-var(--safe-bottom))] overflow-y-auto ' +
  'rounded-2xl border border-parchment/10 bg-panel p-6 text-parchment shadow-2xl shadow-black/60 ring-1 ring-black/30 sm:p-7 ' +
  'focus:outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in'

/**
 * A modal dialog: focus is trapped and returned, Escape and outside clicks close it, and the
 * title and description are wired to `aria-labelledby` / `aria-describedby`.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  trigger,
  returnFocusTo,
  onClosed,
  testId,
  className,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  /** Buttons at the bottom right (wrap a cancel button in `DialogClose`). */
  actions?: ReactNode
  /** Optional trigger element (our Button or Link); it receives the open handler. */
  trigger?: ReactElement
  /**
   * Where focus goes when a dialog opened without `trigger` closes (usually the button that
   * opened it). Without either, focus would fall back to the page body.
   */
  returnFocusTo?: RefObject<HTMLElement | null>
  /** Runs once the dialog has fully closed (after its exit animation). */
  onClosed?: () => void
  /** `data-testid` on the dialog content. */
  testId?: string
  /** Extra classes on the dialog content (e.g. a tinted border). */
  className?: string
}) {
  return (
    <RadixDialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          className={cx(contentClass, className)}
          data-testid={testId}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onCloseAutoFocus={(e) => {
            const target = returnFocusTo?.current
            if (target?.isConnected) {
              e.preventDefault()
              target.focus()
            }
            onClosed?.()
          }}
        >
          <RadixDialog.Title className="pr-8 font-display text-xl font-semibold tracking-tight">
            {title}
          </RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-2 text-sm leading-relaxed text-parchment/65">
              {description}
            </RadixDialog.Description>
          ) : null}
          {children ? <div className="mt-5">{children}</div> : null}
          {actions ? (
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {actions}
            </div>
          ) : null}
          <RadixDialog.Close
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-md text-parchment/55 transition-colors hover:bg-parchment/5 hover:text-parchment"
            aria-label="Close"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Wrap a button so it closes the surrounding `Dialog`. */
export function DialogClose({ children }: { children: ReactElement }) {
  return <RadixDialog.Close asChild>{children}</RadixDialog.Close>
}

/**
 * A confirmation (`role="alertdialog"`): it can't be dismissed by an outside click, and the
 * cancel button gets the initial focus.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  trigger,
  returnFocusTo,
  onClosed,
  testId,
  confirmTestId,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  trigger?: ReactElement
  /** Where focus goes on close when the dialog opened without `trigger`. */
  returnFocusTo?: RefObject<HTMLElement | null>
  /** Runs once the dialog has fully closed (after its exit animation). */
  onClosed?: () => void
  /** `data-testid` on the dialog content and on the confirm button. */
  testId?: string
  confirmTestId?: string
}) {
  return (
    <AlertDialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClass} />
        <AlertDialog.Content
          className={contentClass}
          data-testid={testId}
          {...(description ? {} : { 'aria-describedby': undefined })}
          onCloseAutoFocus={(e) => {
            const target = returnFocusTo?.current
            if (target?.isConnected) {
              e.preventDefault()
              target.focus()
            }
            onClosed?.()
          }}
        >
          <AlertDialog.Title className="font-display text-xl font-semibold tracking-tight">
            {title}
          </AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-parchment/65">
              {description}
            </AlertDialog.Description>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              busy={busy}
              onClick={onConfirm}
              data-testid={confirmTestId}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/** Put once around a subtree that uses `Tooltip` (shares the open delay). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={300} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  )
}

/**
 * A short hint on hover and keyboard focus. The trigger must be focusable (a button or link).
 * Touch devices don't show tooltips, so never put essential information only here.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-xs rounded-md border border-parchment/10 bg-panel px-2.5 py-1.5 text-xs leading-snug text-parchment shadow-lg shadow-black/50 data-[state=closed]:animate-overlay-out data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-pop-in"
        >
          {content}
          <RadixTooltip.Arrow className="fill-panel" width={10} height={5} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

export interface ToastInput {
  title: string
  description?: ReactNode
  tone?: 'info' | 'success' | 'error'
  /** Milliseconds; default 4000 (errors 6000). */
  duration?: number
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null)

/** `const toast = useToast(); toast({ title: 'Saved' })` inside a `ToastViewport`. */
export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastViewport>')
  return ctx
}

let nextToastId = 1

/**
 * Hosts toasts for its subtree: a live region (polite; errors assertive), F8 to jump to it,
 * swipe to dismiss on touch.
 */
export function ToastViewport({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: ToastInput) => {
    const id = nextToastId++
    // Phones show one toast at a time (a newer one replaces it), so a burst doesn't cover the
    // lobby or game controls; wider screens stack up to four.
    const narrow =
      typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches
    setItems((list) => [...(narrow ? [] : list.slice(-3)), { ...t, id }])
  }, [])
  const value = useMemo(() => push, [push])
  const accents = {
    info: 'before:bg-seat-west',
    success: 'before:bg-seat-east',
    error: 'before:bg-seat-south',
  }
  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right">
        {children}
        {items.map((t) => (
          <Toast.Root
            key={t.id}
            type={t.tone === 'error' ? 'foreground' : 'background'}
            duration={t.duration ?? (t.tone === 'error' ? 6000 : 4000)}
            onOpenChange={(open) => {
              if (!open) setItems((list) => list.filter((x) => x.id !== t.id))
            }}
            className={cx(
              'relative overflow-hidden rounded-xl border border-parchment/10 bg-panel py-3 pr-10 pl-5 text-sm text-parchment shadow-xl shadow-black/50',
              'before:absolute before:inset-y-0 before:left-0 before:w-1',
              accents[t.tone ?? 'info'],
              'data-[state=closed]:animate-overlay-out data-[state=open]:animate-toast-in',
              'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=end]:animate-overlay-out',
            )}
          >
            <Toast.Title className="font-semibold">{t.title}</Toast.Title>
            {t.description ? (
              <Toast.Description className="mt-0.5 text-parchment/70">
                {t.description}
              </Toast.Description>
            ) : null}
            <Toast.Close
              className="absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded text-parchment/50 hover:text-parchment"
              aria-label="Dismiss"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed right-[var(--safe-right)] bottom-[var(--safe-bottom)] z-[60] m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  )
}
