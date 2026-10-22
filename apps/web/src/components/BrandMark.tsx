/**
 * The game's mark: a baize table with a brass edge, a seat on each side in its seat colour
 * (North at the top, South at the bottom) and a star at the centre. Used in the header and on
 * auth cards. Decorative: the page title or link text carries the meaning.
 */
export function BrandMark({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect
        x="6.5"
        y="6.5"
        width="19"
        height="19"
        rx="2.5"
        className="fill-baize stroke-brass"
        strokeWidth="1.25"
      />
      <rect x="10.5" y="1.5" width="11" height="3" rx="1.5" className="fill-seat-north" />
      <rect x="27.5" y="10.5" width="3" height="11" rx="1.5" className="fill-seat-east" />
      <rect x="10.5" y="27.5" width="11" height="3" rx="1.5" className="fill-seat-south" />
      <rect x="1.5" y="10.5" width="3" height="11" rx="1.5" className="fill-seat-west" />
      <path
        d="M16 9l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"
        transform="translate(16 16.2) scale(0.78) translate(-16 -16.2)"
        className="fill-parchment"
      />
    </svg>
  )
}
