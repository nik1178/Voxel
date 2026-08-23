# Running the benchmarks

Everything runs from the repo root (`D:\DProjects\Voxel\server`) with the venv python.
One command per campaign; each is **checkpointed and safely re-runnable** — after any
crash, power-off, or Ctrl+C, rerun the identical command and it skips finished runs.

## Before ANY measured campaign (the checklist that keeps results valid)

1. **Machine idle.** Close everything nonessential — browsers, IDE hogs, downloads.
   Parsec must NOT be running. Check Task Manager for **Windows Defender mid-scan**
   (`MsMpEng.exe` at >100 % CPU) — seen 2026-08-23 during a smoke run, it halves FPS and
   triples server per-request time; wait for it to finish or start the campaign later. No pyramid rebuild (the driver refuses to start if
   `build_quad_tree` is running — do not override with `--allow-rebuild`, that flag is
   for plumbing tests only).
2. **Don't start the server yourself.** The driver starts and owns its own clean server.
3. **Plugged in / performance power profile** (laptop on battery throttles).
4. After the first run of a campaign, sanity-check the GPU in any fresh result JSON in
   `bench/results/`: `"provenance" → "adapterInfo" → "vendor"` must be `"nvidia"`.
   If it says `"intel"`, the Playwright Chromium lost its GPU registry entry (happens
   after a Playwright update) — re-add `GpuPreference=2;` for
   `C:\Users\jenic\AppData\Local\ms-playwright\chromium-<ver>\chrome-win64\chrome.exe`
   under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, delete the bad JSONs,
   rerun.

A Chrome window opens and closes once per run — that's normal. Don't touch it.

## The Campaigns (Experiments)

The benchmark is divided into 5 "Campaigns" (E1 through E5). Each campaign isolates a specific variable to measure its impact on performance. 

*   **E1: Render-Tactic Shootout:** Compares the raw performance of all rendering implementations (greedy, planes, cubes, hybrid, raycast) across different camera views. This is used to determine the "winning" implementation that will be tested in subsequent campaigns.
*   **E2: Chunk-Size Sweep:** Fixes the render implementation to the winner of E1 and tests how it scales across different chunk sizes (e.g., 32, 64, 128, 256). 
*   **E3: Level of Detail (LOD) Sweep:** Uses the E1 winner. Two sweeps that meet at the default `0-9` cell: `0-X` caps the detail *near the player* (`lodMax`), `X-9` keeps full detail near the player and forbids the *far field* from getting coarser than X (`lodMin`) — i.e. "what if quality didn't fall off with distance". `9-9` is the no-LOD extreme. Read left to right, quality only ever goes up.
*   **E4: Transport Protocol:** Tests networking overhead by comparing WebSocket (`sockets=True`) vs standard HTTP requests (`sockets=False`).
*   **E5: Ablation Studies:** Isolates specific features by turning them on and off (e.g., visual effects (`fx`), frustum culling) to measure their individual performance cost.

### The gap campaign (E6–E14, added 2026-08-23)

Each experiment answers one question; its `bench.plot` section opens with a "what this
shows / how to read it" paragraph. Spec: `docs/superpowers/specs/2026-08-23-gap-campaign-design.md`.

| Exp | Question | Cells | Figure |
|---|---|---|---|
| E2 +reps | is the chunk-size peak real? | sizes 100–300 × r1, r2 | `E2_chunksize_*` error bars |
| E5 +reps | are fx −5 % and vd +10.8 % real? | fx on/off, quad vd 50 km × r1, r2 | `E5_ablations_fps` |
| **E6** | does the chunk-size optimum move with render type? | greedy/raycast × {64…512}, mesh × {128…512} | `E6_chunksize_by_type` |
| **E7** | does fx compose with every tactic? | 5 types × fx off/on | `E7_fx_by_type` |
| **E8** | quality evidence — where hybrid's near field fills the frame | `ljubljana_low` view × {hybrid, raycast, greedy} ×2 + 6 E1-view screenshots | `E8_quality_grid` |
| **E9** | do greedy + raycast compose? | `hybridNear ∈ {9,25,81,225,all}` × 2 views ×2 | `E9_hybrid_near` |
| **E10** | CPU- vs GPU-bound | 6 types × {720p, 1080p, 1440p} | `E10_resolution` |
| **E11** | radius vs quad where radius converges | both × vd {1, 2, 5 km} | `E11_radius_vs_quad` |
| **E12** | throttle- or server-bound loading? | `maxLoading {1,2,4,8}` WS, {1,4} HTTP | `E12_max_loading` |
| **E13** | per-LOD residency backfill | hybrid × 3 locations | `E13_by_lod` |
| **E14** | does the ranking hold on the iGPU? | 6 types × 2 views ×2, **separate session** | `E14_igpu` |
| E4 redo | honest WS vs HTTP after the 308-redirect fix | the 6 HTTP cells (pending again) | `E4_transport_*` |

