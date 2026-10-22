# Campus Motion

A manipulable microcosm of the Rutgers–New Brunswick campus: **thousands of
individually simulated students**, real bus routes on real roads, real
building footprints — and **levers to pull** (close a street, drop a food
truck, schedule an event in a building) to see how the campus reacts *before*
trying it in reality.

Rendered as an isometric 3D scene (React + three.js) on a **designed vector map**:
landcover, roads and footways drawn from OpenStreetMap as real geometry, so the
map stays sharp from 5 m to 5 km — no stretched photograph, which is what used to
turn to mush the moment you zoomed in. The satellite image is still in the build
as an optional aerial base layer (the `aerial` toggle, top right). Around it: stop
telemetry, a queue forecast, a click-anyone student inspector, and a live results
ledger that measures what your lever did against a deterministic baseline day.

**What makes this different from a crowd visualizer:** every student is drawn as
the same small walk-animated 3D figure — blocky, lit, and crisp at any zoom — and
every scarlet one on the College Avenue campus is an *individual*: a name, a real
Rutgers class schedule, a dorm, hunger, energy, stress, an RU Express balance and
a personality, making a scored, explainable decision every time they move. Click
one and read their reasoning, including the option they rejected.

Two student populations share the map:

| Population | Who they are | How they are drawn |
|---|---|---|
| **On-campus students** (420) | live in the College Avenue dorms; each one is simulated by the behavior engine with a real Tuesday schedule | scarlet shirts, clickable — the cohort you can interrogate |
| **Off-campus students** (6,000) | commute in on the buses, walk to a destination, walk home | muted shirts, statistical background population |

The two are the same renderer and the same 1.75 m scale; the colour is the only
difference, and it is also the legend.

## Contents

