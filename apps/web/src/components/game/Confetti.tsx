import { motion } from 'motion/react'
import { useMemo } from 'react'

/** A short burst of falling confetti inside the parent (which must be `relative`). */
export function Confetti({ colors, count = 24 }: { colors: readonly string[]; count?: number }) {
  const pieces = useMemo(() => {
    // A fixed pseudo-random spread, so a re-render never reshuffles the pieces mid-fall.
    let seed = 7
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: 4 + rnd() * 92,
      drift: (rnd() - 0.5) * 80,
      spin: (rnd() - 0.5) * 720,
      delay: rnd() * 0.35,
      duration: 1.1 + rnd() * 0.5,
      w: 5 + rnd() * 4,
      h: 8 + rnd() * 6,
      round: rnd() > 0.7,
      color: colors[i % colors.length] ?? '#d4a017',
    }))
  }, [colors, count])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 block"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.round ? p.w : p.h,
            borderRadius: p.round ? '9999px' : '2px',
            backgroundColor: p.color,
          }}
          initial={{ y: -24, x: 0, rotate: 0, opacity: 0 }}
          animate={{
            y: [-24, 220, 460],
            x: [0, p.drift * 0.6, p.drift],
            rotate: p.spin,
            opacity: [0, 1, 1, 0],
          }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}
