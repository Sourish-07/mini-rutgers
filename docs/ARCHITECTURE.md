# Architecture

The twin is one deterministic engine plus a three.js operator surface. The
reference discipline comes from an earlier simulation project (a three-lane
theme-park operator product): frozen contracts, draft-before-apply scenarios,
paired seeded experiments, honest badges, checks-as-tests. The domain, stack and
every byte here are our own.

## The one rule that shapes everything

**One deterministic engine, three consumers.** `src/engine/sim.ts` is pure
TypeScript with no DOM or network access. It runs identically inside:

1. the browser dashboard (via `src/sim.ts`, the public facade),
2. the plain-Node invariant scripts in `scripts/check-*.mjs` (native TS type
   stripping), and
3. the vitest suite in `tests/`.

Every random draw flows through a seeded LCG (`src/engine/rng.ts`), so the same
`{ population, seed }` reproduces the same day, verified by `snapshotHash()` —
an FNV-1a over agent states/positions and bus arc-lengths. That hash is what
makes the A/B comparisons meaningful: both arms are provably identical until the
scenario's first event fires.

## Units and time

1 scene unit = 50 m. 1 tick = 1 simulated minute. Buses 6 u/min (18 km/h),
walkers 1.62 u/min (4.86 km/h). Service starts 07:00 (`START`). Per-vehicle
legal load is drawn once at spawn from the 70–84 band (Rutgers buses seat ~44,
stand to ~77).

## Scenario lifecycle

```
plain words ──parse──▶ ScenarioDraft ──operator confirms──▶ applyScenario()
                                                      │
                                        pending events, revision++
                                                      │
                                     fires at the exact tick boundary
                                                      │
   event_surge        stop_closure                  fleet_add
   spawn attendees    reroute waiters/walkers/      extra buses join
   across campus,     riders; buses pass through    the route loop,
   converge, egress   the closed stop               evenly spaced
   wave rides home
```

`applyScenario` validates every stop and route before accepting, rejects stops
no modeled route serves, and bumps a revision counter. Experiment arms are
frozen after creation — you apply a new scenario, you don't silently edit one.

## Metrics

The engine keeps a per-stop ledger as it steps: queue length per minute
(`history`), boardings per minute, **left-behind** (a person a _full_ bus would
have carried), per-agent wait samples feeding avg/p95/max, and peak queues.
`metrics()` is the operator projection of that ledger; nothing is derived from
the UI.

## Paired experiments

`runExperiment({ population, seed, scenario })` runs two fresh sims to the
scenario horizon — baseline and treatment — and reports B−A over the engine's
own metrics plus per-stop peak/left-behind deltas and both arms' hashes. Seeds
are never picked or rerun based on the sign of a delta. One pair is descriptive;
the panel says so.

## Sensor lane (the Verizon 5G story)

`src/sensors.ts` models twelve ESP32-S3 nodes (8× 60 GHz mmWave zone counters,
4× ToF door counters) anchored to real buildings resolved from `places.json`.
`readFleet()` counts every agent inside a 75 m zone (people on a moving bus are
the bus's business) with deterministic per-(node, minute) jitter, and emits the
same payload shape the real firmware publishes — see
[SENSOR_INGEST.md](SENSOR_INGEST.md) and [firmware/esp32/](../firmware/esp32/).
Privacy is architectural: counts and confidence, never images, tracks or
identities.

## Live overlay

`src/live.ts` polls the public Rutgers tracker every 5 s while toggled on,
projects WGS84 into scene units, and colours vehicles by route. Failures
surface as a visible badge — the twin never fabricates data.

## What is deliberately NOT here yet

See [ROADMAP.md](ROADMAP.md): a server authority (everything currently runs in
the operator's tab), GTFS timetable ingestion, transfers, weather, forecasting,
LLM narrative, e2e/a11y suites, and real hardware pilots.
