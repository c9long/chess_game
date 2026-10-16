import { BOT_LEVELS, CIVILIZATIONS } from '@game/config'
import type { SeatStateJson } from '@game/protocol/state'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { leaveMatch, type MatchRoom, matchApi } from '../../lib/match.ts'
import type { MatchFeed } from '../../pages/Match.tsx'
import { CivEmblem, civName } from '../CivEmblem.tsx'
import { Button } from '../ui.tsx'
import { MODE_LABEL, SEAT_LABEL, seatColorName, seatHex, seatName, teamLabel } from './seats.ts'

const LEVEL_LABELS = BOT_LEVELS.map(String)

function levelText(level: string): string {
  return level === 'max' ? 'Max' : level
}

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'gold' | 'ok' }) {
  const tones = {
    muted: 'border-parchment/20 text-parchment/65',
    gold: 'border-gold/50 bg-gold/10 text-gold',
    ok: 'border-seat-east/50 bg-seat-east/10 text-[#7fd8b7]',
  }
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

const selectClass =
  'h-9 rounded-lg border border-parchment/20 bg-ink/70 px-2 text-sm text-parchment outline-none focus:border-gold'

function SeatCard({
  index,
  seat,
  me,
  viewerIsHost,
  hostSeat,
  mode,
  send,
}: {
  index: number
  seat: SeatStateJson
  me: boolean
  viewerIsHost: boolean
  hostSeat: number
  mode: string
  send: ReturnType<typeof matchApi>['send']
}) {
  const [level, setLevel] = useState('1200')
  const color = seatHex(index)
  const others = [0, 1, 2, 3].filter((i) => i !== index)

  return (
    <article
      className="relative flex min-h-36 flex-col gap-3 overflow-hidden rounded-2xl border bg-panel/85 p-4"
      style={{ borderColor: `${color}66` }}
      data-testid={`seat-${seatName(index)}`}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <header className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.18em]">
        <span className="font-semibold" style={{ color }}>
          {SEAT_LABEL[seatName(index)]} · {seatColorName(index)}
        </span>
        {mode === 'teams' ? (
          <span className="text-parchment/45 normal-case tracking-normal">
            {teamLabel(index % 2)}
          </span>
        ) : null}
      </header>

      {seat.occupied ? (
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border bg-ink/60"
            style={{ borderColor: `${color}99`, color }}
          >
            <CivEmblem civ={seat.civ} className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-semibold">
              <CivEmblem civ={seat.civ} className="h-4 w-4 text-parchment/80" />
              <span className="truncate" data-testid="seat-name">
                {seat.isBot ? `Bot · ${levelText(seat.botLevel)}` : seat.displayName}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-parchment/55">
              {seat.civ ? civName(seat.civ) : 'Choosing a civilization…'}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {me ? <Badge tone="gold">You</Badge> : null}
              {hostSeat === index ? <Badge>Host</Badge> : null}
              {seat.isGuest ? <Badge>Guest</Badge> : null}
              {seat.isBot ? null : seat.ready ? (
                <Badge tone="ok">Ready</Badge>
              ) : (
                <Badge>Not ready</Badge>
              )}
              {!seat.isBot && !seat.connected ? <Badge>Reconnecting</Badge> : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-2">
          <p className="text-sm text-parchment/50">Open seat</p>
          {viewerIsHost ? (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`bot-level-${index}`}>
                Bot strength
              </label>
              <select
                id={`bot-level-${index}`}
                className={selectClass}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                data-testid="bot-level"
              >
                {LEVEL_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {l === 'max' ? 'Max strength' : `ELO ${l}`}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                className="h-9 px-3"
                onClick={() =>
                  send('addBot', { seat: index as 0 | 1 | 2 | 3, level: level as never })
                }
                data-testid="add-bot"
              >
                Add bot
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {viewerIsHost && seat.occupied ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-parchment/10 pt-3">
          {seat.isBot ? (
            <>
              <label className="sr-only" htmlFor={`bot-civ-${index}`}>
                Bot civilization
              </label>
              <select
                id={`bot-civ-${index}`}
                className={selectClass}
                value={seat.civ}
                onChange={(e) =>
                  send('setBotCiv', { seat: index as 0 | 1 | 2 | 3, civ: e.target.value as never })
                }
              >
                {CIVILIZATIONS.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                className="h-9 px-3"
                onClick={() => send('removeBot', { seat: index as 0 | 1 | 2 | 3 })}
              >
                Remove
              </Button>
            </>
          ) : !me ? (
            <Button
              variant="ghost"
              className="h-9 px-3"
              onClick={() => send('kick', { seat: index as 0 | 1 | 2 | 3 })}
            >
              Kick
            </Button>
          ) : null}
          <label className="sr-only" htmlFor={`swap-${index}`}>
            Swap seat
          </label>
          <select
            id={`swap-${index}`}
            className={`${selectClass} ml-auto`}
            value=""
            onChange={(e) =>
              e.target.value &&
              send('swapSeats', {
                a: index as 0 | 1 | 2 | 3,
                b: Number(e.target.value) as 0 | 1 | 2 | 3,
              })
            }
          >
            <option value="">Swap with…</option>
            {others.map((o) => (
              <option key={o} value={o}>
                {SEAT_LABEL[seatName(o)]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </article>
  )
}

function CivPicker({
  value,
  disabled,
  onPick,
}: {
  value: string
  disabled: boolean
  onPick: (civ: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Civilization">
      {CIVILIZATIONS.map((c) => {
        const active = c.slug === value
        return (
          // biome-ignore lint/a11y/useSemanticElements: styled tile in a radiogroup
          <button
            key={c.slug}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onPick(c.slug)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-gold bg-gold/15 text-parchment'
                : 'border-parchment/15 text-parchment/70 hover:border-parchment/40 hover:text-parchment'
            }`}
            data-testid={`civ-${c.slug}`}
          >
            <CivEmblem civ={c.slug} className={`h-9 w-9 ${active ? 'text-gold' : ''}`} />
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [])
  const secs = Math.max(1, Math.ceil((endsAt - now) / 1000))
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-ink/75 backdrop-blur-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-gold/80">
        Game starting
      </p>
      <p className="mt-4 font-display text-8xl font-semibold" aria-live="assertive">
        {secs}
      </p>
    </div>
  )
}

export function LobbyRoom({ room, feed }: { room: MatchRoom; feed: MatchFeed }) {
  const navigate = useNavigate()
  const { state, mySeat } = feed
  const send = useMemo(() => matchApi(room).send, [room])
  const [copied, setCopied] = useState(false)
  const me = mySeat >= 0 ? state.seats[mySeat] : undefined
  const viewerIsHost = mySeat >= 0 && state.hostSeat === mySeat
  const everyoneReady = state.seats.every(
    (s) => s.occupied && s.civ && (s.isBot || (s.ready && s.connected)),
  )
  const canStart = viewerIsHost && state.phase === 'civ_select' && everyoneReady

  async function leave() {
    await leaveMatch()
    navigate('/play')
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const seatCard = (i: number) => {
    const seat = state.seats[i]
    if (!seat) return null
    return (
      <SeatCard
        index={i}
        seat={seat}
        me={i === mySeat}
        viewerIsHost={viewerIsHost}
        hostSeat={state.hostSeat}
        mode={state.mode}
        send={send}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold/80">
            {state.hasPassword ? 'Private lobby' : 'Public lobby'}
          </p>
          <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight">
            {state.name}
          </h1>
          <p className="mt-1 text-sm text-parchment/60">
            {MODE_LABEL[state.mode]} · {state.timeControl} · Blind pick ·{' '}
            {state.seats.filter((s) => s.occupied).length}/4 seated
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="h-10" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy invite link'}
          </Button>
          <Button variant="ghost" className="h-10" onClick={leave} data-testid="leave-lobby">
            Leave
          </Button>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <section aria-label="Seats" className="grid gap-4 sm:grid-cols-3 sm:grid-rows-3">
          <div className="sm:col-start-2 sm:row-start-1">{seatCard(2)}</div>
          <div className="sm:col-start-1 sm:row-start-2">{seatCard(1)}</div>
          <div className="hidden items-center justify-center sm:col-start-2 sm:row-start-2 sm:flex">
            <MiniBoard />
          </div>
          <div className="sm:col-start-3 sm:row-start-2">{seatCard(3)}</div>
          <div className="sm:col-start-2 sm:row-start-3">{seatCard(0)}</div>
        </section>

        <aside className="flex flex-col gap-6">
          {me ? (
            <section className="rounded-2xl border border-parchment/10 bg-panel/85 p-5">
              <h2 className="mb-1 font-display text-lg font-semibold">Your civilization</h2>
              <p className="mb-4 text-xs text-parchment/55">
                For now a civilization is your emblem; special abilities arrive in a later update.
              </p>
              <CivPicker
                value={me.civ}
                disabled={me.ready}
                onPick={(civ) => send('setCiv', { civ: civ as never })}
              />
              <Button
                className="mt-5 w-full"
                variant={me.ready ? 'secondary' : 'primary'}
                disabled={!me.civ}
                onClick={() => send('setReady', { ready: !me.ready })}
                data-testid="ready"
              >
                {me.ready ? 'Not ready' : me.civ ? 'Ready' : 'Choose a civilization'}
              </Button>
            </section>
          ) : (
            <p className="text-sm text-parchment/60">You are watching this lobby.</p>
          )}

          {viewerIsHost ? (
            <section className="rounded-2xl border border-gold/30 bg-gold/5 p-5">
              <h2 className="mb-1 font-display text-lg font-semibold">Host</h2>
              <p className="mb-4 text-xs text-parchment/60">
                Fill empty seats with bots, choose teams by swapping seats, then start when everyone
                is ready.
              </p>
              <Button
                className="w-full"
                disabled={!canStart}
                onClick={() => send('startGame', {})}
                data-testid="start-game"
              >
                Start game
              </Button>
              {!canStart ? (
                <p className="mt-2 text-xs text-parchment/50">
                  {state.seats.some((s) => !s.occupied)
                    ? 'Waiting for 4 players (or add bots).'
                    : 'Waiting for every player to choose a civilization and be ready.'}
                </p>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>

      {state.phase === 'countdown' ? <Countdown endsAt={state.countdownEndsAt} /> : null}
    </div>
  )
}

/** A small decorative board with the four seat colours on their home edges. */
function MiniBoard() {
  const cells = Array.from({ length: 144 }, (_, i) => i)
  return (
    <div className="relative aspect-square w-full max-w-56 rounded-lg border border-parchment/15 p-2 shadow-2xl shadow-black/50">
      <div className="grid h-full w-full grid-cols-12 overflow-hidden rounded">
        {cells.map((i) => {
          const f = i % 12
          const r = Math.floor(i / 12)
          return (
            <span
              key={i}
              className={(f + r) % 2 === 0 ? 'bg-[#e4cfa3]' : 'bg-[#8b623d]'}
              aria-hidden="true"
            />
          )
        })}
      </div>
      <span
        className="absolute inset-x-6 bottom-0 h-1 rounded"
        style={{ background: seatHex(0) }}
      />
      <span className="absolute inset-y-6 left-0 w-1 rounded" style={{ background: seatHex(1) }} />
      <span className="absolute inset-x-6 top-0 h-1 rounded" style={{ background: seatHex(2) }} />
      <span className="absolute inset-y-6 right-0 w-1 rounded" style={{ background: seatHex(3) }} />
    </div>
  )
}
