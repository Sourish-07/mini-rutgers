# Baseline verification

Recorded before and after the v2 engine/scenario work, so every change is
attributable. Machine: Windows, Node v22.18.0, npm 11.5.2, git 2.36.1.

## Upstream baseline (commit `8a9598c`, tag `baseline-import`)

| Check          | Result                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`       | ok — 217 packages                                                                                                                                                          |
| `check:layout` | layout ok · scale ok (person 1.75 m, bus 12 m, road 8 m, storey 3.6 m)                                                                                                     |
| `check:sim`    | `sim ok — 800 agents (104 walking, 32 waiting, 0 riding), 67 buses, capacity 70-84`                                                                                        |
| `check:bus`    | `wrap ok — 178 loop wraps, none teleported` · `heading ok — 112 reversals in 3446 moving steps (3.3%)` · `bus ok — 148 moving samples, 32 dwelling, worst 0.0 m off route` |
| `check:iso`    | `iso ok — projection round-trips and the ground warp is consistent`                                                                                                        |
| `lint`         | 14 warnings, 0 errors (pre-existing style; unchanged through v2)                                                                                                           |
| `build`        | ✓ vite 8.3.4, 1150 modules                                                                                                                                                 |

## After v2 (engine + scenarios + A/B + sensors + live + tests)

| Check                                      | Result                                                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:sim`                                | `sim ok — 800 agents (104 walking, 28 waiting, 0 riding), 67 buses, capacity 70-84` — waiting drops 32→28 because agents near the Rodkin shelter (which no modeled route serves) now snap to the nearest served stop instead of waiting forever |
| `check:bus` / `check:iso` / `check:layout` | byte-identical to baseline                                                                                                                                                                                                                      |
| `npm test`                                 | **17/17 pass** — determinism (snapshot hashes), invariants, event surge spawn/crush/egress-settle, stop closure (incl. the in-flight-walker reroute fix), fleet_add, paired experiment, parser, presets                                         |
| `build`                                    | ✓ vite 8.3.2 (pinned), 1165 modules                                                                                                                                                                                                             |
| `lint`                                     | 14 warnings, 0 errors (same set as baseline)                                                                                                                                                                                                    |

## Live browser validation (dev server, Chromium)

1. Loaded at 09:00 — scene renders, no console errors beyond a favicon 404
2. Typed `1000 person event at BSC tonight 7pm` → draft card:
   `~720 attendees → Busch Student Center · 19:00–22:00` with show-rate and
   arrival-spread assumptions listed
3. Applied → scenario chip + jump button; jumped to 18:45; by 19:20: 720 event
   agents spawned, 42 physically around BSC, BSC peak queue 36, day totals
   2,672 left behind / avg wait 7.4 min / p95 31 min
4. `Run paired day` completed in-tab (3000 agents, seed 7, to 23:30):
   BSC peak queue **19 → 221**, +401 left behind, avg wait +0.5 min, p95 +2.0 min
5. `Reserve fleet` applied `+3 buses` to the busiest served corridor live
   (W1 6→9, fleet 67→70, active chip) — after the served-stop fix; the first
   attempt silently no-opped because the busiest queue sat at unserved Rodkin,
   which is exactly the kind of thing live validation is for
