/**
 * Scenario events are the operator's what-if vocabulary. Each one activates at an
 * exact tick boundary; a scenario is a small, reviewable bundle of them.
 *
 * Times are absolute simulated minutes since midnight (07:00 service start is 420),
 * matching the rest of the engine. JSON presets live in src/data/scenarios/.
 */

export type ScenarioEvent =
  | {
      kind: 'event_surge'
      id: string
      /** stop the event is anchored to — attendees converge on it and egress from it */
      stop: string
      /** people who RSVP'd / are expected */
      attendees: number
      /** doors time */
      startMin: number
      /** event ends, egress wave begins */
      endMin: number
      /** fraction of attendees that actually shows up (default 0.72) */
      showRate?: number
      /** std-dev window for arrivals around doors (default 45 min) */
      arrivalSpreadMin?: number
      /** spread of the post-event departure wave (default 30 min) */
      egressSpreadMin?: number
    }
  | {
      kind: 'stop_closure'
      id: string
      stop: string
      fromMin: number
      toMin: number
    }
  | {
      kind: 'fleet_add'
      id: string
      route: string
      buses: number
      atMin: number
    }

export type Scenario = {
  id: string
  label: string
  description?: string
  events: ScenarioEvent[]
}

/** the tick at which a scenario event activates */
export function eventMinute(e: ScenarioEvent): number {
  return e.kind === 'stop_closure' ? e.fromMin : e.kind === 'fleet_add' ? e.atMin : e.startMin
}

function endMinute(e: ScenarioEvent): number {
  return e.kind === 'event_surge' ? e.endMin : e.kind === 'stop_closure' ? e.toMin : e.atMin
}

export function scenarioStart(s: Scenario): number | null {
  return s.events.length ? Math.min(...s.events.map(eventMinute)) : null
}

export function scenarioEnd(s: Scenario): number | null {
  return s.events.length ? Math.max(...s.events.map(endMinute)) : null
}

/** the stop a scenario is most "about", for focusing charts and markers */
export function scenarioFocusStop(s: Scenario): string | null {
  const surge = s.events.find(
    (e): e is Extract<ScenarioEvent, { kind: 'event_surge' }> => e.kind === 'event_surge',
  )
  if (surge) return surge.stop
  const closure = s.events.find(
    (e): e is Extract<ScenarioEvent, { kind: 'stop_closure' }> => e.kind === 'stop_closure',
  )
  return closure ? closure.stop : null
}
