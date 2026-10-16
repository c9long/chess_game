/** Small inline icons for the game screens (decorative: always aria-hidden). */

type IconProps = { className?: string }

export function GearIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M18.48 8.59 L18.48 11.41 L16.41 11.59 L15.65 13.40 L17.00 15.00 L15.00 17.00 L13.40 15.65 L11.59 16.41 L11.41 18.48 L8.59 18.48 L8.41 16.41 L6.60 15.65 L5.00 17.00 L3.00 15.00 L4.35 13.40 L3.59 11.59 L1.52 11.41 L1.52 8.59 L3.59 8.41 L4.35 6.60 L3.00 5.00 L5.00 3.00 L6.60 4.35 L8.41 3.59 L8.59 1.52 L11.41 1.52 L11.59 3.59 L13.40 4.35 L15.00 3.00 L17.00 5.00 L15.65 6.60 L16.41 8.41Z M10 7.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6Z"
      />
    </svg>
  )
}

export function CrownIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <path d="M2.5 6.2a1 1 0 0 1 1.56-.83L7 7.4l2.2-3.85a.9.9 0 0 1 1.56 0L13 7.4l2.94-2.03a1 1 0 0 1 1.56.83l-.9 7.6a1 1 0 0 1-1 .88H4.4a1 1 0 0 1-1-.88l-.9-7.6ZM4.5 16h11a.75.75 0 0 1 0 1.5h-11a.75.75 0 0 1 0-1.5Z" />
    </svg>
  )
}

export function CheckIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  )
}

export function FlagIcon({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="currentColor">
      <path d="M3 1.5a.75.75 0 0 1 .75.75v.32l1.06-.27a6 6 0 0 1 3.6.2l.4.15a4.5 4.5 0 0 0 2.92.1l1.07-.33a.75.75 0 0 1 .97.72v6.5a.75.75 0 0 1-.53.72l-1.07.33a6 6 0 0 1-3.9-.13l-.4-.15a4.5 4.5 0 0 0-2.7-.15l-1.42.36v4.63a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 3 1.5Z" />
    </svg>
  )
}

export function ExitIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" />
    </svg>
  )
}

export function ClockIcon({ className = 'h-3.5 w-3.5' }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.3 1.5" />
    </svg>
  )
}

export function CopyIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    >
      <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
      <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6a1.5 1.5 0 0 0 1.5 1.5H7" />
    </svg>
  )
}

export function DotsIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true" fill="currentColor">
      <circle cx="4.5" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="15.5" cy="10" r="1.6" />
    </svg>
  )
}

export function LockIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path
        d="M6 8V6a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 16 9.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16.5v-7A1.5 1.5 0 0 1 5.5 8H6Zm2 0h4V6a2 2 0 1 0-4 0v2Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function PlusIcon({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  )
}

export function MenuIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </svg>
  )
}
