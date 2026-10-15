import { ARBITRATION_NOTICE, DISPUTE_OPTION } from '@game/config'
import { Link } from 'react-router'

const linkClass = 'font-semibold text-gold underline-offset-2 hover:underline'

/**
 * Clickwrap notice (PLAN §8): an unchecked box with the links right beside it and no age
 * claim. The Terms are agreed to; the Privacy Policy is acknowledged. Callers keep their
 * continue (and OAuth) buttons disabled until it is checked.
 */
export function Clickwrap({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-parchment/15 bg-ink/40 p-4 text-sm leading-relaxed">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-gold"
          data-testid="clickwrap-checkbox"
        />
        <span>
          I agree to the{' '}
          <Link to="/terms" target="_blank" rel="noopener" className={linkClass}>
            Terms of Service
          </Link>{' '}
          and acknowledge that I have read the{' '}
          <Link to="/privacy" target="_blank" rel="noopener" className={linkClass}>
            Privacy Policy
          </Link>
        </span>
      </label>
      {DISPUTE_OPTION === 'A' ? (
        <p className="px-1 text-xs text-parchment/60" data-testid="arbitration-notice">
          {ARBITRATION_NOTICE}
        </p>
      ) : null}
    </div>
  )
}
