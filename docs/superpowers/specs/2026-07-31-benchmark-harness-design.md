# Automated Benchmark Harness for the Thesis Measurements

Date: 2026-07-31
Status: Approved (design)

## Purpose

Produce the measurement chapters of the diploma: which rendering tactics perform best,
how chunk size affects FPS and load time, evidence that LODs are load-bearing, WebSocket
vs HTTP transport, and the bandwidth story (a full-Slovenia view downloads only a small
fraction of the 70 GB dataset). Everything scripted and reproducible — "anyone can
measure FPS locally" is itself a thesis claim, so the harness is a thesis artifact.

Constraints: weeks to deadline, no major overhauls. Machine: RTX 3070 Ti Laptop via
Optimus, panel 2560×1600@165Hz. Overnight unattended runs allowed; **runs must be
resumable after a crash/power-off**. The clean-pyramid rebuild currently running must
finish or be stopped before any measurement run.

## Data policy

- **JSON per run is the source of truth.** Figures and tables are derived, regenerated
  at will, and never trigger re-measurement.
- Every figure gets a text twin (CSV) next to it.
- Every result row carries full provenance: config, hardware, resolution, refresh
  handling, git commit, pyramid served, timestamp.

## Architecture

Three pieces plus a small set of pre-fixes.

### Piece 1: `public/bench-api.js` — in-page API (`window.__bench`)

Loaded always (it is inert without a driver). Drives the app through the *existing*
CustomEvent plumbing; no parallel control path.

- `configure(cfg)` — dispatches events to set **every** parameter explicitly: render
  type, strategy, chunk size, view distance, LOD bounds, FX, culling, transport.
  Required because renderer defaults and UI initial state disagree.
- `teleport({x, y, z, pitch, yaw})` — sets camera transform directly. New capability:
  the command-input path hard-forces pitch to straight-down
  (`game-manager.js:27`), which blocks the horizon/up/down comparison.
- `waitForQuiescence({timeoutMs})` — resolves when 20 consecutive `updateChunks` passes
  queue zero loads and destroy zero nodes (constant, tunable in one place). Deliberately **not** based on
  `isLoading`/`howManyChunksLoading` (see bugs below); the counter is only a logged
  sanity cross-check. Timeout returns `{quiesced: false}` rather than throwing — a
  non-quiescing config is a *result* (E2 small sizes, E3 no-LOD).
- `record({warmupMs, durationMs})` — returns raw per-frame `dt` array (post-warmup),
  GPU timestamp-query pass durations when available, and scale counters sampled at
  start/end.
- `getCounters()` — resident chunk count, GPU buffer bytes, instance/triangle count,
  draw calls per frame, JS heap size, bytes transferred + chunk requests
  (via PerformanceObserver for HTTP; a byte counter added in `chunk-websocket.js` for WS).
- `snapshot(name)` — canvas screenshot hook for thesis figures (driver saves the PNG).

### Piece 2: `bench/driver.py` — Playwright driver (Python, sync API)

- Launches headed Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`, fixed
  window size, `deviceScaleFactor` pinned; asserts the canvas backing-store size and
  records it. Ensures the discrete GPU path (verify via `chrome://gpu` once, record
  adapter info from `navigator.gpu` in every run).
- Starts/owns the Flask server per session; verifies which pyramid (`lod_dir`) is served
  and records it.
- **One config per fresh page load.** Live toggling contaminates state
  (`ui-manager.js` side effects; "mesh" destroys chunks).
- Per run: load page → `configure` → `teleport` → `waitForQuiescence` → `record` →
  write `bench/results/<run_id>.json` → append line to `bench/results/manifest.jsonl`.
- **Checkpointing:** run IDs are a deterministic hash of the config. On startup the
  driver enumerates the experiment matrix, skips any ID whose result JSON already
  exists, and continues. A killed/interrupted sweep loses at most the in-flight run.
  `--redo <id|experiment>` forces re-measurement. Repeats are distinct runs
  (`...-r0`, `-r1`, …), so partial repeat sets also resume correctly.
- Sanity guard before a sweep: refuse to start if a `build_quad_tree.py` process is
  running (prevents accidental concurrent rebuild).

### Piece 3: `bench/plot.py` — figures + report

Reads `bench/results/*.json` only. Emits per-experiment: PNG/SVG figures, the same
aggregates as CSV, and a Markdown report section (tables + one-line stat summaries)
ready to adapt into the thesis. Aggregation: median across repeats, min–max as error
band. Metrics derived from raw frames: mean FPS = N/Σdt, p50/p95/p99 frame time, 1% low.

