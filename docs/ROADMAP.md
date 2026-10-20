# Roadmap

Status is honest — what shipped is checked, what is next is described tightly
enough to build without re-litigating.

## M0 — foundation ✅

- [x] Private mirror (`origin`), upstream preserved, `baseline-import` tag
- [x] Baseline battery recorded (docs/BASELINE.md)
- [x] README that describes the actual product, not the Vite template

## M1 — deterministic engine ✅

- [x] Engine extracted to `src/engine/`, seeded LCG everywhere, snapshot hash
- [x] Wait-time ledger, left-behind ledger, per-minute histories, `metrics()`
- [x] Served-stop snapping (Rodkin fix) discovered by live validation
- [x] Vitest suite (17 tests) + `check:all` battery, CI on GitHub Actions

## M2 — the scenario product ✅

- [x] `event_surge` / `stop_closure` / `fleet_add` at tick boundaries with
      validation and revisions
- [x] Draft → confirm → apply flow in the console; free-text parser with
      surfaced assumptions; five JSON presets incl. the BSC-1000 headline
- [x] Paired A/B day in-tab; per-stop deltas; per-stop queue chart overlay
- [x] Live event marker in the scene; jump-to-event; reserve-fleet lever wired

## M3 — data lanes (in progress)

- [x] Simulated sensor fleet matching the firmware payload contract
- [x] Live Rutgers tracker overlay (CORS-failing visibly)
- [ ] **Ingest service**: Node + WebSocket server; replace `readFleet()` with a
      subscription; SQLite persistence of raw windows; replay-a-day endpoint
- [ ] **GTFS-static ingestion**: DOTS timetable → per-minute dispatch instead of
      the static headway table; last buses; peak/off-peak headways
- [ ] Traffic layer: per-edge speed curves (peak/off-peak) before any external
      traffic API dependency

## M4 — intelligence (next)

- [ ] Forecasting v1: seasonal-naive + gradient boosting on per-stop arrival
      histories and sensor counts; backtested MAE/MAPE; drive the alert card on
      predicted wait, not current queue
- [ ] Narrative reports: LLM-generated plain-English A/B summaries with
      evidence-bound facts (provider-agnostic, mock for CI, cost ledger)
- [ ] Dispatch advisor: rank reserve-fleet options by simulated wait reduction
      (this is what makes the alert card's button smart instead of immediate)

## M5 — operator polish

- [ ] Playwright e2e + a11y pass over the whole operator flow
- [ ] Results page: exportable CSV/JSON, definitions-and-limitations first
- [ ] Replay scrubber for the recorded day; heat layer for waiting exposure
- [ ] Mobile pass (375px) of the panels

## M6 — real hardware

- [ ] One-building pilot: 2× ToF door counters at BSC, gateway on 5G
- [ ] Calibration protocol (docs/SENSOR_INGEST.md) run for real
- [ ] The honest swap: `src/sensors.ts` reads the ingest; the badge flips from
      _simulated telemetry_ to _live_
