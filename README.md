# Campus Motion — the Rutgers 5G Transit Twin

An isometric, Sims-style **digital twin of the Rutgers–New Brunswick campus bus
system**. Operators watch six thousand agents move over real OSM roads and real
building footprints, then ask **what-if questions in plain English** — _"1000
person event at BSC tonight 7pm"_ — preview the draft, apply it, and watch the
surge hit the bus network. A paired A/B comparison replays the whole day with
and without the scenario and reports exactly what changed, honestly labelled as
descriptive deltas rather than statistics.

Built as a Verizon-flavoured story: twelve high-traffic buildings carry simulated
ESP32 sensor nodes (mmWave zone counters + ToF door counters) reporting over a
5G/MEC edge path, and the real Rutgers bus tracker can be overlaid live.

- **Scene** — React 19 + three.js/R3F, real satellite ground, real building
  footprints from the Rutgers ArcGIS FeatureServer, agents as canvas-painted
  billboards (the trick that keeps a crowd readable at campus zoom)
- **Engine** — deterministic, seeded TypeScript; the same code runs the
  dashboard, the check scripts and the test suite, and `snapshotHash()` makes
  determinism a testable property
- **Scenarios** — `event_surge`, `stop_closure`, `fleet_add`, scheduled at
  exact tick boundaries and reviewed as drafts before anything is applied
- **Experiments** — paired same-seed baseline/treatment days, B−A deltas, no
  story attached

## Quick start

```sh
npm ci --legacy-peer-deps   # react-is is an optional recharts peer; see note below
npm run dev                 # http://localhost:5173
```

The day opens at 09:00 with the morning rush already under way. Drive it:

1. In the **Scenario console** (bottom dock), pick a preset or type
   `1000 person event at BSC tonight 7pm` and press **Parse**
2. Review the draft — times, attendee counts, assumptions — then **Apply**
3. Press **Jump to 15 min before it starts** and watch the amber crowd converge
   on Busch Student Center while the queues, bus load indicators and
   left-behind counters climb
4. Press **Run paired day** in the A/B panel — the twin replays the whole day
   twice (same seed, with/without the event) and diffs the outcome
5. When the alert fires, **Reserve fleet** drops three extra buses onto the
   busiest served corridor, live
6. Toggle **Live** in the header to overlay real Rutgers bus positions from the
   public tracker (see _Live overlay_ below)

## Commands

| Command                                                          | What it does                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                                                    | Vite dev server with HMR                                                |
| `npm run build`                                                  | `tsc -b` typecheck + production bundle to `dist/`                       |
| `npm run preview`                                                | serve the production build                                              |
| `npm run lint`                                                   | oxlint (zero errors expected; a handful of pre-existing style warnings) |
| `npm test`                                                       | vitest suite — determinism, invariants, scenarios, parser, presets      |
| `npm run check:all`                                              | iso + layout + sim + bus checks + the test suite in one go              |
| `npm run check:sim` / `check:bus` / `check:iso` / `check:layout` | engine/scene invariants as plain Node scripts                           |
| `node scripts/check-live.mjs`                                    | accuracy vs the **live** Rutgers tracker (network)                      |
| `node scripts/check-overlap.mjs`                                 | route polylines vs real building footprints (network)                   |
| `npm run format` / `format:check`                                | prettier (generated data JSONs are ignored)                             |

Two environment notes, learned the hard way:

- **`--legacy-peer-deps`** — recharts declares `react-is` as an optional peer;
  some npm arborist versions crash resolving that peer set. The lockfile is
  exact, so installs are reproducible either way.
- **`npm test`** runs vitest with `--no-experimental-strip-types`: Node ≥ 22.18
  strips `.ts` natively by default, which hijacks vitest's module loading. The
  check scripts, by contrast, **rely** on native stripping to import the engine
  from plain `.mjs`. Node 22.18+ runs both exactly as wired.

## Architecture

