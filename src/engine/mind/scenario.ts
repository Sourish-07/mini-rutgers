/**
 * The what-if parser: turns operator sentences into typed scenario changes.
 * Demo-0 grammar (each clause optional, order flexible):
 *   "close Hamilton Street at 3pm until 5pm"
 *   "put a food truck on Vorhees Mall at noon"
 *   "host an event in Scott Hall at 6pm"
 * Everything the parser cannot ground in real data is surfaced explicitly as
 * an assumption or an unsupported clause — never silently ignored.
 */
import streetsData from '../../data/streets.json' with { type: 'json' }
import { PLACES } from './population.ts'
import { edgesNear, snap, type P } from './nav.ts'
import type { Change, ScenarioDraft, SimMin } from './types.ts'

const STREETS = streetsData as unknown as Record<string, P[]>
const START = 7 * 60

/** 24h clock → sim minutes since 07:00 (may be negative = before START) */
const clockToSim = (h: number, m: number) => h * 60 + m - START

/** parse "3", "3:30", "3pm", "noon" → {h,m} */
function parseClock(raw: string): { h: number; m: number } | null {
  const s = raw.trim().toLowerCase()
  if (s === 'noon') return { h: 12, m: 0 }
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const pm = (m[3] ?? '').startsWith('p')
  const am = (m[3] ?? '').startsWith('a')
  if (pm && h < 12) h += 12
  if (am && h === 12) h = 0
  if (!pm && !am && h > 0 && h <= 6) h += 12 // "close X at 3" → 3pm
  return { h, m: min }
}

/** first time token after a keyword ("at", "until") */
function timeAfter(text: string, keyword: string): { h: number; m: number } | null {
  const re = new RegExp(`\\b${keyword}\\s+([0-9]{1,2}(?::[0-9]{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?|noon)`, 'i')
  const m = text.match(re)
  return m ? parseClock(m[1].replace(/\s+/g, '')) : null
}

/** next 5-minute boundary strictly after `now` */
export const nextBoundary = (now: SimMin) => Math.ceil((now + 0.01) / 5) * 5

const lower = (s: string) => s.toLowerCase()

/** fuzzy street match: "hamilton" → "Hamilton Street" */
function matchStreet(q: string): string | null {
  const needle = lower(q)
    .replace(/\b(street|st|avenue|ave|road|place)\b/g, '')
    .trim()
  if (!needle) return null
  for (const name of Object.keys(STREETS)) {
    if (lower(name).includes(needle) || needle.includes(lower(name).split(' ')[0])) return name
  }
  return null
}

/** landmarks that are not buildings (named plazas/malls on campus) */
const LANDMARKS: Record<string, { pos: P; label: string }> = {}
// Vorhees Mall: the green between Alexander Library and the Seminary block
{
  const lib = PLACES.find((p) => p.n === 'Alexander Library')
  const sem = PLACES.find((p) => p.n === 'New Brunswick Theological Seminary')
  if (lib && sem)
    LANDMARKS['vorhees mall'] = {
      pos: [(lib.x + sem.x) / 2, (lib.z + sem.z) / 2],
      label: 'Vorhees Mall',
    }
  const yard = PLACES.find((p) => p.n === 'College Avenue Yard Bus Shelter')
  if (yard) LANDMARKS['the yard'] = { pos: [yard.x, yard.z], label: 'the Yard' }
}

/** match a place/landmark by name substring */
export function matchPlace(q: string): { pos: P; label: string } | null {
  const needle = lower(q)
    .replace(/\b(the|a|an)\b/g, '')
    .trim()
  if (!needle) return null
  for (const [k, v] of Object.entries(LANDMARKS)) if (needle.includes(k)) return v
  let best: { pos: P; label: string } | null = null
  let bestLen = 0
  for (const p of PLACES) {
    const n = lower(p.n)
    if (n.length < 4) continue
    if (needle.includes(n) || (n.includes(needle) && needle.length >= 4)) {
      if (n.length > bestLen) {
        bestLen = n.length
        best = { pos: [p.x, p.z], label: p.n }
      }
    }
  }
  return best
}

let changeCounter = 0
const cid = (kind: string) => `ch_${kind}_${++changeCounter}`

/**
 * Parse operator text into a draft. `now` is the current sim minute; times in
 * the text are absolute clock times converted to sim minutes.
 */
