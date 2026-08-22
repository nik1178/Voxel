# Running the benchmarks

Everything runs from the repo root (`D:\DProjects\Voxel\server`) with the venv python.
One command per campaign; each is **checkpointed and safely re-runnable** — after any
crash, power-off, or Ctrl+C, rerun the identical command and it skips finished runs.

## Before ANY measured campaign (the checklist that keeps results valid)

1. **Machine idle.** Close everything nonessential — browsers, IDE hogs, downloads.
   Parsec must NOT be running. No pyramid rebuild (the driver refuses to start if
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
*   **E3: Level of Detail (LOD) Sweep:** Uses the E1 winner and tests how aggressive Level of Detail simplification impacts performance (varying `lodMax`).
*   **E4: Transport Protocol:** Tests networking overhead by comparing WebSocket (`sockets=True`) vs standard HTTP requests (`sockets=False`).
*   **E5: Ablation Studies:** Isolates specific features by turning them on and off (e.g., visual effects (`fx`), frustum culling) to measure their individual performance cost.

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
```

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
git add bench/results bench/results-full-sweep bench/figures bench/figures-full-sweep
git commit -m "data: E1 campaign results"
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
- **E3 caveat (2026-08-22):** every `lodMax` cell between 2 and 7 failed to quiesce.
  Their scene is frozen at the root nodes (identical chunk/instance counts) while the
  quad strategy re-requests 2-3.9 GB of chunks it never keeps — 182-897 requests per
  resident chunk, against 1.3 for a healthy `lodMax=9`. Only lodMax 1, 8 and 9 are
  usable; the FPS spread across 2-7 is loading churn, not LOD detail. Suspected cause:
  subdivide/destroy oscillation in `chunk-quad-strategy.js:143-160`.
- Tests: `venv\Scripts\python -m pytest bench/tests python/tests -q`.
