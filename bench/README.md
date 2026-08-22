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
*   **E3: Level of Detail (LOD) Sweep:** Uses the E1 winner. Two sweeps that meet at the default `0-9` cell: `0-X` caps the detail *near the player* (`lodMax`), `X-9` keeps full detail near the player and forbids the *far field* from getting coarser than X (`lodMin`) — i.e. "what if quality didn't fall off with distance". `9-9` is the no-LOD extreme. Read left to right, quality only ever goes up.
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
- Tests: `venv\Scripts\python -m pytest bench/tests python/tests -q`.

## E3 must be re-run (the committed E3 data is invalid)

The E3 in `bench/results-full-sweep/` was measured before the quad strategy was fixed
on 2026-08-22: every `lodMax` cell from 2 to 7 failed to quiesce, sitting frozen on its
64 base chunks while re-requesting 2.0-3.9 GB of chunks it never kept. Only lodMax 1, 8
and 9 in that data are meaningful. The `X-9` lodMin sweep (7 new cells) was added
afterwards and has never run; `--redo E3` covers both (17 cells, budget ~1.5 h). At
chunkSize 128 a LOD-n chunk is 128·2^(9−n) m, so `6-9` already means a 1 km far field —
~20 000 chunks. Smoke-tested: `6-9` crashes the tab (heap) at ~590 s and `8-9` is still
loading at 900 s with 12 000 chunks resident; `6-9`…`9-9` are kept with the 900 s timeout
because that wall IS the finding. The informative cells are `2-9`…`5-9`.

```powershell
# --redo overwrites the stale E3 results in place; the checkpoint would otherwise skip them.
venv\Scripts\python -m bench.driver --redo E3 --results-dir bench/results-full-sweep
venv\Scripts\python -m bench.plot --results-dir bench/results-full-sweep --figures-dir bench/figures-full-sweep
```

E1, E2, E4 and E5 all ran at `lodMax=9`, where both fixes are inert, so they do NOT need
re-running. The falloff change is inert there by substitution (`PYRAMID_DEPTH` *is*
`lodMaxBound` when the bound is 9). The collapse guard is inert because no family is ever
destroyed at birth at `lodMax=9` — checked live at chunkSize 1000, 128 and 16, i.e. both
ends and the middle of the E2 sweep, `destroy = 0` in every case. The 128 replay is exact:
544 resident chunks / 705 WebSocket messages / 44.7 MB, identical before and after.
