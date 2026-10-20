/**
 * The simulation engine. Everything visible in the scene is a state of this file.
 *
 * Units: 1 scene unit = 50 m, 1 tick = 1 simulated minute.
 * Speeds are therefore in units per minute: 18 km/h = 6 u/min, walking 1.35 m/s = 1.62 u/min.
 *
 * Determinism: every random draw flows through the seeded LCG in ./rng.ts, so the
 * same { population, seed } always reproduces the same day — snapshotHash() makes
 * that a testable property. Scenario events (./scenario.ts) activate at exact tick
 * boundaries, which keeps what-ifs reviewable and paired A/B runs honest.
 */
import stopsData from '../data/stops.json' with { type: 'json' }
import routesData from '../data/routes.json' with { type: 'json' }
import pathsData from '../data/paths.json' with { type: 'json' }
import placesData from '../data/places.json' with { type: 'json' }
import { pathLength, samplePath, walkRoute, type P } from '../network.ts'
import { lcg, gaussian, type Rng } from './rng.ts'
import type { Scenario, ScenarioEvent } from './scenario.ts'

export type StopKey = keyof typeof stopsData
export type Stop = { label: string; lat: number; lon: number; at: P }

export const STOPS = stopsData as unknown as Record<string, Stop>

export type Route = {
  ref: string
  colour: string
  stops: string[]
  path: P[]
  len: number
  /** arc-length position of each stop along the loop */
  halt: number[]
}

const PALETTE: Record<string, string> = {
  A: '#7b478a',
  B: '#1f6f3f',
  'B/L': '#818489',
  C: '#1d4ed8',
  EE: '#b45309',
  F: '#0f766e',
  H: '#be123c',
  Lx: '#0369a1',
  RexB: '#a16207',
  RexL: '#4d7c0f',
  W1: '#9333ea',
  W2: '#c026d3',
}

function projectOnLoop(path: P[], p: P): number {
  let best = 0
  let bestD = Infinity
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const l2 = dx * dx + dz * dz || 1
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2
    t = Math.max(0, Math.min(1, t))
    const qx = a[0] + dx * t
    const qz = a[1] + dz * t
    const d = (qx - p[0]) ** 2 + (qz - p[1]) ** 2
    if (d < bestD) {
      bestD = d
      best = acc + Math.sqrt(l2) * t
    }
    acc += Math.sqrt(l2)
  }
  return best
}

export const ROUTES: Route[] = (routesData as unknown as { ref: string; stops: string[] }[]).map((r) => {
  const path = (pathsData as unknown as Record<string, P[]>)[r.ref]
  return {
    ref: r.ref,
    colour: PALETTE[r.ref] ?? '#64748b',
    stops: r.stops,
    path,
    len: pathLength(path),
    halt: r.stops.map((k) => projectOnLoop(path, STOPS[k].at)),
  }
})

/* ------------------------------------------------------------------ */
/* tuning                                                             */
/* ------------------------------------------------------------------ */
export const BUS_SPEED = 6 // units/min = 18 km/h
export const WALK_SPEED = 1.62 // units/min = 4.86 km/h
/**
 * Rutgers buses seat about 44 and stand to roughly 77 total. Each vehicle draws
 * its own figure from this band so a mixed fleet behaves like a real one — some
 * buses fill early and leave people behind, others take the overflow.
 */
export const CAPACITY_MIN = 70
export const CAPACITY_MAX = 84
export const CAPACITY = 77 // nominal, for thresholds and labels
export const DWELL = 0.4 // minutes at each stop
export const START = 7 * 60 // 07:00
/** instance headroom: the base population plus the largest scenario surge */
export const AGENT_CAP = 24000

/** headway in minutes per route, weekday daytime. Anything not listed runs at 12. */
const HEADWAY: Record<string, number> = {
  A: 6,
  B: 5,
  C: 12,
  H: 7,
  RexB: 9,
  RexL: 7,
  Lx: 4,
  EE: 10,
  F: 10,
  'B/L': 12,
  W1: 15,
  W2: 15,
}

