/**
 * The mind-engine overlay: What-If box (parse → confirm → apply), the
 * student Inspector (persona, needs, decision rationale) and Results
 * (live day vs. the deterministic baseline day baked at build time).
 */
import { useState } from 'react'
import type { Mind } from '../engine/mind/engine.ts'
import type { MindStudent, ScenarioDraft } from '../engine/mind/types.ts'
import { PRESETS } from '../engine/mind/scenario.ts'
import baselineData from '../data/baseline.json' with { type: 'json' }

const CARD =
  'rounded-2xl border border-white/60 bg-white/75 p-3 shadow-xl shadow-slate-900/5 backdrop-blur-xl'
const H2 = 'mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500'

export function WhatIf({ mind, clock }: { mind: Mind; clock: { t: number } }) {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<ScenarioDraft | null>(null)
  const [note, setNote] = useState('')

  const describe = (c: ScenarioDraft['changes'][number]): string => {
    if (c.kind === 'road_closure')
      return `Close ${c.street} from ${mind.clock(c.from)}${c.until != null ? ` until ${mind.clock(c.until)}` : ''}`
    if (c.kind === 'place_add')
      return `${c.name} opens at ${mind.clock(c.from)} near (${c.pos[0].toFixed(1)}, ${c.pos[1].toFixed(1)})`
    return `“${c.title}” in building ${c.placeId} from ${mind.clock(c.from)}`
  }

  const apply = () => {
    if (!draft) return
    const { ok, at } = mind.apply(draft)
    setNote(ok ? `Queued — takes effect at ${mind.clock(at)}` : 'nothing to apply')
    setDraft(null)
    setText('')
  }

  const applied = mind.applied
  const now = Math.floor(clock.t) - mind.START

  return (
    <section className={CARD}>
      <h2 className={H2}>What if…</h2>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setDraft(mind.parse(text))
        }}
        placeholder="close Bishop Place at 10am until noon"
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setText(p)
              setDraft(mind.parse(p))
            }}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
          >
            {p.split(' ').slice(0, 3).join(' ')}…
          </button>
        ))}
      </div>

      {draft && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {draft.changes.map((c, i) => (
            <p key={i} className="text-[11px] font-semibold text-slate-800">
              {describe(c)}
            </p>
          ))}
          {draft.assumptions.map((a, i) => (
            <p key={i} className="text-[10px] text-amber-700">
              ⚠ {a}
            </p>
          ))}
          {draft.unsupported.map((u, i) => (
            <p key={i} className="text-[10px] text-rose-600">
              ✗ {u}
            </p>
          ))}
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={apply}
              disabled={!draft.ok}
              className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
            >
              Apply
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {note && <p className="mt-1 text-[10px] text-emerald-700">{note}</p>}
      {applied.length > 0 && (
        <ul className="mt-2 space-y-1">
          {applied.map((a) => (
            <li key={a.id} className="text-[10px] text-slate-600">
              {a.kind === 'road_closure' ? (
                <>
                  <span className="font-semibold text-slate-800">{a.street}</span>{' '}
                  {a.revertedAt != null && a.revertedAt <= now
                    ? `reopened ${mind.clock(a.revertedAt)}`
                    : `closed ${mind.clock(a.appliedAt)}${a.until != null ? ` · reopens ${mind.clock(a.until)}` : ''}`}
                </>
              ) : a.kind === 'place_add' ? (
                <>
                  <span className="font-semibold text-slate-800">{a.name}</span> opened{' '}
                  {mind.clock(a.appliedAt)}
                </>
              ) : (
                <>
                  <span className="font-semibold text-slate-800">{a.title}</span> announced{' '}
                  {mind.clock(a.appliedAt)}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function Bar({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
      <span className="w-11 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
        />
      </div>
      <span className="w-5 tabular-nums text-slate-500">{Math.round(v)}</span>
    </div>
  )
}

export function Inspector({
  mind,
  selected,
  setSelected,
}: {
  mind: Mind
  selected: number | null
  setSelected: (n: number | null) => void
}) {
  const s: MindStudent | undefined = selected !== null ? mind.students[selected] : undefined

  const followWalker = () => {
    const walkers = mind.students.filter((x) => x.state === 'travel' || x.state === 'queue')
    if (walkers.length) setSelected(walkers[Math.floor(Math.random() * walkers.length)].id)
  }

  return (
    <section className={`${CARD} w-[17rem]`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className={H2}>Inspector</h2>
        {s && (
          <button
            onClick={() => setSelected(null)}
            className="text-[10px] text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        )}
      </div>
      {!s ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-slate-500">
            Click any red figure on the map — every one of the {mind.students.length} minded students has a
            name, a real Rutgers schedule, and reasons for every move.
          </p>
          <button
            onClick={followWalker}
            className="w-full rounded-lg bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-white"
          >
            Follow a walker
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <p className="text-[13px] font-bold text-slate-900">
              {s.persona.name}{' '}
              <span className="font-medium capitalize text-slate-400">· {s.persona.archetype}</span>
            </p>
            <p className="text-[10px] italic leading-snug text-slate-500">{s.persona.backstory}</p>
          </div>
          <div className="space-y-1">
            <Bar label="hunger" v={s.needs.hunger} color="bg-amber-500" />
            <Bar label="energy" v={s.needs.energy} color="bg-emerald-500" />
            <Bar label="stress" v={s.needs.stress} color="bg-rose-500" />
          </div>
          <div className="flex justify-between text-[10px] text-slate-600">
            <span>
              state <b className="text-slate-900">{s.state}</b>
            </span>
            <span>RU Express ${(s.budget / 100).toFixed(2)}</span>
          </div>
          {s.schedule.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                Tuesday schedule
              </p>
              {s.schedule.map((c) => (
                <p key={c.sectionId} className="text-[10px] text-slate-600">
                  <span className="tabular-nums font-semibold text-slate-800">
                    {mind.clock(c.start)}–{mind.clock(c.end)}
                  </span>{' '}
                  {c.course} · {c.building} {c.room}
                </p>
              ))}
            </div>
          )}
          {s.decisions.length > 0 && (
            <div className="max-h-36 space-y-1 overflow-y-auto pr-0.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Decisions</p>
              {s.decisions.slice(0, 6).map((d, i) => (
                <div key={i} className="rounded-md bg-slate-50 px-1.5 py-1">
                  <p className="text-[10px] text-slate-800">
                    <span className="tabular-nums text-slate-400">{mind.clock(d.t)}</span>{' '}
                    <b>{d.action.split(':')[0].replaceAll('_', ' ')}</b> — {d.reason}
                  </p>
                  {d.options[1] && <p className="text-[9px] text-slate-400">runner-up: {d.options[1].why}</p>}
                </div>
              ))}
            </div>
          )}
          {s.knowledge.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                What they noticed
              </p>
              {s.knowledge.slice(0, 4).map((k, i) => (
                <p key={i} className="text-[10px] text-slate-500">
                  · {k}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

type BaselineBucket = {
  meals: number
  mealsBy: Record<string, number>
  revenue: number
  walk: number
  att: number
  late: number
  miss: number
  ev: number
  stress: number
}

type Baseline = { final: Record<string, unknown>; by10: BaselineBucket[] }

export function Results({ mind, clock }: { mind: Mind; clock: { t: number } }) {
  const m = mind.metrics()
  const base = baselineData as unknown as Baseline
  const now = Math.max(0, Math.floor(clock.t) - mind.START)
  // judge the live day against the baseline at the SAME time of day
  const bucketIdx = Math.min(base.by10.length - 1, Math.max(0, Math.floor(now / 10) - 1))
  const atTime = base.by10[bucketIdx]

  const row = (label: string, live: number, was: number, fmt: (n: number) => string, goodUp?: boolean) => {
    const d = live - was
    return (
      <div key={label} className="flex items-center justify-between text-[11px] text-slate-600">
        <span>{label}</span>
        <span className="flex items-baseline gap-1.5 tabular-nums">
          <b className="text-slate-900">{fmt(live)}</b>
          {Math.abs(d) > 0.001 && (
            <span
              className={
                goodUp === undefined
                  ? 'text-slate-400'
                  : d > 0 === goodUp
                    ? 'text-emerald-600'
                    : 'text-rose-600'
              }
            >
              {d > 0 ? '+' : ''}
              {fmt(d)}
            </span>
          )}
        </span>
      </div>
    )
  }

  const venueName = (id: string) => mind.venues.find((v) => v.id === id)?.name ?? id
  const mealRows = Object.keys({ ...atTime.mealsBy, ...m.meals })

  return (
    <section className={`${CARD} w-[17rem]`}>
      <h2 className={H2}>Results — live vs baseline at {mind.clock(now)}</h2>
      <div className="space-y-1">
        {row(
          'meals served',
          Object.values(m.meals).reduce((a, b) => a + b, 0),
          atTime.meals,
          (n) => n.toFixed(0),
        )}
        {row('dining revenue', m.revenueCents / 100, atTime.revenue / 100, (n) => `$${n.toFixed(0)}`)}
        {row('classes attended', m.classesAttended, atTime.att, (n) => n.toFixed(0), true)}
        {row('late arrivals', m.classesLate, atTime.late, (n) => n.toFixed(0), false)}
        {row('missed classes', m.classesMissed, atTime.miss, (n) => n.toFixed(0), false)}
        {row('event attendees', m.eventAttendees, atTime.ev, (n) => n.toFixed(0), true)}
        {row('collective walk (min)', m.walkMinutes, atTime.walk, (n) => n.toFixed(0))}
        {row('avg stress', m.stressAvg, atTime.stress, (n) => n.toFixed(1), false)}
      </div>
      {mealRows.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-1.5">
          {mealRows.map((id) =>
            row(venueName(id), m.meals[id] ?? 0, atTime.mealsBy[id] ?? 0, (n) => n.toFixed(0), true),
          )}
        </div>
      )}
      <p className={`mt-2 text-[9px] ${m.moneyCheck ? 'text-emerald-600' : 'text-rose-600'}`}>
        {m.moneyCheck ? '✓ money conserved —' : '✗ ledger broken —'} spent ${(m.spentCents / 100).toFixed(2)}{' '}
        = revenue ${(m.revenueCents / 100).toFixed(2)}
      </p>
    </section>
  )
}
