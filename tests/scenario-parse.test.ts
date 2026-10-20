/**
 * Scenario parser and preset evidence: plain words become reviewable events, and
 * every shipped preset references real stops/routes at real times.
 */
import { describe, expect, test } from 'vitest'
import { parseScenarioText } from '../src/scenario-parse.ts'
import { eventMinute, ROUTES, STOPS, type Scenario } from '../src/sim.ts'
import bscEvent from '../src/data/scenarios/bsc-event-1000.json' with { type: 'json' }
import gameDay from '../src/data/scenarios/game-day.json' with { type: 'json' }
import examWeek from '../src/data/scenarios/exam-week.json' with { type: 'json' }
import bscStopClosure from '../src/data/scenarios/bsc-stop-closure.json' with { type: 'json' }
import reserveFleet from '../src/data/scenarios/reserve-fleet.json' with { type: 'json' }

describe('parser', () => {
  test('parses the headline request: a 1000-person event at BSC tonight 7pm', () => {
    const d = parseScenarioText('1000 person event at BSC tonight 7pm', 500)
    expect(d.scenario).not.toBeNull()
    expect(d.scenario?.events.length).toBe(1)
    const e = d.scenario?.events[0]
    expect(e?.kind).toBe('event_surge')
    if (e?.kind === 'event_surge') {
      expect(e.attendees).toBe(1000)
      expect(e.stop).toBe('bsc')
      expect(e.startMin).toBe(1140)
      expect(e.endMin).toBe(1320)
    }
    expect(d.assumptions.length).toBeGreaterThan(0)
  })

  test('parses closures with a time window', () => {
    const d = parseScenarioText('close the BSC stop from 4pm to 6pm', 500)
    const e = d.scenario?.events[0]
    expect(e?.kind).toBe('stop_closure')
    if (e?.kind === 'stop_closure') {
      expect(e.stop).toBe('bsc')
      expect(e.fromMin).toBe(960)
      expect(e.toMin).toBe(1080)
    }
  })

  test('parses reserve-fleet requests', () => {
    const d = parseScenarioText('add 5 buses to route B', 500)
    const e = d.scenario?.events[0]
    expect(e?.kind).toBe('fleet_add')
    if (e?.kind === 'fleet_add') {
      expect(e.route).toBe('B')
      expect(e.buses).toBe(5)
    }
  })

  test('surfaces what it cannot do instead of guessing', () => {
    const d = parseScenarioText('make it rain tomorrow so nobody walks', 500)
    expect(d.scenario).toBeNull()
    expect(d.unsupported.length).toBeGreaterThan(0)
  })
})

describe('presets', () => {
  const presets = [bscEvent, gameDay, examWeek, bscStopClosure, reserveFleet] as unknown as Scenario[]

  test('every preset references real stops and routes with sane times', () => {
    expect(presets.length).toBe(5)
    for (const p of presets) {
      expect(p.id).toBeTruthy()
      expect(p.label).toBeTruthy()
      expect(p.events.length).toBeGreaterThan(0)
      for (const e of p.events) {
        if (e.kind === 'fleet_add') {
          expect(ROUTES.some((r) => r.ref === e.route)).toBe(true)
          expect(e.buses).toBeGreaterThan(0)
        } else {
          expect(STOPS[e.stop]).toBeTruthy()
        }
        const at = eventMinute(e)
        expect(at).toBeGreaterThanOrEqual(0)
        expect(at).toBeLessThanOrEqual(1439)
      }
    }
  })
})