```
src/
  engine/
    sim.ts         the deterministic day: agents, buses, queues, waits,
                   left-behind ledger, scenario activation at tick boundaries,
                   snapshotHash() for reproducibility
    scenario.ts    ScenarioEvent vocabulary + time helpers
    experiment.ts  paired same-seed A/B runner (B minus A, nothing hidden)
    rng.ts         seeded LCG + gaussian (the only randomness anywhere)
  sim.ts           public facade — the scene, panels and check scripts all
                   import this one file, so the engine can evolve freely
  scenario-parse.ts plain-English drafts: "close the BSC stop 4pm to 6pm" → events,
                   with assumptions and unsupported items surfaced, never guessed
  sensors.ts       the firmware-sim: twelve building nodes, counting-only
                   telemetry that matches firmware/esp32/PROTOCOL.md exactly
  live.ts          Rutgers tracker client (demo.rubus.live) + scene projection
  scenario-panel.tsx / compare-panel.tsx   the operator's draft→apply and A/B UI
  scene.tsx / atlas.ts / ground.ts / iso.ts / ui.tsx / App.tsx   the twin itself
src/data/          stops, routes, paths, places, network (generated by scripts/)
  scenarios/       five JSON presets (BSC-1000, game day, exam week, closure, reserve)
scripts/           OSM/ArcGIS builders + invariant checks (the battery above)
tests/             vitest evidence for everything the engine claims
firmware/esp32/    real sketches for the ToF and mmWave nodes + ingest protocol
docs/              architecture, sensor ingest contract, baseline, roadmap
```

**Units**: 1 scene unit = 50 m, 1 tick = 1 simulated minute, buses at 18 km/h,
walkers at 4.86 km/h, per-vehicle legal load drawn once from the 70–84 band.
Everything is honest by construction: badges label every number as modelled.

## Scenarios

| Kind           | What it does                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_surge`  | `attendees × showRate` people spawn across real buildings, converge on the venue stop for doors, and leave in an egress wave that takes the bus home |
| `stop_closure` | buses skip the stop entirely; riders reroute to the nearest open stop — including walkers already en route and riders mid-bus                        |
| `fleet_add`    | extra vehicles drop onto a route loop, evenly spaced                                                                                                 |

Presets live in `src/data/scenarios/`. The free-text parser resolves venue
aliases ("bsc", "the yard", "werblin"…), attendance counts, clock times and
durations, and lists every assumption it made instead of hiding them.

## Live overlay

The header's **Live** toggle polls `https://demo.rubus.live/buses` (the same
feed `scripts/check-live.mjs` validates our route geometry against) every five
seconds and paints vehicles in route colours. If the browser refuses it
cross-origin the toggle shows the failure and invents nothing — the same
never-fallback-silently rule the rest of the twin follows.

## Sensors & the Verizon 5G story

Twelve buildings (both student centers, ARC, Hill, Werblin, Life Sciences, SHI
Stadium, the Livingston quads/apartments, Lipman, SAC) carry simulated nodes:
eight 60 GHz **mmWave zone counters** for crowd presence and four **ToF
(VL53L8CX) door counters** for precise in/out counts, all on ESP32-S3. The
dashboard's _Sensor fleet_ panel is fed by `src/sensors.ts`, whose payloads are
byte-shaped like the real firmware's — swapping the live ingest for the
firmware-sim is a one-function change. The deployment architecture, bill of
materials, payload contract and privacy stance live in
[docs/SENSOR_INGEST.md](docs/SENSOR_INGEST.md) and
[firmware/esp32/](firmware/esp32/). Nodes report **counts and confidence only —
never images, positions or identities.**

## Data sources

- Roads/footways: OpenStreetMap (Overpass extracts, `scripts/build-network.mjs`)
- Buildings: Rutgers ArcGIS FeatureServer (real footprints, categories, names)
- Bus routes/stops: DOTS route sheet encoded in `src/data/routes.json` +
  `stops.json`; polylines re-derived on real roads via A*
- Satellite ground: rendered into the same canvas as the route ribbons so
  imagery and vectors stay registered
- Live vehicles: `demo.rubus.live` public tracker

## Known limitations (the honest list)

- Headways are a static weekday table, not a GTFS timetable; there is no
  peak/off-peak schedule, no last bus, no transfers — a rider boards only a bus
  that directly serves their destination stop
- One weekday is simulated; weekends, weather, exam calendars and break days
  are scenario presets at best
- Sensor telemetry is simulated (`src/sensors.ts`); the live tracker may refuse
  browser CORS and the overlay then reports the failure instead of guessing
- The A/B panel is one paired day — descriptive deltas, not statistical proof
- Agent dwell times are constant; walking A* uses a memoized footway graph and
  is fine at 6–20k agents but is not a traffic model

See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next (timetable ingestion,
forecasting, narrative reports, the ingest server, hardware pilots).

## Verification

CI (`.github/workflows/ci.yml`) runs prettier, oxlint, the four invariant
checks, the vitest suite and the production build on every push. Locally,
`npm run check:all` is the same battery; `check-live` and `check-overlap` add
network-dependent accuracy checks against the real tracker and real footprints.

## Repository

`upstream` points at the original public sandbox; `origin` is the private
working mirror of this twin. `baseline-import` tags the exact upstream commit
this repo was forked from, so every change since is reviewable as a diff.
