# Campus Motion — Migration Plan (behavior engine port)

**Purpose.** This is the complete, self-contained manifest for porting the
individual-student behavior engine (personas, needs, observations, decisions,
scenarios, experiments) from the archived reference codebase — the sibling
folder `DON'T EDIT/` at the workspace root — into this repository, fully
rebranded as **Campus Motion**. Everything needed is recorded here; after each
phase lands, the archive does not need to be opened again.

> Internal provenance note: this file is the only place that names the
> reference material. Delete it after migration if you want the repo to carry
> zero mention of it. The product code, docs and UI must never contain the
> strings in §3.

## 1. Rebrand dictionary

Apply this mapping to every copied file, comment, identifier, type name and
string literal:

| Reference term | Campus Motion term |
|---|---|
| park / ParkBundle | campus / `CampusBundle` |
| guest / GuestObservation | student / `StudentObservation` |
| group / GroupManifest | friend group / `GroupManifest` (keep) |
| place kinds: ride, food, shop, restroom, show, scenery, entrance, exit | `dining`, `class`, `study`, `gym`, `shop`, `restroom`, `stop`, `gate`, `exit` |
| ride service | `class`/`gym` session service (seats, schedule, duration) |
| show service (startsAtMs) | `event` service (events start at scheduled times, doors open earlier) |
| counter service (food) | counter service (keep: dining halls, food trucks, cafés) |
| Harbor Pass (pass product) | dining plan / meal swipe product |
| wait board (WaitDisplay) | wait board (keep: bus-stop and dining boards) |
| park opening/closing | campus day start/end (e.g. 07:00–02:00) |
| leave_park action | `leave_campus` |
| archetypes: young_family, teens, couple, thrill_seekers, seniors, solo | `freshman, sophomore, junior, senior_year, grad, commuter, faculty` |
| thrill preference | `energy_outgoing` preference (class/gym/event seeking) |
| fun need | `wellbeing` need (inverted stress) |
| fatigue need | `energy` need |
| must-do places | must-attend schedule (classes, gym session, event) |
| satisfaction rating | day-satisfaction rating (keep rubric mechanics) |
| behavior.v1 contract | `campus.v1` contract |
| Jev (LLM provider) | `model` provider (generic; name the actual vendor later) |
| Laya (local model) | `local` provider |
| mock-policy-v1 | keep the name `mock-policy-v1` (neutral already) |
| Harbor Lights content | Rutgers–New Brunswick content (generated from our own ArcGIS/OSM data — never copy theirs) |
| theme park, attractions | campus, venues |

## 2. Architecture decision (approved)

Browser-first: the ported engine runs **in-process in the browser** (later in
a Web Worker) with the deterministic mock policy resolving decisions. No
SpacetimeDB, no HTTP worker, no frozen-contract ceremony in the first
milestone. The server/LLM upgrade is Phase 8 and is additive.

## 3. Trace scrub list

After copying any file, none of these strings may remain anywhere in the repo
(README, docs except this file, source, data, UI text):

```
MHacks, mhacks, @mhacks26, Harbor Lights, harbor-lights, Cryplo, dylanli,
behavior.v1 (rename to campus.v1), behavior-engine, Behavior Engine,
@behavior-engine, Jev, Laya, SpacetimeDB, spacetime, main_gate, coaster,
churro, lantern_theatre (any reference place id)
```

Scrub method: copy the file, then grep the workspace for every string above;
rewrite identifiers per §1. Keep an engineering comment describing *what the
code does*, never *where it came from*.

## 4. What exists in the reference (inventory)

Three lanes plus integration tooling. Ours to mine (browser-first):

