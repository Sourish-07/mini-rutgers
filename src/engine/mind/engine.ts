/**
 * The mind engine: a per-minute tick that drives the focus cohort through a
 * real Rutgers day — needs decay, dining queues, class attendance, study/gym
 * choices, event attendance — and reacts to applied world changes (closures,
 * trucks, events) only through what a student can plausibly observe.
 *
 * Determinism: one seeded LCG stream for the whole engine; identical inputs
 * (seed + data + change list) reproduce the day bit-for-bit, which is what
 * makes baseline-vs-scenario comparisons honest.
 */
import diningData from '../../data/dining.json' with { type: 'json' }
import { buildPopulation, nameOf, posOf, type Population } from './population.ts'
import { bumpEpoch, distToPoints, edgeById, samplePath, snap, walkRoute } from './nav.ts'
import { parseScenario } from './scenario.ts'
import type {
  AppliedChange,
  Change,
  MindMetrics,
  MindStudent,
  Option,
  ScenarioDraft,
  SimMin,
  TravelPlan,
  Venue,
} from './types.ts'

export const START = 7 * 60
export const DAY_END = 19 * 60 // 02:00
const WALK_SPEED = 1.62 // units/min — matches the legacy engine

type DiningFile = {
  venues: {
    id: string
    placeId: string
    name: string
    kind: 'hall' | 'retail' | 'truck'
    open: number
    close: number
    mealSwipe: boolean
    priceCents: number
    servicePerMin: number
    eatMin: number
    nutrition: number
  }[]
  study: { id: string; placeId: string; name: string; open: number; close: number }[]
  gym: { id: string; placeId: string; name: string; open: number; close: number }[]
}

/** queue state lives beside the venue, not inside it (venues are JSON-shaped) */
type LiveVenue = Venue & { queue: number[]; label: string }

export type Mind = ReturnType<typeof createMind>

