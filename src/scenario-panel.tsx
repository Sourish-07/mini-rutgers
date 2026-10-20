/**
 * The scenario console: pick a preset or describe a what-if in plain words, review
 * the draft, then apply it. Nothing is ever scheduled without the operator seeing
 * exactly which events will fire and when — the discipline the reference operator
 * product taught us. The engine keeps its own revision counter for every apply.
 */
import { useState } from 'react'
import { type Scenario, scenarioEnd, scenarioStart } from './sim'
import { parseScenarioText, type ParseDraft } from './scenario-parse'
import { describeEvent, fmtMin } from './format'
import bscEvent from './data/scenarios/bsc-event-1000.json' with { type: 'json' }
import gameDay from './data/scenarios/game-day.json' with { type: 'json' }
import examWeek from './data/scenarios/exam-week.json' with { type: 'json' }
import bscStopClosure from './data/scenarios/bsc-stop-closure.json' with { type: 'json' }
import reserveFleet from './data/scenarios/reserve-fleet.json' with { type: 'json' }

export const PRESETS: Scenario[] = [
  bscEvent,
  gameDay,
  examWeek,
  bscStopClosure,
  reserveFleet,
] as unknown as Scenario[]

export function ScenarioPanel({
  minute,
  active,
  applyScenario,
  jumpTo,
}: {
  minute: number
  active: Scenario | null
  applyScenario: (s: Scenario) => string | null
  jumpTo: (min: number) => void
}) {
  const [preset, setPreset] = useState<string>(PRESETS[0]?.id ?? '')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<ParseDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewPreset = (id: string) => {
    setPreset(id)
    const sc = PRESETS.find((p) => p.id === id) ?? null
    setDraft(sc ? { scenario: sc, assumptions: [], unsupported: [] } : null)
    setError(null)
  }

  const previewText = () => {
    if (!text.trim()) return
    setDraft(parseScenarioText(text, minute))
    setError(null)
  }

  const apply = () => {
    if (!draft?.scenario) return
    const err = applyScenario(draft.scenario)
    if (err) setError(err)
    else setDraft(null)
  }

  const sc = draft?.scenario ?? null
  const start = active ? scenarioStart(active) : null
  const end = active ? scenarioEnd(active) : null
  const inFuture = start !== null && start > minute + 1

  return (
    <section
      className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl"
      aria-label="Scenario console"
    >
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        Scenario console
      </h2>

      <div className="flex gap-2">
        <select
          value={preset}
          onChange={(e) => previewPreset(e.target.value)}
          className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-700"
          aria-label="Scenario preset"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const p = PRESETS.find((x) => x.id === preset)
            if (p) setDraft({ scenario: p, assumptions: [], unsupported: [] })
          }}
          className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white"
        >
          Preview
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && previewText()}
          placeholder="or: 1000 person event at BSC tonight 7pm"
          className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-700"
          aria-label="Describe a scenario"
        />
        <button
          onClick={previewText}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600"
        >
          Parse
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[10px] font-medium text-red-700">{error}</p>
      )}

      {sc && (
        <div
          className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 p-2"
          aria-label="Draft for review"
        >
          <div className="flex items-baseline justify-between gap-2">
            <b className="truncate text-[11px] text-slate-900">{sc.label}</b>
            <span className="rounded bg-amber-200/70 px-1 text-[9px] font-bold uppercase text-amber-900">
              draft
            </span>
          </div>
          <ol className="mt-1 space-y-0.5 text-[10px] leading-snug text-slate-700">
            {sc.events.map((e) => (
              <li key={e.id}>• {describeEvent(e)}</li>
            ))}
          </ol>
          {draft?.assumptions.length ? (
            <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-slate-500">
              {draft.assumptions.map((a) => (
                <li key={a}>— {a}</li>
              ))}
            </ul>
          ) : null}
          {draft?.unsupported.length ? (
            <ul className="mt-1 space-y-0.5 text-[9px] leading-snug text-slate-400">
              {draft.unsupported.map((a) => (
                <li key={a}>✗ {a}</li>
              ))}
            </ul>
          ) : null}
          <button
            onClick={apply}
            disabled={!sc.events.length}
            className="mt-2 w-full rounded-lg bg-amber-500 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
          >
            Apply scenario — fires at tick boundaries
          </button>
        </div>
      )}

      {active && (
        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-100/70 p-2">
          <div className="flex items-baseline justify-between gap-2">
            <b className="truncate text-[10px] text-amber-950">Active: {active.label}</b>
            <span className="shrink-0 text-[9px] font-semibold text-amber-800">
              {start !== null ? fmtMin(start) : ''}
              {end !== null ? `–${fmtMin(end)}` : ''}
            </span>
          </div>
          {inFuture && (
            <button
              onClick={() => start !== null && jumpTo(start - 15)}
              className="mt-1 w-full rounded-md bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white"
            >
              Jump to 15 min before it starts
            </button>
          )}
        </div>
      )}
    </section>
  )
}
