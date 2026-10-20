# Campus Motion — Data Pipeline

Every file under `src/data/` is **generated**. This document is the map from
source → generator → consumer, so any dataset can be rebuilt or extended
without archaeology.

## Common projection

All generators and the app share the same local projection:

- Origin: `CENTER = [40.5028, -74.447]` (New Brunswick)
- `x = (lon - lon0) * KX / 50`, `z = -(lat - lat0) * KY / 50`
- `KX = 111320 * cos(lat0)`, `KY = 110574`
- 1 unit = 50 m; frame is x ∈ [-70, 70], z ∈ [-110, 110] (7 × 11 km)

## Datasets

| File | Source | Generator | Consumed by |
|---|---|---|---|
| `stops.json` | hand-authored: `{ label, lat, lon, at:[x,z] }` per stop (~20 stops) | — (the only hand-edited dataset) | engine/sim.ts (stops + queues), scripts |
| `routes.json` | hand-authored: `[{ ref, stops:[stopKey…] }]` for the 12 Rutgers routes (A, B, B/L, C, EE, F, H, Lx, RexB, RexL, W1, W2) | — (hand-edited) | engine/sim.ts, scripts/build/build-paths.mjs |
| `network.json` | OSM extracts (`/tmp/osm_*.osm`, Overpass) filtered to the frame; edges `{ a:[x,z], b:[x,z], drive, walk, kind }` from `highway=*` ways (drive: motorway…service; walk: footway, path, pedestrian, steps, cycleway, service, residential) | `node scripts/build/build-network.mjs /tmp/osm_a.osm /tmp/osm_b.osm …` | engine/navigation.ts (walk graph), render/ground.ts (paint), checks |
| `paths.json` | A* over the **drivable** subgraph, stop-to-stop legs, reuse-penalized (×4) so routes never visibly reverse; asserts every point < 1 m from a road node and 0 missed legs | `node scripts/build/build-paths.mjs` | engine/sim.ts (route loops), checks |
| `places.json` | ArcGIS `Rutgers_University_Buildings` FeatureServer: centroid of each building footprint + nearest stop key `{ n, c, x, z, s }` (≈ 700 buildings) | `node scripts/build/build-places.mjs` | engine/sim.ts (student home/destination choices) |
| `satellite.jpg` | Esri World Imagery / USGS tiles z16 stitched over the 7×11 km bbox, cropped, resized to 3200 px wide | `python scripts/build/fetch-satellite.py` | render/scene.tsx (ground plane) |
| `route-paths.json` | First-pass route geometry (written by build-network) | build-network.mjs (same run) | superseded by `paths.json`; kept for reference |
| `places-v2.json` | ArcGIS `Rutgers_University_Buildings`: every attribute (BldgNum, name, category, district, address) + the **footprint polygon** in scene units, for 748 buildings | `node scripts/build/build-places-v2.mjs` | engine/mind (building registry, homes, venue placement) |
| `bldg-codes.json` | hand-authored: SOC building codes (`SC`, `MU`, `HH`, `ABW`…) → places-v2 ids, identified by cross-referencing each code's real course mix against the CAC building inventory | — (the only curated file; codes carry a confidence note) | build-schedule.mjs |
| `schedule.json` | one real day: every CAC section meeting on a Tuesday (573 sections, 18 buildings) with sim-minute times, from the public SIS SOC API | `node scripts/build/build-schedule.mjs` (caches the 21 MB catalog in %TEMP%) | engine/mind/population.ts (cohort schedules) |
| `streets.json` | named street corridors (10 streets) as scene-unit point clouds from Nominatim (1 req/s) — an edge is "on the street" when both endpoints sit within 30 m | `node scripts/build/build-streets.mjs` | engine/mind/scenario.ts (street-name closures) |
| `dining.json` | hand-transcribed real venues (Brower Commons, Harvest Juice Bar, the Knight Wagon truck) with real hours/prices, plus the library/gym | — (curated from dining.rutgers.edu) | engine/mind/engine.ts (venues) |
| `baseline.json` | the deterministic no-lever Tuesday: final metrics + a cumulative snapshot every 10 sim-minutes (114 buckets) for time-honest comparisons | `node scripts/build/build-baseline.mjs` (MUST match App's cohort/seed) | ui/MindPanels.tsx (Results) |

All five behavior datasets regenerate with one command: `npm run build:data` (network for ArcGIS/SIS/Nominatime, local for baseline).

## Validation (`scripts/check/`)

| Check | Guards |
|---|---|
| `check-layout.mjs` | stop coordinates, ARC↔BSC distance/bearing vs reality; scale regressions (person 1.75 m, bus 12 m, storey 3.6 m) |
| `check-sim.mjs` (`npm run check:sim`) | every agent in exactly one state, no NaN positions, riders on their bus, queues consistent, capacities legal, routes reference real stops |
| `check-bus.mjs` | arc-length speed = BUS_SPEED, no teleports on loop wrap, < 6 % direction reversals, ≤ 5 m off own route |
| `check-iso.mjs` | dimetric projection round-trips; ground warp matrix consistent with camera |
| `check-live.mjs` | live feed (`demo.rubus.live/buses`) vs our route geometry (< 250 m); all stops inside the satellite frame |
| `check-overlap.mjs` | route points inside building footprints (data-vs-data consistency) |
| `check-mind.mjs` (`npm run check:mind`) | behavior engine: same-seed determinism, needs bounds, bounded memory, money conservation, parser grounding (closure/truck/event + nonsense rejection), and that the Bishop Place closure has a measurable day-level effect |

## Extending the world

- **New stop**: add to `stops.json` (lat/lon + `at` via the projection), then
  `npm run check:layout`.
- **New route**: add to `routes.json`, then run `build-paths.mjs`.
- **Road closure** (runtime, planned): the engine will filter edges by id from
  a scenario event and rebuild affected routes; the static datasets never
  change.
- **Fresh OSM data**: re-export the bbox from Overpass, then re-run
  `build-network.mjs` (needs the OSM `.osm` files on disk).
