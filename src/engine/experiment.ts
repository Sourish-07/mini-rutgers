/**
 * Paired A/B experiments: the same { population, seed } runs twice — once as a
 * baseline, once with a scenario — and the report is nothing more than B minus A
 * over the engine's own metrics. No seed is ever picked, dropped or rerun based
 * on the sign of a delta; incomplete honesty beats a good story.
 */
import { createSim, STOPS, type Metrics } from './sim.ts'
import { scenarioEnd, scenarioFocusStop, type Scenario } from './scenario.ts'

export type ArmResult = {
  metrics: Metrics
  history: Record<string, number[]>
  hash: string
}

export type StopDelta = {
  stop: string
  label: string
  basePeak: number
  treatPeak: number
  baseLeft: number
  treatLeft: number
}

export type ExperimentResult = {
  scenario: Scenario
  population: number
  seed: number
  toMin: number
  baseline: ArmResult
  treatment: ArmResult
  deltas: {
    avgWaitMin: number
    p95WaitMin: number
    leftBehind: number
    focusPeakQueue: number
  }
  focusStop: string | null
  /** stops sorted by how much the scenario grew their peak queue */
  perStop: StopDelta[]
}

export function runExperiment(opts: {
  population?: number
  seed?: number
  scenario: Scenario
  toMin?: number
}): ExperimentResult {
  const population = opts.population ?? 3000
  const seed = opts.seed ?? 7
  const end = scenarioEnd(opts.scenario) ?? 1320
  const toMin = Math.min(1439, opts.toMin ?? end + 90)

  const base = createSim({ population, seed })
  base.runTo(toMin)

  const treat = createSim({ population, seed })
  treat.applyScenario(opts.scenario)
  treat.runTo(toMin)

  const baseM = base.metrics()
  const treatM = treat.metrics()
  const focus = scenarioFocusStop(opts.scenario)

  const perStop: StopDelta[] = Object.keys(STOPS)
    .map((k) => ({
      stop: k,
      label: STOPS[k].label,
      basePeak: baseM.maxQueueByStop[k] ?? 0,
      treatPeak: treatM.maxQueueByStop[k] ?? 0,
      baseLeft: baseM.leftBehindByStop[k] ?? 0,
      treatLeft: treatM.leftBehindByStop[k] ?? 0,
    }))
    .sort((a, b) => b.treatPeak - b.basePeak - (a.treatPeak - a.basePeak))
    .slice(0, 6)

  return {
    scenario: opts.scenario,
    population,
    seed,
    toMin,
    baseline: { metrics: baseM, history: base.history, hash: base.snapshotHash() },
    treatment: { metrics: treatM, history: treat.history, hash: treat.snapshotHash() },
    deltas: {
      avgWaitMin: (treatM.avgWaitMin ?? 0) - (baseM.avgWaitMin ?? 0),
      p95WaitMin: (treatM.p95WaitMin ?? 0) - (baseM.p95WaitMin ?? 0),
      leftBehind: treatM.totalLeftBehind - baseM.totalLeftBehind,
      focusPeakQueue: focus ? (treatM.maxQueueByStop[focus] ?? 0) - (baseM.maxQueueByStop[focus] ?? 0) : 0,
    },
    focusStop: focus,
    perStop,
  }
}
