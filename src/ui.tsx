/**
 * The operator console: sensor fleet, live totals, wait metrics, prediction and the
 * alert with a reserve-fleet lever that actually does something. The scenario
 * console and A/B comparison live in the bottom dock. Every number is honestly
 * badged — this is a model, and the panels say so.
 */
import { useState } from 'react'
import { Line, LineChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts'
import { CAPACITY, ROUTES, STOPS, type Scenario, type Sim } from './sim'
import { readFleet } from './sensors'
import type { LiveVehicle } from './live'
import { ScenarioPanel } from './scenario-panel'
import { fmtMin } from './format'
import { ComparePanel } from './compare-panel'

/** stops the prediction card watches */
const NODES = ['arc', 'bsc', 'livSc', 'cas', 'quads', 'hill', 'science', 'yard', 'biel', 'redoak']

export function Panels({
  sim,
  clock,
  speed,
  setSpeed,
  running,
  setRunning,
  scenario,
  applyScenario,
  jumpTo,
  reserveFleet,
  live,
  toggleLive,
}: {
  sim: Sim
  clock: { t: number }
  speed: number
  setSpeed: (n: number) => void
  running: boolean
  setRunning: (b: boolean) => void
  scenario: Scenario | null
  applyScenario: (s: Scenario) => string | null
  jumpTo: (min: number) => void
  reserveFleet: () => void
  live: { on: boolean; vehicles: LiveVehicle[]; error: string | null }
  toggleLive: () => void
}) {
  const minute = Math.floor(clock.t)
  const stats = sim.stats()
  const metrics = sim.metrics()
  const fleet = readFleet(sim, minute)
  const queue = (k: string) => (sim.queue[k] ?? []).length
  const busiest = NODES.reduce((a, b) => (queue(a) >= queue(b) ? a : b))
  const [picked, setPicked] = useState<string | null>(null)
  const watch = picked ?? busiest
  const history = sim.history[watch] ?? []
  const series = history
    .slice(-90)
    .map((waiting, i) => ({ t: fmtMin(minute - (Math.min(90, history.length) - 1 - i)), waiting }))
  const peak = Math.max(1, ...series.map((p) => p.waiting))
  const worstLeft = Object.entries(metrics.leftBehindByStop).reduce(
    (best, [k, v]) => (v > best[1] ? [k, v] : best),
    ['—', 0] as [string, number],
  )

  return (
    <>
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto rounded-2xl border border-white/60 bg-white/75 px-4 py-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#ee0000] text-[11px] font-black text-white">
              R
            </span>
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">Rutgers 5G Transit Twin</h1>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Powered by Verizon Mobile Edge Compute · simulated telemetry
          </p>
          {scenario && (
            <p className="mt-1 max-w-[16rem] truncate rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
              ▲ {scenario.label}
            </p>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/60 bg-white/75 px-3 py-2 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <span className="text-sm font-semibold tabular-nums text-slate-900">{fmtMin(sim.minute)}</span>
          <button
            onClick={() => setRunning(!running)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
          >
            {running ? 'Pause' : 'Play'}
          </button>
          {[1, 10, 60, 240].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`rounded-md px-1.5 py-1 text-[10px] font-semibold ${
                speed === s ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
              }`}
            >
              {s}x
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button
            onClick={toggleLive}
            title={live.error ?? 'toggle live Rutgers bus tracker overlay'}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${
              live.on ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live.on ? (live.error ? 'bg-red-300' : 'bg-white') : 'bg-slate-300'
              }`}
            />
            Live {live.on ? (live.error ? 'error' : live.vehicles.length) : 'off'}
          </button>
        </div>
      </header>

      {/* sensor fleet */}
      <aside className="absolute left-4 top-28 z-20 w-[16.5rem] space-y-2" aria-label="Sensor fleet">
        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Sensor fleet
            </h2>
            <span className="text-[10px] text-emerald-600">{fleet.length} online</span>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
            {fleet.map((node) => (
              <li
                key={node.id}
                className="flex items-center justify-between rounded-lg px-1.5 py-1 text-[11px] hover:bg-slate-50"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      node.kind === 'mmwave' ? 'bg-indigo-500' : 'bg-cyan-500'
                    }`}
                  />
                  <span className="truncate text-slate-700" title={`${node.id} · ${node.label}`}>
                    {node.label}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <span className={node.count > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}>
                    {node.count}
                  </span>
                  <span className="rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-700">
                    5G
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[9px] leading-snug text-slate-400">
            ESP32 nodes · 8× mmWave zone + 4× ToF door counters · firmware-sim telemetry, counts only
          </p>
        </section>

        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Live</h2>
          <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-600">
            <div className="flex justify-between">
              <dt>waiting</dt>
              <dd className="font-semibold text-slate-900">{stats.waiting}</dd>
            </div>
            <div className="flex justify-between">
              <dt>riding</dt>
              <dd className="font-semibold text-slate-900">{stats.riding}</dd>
            </div>
            <div className="flex justify-between">
              <dt>walking</dt>
              <dd className="font-semibold text-slate-900">{stats.walking}</dd>
            </div>
            <div className="flex justify-between">
              <dt>buses</dt>
              <dd className="font-semibold text-slate-900">{stats.fleet}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[10px] leading-snug text-slate-400">
            {ROUTES.length} routes · capacity ~{CAPACITY} per bus (randomised) · modelled, not measured
          </p>
        </section>

        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Wait metrics
          </h2>
          <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-600">
            <div className="flex justify-between">
              <dt>avg wait</dt>
              <dd className="font-semibold text-slate-900">
                {metrics.avgWaitMin === null ? '—' : `${metrics.avgWaitMin.toFixed(1)} min`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>p95 wait</dt>
              <dd className="font-semibold text-slate-900">
                {metrics.p95WaitMin === null ? '—' : `${metrics.p95WaitMin.toFixed(1)} min`}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>left behind</dt>
              <dd
                className={
                  metrics.totalLeftBehind > 0 ? 'font-semibold text-red-600' : 'font-semibold text-slate-900'
                }
              >
                {metrics.totalLeftBehind}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>boardings</dt>
              <dd className="font-semibold text-slate-900">{metrics.boardingsTotal}</dd>
            </div>
          </dl>
          {metrics.totalLeftBehind > 0 && (
            <p className="mt-1 text-[9px] leading-snug text-red-500">
              worst: {STOPS[worstLeft[0]]?.label ?? worstLeft[0]} — {worstLeft[1]} passed up
            </p>
          )}
          <p className="mt-1 text-[9px] leading-snug text-slate-400">
            from {metrics.waitSamples} sampled waits this day
          </p>
        </section>
      </aside>

      {/* prediction + alert */}
      <aside className="absolute right-4 top-28 z-20 w-[19rem] space-y-2" aria-label="Prediction">
        <section className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Prediction</h2>
            <select
              value={watch}
              onChange={(e) => setPicked(e.target.value)}
              className="max-w-[9.5rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-600"
            >
              {NODES.map((k) => (
                <option key={k} value={k}>
                  {STOPS[k].label}
                </option>
              ))}
            </select>
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <YAxis hide domain={[0, Math.max(10, peak)]} />
                <ReferenceLine y={CAPACITY} stroke="#f59e0b" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="waiting"
                  stroke="#0f172a"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">waiting at {STOPS[watch].label} · last 90 min</p>
        </section>

        <section
          className={`rounded-2xl border p-3 shadow-xl backdrop-blur-xl ${queue(busiest) > 30 ? 'border-red-200 bg-red-50/85' : 'border-white/60 bg-white/75'}`}
        >
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Alert</h2>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">
            {queue(busiest) > 30
              ? `High volume predicted at ${STOPS[busiest].label}`
              : `${STOPS[busiest].label} is clear`}
          </h3>
          <p className="mt-1 text-[11px] leading-snug text-slate-600">
            {queue(busiest)} waiting · {stats.fleet} buses in service · {stats.riding} riding
            {metrics.totalLeftBehind > 0 ? ` · ${metrics.totalLeftBehind} left behind today` : ''}
          </p>
          <button
            onClick={reserveFleet}
            className="mt-2 w-full rounded-lg bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-white"
          >
            Reserve fleet — +3 buses (sim)
          </button>
          <p className="mt-1 text-[9px] text-slate-400">
            drops 3 extra vehicles onto the busiest stop's heaviest route, now
          </p>
        </section>
      </aside>

      {/* bottom dock: scenario console + A/B comparison */}
      <div className="absolute bottom-4 left-1/2 z-20 flex w-[46rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-2">
        <div className="min-w-0 flex-1">
          <ScenarioPanel minute={minute} active={scenario} applyScenario={applyScenario} jumpTo={jumpTo} />
        </div>
        <div className="min-w-0 flex-1">
          <ComparePanel scenario={scenario} />
        </div>
      </div>
    </>
  )
}
