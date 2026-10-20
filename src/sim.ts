/**
 * Public surface of the simulation. The engine lives in ./engine/sim.ts; this
 * file re-exports exactly what the scene, the panels and the check scripts rely
 * on, so the engine can evolve without touching every import site. The check
 * scripts (scripts/check-*.mjs) import this file directly under Node — keep the
 * paths inside ./engine explicit (.ts) so type stripping works.
 */
export {
  createSim,
  STOPS,
  ROUTES,
  CAPACITY,
  CAPACITY_MIN,
  CAPACITY_MAX,
  AGENT_CAP,
  BUS_SPEED,
  WALK_SPEED,
  DWELL,
  START,
} from './engine/sim.ts'
export type { Agent, AgentState, Bus, Metrics, Route, Sim, Stop, StopKey } from './engine/sim.ts'
export type { Scenario, ScenarioEvent } from './engine/scenario.ts'
export { eventMinute, scenarioStart, scenarioEnd, scenarioFocusStop } from './engine/scenario.ts'
export { runExperiment } from './engine/experiment.ts'
export type { ArmResult, ExperimentResult, StopDelta } from './engine/experiment.ts'