New config keys (`hybridNear`, `maxLoading`, `viewport`) exist only in these cells — their
JS defaults equal the old hard-coded behaviour, so every E0–E5 run id is unchanged
(`test_existing_run_ids_unchanged` pins this against the files on disk).

### Running the campaigns, in order

The driver disables vsync and Chromium's frame-rate limit by default — that is the
measured configuration (see "Vsync" below). E0/E1 land in the default `bench/results/`;
E2-E5 were run into `bench/results-full-sweep/` to keep the long sweeps separable.

```powershell
# 1) E1 — render-tactic shootout. 162 runs, ≈4 h. Run overnight.
venv\Scripts\python -m bench.driver --experiments E1

# 2) Set the "Winner" implementation to measure further:
#    Open `bench/matrix.py` and change `E2_RENDER_TYPE` (e.g., to "hybrid").
#    E2, E3, E4, and E5 will all use this implementation for their tests!

# 3) E2 pre-smoke — validates every chunk size loads, throwaway results into a
#    scratch dir. Review results-smoke/manifest.jsonl for errors, then delete the dir.
venv\Scripts\python -m bench.driver --experiments E2 --record-ms 2000 --warmup-ms 1000 --results-dir bench/results-smoke

# 4) E2 + E3 — chunk-size sweep + LOD sweep. Overnight. (E2's tiny sizes and E3's
#    no-LOD run are EXPECTED to time out or kill the GPU device — that failure is
#    recorded as a result, not a crash. Long timeouts are budgeted in.)
venv\Scripts\python -m bench.driver --experiments E2,E3 --results-dir bench/results-full-sweep

# 5) E4 + E5 — transport + ablations. Short (~40 min).
venv\Scripts\python -m bench.driver --experiments E4,E5 --results-dir bench/results-full-sweep

# 6) Figures + CSVs + report from the result JSONs (never re-runs anything, safe anytime,
#    also works mid-campaign on partial results). One figures dir per results dir:
venv\Scripts\python -m bench.plot
venv\Scripts\python -m bench.plot --results-dir bench/results-full-sweep --figures-dir bench/figures-full-sweep

# 7) Gap campaign (2026-08-23): ONE overnight, ~4-5 h. Checkpointed; rerun the same line
#    after any interruption. `overnight` = E2/E5 extra repeats + E6-E13; E4 re-runs its
#    6 HTTP cells (the pre-fix ones live in bench/results-e4-before-slash-fix/).
venv\Scripts\python -m bench.driver --experiments overnight,E4 --results-dir bench/results-full-sweep

# 8) iGPU session (~1 h, any day). Set the Playwright Chromium GpuPreference value to 1;
#    (or delete it) in HKCU\Software\Microsoft\DirectX\UserGpuPreferences, then:
venv\Scripts\python -m bench.driver --experiments igpu --results-dir bench/results-igpu --expect-gpu intel
#    ...and set it back to 2; afterwards. The driver aborts on the FIRST run if the vendor
#    is wrong (nothing is written), so a forgotten flip costs one run, not a session.

# 9) Figures. Load BOTH results dirs so cross-experiment baselines are there (E1 medians for
#    the multi-metric table and E14, the hybrid E2 curve for E6). The full-sweep figures dir
#    is then the complete report; the iGPU dir gets its own with E1 as the RTX reference.
venv\Scripts\python -m bench.plot --results-dir bench/results-full-sweep bench/results --figures-dir bench/figures-full-sweep
venv\Scripts\python -m bench.plot --results-dir bench/results-igpu bench/results --figures-dir bench/figures-igpu
venv\Scripts\python -m bench.loc   # the "simplest" axis table (also in report.md)
```

## Reading the results

