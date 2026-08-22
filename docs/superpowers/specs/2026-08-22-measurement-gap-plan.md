# Measurement gap plan — what is still missing before the thesis is written

Date: 2026-08-22. Source: five parallel read-only audits of the code, the 216 result
JSONs, the specs, and comparable published work (render tactics; streaming/network/data;
experiment design & statistics; thesis narrative; outside reviewer). Every claim below was
checked against file:line or computed from `bench/results*/`. Budget target: everything that
needs the GPU fits in **one more overnight (~4–5 h) plus one ~1 h iGPU session**; everything
else is code (≈1 day, all ≤15-line changes), plotting, or writing.

The point of this document: nothing in it should be discovered a week before the deadline.

---

## 0. Three findings that change what gets WRITTEN (not just run)

### 0.1 E4's "WebSocket is 5× faster than HTTP" is a dev-server artefact, not transport physics
`server.py:25` declares the route with a trailing slash; `public/hmap-loader.js:149` fetches
without it. Flask answers **308** and the browser re-requests — **two round trips per chunk**.
Werkzeug's dev server also sends `Connection: close` on every response, so each chunk is two
fresh TCP connections. WS has neither cost. Payload bytes are identical (44.65 vs 44.78 MB),
which is exactly what you'd expect if the delta is per-request overhead × a strictly serial
loader (`maximumChunksLoading = 1`). 705 messages / 19.6 s ≈ 28 ms per chunk over WS vs
≈135 ms over HTTP.

- **Write:** the result stands as "on this stack"; state the cause.
- **Run (cheap, recommended):** add the trailing slash (1 char) and re-run the 6 E4 HTTP cells
  into the same dir with `--redo` → the honest WS-vs-HTTP number. Keep the old JSONs in a
  sibling dir as the "before" (they are the evidence for the artefact).
- Also disclose: WS negotiates `permessage-deflate` (Chrome offers it; `simple_websocket`
  accepts) — the byte counter measures **decompressed application bytes**; wire bytes ≈ 0.76×
  (zlib-6 on sampled `.hmap`: LOD-9 deltas 0.62–0.81, LOD-1 root 0.20). HTTP path is
  uncompressed. So "WS = HTTP bytes" is app-level only.

### 0.2 The mesh "incomplete scene" anomaly is resolved — it is NOT a bug
`chunk-mesher.js:125-127,191-194`: an all-zero chunk (`zeroCounter === width*depth`) returns
before `setMeshData`, so it has no vertex buffer and `renderer.js:1029` skips it. **39 of the 64
LOD-1 base chunks at chunkSize 128 are entirely height-0** (outside the survey) — that is the
82–89 % draw ratio. Mesh draws the same *visible* scene as every other type. The other types
spend work on those empty chunks (cubes rasterises 16 384 flat quads per empty chunk). Worth
one sentence and an `emptyChunks` counter (§2.4), nothing more.

### 0.3 "Hybrid wins on quality" is untested — and at the E1 views it is almost certainly invisible
`renderer.js:881-883` picks the **9 nearest chunks by XZ distance** for greedy; at chunkSize 128
those are 9 LOD-9 chunks of 128 m = a **≈384 m patch** under a camera at y = 3000–4000 m.
Hybrid draws 204 942 greedy instances vs greedy's 13.6 M — **1.5 % of the scene**. So at E1
altitudes hybrid ≡ raycast in speed AND in looks, and `E2_RENDER_TYPE = "hybrid"` rests on an
unmeasured constant. Not fatal — hybrid is still a defensible pick (same speed, strictly more
detail near the camera) — but the thesis must either show it (a low-altitude view, §1.6) or say
it is a design argument rather than a measured one. The hybrid near-count is a 4-line knob
(§2.7) and the natural "do greedy and raycast compose?" experiment.

---

## 1. Runs — one overnight (~4–5 h) + one iGPU session (~1 h)

Order matters: do the §2 instrumentation FIRST so every run below also yields load curves,
per-LOD counts, JS frame time and chunk-load timing for free. Run ids are sha1(config+view):
**never add a new key to `BASE_CONFIG`** (it would change every existing id) — put new keys
only in the new cells' config dicts with JS-side defaults; new axes that are not in the config
(viewport, GPU) go to a **separate `--results-dir`**.