## Pre-fixes (measurement-invalidating only — nothing else gets touched)

1. **FPS math** (`game-manager.js:83`): replace mean(1/dt) with N/Σdt for the on-screen
   counter; harness uses raw frame times regardless.
2. **404 leaves `isLoading` forever** (`chunk-quad-strategy.js:163`): set
   `node.is404 = true`, clear `isLoading`; render walk treats 404 nodes as done;
   subdivision loop skips them (no re-request, no descent into 404 subtrees). Fixes
   border regions rendering at parent LOD while loaded siblings sit unused in GPU
   memory, and makes quiescence observable.
3. **Canvas backing store pinned** and recorded (`main.js` sizing ×
   `devicePixelRatio` handling made explicit).
4. **Initial UI ↔ renderer state sync**: on load, dispatch the full config once so the
   HTML controls and renderer agree (also fixes the user-facing lie).
5. **Warmup discard** built into `record()`; first-frame `dt` artifact
   (`lastTime = 0`) excluded by the same mechanism.

Known-but-not-fixed (documented, benchmarks unaffected because camera is static):
`howManyChunksLoading` reset-while-in-flight on player chunk change.

## Experiments

Locations (via existing city coordinates + manual picks): **Ljubljana** (urban basin),
**Triglav/Julian Alps** (extreme relief), **NE plain** (flat farmland, far corner —
max diagonal distance for the raycast long-view question).

- **E0 — Pilot.** One run: best-guess config, measure time-to-quiescence, bytes,
  counters. **Gates the matrix size**; if quiescence is minutes-long, cut locations or
  repeats before the night runs. Also validates the harness end-to-end.
- **E1 — Render tactic shootout.** 6 render types × 3 pitches (horizon / straight down /
  straight up) × 3 locations × 3 repeats = 162 runs (pruned per E0). Quad strategy,
  full view distance, LOD auto. Output: the thesis's headline comparison.
- **E2 — Chunk size sweep.** Best tactic from E1, chunk size over the **even divisors
  of 1000**: 1000, 500, 250, 200, 100, 50, 40, 20, 10 — a near-log scale. Divisors only,
  so chunks tile the 1000 px base grid; even only, because delta chunks (`lod > 1`)
  stitch in 2×2 quadrants and odd sizes crash (the UI silently floors to even at
  `game-manager.js:45`; the bench API bypasses the UI, so it must enforce evenness
  itself). Sizes 8, 4, 2 are additionally attempted under a hard per-run timeout,
  expected to fail by design (`(1000/size)²` serial base loads = 15.6k/62.5k/250k).
  Output: FPS vs size and time-to-quiescence vs size curves.
- **E3 — LODs are load-bearing.** lodMax swept 9→1, plus the no-LOD extreme (force base
  LOD everywhere within view distance). If a config OOMs / device-losts / times out,
  the harness records the failure mode and the counters at death — that *is* the
  result backing "without LODs nothing can be done".
- **E4 — Transport.** WebSocket vs HTTP RPC × 2 locations × 3 repeats, cold page each:
  time-to-first-chunk, time-to-quiescence, total bytes, request count. Plus the
  headline bandwidth figure: bytes-to-quiescence vs 70 GB dataset size.
- **E5 — Ablations.** At E1's winner: FX on/off, manual culling on/off (planes),
  strategy quad vs radius. Cheap adds, each a thesis paragraph.

## Verification

- Harness self-check: two consecutive runs of the identical config must agree within a
  stated tolerance (report the spread as measurement noise in the thesis).
- E0 reviewed by hand (screenshot + numbers) before any overnight sweep.
- Spot-check one E1 cell against a manually observed run.

## Risks / limits

- GPU `timestamp-query` may be unavailable in the browser; wall-clock frame times with
  vsync disabled are the fallback primary metric (recorded either way).
- Thermal drift on a laptop across an overnight sweep: matrix order is shuffled
  deterministically (seeded) so drift doesn't correlate with any one factor; repeats are
  spread across the sweep, not consecutive.
- Radius strategy and "mesh" render type may interact badly (mesh reload path); if a
  cell is broken beyond a quick fix, it is reported as "not functional" rather than
  fixed — no overhauls.
- Small-chunk E2 cells and no-LOD E3 cells are expected to fail; timeouts cap their
  cost. Failure records are first-class results.
