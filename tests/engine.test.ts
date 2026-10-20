/**
 * Engine evidence. Everything here runs the same code the browser runs — the
 * check scripts and this suite share the one deterministic engine, so a green
 * badge here means the same day, not a special test-only day.
 */
import { describe, expect, test } from 'vitest'
import { AGENT_CAP, createSim, runExperiment, ROUTES, START, STOPS, type Scenario } from '../src/sim.ts'

const bscEvent: Scenario = {
  id: 'test-bsc-event',
  label: 'test surge',
  events: [
    {
      kind: 'event_surge',
      id: 'surge',
      stop: 'bsc',
      attendees: 600,
      startMin: 540,
      endMin: 660,
      showRate: 1,
      arrivalSpreadMin: 10,
      egressSpreadMin: 10,
    },
  ],
}

describe('determinism', () => {
  test('same seed reproduces the same day, verified by snapshot hash', () => {
    const a = createSim({ population: 400, seed: 7 })
    const b = createSim({ population: 400, seed: 7 })
    a.runTo(600)
    b.runTo(600)
    expect(a.snapshotHash()).toBe(b.snapshotHash())
    const c = createSim({ population: 400, seed: 8 })
    c.runTo(600)
    expect(c.snapshotHash()).not.toBe(a.snapshotHash())
  })

  test('a scheduled scenario does not disturb the day before its first event', () => {
    const base = createSim({ population: 300, seed: 11 })
    const treat = createSim({ population: 300, seed: 11 })
    treat.applyScenario(bscEvent)
    base.runTo(540)
    treat.runTo(540)
    expect(base.snapshotHash()).toBe(treat.snapshotHash())
  })
})

describe('invariants', () => {
  test('the day stays physically coherent', () => {
    const sim = createSim({ population: 400, seed: 3 })
    sim.runTo(720)
    for (const a of sim.agents) {
      expect(Number.isFinite(a.x)).toBe(true)
      expect(Number.isFinite(a.z)).toBe(true)
      expect(Math.abs(a.x)).toBeLessThanOrEqual(70)
      expect(Math.abs(a.z)).toBeLessThanOrEqual(110)
    }
    for (const b of sim.buses) {
      expect(b.riders.length).toBeLessThanOrEqual(b.capacity)
      for (const id of b.riders) expect(sim.agents[id].state).toBe('ride')
    }
    for (const [k, ids] of Object.entries(sim.queue)) {
      for (const id of ids) {
        expect(sim.agents[id].state).toBe('wait')
        expect(sim.agents[id].stop).toBe(k)
      }
    }
  })

  test('agent cap leaves headroom for the largest surge', () => {
    expect(AGENT_CAP).toBeGreaterThanOrEqual(6000 + 5000)
  })
})

describe('event surge', () => {
  test('spawns exactly showRate × attendees event-goers bound for the venue', () => {
    const sim = createSim({ population: 300, seed: 5 })
    sim.applyScenario(bscEvent)
    sim.runTo(600)
    const eventAgents = sim.agents.filter((a) => a.role === 'event')
    expect(eventAgents.length).toBe(600)
    for (const a of eventAgents) {
      expect(a.destStop).toBe('bsc')
      expect(a.egressAt).not.toBeNull()
      expect(a.eventTag).toBe('surge')
    }
    const window = sim.history['bsc'].slice(540 - START, 600 - START)
    expect(Math.max(...window)).toBeGreaterThan(0)
  })

  test('a crushed venue leaves people behind and inflates the metrics', () => {
    const crush: Scenario = {
      id: 'crush',
      label: 'crush',
      events: [
        {
          kind: 'event_surge',
          id: 'surge',
          stop: 'bsc',
          attendees: 1500,
          startMin: 540,
          endMin: 660,
          showRate: 1,
          arrivalSpreadMin: 8,
          egressSpreadMin: 10,
        },
      ],
    }
    const sim = createSim({ population: 200, seed: 9 })
    sim.applyScenario(crush)
    sim.runTo(700)
    const m = sim.metrics()
    expect(m.totalLeftBehind).toBeGreaterThan(0)
    expect(m.maxQueueByStop['bsc']).toBeGreaterThan(50)
    expect(m.waitSamples).toBeGreaterThan(0)
  })

  test('event-goers ride home after the egress wave and settle', () => {
    const sim = createSim({ population: 200, seed: 13 })
    sim.applyScenario(bscEvent)
    sim.runTo(800)
    const settled = sim.agents.filter((a) => a.settled)
    expect(settled.length).toBeGreaterThan(250)
  })
})

describe('stop closure', () => {
  test('buses skip the closed stop and nobody plans to use it during the window', () => {
    const closure: Scenario = {
      id: 'closure',
      label: 'closure',
      events: [{ kind: 'stop_closure', id: 'close-bsc', stop: 'bsc', fromMin: 500, toMin: 600 }],
    }
    const sim = createSim({ population: 300, seed: 21 })
    sim.applyScenario(closure)
    sim.runTo(560)
    expect(sim.queue['bsc'].length).toBe(0)
    const window = sim.boardings['bsc'].slice(500 - START, 560 - START)
    expect(window.reduce((s, v) => s + (v ?? 0), 0)).toBe(0)
    const heading = sim.agents.filter(
      (a) => a.destStop === 'bsc' && (a.state === 'wait' || a.state === 'ride' || a.state === 'walk-stop'),
    )
    expect(heading.length).toBe(0)
  })
})

describe('fleet_add', () => {
  test('extra vehicles appear on the route at the scheduled minute', () => {
    const sim = createSim({ population: 300, seed: 2 })
    const before = sim.buses.filter((b) => b.route.ref === 'B').length
    sim.applyScenario({
      id: 'f',
      label: 'f',
      events: [{ kind: 'fleet_add', id: 'b', route: 'B', buses: 3, atMin: 500 }],
    })
    sim.runTo(505)
    expect(sim.buses.filter((b) => b.route.ref === 'B').length).toBe(before + 3)
  })
})

describe('paired experiment', () => {
  test('measures the surge against the same-seed baseline', () => {
    const res = runExperiment({ population: 300, scenario: bscEvent })
    expect(res.focusStop).toBe('bsc')
    expect(res.treatment.metrics.maxQueueByStop['bsc']).toBeGreaterThan(
      res.baseline.metrics.maxQueueByStop['bsc'],
    )
    expect(res.treatment.metrics.totalLeftBehind).toBeGreaterThanOrEqual(res.baseline.metrics.totalLeftBehind)
    expect(res.perStop.length).toBeGreaterThan(0)
    expect(res.treatment.hash).not.toBe(res.baseline.hash)
  })
})

describe('static data', () => {
  test('every route references known stops', () => {
    for (const r of ROUTES) for (const s of r.stops) expect(STOPS[s]).toBeTruthy()
  })
})
