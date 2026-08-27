# Gap Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the instrumentation, experiments E6–E14, driver flags and plots that close the measurement gaps listed in the 2026-08-22 gap plan, runnable as one overnight command and one iGPU command, with a figure + CSV + report section per experiment.

**Architecture:** The existing harness stays as is: `bench/matrix.py` enumerates `Run`s with sha1 ids, `bench/driver.py` runs one config per fresh Playwright Chromium against `public/bench-api.js`, `bench/plot.py` derives figures from result JSONs. We extend each layer: new config knobs with JS defaults equal to today's behaviour, new counters in `getCounters()`/`waitForQuiescence()`/`record()`, new experiment builders, a per-experiment plot function, and a `/bench_stats` server endpoint.

**Tech Stack:** Python 3 (Flask, Playwright, matplotlib, pytest) in `venv\Scripts\python`; vanilla ES-module JS (WebGPU client, no bundler, no JS test runner — JS is checked with `node --check` and a driver smoke run).

**Spec:** `docs/superpowers/specs/2026-08-23-gap-campaign-design.md` (decisions) and `docs/superpowers/specs/2026-08-22-measurement-gap-plan.md` (rationale, §numbers referenced below).

## Global Constraints

- **Every existing `run_id` must stay byte-identical.** Never add a key to `BASE_CONFIG`. New keys (`hybridNear`, `maxLoading`, `viewport`) go only into new cells' config dicts. Task 1 pins this with a test against real result files.
- Chunk sizes must be even (delta stitching) — reuse existing `test_all_chunk_sizes_even`.
- Radius strategy needs a finite `viewDistance` (`configure` throws otherwise).
- Result JSON schema is extended only; `bench.plot` must tolerate old results that lack the new fields (use `.get` with defaults everywhere).
- Run everything from repo root `D:\DProjects\Voxel\server` with `venv\Scripts\python`. Tests: `venv\Scripts\python -m pytest bench/tests/ -q`.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never run the driver while `build_quad_tree.py` is running; the driver refuses anyway.
- Do not change what any render type draws; the only client behaviour change is the trailing slash on the HTTP chunk URL.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `bench/matrix.py` | knobs' *documentation* (defaults live in JS), new view `ljubljana_low`, builders `_e6`..`_e14`, `GROUPS` aliases, `Run.screenshot` |
| `bench/driver.py` | per-run viewport, `--expect-gpu`, `server_stats` fetch, `js_summary`, `raw.loadCurve`, `raw.jsFrameTimesMs`, `git_dirty`, per-run screenshots |
| `bench/stats.py` | unchanged (`aggregate` reused for JS frame times) |
| `bench/plot.py` | `load_results` over several dirs; `_plot_e6`..`_plot_e14`; zero-run figures (`_plot_e1_multimetric`, `_plot_gpu_vs_wall`, `_plot_pacing`, `_plot_pitch_invariance`, `_plot_e2_bandwidth`, `_plot_load_curves`, `_plot_noise`) |
| `bench/loc.py` | new: lines-of-code table per render tactic (the "simplest" axis) |
| `bench/README.md` | new experiments table, the two campaign commands, iGPU registry recipe, E4 redo recipe |
| `public/bench-api.js` | knobs in `configure`, load curve, per-LOD + empty + mesh + HTTP-phase counters, JS frame time capture |
| `public/renderer.js` | `hybridNearCount` knob (replaces hard-coded 9) |
| `public/chunk-quad-strategy.js` | `maximumChunksLoading` set from knob (already a field) |
| `public/chunk-websocket.js` | `netStats.byLod` |
| `public/hmap-loader.js` | trailing slash; parse timer; HTTP byLod |
| `public/chunk-mesher.js` | stitch / mesh timers |
| `public/game-manager.js` | JS render time per frame → `__bench.onRenderMs` |
| `server.py` | per-request timing + `/bench_stats` |
| `bench/tests/test_matrix.py`, `test_driver.py`, `test_plot.py` | new tests |

---

### Task 1: Matrix — new view, knobs, E6–E14, aliases, run-id pin

**Files:**
- Modify: `bench/matrix.py`
- Test: `bench/tests/test_matrix.py`

**Interfaces:**
- Produces: `Run.screenshot: bool` (default False); `LOCATIONS["ljubljana_low"]`; `GROUPS = {"overnight": [...], "igpu": ["E14"]}`; `build_matrix(experiments)` accepts group names; config keys `hybridNear` (int, 0 = all chunks), `maxLoading` (int), `viewport` ([w, h]) used by Tasks 2, 4.

- [ ] **Step 1: Write the failing tests**

Append to `bench/tests/test_matrix.py`:

```python
import glob
import os

from bench.matrix import GROUPS, LOCATIONS, E2_REPEAT_SIZES, E5_REPEAT_CELLS


def test_existing_run_ids_unchanged():
    """The sha1 ids on disk must be reproduced exactly by the current matrix
    (BASE_CONFIG gained no keys; E1-E5 cells untouched)."""
    on_disk = set()
    for d in ("bench/results", "bench/results-full-sweep"):
        on_disk.update(os.path.basename(p)[:-5]
                       for p in glob.glob(os.path.join(d, "E[0-5]-*.json")))
    assert len(on_disk) > 200, "expected the committed E0-E5 results on disk"
    enumerated = {r.run_id for r in build_matrix(["E0", "E1", "E2", "E3", "E4", "E5"])}
    missing = on_disk - enumerated
    assert not missing, f"matrix no longer enumerates {sorted(missing)[:5]}..."


def test_new_experiment_shapes():
    assert len(build_matrix(["E6"])) == 2 * 5 + 3          # greedy/raycast x5 sizes, mesh x3
    assert len(build_matrix(["E7"])) == 5 * 2              # 5 types x fx off/on
    e8 = build_matrix(["E8"])
    assert len(e8) == 3 * 2 + 6                            # low view x3 types x2 reps + 6 E1 types
    assert all(r.screenshot for r in e8)
    assert len(build_matrix(["E9"])) == 5 * 2 * 2          # hybridNear x 2 views x 2 reps
    e10 = build_matrix(["E10"])
    assert len(e10) == 6 * 3 + 3 * 2                       # 6 types x 3 viewports (+ r1 for 3 fast types at 720/1440)
    assert all(isinstance(r.config["viewport"], list) for r in e10)
    assert len(build_matrix(["E11"])) == 2 * 3
    assert len(build_matrix(["E12"])) == 4 + 2
    assert len(build_matrix(["E13"])) == 3
    assert len(build_matrix(["E14"])) == 6 * 2 * 2


def test_repeat_extensions_reuse_existing_ids():
    e2 = build_matrix(["E2"])
    for s in E2_REPEAT_SIZES:
        reps = sorted(r.repeat for r in e2 if r.config["chunkSize"] == s)
        assert reps == [0, 1, 2]
    e5 = build_matrix(["E5"])
    assert sum(1 for r in e5 if r.repeat > 0) == 2 * len(E5_REPEAT_CELLS)


def test_groups_expand():
    ov = build_matrix(["overnight"])
    assert {r.experiment for r in ov} == set(GROUPS["overnight"])
    assert {r.experiment for r in build_matrix(["igpu"])} == {"E14"}


def test_new_keys_only_in_new_cells():
    for r in build_matrix(["E0", "E1", "E2", "E3", "E4", "E5"]):
        for k in ("hybridNear", "maxLoading", "viewport"):
            assert k not in r.config


def test_ljubljana_low_view():
    assert LOCATIONS["ljubljana_low"]["y"] < LOCATIONS["ljubljana"]["y"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python -m pytest bench/tests/test_matrix.py -q`
Expected: ImportError on `GROUPS` / `E2_REPEAT_SIZES`.

- [ ] **Step 3: Implement in `bench/matrix.py`**

Add to `LOCATIONS` (after `"ne_plain"`):

```python
    # Low pass over Ljubljana: the only view where hybrid's greedy near field
    # (hybridNear chunks of 128 m) fills the frame. y is ~300 m above the basin
    # (~298 m a.s.l.). VERIFY BY EYE with bench.inspect / the E8 smoke screenshot.
    "ljubljana_low": {"latLng": [46.0489, 14.5086], "y": 600, "yaw": math.pi},
```

After `DEFAULT_VIEW` add the knob docs and new tables:

```python
LOW_VIEW = {"location": "ljubljana_low", "pitch": "horizon"}

# --- New-cell-only config keys (NEVER add these to BASE_CONFIG: it would
# change every existing run id). JS defaults == today's hard-coded behaviour:
#   hybridNear  int   renderer.js: how many nearest chunks hybrid draws greedy
#                     (default 9; 0 = all chunks, i.e. pure greedy via hybrid)
#   maxLoading  int   chunk-quad-strategy.js maximumChunksLoading (default 1)
#   viewport    [w,h] Playwright viewport (default 1920x1080)

E2_REPEAT_SIZES = [100, 128, 200, 256, 300]       # +r1,r2: is the peak real?
E6_SIZES = [64, 128, 200, 256, 512]
E6_MESH_SIZES = [128, 256, 512]                    # mesh @1000 would need ~10 GB
E7_TYPES = ["mesh", "cubes", "planes", "greedy", "raycast"]  # hybrid x fx is E5
E8_TYPES = ["hybrid", "raycast", "greedy"]
E9_HYBRID_NEAR = [9, 25, 81, 225, 0]               # 0 = all chunks greedy
E10_VIEWPORTS = [[1280, 720], [1920, 1080], [2560, 1440]]
E10_REPEAT_TYPES = ["raycast", "hybrid", "mesh"]   # noisy tactics get r1 at 720/1440
E11_VIEW_DISTANCES = [1000, 2000, 5000]
E12_MAX_LOADING_WS = [1, 2, 4, 8]
E12_MAX_LOADING_HTTP = [1, 4]
E14_LOCATIONS = ["ljubljana", "alps"]
E14_REPEATS = 2

GROUPS = {
    "overnight": ["E2", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E13"],
    "igpu": ["E14"],
}
```

Change the `Run` dataclass and `_mk`:

```python
@dataclass(frozen=True)
class Run:
    run_id: str
    experiment: str
    repeat: int
    config: dict
    view: dict
    screenshot: bool = False


def _mk(experiment, config, view, repeat=0, screenshot=False):
    return Run(run_id(experiment, config, view, repeat), experiment, repeat,
               config, view, screenshot)
```

Extend `_e2` (before `return runs`):

```python
    runs += [_mk("E2", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, chunkSize=s),
                 dict(DEFAULT_VIEW), rep)
             for s in E2_REPEAT_SIZES for rep in (1, 2)]
```

Rewrite `_e5` so the repeat cells are named:

```python
E5_REPEAT_CELLS = [  # configs whose E5 conclusion sat inside the noise band
    dict(fx=True), dict(fx=False),
    dict(strategy="quad", viewDistance=E5_RADIUS_VIEW_DISTANCE),
]


def _e5():
    base = dict(BASE_CONFIG, renderType=E2_RENDER_TYPE)
    runs = [
        _mk("E5", dict(base, fx=True), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, fx=False), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, renderType="planes", culling=True), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, renderType="planes", culling=False), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, strategy="radius",
                       viewDistance=E5_RADIUS_VIEW_DISTANCE), dict(DEFAULT_VIEW)),
        _mk("E5", dict(base, strategy="quad",
                       viewDistance=E5_RADIUS_VIEW_DISTANCE), dict(DEFAULT_VIEW)),
    ]
    runs += [_mk("E5", dict(base, **cell), dict(DEFAULT_VIEW), rep)
             for cell in E5_REPEAT_CELLS for rep in (1, 2)]
    return runs
```

(Keep the six original cells byte-identical — same dict contents, same order of keys does not matter because `run_id` sorts keys.)

Add the new builders after `_e5`:

```python
# E6: does the chunk-size optimum move with render type? E2 is hybrid-only;
# hybrid has the smallest per-chunk cost, so GPU-bound tactics may peak elsewhere.
def _e6():
    runs = [_mk("E6", dict(BASE_CONFIG, renderType=rt, chunkSize=s), dict(DEFAULT_VIEW))
            for rt in ("greedy", "raycast") for s in E6_SIZES]
    runs += [_mk("E6", dict(BASE_CONFIG, renderType="mesh", chunkSize=s), dict(DEFAULT_VIEW))
             for s in E6_MESH_SIZES]
    return runs


# E7: does fx compose with every tactic? fx is 4 extra full-screen passes, so
# its cost should be ~constant ms: huge for fast tactics, nil for slow ones.
def _e7():
    return [_mk("E7", dict(BASE_CONFIG, renderType=rt, fx=fx), dict(DEFAULT_VIEW))
            for rt in E7_TYPES for fx in (False, True)]


# E8: quality evidence. Screenshots of every tactic at the E1 view, and a low
# pass where hybrid's near field actually fills the frame.
def _e8():
    runs = [_mk("E8", dict(BASE_CONFIG, renderType=rt), dict(LOW_VIEW), rep, screenshot=True)
            for rt in E8_TYPES for rep in (0, 1)]
    runs += [_mk("E8", dict(BASE_CONFIG, renderType=rt), dict(DEFAULT_VIEW), screenshot=True)
             for rt in RENDER_TYPES]
    return runs


# E9: do greedy and raycast compose? Speed vs the near-detail knob.
def _e9():
    return [_mk("E9", dict(BASE_CONFIG, renderType="hybrid", hybridNear=n), dict(v), rep)
            for n in E9_HYBRID_NEAR for v in (DEFAULT_VIEW, LOW_VIEW) for rep in (0, 1)]


# E10: CPU- vs GPU-bound. Resolution should not move CPU-bound tactics.
def _e10():
    runs = [_mk("E10", dict(BASE_CONFIG, renderType=rt, viewport=vp), dict(DEFAULT_VIEW))
            for rt in RENDER_TYPES for vp in E10_VIEWPORTS]
    runs += [_mk("E10", dict(BASE_CONFIG, renderType=rt, viewport=vp), dict(DEFAULT_VIEW), 1)
             for rt in E10_REPEAT_TYPES for vp in (E10_VIEWPORTS[0], E10_VIEWPORTS[2])]
    return runs


# E11: radius vs quad at distances where radius actually converges (E5's 50 km
# radius cell is a non-result: 609 961 chunks needed). Radius = raw map/100 path.
def _e11():
    return [_mk("E11", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, strategy=st, viewDistance=vd),
                dict(DEFAULT_VIEW))
            for st in ("radius", "quad") for vd in E11_VIEW_DISTANCES]


# E12: is quiesce time throttle-bound or server-bound?
def _e12():
    base = dict(BASE_CONFIG, renderType=E2_RENDER_TYPE)
    runs = [_mk("E12", dict(base, maxLoading=n), dict(DEFAULT_VIEW)) for n in E12_MAX_LOADING_WS]
    runs += [_mk("E12", dict(base, sockets=False, maxLoading=n), dict(DEFAULT_VIEW))
             for n in E12_MAX_LOADING_HTTP]
    return runs


# E13: per-LOD / empty-chunk counter backfill, one run per location.
def _e13():
    return [_mk("E13", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE),
                {"location": loc, "pitch": "horizon"}) for loc in LOCATIONS
            if loc != "ljubljana_low"]


# E14: does the ranking hold on the integrated GPU? Run with
# --results-dir bench/results-igpu --expect-gpu intel (see README).
def _e14():
    return [_mk("E14", dict(BASE_CONFIG, renderType=rt), {"location": loc, "pitch": "horizon"}, rep)
            for rt in RENDER_TYPES for loc in E14_LOCATIONS for rep in range(E14_REPEATS)]


_BUILDERS = {"E0": _e0, "E1": _e1, "E2": _e2, "E3": _e3, "E4": _e4, "E5": _e5,
             "E6": _e6, "E7": _e7, "E8": _e8, "E9": _e9, "E10": _e10,
             "E11": _e11, "E12": _e12, "E13": _e13, "E14": _e14}
```

In `build_matrix`, expand groups before building (first lines of the function):

```python
    if experiments:
        expanded = []
        for e in experiments:
            expanded += GROUPS.get(e, [e])
        experiments = expanded
```

Check that `_e13`'s `LOCATIONS` iteration yields exactly 3 (ljubljana, alps, ne_plain) — it does since only `ljubljana_low` is excluded.

- [ ] **Step 4: Run tests**

Run: `venv\Scripts\python -m pytest bench/tests/test_matrix.py -q`
Expected: all PASS (including `test_existing_run_ids_unchanged` and the old shape tests).

- [ ] **Step 5: Commit**

```bash
git add bench/matrix.py bench/tests/test_matrix.py
git commit -m "bench: matrix gains E6-E14, repeat extensions, overnight/igpu groups"
```

---

### Task 2: Client knobs + trailing slash

**Files:**
- Modify: `public/renderer.js:882,946`
- Modify: `public/bench-api.js` (`configure`)
- Modify: `public/hmap-loader.js:149`

**Interfaces:**
- Consumes: config keys `hybridNear`, `maxLoading` from Task 1.
- Produces: `renderer.hybridNearCount` (int, 0 = all); `chunkManager.quadStrategy.maximumChunksLoading` set per run.

- [ ] **Step 1: Renderer knob**

In `public/renderer.js` add a field next to `renderType = "hybrid";` (line ~20):

```js
  hybridNearCount = 9; // hybrid: this many nearest chunks draw greedy; 0 = all
```

Replace line 882 `const nineChunks = sortedChunks.slice(0, 9);` with:

```js
    const nearSet = new Set(this.hybridNearCount === 0
      ? sortedChunks : sortedChunks.slice(0, this.hybridNearCount));
```

Replace line 946 `if (nineChunks.includes(chunk)) {` with `if (nearSet.has(chunk)) {`.

- [ ] **Step 2: configure() applies the knobs**

In `public/bench-api.js` `configure`, after `this.gameManager.updateChunkSize(cfg.chunkSize);` add:

```js
    this.gameManager.renderer.hybridNearCount = cfg.hybridNear ?? 9;
    cm.quadStrategy.maximumChunksLoading = cfg.maxLoading ?? 1;
```

- [ ] **Step 3: Trailing slash**

In `public/hmap-loader.js` line 149 change the template to end with `/`:

```js
    const url = `/get_chunk/${chunkX}/${chunkZ}/${chunkSize}/${levelOfDetail}/${version}/`;
```

- [ ] **Step 4: Syntax check**

Run: `node --check public/renderer.js; node --check public/bench-api.js; node --check public/hmap-loader.js`
Expected: no output (ES modules parse; `node --check` accepts `import` syntax in `.js` only if it parses as module — if it complains about `import`, run `node --input-type=module --check < public/renderer.js` instead).

- [ ] **Step 5: Verify the redirect is gone**

Run: `venv\Scripts\python server.py` in background, then
`curl -s -o NUL -w "%{http_code}\n" http://localhost:8000/get_chunk/0/0/128/1/quad/` → `200` or `404` (not `308`). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add public/renderer.js public/bench-api.js public/hmap-loader.js
git commit -m "client: hybridNear + maxLoading knobs; drop HTTP chunk 308 redirect (trailing slash)"
```

---

### Task 3: Client instrumentation

**Files:**
- Modify: `public/chunk-websocket.js` (`netStats.byLod`)
- Modify: `public/hmap-loader.js` (parse timer, HTTP byLod)
- Modify: `public/chunk-mesher.js:36-52` (stitch/mesh timers)
- Modify: `public/renderer.js` (`createWebGPUTextures` upload timer)
- Modify: `public/game-manager.js:95` (JS render ms)
- Modify: `public/bench-api.js` (load curve, counters, record)

**Interfaces:**
- Produces (consumed by Task 4 driver): `waitForQuiescence()` returns `{quiesced, ms, loadCurve: [...]}`; `record()` returns additionally `jsFrameTimesMs: number[]`; `getCounters()` returns additionally `byLod: {lod: {bytes, messages, n404, resident}}`, `emptyChunks`, `meshStats: {count, parseMs, stitchMs, meshMs, uploadMs}`, `net.http.phases: {redirect_p50, redirect_p95, connect_p50, connect_p95, ttfb_p50, ttfb_p95, download_p50, download_p95, n}`.

- [ ] **Step 1: netStats.byLod**

`public/chunk-websocket.js`: extend `netStats`:

```js
export const netStats = {
  wsBytes: 0,
  wsMessages: 0,
  requestsSent: 0,
  firstResponseAt: null,
  byLod: {},  // lod -> {bytes, messages, n404}; WS and HTTP both feed it
  reset() {
    this.wsBytes = 0;
    this.wsMessages = 0;
    this.requestsSent = 0;
    this.firstResponseAt = null;
    this.byLod = {};
  },
  countLod(lod, bytes, is404) {
    const s = this.byLod[lod] || (this.byLod[lod] = { bytes: 0, messages: 0, n404: 0 });
    s.bytes += bytes;
    s.messages += 1;
    if (is404) s.n404 += 1;
  },
};
```

In `requestChunk`: `this.pendingRequests.set(requestId, { resolve, reject, lod });`
In `onmessage`, after `this.pendingRequests.delete(requestId);`:

```js
      netStats.countLod(promiseHandlers.lod, buffer.byteLength - 8, status === 404);
```

- [ ] **Step 2: Mesh-stage timers + HTTP byLod in hmap-loader / mesher / renderer**

`public/hmap-loader.js`, top of file after imports:

```js
// Benchmark instrumentation: CPU ms per chunk-load stage (reset per run).
export const meshStats = {
  count: 0, parseMs: 0, stitchMs: 0, meshMs: 0, uploadMs: 0,
  reset() { this.count = 0; this.parseMs = 0; this.stitchMs = 0; this.meshMs = 0; this.uploadMs = 0; },
};
window.__meshStats = meshStats;
```

Wrap both `bufferToWebGPUArrays(buffer)` call sites in `loadHeightMap` (WS and HTTP branches):

```js
          const t0 = performance.now();
          const out = this.bufferToWebGPUArrays(buffer);
          meshStats.parseMs += performance.now() - t0;
          meshStats.count += 1;
          return out;