export type AgentState = 'home' | 'walk-stop' | 'wait' | 'ride' | 'walk-dest' | 'at-dest'

export type Agent = {
  id: number
  state: AgentState
  /** current position, and the position one tick ago (for interpolation) */
  x: number
  z: number
  px: number
  pz: number
  col: string
  home: P
  dest: P
  stop: string
  /** walk leg: polyline + start/end minute */
  leg: { path: P[]; t0: number; t1: number } | null
  /** minutes spent in the current state */
  since: number
  bus: number
  /** the stop they alight at */
  destStop: string
  /** time they must be at their destination */
  due: number
  /** 'event' while heading to / at a scenario event, 'event-return' on the way home */
  role: 'resident' | 'event' | 'event-return'
  /** scenario event that spawned this agent (surge/egress waves) */
  eventTag: string | null
  /** minute this agent joined a stop queue — the wait-time metric */
  waitSince: number | null
  /** event-goers leave the venue at this minute */
  egressAt: number | null
  /** event-goers that are home for the rest of the day */
  settled: boolean
}

export type Bus = {
  route: Route
  /** distance along the loop */
  d: number
  /** distance one tick ago — interpolate along the path, never across it */
  pd: number
  x: number
  z: number
  px: number
  pz: number
  dwell: number
  riders: number[]
  /** this vehicle's own legal load, drawn once at spawn */
  capacity: number
  /** next stop index this bus will serve */
  next: number
}

export type Metrics = {
  minute: number
  avgWaitMin: number | null
  p95WaitMin: number | null
  maxWaitMin: number
  waitSamples: number
  totalLeftBehind: number
  leftBehindByStop: Record<string, number>
  avgWaitByStop: Record<string, number | null>
  maxQueueByStop: Record<string, number>
  boardingsTotal: number
  appliedEvents: number
}

export type Sim = ReturnType<typeof createSim>

const SHIRTS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#4b5563', '#be185d']
/** event-goers wear the scenario colour so a surge is visible from the air */
const EVENT_SHIRTS = ['#f59e0b', '#ea580c', '#f97316']