export function parseScenario(text: string, now: SimMin): ScenarioDraft {
  const assumptions: string[] = []
  const unsupported: string[] = []
  const changes: Change[] = []
  const lowerText = lower(text)

  const at = timeAfter(text, 'at')
  const untilC = timeAfter(text, 'until')
  const from = at ? clockToSim(at.h, at.m) : nextBoundary(now)
  const until = untilC ? clockToSim(untilC.h, untilC.m) : null

  /* ---- closures: "close Hamilton Street at 3pm until 5pm" ---- */
  const close = lowerText.match(
    /(?:close|block|shut(?:\s+down)?)\s+(?:down\s+)?([a-z][a-z\s]*?(?:street|st|avenue|ave|road|place))/,
  )
  if (close) {
    const street = matchStreet(close[1])
    if (street) {
      const pts = STREETS[street]
      const edges = edgesNear(pts, 0.6) // both endpoints within 30 m of the street
      if (edges.length === 0) {
        unsupported.push(`"${close[1].trim()}" matched no walk edges in the campus graph`)
      } else {
        changes.push({
          kind: 'road_closure',
          id: cid('closure'),
          street,
          edges,
          from,
          until,
          closedAt: null,
        })
        if (!at) assumptions.push(`no time given — closing ${street} at the next 5-minute boundary`)
        assumptions.push(
          `closure covers all ${edges.length} graph edges within 30 m of ${street} (cross-street ranges like "from X to Y" are not yet supported)`,
        )
      }
    } else {
      unsupported.push(
        `I don't know the street "${close[1].trim()}" — known: ${Object.keys(STREETS).join(', ')}`,
      )
    }
  }

  /* ---- food trucks: "put a food truck on Vorhees Mall at noon" ---- */
  const truck = lowerText.match(
    /(?:put|add|place|drop)\s+(?:a\s+|an\s+|the\s+)?(?:food\s+)?truck\s+(?:at|on|by|near|in|in\s+front\s+of)?\s*([a-z][a-z\s]*?)(?=\s+at|\s+until|[,.;]|$)/,
  )
  if (truck) {
    const spot = matchPlace(truck[1])
    if (spot) {
      changes.push({
        kind: 'place_add',
        id: cid('truck'),
        name: 'Food truck',
        pos: snap(spot.pos),
        from,
        until,
        priceCents: 795,
        servicePerMin: 4,
        nutrition: 42,
      })
      if (!at) assumptions.push(`no time given — the truck opens at the next 5-minute boundary`)
      assumptions.push(`truck parks at the nearest walkable point to ${spot.label}`)
    } else {
      unsupported.push(`I couldn't place "${truck[1].trim()}" on the map`)
    }
  }

  /* ---- events: "host an event in Scott Hall at 6pm" ---- */
  const event = lowerText.match(
    /(?:host|schedule|put\s+on|add|hold)?\s*(?:an?\s+)?event\s+(?:in|at)\s+([a-z][a-z\s]*?)(?=\s+at|\s+until|[,.;]|$)/,
  )
  if (event) {
    const spot = matchPlace(event[1])
    if (spot) {
      const place = PLACES.find((p) => p.n === spot.label)
      if (place) {
        changes.push({
          kind: 'event',
          id: cid('event'),
          placeId: place.id,
          title: `${place.n} event`,
          from,
          until: until ?? from + 120,
        })
        if (!at) assumptions.push(`no time given — doors at the next 5-minute boundary`)
      }
    } else {
      unsupported.push(`I couldn't find a building called "${event[1].trim()}"`)
    }
  }

  if (changes.length === 0 && unsupported.length === 0)
    unsupported.push(
      'try: "close Hamilton Street at 3pm until 5pm" · "put a food truck on Vorhees Mall at noon" · "host an event in Scott Hall at 6pm"',
    )

  return { text, changes, assumptions, unsupported, ok: changes.length > 0 }
}

/** canned scenarios for the demo (also used by the checks).
 *  Bishop Place is the cohort's true walking spine (the OSM walk graph routes
 *  dorm→class trips through it); Hamilton Street edges are driveways/footways
 *  no A* path uses, so a Bishop closure is the one with visible effects. */
export const PRESETS = [
  'close Bishop Place at 10am until noon',
  'put a food truck on Vorhees Mall at noon',
  'host an event in Scott Hall at 6pm',
]