| # | What | Cells | Runs | Time | Why / priority |
|---|---|---|---|---|---|
| 1.1 | **E3 redo** (fixed quad strategy; 0-X and X-9 sweeps) | `--redo E3 --results-dir bench/results-full-sweep` | 17 | ~1.5 h (3×900 s walls) | Only campaign backing "LODs are load-bearing"; current data invalid. **HIGH** |
| 1.2 | **E4 HTTP redo after trailing-slash fix** | the 6 `sockets=False` E4 cells, `--redo` | 6 | 10 min | §0.1. **HIGH** |
| 1.3 | **chunkSize × renderType** — does the E2 optimum move? | `renderType∈{greedy, raycast}` × `chunkSize∈{64,128,200,256,512}`; `mesh` × {128,256,512} (1000 would need ~10 GB) | 13 | ~25 min (512 quiesces in ~70 s) | E2's "200 is best" is hybrid-only; hybrid has the smallest per-chunk cost so the optimum almost certainly shifts for GPU-bound tactics. **HIGH** |
| 1.4 | **Repeats where n=1 conclusions sit inside the noise band** | +2 reps: E2 sizes {100,128,200,256,300}; E5 fx on/off; E5 quad vd=50 000 | 16 | ~25 min | fx −5 % and vd +10.8 % are inside the ±7 % hybrid band; E2 peak +14 % is n=1 on the noisy tactic. **HIGH** |
| 1.5 | **fx × every render type** ("composes well") | `fx=True` × {mesh, cubes, planes, greedy, raycast} at ljubljana/horizon | 5 | 8 min | Only hybrid×fx is measured; fx is 4 extra passes — cost should be ~constant ms, i.e. huge for fast tactics, nil for slow. **HIGH** (cheapest composition evidence) |
| 1.6 | **Quality evidence**: screenshots + a low-altitude view | `--redo` the 6 E1 ljubljana/horizon r0 ids with `--screenshots`; plus hybrid vs raycast vs greedy at a NEW low view (y≈200–300 m over Ljubljana, horizon) ×2 | 6 + 6 | 15 min | §0.3; gives the 6-panel figure and the only place hybrid's near field fills the frame. Optional 30-line PSNR/SSIM vs greedy. **HIGH** |
| 1.7 | **hybridNear sweep** (needs §2.7 knob) | `hybridNear∈{9,25,81,225,∞}` at the low view and ljubljana/horizon ×2 | ~16 | 25 min | The actual "greedy + raycast compose" experiment: speed vs near-detail knob. **MED-HIGH** |
| 1.8 | **Resolution scaling** (needs §2.9 `--viewport`) | 6 types × ljubljana/horizon × {1280×720, 2560×1440}, n=1 (slow tactics spread <0.5 %); n=2 for raycast/hybrid/mesh | ~15 | 25 min | Cheapest CPU-vs-GPU-bound proof: raycast/hybrid GPU pass is 0.78 ms of a 2.6 ms frame — FPS should be ~flat for them and fall for planes/cubes/mesh. Separate results dir. **MED** |
| 1.9 | **Radius vs quad at distances where radius converges** | `strategy=radius` and `quad`, `viewDistance∈{1000,2000,5000}` | 6 | 15 min | E5's radius cell is a non-result by construction (50 km = 609 961 chunks needed). Disclose: radius hits the `v1` server path = **raw uncleaned `map/100`**, lod limits are no-ops for it. **MED** |
| 1.10 | **maxLoading sweep** (needs §2.8 knob) | `maxLoading∈{1,2,4,8}` WS + {1,4} HTTP, ljubljana/horizon | 6 | 10 min | Is quiesce time throttle-bound or server-bound? Live test predicts little gain (server is CPU-bound, §3) — that is the finding. **MED** |
| 1.11 | **Iris Xe second hardware** — separate session | flip the Playwright Chromium `GpuPreference` registry entry to `1;` (or delete it); assert `vendor=="intel"`; 6 types × {ljubljana/horizon, alps/horizon} × n=2 → `bench/results-igpu/` | 24 (min 12) | ~1 h (quiesce incl. meshing is slower) | "Does the ranking generalise?" is the first committee question; integrated graphics is the persuasive column for a browser thesis. Restore the registry entry after. **MED, high value/hour** |
| 1.12 | Per-LOD / empty-chunk counters backfill (needs §2.2, §2.4) | 1 run per location, hybrid | 3 | 5 min | Turns "0.06 % of the pyramid" into "N of 14 731 LOD-9 tiles". **HIGH** (free once instrumented; E3 redo gives it anyway) |

