# Voxel — Diploma Project Context

Read this first. It exists so any future session starts with full context.

## What this project is

**Diploma thesis:** render *all of Slovenia* in voxels at once (no render-distance limit)
from the national LiDAR survey, in the browser via **WebGPU**, and measure which
optimization tactics work best, are simplest, and compose well — as a practical guide for
future voxel-engine developers. A second research aim: efficient chunk streaming over the
network — the raw dataset is ~5 TB, the compressed `.hmap` dataset ~70 GB; LOD streaming
means a viewer downloads only a tiny fraction of that.

**Deadline: a few weeks from 2026-07-31.** Deliverables: the code, and (more important)
the written thesis with FPS/scale/bandwidth measurements. **No major new implementations
or overhauls** — finish, measure, document.

Current phase: building an automated benchmark harness (see
`docs/superpowers/specs/2026-07-31-benchmark-harness-design.md`), then overnight
measurement sweeps, then figures + text data for the thesis.

## Architecture

```
E:/gkot/*.laz  (14,731 GKOT LiDAR tiles, ~5 TB raw)
   │  python/convert_missing_chunks.py, laz_converter.py
   ▼
public/map/100/{x}_{z}.hmap      base chunks, 1000×1000 px, 5 B/px (RGB u8 + height u16 LE), ~68.6 GB
   │  python/build_quad_tree.py  (base-level cleaning: water_fill.py + artifact_filter.py, in-memory only)
   ▼
public/map/lod_output/{lod}/{x}_{z}.hmap        complete pyramid, LOD 1–9, unfiltered, ~70 GB  ← currently served
public/map/lod_output_clean/...                 cleaned pyramid, REBUILD IN PROGRESS (2026-07-31)
   │  server.py (Flask): HTTP /get_chunk/... AND WebSocket /ws/chunks (request-id correlated, thread pool)
   ▼
public/ (WebGPU client)
   main.js → game-manager.js → renderer.js (~1000 lines, all pipelines)
                             → chunk-manager.js → chunk-quad-strategy.js | chunk-radius-strategy.js
                             → chunk-mesher.js → hmap-loader.js → chunk-websocket.js
   ui-manager.js drives everything via DOM CustomEvents (see below)
```

- LOD n chunk covers `2^(9-n)` km squares; LOD 9 = base 1 km chunks. For `lod > 1`
  chunks are **deltas**: TL quadrant is stitched from the parent client-side.
- Quadtree subdivision streams children by distance, throttled by
  `maximumChunksLoading = 1` in `chunk-quad-strategy.js`.
- Server chunk pyramid selection: `ChunkManager(lod_dir=...)` in `python/chunk_manager.py`.

## Run

- Server: `venv\Scripts\python server.py` (port 8000, serves `public/` statically).
- Client: `http://localhost:8000`, Chrome (WebGPU). Escape toggles UI.
- Python tests: `venv\Scripts\python -m pytest python/tests/`.

## Live settings (all driven by DOM CustomEvents — a benchmark can dispatch these directly)

| Setting | Event | Values |
|---|---|---|
| Render type | `render-type-changed` | mesh, cubes, planes, greedy, raycast, hybrid |
| Chunk strategy | `chunk-strategy-changed` | quad, radius |
| Chunk size | `chunk-size-changed` | 2–1000 (divisors of 1000 make sense) |
| View distance | `view-distance-changed` | 0–200 000 |
| LOD limits | `lod-limits-changed` | [min, max] 0–9 |
| FX | `fx-toggled` | bool |
| Manual culling | `culling-toggled` | bool (planes only) |
| Transport | `socket-toggled` | WebSocket vs HTTP RPC |
| Teleport | `command-input-entered` | city name or coords |

## Known quirks and traps (verified, don't rediscover)

- **UI initial state lies.** `renderer.js` defaults: `renderType="hybrid"`,
  `viewDistance=Infinity`, `useFX=true` — but the HTML shows "Mesh" selected, FX off,
  sliders at minimum. Set every parameter explicitly; never trust defaults.
- **404 chunks stay `isLoading=true` forever** (`chunk-quad-strategy.js` 404 path never
  clears it). Border regions render at parent LOD though real siblings loaded; "nothing
  loading" is never true map-wide. Fix planned in benchmark spec.
- **`howManyChunksLoading` is reset to 0 while loads are in flight** on player chunk
  change; unreliable during movement.
- **FPS counter used mean(1/dt)** — overstates FPS, hides stutter (fix planned; report
  frame times p50/p95/p99 + 1% lows instead).
- Changing render type also force-disables culling (`ui-manager.js`); "mesh" destroys all
  chunks. One config per page load for measurements.
- Small chunk sizes explode: quad strategy creates `(1000/chunkSize)²` base chunks,
  awaited serially.
- **Odd chunk sizes crash.** Delta chunks (`lod > 1`) stitch in 2×2 quadrants, so sizes
  must be **even** — that is the only hard constraint. The UI floors to even
  (`game-manager.js:45`); anything bypassing the UI must enforce this itself.
  Sizes need not divide 1000: the server composes chunks across `.hmap` tile
  boundaries generically; non-divisors just overhang the data grid at edges.
- A height of exactly 0 is indistinguishable from nodata (format limitation; matters at
  the coast). Coverage gaps still render as pits (client mesher fix out of scope).
- Display: laptop panel 2560×1600@165Hz driven by Intel Iris Xe; RTX 3070 Ti renders via
  Optimus (Win32 queries show a phantom 1080p60 mode on it). Parsec is installed —
  **must not be running during benchmarks**; benchmarks need vsync disabled via Chrome
  flags or FPS clamps at 165.
- `python -m` from repo root: modules import as `python.xxx`.

## Data rules

- **Never overwrite generated map output** — regenerate into a new folder, keep the old
  pyramid for rollback (`lod_dir` param exists for this).
- `public/map/100/` is the raw source of truth; base-level cleaning happens in memory
  during pyramid build, deliberately not persisted.
- Benchmarks and pyramid rebuilds must not run concurrently (CPU/disk contention
  invalidates measurements).

## History / prior specs

- `docs/superpowers/specs/2026-07-20-terrain-preprocessing-design.md` — water fill,
  artifact (powerline/pillar) removal, missing-chunk conversion. Implemented; measured
  results inside. The clean pyramid rebuild from it is what's running now.
- `.agents/agents.md` — older optimization brainstorm (VTF, greedy meshing, indirect
  draws); partially implemented in current render types.
