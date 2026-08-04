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

## The campaigns, in order

```powershell
# 1) E1 — render-tactic shootout. 162 runs, ≈4 h. Run overnight.
venv\Scripts\python -m bench.driver --experiments E1

# 2) Review E1, then set the winner: edit E2_RENDER_TYPE in bench/matrix.py
#    (one line; E2–E5 run ids depend on it — that is intentional).

# 3) E2 pre-smoke — validates every chunk size loads, throwaway results into a
#    scratch dir. Review results-smoke/manifest.jsonl for errors, then delete the dir.
venv\Scripts\python -m bench.driver --experiments E2 --record-ms 2000 --warmup-ms 1000 --results-dir bench/results-smoke

# 4) E2 + E3 — chunk-size sweep + LOD sweep. Overnight. (E2's tiny sizes and E3's
#    no-LOD run are EXPECTED to time out or kill the GPU device — that failure is
#    recorded as a result, not a crash. Long timeouts are budgeted in.)
venv\Scripts\python -m bench.driver --experiments E2,E3

# 5) E4 + E5 — transport + ablations. Short (~40 min).
venv\Scripts\python -m bench.driver --experiments E4,E5

# 6) Figures + CSVs + report from the result JSONs (never re-runs anything, safe anytime,
#    also works mid-campaign on partial results):
venv\Scripts\python -m bench.plot
```

## After each campaign

Commit the data — it IS the thesis:

```powershell
git add bench/results bench/figures
git commit -m "data: E1 campaign results"
```

## Odds and ends

- `--screenshots` adds a PNG per run to `bench/results/shots/` (nice for the thesis,
  slightly slower). E0's baseline was run with it.
- `--redo E1` (or `--redo <run_id>`) forces re-running something already checkpointed —
  use after fixing a problem, never mid-campaign.
- Results live in `bench/results/<run_id>.json` (source of truth, raw frame times
  included); `manifest.jsonl` is just a progress log. Figures/CSVs in `bench/figures/`
  are derived — regenerate freely with `bench.plot`.
- Tests: `venv\Scripts\python -m pytest bench/tests python/tests -q` (35 should pass).