- **engine/** — pure deterministic TS core (`src/domain`, `src/sim`,
  `src/navigation`, `src/accounting`, `src/replay`), zod schemas, PNG park
  compiler tool, tiny fixtures, 71 tests. The SpacetimeDB `module/`, `client/`,
  and runtime/store/access/driver/scheduler/work layers are server-side and
  deferred (Phase 8).
- **intelligence/** — population generator (archetype shares → groups →
  personas with frozen prose), decision/rating worker pipeline, providers
  (mock, HTTP LLM, local model), NL scenario parser, narration, paired
  experiment coordinator + t-statistics.
- **experience/** — operator UI patterns: LiveStore (snapshot/patch), CommandRunner
  (stable command IDs), What-If panel flow, guest inspector, results/heatmap
  views, scripted fixture runtime, authored-content pipeline.


## 5. Copy manifest (phases, exact files)

Source paths are relative to the archive root; destinations are relative to
this repo. "Adapt" = copy then retheme per §1 (types/strings), keeping the
mechanics byte-faithful where possible.

### Phase 1 — Domain core → `src/engine/core/` + `src/engine/contract/`

| Source | Destination | Action |
|---|---|---|
| `engine/contract/behavior-v1.ts` | `src/engine/contract/campus-v1.ts` | Adapt: rename `CONTRACT_VERSION`→`campus.v1`, park→campus, guest→student; drop server-only DTOs (`WorkLease`, `DriverLease`, `Commands`/`Queries` receipts can stay but shrink later); keep `Id, Hash, SimMs, Cents, Vec2, Needs, Persona, Action, ActionOption, Moment, ScenarioChange/Event, MetricId, AgentView, LiveSnapshot/Patch, Heatmap` shapes. Add our two new change kinds (§6 Phase 6). |
| `engine/src/domain/primitives.ts` | `src/engine/core/primitives.ts` | Copy as-is (canonical JSON, SHA-256, seeded `random()`, `distribution`, `sample`, money helpers, `DomainFault`). Dep: `@noble/hashes`. |
| `engine/src/domain/state.ts` | `src/engine/core/state.ts` | Adapt: `MOMENT_PRIORITY`, `PersonState/GroupState/PlaceState/QueueEntry/Session/DecisionSlot`, `createCore`; entrance→gate. |
| `engine/src/domain/schemas.ts` | `src/engine/core/schemas.ts` | Adapt: zod schemas for CampusBundle/PopulationManifest/RunConfig/Scenario; kinds per §1. Dep: `zod`. |
| `engine/fixtures/tiny.ts` | `src/engine/core/testCampus.ts` | Adapt: 20×16 toy grid → tiny campus with a class, a dining counter, a study bench, one bus stop; 12-student manifest. |

### Phase 2 — Navigation → `src/engine/nav/`

| Source | Destination | Action |
|---|---|---|
| `engine/src/navigation/grid.ts` | `src/engine/nav/fields.ts` | Adapt the *interface* (distance fields, local fields, cell/walkable/neighbors/clearSegment, seeded fields), back it with our existing `network.json` graph instead of the cell grid: `field(dest)` = cached Dijkstra over walk edges; `field(dest, blockedEdges)` for road closures. Keep `validatePark`→`validateCampus` spirit as `validateNetwork` (connectivity, queue-zone sanity). |
| `src/engine/navigation.ts` (ours) | `src/engine/nav/graph.ts` | Merge: graph build + A* + memo become the field implementation's substrate. |
| `engine/src/sim/queue-lines.ts` | `src/engine/nav/queueLines.ts` | Adapt: line geometry from authored queue zones (stop/dining polylines at 0.7 m spacing), `slots`, `lineStep`, `stepOut`. |

### Phase 3 — Simulation core → `src/engine/sim/`

| Source | Destination | Action |
|---|---|---|
| `engine/src/sim/engine.ts` | `src/engine/sim/step.ts` | Adapt: 7-phase step machine (prepare→requests→barrier→apply→dispatch→integrate→persist), decision accept/apply, scenario applier, boundary hashes. |
| `engine/src/sim/common.ts` | `src/engine/sim/common.ts` | Adapt: group/member ordering, event log, experience ledger, queue release, open decision lists. |
| `engine/src/sim/observations.ts` | `src/engine/sim/observations.ts` | Adapt: `observe()` 32-fact memory + digest chain, `board()`, entrance/closure/crowd observation. THE core of "students only know what they see". |
| `engine/src/sim/actions.ts` | `src/engine/sim/actions.ts` | Adapt: quote validation, charge/refund, `travel` (uses walkRoute), `join_queue`, `order`, `rest`→`study`, `browse`, `continue`, `leave_campus`, `route`; precondition failures → forced replan. |
| `engine/src/sim/motion.ts` | `src/engine/sim/motion.ts` | Adapt: 250 ms substeps, group field-walking, separation bins, tie-breaks, waiting-heat windows, notice observation while moving. |
| `engine/src/sim/services.ts` | `src/engine/sim/services.ts` | Adapt: FIFO + 3-miss loading guard (bus/dining), session lifecycle, queue checks; rides→sessions. |
| `engine/src/sim/mock-policy.ts` | `src/engine/sim/mockPolicy.ts` | Adapt: interpretable option weights from needs/wallet/waits/must-dos; in-process resolution; keep parity with the provider-side copy. |
| `engine/src/sim/rationale.ts` | `src/engine/sim/rationale.ts` | Adapt: decision explanations ("Hungry (72/100); board: 4 min; $12.50 left → chose …"). |
| `engine/src/sim/status.ts` | `src/engine/sim/status.ts` | Adapt: plain-language status per state. |
| `engine/src/sim/retention.ts` | `src/engine/sim/retention.ts` | Copy near-verbatim: bounded evidence/decision-log for 6k-agent crowds. |
| `engine/src/accounting/metrics.ts` | `src/engine/sim/metrics.ts` | Adapt: metric set → queue minutes/student, lateness, attendance, dining revenue, satisfaction, abandonment; `MetricSnapshot.breakdown`; heatmap aggregation. |
| `engine/src/replay/{frames,checkpoint,physical,tape}.ts` | `src/engine/replay/` | Phase 7: compact frames, checkpoints, hashes. |


### Phase 4 — Population → `src/engine/population/`

| Source | Destination | Action |
|---|---|---|
| `intelligence/src/population/{allocation,assumptions}.ts` | `src/engine/population/{allocation,assumptions}.ts` | Adapt: archetypes per §1, group shapes (solo commuters, roommate pairs, friend groups 2–5), budgets (meal plan cents), arrival bands → class-period waves, stay ranges. |
| `intelligence/src/population/sampler.ts` | `src/engine/population/sampler.ts` | Adapt: persona sampling (age/year, walk speed, hasApp, must-attend schedule, infeasible aspirations = the class that's always full), group partitioning, largest-remainder + feasibility repair. |
| `intelligence/src/population/{index,manifest,park,prose}.ts` | `src/engine/population/{index,manifest,campus,prose}.ts` | Adapt: freeze manifest + hashes; prose = templated backstories (LLM later). |
| `intelligence/src/core/random.ts` | `src/engine/core/random.ts` | Copy: SemanticRandom (uniform/normal/int/weighted/bernoulli keyed by seed+stream). |

### Phase 5 — Scenario system → `src/engine/scenario/`

| Source | Destination | Action |
|---|---|---|
| `intelligence/src/text/scenario.ts` | `src/engine/scenario/parser.ts` | Adapt: NL parser ("close Hamilton St from 5th to George at 3pm until 5", "put a food truck by the Yard at noon", "cancel the career fair in the Busch center") → typed `ScenarioDraft` with assumptions/unsupported lists. Keep clause splitting, money/time parsing, closure-with-reopen logic. |
| `experience/src/features/scenarios/describe.ts` | `src/engine/scenario/describe.ts` | Adapt: change summaries for the confirmation UI. |
| scenario applier in `engine/src/sim/engine.ts` | `src/engine/scenario/apply.ts` | Adapt: 5 s-boundary application, versioned facts, guests react only on observation. |
| `experience/content/harbor-lights/scenarios/*.json` | `src/engine/scenario/presets/*.json` | **Do not copy content**; author Rutgers presets: baseline, road-closure, food-truck-placement, event-in-building, bus-headway change, app-message. |

### Phase 6 — Our extensions (new engineering, no source)

Add to `campus-v1.ts` `ScenarioChange` union (additive, mirroring the
reference's own proposal style):

```ts
| { kind: 'road_closure'; edges: string[]; closed: boolean }   // walk+drive graph edit
| { kind: 'place_add'; place: Place }                           // food truck / coffee cart
| { kind: 'place_remove'; placeId: Id }
| { kind: 'route_change'; routeRef: string; stops: string[] | null; headwayMin: number | null }
| { kind: 'event'; placeId: Id; startsAtMs: SimMs[] }           // building events
```

Road closure mechanics: field cache invalidation for affected destinations,
in-flight walkers get `forced_replan`, buses re-A* their remaining legs.
`place_add` places must snap to the walk graph before validation passes.


### Phase 7 — Results, inspector, replay → `src/ui/` + `src/engine/replay/`

| Source | Destination | Action |
|---|---|---|
| `experience/src/data/liveStore.ts` | `src/ui/liveStore.ts` | Copy near-verbatim: snapshot→patch revision coherence, gap→resync, bounded feeds. |
| `experience/src/features/inspector/evidence.ts` | `src/ui/inspector/evidence.ts` | Adapt: knowledge-vs-truth table, decision history, rationale rendering. |
| `experience/src/features/results/{facts,heat,exportCsv}.ts` | `src/ui/results/` | Adapt: fact bundles, heat overlays, CSV export. |
| `experience/src/features/scenarios/WhatIfPanel.tsx` | `src/ui/WhatIfPanel.tsx` | Adapt: parse→draft→confirm→applied flow + structured editor + map-click placement for `place_add`. |
| `engine/src/replay/{frames,checkpoint,physical,tape}.ts` | `src/engine/replay/` | Compact frames for timeline scrubbing, checkpoints, physical hashes. |
| `intelligence/src/text/narration.ts` | `src/engine/narration.ts` | Template narration now; LLM in Phase 8. |

### Phase 8 — Later (only when needed)

- **LLM provider**: `intelligence/src/providers/{types,http,mock}.ts` + `worker/inference.ts` (cache → coalesce → limiter → provider → validate pipeline) → `src/engine/providers/`, behind the `BehaviorProvider` port; add a vendor adapter + local-model adapter then.
- **Experiments**: `intelligence/src/experiments/{coordinator,stats,preflight,report}.ts` → `src/engine/experiments/` (paired A/B, warmup clone, exact Student-t math).
- **Server**: `engine/{module,client}/` + `engine/src/runtime/{store,access,driver,scheduler,work}.ts` — only if a multi-user/authoritative backend is wanted; the in-process core needs no changes.
- **PNG compiler**: `engine/tools/compile-park.ts` — only if raster authoring is adopted; our content pipeline is graph-based (ArcGIS + OSM).

## 6. Explicitly NOT copied (and why)

- All three lanes' **tests** — adapt the *invariants* (motion never leaves the
  walkable graph, queues FIFO, money conservation, distributions sum to 1,
  replay hash equality) into `scripts/check/` + Vitest, in Campus Motion terms.
- **Generated artifacts** — `contract-schema.json`, `client/generated/*`,
  lockfiles, bundle JSONs, pitch slides/screenshots/prompts, CI workflows
  (write our own).
- **Harbor Lights content** — geometry, places, notices and stories stay in
  the archive; Rutgers content comes from our own ArcGIS/OSM pipeline.
- **Server infrastructure** (Phase 8 gate): SpacetimeDB module/client,
  leases/receipts/shares, scheduler.

## 7. Dependencies to add (pinned like the reference)

`@noble/hashes@2.4.0` (SHA-256), `zod@4.6.5` (schemas); later `vitest`,
`fast-check`, `tsx`. No other new runtime deps.

## 8. Verification gates (each phase must pass before the next)

1. `npm run build` + `npm run lint` clean.
2. `npm run check:sim` + all `scripts/check/` still pass (existing behavior intact).
3. New per-phase checks: determinism (same seed ⇒ identical physical hash),
   money conservation, observation memory bounds, scenario application only at
   5 s boundaries, decision barrier completeness.
4. Grep gate: §3 scrub list returns zero hits repo-wide.
5. Visual gate: 60× speed, 6,000 students, ≥ 55 fps; inspector shows
   per-student rationale.

## 9. Suggested order

Phase 1 → 2 → 4 → 3 → 5 → 6 → 7 → 8. Each phase leaves the app demoable;
commit per phase. When Phase 8 is reached (or earlier if desired), delete
this file to complete the rebrand.



