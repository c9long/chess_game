/**
 * The game's mark (four seat corners around a star), for auth cards. Same motif as the header
 * emblem. Decorative: the page title carries the meaning.
 */
export function BrandMark({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="brandmark-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6b42a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#8a6a1c" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill="rgb(212 160 23 / 0.12)"
        stroke="url(#brandmark-rim)"
        strokeWidth="1.25"
      />
      <rect x="6" y="6" width="5" height="5" rx="0.8" className="fill-seat-south" />
      <rect x="21" y="6" width="5" height="5" rx="0.8" className="fill-seat-north" />
      <rect x="6" y="21" width="5" height="5" rx="0.8" className="fill-seat-west" />
      <rect x="21" y="21" width="5" height="5" rx="0.8" className="fill-seat-east" />
      <path
        d="M16 9l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"
        className="fill-parchment"
      />
    </svg>
  )
}
