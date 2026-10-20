# Campus Motion

A manipulable microcosm of the Rutgers–New Brunswick campus: thousands of
individually simulated students, real bus routes on real roads, real building
footprints — and levers to pull (blocked roads, a new coffee cart, an event in
a building) to see how the campus reacts before trying it in reality.

Rendered as an isometric 3D scene (React + three.js) over real satellite
imagery, with live IoT-style stop telemetry panels and queue prediction charts.

## Quick start

```sh
npm install
npm run dev        # http://localhost:5173
```

The app boots at 09:00 with 6,000 students already moving and opens the camera on whichever stop is currently busiest. Play/pause and 1×–240× speed controls are in the top-right.

## The living quarter (the behavior demo)

Alongside the 6,000 statistical background students, **420 "minded" students
live on the College Avenue campus**: real names, real dorms, real Rutgers
class schedules (baked from the public Schedule of Classes API), hunger,
energy, stress, RU Express balances, and a written reason for every move.

- **What if… box** (bottom-left) — type a lever and watch the campus react:
  - `close Bishop Place at 10am until noon` — the cohort's walking spine
    closes at 10:00; walkers mid-leg are force-detoured ("detour adds 3
    min"), everyone else reroutes, and it reopens at noon by itself
  - `put a food truck on Vorhees Mall at noon` — a truck spawns; nearby
    and outgoing students get an app alert and divert when hunger allows
  - `host an event in Scott Hall at 6pm` — outgoing students with a free
    evening show up
- **Inspector** (top-right) — click any red figure (or "Follow a walker"):
  persona, needs, their real Tuesday schedule, and the decision log —
  *"Brower Commons: hunger 48, queue ~0 min, $9.85, 170 min spare before
  10:20"* — including the runner-up option they rejected
- **Results** (under the Inspector) — live day vs the deterministic
  baseline *at the same time of day*: meals, revenue, lateness, missed
  classes, event turnout, collective walking minutes, avg stress — with a
  live money-conservation check

## Layout

```
src/
  app/        composition root (App.tsx) — owns the sim instance and the canvas
  engine/     PURE simulation logic, no React/three imports
    sim.ts        students, buses, queues, the tick loop (1 tick = 1 minute)
    navigation.ts walkable-campus graph + A* routing (loads data/network.json)
    mind/         the behavior engine: cohort schedules, needs, decisions,
                  scenarios, dining queues, metrics (see docs/ARCHITECTURE.md)
  render/     three.js presentation
    scene.tsx     the <Canvas> scene: buildings, buses, people, stops, camera
    ground.ts     painted ground texture (grass, footways, roads, route ribbons)
    atlas.ts      painted figure sprites (instanced billboards)
    iso.ts        shared 2:1 dimetric projection math (used by checks)
    mindScene.tsx red cohort figures, closure barriers, trucks, selection ring
  ui/         React overlay panels (Panels.tsx: sensors, stats, prediction;
              MindPanels.tsx: What if…, Inspector, Results)
  data/       generated datasets — see docs/DATA_PIPELINE.md
scripts/
  build/      regenerates the datasets (OSM graph, bus paths, places, satellite)
  check/      invariant and accuracy checks (sim, buses, iso math, live feed)
docs/         ARCHITECTURE.md, DATA_PIPELINE.md, MIGRATION_PLAN.md
```

Dependencies flow one way only: `app → {render, ui} → engine → data`.
The engine never imports React or three; it can run headless in Node (the
`scripts/check/` scripts do exactly that).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev / typecheck+build / serve build |
| `npm run lint` | oxlint |
| `npm run check:sim` | engine invariants: state consistency, queues, capacity |
| `npm run check:mind` | mind-engine invariants: determinism, money, parser, closure effect |
| `npm run build:data` | regenerate every behavior dataset (buildings, schedule, streets, baseline) |
| `npm run check:layout` | real-world distances, bearings and scale sanity |
| `node scripts/check/check-bus.mjs` | buses stay on route, right speed, no teleports |
| `node scripts/check/check-iso.mjs` | dimetric projection round-trips |
| `node scripts/check/check-live.mjs` | live Rutgers bus feed vs our route geometry |
| `node scripts/check/check-overlap.mjs` | route points inside building footprints |
| `node scripts/check/debug-route.mjs` | A* debugging for two stops |
| `node scripts/build/build-network.mjs /tmp/osm_*.osm` | rebuild the routable graph |
| `node scripts/build/build-paths.mjs` | rebuild route polylines on drivable roads |
| `node scripts/build/build-places.mjs` | rebuild building centroids from ArcGIS |
| `python scripts/build/fetch-satellite.py` | re-stitch the satellite image |

See `docs/DATA_PIPELINE.md` for how each dataset is produced and
`docs/MIGRATION_PLAN.md` for the roadmap of the mind-engine upgrade
(personas, needs, observations, decisions, scenarios, experiments).

## Units and conventions

- 1 scene unit = 50 m; 1 tick = 1 simulated minute; walking 1.62 u/min
  (≈4.9 km/h), buses 6 u/min (18 km/h). Everything in the scene is sized in
  real metres.

## Notes

The simulation is a model, not a measurement: schedules, capacities and
crowd behaviour are plausible inputs, not observed facts.
