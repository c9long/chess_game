import { type RefObject, useState } from 'react'
import { ConfirmDialog } from './overlay.tsx'

/**
 * Confirm removing a passkey. Loaded with React.lazy from the Account page (entry chunk), like
 * PasskeyRenameDialog, so the dialog library only downloads when it is needed.
 *
 * It opens on mount. Closing plays the exit animation, puts focus back on `returnFocusTo` (the
 * Remove button) and only then calls `onClose`, so the parent can unmount it.
 */
export default function PasskeyRemoveDialog({
  name,
  onRemove,
  onClose,
  returnFocusTo,
}: {
  name: string
  onRemove: () => Promise<void>
  onClose: () => void
  returnFocusTo?: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onRemove()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) setOpen(o)
      }}
      onClosed={onClose}
      {...(returnFocusTo ? { returnFocusTo } : {})}
      title="Remove passkey?"
      description={<>You won’t be able to sign in with “{name}” any more.</>}
      confirmLabel="Remove passkey"
      tone="danger"
      busy={busy}
      onConfirm={() => void confirm()}
      testId="passkey-remove-dialog"
      confirmTestId="passkey-remove-confirm"
    />
  )
}
