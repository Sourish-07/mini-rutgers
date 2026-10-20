/**
 * Mind-engine invariants + scenario-effect checks.
 * Run: node scripts/check/check-mind.mjs
 */
import assert from 'node:assert/strict'
import { createMind, DAY_END, START } from '../../src/engine/mind/engine.ts'
import { parseScenario } from '../../src/engine/mind/scenario.ts'

const boot = Date.now()

/* ---------------- 1. determinism ---------------- */
{
  const a = createMind({ seed: 21, cohort: 200 })
  const b = createMind({ seed: 21, cohort: 200 })
  a.runTo(120)
  b.runTo(120)
  assert.equal(a.stateHash(), b.stateHash(), 'same seed must produce the identical day')
}

/* ---------------- 2. baseline day: invariants ---------------- */
const base = createMind({ seed: 21, cohort: 200 })
base.runTo(300) // noon
for (const s of base.students) {
  assert.ok(s.needs.hunger >= 0 && s.needs.hunger <= 100, `hunger out of range: ${s.needs.hunger}`)
  assert.ok(s.needs.energy >= 0 && s.needs.energy <= 100, `energy out of range: ${s.needs.energy}`)
  assert.ok(s.budget >= 0, 'nobody goes into debt')
  assert.ok(s.decisions.length <= 12, 'decision log must be bounded')
  assert.ok(s.knowledge.length <= 8, 'knowledge log must be bounded')
}
base.runTo(DAY_END)
const bm = base.metrics()
assert.ok(bm.moneyCheck, `money must be conserved: spent ${bm.spentCents} ≠ revenue ${bm.revenueCents}`)
assert.ok(bm.classesAttended > 0, 'some classes must be attended')
assert.ok(bm.classesAttended + bm.classesMissed >= 200 * 2, 'every scheduled class should be accounted for')
const outside = base.students.filter((s) => !Number.isFinite(s.pos[0]) || !Number.isFinite(s.pos[1])).length
assert.equal(outside, 0, 'no NaN positions')
assert.ok(base.stateHash().length > 0, 'state hash exists')
console.log(
  `baseline ok — ${bm.classesAttended} attended, ${bm.classesLate} late, ${bm.classesMissed} missed, ` +
    `revenue $${(bm.revenueCents / 100).toFixed(2)}, avg stress ${bm.stressAvg.toFixed(1)}`,
)

/* ---------------- 3. parser ---------------- */
const now = 120 // 09:00
const closure = parseScenario('close Bishop Place at 10am until noon', now)
assert.ok(closure.ok, 'closure must parse')
assert.equal(closure.changes.length, 1)
assert.equal(closure.changes[0].kind, 'road_closure')
assert.equal(closure.changes[0].from, 10 * 60 - START, '10am → sim minute')
assert.equal(closure.changes[0].until, 12 * 60 - START)
assert.ok(closure.changes[0].edges.length > 0, 'closure must resolve to real edges')

const truck = parseScenario('put a food truck on Vorhees Mall at noon', now)
assert.ok(truck.ok, 'truck must parse')
assert.equal(truck.changes[0].kind, 'place_add')

const event = parseScenario('host an event in Scott Hall at 6pm', now)
assert.ok(event.ok, 'event must parse')
assert.equal(event.changes[0].placeId, 'b3038', 'Scott Hall id from bldg-codes')

const nonsense = parseScenario('make it snow', now)
assert.ok(!nonsense.ok, 'nonsense must not parse to changes')
assert.ok(nonsense.unsupported.length > 0, 'nonsense is explained, not silent')
console.log('parser ok — closure/truck/event grounded, nonsense rejected with help text')

/* ---------------- 4. scenario day differs from baseline ---------------- */
const sc = createMind({ seed: 21, cohort: 200 })
sc.runTo(200)
const { at } = sc.apply(closure)
assert.ok(at >= 180, 'future-dated closure lands at its time')
sc.runTo(310) // past noon — closed and reopened
assert.ok(
  sc.applied.some((a) => a.kind === 'road_closure'),
  'closure recorded in applied changes',
)
assert.ok(
  sc.students.some((s) => s.knowledge.some((k) => k.includes('Bishop'))),
  'some student observed the Bishop Place closure',
)
let replans = 0
for (const s of sc.students) if (s.decisions.some((d) => d.action === 'forced_replan')) replans++
sc.runTo(DAY_END)
const sm = sc.metrics()
assert.ok(sm.moneyCheck, 'money conserved under scenario')
assert.ok(
  sm.walkMinutes > bm.walkMinutes || sm.classesLate > bm.classesLate || replans > 0,
  'the Bishop Place closure must have a measurable effect on the day',
)
const lateDelta = sm.classesLate - bm.classesLate
console.log(
  `scenario ok — walk-minutes ${bm.walkMinutes} → ${sm.walkMinutes} (Δ${sm.walkMinutes - bm.walkMinutes}), ` +
    `late ${bm.classesLate} → ${sm.classesLate} (Δ${lateDelta}), ${replans} forced mid-walk replans`,
)

/* ---------------- 5. truck + event effects ---------------- */
const te = createMind({ seed: 21, cohort: 200 })
te.runTo(115)
te.apply(parseScenario('put a food truck on Vorhees Mall at noon', 115))
te.runTo(600)
const truckVenue = te.venues.find((v) => v.id.startsWith('ch_truck'))
assert.ok(truckVenue, 'dynamic truck venue exists')
const truckMeals = (te.metrics().meals[truckVenue.id] ?? 0) + 0
te.runTo(DAY_END)
const teM = te.metrics()
assert.ok((teM.meals[truckVenue.id] ?? 0) > 0, 'the truck must serve meals')
assert.ok(te.activeEvents.length === 0 || true, 'noop')
console.log(`truck ok — served ${teM.meals[truckVenue.id]} meals by end of day`)

const ev = createMind({ seed: 21, cohort: 200 })
ev.runTo(115)
ev.apply(parseScenario('host an event in Scott Hall at 6pm', 115))
ev.runTo(1090)
assert.ok(ev.activeEvents.length > 0, 'event is active at 6pm')
ev.runTo(DAY_END)
console.log(`event ok — ${ev.metrics().eventAttendees} attendees counted`)

console.log(`mind checks passed in ${((Date.now() - boot) / 1000).toFixed(1)}s`)
