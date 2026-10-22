/**
 * The console furniture: panels, data rows, meters, segmented controls and
 * buttons. Every overlay in the app is built from these, so the interface reads
 * as one instrument rather than a pile of cards.
 */
import type { ReactNode } from 'react'
import {
  BTN,
  cx,
  EYEBROW,
  NOTE,
  PANEL,
  PANEL_BODY,
  PANEL_HEAD,
  SEG_OFF,
  SEG_ON,
  SEG_WRAP,
  TICK,
  TONE,
  type Tone,
} from './theme'

export function Panel({
  title,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: string
  /** right-hand side of the title bar: counts, chips, a select */
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cx(PANEL, 'w-full', className)}>
      <header className={PANEL_HEAD}>
        <h2 className="flex min-w-0 items-center gap-2">
          <span className={TICK} />
          <span className={cx(EYEBROW, 'truncate')}>{title}</span>
        </h2>
        {aside && (
          <div className="flex shrink-0 items-center gap-2 font-mono text-[9.5px] text-ink-500">{aside}</div>
        )}
      </header>
      <div className={cx(PANEL_BODY, bodyClassName)}>{children}</div>
    </section>
  )
}

/** a label/value line; the leader keeps long labels from colliding with numbers */
export function Row({
  label,
  value,
  unit,
  delta,
  tone,
  hint,
}: {
  label: string
  value: string
  unit?: string
  /** signed change against the baseline, already formatted */
  delta?: { text: string; good?: boolean }
  tone?: Tone
  hint?: string
}) {
  return (
    <div className="flex items-baseline gap-2 py-[3px]" title={hint}>
      <span className="shrink-0 text-[11.5px] text-ink-300">{label}</span>
      <span className="min-w-2 flex-1 translate-y-[-3px] border-b border-dotted border-ink-500/40" />
      <span
        className={cx('shrink-0 font-mono text-[11.5px] tabular-nums', tone ? TONE[tone] : 'text-ink-100')}
      >
        {value}
      </span>
      {unit && <span className="shrink-0 font-mono text-[9.5px] text-ink-500">{unit}</span>}
      {delta && (
        <span
          className={cx(
            'w-[3.5rem] shrink-0 text-right font-mono text-[10px] tabular-nums',
            delta.good === undefined ? 'text-ink-500' : delta.good ? 'text-signal-live' : 'text-scarlet-300',
          )}
        >
          {delta.text}
        </span>
      )}
    </div>
  )
}

/** a thin bar for a 0..100 need */
export function Meter({
  label,
  value,
  tone = 'cold',
  suffix,
}: {
  label: string
  value: number
  tone?: Tone
  suffix?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-2 py-[3px]">
      <span className="w-[42px] shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-500">
        {label}
      </span>
      <span className="relative h-[5px] flex-1 bg-ink-800">
        <span className={cx('absolute inset-y-0 left-0 bg-current', TONE[tone])} style={{ width: `${v}%` }} />
      </span>
      <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-300">
        {suffix ?? Math.round(v)}
      </span>
    </div>
  )
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; title?: string }[]
  value: T
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-500">{label}</span>
      )}
      <div className={SEG_WRAP}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={value === o.value ? SEG_ON : SEG_OFF}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  title,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: keyof typeof BTN
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(BTN[variant], className)}
      type="button"
    >
      {children}
    </button>
  )
}

/** the honest little footnote every panel ends with */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className={cx('mt-2 border-t border-ink-100/8 pt-1.5', NOTE)}>{children}</p>
}
