# Campus Motion — Architecture

## 1. Design principle

Campus Motion is built as a **layered simulator-first application**:

1. `engine/` is a pure, deterministic TypeScript model of the campus. It has
   **zero** imports of React, three.js or the DOM. It can run in the browser,
   in a Web Worker, or headless in Node (all invariant checks do).
2. `render/` and `ui/` are projections of engine state. They never own
   simulation truth; they read it.
3. `data/` holds generated, immutable datasets. Every file has a generator in
   `scripts/build/` and a validator in `scripts/check/`.

Dependency rule (enforced by convention, verified by review):

```
app ──▶ render ──▶ engine ──▶ data
  └──▶ ui ──▶ engine
```

Never the reverse. If the engine needs something from the scene (e.g. camera),
it is passed in as a plain value.

## 2. Current modules

| Module | Responsibility | Key exports |
|---|---|---|
| `src/app/App.tsx` | Composition root. Creates one sim per session (`createSim({ population: 6000, seed: 7 })`), runs it to 09:00, mounts `<Canvas>` + `<Panels>`. | `App` |
| `src/engine/sim.ts` | The tick loop (`step(t)`, 1 tick = 1 minute). Students: `home → walk-stop → wait → ride → walk-dest → at-dest → home`. Buses on fixed loops with per-vehicle capacity, dwell at stops, FIFO boarding. Queue history per stop. | `createSim`, `Sim`, `Agent`, `Bus`, `ROUTES`, `STOPS` |
| `src/engine/mind/` | **The behavior engine** (pure, deterministic, headless-runnable). `nav.ts` — walk graph with edge identity, closure-aware A*, spatial-hash snap. `population.ts` — the 420-student focus cohort with real schedules (schedule.json), real dorm homes, seeded personas. `engine.ts` — the per-minute mind tick: needs decay, dining queues, class attendance, decisions with rationale (mock-policy-v1), scenario application at 5-min boundaries, metrics, money conservation, forced replans on observed closures. `scenario.ts` — NL parser grounding "close Bishop Place at 10am until noon" / "put a food truck on Vorhees Mall at noon" / "host an event in Scott Hall at 6pm" against streets.json + places-v2. | `createMind`, `Mind`, `parseScenario`, `PRESETS` |
| `src/engine/navigation.ts` | Walkable graph built once from `data/network.json`; coordinate-keyed A* with memoization; `pathLength`, `samplePath` (arc-length sampling) used everywhere motion is interpolated. | `walkRoute`, `samplePath`, `pathLength`, `P` |
| `src/render/scene.tsx` | The R3F scene: satellite ground plane, ArcGIS building extrusions, bus meshes interpolated along their loop, instanced figure billboards, stop markers, fixed-tilt OrbitControls. Advances the sim on the frame clock (`sim.runTo(floor(clock.t))`). | `Scene`, `m` (metres→units) |
| `src/render/ground.ts` | Single canvas-painted ground texture: grass, footways, carriageways, then route ribbons with dark casing. One draw call instead of 130k road vertices. | `groundTexture`, `FRAME` |
| `src/render/atlas.ts` | 8 figure variants × 3 poses painted once into canvases → `THREE.CanvasTexture` billboards. A painted 1.75 m figure stays legible at campus zoom; a capsule does not. | `figureTextures`, `VARIANTS`, `POSES` |
| `src/render/iso.ts` | 2:1 dimetric projection math shared by any renderer and by the iso check. Currently used by `check-iso.mjs`; kept as the canonical projection reference. | `IsoProjection`, `Z_SCALE` |
| `src/ui/Panels.tsx` | Glass overlay: IoT sensor list (10 5G nodes), fleet stats, 90-minute queue history chart (Recharts), high-volume alert. Samples the sim at 400 ms; the 3D scene runs at frame rate — the two clocks are independent. | `Panels` |
| `src/render/mindScene.tsx` | Mind-cohort rendering: instanced red figures with per-instance colour, an invisible fat hit-proxy so 1.75 m students are clickable at campus zoom, red barrier bars over closed edges, pulsing selection ring, food-truck meshes for place_add. | `MindPeople`, `Barriers`, `SelectionMarker`, `Trucks` |
| `src/ui/MindPanels.tsx` | The operator panels: **What if…** (parse → confirm → apply, with honest assumptions/unsupported lists), **Inspector** (click a student: persona, needs bars, real Tuesday schedule, decision rationale log, observed knowledge), **Results** (live vs the baked baseline *at the same time of day*). | `WhatIf`, `Inspector`, `Results` |

## 3. Timing model

- **Simulated time**: integer minutes since 07:00 (`START`). `sim.runTo(target)`
  is idempotent — the render loop can call it every frame.
- **Wall time**: `clock.t` advances `dt * speed / 60` per frame (dt clamped to
  0.25 s). The floor of `clock.t` is the sim minute; sub-minute fraction drives
  interpolation (`px/pz`, `pd` previous-tick positions and arc lengths —
  interpolate along the path, never across it).
- **Panel time**: 400 ms `setInterval` re-renders the React overlay only.

## 4. Determinism & scale

- `rng(seed)` is a private LCG; every random draw (capacities, destinations,
  departure waves) flows through it. Same seed ⇒ same day.
- 6,000 agents × ~400 simulated minutes is fine in one JS thread today
  because work is O(agents + buses) per tick with memoized A*.
- The planned mind-engine upgrade (personas, decisions) multiplies
  per-agent work; the architecture anticipates this: the engine is already
  isolated so it can move into a Web Worker without touching render/ui
  (see MIGRATION_PLAN.md, Phase 4).

## 5. Extension points (where the microcosm levers plug in)

| Lever | Mechanism (Demo-0 status) | Layer |
|---|---|---|
| Blocked road | **Built.** `close <street> at <time>` → street corridor (streets.json) → graph edges → closure-aware A* (`nav.ts` epoch bump); in-flight walkers get `forced_replan`; scheduled reopen | engine/mind |
| New food truck / coffee cart | **Built.** `put a food truck at <place>` → venue snapped to the walk graph, app-push notifications reach nearby + outgoing students, novelty scoring for 90 min | engine/mind |
| Event in a building | **Built.** `host an event in <building>` → scheduled service; outgoing students attend if their real schedule allows | engine/mind |
| Bus schedule change | planned: per-route headway/capacity overrides; reroute via build-paths A* at runtime | engine/sim |
| A/B experiment | half-built: the deterministic baseline day (baseline.json) already gives paired comparison; the paired-run coordinator arrives with the wider migration | engine (runs) |

## 6. Conventions

- Units: 1 scene unit = 50 m. Time: minutes. Money (later): integer cents,
  never floats.
- No file in `render/` or `ui/` may compute simulation truth; they may only
  read `Sim` state or interpolate between two known ticks.
- Every dataset is regenerable: if a `data/*.json` cannot be rebuilt from
  `scripts/build/`, it is in the wrong place.
- Comments explain *why* (invariants, gotchas), not *what*.