export function createSim(opts: { population?: number; seed?: number } = {}) {
  const population = opts.population ?? 600
  const rand: Rng = lcg(opts.seed ?? 7)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length) % xs.length]

  const stopKeys = Object.keys(STOPS)
  const places = placesData as unknown as { n?: string; x: number; z: number; s: string }[]
  const carriers = ROUTES.filter((r) => r.stops.length >= 2)

  /** stops at least one modeled route actually serves */
  const served = new Set<string>()
  for (const r of carriers) for (const s of r.stops) served.add(s)

  /**
   * The stop data includes shelters no modeled route serves (e.g. Rodkin). Agents
   * bound there would wait forever, so homes, destinations and events snap to the
   * nearest stop a bus actually calls at.
   */
  function nearestServedStop(pos: P): string {
    let best = stopKeys[0]
    let bd = Infinity
    for (const k of stopKeys) {
      if (!served.has(k)) continue
      const d = (STOPS[k].at[0] - pos[0]) ** 2 + (STOPS[k].at[1] - pos[1]) ** 2
      if (d < bd) {
        bd = d
        best = k
      }
    }
    return best
  }

  /* ---------------- agents ---------------- */
  const agents: Agent[] = []
  for (let i = 0; i < population; i++) {
    const from = places.length ? pick(places) : { x: 0, z: 0, s: pick(stopKeys) }
    const home: [number, number] = [from.x, from.z]
    const homeKey = from.s
    // most people leave home once and come back; the rest stay put
    const to = places.length && rand() >= 0.25 ? pick(places) : from
    const dest: [number, number] = [to.x, to.z]
    const destKey = to.s
    agents.push({
      id: i,
      state: 'home',
      x: home[0],
      z: home[1],
      px: home[0],
      pz: home[1],
      col: SHIRTS[i % SHIRTS.length],
      home,
      dest,
      stop: served.has(homeKey) ? homeKey : nearestServedStop(home),
      destStop: served.has(destKey) ? destKey : nearestServedStop(dest),
      leg: null,
      since: START,
      bus: -1,
      // two waves: the morning rush and the evening one, so the campus is never
      // empty and never uniformly busy
      due: START + (rand() < 0.65 ? 45 + Math.floor(rand() * 90) : 540 + Math.floor(rand() * 150)),
      role: 'resident',
      eventTag: null,
      waitSince: null,
      egressAt: null,
      settled: false,
    })
  }

  /* ---------------- buses ---------------- */
  const buses: Bus[] = []
  function makeBus(route: Route, d: number): Bus {
    const p = samplePath(route.path, d / route.len)
    let next = 0
    for (let i = 0; i < route.halt.length; i++) {
      if (route.halt[i] > d) {
        next = i
        break
      }
    }
    return {
      route,
      d,
      pd: d,
      x: p[0],
      z: p[1],
      px: p[0],
      pz: p[1],
      dwell: 0,
      riders: [],
      capacity: CAPACITY_MIN + Math.floor(rand() * (CAPACITY_MAX - CAPACITY_MIN + 1)),
      next,
    }
  }
  for (const route of carriers) {
    const headway = HEADWAY[route.ref] ?? 12
    const cycle = route.len / BUS_SPEED + route.stops.length * DWELL
    const n = Math.max(1, Math.round(cycle / headway))
    for (let k = 0; k < n; k++) buses.push(makeBus(route, (route.len * k) / n))
  }

  /* ---------------- the day ---------------- */
  const queue: Record<string, number[]> = {}
  const boardings: Record<string, number[]> = {}
  /** people waiting at each stop, one sample per minute */
  const history: Record<string, number[]> = {}
  /** people a full bus left behind at each stop, one sample per minute */
  const leftBehind: Record<string, number[]> = {}
  for (const k of stopKeys) {
    queue[k] = []
    boardings[k] = []
    history[k] = []
    leftBehind[k] = []
  }

  /** every completed wait (minutes), the raw material of the wait metrics */
  const waitSamples: number[] = []
  const waitSumByStop: Record<string, number> = {}
  const waitCountByStop: Record<string, number> = {}
  let boardingsTotal = 0

  let minute = START

  /* ---------------- scenario machinery ---------------- */
  let revision = 0
  let pending: ScenarioEvent[] = []
  const applied: ScenarioEvent[] = []
  const closures: { stop: string; from: number; to: number }[] = []

  const isClosed = (stop: string, t: number) =>
    closures.some((c) => c.stop === stop && t >= c.from && t < c.to)

  function walkLeg(from: P, to: P, t0: number) {
    const path = walkRoute(from, to)
    return { path, t0, t1: t0 + Math.max(1, pathLength(path) / WALK_SPEED) }
  }

  function nearestOpenStop(pos: P, t: number): string {
    let best = stopKeys[0]
    let bd = Infinity
    for (const k of stopKeys) {
      if (isClosed(k, t)) continue
      const d = (STOPS[k].at[0] - pos[0]) ** 2 + (STOPS[k].at[1] - pos[1]) ** 2
      if (d < bd) {
        bd = d
        best = k
      }
    }
    return best
  }

  /**
   * Events fire at the tick boundary their minute arrives at. Everything an event
   * does is a plain, observable state change — no hidden scheduling.
   */
  function activate(e: ScenarioEvent, t: number) {
    applied.push(e)
    if (e.kind === 'event_surge') {
      // attendees come from real buildings across campus and converge on the venue
      const venues = places.filter((p) => p.s === e.stop)
      const anchor = STOPS[e.stop]?.at ?? ([0, 0] as P)
      const arrival = e.arrivalSpreadMin ?? 45
      const egress = e.egressSpreadMin ?? 30
      let n = Math.max(1, Math.round(e.attendees * (e.showRate ?? 0.72)))
      n = Math.min(n, AGENT_CAP - agents.length)
      for (let k = 0; k < n; k++) {
        const from = pick(places)
        const venue = venues.length ? pick(venues) : { x: anchor[0], z: anchor[1] }
        const home: [number, number] = [from.x, from.z]
        const dest: [number, number] = [venue.x, venue.z]
        agents.push({
          id: agents.length,
          state: 'home',
          x: home[0],
          z: home[1],
          px: home[0],
          pz: home[1],
          col: EVENT_SHIRTS[k % EVENT_SHIRTS.length],
          home,
          dest,
          stop: served.has(from.s) ? from.s : nearestServedStop(home),
          destStop: e.stop,
          leg: null,
          since: START,
          bus: -1,
          // arrivals cluster around doors; a late-applied event spawns stragglers now
          due: Math.max(t, e.startMin + Math.round(gaussian(rand) * (arrival / 2.5) + arrival * 0.15)),
          role: 'event',
          eventTag: e.id,
          waitSince: null,
          egressAt: e.endMin + Math.max(0, Math.round(Math.abs(gaussian(rand)) * (egress / 2.5))),
          settled: false,
        })
      }
    } else if (e.kind === 'stop_closure') {
      closures.push({ stop: e.stop, from: e.fromMin, to: e.toMin })
      // people already waiting at the closed stop walk to the nearest open one
      for (const id of queue[e.stop]) {
        const a = agents[id]
        if (a.state !== 'wait') continue
        a.stop = nearestOpenStop([a.x, a.z], t)
        a.state = 'walk-stop'
        a.since = t
        a.waitSince = null
        a.leg = walkLeg([a.x, a.z], STOPS[a.stop].at, t)
      }
      queue[e.stop] = []
      // anyone whose plans touch the closed stop retargets to the nearest open one
      for (const a of agents) {
        if (a.settled) continue
        // already walking there to catch a bus: pick a different stop, from where they stand
        if (a.state === 'walk-stop' && a.stop === e.stop) {
          a.stop = nearestOpenStop([a.x, a.z], t)
          a.leg = walkLeg([a.x, a.z], STOPS[a.stop].at, t)
        }
        if (a.destStop !== e.stop) continue
        if (a.state === 'ride') {
          // riders can only alight at stops their current bus actually serves
          const b = buses[a.bus]
          let best: string | null = null
          let bd = Infinity
          for (const k of b.route.stops) {
            if (isClosed(k, t)) continue
            const d = (STOPS[k].at[0] - a.dest[0]) ** 2 + (STOPS[k].at[1] - a.dest[1]) ** 2
            if (d < bd) {
              bd = d
              best = k
            }
          }
          if (best) a.destStop = best
        } else if (a.state === 'wait' || a.state === 'walk-stop') {
          a.destStop = nearestOpenStop(a.dest, t)
        }
      }
    } else if (e.kind === 'fleet_add') {
      const route = ROUTES.find((r) => r.ref === e.route)
      if (!route) return
      for (let k = 0; k < e.buses; k++) buses.push(makeBus(route, (route.len * (k + 0.5)) / e.buses))
    }
  }

  function applyScenario(sc: Scenario): { ok: boolean; error?: string } {
    for (const e of sc.events) {
      if (e.kind !== 'fleet_add' && !STOPS[e.stop]) return { ok: false, error: `unknown stop "${e.stop}"` }
      if (e.kind !== 'fleet_add' && !served.has(e.stop))
        return { ok: false, error: `no modeled route serves "${STOPS[e.stop].label}"` }
      if (e.kind === 'fleet_add' && !ROUTES.some((r) => r.ref === e.route))
        return { ok: false, error: `unknown route "${e.route}"` }
    }
    pending = pending.concat(sc.events)
    revision += 1
    return { ok: true }
  }

  function step(t: number) {
    /* scenario events whose minute has arrived apply at this exact boundary */
    const due = pending.filter((e) => {
      const at = e.kind === 'stop_closure' ? e.fromMin : e.kind === 'fleet_add' ? e.atMin : e.startMin
      return t >= at
    })
    if (due.length) {
      pending = pending.filter((e) => !due.includes(e))
      for (const e of due) activate(e, t)
    }

    for (const a of agents) {
      a.px = a.x
      a.pz = a.z
    }
    for (const b of buses) {
      b.px = b.x
      b.pz = b.z
      b.pd = b.d
    }

    /* buses move along their loop, dwelling at stops */
    for (const b of buses) {
      if (b.dwell > 0) {
        b.dwell = Math.max(0, b.dwell - 1)
        continue
      }
      const before = b.d
      b.d = (b.d + BUS_SPEED) % b.route.len
      // crossing a halt starts a dwell and lets people off and on
      for (let i = 0; i < b.route.halt.length; i++) {
        const h = b.route.halt[i]
        const crossed = before <= b.d ? h > before && h <= b.d : h > before || h <= b.d
        if (!crossed) continue
        const key = b.route.stops[i]
        // a closed stop is skipped entirely — the bus drives straight through
        if (isClosed(key, t)) continue
        b.dwell = DWELL
        b.next = (i + 1) % b.route.halt.length
        // off
        const staying: number[] = []
        for (const id of b.riders) {
          const a = agents[id]
          if (a.destStop === key) {
            a.state = 'walk-dest'
            a.since = t
            a.bus = -1
            a.x = STOPS[key].at[0]
            a.z = STOPS[key].at[1]
            a.leg = walkLeg([a.x, a.z], a.dest, t)
          } else staying.push(id)
        }
        b.riders = staying
        // on: anyone waiting here whose destination is served by this route
        const wants = queue[key]
        const keep: number[] = []
        let boarded = 0
        for (const id of wants) {
          const a = agents[id]
          const serves = b.route.stops.includes(a.destStop)
          const ok = b.riders.length < b.capacity && serves
          if (ok) {
            a.state = 'ride'
            a.bus = buses.indexOf(b)
            a.since = t
            const waited = t - (a.waitSince ?? t)
            waitSamples.push(waited)
            waitSumByStop[key] = (waitSumByStop[key] ?? 0) + waited
            waitCountByStop[key] = (waitCountByStop[key] ?? 0) + 1
            a.waitSince = null
            b.riders.push(id)
            boarded++
          } else {
            keep.push(id)
            // a full bus that would have taken them: the left-behind operators care about
            if (serves) leftBehind[key][t - START] = (leftBehind[key][t - START] ?? 0) + 1
          }
        }
        queue[key] = keep
        boardings[key][t - START] = (boardings[key][t - START] ?? 0) + boarded
        boardingsTotal += boarded
      }
      const p = samplePath(b.route.path, b.d / b.route.len)
      b.x = p[0]
      b.z = p[1]
    }

    /* agents */
    for (const a of agents) {
      switch (a.state) {
        case 'home': {
          if (t < a.due - 40) break
          if (isClosed(a.stop, t)) a.stop = nearestOpenStop([a.x, a.z], t)
          if (isClosed(a.destStop, t)) a.destStop = nearestOpenStop(a.dest, t)
          a.state = 'walk-stop'
          a.since = t
          a.leg = walkLeg([a.x, a.z], STOPS[a.stop].at, t)
          break
        }
        case 'walk-stop':
        case 'walk-dest': {
          const leg = a.leg
          if (!leg) break
          const f = (t - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)
          const p = samplePath(leg.path, f)
          a.x = p[0]
          a.z = p[1]
          if (f >= 1) {
            a.leg = null
            if (a.state === 'walk-stop') {
              a.state = 'wait'
              a.since = t
              a.waitSince = t
              if (!queue[a.stop].includes(a.id)) queue[a.stop].push(a.id)
            } else {
              a.state = 'at-dest'
              a.since = t
              if (a.role === 'event-return') a.settled = true
            }
          }
          break
        }
        case 'wait':
          break
        case 'ride':
          break
        case 'at-dest': {
          if (a.settled) break
          if (a.egressAt !== null) {
            // event-goers leave in a wave — and they take the bus home, which is
            // the egress rush this whole scenario exists to preview
            if (t < a.egressAt) break
            a.role = 'event-return'
            a.state = 'walk-stop'
            a.since = t
            a.egressAt = null
            a.dest = a.home
            a.stop = nearestOpenStop([a.x, a.z], t)
            a.destStop = nearestOpenStop(a.home, t)
            a.leg = walkLeg([a.x, a.z], STOPS[a.stop].at, t)
            break
          }
          if (t - a.since < 45) break
          a.state = 'walk-dest'
          a.since = t
          a.dest = a.home
          a.leg = walkLeg([a.x, a.z], a.home, t)
          break
        }
      }
    }

    for (const k of stopKeys) queue[k] = queue[k].filter((id) => agents[id].state === 'wait')
    for (const k of stopKeys) history[k][t - START] = queue[k].length

    minute = t + 1
  }

  return {
    agents,
    buses,
    queue,
    boardings,
    history,
    leftBehind,
    appliedEvents: applied,
    get minute() {
      return minute
    },
    get scenarioRevision() {
      return revision
    },
    /** advance to an absolute minute; no-op if already there */
    runTo(target: number) {
      while (minute < target) step(minute)
    },
    /** schedule a scenario; its events activate at their own tick boundaries */
    applyScenario,
    stats() {
      let waiting = 0
      let riding = 0
      let walking = 0
      for (const a of agents) {
        if (a.state === 'wait') waiting++
        else if (a.state === 'ride') riding++
        else if (a.state === 'walk-stop' || a.state === 'walk-dest') walking++
      }
      return { waiting, riding, walking, fleet: buses.length }
    },
    /** operator-facing day metrics; nulls mean "nothing measured yet" */
    metrics(): Metrics {
      const n = waitSamples.length
      const sorted = n ? [...waitSamples].sort((x, y) => x - y) : []
      const p95 = n ? sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)] : null
      const leftBehindByStop: Record<string, number> = {}
      const avgWaitByStop: Record<string, number | null> = {}
      const maxQueueByStop: Record<string, number> = {}
      for (const k of stopKeys) {
        leftBehindByStop[k] = leftBehind[k].reduce((s, v) => s + (v ?? 0), 0)
        const c = waitCountByStop[k] ?? 0
        avgWaitByStop[k] = c ? (waitSumByStop[k] ?? 0) / c : null
        let peak = 0
        for (const v of history[k]) if ((v ?? 0) > peak) peak = v ?? 0
        maxQueueByStop[k] = peak
      }
      return {
        minute,
        avgWaitMin: n ? sorted.reduce((s, v) => s + v, 0) / n : null,
        p95WaitMin: p95,
        maxWaitMin: n ? sorted[n - 1] : 0,
        waitSamples: n,
        totalLeftBehind: Object.values(leftBehindByStop).reduce((s, v) => s + v, 0),
        leftBehindByStop,
        avgWaitByStop,
        maxQueueByStop,
        boardingsTotal,
        appliedEvents: applied.length,
      }
    },
    /**
     * FNV-1a over the live state. Two sims with the same { population, seed } and
     * the same scenario list must produce the same hash at the same minute — this
     * is the determinism guarantee the A/B comparisons rely on.
     */
    snapshotHash(): string {
      let h = 0x811c9dc5
      const mix = (s: string) => {
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i)
          h = Math.imul(h, 0x01000193)
        }
      }
      mix(`m${minute}`)
      for (const a of agents) mix(`${a.id},${a.state},${a.x.toFixed(2)},${a.z.toFixed(2)}`)
      for (const b of buses) mix(`${b.route.ref},${b.d.toFixed(2)},${b.riders.length}`)
      return (h >>> 0).toString(16)
    },
  }
}