- `<figures-dir>/report.md` is the index: one section per experiment, each opening with
  what the figure shows and how to read it, followed by the zero-run sections (E1
  multi-metric table, GPU-vs-wall frame time, frame pacing, pitch invariance, E2
  bandwidth, load curves, noise band, LOC table). Every PNG has a CSV twin.
- Fields only present in runs made after 2026-08-23: `js_summary` (JS `render()` ms per
  frame), `raw.jsFrameTimesMs`, `raw.loadCurve` (200 ms samples of bytes/chunks/heap to
  quiescence), `counters_*.byLod` / `emptyChunks` / `meshStats` (parse/stitch/mesh/upload
  CPU ms), `counters_*.net.http.phases` (redirect/connect/ttfb/download p50/p95),
  `server_stats` (server-side per-request ms from `/bench_stats`), `git_dirty`.
  Older results still plot; those panels just show less.
- `meshStats.meshMs` counts greedy meshing for EVERY non-mesh type (~5 s CPU per view at
  chunkSize 128) — the client meshes even when raycast never uses it. Disclose, don't fix.

## Vsync: why the thesis numbers are uncapped

The default flags (`--disable-gpu-vsync --disable-frame-rate-limit`) are what makes the
fast tactics measurable at all. With pacing on, **71 of 162 E1 runs sit at exactly
165.00 FPS** — the panel refresh rate — so mesh, hybrid and raycast become
indistinguishable. Below the cap the two campaigns agree closely: across the 87 cells
where both stay under 160 FPS the paced run is 0.1-5% slower (one raycast outlier at
8.7%). See `bench/vsync_comparison.md`.

So: uncapped is the measurement; the paced campaign is kept only as that sanity check.

```powershell
# The paced comparison campaign (not the thesis numbers):
venv\Scripts\python -m bench.driver --experiments E1 --vsync --results-dir bench/results-vsync
venv\Scripts\python -m bench.plot --results-dir bench/results-vsync --figures-dir bench/figures-vsync
```

Never put runs with different `presentation` values in one figure.

## After each campaign

Commit the data — it IS the thesis:

```powershell
git add bench/results bench/results-full-sweep bench/results-igpu bench/figures bench/figures-full-sweep bench/figures-igpu
git commit -m "data: <campaign> results"
```

## Odds and ends

- `--screenshots` adds a PNG per run to `<results-dir>/shots/` (nice for the thesis,
  slightly slower). E0's baseline was run with it. `venv\Scripts\python -m bench.inspect`
  opens the same browser/flags/config interactively to eyeball what a view actually shows.
- `--redo E1` (or `--redo <run_id>`) forces re-running something already checkpointed —
  use after fixing a problem, never mid-campaign.
- Results live in the selected `--results-dir/<run_id>.json` (source of truth, raw
  frame times included); `manifest.jsonl` is just a progress log. Each result records
  whether vsync and the Chromium frame-rate limit were enabled under `presentation`,
  and `resolved_view` records the literal pose (run ids hash only the view *name*).
  Figures/CSVs are derived — regenerate freely with `bench.plot`.
- Tests: `venv\Scripts\python -m pytest bench/tests python/tests -q`.

## E3 was re-run 2026-08-23 (the current E3 data is valid)

The first E3 was measured before the quad strategy was fixed on 2026-08-22 (every
`lodMax` cell from 2 to 7 sat frozen on its 64 base chunks re-requesting chunks it never
kept). `--redo E3` re-ran all 17 cells on 2026-08-23 05:26–06:42 (rev e35ddfe); that is
what `bench/results-full-sweep/E3-*` holds now. At chunkSize 128 a LOD-n chunk is
128·2^(9−n) m, so `6-9` already means a 1 km far field — ~20 000 chunks: `6-9`…`9-9` do
not quiesce within 900 s and are kept because that wall IS the finding. The informative
cells are `0-1`…`0-9` and `2-9`…`5-9`.

E1, E2, E4 and E5 all ran at `lodMax=9`, where both fixes are inert, so they do NOT need
re-running. The falloff change is inert there by substitution (`PYRAMID_DEPTH` *is*
`lodMaxBound` when the bound is 9). The collapse guard is inert because no family is ever
destroyed at birth at `lodMax=9` — checked live at chunkSize 1000, 128 and 16, i.e. both
ends and the middle of the E2 sweep, `destroy = 0` in every case. The 128 replay is exact:
544 resident chunks / 705 WebSocket messages / 44.7 MB, identical before and after.
