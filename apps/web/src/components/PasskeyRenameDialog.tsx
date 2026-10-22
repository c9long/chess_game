import { type FormEvent, type RefObject, useState } from 'react'
import { Dialog, DialogClose } from './overlay.tsx'
import { Button, Field } from './ui.tsx'

/**
 * Rename a passkey. Loaded with React.lazy from the Account page, which is in the entry chunk,
 * so the dialog library only downloads when someone renames a key.
 *
 * It opens on mount. Closing plays the exit animation, puts focus back on `returnFocusTo` (the
 * Rename button) and only then calls `onClose`, so the parent can unmount it.
 */
export default function PasskeyRenameDialog({
  initialName,
  onSave,
  onClose,
  returnFocusTo,
}: {
  initialName: string
  onSave: (name: string) => Promise<void>
  onClose: () => void
  returnFocusTo?: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed) return
    setBusy(true)
    try {
      await onSave(trimmed.slice(0, 64))
    } finally {
      setBusy(false)
    }
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      {...(returnFocusTo ? { returnFocusTo } : {})}
      title="Rename passkey"
      description="Pick a name that tells your devices apart, like “Work laptop”."
    >
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Field
          label="Name"
          value={name}
          maxLength={64}
          autoFocus
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          data-testid="passkey-rename-input"
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose>
            <Button variant="quiet">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            busy={busy}
            disabled={!trimmed || trimmed === initialName}
            data-testid="passkey-rename-save"
          >
            Save name
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
