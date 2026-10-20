/**
 * The focus cohort: a few hundred students with REAL schedules from
 * schedule.json (real Rutgers sections, real buildings, real times) living
 * in real CAC dorms, with deterministic personas. The remaining thousands
 * of background agents stay on the legacy statistical loop — this tiering
 * is what keeps 6,000 figures on screen while every one of THESE students
 * can be clicked and interrogated.
 */
import placesV2 from '../../data/places-v2.json' with { type: 'json' }
import scheduleData from '../../data/schedule.json' with { type: 'json' }
import type { P } from './nav.ts'
import { walkRoute } from './nav.ts'
import type { ClassSlot, MindStudent, Persona, Archetype } from './types.ts'

export type Place = {
  id: string
  n: string
  cat: string
  district: string
  addr: string
  x: number
  z: number
  s: string
  foot: P[]
  a: number
}

export const PLACES = placesV2 as unknown as Place[]
export const placeById = new Map(PLACES.map((p) => [p.id, p]))

type RawSection = {
  id: string
  subj: string
  course: string
  title: string
  sec: string
  placeId: string
  bldg: string
  room: string
  start: number
  end: number
  mode: string
}
export const SCHEDULE = scheduleData as unknown as RawSection[]

/** the section list, typed as the engine uses it */
export const SECTIONS: ClassSlot[] = SCHEDULE.map((s) => ({
  sectionId: s.id,
  placeId: s.placeId,
  building: s.bldg,
  room: s.room,
  course: s.course,
  title: s.title,
  start: s.start,
  end: s.end,
}))

export const posOf = (placeId: string): P => {
  const p = placeById.get(placeId)
  return p ? [p.x, p.z] : [0, 0]
}

export const nameOf = (placeId: string): string => placeById.get(placeId)?.n ?? placeId

/** real CAC dorms (Category "Housing") */
export const HOMES = PLACES.filter((p) => p.district === 'CAC' && p.cat === 'Housing')

/* ---------------- rng (matches the legacy LCG so the day is reproducible) */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/* ---------------- walk matrix between class buildings ---------------- */
const walkMemo = new Map<string, number>()
export function walkMinutes(fromId: string, toId: string): number {
  const key = `${fromId}|${toId}`
  const hit = walkMemo.get(key)
  if (hit !== undefined) return hit
  const r = walkRoute(posOf(fromId), posOf(toId))
  const min = r ? r.len / 1.62 : 8 // fallback if unroutable
  walkMemo.set(key, min)
  walkMemo.set(`${toId}|${fromId}`, min)
  return min
}

/* ---------------- personas ---------------- */
const ARCHETYPES: { a: Archetype; w: number }[] = [
  { a: 'freshman', w: 0.24 },
  { a: 'sophomore', w: 0.2 },
  { a: 'junior', w: 0.18 },
  { a: 'senior', w: 0.18 },
  { a: 'commuter', w: 0.12 },
  { a: 'grad', w: 0.08 },
]

const FIRST = [
  'Maya',
  'Jon',
  'Priya',
  'Leo',
  'Amara',
  'Chris',
  'Nia',
  'Omar',
  'Elena',
  'Ty',
  'Sofia',
  'Wei',
  'Jasmine',
  'Marco',
  'Zoe',
]
const LAST = [
  'Patel',
  'Kim',
  'Rivera',
  'Okafor',
  'Nguyen',
  'Rossi',
  'Ahmed',
  'Silva',
  'Chen',
  'Novak',
  'Ito',
  'Baptiste',
]

const archetypeOf = (r: number): Archetype => {
  let acc = 0
  for (const { a, w } of ARCHETYPES) {
    acc += w
    if (r <= acc) return a
  }
  return 'freshman'
}

function buildPersona(rand: () => number): Persona {
  const archetype = archetypeOf(rand())
  const trait = () => Math.round(15 + rand() * 80)
  const budget =
    archetype === 'commuter' ? 1500 + Math.floor(rand() * 3000) : 3500 + Math.floor(rand() * 5000)
  const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`
  const pace = 0.85 + rand() * 0.3
  const outgoing = trait()
  const diligence = trait()
  const backstory =
    archetype === 'freshman'
      ? `First semester on College Ave — still learning which shortcut through the Seminary block saves two minutes.`
      : archetype === 'commuter'
        ? `Comes in on the express, keeps a tight food budget, knows every truck schedule by heart.`
        : archetype === 'grad'
          ? `TA in the quarter, lives near campus, coffee-fueled and schedule-precise.`
          : `${archetype === 'senior' ? 'Senior' : archetype === 'junior' ? 'Junior' : 'Sophomore'} on College Ave — classes, gym, and a well-practiced lunch routine.`
  return { name, archetype, pace, outgoing, diligence, budget, mealPlan: rand() < 0.78, backstory }
}

/* ---------------- schedule assembly ---------------- */
function feasible(picked: ClassSlot[], cand: ClassSlot, homeId: string): boolean {
  for (const s of picked) {
    if (cand.start < s.end && s.start < cand.end) return false // overlap
  }
  const sorted = [...picked, cand].sort((a, b) => a.start - b.start)
  let prevEnd = -Infinity
  let prevPlace = homeId
  for (const s of sorted) {
    const walk = walkMinutes(prevPlace, s.placeId)
    if (s.start < prevEnd + walk + 1) return false // cannot make it on foot
    prevEnd = s.end
    prevPlace = s.placeId
  }
  return true
}

const COHORT_COLORS = ['#cc0015', '#e2492f', '#d1345b', '#b91c1c', '#9a1622', '#d95f2b', '#c2410c', '#e11d48']

export type Population = { students: MindStudent[]; homeIds: string[] }

export function buildPopulation(seed: number, size: number): Population {
  const rand = rng(seed)
  const students: MindStudent[] = []
  const homeIds = HOMES.length ? HOMES.map((h) => h.id) : ['b3085']

  for (let i = 0; i < size; i++) {
    const persona = buildPersona(rand)
    const homeId = homeIds[Math.floor(rand() * homeIds.length) % homeIds.length]
    const home = placeById.get(homeId)!

    // 2-4 real sections, feasibility-repaired greedily
    const want = 2 + Math.floor(rand() * 3)
    const picked: ClassSlot[] = []
    // deterministic per-student scan window keeps the draws spread over the day
    const scan = Math.floor(rand() * SECTIONS.length)
    for (let n = 0; n < SECTIONS.length && picked.length < want; n++) {
      const cand = SECTIONS[(scan + n) % SECTIONS.length]
      if (picked.some((p) => p.sectionId === cand.sectionId)) continue
      if (feasible(picked, cand, homeId)) picked.push(cand)
    }
    picked.sort((a, b) => a.start - b.start)

    const pos: P = [home.x, home.z]
    students.push({
      id: i,
      persona,
      needs: {
        hunger: Math.round(20 + rand() * 40),
        energy: Math.round(70 + rand() * 25),
        stress: Math.round(5 + rand() * 20),
      },
      schedule: picked,
      nextClass: 0,
      state: 'home',
      pos,
      prev: pos,
      leg: null,
      activity: null,
      queuedAt: null,
      decisions: [],
      knowledge: [],
      color: COHORT_COLORS[i % COHORT_COLORS.length],
      budget: persona.budget,
      attended: [],
    })
  }
  return { students, homeIds }
}