**Skip (decided):** flythrough (~100 LOC + 9–18 runs; the §2.1 load curve already gives bandwidth over time and the static design is defensible once stated); frustum culling (a new implementation — report the pitch-invariance evidence instead, §4); GPU-timestamp ring buffer (caveat the sample count instead); back-face cull toggles.

Total GPU time: overnight ≈ 17 long E3 cells + ~100 short runs ≈ 4–5 h; iGPU ≈ 1 h.

---

## 2. Instrumentation to add BEFORE the overnight (≈1 day, every item ≤ ~15 lines)

| # | Change | Where | Lines | Yields |
|---|---|---|---|---|
| 2.1 | **Load-curve sampler**: inside `waitForQuiescence` push `{t, chunksResident, wsBytes, messages, loading, initializing, jsHeap}` every poll; return with result | `bench-api.js:90-106`, `driver.py` store as `raw.loadCurve` | ~8 | bytes/chunks vs time, time-to-"country coarse" (initializing=false), time-to-90 % bytes, msg/s — the streaming figure |
| 2.2 | **Per-LOD counters**: `netStats.byLod[lod] {bytes,msgs,n404}` (store `lod` in `pendingRequests`); histogram of `chunkData` by `levelOfDetail` in `getCounters` | `chunk-websocket.js:78`, `bench-api.js:129-166` | ~10 | "N LOD-9 tiles of 14 731 resident" |
| 2.3 | **JS frame time**: time `renderer.render(dt)`; record per frame; aggregate as `js_summary` | `game-manager.js:95`, `bench-api.js`, `driver.py:192` | ~10 | CPU-bound vs GPU-bound per tactic — the explanation of the E1 dead heat and the left half of E2 (≈3.9 µs JS per chunk per frame) |
| 2.4 | **`emptyChunks` counter**: count `getMaxHeight()===0` in `getCounters` | `bench-api.js` | 3 | §0.2 |
| 2.5 | **Chunk-load phase timers**: parse / stitch / greedy+pack or buildMesh / upload ms into `window.__meshStats`, exposed in counters | `chunk-mesher.js:36-52`, `hmap-loader.js:69-89` | ~12 | CPU cost of each tactic at load; note greedy meshing currently runs for EVERY non-mesh type (`chunk-mesher.js:45-49`) — raycast's quiesce and heap include work it never uses (disclose; do NOT change) |
| 2.6 | **HTTP resource-timing phases** (redirect, connect, TTFB, download percentiles) in `getCounters` | `bench-api.js:154-160` | ~12 | Makes §0.1 visible in the data |
| 2.7 | **`hybridNear` knob**: `renderer.hybridNearCount = cfg.hybridNear ?? 9` | `renderer.js:883`, `bench-api.js configure` | ~4 | §1.7 |
| 2.8 | **`maxLoading` knob**: `quadStrategy.maximumChunksLoading = cfg.maxLoading ?? 1` | `bench-api.js configure` | ~3 | §1.10 |
| 2.9 | **`--viewport WxH`** driver flag → `VIEWPORT` (resize handler does NOT recreate targets, so it must be set before load — Playwright viewport is correct) | `driver.py:26,149` | ~6 | §1.8; provenance already records canvas size |
| 2.10 | **Server per-request timing** (read/decode/encode ms) to a CSV or `/bench_info` | `server.py:44,61` (exists as `vprint`, off) | ~10 | §3: attribution of the 35–50 msg/s ceiling |
| 2.11 | `git_rev` dirty flag | `driver.py:68` | 3 | E3 redo will be at a later rev than E1–E5 |
| 2.12 | Trailing slash in the HTTP chunk URL | `hmap-loader.js:149` | 1 char | §0.1 / §1.2 |

Tempting but an "implementation": a 5-line `lru_cache` on decoded tiles in the server (would cut
~30 ms → ~0.3 ms per request). Only as a measured ablation, only if time is left.

---

## 3. Zero-run work: figures and tables from data already on disk (≈1–2 days of plot.py + writing)

All of this is in every result JSON and none of it is plotted today.