```

In the HTTP branch, after `return response.arrayBuffer();` is resolved (the `.then((buffer) =>` step), add at its top: `if (buffer !== 404) netStats.countLod(levelOfDetail, buffer.byteLength, false); else netStats.countLod(levelOfDetail, 0, true);` — import with `import ChunkWebSocketClient, { netStats } from "./chunk-websocket.js";`. (404 case: `response.status === 404` returns 404 before arrayBuffer; put `netStats.countLod(levelOfDetail, 0, true)` there.)

`public/chunk-mesher.js` `generateChunkData`: import `{ meshStats }` from `./hmap-loader.js` and

```js
    if (parentChunk) {
      const t0 = performance.now();
      heightMapData = this.handleNewHeightmapVTF(heightMapData, chunk.levelOfDetail, parentChunk, chunk.position.x, chunk.position.z);
      meshStats.stitchMs += performance.now() - t0;
    }

    chunk.rawData = heightMapData;
    const t1 = performance.now();
    if (!this.useMesh) {
      chunk.instanceArray = this.greedyMesher.toInstanceArray(this.greedyMesher.remesh(chunk.rawData));
    } else {
      this.addChunkMesh(chunk);
    }
    meshStats.meshMs += performance.now() - t1;
```

`public/renderer.js`: find `createWebGPUTextures(chunk, rawData)` definition; wrap its body timing — simplest: at the call site (line ~889) :

```js
      if (chunk.rawData && (!chunk.colorTexture || !chunk.heightTexture)) {
        const t0 = performance.now();
        this.createWebGPUTextures(chunk, chunk.rawData);
        window.__meshStats.uploadMs += performance.now() - t0;
      }
```

- [ ] **Step 3: JS render time**

`public/game-manager.js` in `frame`:

```js
    const tRender = performance.now();
    this.renderer.render(dt);
    window.__bench?.onRenderMs?.(performance.now() - tRender);
```

- [ ] **Step 4: bench-api.js**

Add fields/methods to `BenchAPI`:

```js
  jsFrameMs = null; // recording buffer for renderer.render() wall ms

  onRenderMs(ms) {
    if (this.jsFrameMs) this.jsFrameMs.push(ms);
  }
```

In `configure`, next to `window.__netStats?.reset();` add `window.__meshStats?.reset();`.

`waitForQuiescence`: collect a sample each poll and return it:

```js
  async waitForQuiescence({ timeoutMs = 600000 } = {}) {
    const t0 = performance.now();
    let quiet = 0;
    let lastPasses = -1;
    const loadCurve = [];
    const sample = () => {
      const s = this.gameManager.renderer.chunkManager.getStrategyStats();
      loadCurve.push({
        t: Math.round(performance.now() - t0),
        chunksResident: this.gameManager.renderer.chunkManager.getChunkData().size,
        wsBytes: window.__netStats?.wsBytes ?? 0,
        wsMessages: window.__netStats?.wsMessages ?? 0,
        httpRequests: performance.getEntriesByType("resource").filter((e) => e.name.includes("/get_chunk/")).length,
        loading: s.loading,
        initializing: !!s.initializing,
        jsHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
      });
    };
    while (performance.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      sample();
      if (window.__deviceLost) return { quiesced: false, ms: performance.now() - t0, deviceLost: true, loadCurve };
      const s = this.gameManager.renderer.chunkManager.getStrategyStats();
      if (s.passes === lastPasses) continue;
      lastPasses = s.passes;
      const quietPass = !s.initializing &&
        s.queuedLastPass === 0 && s.destroyedLastPass === 0 && s.loading === 0;
      quiet = quietPass ? quiet + 1 : 0;
      if (quiet >= QUIET_POLLS) return { quiesced: true, ms: performance.now() - t0, loadCurve };
    }
    return { quiesced: false, ms: timeoutMs, loadCurve };
  }
```

Note: `httpRequests` via `getEntriesByType` each 200 ms with up to ~5 000 entries is cheap; keep it.

`record`: set `this.jsFrameMs = [];` next to `this.frameDts = [];`, and at the end:

```js
    const js = this.jsFrameMs;
    this.jsFrameMs = null;
    return {
      frameDtsMs: dts.map((d) => d * 1000),
      jsFrameTimesMs: js,
      gpuFrameTimesMs: renderer.gpuFrameTimes.slice(0),
      countersBefore,
      countersAfter: this.getCounters(),
    };
```

`getCounters`: add the per-LOD histogram, empty count, mesh stats and HTTP phases. Add a helper above the class:

```js
function pct(sortedVals, p) {
  if (!sortedVals.length) return null;
  const k = Math.max(1, Math.ceil((p / 100) * sortedVals.length));
  return sortedVals[k - 1];
}

function httpPhases(entries) {
  const ph = { redirect: [], connect: [], ttfb: [], download: [] };
  for (const e of entries) {
    ph.redirect.push(e.redirectEnd - e.redirectStart);
    ph.connect.push(e.connectEnd - e.connectStart);
    ph.ttfb.push(e.responseStart - e.requestStart);
    ph.download.push(e.responseEnd - e.responseStart);
  }
  const out = { n: entries.length };
  for (const [k, v] of Object.entries(ph)) {
    v.sort((a, b) => a - b);
    out[`${k}_p50`] = pct(v, 50);
    out[`${k}_p95`] = pct(v, 95);
  }
  return out;
}
```

and inside `getCounters` loop:

```js
    const byLod = {};
    for (const [lod, s] of Object.entries(window.__netStats?.byLod ?? {})) byLod[lod] = { ...s, resident: 0 };
    let emptyChunks = 0;
    for (const c of chunkData.values()) {
      gpuBytes += gpuBytesFor(c);
      if (c.instanceArray) instancesResident += c.instanceArray.length / 2;
      const lod = c.levelOfDetail;
      (byLod[lod] || (byLod[lod] = { bytes: 0, messages: 0, n404: 0, resident: 0 })).resident += 1;
      if (c.rawData?.heightData && c.getMaxHeight() === 0) emptyChunks += 1;
    }
```

and in the returned object: `byLod, emptyChunks, meshStats: { ...(window.__meshStats ?? {}) },` (spread drops the `reset` function? No — spread copies it as a property; JSON serialisation drops functions, so it is fine) and under `net.http`: `phases: httpPhases(http),`.

- [ ] **Step 5: Syntax check**

Run `node --input-type=module --check < public/bench-api.js` (and for each modified file). Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add public/bench-api.js public/chunk-websocket.js public/hmap-loader.js public/chunk-mesher.js public/renderer.js public/game-manager.js
git commit -m "bench-api: load curve, per-LOD/empty/mesh-stage/HTTP-phase counters, JS frame time"
```

---

### Task 4: Server `/bench_stats` + driver fields and flags

**Files:**
- Modify: `server.py:25-31,92-94`
- Modify: `bench/driver.py`
- Test: `bench/tests/test_driver.py`

**Interfaces:**
- Consumes: Task 3 return shapes; Task 1 `Run.screenshot`, `config.viewport`, `GROUPS`.
- Produces: result JSON keys `raw.loadCurve`, `raw.jsFrameTimesMs`, `js_summary`, `server_stats`, `git_dirty`; CLI `--expect-gpu {nvidia,intel,any}` (default `nvidia`).

- [ ] **Step 1: Failing driver tests**

Look at `bench/tests/test_driver.py` first and add (importing what exists there):

```python
from bench.driver import viewport_for, check_gpu_vendor, aggregate_js


def test_viewport_for_defaults_and_config():
    assert viewport_for({"renderType": "hybrid"}) == {"width": 1920, "height": 1080}
    assert viewport_for({"viewport": [1280, 720]}) == {"width": 1280, "height": 720}


def test_check_gpu_vendor():
    res = {"provenance": {"adapterInfo": {"vendor": "nvidia"}}}
    assert check_gpu_vendor(res, "nvidia") is None
    assert check_gpu_vendor(res, "any") is None
    assert "intel" in check_gpu_vendor(res, "intel")
    assert check_gpu_vendor({"provenance": None}, "nvidia") is not None


def test_aggregate_js_tolerates_missing():
    assert aggregate_js({"jsFrameTimesMs": [1.0, 2.0, 3.0]})["frames"] == 3
    assert aggregate_js({})["frames"] == 0
```

Run: `venv\Scripts\python -m pytest bench/tests/test_driver.py -q` → ImportError.

- [ ] **Step 2: server.py**

Add after `chunk_manager = ...`:

```python
import threading
_req_lock = threading.Lock()
_req_times = []  # (ms, lod, is404) since last /bench_stats GET


def _timed_get_chunk(x, z, chunk_size, lod, version):
    t0 = time.perf_counter()
    data = chunk_manager.get_chunk(x, z, chunk_size=chunk_size, lod=lod, version=version)
    with _req_lock:
        _req_times.append(((time.perf_counter() - t0) * 1000.0, lod, data == 404))
    return data
```

Replace both `chunk_manager.get_chunk(...)` calls (HTTP route line 27 and WS `process_and_send`) with `_timed_get_chunk(...)`.

Add the endpoint:

```python
@app.route("/bench_stats")
def bench_stats():
    """Per-request server timing since the previous call; reading resets."""
    with _req_lock:
        rows = list(_req_times)
        _req_times.clear()
    ms = sorted(r[0] for r in rows)
    def pct(p):
        if not ms:
            return None
        k = max(1, -(-p * len(ms) // 100))
        return ms[k - 1]
    by_lod = {}
    for t, lod, is404 in rows:
        s = by_lod.setdefault(str(lod), {"count": 0, "total_ms": 0.0, "n404": 0})
        s["count"] += 1
        s["total_ms"] += t
        s["n404"] += int(is404)
    return {"count": len(ms), "mean_ms": (sum(ms) / len(ms)) if ms else None,
            "p50_ms": pct(50), "p95_ms": pct(95), "max_ms": ms[-1] if ms else None,
            "by_lod": by_lod}
```

- [ ] **Step 3: driver.py**

Add helpers near `git_rev`:

```python
def git_dirty():
    try:
        out = subprocess.check_output(["git", "status", "--porcelain", "--",
                                       "public", "server.py", "python", "bench/*.py"],
                                      cwd=REPO_ROOT, text=True)
        return bool(out.strip())
    except Exception:
        return None


def viewport_for(config):
    vp = config.get("viewport")
    return {"width": vp[0], "height": vp[1]} if vp else dict(VIEWPORT)


def check_gpu_vendor(result, expected):
    """None if OK, else an error message. 'any' disables the check."""
    if expected == "any":
        return None
    vendor = ((result.get("provenance") or {}).get("adapterInfo") or {}).get("vendor")
    if vendor != expected:
        return (f"GPU vendor is {vendor!r}, expected {expected!r} -- fix the Playwright "
                f"Chromium GpuPreference registry entry (see bench/README.md) and rerun")
    return None


def aggregate_js(rec):
    return aggregate(rec.get("jsFrameTimesMs") or [])


def fetch_server_stats():
    try:
        with urllib.request.urlopen(SERVER_URL + "/bench_stats", timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}
```

In `run_one`:
- result dict: add `"git_dirty": git_dirty()`, `"js_summary": {"frames": 0}`, `"server_stats": None`, and `"raw": {"frameDtsMs": [], "gpuFrameTimesMs": [], "jsFrameTimesMs": [], "loadCurve": []}`.
- `context = browser.new_context(viewport=viewport_for(run.config), device_scale_factor=1)`.
- After `configure`: `fetch_server_stats()` (discard — resets the counter so pre-configure loads are excluded).
- After the quiesce evaluate: `result["raw"]["loadCurve"] = result["quiesce"].pop("loadCurve", [])`.
- After record: `result["raw"]["jsFrameTimesMs"] = rec.get("jsFrameTimesMs", [])`, `result["js_summary"] = aggregate_js(rec)`, `result["server_stats"] = fetch_server_stats()`.
- Screenshots: `if args.screenshots or run.screenshot:`.

In `main`: add `ap.add_argument("--expect-gpu", default="nvidia", choices=["nvidia", "intel", "any"])`; update `--experiments` help to mention groups `overnight`, `igpu`; in the loop after `result = run_one(...)` and before `write_result`:

```python
                msg = check_gpu_vendor(result, args.expect_gpu) if not result["error"] else None
                if msg:
                    fail(msg)  # do not write a result from the wrong GPU
```

Also print `run.config.get('viewport')` and `run.repeat` in the per-run line is optional; keep the existing line.

- [ ] **Step 4: Tests**

Run: `venv\Scripts\python -m pytest bench/tests/ -q` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add server.py bench/driver.py bench/tests/test_driver.py
git commit -m "driver: per-run viewport, --expect-gpu, js_summary, load curve, server /bench_stats"
```

---

### Task 5: Smoke every new experiment (plumbing only) and verify fields

**Files:** none modified (scratch results only).

- [ ] **Step 1: Pick one run per experiment and smoke it**

For each of E6, E7, E8, E9, E10, E11, E12, E13 take the first run id from `venv\Scripts\python -c "from bench.matrix import build_matrix; [print(r.run_id, r.config) for r in build_matrix(['E6'])][:1]"` and run:

```
venv\Scripts\python -m bench.driver --redo <run_id> --record-ms 2000 --warmup-ms 1000 --results-dir bench/results-smoke
```

For E8 choose the `ljubljana_low` hybrid r0 id (screenshot lands in `bench/results-smoke/shots/`). For E12 choose one `sockets=False` cell so HTTP phases are exercised. For E10 choose a `[2560,1440]` cell and check `provenance.canvas`.

- [ ] **Step 2: Verify the new fields**

```
venv\Scripts\python - <<EOF
import json, glob
for p in glob.glob("bench/results-smoke/E*.json"):
    r = json.load(open(p))
    ca = r["counters_after"] or {}
    print(p, r["error"], len(r["raw"]["loadCurve"]), r["js_summary"].get("frames"),
          ca.get("emptyChunks"), list((ca.get("byLod") or {}).keys()), ca.get("meshStats"),
          (ca.get("net", {}).get("http", {}).get("phases") or {}).get("n"),
          (r.get("server_stats") or {}).get("count"), r.get("provenance", {}).get("canvas"))
EOF
```

Expected: no errors; loadCurve length > 0; js frames > 0; byLod keys present; meshStats count > 0; server_stats count > 0; HTTP phases n > 0 for the HTTP cell with `redirect_p50 == 0`; E10 canvas = 2560×1440.

- [ ] **Step 3: Look at the E8 low-view screenshot** (`Read` the PNG). Terrain must fill the frame from a low vantage; if the camera is underground (all one colour) or too high, adjust `LOCATIONS["ljubljana_low"]["y"]` in `bench/matrix.py` (ids of E8/E9 change — they have no results yet, fine) and re-smoke.

- [ ] **Step 4: Clean up**

Delete `bench/results-smoke/` (scratch). Commit only if matrix changed:

```bash
git add bench/matrix.py
git commit -m "bench: ljubljana_low view height verified by smoke screenshot"
```

---

### Task 6: E4 redo recipe (keep the "before" evidence)

**Files:**
- Create: `bench/results-e4-before-slash-fix/` (moved JSONs)
- Modify: `bench/README.md` (recipe)

- [ ] **Step 1: Move the 6 HTTP E4 results aside**

```
venv\Scripts\python - <<EOF
import json, glob, shutil, os
os.makedirs("bench/results-e4-before-slash-fix", exist_ok=True)
for p in glob.glob("bench/results-full-sweep/E4-*.json"):
    r = json.load(open(p))
    if r["config"]["sockets"] is False:
        shutil.move(p, "bench/results-e4-before-slash-fix/" + os.path.basename(p))
        print("moved", p)
EOF
```

Expected: 6 files moved. Write `bench/results-e4-before-slash-fix/README.md`:

```
E4 HTTP cells measured BEFORE the trailing-slash fix (hmap-loader.js). Each chunk
request hit Flask's 308 redirect => two round trips per chunk. Kept as evidence for
the "WS 5x faster than HTTP was a dev-server artefact" paragraph. Not thesis numbers.
```

Since the files are now absent from `results-full-sweep`, a plain `--experiments E4 --results-dir bench/results-full-sweep` re-runs exactly those 6 pending cells — no `--redo` needed. Add that to the README in Task 9.

- [ ] **Step 2: Commit**

```bash
git add bench/results-e4-before-slash-fix bench/results-full-sweep
git commit -m "data: quarantine pre-slash-fix E4 HTTP results; E4 HTTP cells pending again"
```

---

### Task 7: Plots for E6–E14

**Files:**
- Modify: `bench/plot.py`
- Test: `bench/tests/test_plot.py`

**Interfaces:**
- Consumes: result fields from Tasks 3–4.
- Produces: `load_results(results_dirs)` accepting a list; `_plot_e6`..`_plot_e14(results, figures_dir, report)`; files `E6_chunksize_by_type.{png,csv}`, `E7_fx_by_type.{png,csv}`, `E8_quality_grid.png` + `E8_low_view_fps.csv`, `E9_hybrid_near.{png,csv}`, `E10_resolution.{png,csv}`, `E11_radius_vs_quad.{png,csv}`, `E12_max_loading.{png,csv}`, `E13_by_lod.{png,csv}`, `E14_igpu.{png,csv}`.

- [ ] **Step 1: Failing tests**

Extend `bench/tests/test_plot.py` `_fake_result` to accept `config_overrides=None, view=None, experiment="E1"` and default new fields (`"js_summary": {"frames": 0}`, `"server_stats": None`, `"raw": {..., "jsFrameTimesMs": [], "loadCurve": []}`, counters with `"byLod": {}`, `"emptyChunks": 0`, `"meshStats": {}`, `"frameStats": {"instancesDrawn": 0, "chunksRendered": 0}`). Add:

```python
def test_write_all_with_new_experiments(tmp_path):
    d = tmp_path / "results"; d.mkdir()
    def put(r): (d / f"{r['run_id']}.json").write_text(json.dumps(r))
    put(_fake_result("E6-00000001-r0", "E6", "greedy", "ljubljana", "horizon", 80.0, 0, {"chunkSize": 128}))
    put(_fake_result("E6-00000002-r0", "E6", "greedy", "ljubljana", "horizon", 90.0, 0, {"chunkSize": 256}))
    put(_fake_result("E7-00000003-r0", "E7", "greedy", "ljubljana", "horizon", 80.0, 0, {"fx": False}))
    put(_fake_result("E7-00000004-r0", "E7", "greedy", "ljubljana", "horizon", 60.0, 0, {"fx": True}))
    put(_fake_result("E9-00000005-r0", "E9", "hybrid", "ljubljana", "horizon", 300.0, 0, {"hybridNear": 9}))
    put(_fake_result("E9-00000006-r0", "E9", "hybrid", "ljubljana", "horizon", 100.0, 0, {"hybridNear": 0}))
    put(_fake_result("E10-00000007-r0", "E10", "raycast", "ljubljana", "horizon", 300.0, 0, {"viewport": [1280, 720]}))
    put(_fake_result("E10-00000008-r0", "E10", "raycast", "ljubljana", "horizon", 290.0, 0, {"viewport": [2560, 1440]}))
    put(_fake_result("E11-00000009-r0", "E11", "hybrid", "ljubljana", "horizon", 200.0, 0, {"strategy": "radius", "viewDistance": 1000}))
    put(_fake_result("E12-0000000a-r0", "E12", "hybrid", "ljubljana", "horizon", 200.0, 0, {"maxLoading": 4}))
    put(_fake_result("E13-0000000b-r0", "E13", "hybrid", "alps", "horizon", 200.0, 0))
    put(_fake_result("E14-0000000c-r0", "E14", "mesh", "alps", "horizon", 20.0, 0))
    figs = tmp_path / "figs"
    write_all([d], figs)
    for name in ["E6_chunksize_by_type.png", "E7_fx_by_type.png", "E9_hybrid_near.png",
                 "E10_resolution.png", "E11_radius_vs_quad.png", "E12_max_loading.png",
                 "E13_by_lod.png", "E14_igpu.png", "report.md"]:
        assert (figs / name).exists(), name


def test_load_results_multiple_dirs_dedupes(tmp_path):
    a = tmp_path / "a"; b = tmp_path / "b"; a.mkdir(); b.mkdir()
    r = _fake_result("E1-00000001-r0", "E1", "greedy", "ljubljana", "horizon", 80.0, 0)
    (a / "x.json").write_text(json.dumps(r)); (b / "y.json").write_text(json.dumps(r))
    assert len(load_results([a, b])) == 1
```

Run → fails (`write_all` signature / missing figures).

- [ ] **Step 2: `load_results` + `write_all` over several dirs**

```python
def load_results(results_dirs):
    """Load every *.json under one dir or a list of dirs; first run_id wins."""
    if isinstance(results_dirs, (str, Path)):
        results_dirs = [results_dirs]
    out, seen = [], set()
    for d in results_dirs:
        for p in sorted(Path(d).glob("*.json")):
            r = json.loads(p.read_text(encoding="utf-8"))
            if r.get("run_id") in seen:
                continue
            seen.add(r.get("run_id"))
            out.append(r)
    return out
```

`main`: `ap.add_argument("--results-dir", nargs="+", default=[str(root / "results")])`; `write_all(args.results_dir, args.figures_dir)`.

- [ ] **Step 3: Shared helpers**

```python
def _cfg(r, key, default=None):
    return r["config"].get(key, default)


def _section(report, title, what_it_shows, files):
    report.append(f"## {title}\n")
    report.append(what_it_shows.strip() + "\n")
    report.append("Files: " + ", ".join(f"`{f}`" for f in files) + "\n")


def _rows_for(results, experiment, key_fn):
    return _median_rows([r for r in results if r["experiment"] == experiment], key_fn)


def _counter(r, *path, default=None):
    cur = r.get("counters_after") or {}
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    return cur
```

- [ ] **Step 4: E6**

```python
def _plot_e6(results, figures_dir, report):
    rows = _rows_for(results, "E6", lambda r: (("renderType", _cfg(r, "renderType")), ("chunkSize", _cfg(r, "chunkSize"))))
    # hybrid's E2 curve (same view) for reference, if present in the loaded dirs
    rows += [dict(r, renderType="hybrid (E2)") for r in table_e2(results)
             if r["chunkSize"] in E6_REFERENCE_SIZES]
    _write_csv(rows, figures_dir / "E6_chunksize_by_type.csv")
    fig, ax = plt.subplots(figsize=(7, 4.5))
    for rt in sorted({r["renderType"] for r in rows}, key=lambda t: RENDER_TYPE_ORDER.index(t.split()[0])):
        pts = sorted([r for r in rows if r["renderType"] == rt and r.get("mean_fps")], key=lambda r: r["chunkSize"])
        ax.errorbar([p["chunkSize"] for p in pts], [p["mean_fps"] for p in pts], yerr=_errbars(pts, "mean_fps"),
                    marker="o", label=rt, color=_color_for(rt.split()[0], RENDER_TYPE_ORDER), capsize=2)
    ax.set_xscale("log", base=2); ax.set_xlabel("chunk size (px)"); ax.set_ylabel("mean FPS")
    ax.set_title("E6: chunk size × render type"); ax.legend(); _style_axes(ax)
    fig.tight_layout(); fig.savefig(figures_dir / "E6_chunksize_by_type.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    peaks = {rt: max((r for r in rows if r["renderType"] == rt and r.get("mean_fps")), key=lambda r: r["mean_fps"])["chunkSize"]
             for rt in {r["renderType"] for r in rows} if any(r.get("mean_fps") for r in rows if r["renderType"] == rt)}
    _section(report, "E6 chunk size × render type",
             "Does the chunk-size optimum found in E2 (hybrid only) hold for GPU-bound tactics? "
             "One line per render type, mean FPS vs chunk size at ljubljana/horizon; the hybrid E2 "
             "curve is overlaid when those results are loaded. Read: where each line peaks. "
             f"Peak chunk size per type: {peaks}.",
             ["E6_chunksize_by_type.png", "E6_chunksize_by_type.csv"])
```

with `E6_REFERENCE_SIZES = {64, 128, 200, 256, 512}` at module level. Guard: skip plotting lines with no points.

- [ ] **Step 5: E7**

```python
def _plot_e7(results, figures_dir, report):
    rows = _rows_for(results, "E7", lambda r: (("renderType", _cfg(r, "renderType")), ("fx", _cfg(r, "fx"))))
    # hybrid x fx comes from E5 (same view/config)
    rows += [dict(renderType="hybrid", fx=r["fx"], **{k: v for k, v in r.items() if k not in ("renderType", "fx")})
             for r in table_e5(results) if r["strategy"] == "quad" and not r["culling"] and r["viewDistance"] is None and r["renderType"] == "hybrid"]
    types = [t for t in RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    out = []
    for t in types:
        off = next((r for r in rows if r["renderType"] == t and not r["fx"]), None)
        on = next((r for r in rows if r["renderType"] == t and r["fx"]), None)
        if off and on and off.get("mean_fps") and on.get("mean_fps"):
            out.append({"renderType": t, "fps_off": off["mean_fps"], "fps_on": on["mean_fps"],
                        "ms_off": 1000 / off["mean_fps"], "ms_on": 1000 / on["mean_fps"],
                        "fx_cost_ms": 1000 / on["mean_fps"] - 1000 / off["mean_fps"],
                        "fx_cost_pct": 100 * (off["mean_fps"] - on["mean_fps"]) / off["mean_fps"]})
    _write_csv(out, figures_dir / "E7_fx_by_type.csv")
    if out:
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
        x = range(len(out)); w = 0.38
        a1.bar([i - w/2 for i in x], [o["fps_off"] for o in out], w, label="fx off", color=INK_MUTED)
        a1.bar([i + w/2 for i in x], [o["fps_on"] for o in out], w, label="fx on", color=CAT_COLORS[1])
        a1.set_xticks(list(x)); a1.set_xticklabels([o["renderType"] for o in out]); a1.set_ylabel("mean FPS"); a1.legend(); _style_axes(a1)
        a2.bar(list(x), [o["fx_cost_ms"] for o in out], color=[_color_for(o["renderType"], RENDER_TYPE_ORDER) for o in out])
        a2.set_xticks(list(x)); a2.set_xticklabels([o["renderType"] for o in out]); a2.set_ylabel("fx cost (ms per frame)"); _style_axes(a2)
        fig.suptitle("E7: FX post-processing × render type"); fig.tight_layout()
        fig.savefig(figures_dir / "E7_fx_by_type.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E7 fx × render type",
             "Does the FX pass compose with every tactic? Left: FPS with fx off/on. Right: the same "
             "difference expressed in ms per frame — if the bars are ~equal, fx is a fixed per-frame "
             "cost (4 full-screen passes) that only *looks* expensive on fast tactics.",
             ["E7_fx_by_type.png", "E7_fx_by_type.csv"])
```

- [ ] **Step 6: E8**

```python
def _plot_e8(results, figures_dir, report, shots_dirs):
    e8 = [r for r in results if r["experiment"] == "E8"]
    rows = _median_rows(e8, lambda r: (("renderType", _cfg(r, "renderType")), ("location", r["view"]["location"])))
    _write_csv(rows, figures_dir / "E8_low_view_fps.csv")
    # screenshot grid: row 0 = E1 view (6 types), row 1 = low view (3 types)
    def shot(run_id):
        for d in shots_dirs:
            p = Path(d) / "shots" / f"{run_id}.png"
            if p.exists():
                return plt.imread(p)
        return None
    panels = []
    for loc in ("ljubljana", "ljubljana_low"):
        for rt in RENDER_TYPE_ORDER:
            r = next((x for x in e8 if _cfg(x, "renderType") == rt and x["view"]["location"] == loc and x["repeat"] == 0), None)
            img = shot(r["run_id"]) if r else None
            if img is not None:
                panels.append((f"{rt} @ {loc}", img, r["summary"].get("mean_fps")))
    if panels:
        cols = 3; rws = -(-len(panels) // cols)
        fig, axes = plt.subplots(rws, cols, figsize=(4.2 * cols, 2.6 * rws))
        for ax, (title, img, fps) in zip(axes.flat, panels):
            ax.imshow(img); ax.set_title(f"{title} — {fps:.0f} FPS" if fps else title, fontsize=8); ax.axis("off")
        for ax in list(axes.flat)[len(panels):]:
            ax.axis("off")
        fig.tight_layout(); fig.savefig(figures_dir / "E8_quality_grid.png", dpi=120, bbox_inches="tight"); plt.close(fig)
    _section(report, "E8 quality evidence",
             "What each tactic actually looks like (same frame, same view), and the low pass over "
             "Ljubljana where hybrid's greedy near field fills the frame. Compare hybrid vs raycast "
             "vs greedy at ljubljana_low: same speed + visibly more near detail is the 'hybrid wins "
             "on quality' claim; identical pictures at the 4 km view explain why E1 could not see it.",
             ["E8_quality_grid.png", "E8_low_view_fps.csv"])
```

`write_all` passes `shots_dirs=results_dirs` (the list). Report the low-view FPS table inline too (3 lines).

- [ ] **Step 7: E9**

```python
def _plot_e9(results, figures_dir, report):
    e9 = [r for r in results if r["experiment"] == "E9"]
    rows = _median_rows(e9, lambda r: (("hybridNear", _cfg(r, "hybridNear")), ("location", r["view"]["location"])))
    for row in rows:
        rs = [r for r in e9 if _cfg(r, "hybridNear") == row["hybridNear"] and r["view"]["location"] == row["location"]]
        row["instancesDrawn"] = statistics.median([_counter(r, "frameStats", "instancesDrawn", default=0) for r in rs])
    _write_csv(rows, figures_dir / "E9_hybrid_near.csv")
    order = [9, 25, 81, 225, 0]; labels = ["9", "25", "81", "225", "all"]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    for i, loc in enumerate(sorted({r["location"] for r in rows})):
        pts = [next((r for r in rows if r["location"] == loc and r["hybridNear"] == n), None) for n in order]
        xs = [k for k, p in enumerate(pts) if p and p.get("mean_fps")]
        a1.errorbar(xs, [pts[k]["mean_fps"] for k in xs], yerr=_errbars([pts[k] for k in xs], "mean_fps"), marker="o", label=loc, color=CAT_COLORS[i], capsize=2)
        a2.plot(xs, [max(1, pts[k]["instancesDrawn"]) for k in xs], marker="s", label=loc, color=CAT_COLORS[i])
    for ax, yl in ((a1, "mean FPS"), (a2, "greedy instances drawn / frame")):
        ax.set_xticks(range(len(order))); ax.set_xticklabels(labels); ax.set_xlabel("hybridNear (chunks drawn greedy)"); ax.set_ylabel(yl); ax.legend(); _style_axes(ax)
    a2.set_yscale("log")
    fig.suptitle("E9: hybrid near-field knob"); fig.tight_layout()
    fig.savefig(figures_dir / "E9_hybrid_near.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E9 hybridNear sweep",
             "The 'do greedy and raycast compose?' experiment: how many nearest chunks hybrid draws "
             "with greedy meshes (rest raymarched). 'all' = pure greedy through the hybrid path. "
             "Left: FPS; right: greedy instances actually drawn (log). Read: how far the knob can go "
             "before FPS leaves the raycast plateau, at the 4 km view and at the low pass.",
             ["E9_hybrid_near.png", "E9_hybrid_near.csv"])
```

- [ ] **Step 8: E10**

```python
def _plot_e10(results, figures_dir, report):
    rows = _rows_for(results, "E10", lambda r: (("renderType", _cfg(r, "renderType")), ("viewport", "x".join(map(str, _cfg(r, "viewport") or [1920, 1080])))))
    for row in rows:
        base = next((b for b in rows if b["renderType"] == row["renderType"] and b["viewport"] == "1920x1080"), None)
        row["fps_rel_1080p"] = (row["mean_fps"] / base["mean_fps"]) if base and base.get("mean_fps") and row.get("mean_fps") else None
    _write_csv(rows, figures_dir / "E10_resolution.csv")
    vps = ["1280x720", "1920x1080", "2560x1440"]
    types = [t for t in RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))
    w = 0.26
    for j, vp in enumerate(vps):
        vals = [next((r.get("mean_fps") or 0 for r in rows if r["renderType"] == t and r["viewport"] == vp), 0) for t in types]
        rel = [next((r.get("fps_rel_1080p") or 0 for r in rows if r["renderType"] == t and r["viewport"] == vp), 0) for t in types]
        a1.bar([i + (j - 1) * w for i in range(len(types))], vals, w, label=vp, color=CAT_COLORS[j])
        a2.bar([i + (j - 1) * w for i in range(len(types))], rel, w, label=vp, color=CAT_COLORS[j])
    a2.axhline(1.0, color=INK_MUTED, lw=0.8)
    for ax, yl in ((a1, "mean FPS"), (a2, "FPS relative to 1080p")):
        ax.set_xticks(range(len(types))); ax.set_xticklabels(types); ax.set_ylabel(yl); ax.legend(fontsize=7); _style_axes(ax)
    fig.suptitle("E10: resolution scaling"); fig.tight_layout()
    fig.savefig(figures_dir / "E10_resolution.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E10 resolution scaling",
             "Pixel count ×4 from 720p to 1440p. A GPU-bound tactic loses FPS roughly with pixel "
             "count; a CPU-bound tactic (raycast/hybrid at this view) stays flat. Right panel is "
             "normalised to 1080p, so 'flat ≈ 1.0' = CPU-bound.",
             ["E10_resolution.png", "E10_resolution.csv"])
```

- [ ] **Step 9: E11, E12, E13, E14**

```python
def _plot_e11(results, figures_dir, report):
    e11 = [r for r in results if r["experiment"] == "E11"]
    rows = _median_rows(e11, lambda r: (("strategy", _cfg(r, "strategy")), ("viewDistance", _cfg(r, "viewDistance"))))
    for row in rows:
        rs = [r for r in e11 if _cfg(r, "strategy") == row["strategy"] and _cfg(r, "viewDistance") == row["viewDistance"]]
        row["chunksResident"] = statistics.median([_counter(r, "chunksResident", default=0) for r in rs])
        row["bytes"] = statistics.median([_net_total_bytes(r.get("counters_after") or {}) for r in rs])
    _write_csv(rows, figures_dir / "E11_radius_vs_quad.csv")
    vds = sorted({r["viewDistance"] for r in rows})
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    for k, (metric, yl) in enumerate((("mean_fps", "mean FPS"), ("quiesce_ms", "time to quiescence (ms)"), ("chunksResident", "chunks resident"))):
        for j, st in enumerate(("quad", "radius")):
            vals = [next((r.get(metric) or 0 for r in rows if r["strategy"] == st and r["viewDistance"] == vd), 0) for vd in vds]
            axes[k].bar([i + (j - 0.5) * 0.38 for i in range(len(vds))], vals, 0.38, label=st, color=CAT_COLORS[j])
        axes[k].set_xticks(range(len(vds))); axes[k].set_xticklabels([str(v) for v in vds]); axes[k].set_xlabel("view distance (m)"); axes[k].set_ylabel(yl); axes[k].legend(); _style_axes(axes[k])
    fig.suptitle("E11: radius vs quad strategy"); fig.tight_layout()
    fig.savefig(figures_dir / "E11_radius_vs_quad.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E11 radius vs quad",
             "Both strategies at view distances where the radius strategy actually converges. "
             "Caveat to state in the text: radius uses the server's v1 path (raw uncleaned map/100, "
             "LOD limits are no-ops). Read: FPS, load time and resident chunks side by side.",
             ["E11_radius_vs_quad.png", "E11_radius_vs_quad.csv"])


def _plot_e12(results, figures_dir, report):
    e12 = [r for r in results if r["experiment"] == "E12"]
    rows = _median_rows(e12, lambda r: (("transport", "ws" if _cfg(r, "sockets") else "http"), ("maxLoading", _cfg(r, "maxLoading"))))
    for row in rows:
        rs = [r for r in e12 if ("ws" if _cfg(r, "sockets") else "http") == row["transport"] and _cfg(r, "maxLoading") == row["maxLoading"]]
        msgs = [(_counter(r, "net", "ws", "messages", default=0) or 0) + (_counter(r, "net", "http", "requests", default=0) or 0) for r in rs]
        row["messages"] = statistics.median(msgs)
        row["msg_per_s"] = row["messages"] / (row["quiesce_ms"] / 1000) if row["quiesce_ms"] else None
        row["server_mean_ms"] = statistics.median([((r.get("server_stats") or {}).get("mean_ms") or 0) for r in rs])
    _write_csv(rows, figures_dir / "E12_max_loading.csv")
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    for j, tr in enumerate(("ws", "http")):
        pts = sorted([r for r in rows if r["transport"] == tr], key=lambda r: r["maxLoading"])
        a1.plot([p["maxLoading"] for p in pts], [p["quiesce_ms"] / 1000 for p in pts], marker="o", label=tr, color=CAT_COLORS[j])
        a2.plot([p["maxLoading"] for p in pts], [p["msg_per_s"] or 0 for p in pts], marker="o", label=tr, color=CAT_COLORS[j])
    a1.set_ylabel("time to quiescence (s)"); a2.set_ylabel("chunk responses / s")
    for ax in (a1, a2):
        ax.set_xlabel("maxLoading (concurrent chunk requests)"); ax.set_xscale("log", base=2); ax.legend(); _style_axes(ax)
    fig.suptitle("E12: loader concurrency"); fig.tight_layout()
    fig.savefig(figures_dir / "E12_max_loading.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E12 maxLoading sweep",
             "Is streaming limited by the client's serial loader (maximumChunksLoading=1) or by the "
             "server? If quiesce time barely moves with 2-8 concurrent requests, the server "
             "(whole-tile decode per request, no cache) is the ceiling; server_mean_ms in the CSV is "
             "the per-request server cost measured server-side.",
             ["E12_max_loading.png", "E12_max_loading.csv"])


LOD9_TILES = 14731


def _plot_e13(results, figures_dir, report):
    e13 = [r for r in results if r["experiment"] == "E13" and not r.get("error")]
    rows = []
    for r in e13:
        for lod, s in sorted((_counter(r, "byLod", default={}) or {}).items(), key=lambda kv: int(kv[0])):
            rows.append({"location": r["view"]["location"], "lod": int(lod), "resident": s.get("resident", 0),
                         "bytes": s.get("bytes", 0), "messages": s.get("messages", 0), "n404": s.get("n404", 0),
                         "emptyChunks_total": _counter(r, "emptyChunks", default=0)})
    _write_csv(rows, figures_dir / "E13_by_lod.csv")
    if rows:
        locs = sorted({x["location"] for x in rows}); lods = sorted({x["lod"] for x in rows})
        fig, ax = plt.subplots(figsize=(7, 4.2)); bottom = [0] * len(locs)
        for k, lod in enumerate(lods):
            vals = [next((x["resident"] for x in rows if x["location"] == l and x["lod"] == lod), 0) for l in locs]
            ax.bar(locs, vals, bottom=bottom, label=f"LOD {lod}", color=CAT_COLORS[k % len(CAT_COLORS)]); bottom = [b + v for b, v in zip(bottom, vals)]
        ax.set_ylabel("chunks resident at quiescence"); ax.legend(fontsize=7); ax.set_title("E13: resident chunks per LOD"); _style_axes(ax)
        fig.tight_layout(); fig.savefig(figures_dir / "E13_by_lod.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    lod9 = {l: sum(x["resident"] for x in rows if x["location"] == l and x["lod"] == 9) for l in {x["location"] for x in rows}}
    _section(report, "E13 per-LOD residency",
             "How much of the pyramid a single view actually touches. LOD-9 (1 km base tiles) resident "
             f"per location, of {LOD9_TILES} tiles in the dataset: {lod9}. Also the bytes/requests per "
             "LOD and the count of all-zero (outside-survey) chunks.",
             ["E13_by_lod.png", "E13_by_lod.csv"])


def _plot_e14(results, figures_dir, report):
    e14 = [r for r in results if r["experiment"] == "E14"]
    rows = _median_rows(e14, lambda r: (("renderType", _cfg(r, "renderType")), ("location", r["view"]["location"])))
    ref = {(r["renderType"], r["location"]): r for r in table_e1(results) if r["pitch"] == "horizon"}
    for row in rows:
        b = ref.get((row["renderType"], row["location"]))
        row["rtx_mean_fps"] = b["mean_fps"] if b else None
        row["igpu_over_rtx"] = (row["mean_fps"] / b["mean_fps"]) if b and b.get("mean_fps") and row.get("mean_fps") else None
    _write_csv(rows, figures_dir / "E14_igpu.csv")
    locs = sorted({r["location"] for r in rows}); types = [t for t in RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    fig, axes = plt.subplots(1, len(locs), figsize=(5.5 * len(locs), 4.2), squeeze=False)
    for ax, loc in zip(axes[0], locs):
        ig = [next((r.get("mean_fps") or 0 for r in rows if r["renderType"] == t and r["location"] == loc), 0) for t in types]
        rx = [next((r.get("rtx_mean_fps") or 0 for r in rows if r["renderType"] == t and r["location"] == loc), 0) for t in types]
        ax.bar([i - 0.2 for i in range(len(types))], rx, 0.4, label="RTX 3070 Ti (E1)", color=INK_MUTED)
        ax.bar([i + 0.2 for i in range(len(types))], ig, 0.4, label="Iris Xe (E14)", color=CAT_COLORS[0])
        ax.set_xticks(range(len(types))); ax.set_xticklabels(types); ax.set_title(loc); ax.set_ylabel("mean FPS"); ax.set_yscale("log"); ax.legend(fontsize=7); _style_axes(ax)
    fig.suptitle("E14: integrated GPU vs discrete"); fig.tight_layout()
    fig.savefig(figures_dir / "E14_igpu.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E14 iGPU generalisation",
             "Same tactics on the laptop's Intel Iris Xe (log FPS). RTX bars appear when the E1 "
             "results dir is also loaded. Read: does the ORDER of tactics survive a 10x weaker GPU, "
             "and which tactics fall below interactive rates.",
             ["E14_igpu.png", "E14_igpu.csv"])
```

- [ ] **Step 10: Register in `write_all`**

```python
def write_all(results_dirs, figures_dir):
    ...
    results = load_results(results_dirs)
    ...
    for exp, fn in (("E6", _plot_e6), ("E7", _plot_e7), ("E9", _plot_e9), ("E10", _plot_e10),
                    ("E11", _plot_e11), ("E12", _plot_e12), ("E13", _plot_e13), ("E14", _plot_e14)):
        if any(r["experiment"] == exp for r in results):
            fn(results, figures_dir, report)
    if any(r["experiment"] == "E8" for r in results):
        _plot_e8(results, figures_dir, report, results_dirs if isinstance(results_dirs, list) else [results_dirs])
```

- [ ] **Step 11: Run tests, then regenerate existing figure dirs to prove nothing regressed**

`venv\Scripts\python -m pytest bench/tests/ -q` → PASS.
`venv\Scripts\python -m bench.plot` and `venv\Scripts\python -m bench.plot --results-dir bench/results-full-sweep --figures-dir bench/figures-full-sweep` → no exceptions; `git diff --stat bench/figures*` shows only PNG byte churn / report additions.

- [ ] **Step 12: Commit**

```bash
git add bench/plot.py bench/tests/test_plot.py bench/figures bench/figures-full-sweep
git commit -m "plot: figures + report sections for E6-E14; load several results dirs"
```

---

### Task 8: Zero-run figures from existing data + `bench/loc.py`

**Files:**
- Modify: `bench/plot.py`
- Create: `bench/loc.py`
- Test: `bench/tests/test_plot.py`, `bench/tests/test_loc.py`

**Interfaces:**
- Produces files: `E1_multimetric.csv` (+ markdown table in report), `gpu_vs_wall.{png,csv}`, `pacing.{png,csv}`, `pitch_invariance.{png,csv}`, `E2_bandwidth.{png,csv}`, `load_curves.png`, `noise.{png,csv}`, `loc_table.csv` (+ report table).

- [ ] **Step 1: Failing tests**

```python
def test_zero_run_figures(tmp_path):
    d = _make_results_dir(tmp_path)  # E1 greedy+mesh with repeats
    figs = tmp_path / "figs"
    write_all([d], figs)
    for name in ["E1_multimetric.csv", "gpu_vs_wall.png", "pacing.png", "pitch_invariance.png", "noise.csv"]:
        assert (figs / name).exists(), name
```

and `bench/tests/test_loc.py`:

```python
from bench.loc import count_loc, TACTIC_FILES

def test_count_loc_ignores_blank_and_comments(tmp_path):
    p = tmp_path / "x.wgsl"
    p.write_text("// c\n\nfn a() {}\n  // d\nlet x = 1;\n")
    assert count_loc(p) == 2

def test_tactic_files_exist():
    for t, files in TACTIC_FILES.items():
        for f in files:
            assert (Path("public") / f).exists(), f
```

- [ ] **Step 2: `bench/loc.py`**

```python
"""Lines-of-code proxy for the thesis 'simplest' axis. No field standard exists;
this counts non-blank, non-comment lines of the files each tactic needs beyond
the shared core. Run: venv\\Scripts\\python -m bench.loc [--csv out.csv]"""
import argparse
import csv
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"

SHARED = ["renderer.js", "chunk-mesher.js", "hmap-loader.js", "chunk-quad-strategy.js",
          "chunk-websocket.js", "chunk-manager.js", "chunk.js"]
TACTIC_FILES = {
    "mesh":    ["mesh-shader.wgsl"],
    "cubes":   ["instanced-cubes-shader.wgsl"],
    "planes":  ["instanced-shader.wgsl"],
    "greedy":  ["instanced-greedy-shader.wgsl", "greedy-mesher.js"],
    "raycast": ["ray-shader.wgsl"],
    "hybrid":  ["instanced-greedy-shader.wgsl", "greedy-mesher.js", "ray-shader.wgsl"],
    "fx":      ["fx-shader.wgsl"],
}


def count_loc(path):
    n = 0
    in_block = False
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if not s or s.startswith("//"):
            continue
        if s.startswith("/*"):
            in_block = "*/" not in s
            continue
        n += 1
    return n


def table():
    rows = []
    for tactic, files in TACTIC_FILES.items():
        rows.append({"tactic": tactic, "files": " + ".join(files),
                     "loc": sum(count_loc(PUBLIC / f) for f in files)})
    rows.append({"tactic": "shared core", "files": " + ".join(SHARED),
                 "loc": sum(count_loc(PUBLIC / f) for f in SHARED)})
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--csv"); a = ap.parse_args(argv)
    rows = table()
    for r in rows:
        print(f"{r['tactic']:<12}{r['loc']:>6}  {r['files']}")
    if a.csv:
        with open(a.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Zero-run plot functions** (all operate on E1 at ljubljana/horizon unless noted; all guard empty input)

```python
def _e1_default_view(results, rt=None):
    return [r for r in results if r["experiment"] == "E1" and r["view"] == {"location": "ljubljana", "pitch": "horizon"}
            and (rt is None or _cfg(r, "renderType") == rt) and r["summary"].get("frames")]


def _plot_e1_multimetric(results, figures_dir, report):
    rows = []
    for rt in RENDER_TYPE_ORDER:
        rs = _e1_default_view(results, rt)
        if not rs:
            continue
        med = lambda f: statistics.median([f(r) for r in rs])
        rows.append({"renderType": rt, "mean_fps": med(lambda r: r["summary"]["mean_fps"]),
                     "low1_fps": med(lambda r: r["summary"]["low1_fps"]), "p99_ms": med(lambda r: r["summary"]["p99_ms"]),
                     "gpu_MB": med(lambda r: (_counter(r, "gpuBytes", default=0) or 0) / 1e6),
                     "js_heap_MB": med(lambda r: (_counter(r, "jsHeapBytes", default=0) or 0) / 1e6),
                     "draw_calls": med(lambda r: _counter(r, "frameStats", "chunksRendered", default=0) or 0),
                     "instances_drawn": med(lambda r: _counter(r, "frameStats", "instancesDrawn", default=0) or 0),
                     "quiesce_s": med(lambda r: (r["quiesce"] or {}).get("ms", 0) / 1000),
                     "gpu_p50_ms": med(lambda r: r.get("gpu_summary", {}).get("p50_ms") or 0),
                     "js_p50_ms": med(lambda r: r.get("js_summary", {}).get("p50_ms") or 0)})
    _write_csv(rows, figures_dir / "E1_multimetric.csv")
    if rows:
        hdr = list(rows[0].keys())
        report.append("## E1 multi-metric table (ljubljana/horizon, medians over repeats)\n")
        report.append("Speed is one axis; memory, draw calls and load time are the others. instances_drawn is triangles for mesh.\n")
        report.append("| " + " | ".join(hdr) + " |"); report.append("|" + "---|" * len(hdr))
        for r in rows:
            report.append("| " + " | ".join(f"{v:.1f}" if isinstance(v, float) else str(v) for v in r.values()) + " |")
        report.append("")
    return rows


def _plot_gpu_vs_wall(rows, figures_dir, report):
    rows = [r for r in rows if r.get("mean_fps")]
    if not rows:
        return
    _write_csv(rows, figures_dir / "gpu_vs_wall.csv")
    fig, ax = plt.subplots(figsize=(7, 4.2)); x = range(len(rows)); w = 0.27
    ax.bar([i - w for i in x], [1000 / r["mean_fps"] for r in rows], w, label="wall frame (1000/FPS)", color=INK_MUTED)
    ax.bar(list(x), [r["gpu_p50_ms"] for r in rows], w, label="GPU terrain pass p50", color=CAT_COLORS[0])
    ax.bar([i + w for i in x], [r["js_p50_ms"] for r in rows], w, label="JS render() p50", color=CAT_COLORS[1])
    ax.set_xticks(list(x)); ax.set_xticklabels([r["renderType"] for r in rows]); ax.set_ylabel("ms per frame"); ax.set_yscale("log"); ax.legend(fontsize=7)
    ax.set_title("Where the frame time goes (E1, ljubljana/horizon)"); _style_axes(ax)
    fig.tight_layout(); fig.savefig(figures_dir / "gpu_vs_wall.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "GPU vs wall frame time",
             "If the GPU bar ≈ the wall bar the tactic is GPU-bound; if the GPU bar is a fraction of "
             "the wall bar (raycast, hybrid) the frame is CPU-bound — the JS bar (present for runs "
             "made after 2026-08-23) shows how much of it is main-thread JS. GPU samples: one "
             "timestamp readback in flight, terrain pass only — treat as indicative.",
             ["gpu_vs_wall.png", "gpu_vs_wall.csv"])


def _plot_pacing(rows, figures_dir, report):
    rows = [r for r in rows if r.get("mean_fps")]
    if not rows:
        return
    _write_csv(rows, figures_dir / "pacing.csv")
    fig, ax = plt.subplots(figsize=(7, 4.2)); x = range(len(rows))
    ax.bar([i - 0.2 for i in x], [r["mean_fps"] for r in rows], 0.4, label="mean FPS", color=INK_MUTED)
    ax.bar([i + 0.2 for i in x], [r["low1_fps"] for r in rows], 0.4, label="1% low FPS", color=STATUS_CRITICAL)
    ax.set_xticks(list(x)); ax.set_xticklabels([r["renderType"] for r in rows]); ax.set_ylabel("FPS"); ax.legend(); ax.set_title("Frame pacing: mean vs 1% low (E1, ljubljana/horizon)"); _style_axes(ax)
    fig.tight_layout(); fig.savefig(figures_dir / "pacing.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "Frame pacing",
             "Mean FPS next to the 1 % low. The fast tactics share a 1 % low of ~50-60 FPS regardless "
             "of their mean: they are capped by periodic main-thread stalls (chunk-manager update "
             "loop), not by rendering. Slow tactics have none.",
             ["pacing.png", "pacing.csv"])


def _plot_pitch_invariance(results, figures_dir, report):
    rows = [r for r in table_e1(results) if r["location"] == "ljubljana" and r.get("mean_fps")]
    if not rows:
        return
    _write_csv(rows, figures_dir / "pitch_invariance.csv")
    types = [t for t in RENDER_TYPE_ORDER if any(r["renderType"] == t for r in rows)]
    fig, ax = plt.subplots(figsize=(7, 4.2)); w = 0.27
    for j, p in enumerate(PITCH_ORDER):
        ax.bar([i + (j - 1) * w for i in range(len(types))], [next((r["mean_fps"] for r in rows if r["renderType"] == t and r["pitch"] == p), 0) for t in types], w, label=p, color=CAT_COLORS[j])
    ax.set_xticks(range(len(types))); ax.set_xticklabels(types); ax.set_ylabel("mean FPS"); ax.set_yscale("log"); ax.legend(); ax.set_title("Pitch invariance = no frustum culling (E1, ljubljana)"); _style_axes(ax)
    fig.tight_layout(); fig.savefig(figures_dir / "pitch_invariance.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "Pitch invariance",
             "Looking straight up (empty sky) costs the same as looking at terrain: nothing is "
             "frustum-culled, and the loader downloads the same bytes regardless of pitch. The "
             "up-vs-horizon gap is the upper bound on what frustum culling could buy.",
             ["pitch_invariance.png", "pitch_invariance.csv"])


def _plot_e2_bandwidth(results, figures_dir, report):
    e2 = [r for r in results if r["experiment"] == "E2" and not r.get("error")]
    rows = []
    for r in sorted(e2, key=lambda r: _cfg(r, "chunkSize")):
        q = (r["quiesce"] or {}).get("ms") or 0
        b = _net_total_bytes(r.get("counters_after") or {})
        m = (_counter(r, "net", "ws", "messages", default=0) or 0) + (_counter(r, "net", "http", "requests", default=0) or 0)
        rows.append({"chunkSize": _cfg(r, "chunkSize"), "repeat": r["repeat"], "bytes": b, "MB": b / 1e6,
                     "messages": m, "quiesce_s": q / 1000, "msg_per_s": (m / (q / 1000)) if q else None,
                     "MB_per_s": (b / 1e6 / (q / 1000)) if q else None, "dataset_pct": 100 * b / DATASET_BYTES})
    if not rows:
        return
    _write_csv(rows, figures_dir / "E2_bandwidth.csv")
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    a1.plot([x["chunkSize"] for x in rows], [x["MB"] for x in rows], "o-", color=CAT_COLORS[0]); a1.set_ylabel("bytes to quiescence (MB)"); a1.set_yscale("log")
    a2.plot([x["chunkSize"] for x in rows], [x["msg_per_s"] or 0 for x in rows], "o-", color=CAT_COLORS[1], label="responses / s")
    a2b = a2.twinx(); a2b.plot([x["chunkSize"] for x in rows], [x["MB_per_s"] or 0 for x in rows], "s--", color=CAT_COLORS[2], label="MB / s"); a2b.set_ylabel("MB / s")
    a2.set_ylabel("responses / s"); a2.legend(loc="upper left", fontsize=7); a2b.legend(loc="upper right", fontsize=7)
    for ax in (a1, a2):
        ax.set_xscale("log", base=2); ax.set_xlabel("chunk size (px)"); _style_axes(ax)
    fig.suptitle("E2: streaming cost vs chunk size"); fig.tight_layout()
    fig.savefig(figures_dir / "E2_bandwidth.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "E2 bandwidth",
             "Bytes downloaded until the view is complete, and the request/throughput rates. The "
             "responses/s plateau at small sizes is the fixed per-request cost (server decodes a whole "
             "tile per request); the MB/s plateau at large sizes is the decode/transfer ceiling.",
             ["E2_bandwidth.png", "E2_bandwidth.csv"])


def _plot_load_curves(results, figures_dir, report):
    rs = [r for r in results if (r.get("raw") or {}).get("loadCurve")]
    if not rs:
        return
    # one curve per (experiment, renderType, location), first run wins
    seen, picks = set(), []
    for r in rs:
        k = (r["experiment"], _cfg(r, "renderType"), r["view"]["location"])
        if k not in seen:
            seen.add(k); picks.append(r)
    picks = picks[:8]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 4.2))
    for i, r in enumerate(picks):
        c = r["raw"]["loadCurve"]; t = [s["t"] / 1000 for s in c]; lab = f"{r['experiment']} {_cfg(r, 'renderType')} {r['view']['location']}"
        a1.plot(t, [s["wsBytes"] / 1e6 for s in c], label=lab, color=CAT_COLORS[i % len(CAT_COLORS)])
        a2.plot(t, [s["chunksResident"] for s in c], label=lab, color=CAT_COLORS[i % len(CAT_COLORS)])
    a1.set_ylabel("bytes received (MB)"); a2.set_ylabel("chunks resident")
    for ax in (a1, a2):
        ax.set_xlabel("time since configure (s)"); ax.legend(fontsize=6); _style_axes(ax)
    fig.suptitle("Streaming: load curves to quiescence"); fig.tight_layout()
    fig.savefig(figures_dir / "load_curves.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "Load curves",
             "Bytes and resident chunks over time from configure to quiescence (runs made after "
             "2026-08-23 carry raw.loadCurve). The first flat segment is the serial 64-base-chunk "
             "init; the knee is 'country visible at coarse LOD'; the tail is refinement near the camera.",
             ["load_curves.png"])


def _plot_noise(results, figures_dir, report):
    base = {k: v for k, v in BASE_CONFIG_FOR_NOISE.items()}
    rs = [r for r in results if r["view"] == {"location": "ljubljana", "pitch": "horizon"}
          and {k: r["config"].get(k) for k in base} == base and r["summary"].get("frames") and not r.get("error")]
    if len(rs) < 2:
        return
    fps = [r["summary"]["mean_fps"] for r in rs]
    mean = statistics.mean(fps); sd = statistics.stdev(fps)
    rows = [{"run_id": r["run_id"], "experiment": r["experiment"], "mean_fps": r["summary"]["mean_fps"], "started_at": r.get("started_at")} for r in rs]
    _write_csv(rows, figures_dir / "noise.csv")
    fig, ax = plt.subplots(figsize=(6, 3.8))
    ax.plot(range(len(fps)), fps, "o", color=CAT_COLORS[0]); ax.axhline(mean, color=INK_MUTED); ax.axhspan(mean - sd, mean + sd, color=GRIDLINE, alpha=0.6)
    ax.set_xlabel("replicate (chronological)"); ax.set_ylabel("mean FPS"); ax.set_title(f"Repeatability: hybrid/ljubljana/horizon, n={len(fps)}, CV={100*sd/mean:.1f}%"); _style_axes(ax)
    fig.tight_layout(); fig.savefig(figures_dir / "noise.png", dpi=150, bbox_inches="tight"); plt.close(fig)
    _section(report, "Noise band",
             f"Every replicate of the default cell across all experiments: {mean:.1f} ± {sd:.1f} FPS "
             f"(CV {100*sd/mean:.1f} %). Differences smaller than ~2 CV are not findings.",
             ["noise.png", "noise.csv"])
```

with `BASE_CONFIG_FOR_NOISE = {"renderType": "hybrid", "strategy": "quad", "chunkSize": 128, "viewDistance": None, "lodMin": 0, "lodMax": 9, "fx": False, "culling": False, "sockets": True}` at module level (do not import from matrix — plot must not depend on it).

Also add the LOC table to the report: at the end of `write_all`, `from bench.loc import table as loc_table` → write `loc_table.csv` and a markdown table under "## Simplicity proxy (LOC)".

Register in `write_all` after the E1 block:

```python
    mm = _plot_e1_multimetric(results, figures_dir, report)
    _plot_gpu_vs_wall(mm, figures_dir, report)
    _plot_pacing(mm, figures_dir, report)
    _plot_pitch_invariance(results, figures_dir, report)
    _plot_e2_bandwidth(results, figures_dir, report)
    _plot_load_curves(results, figures_dir, report)
    _plot_noise(results, figures_dir, report)
```

Also fix `DATASET_BYTES = 74_825_000_000  # clean pyramid, measured 2026-08-22 (was 70 GiB)`.

- [ ] **Step 4: Tests + regenerate**

`venv\Scripts\python -m pytest bench/tests/ -q` → PASS. `venv\Scripts\python -m bench.loc` prints the table. Regenerate both figure dirs (commands in Task 7 step 11) and glance at `bench/figures/report.md`.

- [ ] **Step 5: Commit**

```bash
git add bench/plot.py bench/loc.py bench/tests/test_plot.py bench/tests/test_loc.py bench/figures bench/figures-full-sweep
git commit -m "plot: zero-run figures (multi-metric, gpu-vs-wall, pacing, pitch, bandwidth, load curves, noise) + LOC table"
```

---

### Task 9: README — how to run and read the new campaigns

**Files:**
- Modify: `bench/README.md`
- Modify: `CLAUDE.md` (one line: current phase)

- [ ] **Step 1: README**

Extend "The Campaigns" with a table for E6–E14 (question / cells / figure), and replace the "Running the campaigns" block's tail with:

```powershell
# 7) Gap campaign (2026-08-23): ONE overnight, ~4-5 h. Checkpointed; rerun the same line
#    after any interruption. Includes the extra E2/E5 repeats and the E4 HTTP redo
#    (the pre-fix E4 HTTP results live in bench/results-e4-before-slash-fix/).
venv\Scripts\python -m bench.driver --experiments overnight,E4 --results-dir bench/results-full-sweep

# 8) iGPU session (~1 h, separate day is fine). Flip the Playwright Chromium
#    GpuPreference value to 1; (or delete it) in
#    HKCU\Software\Microsoft\DirectX\UserGpuPreferences, then:
venv\Scripts\python -m bench.driver --experiments igpu --results-dir bench/results-igpu --expect-gpu intel
#    ...and set GpuPreference back to 2; afterwards. The driver aborts on the first run
#    if the vendor is wrong, so a forgotten flip costs one run, not a session.

# 9) Figures: load BOTH results dirs so cross-experiment baselines (E1 medians, E2 hybrid
#    curve) are available; the iGPU dir gets its own figures with E1 as the RTX reference.
venv\Scripts\python -m bench.plot --results-dir bench/results bench/results-full-sweep --figures-dir bench/figures-full-sweep
venv\Scripts\python -m bench.plot --results-dir bench/results-igpu bench/results --figures-dir bench/figures-igpu
venv\Scripts\python -m bench.loc   # the "simplest" axis table
```

Add a "Reading the results" subsection: `report.md` in each figures dir opens every experiment with a "what this shows" paragraph; every PNG has a CSV twin; new result fields (`js_summary`, `raw.loadCurve`, `counters_after.byLod/emptyChunks/meshStats`, `net.http.phases`, `server_stats`, `git_dirty`) are only present in runs made after 2026-08-23.

- [ ] **Step 2: CLAUDE.md current-phase line**

Replace the "Current phase" paragraph's last sentence with: "Gap campaign (E6–E14 + repeats + E4 redo) implemented 2026-08-23 — see `bench/README.md` §7–9 for the two commands; run it, then `bench.plot`, then write."

- [ ] **Step 3: Full test run + commit**

`venv\Scripts\python -m pytest python/tests/ bench/tests/ -q` → PASS.

```bash
git add bench/README.md CLAUDE.md
git commit -m "docs: gap campaign run/read instructions"
```

---

## Self-review

- **Spec coverage:** instrumentation table → Tasks 2–4 (load curve, byLod, empty, JS time, mesh timers, HTTP phases, server stats, git dirty, slash, knobs ✓). Experiments table → Task 1 (E2/E5 reps, E6–E14 ✓), E4 redo → Task 6 ✓. Aliases + `--expect-gpu` → Tasks 1, 4 ✓. Plots per experiment → Task 7 ✓; zero-run figures + loc.py → Task 8 ✓. Tests + smoke → Tasks 1, 4, 5, 7, 8 ✓. README → Task 9 ✓.
- **Placeholders:** none; every code step has the code.
- **Type consistency:** `Run.screenshot` (Task 1) ↔ `run.screenshot` (Task 4); `hybridNear`/`maxLoading`/`viewport` keys (Task 1) ↔ `configure` (Task 2) ↔ `viewport_for` (Task 4) ↔ `_cfg(r, "viewport")` (Task 7); `waitForQuiescence().loadCurve` (Task 3) ↔ `result["quiesce"].pop("loadCurve")` (Task 4) ↔ `raw.loadCurve` (Task 8); `record().jsFrameTimesMs` ↔ `aggregate_js` ↔ `js_summary.p50_ms` (Task 8); `counters_after.byLod[lod].resident` (Task 3) ↔ `_plot_e13`; `/bench_stats.mean_ms` ↔ `_plot_e12.server_mean_ms`; `load_results(list)` / `write_all(list, dir)` ↔ tests.
