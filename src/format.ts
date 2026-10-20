/**
 * Small shared formatting helpers for the operator panels. Lives outside the
 * component files so fast-refresh keeps working and panels stay dumb.
 */
import { STOPS } from './engine/sim.ts'
import type { ScenarioEvent } from './engine/scenario.ts'

/** simulated minutes-of-day → HH:MM */
export const fmtMin = (min: number) => {
  const t = Math.floor(min) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/** one readable line per scenario event, for the draft card */
export function describeEvent(e: ScenarioEvent): string {
  if (e.kind === 'event_surge')
    return `~${Math.round(e.attendees * (e.showRate ?? 0.72))} attendees → ${STOPS[e.stop].label} · ${fmtMin(e.startMin)}–${fmtMin(e.endMin)}`
  if (e.kind === 'stop_closure')
    return `${STOPS[e.stop].label} closed ${fmtMin(e.fromMin)}–${fmtMin(e.toMin)} · buses skip it, riders reroute`
  return `+${e.buses} buses on Route ${e.route} at ${fmtMin(e.atMin)}`
}