1. **Multi-dimensional "best" table for E1** (medians, 544–580 chunks): FPS / GPU MB / JS heap / draw calls / instances drawn / quiesce s — cubes 35.5 / 55 / 258 / 559 / 8.9 M / 25.0; planes 25.3 / 55 / 247 / 559 / 44.6 M / 28.1; greedy 85.0 / 162 / 254 / 559 / 13.6 M / 20.6; raycast 388.7 / 55 / 253 / 559 / 544 / 18.3; hybrid 390.2 / 162 / 248 / 559 / 205 k / 19.1; mesh 207.0 / **1617** / 97 / 477 / 46.3 M tris / 27.8. (`instancesDrawn` is triangles for mesh.) Mesh 1.6 GB vs greedy 163 MB is a headline never printed.
2. **GPU main-pass time vs wall frame time per tactic** (`gpu_summary` vs `summary`): cubes 26.4/26.5 ms, planes 38.0/38.3, greedy 11.7/11.7, mesh 4.6/4.6 → GPU-bound; **raycast 0.98/1.9, hybrid 1.05/1.9** (ljubljana/horizon) → CPU-bound. Caveat in the text: 2–74 GPU samples per run (one readback in flight), terrain pass only; exclude pitch-up raycast/hybrid cells (≈0 ms GPU).
3. **Normalised throughput**: every instanced VTF type runs ≈4.7 G vertex-shader invocations/s (greedy 13.6 M×4/11.6 ms; planes 44.5 M×4/38 ms; cubes 8.9 M×20/26 ms); greedy's whole win over planes is the 3.3× instance reduction at identical per-instance cost. Per-chunk GPU bytes: ~98 KB texture-only types, 290 KB greedy, 2.9 MB mesh.
4. **Frame pacing**: all fast tactics are pinned at p99 12–16 ms and **1 % low ≈ 49–58 FPS regardless of mean** (mesh 207, raycast 380, hybrid 390); a 390-FPS hybrid run has 162 stalls of ~22 ms in 20 s (one every ~0.15 s, 11 % of wall time). Slow tactics have none. Candidate cause: `chunk-manager.js:65-84` `updateChunks` tight loop on the main thread. Plot p99/1 %-low next to mean; this is a guide-worthy finding ("fast tactics are capped by main-thread stalls, not rendering").
5. **Pitch invariance = no frustum culling, quantified**: greedy 85.1/85.0/84.8 FPS at up/horizon/down, planes 26.0×3 — looking at empty sky costs the same as terrain. Present "up" vs "horizon" per type as the upper bound on what frustum culling would buy. Frustum culling, indirect draws, web workers, render bundles do not exist in `public/` (grep); `.agents/agents.md` planned them — write the proposed-vs-implemented ledger (VTF ✓, CPU greedy ✓ (not compute), raymarch ✓, vertex compression ✓ instanced paths only, indirect ✗, frustum ✗, workers ✗).
6. **Bandwidth panels for E2/E3**: bytes-to-quiescence vs chunkSize (0.62 MB @2 → 44.7 MB @128 → 152 MB @256 → 515 MB @512 → **1.60 GB @1000 = 2.1 % of the pyramid**); request rate plateau ~35–50 msg/s for sizes ≤200 (fixed per-request cost), throughput plateau 7–8 MB/s for 300–600, 4.6 MB/s at 1000. E3 X-9 sweep = the direct "far field not coarsened" bandwidth contrast.
7. **Radius strategy**: plot E5's radius cell as a failure mode (red, annotated), not a 7.3 FPS bar.
8. **Noise/repeatability figure**: 9 replicates of hybrid/ljubljana/horizon → 388.6 ± 8.3 FPS (CV 2.1 %, half-range 3.4 %); E1 within-cell spread median 1.2 %, but 19/54 cells > 3.4 % and 8/54 > 7 % — ALL raycast/hybrid/mesh; cubes/planes/greedy ≤ 0.4 %. Use ±7 % as the band for the fast tactics. No thermal drift (per-hour residuals 1.002/0.997/1.002; repeats time-spread). Vsync: 71/162 runs pinned at 165.00; below the cap paced is 0.1–5 % slower.
9. **E1 text**: say "hybrid ≈ raycast (tie within noise), mesh wins the alpine horizon (185 vs 134 FPS), greedy 3.7× slower, cubes/planes 12–14× slower" — five of nine per-view "wins" are below the noise band; do not rank 1–6.
10. **"Simplest" axis — LOC/resource table** (stated thesis axis, zero artifacts today). Shader lines (non-blank/comment): mesh 37 (20), cubes 81 (48), planes 172 (136), greedy 227 (151) + greedy-mesher.js 172, raycast 177 (132), fx 162 (116) + ~200 renderer lines / 4 pipelines / 4 extra passes. Renderer pipeline+draw branch: cubes 26+7, planes 26+45 (35 = manual culling), greedy 26+20, raycast 26+7, hybrid +10 select, mesh 26+30 + chunk-mesher buildMesh ≈197. Shared by all: VTF upload ~40, hmap-loader 178, quad strategy 441, WS client 91. Also per-chunk GPU resources and concept count. No field standard exists — say so and define the proxy. Commit a 30-line `bench/loc.py` so it is reproducible.
11. **Dataset-scale table** (computed): clean pyramid 19 953 files, **74.825 GB** (LOD 1: 1 file 5 MB; 2: 4; 3: 10; 4: 26; 5: 82; 6: 278; 7: 1 006; 8: 3 815 = 14.3 GB; 9: 14 731 = 55.2 GB); base `map/100` 14 731 × 5 MB = 73.66 GB; quadtree 256×256 slots, bbox X 421–625 / Z 31–194, LOD-9 fills 22.5 % of slots; **14 731 km² of tiles vs Slovenia's 20 273 km² = 72.7 %** — needs an explicit sentence on survey coverage; a quiescent view = 44.65 MB = 0.060 % of the served pyramid (`plot.py:38` uses 70 GiB; actual 74.825 GB — fix the constant). Raw LAZ "~5 TB": E:\gkot is not mounted — when attached, `Get-ChildItem E:\gkot -File | Measure-Object Length -Sum` (~1 min) gives the real compression ratio.
12. **Streaming facts for the text**: WS message = 8-byte header (requestId, status) + raw 5 B/px payload; LOD-1 chunk 81 920 B, delta 61 440 B at size 128; zero 404s in every E1/E4/E5-quad run; bytes and resident chunks are identical across render type AND pitch (no frustum-aware loading — looking straight up downloads the same 44 MB); the 64 base chunks load strictly serially before the tree exists; server decodes the **whole 3.75–5 MB tile per request, no cache** (~30 ms aligned, ~120–150 ms when a 128 px chunk straddles 2×2 tiles — ~23 % of requests, since 1000/128 is not an integer) → the server, not the network, sets the 35–50 msg/s ceiling on localhost.