1. [Quick start](#quick-start)
2. [The living quarter — a demo walkthrough](#the-living-quarter--a-demo-walkthrough)
3. [How the simulation works](#how-the-simulation-works)
4. [The behavior engine in detail](#the-behavior-engine-in-detail)
5. [Data sources (all free, no keys)](#data-sources-all-free-no-keys)
6. [Project layout](#project-layout)
7. [Scripts](#scripts)
8. [Units & conventions](#units--conventions)
9. [Verification gates](#verification-gates)
10. [Limitations & accuracy notes](#limitations--accuracy-notes)
11. [Roadmap](#roadmap)
12. [Deployment](#deployment)

## Quick start

```sh
npm install
npm run dev        # → http://localhost:5173
```

The app boots at **09:00 on a real Tuesday** with 6,000 background students
already moving and the camera opened on the College Avenue Student Center
stop. Play/pause and 1×–240× speed controls are in the top-right. The whole
day runs 07:00–02:00; at 240× you will finish it in about five real minutes
(reload the page to restart the day — a restart button is on the roadmap).

No API keys, no .env, no server — everything the app needs is baked into
`src/data/` at build time (see [Data sources](#data-sources-all-free-no-keys)).


## The living quarter — a demo walkthrough

Alongside the 6,000 statistical off-campus students and 67 buses, **420
on-campus students** live in the College Avenue dorms. They wear scarlet (the
background population wears muted colours) so you can watch the minds move
through the crowd.

### 1. The What-if box (bottom-left)

Type a lever in plain English and press Enter (or click a preset chip). The
parser shows exactly what it understood — the grounded change, every
assumption it made, anything it could not support — *before* anything
happens. Changes take effect at the stated time (next 5-minute boundary).

| Try typing… | What happens |
|---|---|
| `close Bishop Place at 10am until noon` | Red barrier bars appear at 10:00. Students mid-walk across the street are force-detoured with a logged reason (*"Bishop Place closed ahead — detour adds 3 min"*); everyone routing through afterwards gets a closure-aware detour; lateness ticks up in Results; and the street **reopens by itself at noon**. |
| `put a food truck on Vorhees Mall at noon` | A truck mesh spawns on the nearest walkable point. Nearby students and outgoing personalities get an app-style alert; hungry students with schedule slack divert to it (90 min of "novelty" scoring) and it earns real, conserved revenue. |
| `host an event in Scott Hall at 6pm` | Outgoing students (score ≥ 45) whose real schedule leaves them free that evening walk over and attend. |
| `make it snow` | Rejected — with help text listing what it *can* do. Nothing is ever silently ignored. |

Known streets: Hamilton Street, College Avenue, Somerset Street, George
Street, Easton Avenue, Huntington Street, Bishop Place, Seminary Place, Union
Street, Mine Street. Any building in the registry can host an event; trucks
can be placed at any building or landmark (try "the Yard").

### 2. The Inspector (top-right)

Click any scarlet figure (or press **Pick a student on the move**). You get:

- **Persona** — name, year (first-year → graduate; off-campus students are
  labelled `off-campus`), one-line backstory, walk pace, outgoing & diligence
  scores, meal-plan status.
- **Needs bars** — hunger, energy, stress (0–100), live.
- **RU Express balance** — integer cents; students who cannot afford a venue
  skip it, and the Results ledger stays exact.
- **Their real Tuesday schedule** — e.g. *"10:20–11:40 220:606 · Scott Hall
  220"*, *"17:40–20:40 840:314 · Geology Hall 103"* — actual Rutgers
  sections with real building, room and time.
- **Decision log** — clock time, the chosen action, its rationale, and the
  runner-up option they rejected:
  > 07:01 **eat** — Brower Commons: hunger 48, queue ~0 min, $9.85, 170 min
  > spare before 10:20 · runner-up: *220:606 at 10:20 — 187 min slack,
  > staying in*
- **What they noticed** — world-facts they personally observed (*"Saw
  barriers go up on Bishop Place"*, *"RUDining alert: Food truck just opened
  nearby"*, *"Missed 220:606 — 10:20 in Scott Hall"*).

### 3. The Results panel (under the Inspector)

A live ledger of the day compared against a **deterministic baseline day
baked at build time — at the same time of day** (114 ten-minute buckets), so
a mid-day reading is honest rather than a comparison against a finished day:

- meals served (total + per venue), dining revenue ($)
- classes attended / **late arrivals** / missed classes
- event attendees, collective walking minutes, average stress
- per-metric Δ vs baseline, colour-coded by direction
- a live **money-conservation check**: every student's spending summed
  equals venue revenue, to the cent (integer cents everywhere, never floats)

Visual aids in the scene: a pulsing scarlet ring and a light beacon track the
inspected student (a 1.75 m figure is easy to lose on a 7 × 11 km map), scarlet
bars mark closed edges, truck meshes mark `place_add` venues.

## Project layout

```
src/
  app/        composition root (App.tsx) — owns the sim instance and the canvas
  engine/     PURE simulation logic, no React/three imports
    sim.ts        students, buses, queues, the tick loop (1 tick = 1 minute)
    navigation.ts walkable-campus graph + A* routing (loads data/network.json)
    mind/         the behavior engine: cohort schedules, needs, decisions,
                  scenarios, dining queues, metrics (see docs/ARCHITECTURE.md)
  render/     three.js presentation
    scene.tsx     the scene: vector ground, buildings, buses, people, stops, camera
    ground.ts     the designed map — landcover polygons and road/footway ribbons
                  built as geometry, so nothing is a stretched bitmap
    people.tsx    the crowd: blocky instanced figures (7 draw calls for 6,000
                  people) with a walk cycle, baked face shading, contact shadows
    iso.ts        shared 2:1 dimetric projection math (used by checks)
    mindScene.tsx on-campus figures, closure barriers, trucks, selection marker
  ui/         React overlay (theme.tsx design tokens; Panel.tsx primitives;
              Panels.tsx: top bar, populations, telemetry, forecast, map labels,
              legend, status strip; MindPanels.tsx: What if…, Inspector, Results;
              Sparkline.tsx: the hand-drawn queue chart)
  data/       generated datasets — see docs/DATA_PIPELINE.md
scripts/
  build/      regenerates the datasets (OSM graph, bus paths, places, satellite)
  check/      invariant and accuracy checks (sim, buses, iso math, live feed)
docs/         ARCHITECTURE.md, DATA_PIPELINE.md, MIGRATION_PLAN.md
```

Dependencies flow one way only: `app → {render, ui} → engine → data`.
The engine never imports React or three; it can run headless in Node (the
`scripts/check/` scripts do exactly that).

## How the simulation works

**Two engines, one clock.** The legacy engine (`engine/sim.ts`) drives the
6,000 background students and the 67-bus fleet on the legacy statistical
loop (home → stop → wait → ride → destination, real headways, real
capacities). The behavior engine (`engine/mind/`) drives the 420-student
focus cohort through their real schedules. Both advance on the same
simulated clock — the render loop adds `dt × speed / 60` minutes per frame
and both engines catch up to the floor of that clock, idempotently.

**Time model.** 1 tick = 1 simulated minute. The legacy engine counts
absolute minutes (420 = 07:00); the mind engine counts minutes since 07:00 —
the App wiring converts. The day runs to 02:00 (1,140 mind-minutes).
Rendering interpolates positions between ticks along the actual path, never
across it.

**Determinism.** One seeded LCG stream per engine; no `Math.random` in any
decision. Identical inputs (seed + data + change list) reproduce the day
bit-for-bit — verified by `check:mind` via state hashes. That determinism is
what makes the Results panel's baseline comparison scientifically honest:
the baseline is the *same* engine, same seed, same data, zero levers.

**Rendering.** An orthographic 2:1-dimetric camera over a single painted
ground canvas (grass, footways, carriageways, route ribbons — one draw
call), real ArcGIS building footprints extruded as wall+roof meshes, buses
interpolated along their real loop polylines, people as instanced painted
billboards. The minded cohort renders through a second instanced pass with
per-instance colour, plus an invisible "fat" hit-proxy mesh so a 1.75 m
figure is clickable at campus zoom.

## The behavior engine in detail

`src/engine/mind/` — pure TypeScript, no React/three imports, headless-testable:

- **`nav.ts`** — the walkable graph from OSM data with **edge identity**.
  A* with a per-closure-epoch memo: when a closure changes the blocked set,
  the epoch bumps and all cached routes are invalidated. Spatial-hash
  snapping (10 m cells) so route queries stay cheap. `edgesNear()` grounds
  "this street" as the set of graph edges within 30 m of the street's real
  geometry.
- **`population.ts`** — builds the cohort: 420 students, homes drawn from
  the 17 real CAC dorms (ArcGIS "Housing" category), 2–4 real class
  sections each, feasibility-repaired (no time overlaps, walkable gaps
  between consecutive classes verified against the actual graph), seeded
  personas (archetype-weighted, pace 0.85–1.15×, outgoing/diligence
  15–95, RU Express budget, meal-plan flag, templated backstory).
- **`engine.ts`** — the minute tick:
  - *Needs*: hunger +0.35/min (≈3–4 meals/day), energy drains with activity
    and recovers at the dorm, stress rises in queues/when late and falls at
    the gym/events/home. All bounded 0–100.
  - *Decisions* (mock-policy-v1): when free, every student scores their
    options — leave now for the next class (mandatory once the walk time +
    a diligence-scaled buffer consumes the slack), eat at each open venue
    (hunger, nutrition, queue estimate, price, meal-plan, novelty, spare
    time before class), study at Alexander Library or hit the College Ave
    Gym in long gaps (personality-gated), attend an announced event, or
    rest. Highest score wins; the top 3 options and the winner's rationale
    are logged, bounded to the last 12 entries.
  - *Dining*: real venues with real hours and prices; FIFO queues with
    per-venue service rates; eating reduces hunger by the venue's
    nutrition; students who can't afford it leave the line. Money is
    integer cents, conserved exactly (student spend = venue revenue).
  - *Observations*: students react to world changes **only through what
    they can plausibly see** — walking into a closure forces a replan from
    wherever they stand; standing within ~200 m when barriers go up logs
    "saw barriers"; truck/event announcements reach nearby or outgoing
    students as app-style alerts. Nobody has god-knowledge of a change.
  - *Scenarios*: applied at 5-minute boundaries, versioned in an applied
    list; closures schedule their own reopen.
  - *Metrics*: attendance/lateness per section, queue-minutes, meals and
    revenue per venue, walking minutes, per-building occupancy per
    10-min bucket, average stress, event turnout.
- **`scenario.ts`** — the what-if parser. Grounds closures against
  `streets.json`, trucks/events against the building registry and landmarks;
  extracts times ("at 3pm", "until 5pm", "noon"); states its assumptions
  explicitly (e.g. *"closure covers all 144 graph edges within 30 m of
  Bishop Place; cross-street ranges are not yet supported"*) and rejects
  what it cannot ground instead of guessing.


## Data sources (all free, no keys)

Every dataset is generated at build time and committed; the app makes no
runtime API calls for its behavior data.

| Dataset | Source | Notes |
|---|---|---|
| `network.json` — walk/drive graph | OpenStreetMap extracts (Overpass) | rebuilt only when fresh OSM data is on disk; ~30k walk edges with drive/walk flags |
| `stops.json` / `routes.json` / `paths.json` | hand-authored stops + the 12 real Rutgers routes (A, B, B/L, C, EE, F, H, Lx, RexB, RexL, W1, W2), A*-derived on real roads | headways match weekday service |
| `places-v2.json` — 748 buildings | Rutgers ArcGIS FeatureServer (`Rutgers_University_Buildings`) | full attributes + footprint polygons in scene units |
| `bldg-codes.json` | hand-curated | maps SIS building codes (SC, MU, HH, ABW/ABE, CI…) to building ids; identified by cross-referencing each code's real course mix; 2 medium-confidence entries flagged |
| `schedule.json` — 573 real Tuesday sections | public SIS Schedule of Classes API (`sis.rutgers.edu/soc/api/courses.json`) | real meeting times, buildings, rooms; unmapped codes dropped with warnings |
| `streets.json` — 10 named street corridors | Nominatim (OSM geocoder), 1 req/s | street geometry for name-addressed closures |
| `dining.json` — real venues & hours | hand-transcribed from dining.rutgers.edu | Brower Commons, Harvest Juice Bar, the Knight Wagon (which really parks by Alexander Library on Tuesdays), Alexander Library, College Ave Gym |
| `baseline.json` — the no-lever day | computed locally by the same engine | final metrics + 114 cumulative 10-min buckets |
| `land.json` — water, green, pitches, paved lots | OpenStreetMap via Overpass (`scripts/build/build-land.mjs`) | polygons in scene units: simplified, area-capped, clipped to the frame. This is the designed ground layer — no runtime fetch |
| `satellite.jpg` | Esri World Imagery tiles, stitched | the 7 × 11 km frame; now an optional aerial base layer, because one fixed resolution cannot survive a 50× zoom |

Regenerate the behavior datasets with `npm run build:data` (needs network for
ArcGIS/SIS/Nominatim; the baseline step is fully local). There is **no API
key anywhere in this project** — every source above is public and free.

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
| `node scripts/build/build-land.mjs` | rebuild the landcover layer (water, green, pitches, parking) from OSM |
| `python scripts/build/fetch-satellite.py` | re-stitch the satellite image |

See `docs/DATA_PIPELINE.md` for how each dataset is produced and
`docs/ARCHITECTURE.md` for the module map.

## Units & conventions

- 1 scene unit = 50 m; 1 tick = 1 simulated minute; 1 unit/min walking = 50 m/min.
- Walking speed: 1.62 u/min (≈4.9 km/h), scaled 0.85–1.15× by persona pace.
  Buses: 6 u/min (18 km/h). Figure height 1.75 m, bus 12 m, storey 3.6 m —
  all real metres, verified by `check:layout`.
- Money: **integer cents everywhere**, never floats — the ledger conserves
  exactly.
- The engine counts minutes since 07:00; the legacy sim counts absolute
  minutes. Rendering interpolates along the path between ticks, never across it.
- Comment rule: comments explain *why* (invariants, gotchas), not *what*.

## Verification gates

Everything below is green on this branch:

| Gate | What it proves |
|---|---|
| `npm run build` | tsc + Vite typecheck and build clean |
| `npm run lint` | oxlint, 0 errors |
| `npm run check:sim` | legacy engine invariants: one state per agent, no NaN, riders on their bus, FIFO queues, per-vehicle capacities |
| `npm run check:mind` | behavior engine: **same seed ⇒ identical state hash** (determinism), needs bounds 0–100, bounded decision/knowledge memory, exact money conservation, parser grounding (closure/truck/event parsed, nonsense rejected with help), and that the Bishop Place closure has a measurable day-level effect (forced mid-walk replans, lateness/walk-minute deltas) |
| `node scripts/check/check-bus.mjs` | buses stay on their route, at the right speed, no teleports on loop wrap |
| `node scripts/check/check-iso.mjs` | dimetric projection round-trips; ground warp consistent with camera |
| `npm run check:layout` | real-world distances/bearings (ARC↔BSC), scale regressions |
| `node scripts/check/check-live.mjs` | live Rutgers bus feed vs our route geometry (<250 m) |
| `node scripts/check/check-overlap.mjs` | route points vs building footprints |
| scrub grep | zero brand traces outside the provenance doc |

## Limitations & accuracy notes

The honest list — what this build is *not*:

- **The simulation is a model, not a measurement.** Schedules are real;
  crowd behavior, service rates, needs decay rates and lateness buffers are
  plausible parameters, not observed facts.
- Cohort students **walk only** — buses stay ambient background. Bus
  rerouting under closures is the next lever (planned).
- **Hamilton Street closures parse but have ~no pedestrian effect**: the
  OSM walk graph routes the cohort through campus footways, not Hamilton's
  sidewalks. Bishop Place is the demonstrated closure (its sidewalks carry
  ~289 of the cohort's route edges). The parser accepts any known street;
  the effect just reflects reality.
- Street-range closures ("from X to Y") are not yet supported — the whole
  known street closes, and the parser says so in its assumptions.
- 2 of 24 building-code mappings are medium-confidence inferences
  (CA → 191 College Ave, MH → Bildner Center); a wrong guess displaces
  classes by ~150 m at most. BRT/EAS sections (8 meetings) are dropped
  with a warning.
- The console is clean at boot. Stop labels used to come from drei's `<Html>`
  overlays, which logged 8 benign React errors; they are now projected by the
  camera and drawn as plain DOM, so the messages are gone and the labels are
  crisper. The single remaining message is three.js deprecating `THREE.Clock`
  inside react-three-fiber — an upstream notice, not this app's.
- The mind day runs 07:00–02:00; at 240× it finishes in ~5 real minutes.
  No day-restart button yet — reload the page.
- Lateness model: 1-minute ticks + a 1–3 min diligence buffer ⇒ ~25% of
  arrivals late. Plausible for a model; not an observed fact.
- Not built yet: A/B experiment coordinator (the baked baseline provides
  paired comparison only), LLM-driven students, replay/timeline scrubbing,
  weekend routes, bus reroute-under-closure.

## Roadmap

1. **Bus levers** — headway/capacity overrides and route changes reacting to
   closures (extends the legacy engine).
2. **Widen the quarter** — more campuses are just more building-code rows
   plus schedule filters; the cohort scales with a constant.
3. **Replay** — compact frames + checkpoints for timeline scrubbing to the
   moment a lever landed.
4. **Experiments** — paired A/B runs sharing a population manifest, exact
   statistics over seed pairs.
5. **LLM students** — a provider port behind the same decision interface;
   free tiers (Groq / OpenRouter free models / local Ollama) work with no
   other changes.

See `docs/MIGRATION_PLAN.md` for the full phased plan.

## Deployment

Pure static build — no server, no keys:

```sh
npm run build   # → dist/
```

Host `dist/` on GitHub Pages, Netlify, Vercel or Cloudflare Pages (all free).
There are **no runtime network calls at all**: buildings come from the baked
`places-v2.json` footprints, the ground is drawn from baked geometry and OSM
data, and the interface fonts are bundled as woff2 by Fontsource. Open the
build with the network switched off and it still works.

## Docs

- `docs/ARCHITECTURE.md` — module-by-module responsibilities and the timing
  model.
- `docs/DATA_PIPELINE.md` — every dataset: source → generator → consumer →
  check.
- `docs/MIGRATION_PLAN.md` — the phased roadmap of the mind-engine
  migration, including what was deliberately *not* copied and the scrub
  protocol.

