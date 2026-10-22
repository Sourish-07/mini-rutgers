/**
 * The operator overlay: the title bar, the two populations, stop telemetry, the
 * queue forecast, the map labels and the status strip.
 *
 * Everything is a projection of engine state — the panels sample the sims a few
 * times a second on the React clock while the scene runs at frame rate, and the
 * two clocks never touch.
 */
import { useState } from 'react'
import { CAPACITY, ROUTES, STOPS, type Sim } from '../engine/sim'
import type { Mind } from '../engine/mind/engine.ts'
import { Btn, Panel, Seg } from './Panel'
import { Sparkline } from './Sparkline'
import { Dot, cx, EYEBROW, NOTE } from './theme'
import type { Imagery, ScreenLabel } from '../render/scene'

export const fmt = (min: number) => {
  const t = Math.floor(min) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** the stops that carry a live sensor, one per major node */
const NODES = ['arc', 'bsc', 'livSc', 'cas', 'quads', 'hill', 'science', 'yard', 'biel', 'redoak']

/* ------------------------------------------------------------------ top bar */

export function TopBar({
  minute,
  speed,
  setSpeed,
  running,
  setRunning,
  imagery,
  setImagery,
}: {
  minute: number
  speed: number
  setSpeed: (n: number) => void
  running: boolean
  setRunning: (b: boolean) => void
  imagery: Imagery
  setImagery: (i: Imagery) => void
}) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-stretch justify-between gap-3 p-3">
      {/* the wordmark */}
      <div className="pointer-events-auto flex items-center gap-3 border border-ink-100/10 bg-ink-950/88 px-3 py-2 backdrop-blur-[3px]">
        <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0" aria-hidden>
          <polygon points="16,3 28,9.9 16,16.8 4,9.9" fill="#ff5a6e" />
          <polygon points="4,9.9 16,16.8 16,30 4,23.1" fill="#7d0d1d" />
          <polygon points="16,16.8 28,9.9 28,23.1 16,30" fill="#cc0015" />
        </svg>
        <div className="leading-none">
          <h1 className="text-[13px] font-semibold tracking-[0.02em] text-ink-100">CAMPUS MOTION</h1>
          <p className="mt-[3px] font-mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
            Rutgers–New Brunswick · simulated Tuesday
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        {/* the clock and the playback controls */}
        <div className="pointer-events-auto flex items-center gap-3 border border-ink-100/10 bg-ink-950/88 px-3 py-2 backdrop-blur-[3px]">
          <div className="leading-none">
            <div className="font-mono text-[19px] tabular-nums text-ink-100">{fmt(minute)}</div>
            <div className="mt-[3px] font-mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
              {running ? 'running' : 'paused'} · {speed}×
            </div>
          </div>
          <span className="h-8 w-px bg-ink-100/10" />
          <Btn variant="quiet" onClick={() => setRunning(!running)} className="w-[58px]">
            {running ? 'Pause' : 'Play'}
          </Btn>
          <Seg
            options={[1, 10, 60, 240].map((s) => ({ value: s, label: `${s}×` }))}
            value={speed}
            onChange={setSpeed}
          />
        </div>

        {/* what the map is drawn on */}
        <div className="pointer-events-auto flex items-center gap-2 border border-ink-100/10 bg-ink-950/88 px-3 py-2 backdrop-blur-[3px]">
          <Seg
            label="base"
            options={[
              {
                value: 'designed' as Imagery,
                label: 'map',
                title: 'Designed vector ground (sharp at any zoom)',
              },
              {
                value: 'satellite' as Imagery,
                label: 'aerial',
                title: 'Baked satellite imagery (fixed resolution)',
              },
            ]}
            value={imagery}
            onChange={setImagery}
          />
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------- populations */

/**
 * The two student populations.
 *
 * On-campus students live in the dorms and are the ones with a mind you can
 * open — the cohort the behavior engine simulates, every one of them carrying a
 * real Rutgers schedule. Off-campus students come in on the buses and walk the
 * same footways; they are the statistical background population.
 *
 * The sliders change how many figures are *drawn*. Both engines always simulate
 * everyone, and the readouts say exactly that.
 */
export function Populations({
  mind,
  sim,
  mindLimit,
  setMindLimit,
  simLimit,
  setSimLimit,
  mindOutdoors,
  simOnFoot,
}: {
  mind: Mind
  sim: Sim
  mindLimit: number
  setMindLimit: (n: number) => void
  simLimit: number
  setSimLimit: (n: number) => void
  /** on-campus students currently outdoors (travel/queue) */
  mindOutdoors: number
  /** off-campus students not riding a bus */
  simOnFoot: number
}) {
  const mindDrawn = Math.min(mindLimit, mindOutdoors)
  const simDrawn = Math.min(simLimit, simOnFoot)

  return (
    <Panel
      title="Populations"
      aside={<span className="font-mono text-[9px] uppercase tracking-[0.12em]">drawn, not simulated</span>}
    >
      <div className="space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
              <span className="h-2.5 w-2.5 bg-scarlet-500" />
              On-campus students
            </span>
            <span className="font-mono text-[10px] tabular-nums text-ink-400">
              <b className="text-ink-100">{mindDrawn}</b> outdoors · {mindLimit}/{mind.students.length}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={mind.students.length}
            step={5}
            value={mindLimit}
            onChange={(e) => setMindLimit(Number(e.target.value))}
            className="slider mt-1"
            aria-label="on-campus students drawn"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-200">
              <span className="h-2.5 w-2.5 bg-signal-cold" />
              Off-campus students
            </span>
            <span className="font-mono text-[10px] tabular-nums text-ink-400">
              <b className="text-ink-100">{simDrawn}</b> on foot · {simLimit}/{sim.agents.length}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={sim.agents.length}
            step={250}
            value={simLimit}
            onChange={(e) => setSimLimit(Number(e.target.value))}
            className="slider mt-1"
            aria-label="off-campus students drawn"
          />
        </div>
      </div>
      <p className={cx('mt-2.5 border-t border-ink-100/8 pt-1.5', NOTE)}>
        Click any scarlet figure on the map to open a student: {mind.students.length} on-campus students each
        carry a name, a Tuesday schedule and a reason for every move.
      </p>
    </Panel>
  )
}

/* --------------------------------------------------------------- telemetry */

export function Telemetry({ sim }: { sim: Sim }) {
  const stats = sim.stats()
  const queue = (k: string) => (sim.queue[k] ?? []).length
  const counts = NODES.map(queue)
  const busiest = NODES.reduce((a, b) => (queue(a) >= queue(b) ? a : b))
  const peak = Math.max(1, ...counts)

  return (
    <Panel
      title="Stop telemetry"
      aside={
        <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-signal-live">
          <Dot tone="live" pulse />
          {NODES.length} online
        </span>
      }
    >
      <ul>
        {NODES.map((k) => {
          const n = queue(k)
          return (
            <li key={k} className="flex items-center gap-2 py-[2.5px]">
              <span
                className={cx(
                  'min-w-0 flex-1 truncate text-[11.5px]',
                  k === busiest ? 'text-ink-100' : 'text-ink-300',
                )}
              >
                {STOPS[k].label}
              </span>
              <span className="relative h-[4px] w-14 bg-ink-800">
                <span
                  className={cx('absolute inset-y-0 left-0', n > 30 ? 'bg-scarlet-400' : 'bg-ink-400')}
                  style={{ width: `${(n / peak) * 100}%` }}
                />
              </span>
              <span
                className={cx(
                  'w-7 shrink-0 text-right font-mono text-[11px] tabular-nums',
                  n > 0 ? 'text-ink-100' : 'text-ink-600',
                )}
              >
                {n}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 grid grid-cols-4 gap-2 border-t border-ink-100/8 pt-2">
        {(
          [
            ['waiting', stats.waiting],
            ['riding', stats.riding],
            ['walking', stats.walking],
            ['buses', stats.fleet],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <div className="font-mono text-[15px] leading-none tabular-nums text-ink-100">{v}</div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">{label}</div>
          </div>
        ))}
      </div>

      <p className={cx('mt-2', NOTE)}>
        {ROUTES.length} routes · {CAPACITY} seats a bus · modelled, not measured
      </p>
    </Panel>
  )
}

/* -------------------------------------------------------------- prediction */

/** the queue history at one stop, and a plain-language alert when it spikes */
export function Prediction({ sim, clock }: { sim: Sim; clock: { t: number } }) {
  const [picked, setPicked] = useState<string | null>(null)
  const minute = Math.floor(clock.t)
  const queue = (k: string) => (sim.queue[k] ?? []).length
  const busiest = NODES.reduce((a, b) => (queue(a) >= queue(b) ? a : b))
  const watch = picked ?? busiest
  const history = sim.history[watch] ?? []
  const series = history.slice(-90)
  const now = queue(watch)
  const hot = queue(busiest) > 30

  return (
    <Panel
      title="Queue forecast"
      aside={
        <select
          value={watch}
          onChange={(e) => setPicked(e.target.value)}
          className="max-w-[8.5rem] border border-ink-100/12 bg-ink-950/70 px-1 py-[3px] font-mono text-[9.5px] text-ink-300 focus:border-scarlet-500/70 focus:outline-none"
        >
          {NODES.map((k) => (
            <option key={k} value={k}>
              {STOPS[k].label}
            </option>
          ))}
        </select>
      }
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[26px] leading-none tabular-nums text-ink-100">{now}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">waiting now</span>
      </div>
      <Sparkline data={series.length > 1 ? series : [0, 0]} threshold={CAPACITY} />
      <p className={cx('mt-1.5', NOTE)}>
        {fmt(minute - Math.max(1, series.length))}–{fmt(minute)} at {STOPS[watch].label} · the dashed line is
        one bus of seats ({CAPACITY})
      </p>

      <div
        className={cx(
          'mt-2 flex items-start gap-2 border p-2',
          hot ? 'border-scarlet-500/40 bg-scarlet-700/15' : 'border-ink-100/10',
        )}
      >
        <span className="mt-[3px]">
          <Dot tone={hot ? 'bad' : 'live'} pulse={hot} />
        </span>
        <p className="text-[11px] leading-snug text-ink-200">
          {hot
            ? `Volume building at ${STOPS[busiest].label}: ${queue(busiest)} waiting. A vehicle holds ${CAPACITY}.`
            : `${STOPS[busiest].label} is the busiest stop right now with ${queue(busiest)} waiting — within a bus.`}
        </p>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------- map labels & strip */

/** stop names projected onto the canvas: text stays crisp, out of the 3D pass */
export function StopLabels({ labels }: { labels: ScreenLabel[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {labels.map((l) => (
        <span key={l.key} className="map-label" style={{ left: l.x, top: l.y }}>
          {l.label}
        </span>
      ))}
    </div>
  )
}

/** who the figures are, and which colour is which route */
export function Legend() {
  return (
    <div className="pointer-events-auto border border-ink-100/10 bg-ink-950/88 px-3 py-2 backdrop-blur-[3px]">
      <div className={EYEBROW}>Legend</div>
      <ul className="mt-1.5 space-y-1">
        <li className="flex items-center gap-1.5 text-[10.5px] text-ink-300">
          <span className="h-2.5 w-2.5 bg-scarlet-500" /> on-campus student — clickable
        </li>
        <li className="flex items-center gap-1.5 text-[10.5px] text-ink-300">
          <span className="h-2.5 w-2.5 bg-signal-cold" /> off-campus student
        </li>
        <li className="flex items-center gap-1.5 text-[10.5px] text-ink-300">
          <span className="h-2.5 w-2.5 bg-[#b3002d]" /> bus · roof band shows load
        </li>
      </ul>
      <div className="mt-2 border-t border-ink-100/8 pt-1.5">
        <ul className="flex flex-wrap gap-x-2 gap-y-1">
          {ROUTES.map((r) => (
            <li key={r.ref} className="flex items-center gap-1">
              <span className="h-2 w-3" style={{ background: r.colour }} />
              <span className="font-mono text-[9.5px] text-ink-400">{r.ref.replace('Rex', 'R')}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** the bottom strip: what this is, where the data came from, what it is not */
export function StatusStrip({ minute, speed, running }: { minute: number; speed: number; running: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-center px-3 pb-2">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border border-ink-100/10 bg-ink-950/80 px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-500 backdrop-blur-[3px]">
        <span className="text-ink-300">{fmt(minute)}</span>
        <span>
          {running ? 'running' : 'paused'} @ {speed}×
        </span>
        <span className="text-ink-600">|</span>
        <span>simulated day — a model, not a measurement</span>
        <span className="text-ink-600">|</span>
        <span>streets &amp; paths © OpenStreetMap contributors</span>
        <span className="text-ink-600">|</span>
        <span>buildings: Rutgers University (ArcGIS)</span>
      </div>
    </div>
  )
}