---

## 4. Offline computations (no GPU, not concurrent with benchmarks)

1. **Preprocessing country-level totals** — the chapter has per-tile numbers (spec tables) but cannot say how much of Slovenia was cleaned. `build_quad_tree.py:203-207` printed the totals to stdout only. Recover by diffing `lod_output/9` vs `lod_output_clean/9` (both on disk, 14 727 common files): pixels lowered (artifacts), raised from 0 (water), still nodata. Full pass ≈ 2×55 GB reads, 1–2 h disk-bound; a 500-chunk random sample ≈ 5 min with a CI. Also per-stage wall time on ~50 chunks (minutes) and the residual-nodata (coast) fraction.
2. Raw LAZ total size when E: is mounted (above).
3. Optional PSNR/SSIM of the §1.6 screenshots vs greedy as reference (30-line script).

---

## 5. Housekeeping that blocks reproducibility

- **Commit the preprocessing pipeline**: `python/build_quad_tree.py`, `water_fill.py`, `artifact_filter.py`, `chunk_io.py`, `convert_missing_chunks.py`, `laz_tile.py`, `python/tests/`, `bench/tests/test_driver.py`, and the preprocessing spec — all UNTRACKED. Every result JSON names `lod_output_clean` as its data source, and "38 tests pass" is not reproducible from a clone.
- Footnotes: one stray pre-configure WS message (81 928 B) leaks into every run's `ws.bytes/messages` (0.18 % over-count); `presentation` is null for the 163 E0/E1 runs (field added later).

---

## 6. Suggested order

1. §5 commit (minutes). 2. §2 instrumentation (1 day), tests green. 3. Overnight: §1.1–1.10, 1.12. 4. iGPU session §1.11 (restore registry after). 5. §3 plots/tables while §4.1 diff runs (not overlapping a benchmark). 6. Write.