export function createMind(opts: { seed?: number; cohort?: number } = {}) {
  const pop: Population = buildPopulation(opts.seed ?? 21, opts.cohort ?? 420)
  const students = pop.students

  /* ---------------- venues (real Rutgers dining) ---------------- */
  const file = diningData as unknown as DiningFile
  const venues = new Map<string, LiveVenue>()
  for (const v of file.venues) {
    venues.set(v.id, {
      ...v,
      pos: snap(posOf(v.placeId)),
      queue: [],
      label: nameOf(v.placeId),
    })
  }
  const study = file.study[0]
  const gym = file.gym[0]

  // home positions: a student's initial position in the population pass IS their dorm
  const homeCache = new Map<number, [number, number]>()
  for (const s of students) homeCache.set(s.id, [s.pos[0], s.pos[1]])
  const homePos = (s: MindStudent): [number, number] => homeCache.get(s.id) ?? [0, 0]

  /* ---------------- world state ---------------- */
  const blocked = new Set<string>()
  const applied: AppliedChange[] = []
  const pending: { change: Change; at: SimMin }[] = []
  const activeEvents: { id: string; placeId: string; title: string; from: SimMin; until: SimMin }[] = []
  let minute = 0

  /* ---------------- metrics ---------------- */
  const metrics: MindMetrics = {
    meals: {},
    queueMinutes: {},
    revenueCents: 0,
    walkMinutes: 0,
    classesAttended: 0,
    classesLate: 0,
    classesMissed: 0,
    latenessSumMin: 0,
    eventAttendees: 0,
    occupancy: {},
    stressAvg: 0,
  }
  const bucket = (t: SimMin) => Math.floor(t / 10)
  const occ = (placeId: string, t: SimMin) => {
    let arr = metrics.occupancy[placeId]
    if (!arr) {
      arr = new Array(Math.ceil(DAY_END / 10)).fill(0)
      metrics.occupancy[placeId] = arr
    }
    arr[bucket(t)]++
  }

  /* ---------------- per-student memory (bounded) ---------------- */
  function log(s: MindStudent, t: SimMin, action: string, reason: string, options: Option[]) {
    s.decisions.unshift({ t, action, reason, options })
    if (s.decisions.length > 12) s.decisions.length = 12
  }
  function knows(s: MindStudent, fact: string) {
    s.knowledge.unshift(fact)
    if (s.knowledge.length > 8) s.knowledge.length = 8
  }
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const clock = (t: SimMin) => {
    const m = (((START + t) % 1440) + 1440) % 1440
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  /* ---------------- pairwise walk matrix ---------------- */
  // placeId→placeId minutes; '__home__' resolves per-student to their dorm.
  const pairMemo = new Map<string, number>()
  function walkMinutesBetween(fromId: string, toId: string, s?: MindStudent): number {
    const isHome = fromId === '__home__' || toId === '__home__'
    const key = isHome ? `${s!.id}|${fromId}>${toId}` : `${fromId}|${toId}`
    let v = pairMemo.get(key)
    if (v === undefined) {
      const from = fromId === '__home__' ? homePos(s!) : posOf(fromId)
      const to = toId === '__home__' ? homePos(s!) : posOf(toId)
      const r = walkRoute(from, to)
      v = r ? r.len / (isHome ? WALK_SPEED * s!.persona.pace : WALK_SPEED) : 12
      pairMemo.set(key, v)
    }
    return v
  }
  const walkMinutesHome = (s: MindStudent, placeId: string) => walkMinutesBetween('__home__', placeId, s)

  /* ---------------- travel ---------------- */
  function legTo(
    s: MindStudent,
    t: SimMin,
    target: [number, number],
    goal: TravelPlan['goal'],
    placeId: string,
  ): boolean {
    const r = walkRoute(s.pos, target, blocked)
    if (!r || r.path.length === 0) return false
    const speed = WALK_SPEED * s.persona.pace
    s.leg = { path: r.path, edges: r.edges, len: r.len, t0: t, t1: t + r.len / speed, goal, placeId }
    s.state = 'travel'
    return true
  }

  function goHome(s: MindStudent, t: SimMin, why: string) {
    if (!legTo(s, t, homePos(s), 'home', '__home__')) {
      s.state = 'home'
      s.leg = null
      return
    }
    log(s, t, 'head_home', why, [
      { action: 'head_home', score: 0, why },
      { action: 'stay', score: -1, why: 'no route found' },
    ])
  }

  /* ---------------- the decision (mock-policy-v1) ---------------- */
  function nextClassOf(s: MindStudent, t: SimMin) {
    while (s.nextClass < s.schedule.length && s.schedule[s.nextClass].end < t) s.nextClass++
    return s.nextClass < s.schedule.length ? s.schedule[s.nextClass] : null
  }

  function decide(s: MindStudent, t: SimMin) {
    const nc = nextClassOf(s, t)
    const walkToClass = nc ? walkMinutesHome(s, nc.placeId) : Infinity
    const buffer = 1 + (100 - s.persona.diligence) / 50 // diligent students cut it finer
    const leaveAt = nc ? nc.start - walkToClass - buffer : Infinity
    const slack = leaveAt - t

    const options: Option[] = []
    if (nc && t >= leaveAt - 0.001) {
      options.push({
        action: `go_class:${nc.sectionId}`,
        score: 1000,
        why: `${nc.course} in ${nc.building} ${nc.room} starts ${clock(nc.start)} — ${Math.ceil(walkToClass)} min walk`,
      })
    } else if (nc) {
      options.push({
        action: `wait_for_class:${nc.sectionId}`,
        score: 8,
        why: `${nc.course} at ${clock(nc.start)} — ${Math.ceil(slack)} min slack, staying in`,
      })
    }

    /* dining — only when hungry enough to bother */
    if (s.needs.hunger > 42) {
      for (const v of venues.values()) {
        if (t < v.open || t >= v.close || v.queue.length > 50) continue
        if (s.budget < v.priceCents) continue
        const queueEst = v.queue.length / v.servicePerMin
        const total = v.eatMin + queueEst
        const backToClass = nc ? walkMinutesBetween(v.placeId, nc.placeId) : walkMinutesHome(s, '__home__')
        const afterEat = nc ? nc.start - (t + total + backToClass) : DAY_END - (t + total)
        if (afterEat < 0) continue // eating now would make them late
        const novelty = v.noveltyUntil && t < v.noveltyUntil ? 18 : 0
        const score =
          s.needs.hunger +
          v.nutrition / 4 -
          queueEst / 1.5 -
          v.priceCents / 100 +
          novelty +
          (s.persona.mealPlan && v.mealSwipe ? 8 : 0) -
          backToClass / 3
        options.push({
          action: `eat:${v.id}`,
          score,
          why: `${v.name}: hunger ${Math.round(s.needs.hunger)}, queue ~${Math.ceil(queueEst)} min, ${fmt(v.priceCents)}, ${Math.ceil(afterEat)} min spare before ${nc ? clock(nc.start) : 'end of day'}`,
        })
      }
    }

    /* study / gym for long free gaps */
    if (nc && slack > 75) {
      if (study && s.persona.diligence > 40 && s.needs.energy > 35 && t >= study.open && t < study.close) {
        options.push({
          action: `study:${study.placeId}`,
          score: 26 + s.persona.diligence / 4,
          why: `${Math.round(slack)} min free — ${study.name} before ${nc.course}`,
        })
      }
      if (gym && s.persona.outgoing > 55 && s.needs.energy > 45 && t >= gym.open && t < gym.close) {
        options.push({
          action: `gym:${gym.placeId}`,
          score: 22 + s.persona.outgoing / 4,
          why: `${Math.round(slack)} min gap before ${nc.course} — gym fits`,
        })
      }
    }
    /* events — the social lever */
    for (const ev of activeEvents) {
      if (t < ev.from || t > ev.until - 20 || s.persona.outgoing < 45) continue
      const walk = walkMinutesHome(s, ev.placeId)
      if (nc && ev.from + walk > nc.start - 10) continue
      options.push({
        action: `event:${ev.id}`,
        score: 30 + s.persona.outgoing / 2 + (s.needs.stress > 50 ? 10 : 0) - walk / 2,
        why: `${ev.title} ${clock(ev.from)} — outgoing ${s.persona.outgoing}, ${Math.ceil(walk)} min over`,
      })
    }
    /* rest */
    options.push({
      action: 'rest',
      score: 14 + (s.needs.energy < 35 ? 35 : 0) + (s.needs.stress > 60 ? 10 : 0) - s.needs.hunger / 6,
      why: `energy ${Math.round(s.needs.energy)}, stress ${Math.round(s.needs.stress)} — resting at the dorm`,
    })

    options.sort((a, b) => b.score - a.score)
    const chosen = options[0]

    if (chosen.action.startsWith('go_class:') && nc) {
      if (legTo(s, t, posOf(nc.placeId), 'class', nc.placeId)) {
        log(s, t, chosen.action, chosen.why, options.slice(0, 3))
      } else {
        knows(s, `no walkable route to ${nc.building} right now`)
        log(s, t, 'trapped', 'a closure cut off every route to class', options.slice(0, 3))
        s.needs.stress = Math.min(100, s.needs.stress + 8)
      }
    } else if (chosen.action.startsWith('eat:')) {
      const v = venues.get(chosen.action.slice(4))!
      if (legTo(s, t, v.pos, 'eat', v.id)) log(s, t, chosen.action, chosen.why, options.slice(0, 3))
    } else if (chosen.action.startsWith('study:') && study) {
      if (legTo(s, t, posOf(study.placeId), 'study', study.placeId))
        log(s, t, chosen.action, chosen.why, options.slice(0, 3))
    } else if (chosen.action.startsWith('gym:') && gym) {
      if (legTo(s, t, posOf(gym.placeId), 'gym', gym.placeId))
        log(s, t, chosen.action, chosen.why, options.slice(0, 3))
    } else if (chosen.action.startsWith('event:')) {
      const ev = activeEvents.find((e) => `event:${e.id}` === chosen.action)
      if (ev && legTo(s, t, posOf(ev.placeId), 'event', ev.placeId))
        log(s, t, chosen.action, chosen.why, options.slice(0, 3))
    }
    // 'rest' / 'wait_for_class' → stay put, no log (keeps the feed meaningful)
  }

  /* ---------------- needs ---------------- */
  function tickNeeds(s: MindStudent, _t: SimMin) {
    const n = s.needs
    // ~0.35/min → hungry again roughly every 4½ hours, i.e. 3-4 meals a day
    n.hunger = Math.min(100, n.hunger + 0.35)
    switch (s.state) {
      case 'travel':
        n.energy = Math.max(0, n.energy - 0.12)
        break
      case 'queue':
        n.stress = Math.min(100, n.stress + 0.22)
        n.energy = Math.max(0, n.energy - 0.05)
        break
      case 'class':
      case 'study':
        n.stress = Math.min(100, n.stress + 0.08)
        n.energy = Math.max(0, n.energy - 0.05)
        break
      case 'eat':
        n.energy = Math.min(100, n.energy + 0.15)
        break
      case 'gym':
      case 'event':
        n.stress = Math.max(0, n.stress - 0.3)
        n.energy = Math.max(0, n.energy - 0.1)
        break
      case 'home':
        n.energy = Math.min(100, n.energy + 0.35)
        n.stress = Math.max(0, n.stress - 0.15)
        break
    }
  }

  /** queue-slot geometry: line stretching out from the venue along +z, 0.7 m apart */
  function queuePos(v: LiveVenue, idx: number): [number, number] {
    return [v.pos[0] + (idx % 2) * 0.012 - 0.006, v.pos[1] + 0.05 + Math.floor(idx / 2) * 0.014]
  }

  /* ---------------- arrivals ---------------- */
  function arrive(s: MindStudent, t: SimMin) {
    const leg = s.leg!
    const dest = leg.path[leg.path.length - 1]
    s.prev = [s.pos[0], s.pos[1]]
    s.pos = [dest[0], dest[1]]
    s.leg = null
    switch (leg.goal) {
      case 'home':
        s.state = 'home'
        break
      case 'class': {
        const nc = s.schedule[s.nextClass]
        s.state = 'class'
        if (nc && leg.placeId === nc.placeId) {
          const lateBy = Math.max(0, Math.round(t - nc.start))
          s.attended.push({ sectionId: nc.sectionId, lateBy })
          metrics.classesAttended++
          if (lateBy > 0) {
            metrics.classesLate++
            metrics.latenessSumMin += lateBy
          }
          s.nextClass++
        }
        s.activity = {
          placeId: leg.placeId,
          kind: 'class',
          until: nc && leg.placeId === nc.placeId ? nc.end : t + 60,
          startedAt: t,
        }
        break
      }
      case 'eat': {
        const v = venues.get(leg.placeId)
        if (v && t >= v.open && t < v.close) {
          v.queue.push(s.id)
          s.queuedAt = v.id
          s.state = 'queue'
        } else {
          knows(s, `${v?.name ?? 'the venue'} just closed — going home hungry`)
          goHome(s, t, 'venue closed on arrival')
        }
        break
      }
      case 'study':
        s.state = 'study'
        s.activity = { placeId: leg.placeId, kind: 'study', until: t + 45, startedAt: t }
        break
      case 'gym':
        s.state = 'gym'
        s.activity = { placeId: leg.placeId, kind: 'gym', until: t + 50, startedAt: t }
        break
      case 'event':
        s.state = 'event'
        metrics.eventAttendees++
        s.activity = {
          placeId: leg.placeId,
          kind: 'event',
          until: activeEvents.find((e) => e.placeId === leg.placeId)?.until ?? t + 90,
          startedAt: t,
        }
        break
    }
  }

  /* ---------------- world changes ---------------- */
  const reopens: { id: string; at: SimMin }[] = []

  function executeChange(ch: Change, t: SimMin) {
    if (ch.kind === 'road_closure') {
      for (const id of ch.edges) blocked.add(id)
      bumpEpoch()
      applied.push({ ...ch, closedAt: t, appliedAt: t, revertedAt: null })
      if (ch.until != null) reopens.push({ id: ch.id, at: ch.until })
      /* students only react to what they can observe */
      const midPts = ch.edges
        .map((id) => edgeById.get(id))
        .filter(Boolean)
        .map((e) => [(e!.a[0] + e!.b[0]) / 2, (e!.a[1] + e!.b[1]) / 2] as [number, number])
      for (const s of students) {
        // walking straight into it → forced replan from wherever they stand
        if (s.state === 'travel' && s.leg && s.leg.edges.some((id) => blocked.has(id))) {
          const leg = s.leg
          const target =
            leg.goal === 'home'
              ? homePos(s)
              : leg.goal === 'eat'
                ? (venues.get(leg.placeId)?.pos ?? homePos(s))
                : posOf(leg.placeId)
          const etaLeft = leg.t1 - t
          const r = walkRoute(s.pos, target, blocked)
          if (r) {
            const speed = WALK_SPEED * s.persona.pace
            const detour = r.len / speed - etaLeft
            s.leg = {
              path: r.path,
              edges: r.edges,
              len: r.len,
              t0: t,
              t1: t + r.len / speed,
              goal: leg.goal,
              placeId: leg.placeId,
            }
            s.needs.stress = Math.min(100, s.needs.stress + 6)
            log(
              s,
              t,
              'forced_replan',
              `${ch.street} closed ahead — detour adds ${Math.max(0, Math.ceil(detour))} min`,
              [
                {
                  action: 'detour',
                  score: 0,
                  why: `reroute around ${ch.street}, +${Math.max(0, Math.ceil(detour))} min`,
                },
                { action: 'wait', score: -5, why: 'stand here until it reopens' },
              ],
            )
            knows(s, `${ch.street} is closed — rerouted`)
          } else {
            knows(s, `${ch.street} closure cut off the only way forward — turning back`)
            goHome(s, t, 'no route past the closure')
          }
        } else if (distToPoints(s.pos, midPts) < 4) {
          knows(s, `Saw barriers go up on ${ch.street}`)
        }
      }
    } else if (ch.kind === 'place_add') {
      venues.set(ch.id, {
        id: ch.id,
        name: ch.name,
        kind: 'truck',
        placeId: '',
        pos: ch.pos,
        open: ch.from,
        close: ch.until ?? ch.from + 240,
        mealSwipe: true,
        priceCents: ch.priceCents,
        servicePerMin: ch.servicePerMin,
        eatMin: 15,
        nutrition: ch.nutrition,
        changeId: ch.id,
        noveltyUntil: t + 90,
        queue: [],
        label: 'campus spot',
      })
      applied.push({ ...ch, appliedAt: t, revertedAt: null })
      for (const s of students) {
        if (Math.hypot(s.pos[0] - ch.pos[0], s.pos[1] - ch.pos[1]) < 5 || s.persona.outgoing > 65)
          knows(s, `RUDining alert: ${ch.name} just opened nearby`)
      }
    } else if (ch.kind === 'event') {
      activeEvents.push({ id: ch.id, placeId: ch.placeId, title: ch.title, from: ch.from, until: ch.until })
      applied.push({ ...ch, appliedAt: t, revertedAt: null })
      for (const s of students)
        if (s.persona.outgoing > 45) knows(s, `Flyer: ${ch.title} today ${clock(ch.from)}`)
    }
  }

  function reopen(id: string, t: SimMin) {
    const entry = applied.find((a) => a.id === id)
    if (!entry || entry.kind !== 'road_closure') return
    for (const e of entry.edges) blocked.delete(e)
    bumpEpoch()
    entry.revertedAt = t
  }

  /* ---------------- the tick ---------------- */
  function step(t: SimMin) {
    minute = t

    // 1. world changes land on their 5-minute boundary; reopens unblock
    for (let i = pending.length - 1; i >= 0; i--)
      if (t >= pending[i].at) {
        executeChange(pending[i].change, t)
        pending.splice(i, 1)
      }
    for (let i = reopens.length - 1; i >= 0; i--)
      if (t >= reopens[i].at) {
        reopen(reopens[i].id, t)
        reopens.splice(i, 1)
      }

    // 2. missed classes (checked before decide() skips them silently)
    for (const s of students) {
      const nc = s.schedule[s.nextClass]
      if (nc && t > nc.end + 2 && !s.attended.some((a) => a.sectionId === nc.sectionId)) {
        metrics.classesMissed++
        s.nextClass++
        knows(s, `Missed ${nc.course} — ${clock(nc.start)} in ${nc.building}`)
        s.needs.stress = Math.min(100, s.needs.stress + 10)
      }
    }

    // 3. venues: serve queues, close out
    for (const v of venues.values()) {
      if (t >= v.close && v.queue.length) {
        for (const id of v.queue.splice(0)) {
          const s = students[id]
          s.queuedAt = null
          goHome(s, t, `${v.name} closed while waiting`)
        }
      }
      if (t < v.open || t >= v.close) continue
      let serves = Math.min(v.queue.length, v.servicePerMin)
      while (serves-- > 0) {
        const id = v.queue.shift()!
        const s = students[id]
        if (s.budget < v.priceCents) {
          knows(s, `Skipped ${v.name} — RU Express too low`)
          s.queuedAt = null
          goHome(s, t, 'short on cash')
          continue
        }
        s.budget -= v.priceCents
        s.queuedAt = null
        s.state = 'eat'
        s.prev = [s.pos[0], s.pos[1]]
        s.pos = [v.pos[0], v.pos[1]]
        s.activity = { placeId: v.placeId || v.id, kind: 'eat', until: t + v.eatMin, startedAt: t }
        s.needs.hunger = Math.max(0, s.needs.hunger - v.nutrition)
        metrics.meals[v.id] = (metrics.meals[v.id] ?? 0) + 1
        metrics.revenueCents += v.priceCents
      }
      metrics.queueMinutes[v.id] = (metrics.queueMinutes[v.id] ?? 0) + v.queue.length
    }

    // 4. students
    let stressSum = 0
    for (const s of students) {
      tickNeeds(s, t)
      switch (s.state) {
        case 'home':
          decide(s, t)
          break
        case 'travel': {
          const leg = s.leg
          if (!leg) {
            s.state = 'home'
            break
          }
          const nc = s.schedule[s.nextClass]
          if (leg.goal === 'class' && nc && t > nc.end && leg.placeId === nc.placeId) {
            // class already over — turn back rather than walk into an empty room
            goHome(s, t, `too late for ${nc.course}`)
            break
          }
          if (t >= leg.t1) arrive(s, t)
          else {
            s.prev = [s.pos[0], s.pos[1]]
            const f = (t - leg.t0) / Math.max(0.001, leg.t1 - leg.t0)
            const p = samplePath(leg.path, Math.min(1, f))
            s.pos = [p[0], p[1]]
          }
          if (s.state === 'travel') metrics.walkMinutes++
          break
        }
        case 'queue': {
          const v = s.queuedAt ? venues.get(s.queuedAt) : null
          if (!v) {
            s.state = 'home'
            s.queuedAt = null
            break
          }
          const idx = v.queue.indexOf(s.id)
          s.prev = [s.pos[0], s.pos[1]]
          s.pos = queuePos(v, idx < 0 ? 0 : idx)
          break
        }
        case 'eat':
        case 'class':
        case 'study':
        case 'gym':
        case 'event': {
          const a = s.activity
          if (a && a.placeId && a.placeId !== '__home__') occ(a.placeId, t)
          if (a && t >= a.until) goHome(s, t, `${a.kind} done`)
          break
        }
      }
      stressSum += s.needs.stress
    }
    metrics.stressAvg = stressSum / Math.max(1, students.length)
  }

  /* ---------------- public api ---------------- */
  function stateHash(): string {
    // cheap physical hash: every student's rounded position + state
    let h = 2166136261
    for (const s of students) {
      h = (h ^ (s.id * 31 + Math.round(s.pos[0] * 100) + Math.round(s.pos[1] * 100) * 7)) >>> 0
      h = (h * 16777619) >>> 0
      h = (h ^ s.state.length) >>> 0
    }
    return `${h.toString(16)}:${metrics.walkMinutes}:${metrics.revenueCents}`
  }

  return {
    students,
    get venues() {
      return [...venues.values()]
    },
    applied,
    activeEvents,
    study,
    gym,
    clock,
    fmt,
    START,
    DAY_END,
    get minute() {
      return minute
    },
    get blocked() {
      return blocked
    },
    /** closed-edge geometry for the renderer */
    closedSegments(): [number, number, number, number][] {
      const out: [number, number, number, number][] = []
      for (const id of blocked) {
        const e = edgeById.get(id)
        if (e) out.push([e.a[0], e.a[1], e.b[0], e.b[1]])
      }
      return out
    },
    /** dynamically added trucks for the renderer */
    activeTrucks() {
      return [...venues.values()].filter((v) => v.changeId && minute >= v.open && v.close > minute)
    },
    parse(text: string): ScenarioDraft {
      return parseScenario(text, minute)
    },
    /** queue the draft's changes for their boundary; returns the boundary */
    apply(draft: ScenarioDraft): { ok: boolean; at: SimMin } {
      if (!draft.ok) return { ok: false, at: -1 }
      let at = Infinity
      for (const ch of draft.changes) {
        const when = Math.max(ch.from, Math.ceil((minute + 0.01) / 5) * 5)
        at = Math.min(at, when)
        pending.push({ change: ch, at: when })
      }
      return { ok: true, at }
    },
    runTo(target: number) {
      while (minute < target && minute < DAY_END) step(minute + 1)
    },
    metrics(): MindMetrics & { moneyCheck: boolean; spentCents: number } {
      let spent = 0
      for (const s of students) spent += s.persona.budget - s.budget
      return { ...metrics, spentCents: spent, moneyCheck: spent === metrics.revenueCents }
    },
    stateHash,
  }
}
