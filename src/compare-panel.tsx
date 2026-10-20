/**
 * Paired A/B comparison: rerun the whole day headless with and without the active
 * scenario — same seed, same population — and show B minus A with no story
 * attached. Descriptive deltas, honestly labelled; one pair is not statistics.
 */
import { useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { START, runExperiment, type ExperimentResult, type Scenario } from './sim'
import { fmtMin } from './format'

export function ComparePanel({ scenario }: { scenario: Scenario | null }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExperimentResult | null>(null)

  const run = () => {
    if (!scenario) return
    setBusy(true)
    // let the spinner paint before the synchronous compute takes the tab
    window.setTimeout(() => {
      try {
        setResult(runExperiment({ scenario }))
      } finally {
        setBusy(false)
      }
    }, 30)
  }

  const focus = result?.focusStop ?? null
  let series: Array<{ t: string; baseline: number | null; treatment: number | null }> = []
  if (result && focus) {
    const b = result.baseline.history[focus] ?? []
    const tr = result.treatment.history[focus] ?? []
    const from = Math.max(0, Math.min(b.length, tr.length) - 180)
    for (let i = from; i < Math.min(b.length, tr.length); i++) {
      series.push({ t: fmtMin(START + i), baseline: b[i] ?? 0, treatment: tr[i] ?? 0 })
    }
  }

  return (
    <section
      className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl"
      aria-label="A/B comparison"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">A/B comparison</h2>
        <button
          onClick={run}
          disabled={!scenario || busy}
          className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Running…' : 'Run paired day'}
        </button>
      </div>

      {!scenario && (
        <p className="text-[10px] leading-snug text-slate-400">
          Apply a scenario first, then rerun the day with and without it — same seed, paired arms.
        </p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-600">
            <div className="flex justify-between rounded bg-slate-50 px-1.5 py-1">
              <span>avg wait</span>
              <b className={result.deltas.avgWaitMin > 0 ? 'text-red-600' : 'text-emerald-600'}>
                {result.deltas.avgWaitMin > 0 ? '+' : ''}
                {result.deltas.avgWaitMin.toFixed(1)} min
              </b>
            </div>
            <div className="flex justify-between rounded bg-slate-50 px-1.5 py-1">
              <span>p95 wait</span>
              <b className={result.deltas.p95WaitMin > 0 ? 'text-red-600' : 'text-emerald-600'}>
                {result.deltas.p95WaitMin > 0 ? '+' : ''}
                {result.deltas.p95WaitMin.toFixed(1)} min
              </b>
            </div>
            <div className="flex justify-between rounded bg-slate-50 px-1.5 py-1">
              <span>left behind</span>
              <b className={result.deltas.leftBehind > 0 ? 'text-red-600' : 'text-emerald-600'}>
                {result.deltas.leftBehind > 0 ? '+' : ''}
                {result.deltas.leftBehind}
              </b>
            </div>
            <div className="flex justify-between rounded bg-slate-50 px-1.5 py-1">
              <span>peak queue</span>
              <b className={result.deltas.focusPeakQueue > 0 ? 'text-red-600' : 'text-emerald-600'}>
                {result.deltas.focusPeakQueue > 0 ? '+' : ''}
                {result.deltas.focusPeakQueue}
              </b>
            </div>
          </div>

          {focus && (
            <div className="mt-2 h-20">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="t" hide />
                  <YAxis hide domain={[0, 'dataMax + 4']} />
                  <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} labelStyle={{ fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke="#94a3b8"
                    strokeWidth={1.4}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="treatment"
                    stroke="#f59e0b"
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <table className="mt-1 w-full text-[9px] text-slate-500">
            <tbody>
              {result.perStop.slice(0, 4).map((s) => (
                <tr key={s.stop} className={s.treatPeak > s.basePeak ? 'text-red-600' : ''}>
                  <td className="truncate py-0.5 pr-1">{s.label}</td>
                  <td className="w-10 text-right tabular-nums">{s.basePeak}</td>
                  <td className="w-3 text-center">→</td>
                  <td className="w-10 text-right font-semibold tabular-nums">{s.treatPeak}</td>
                  <td className="w-14 text-right tabular-nums">
                    {s.treatLeft - s.baseLeft > 0 ? '+' : ''}
                    {s.treatLeft - s.baseLeft} left
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[9px] leading-snug text-slate-400">
            paired seeds ({result.population} agents, seed {result.seed}) · descriptive deltas, one pair — not
            statistics · ran to {fmtMin(result.toMin)}
          </p>
        </>
      )}

      {!result && scenario && !busy && (
        <p className="text-[10px] leading-snug text-slate-400">
          Press run — the twin replays the full day twice and diffs the outcome.
        </p>
      )}
      {busy && <p className="text-[10px] text-slate-400">Replaying two whole days… (a few seconds)</p>}
    </section>
  )
}
