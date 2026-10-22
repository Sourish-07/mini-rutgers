/**
 * The design system, in one place.
 *
 * Tokens live in `index.css` (@theme); this file is the vocabulary every panel
 * speaks, so the overlay stays one instrument instead of a pile of cards.
 * Corners are square, borders are hairlines, numbers are mono and tabular, and
 * scarlet is the only loud colour in the room.
 */
import type { ReactNode } from 'react'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ surfaces */

export const PANEL =
  'pointer-events-auto border border-ink-100/10 bg-ink-950/88 backdrop-blur-[3px] shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.9)]'

export const PANEL_HEAD = 'flex items-center justify-between gap-3 border-b border-ink-100/10 px-3 py-2'

export const PANEL_BODY = 'px-3 py-2.5'

/* -------------------------------------------------------------------- type */

export const EYEBROW = 'font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-ink-400'
export const LABEL = 'text-[11px] leading-tight text-ink-300'
export const FIG = 'font-mono text-[11.5px] tabular-nums text-ink-100'
export const FIG_BIG = 'font-mono text-[26px] leading-none tabular-nums text-ink-100'
export const FIG_DIM = 'font-mono text-[10px] tabular-nums text-ink-400'
export const NOTE = 'text-[10px] leading-snug text-ink-500'
export const H1 = 'text-[13px] font-semibold tracking-tight text-ink-100'

/** the small scarlet tick that opens every panel heading */
export const TICK = 'h-[9px] w-[3px] bg-scarlet-500'

/* ----------------------------------------------------------------- controls */

export const BTN_BASE =
  'inline-flex items-center justify-center gap-1 border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'

export const BTN = {
  ghost:
    'border-ink-100/12 bg-transparent px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:border-ink-100/25 hover:text-ink-100',
  solid:
    'border-scarlet-500 bg-scarlet-500 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-white hover:bg-scarlet-400',
  quiet:
    'border-ink-100/10 bg-ink-850 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-ink-300 hover:text-ink-100 hover:border-ink-100/25',
} as const

export const SEG_WRAP = 'inline-flex divide-x divide-ink-100/10 border border-ink-100/12'
export const SEG_ON = 'bg-scarlet-500 px-2 py-1 text-[10px] font-mono text-white'
export const SEG_OFF = 'bg-transparent px-2 py-1 text-[10px] font-mono text-ink-400 hover:text-ink-100'

export const INPUT =
  'w-full border border-ink-100/12 bg-ink-950/70 px-2 py-1.5 text-[11.5px] text-ink-100 placeholder:text-ink-500 focus:border-scarlet-500/70 focus:outline-none'

/* -------------------------------------------------------------------- tone */

export const TONE = {
  live: 'text-signal-live',
  warn: 'text-signal-warn',
  bad: 'text-scarlet-300',
  cold: 'text-signal-cold',
  dim: 'text-ink-500',
} as const

export type Tone = keyof typeof TONE

export type ChipTone = 'live' | 'warn' | 'scarlet' | 'neutral'

const CHIP_TONE: Record<ChipTone, string> = {
  live: 'border-signal-live/35 text-signal-live',
  warn: 'border-signal-warn/35 text-signal-warn',
  scarlet: 'border-scarlet-500/45 text-scarlet-300',
  neutral: 'border-ink-100/15 text-ink-400',
}

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em]',
        CHIP_TONE[tone],
      )}
    >
      {children}
    </span>
  )
}

/** a live-state dot: the honest replacement for a "5G UWB" badge */
export function Dot({ tone = 'live', pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className={cx('relative inline-block h-[6px] w-[6px] rounded-full bg-current', TONE[tone])}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60" />}
    </span>
  )
}
