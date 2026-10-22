/**
 * The mind-engine overlay.
 *
 * Three panels, one voice: the **What if** box (it parses plain English, shows
 * every assumption it made before anything happens, then applies at the next
 * 5-minute boundary), the **Inspector** (click a student: persona, needs, real
 * Tuesday schedule, the decision log with the option they rejected), and
 * **Results** (the live day measured against the deterministic baseline day at
 * the same time of day).
 */
import { useState } from 'react'
import type { Mind } from '../engine/mind/engine.ts'
import type { MindStudent, ScenarioDraft } from '../engine/mind/types.ts'
import { PRESETS } from '../engine/mind/scenario.ts'
import baselineData from '../data/baseline.json' with { type: 'json' }
import { Btn, Meter, Panel, Row } from './Panel'
import { Chip, cx, EYEBROW, INPUT, NOTE } from './theme'

/** where a student sleeps, said plainly */
const ARCHETYPE: Record<string, string> = {
  freshman: 'first-year',
  sophomore: 'sophomore',
  junior: 'junior',
  senior: 'senior',
  grad: 'graduate',
  commuter: 'off-campus',
}

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
    setNote(ok ? `queued — takes effect at ${mind.clock(at)}` : 'nothing to apply')
    setDraft(null)
    setText('')
  }

  const applied = mind.applied
  const now = Math.floor(clock.t) - mind.START

  return (
    <Panel
      title="What if…"
      aside={<span className="font-mono text-[9px] uppercase tracking-[0.12em]">plain English</span>}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setDraft(mind.parse(text))
        }}
        placeholder="close Bishop Place at 10am until noon"
        className={INPUT}
        aria-label="what if scenario"
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setText(p)
              setDraft(mind.parse(p))
            }}
            className="border border-ink-100/12 px-1.5 py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] text-ink-400 hover:border-ink-100/25 hover:text-ink-100"
          >
            {p.split(' ').slice(0, 3).join(' ')}
          </button>
        ))}
      </div>

      {draft && (
        <div className="mt-2 border border-ink-100/12 bg-ink-950/60 p-2">
          <div className={cx(EYEBROW, 'mb-1.5')}>understood</div>
          {draft.changes.map((c, i) => (
            <p key={i} className="text-[11.5px] font-medium text-ink-100">
              {describe(c)}
            </p>
          ))}
          {draft.assumptions.map((a, i) => (
            <p key={i} className="mt-1 font-mono text-[9.5px] leading-snug text-signal-warn">
              ⚠ {a}
            </p>
          ))}
          {draft.unsupported.map((u, i) => (
            <p key={i} className="mt-1 font-mono text-[9.5px] leading-snug text-scarlet-300">
              ✕ {u}
            </p>
          ))}
          <div className="mt-2 flex gap-1.5">
            <Btn variant="solid" onClick={apply} disabled={!draft.ok}>
              Apply
            </Btn>
            <Btn variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Btn>
          </div>
        </div>
      )}

      {note && (
        <p className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-signal-live">{note}</p>
      )}

      {applied.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-ink-100/8 pt-1.5">
          {applied.map((a) => (
            <li key={a.id} className="text-[10.5px] leading-snug text-ink-300">
              {a.kind === 'road_closure' ? (
                <>
                  <span className="text-ink-100">{a.street}</span>{' '}
                  {a.revertedAt != null && a.revertedAt <= now
                    ? `reopened ${mind.clock(a.revertedAt)}`
                    : `closed ${mind.clock(a.appliedAt)}${a.until != null ? ` · reopens ${mind.clock(a.until)}` : ''}`}
                </>
              ) : a.kind === 'place_add' ? (
                <>
                  <span className="text-ink-100">{a.name}</span> opened {mind.clock(a.appliedAt)}
                </>
              ) : (
                <>
                  <span className="text-ink-100">{a.title}</span> announced {mind.clock(a.appliedAt)}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* --------------------------------------------------------------- inspector */

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
    <Panel
      title="Student"
      aside={
        s ? (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500 hover:text-ink-100"
          >
            close ✕
          </button>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-[0.12em]">on-campus cohort</span>
        )
      }
    >
      {!s ? (
        <div className="space-y-2">
          <p className={NOTE}>
            Every one of the {mind.students.length} on-campus students is an individual: a name, a real
            Rutgers schedule, hunger, energy, stress, a meal-plan balance and a personality. Click a scarlet
            figure on the map — or pick one at random.
          </p>
          <Btn variant="solid" onClick={followWalker} className="w-full">
            Pick a student on the move
          </Btn>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[14px] font-semibold leading-tight text-ink-100">{s.persona.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Chip tone="scarlet">{ARCHETYPE[s.persona.archetype] ?? s.persona.archetype}</Chip>
                <Chip>{s.state}</Chip>
                {s.persona.mealPlan && <Chip tone="live">meal plan</Chip>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-[13px] tabular-nums text-ink-100">
                ${(s.budget / 100).toFixed(2)}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-500">RU Express</div>
            </div>
          </div>

          <p className="border-l-2 border-scarlet-500/50 pl-2 text-[10.5px] italic leading-snug text-ink-400">
            {s.persona.backstory}
          </p>

          <div>
            <div className={cx(EYEBROW, 'mb-1')}>needs</div>
            <Meter label="hunger" value={s.needs.hunger} tone="warn" />
            <Meter label="energy" value={s.needs.energy} tone="live" />
            <Meter label="stress" value={s.needs.stress} tone="bad" />
          </div>

          <div className="grid grid-cols-3 gap-2 border-y border-ink-100/8 py-1.5">
            {(
              [
                ['outgoing', s.persona.outgoing],
                ['diligence', s.persona.diligence],
                ['pace', Math.round((s.persona.pace - 0.85) * 220)],
              ] as const
            ).map(([label, v]) => (
              <div key={label}>
                <div className="font-mono text-[12px] tabular-nums text-ink-100">{v}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-500">{label}</div>
              </div>
            ))}
          </div>

          {s.schedule.length > 0 && (
            <div>
              <div className={cx(EYEBROW, 'mb-1')}>Tuesday schedule</div>
              <table className="w-full border-collapse">
                <tbody>
                  {s.schedule.map((c) => (
                    <tr key={c.sectionId} className="border-b border-ink-100/6 last:border-0">
                      <td className="py-[3px] pr-2 font-mono text-[10px] tabular-nums text-ink-300">
                        {mind.clock(c.start)}–{mind.clock(c.end)}
                      </td>
                      <td className="py-[3px] text-[10.5px] text-ink-100">{c.course}</td>
                      <td className="py-[3px] text-right text-[10px] text-ink-400">
                        {c.building} {c.room}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {s.decisions.length > 0 && (
            <div>
              <div className={cx(EYEBROW, 'mb-1')}>decisions · why</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {s.decisions.slice(0, 6).map((d, i) => (
                  <div key={i} className="border-l border-ink-100/12 pl-2">
                    <p className="text-[10.5px] leading-snug text-ink-200">
                      <span className="font-mono text-[9.5px] tabular-nums text-ink-500">
                        {mind.clock(d.t)}
                      </span>{' '}
                      <b className="font-medium text-ink-100">
                        {d.action.split(':')[0].replaceAll('_', ' ')}
                      </b>{' '}
                      — {d.reason}
                    </p>
                    {d.options[1] && (
                      <p className="font-mono text-[9px] leading-snug text-ink-500">
                        runner-up: {d.options[1].why}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {s.knowledge.length > 0 && (
            <div>
              <div className={cx(EYEBROW, 'mb-1')}>what they noticed</div>
              {s.knowledge.slice(0, 4).map((k, i) => (
                <p key={i} className="text-[10px] leading-snug text-ink-400">
                  · {k}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

/* ----------------------------------------------------------------- results */

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

/**
 * The ledger: today's live day against the deterministic baseline day, sampled
 * at the *same time of day*, so a 10 a.m. decision is never judged against a
 * 6 p.m. baseline. The money line is a conservation check, not a vanity metric.
 */
export function Results({ mind, clock }: { mind: Mind; clock: { t: number } }) {
  const m = mind.metrics()
  const base = baselineData as unknown as Baseline
  const now = Math.max(0, Math.floor(clock.t) - mind.START)
  const bucketIdx = Math.min(base.by10.length - 1, Math.max(0, Math.floor(now / 10) - 1))
  const atTime = base.by10[bucketIdx]

  const row = (label: string, live: number, was: number, fmt: (n: number) => string, goodUp?: boolean) => {
    const d = live - was
    return (
      <Row
        key={label}
        label={label}
        value={fmt(live)}
        delta={
          Math.abs(d) > 0.001
            ? {
                text: `${d > 0 ? '+' : ''}${fmt(d)}`,
                good: goodUp === undefined ? undefined : d > 0 === goodUp,
              }
            : undefined
        }
      />
    )
  }

  const venueName = (id: string) => mind.venues.find((v) => v.id === id)?.name ?? id
  const mealRows = Object.keys({ ...atTime.mealsBy, ...m.meals })
  const meals = Object.values(m.meals).reduce((a, b) => a + b, 0)

  return (
    <Panel
      title="Results"
      aside={
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500">
          vs baseline @ {mind.clock(now)}
        </span>
      }
    >
      <div>
        {row('meals served', meals, atTime.meals, (n) => n.toFixed(0))}
        {row('dining revenue', m.revenueCents / 100, atTime.revenue / 100, (n) => `$${n.toFixed(0)}`)}
        {row('classes attended', m.classesAttended, atTime.att, (n) => n.toFixed(0), true)}
        {row('late arrivals', m.classesLate, atTime.late, (n) => n.toFixed(0), false)}
        {row('missed classes', m.classesMissed, atTime.miss, (n) => n.toFixed(0), false)}
        {row('event attendees', m.eventAttendees, atTime.ev, (n) => n.toFixed(0), true)}
        {row('collective walk', m.walkMinutes, atTime.walk, (n) => n.toFixed(0))}
        {row('avg stress', m.stressAvg, atTime.stress, (n) => n.toFixed(1), false)}
      </div>

      {mealRows.length > 0 && (
        <div className="mt-2 border-t border-ink-100/8 pt-1.5">
          {mealRows.map((id) =>
            row(venueName(id), m.meals[id] ?? 0, atTime.mealsBy[id] ?? 0, (n) => n.toFixed(0), true),
          )}
        </div>
      )}

      <p
        className={cx(
          'mt-2 border-t border-ink-100/8 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em]',
          m.moneyCheck ? 'text-signal-live' : 'text-scarlet-300',
        )}
      >
        {m.moneyCheck ? '✓ money conserved' : '✗ ledger broken'} — spent ${(m.spentCents / 100).toFixed(2)} =
        revenue ${(m.revenueCents / 100).toFixed(2)}
      </p>
      <p className={cx('mt-1.5', NOTE)}>
        Every figure here is measured against the same Tuesday with no levers pulled, sampled at the same
        minute. Green is an improvement, scarlet a cost — the trade you are actually making.
      </p>
    </Panel>
  )
}
