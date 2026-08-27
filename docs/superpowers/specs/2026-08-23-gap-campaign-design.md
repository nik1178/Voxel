# Gap campaign — design

Date: 2026-08-23. Implements §1, §2 and §3 of
`2026-08-22-measurement-gap-plan.md` (the rationale lives there; this file records the
decisions). Approved by Nik 2026-08-23.

## Invariants

- **Every existing `run_id` stays byte-identical.** `BASE_CONFIG` gains no keys. New
  config keys (`hybridNear`, `maxLoading`, `viewport`) appear only in new cells and have
  JS-side defaults equal to today's hard-coded behaviour (9, 1, 1920×1080).
- Result JSON schema is only extended (new keys under `raw`, `counters_*`, `js_summary`,
  `server_stats`); `bench.plot` tolerates their absence in old results.
- Nothing here changes what a render type draws. The only behaviour change to the client
  is the trailing slash on the HTTP chunk URL (removes a Flask 308 redirect).

## Instrumentation

| Item | Where | Result field |
|---|---|---|
| Load curve: every 200 ms poll in `waitForQuiescence` push `{t, chunksResident, wsBytes, wsMessages, httpRequests, loading, initializing, jsHeapBytes}` | `bench-api.js` | `raw.loadCurve` |
| Per-LOD counters `{bytes, messages, n404}` from the WS client + resident histogram from `chunkData` | `chunk-websocket.js`, `bench-api.js` | `counters_*.byLod` |
| `emptyChunks` (`getMaxHeight() === 0`) | `bench-api.js` | `counters_*.emptyChunks` |
| JS frame time: wall ms of `renderer.render(dt)` per frame during `record()` | `game-manager.js`, `bench-api.js`, `driver.py` | `raw.jsFrameTimesMs`, `js_summary` |
| Chunk-load phase timers (parse / stitch / mesh / upload ms, count) | `hmap-loader.js`, `chunk-mesher.js` → `window.__meshStats` | `counters_*.meshStats` |
| HTTP resource-timing phases (redirect, connect, ttfb, download) p50/p95 | `bench-api.js` | `counters_*.net.http.phases` |
| Server per-request timing (read/decode/compose ms) | `server.py` `/bench_stats` (GET returns + resets) | `server_stats` |
| `git_rev` dirty flag | `driver.py` | `git_dirty` |
| Trailing slash | `hmap-loader.js:149` | — |
| Knobs: `hybridNear`, `maxLoading`, `viewport` | `renderer.js`, `chunk-quad-strategy.js`, `bench-api.js configure`, `driver.py` | in `config` |

## Experiments

| Exp | Question | Cells | Notes |
|---|---|---|---|
| E2 (+reps) | is the chunk-size peak real? | sizes {100,128,200,256,300} × r1,r2 | same ids as E2, repeats 1–2 |
| E5 (+reps) | are fx −5 % and vd +10.8 % real? | fx on/off, quad vd=50 000 × r1,r2 | |
| E6 | does the chunk-size optimum move with render type? | greedy, raycast × {64,128,200,256,512}; mesh × {128,256,512} | ljubljana/horizon |
| E7 | does fx compose with every tactic? | fx=True × {mesh,cubes,planes,greedy,raycast} | hybrid×fx is E5 |
| E8 | quality — hybrid's near field | new view `ljubljana_low` (y=250, horizon) × {hybrid,raycast,greedy} × r0,r1; plus the 6 E1 types at ljubljana/horizon r0 | screenshots always on for E8 |
| E9 | do greedy + raycast compose? | `hybridNear ∈ {9,25,81,225,0=all}` × {ljubljana/horizon, ljubljana_low/horizon} × r0,r1 | |
| E10 | CPU- vs GPU-bound | 6 types × `viewport ∈ {[1280,720],[2560,1440]}` | n=2 for raycast/hybrid/mesh |
| E11 | radius vs quad where radius converges | strategy × `viewDistance ∈ {1000,2000,5000}` | |
| E12 | throttle- or server-bound loading? | `maxLoading ∈ {1,2,4,8}` WS; {1,4} HTTP | |
| E13 | per-LOD / empty-chunk backfill | hybrid × 3 locations (horizon) | |
| E14 | does the ranking hold on the iGPU? | 6 types × {ljubljana, alps} horizon × r0,r1 | `--results-dir bench/results-igpu --expect-gpu intel` |
| E4 redo | honest WS vs HTTP | the 6 `sockets=False` cells, `--redo` | old JSONs → `bench/results-e4-before-slash-fix/` |

Aliases: `--experiments overnight` = E2,E5,E6,E7,E8,E9,E10,E11,E12,E13 (pending only, so
E2/E5 pick up just the new repeats); `--experiments igpu` = E14.
`--expect-gpu {nvidia,intel}` asserts `provenance.adapterInfo.vendor` after the first run
and aborts otherwise (default nvidia).

## Plots (`bench.plot`)

One figure + CSV + `report.md` section per experiment (E6–E14), each opening with a
"what this shows / how to read it" paragraph. Plus zero-run figures from existing data:
E1 multi-metric table, GPU-vs-wall frame time, frame pacing (p99 / 1 % low next to
mean), pitch invariance, bandwidth panels for E2/E3, load curves, noise/repeatability,
and `bench/loc.py` (shader / renderer LOC per tactic) for the "simplest" axis.

## Tests

Pin existing run ids (sampled from `bench/results*/`), new matrix shapes and aliases,
`aggregate` on JS frame times, plot functions on synthetic results (no GPU).
Every new experiment is smoke-run once with `--record-ms 2000` into a scratch dir.
