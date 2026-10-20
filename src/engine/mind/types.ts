/**
 * campus.v1-lite: the behavior-contract types for the minded cohort.
 * (A faithful port of the full frozen contract arrives with the wider
 * migration; Demo-0 keeps the shapes that the inspector, scenarios and
 * metrics actually need, under the same naming scheme.)
 */
import type { P } from './nav.ts'

export type Cents = number
export type SimMin = number

/** needs are 0..100 */
export type Needs = { hunger: number; energy: number; stress: number }

export type Archetype = 'freshman' | 'sophomore' | 'junior' | 'senior' | 'grad' | 'commuter'

export type Persona = {
  name: string
  archetype: Archetype
  /** walk-speed multiplier 0.85..1.15 */
  pace: number
  /** 0..100: seeks events, trucks, crowds */
  outgoing: number
  /** 0..100: studies early, leaves early for class */
  diligence: number
  /** RU Express balance, integer cents */
  budget: Cents
  mealPlan: boolean
  backstory: string
}

/** a real section from schedule.json (a real Rutgers meeting) */
export type ClassSlot = {
  sectionId: string
  placeId: string
  building: string
  room: string
  course: string
  title: string
  start: SimMin
  end: SimMin
}

export type MindState = 'home' | 'travel' | 'queue' | 'eat' | 'class' | 'study' | 'gym' | 'event' | 'library'

export type Activity = {
  placeId: string
  kind: 'class' | 'eat' | 'study' | 'gym' | 'event'
  until: SimMin
  /** set when the student is inside the venue and done queueing */
  startedAt: SimMin | null
}

export type TravelPlan = {
  path: P[]
  edges: string[]
  len: number
  t0: SimMin
  t1: SimMin
  /** where this leg is heading and why */
  goal: 'class' | 'eat' | 'study' | 'gym' | 'event' | 'home'
  placeId: string
}

export type Option = { action: string; score: number; why: string }

export type Decision = {
  t: SimMin
  action: string
  reason: string
  options: Option[]
}

export type MindStudent = {
  id: number
  persona: Persona
  needs: Needs
  schedule: ClassSlot[]
  /** index of the next class that has not started yet */
  nextClass: number
  state: MindState
  pos: P
  prev: P
  leg: TravelPlan | null
  activity: Activity | null
  /** queue membership: venue id */
  queuedAt: string | null
  decisions: Decision[]
  /** observed world-facts, newest first, bounded */
  knowledge: string[]
  color: string
  budget: Cents
  /** arrival minutes at attended classes (for lateness metrics) */
  attended: { sectionId: string; lateBy: number }[]
}

/* ---------------- scenario contract ---------------- */

export type Change =
  | {
      kind: 'road_closure'
      id: string
      street: string
      edges: string[]
      from: SimMin
      until: SimMin | null
      closedAt: SimMin | null
    }
  | {
      kind: 'place_add'
      id: string
      name: string
      pos: P
      from: SimMin
      until: SimMin | null
      priceCents: Cents
      servicePerMin: number
      nutrition: number
    }
  | { kind: 'event'; id: string; placeId: string; title: string; from: SimMin; until: SimMin }

export type ScenarioDraft = {
  text: string
  changes: Change[]
  assumptions: string[]
  unsupported: string[]
  ok: boolean
}

export type AppliedChange = Change & { appliedAt: SimMin; revertedAt: SimMin | null }

export type Venue = {
  id: string
  name: string
  kind: 'hall' | 'retail' | 'truck'
  placeId: string
  pos: P
  open: SimMin
  close: SimMin
  mealSwipe: boolean
  priceCents: Cents
  servicePerMin: number
  eatMin: number
  nutrition: number
  /** dynamically added (place_add) venues have an owning change id */
  changeId?: string
  noveltyUntil?: SimMin
}

export type MindMetrics = {
  meals: Record<string, number>
  queueMinutes: Record<string, number>
  revenueCents: Cents
  walkMinutes: number
  classesAttended: number
  classesLate: number
  classesMissed: number
  latenessSumMin: number
  eventAttendees: number
  occupancy: Record<string, number[]>
  stressAvg: number
}
