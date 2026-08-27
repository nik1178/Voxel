# Benchmark Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An automated, resumable benchmark harness that measures FPS/frame-times, scale counters, and network bytes across the app's render tactics and settings, and emits thesis-ready figures + CSV/JSON data.

**Architecture:** An in-page API (`window.__bench`) drives the existing CustomEvent plumbing plus small instrumentation hooks in the renderer/strategies; a Python Playwright driver runs one config per fresh page load, checkpointing each result to JSON; a separate plotting script derives figures/CSVs/report from the JSONs only.

**Tech Stack:** Vanilla JS (no build step, ES modules), WebGPU timestamp queries, Python 3 in `venv` (Playwright, matplotlib, psutil, pytest).

**Spec:** `docs/superpowers/specs/2026-07-31-benchmark-harness-design.md`

## Global Constraints

- Windows; the Python interpreter is `venv\Scripts\python` run from repo root `D:\DProjects\Voxel\server`. Python modules import as `python.xxx` / `bench.xxx`.
- Chunk sizes MUST be even (odd crashes: delta chunks stitch in 2×2 quadrants). Sizes need not divide 1000.
- One benchmark config per fresh page load. Never measure across a live settings change.
- JSON per run is the source of truth; figures/CSVs are derived and regenerating them must never re-run a benchmark.
- Never run benchmarks concurrently with `build_quad_tree.py` (a rebuild is running as of 2026-07-31 — building/testing the harness is fine, real sweeps are not).
- No refactoring beyond what a task names. No new frameworks. Client code stays framework-free ES modules served statically by Flask.
- The client has no JS test framework — client tasks are verified by concrete browser/driver checks instead of unit tests. Do not introduce a JS test framework.
- Radius strategy MUST always be given a finite view distance (`chunk-radius-strategy.js:80` loops `layer <= radius` — `Infinity` hangs the tab).
- Commit after every task with the message given in the task.

## Shared vocabulary (used by every task)

**Config object** (same JSON shape in JS and Python):

```json
{
  "renderType": "greedy",        // "mesh"|"cubes"|"planes"|"greedy"|"raycast"|"hybrid"
  "strategy": "quad",            // "quad"|"radius"
  "chunkSize": 128,              // even int
  "viewDistance": null,          // null => Infinity; number in world units otherwise
  "lodMin": 0, "lodMax": 9,
  "fx": false, "culling": false,
  "sockets": true,               // true = WebSocket, false = HTTP RPC
  "timeoutS": 600                // quiescence timeout, driver-side
}
```

**View object:** `{ "location": "ljubljana", "pitch": "horizon" }` — resolved via `LOCATIONS` / `PITCHES` tables in `bench/matrix.py` (Task 7).

**Result JSON** (one file per run, `bench/results/<run_id>.json`):

```json
{
  "run_id": "E1-a3f9c2d1-r0", "experiment": "E1", "repeat": 0,
  "config": { }, "view": { },
  "started_at": "2026-08-01T02:14:11", "git_rev": "8fb92f7", "lod_dir": "lod_output",
  "quiesce": { "quiesced": true, "ms": 48211 },
  "summary": { "mean_fps": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0, "low1_fps": 0, "frames": 0 },
  "gpu_summary": { "p50_ms": 0, "p95_ms": 0, "frames": 0 },
  "raw": { "frameDtsMs": [], "gpuFrameTimesMs": [] },
  "counters_before": { }, "counters_after": { },
  "provenance": { "canvas": {}, "adapterInfo": {}, "timestampQuery": true, "userAgent": "" },
  "device_lost": null, "error": null
}
```

---

### Task 1: Correct FPS math, first-frame skip, and bench frame hook

**Files:**
- Modify: `public/game-manager.js:65-97`

**Interfaces:**
- Produces: `GameManager.frame()` calls `window.__bench?.onFrame?.(dt)` every frame with `dt` in **seconds** (Task 6 consumes). On-screen FPS becomes `N/Σdt` over the last 100 frames.

- [ ] **Step 1: Replace `updateFPS` and add the hook + first-frame skip**

In `public/game-manager.js`, replace the block from `lastTime = 0;` (line 65) through the end of `updateFPS` (line 97) with:

```js
  lastTime = 0;
  lastFrames = []; // per-frame dt in seconds
  framesToCapture = 100;
  async frame(time) {
    if (!this.running) return;

    // First frame has no valid previous timestamp; skip its dt entirely.
    if (this.lastTime === 0) {
      this.lastTime = time;
      requestAnimationFrame(this.frame.bind(this));
      return;
    }

    let dt = (time - this.lastTime) / 1000;
    this.lastTime = time;
    this.updateFPS(dt);
    window.__bench?.onFrame?.(dt);

    this.player.update(dt);
    this.renderer.updateVPMatrix(this.player.camera, this.canvas);
    this.renderer.render(dt);

    // --------------------------------------------
    requestAnimationFrame(this.frame.bind(this));
  }

  updateFPS(dt) {
    if (!this.fpsCounter) return;
    if (!isFinite(dt) || dt <= 0) return;
    this.lastFrames.push(dt);
    if (this.lastFrames.length > this.framesToCapture) {
      this.lastFrames.shift();
    }
    const total = this.lastFrames.reduce((a, b) => a + b, 0);
    // Correct mean FPS: frames / elapsed time (NOT mean of instantaneous 1/dt,
    // which overstates FPS and hides stutter).
    this.fpsCounter.innerText = (this.lastFrames.length / total).toFixed(2);
  }
```

- [ ] **Step 2: Verify in browser**

Run: `venv\Scripts\python server.py` (leave running for later tasks). Open `http://localhost:8000` in Chrome. Expected: terrain renders as before, FPS counter shows a plausible number (~vsync cap), no console errors. In DevTools console run `window.__bench` → `undefined` is fine (Task 6 defines it); the optional-chaining call must not throw.

- [ ] **Step 3: Commit**

```bash
git add public/game-manager.js
git commit -m "fix: FPS counter uses N/sum(dt); skip first frame; bench onFrame hook"
```

---

### Task 2: 404 `isLoading` fix + pass stats in both strategies

**Files:**
- Modify: `public/chunk-quad-strategy.js`
- Modify: `public/chunk-radius-strategy.js`
- Modify: `public/chunk-manager.js`

**Interfaces:**
- Produces: both strategy classes expose `getStats()` → `{ passes: int, queuedLastPass: int, destroyedLastPass: int, loading: int }`; `ChunkManager.getStrategyStats()` proxies to the active strategy. `ChunkNode.is404` marks empty-forever nodes. Task 6's `waitForQuiescence` consumes `getStrategyStats()`.

- [ ] **Step 1: Add pass stats and the 404 fix to `chunk-quad-strategy.js`**

Add to class `ChunkQuadStrategy` (next to `howManyChunksLoading` at line 48):

```js
  passStats = { passes: 0, queuedLastPass: 0, destroyedLastPass: 0 };

  getStats() {
    // `initializing` matters: during the serial base-chunk init, `passes` does
    // not advance and the counters read quiet — quiescence must not fire then.
    return {
      ...this.passStats,
      loading: this.howManyChunksLoading,
      initializing: !!this.initializing || !this.quadTree,
    };
  }
```

In `updateChunks`, immediately after the `if (this.initializing) { return; }` block (line 83-85), start pass accounting:

```js
    this.passStats.passes++;
    let queuedThisPass = 0;
    let destroyedThisPass = 0;
```

In the node loop: where `nodesToLoad.push(chunkNode)` happens (line 130) add `queuedThisPass++;`, and where `chunkNode.destroyFamily()` happens (line 136) add `destroyedThisPass++;`. Also add a skip for dead nodes at the top of the loop body, right after `if (chunkNode.isLoading) { continue; }` (line 112-114):

```js
      if (chunkNode.is404) {
        continue; // permanently empty (outside survey); never subdivide or re-request
      }
```

Before EVERY `return` that exits `updateChunks` after the accounting started (the `nodesToLoad.length === 0` return at line 140-142 and the end of the function), write the totals back. To avoid missing an exit path, restructure the tail of the function: replace `if (nodesToLoad.length === 0) { return; }` with:

```js
    this.passStats.queuedLastPass = queuedThisPass;
    this.passStats.destroyedLastPass = destroyedThisPass;
    if (nodesToLoad.length === 0) {
      return;
    }
```

(The loading loop below it queues exactly the nodes already counted, so writing stats before it is correct.)

Fix the 404 leak in the child-load `.then` (lines 163-168) — replace:

```js
        return this.chunkMesher.generateChunkData(childChunkNode.chunk, chunkNode.chunk).then(res => {
          if (res === 404) {
            vprint(`Chunk at (${chunkX}, ${chunkZ}) not found (404). Skipping.`);
            return;
          }
          childChunkNode.isLoading = false;
        }).catch(err => {
```

with:

```js
        return this.chunkMesher.generateChunkData(childChunkNode.chunk, chunkNode.chunk).then(res => {
          childChunkNode.isLoading = false;
          if (res === 404) {
            // Permanently empty (outside the survey). Previously isLoading stayed
            // true forever, which pinned the parent at low LOD and made
            // quiescence unobservable.
            childChunkNode.is404 = true;
            vprint(`Chunk at (${chunkX}, ${chunkZ}) not found (404). Skipping.`);
          }
        }).catch(err => {
          childChunkNode.isLoading = false;
          childChunkNode.is404 = true;
```

(keep the existing `console.error` line inside the catch).

In `class ChunkNode`, add the field next to `parent`/`chunk`/`children` (line 285-288):

```js
  is404 = false;
```

In `ChunkNode.getAllChunks()` (line 290): 404 nodes must not contribute a chunk (they have no textures — the renderer would just log-skip them). Replace the final `if (this.chunk) { chunks.push(this.chunk); }` block with:

```js
    if (this.chunk && !this.is404) {
      chunks.push(this.chunk);
    } else if (!this.chunk) {
      vprint("Warning: Leaf node without chunk");
    }
    return chunks;
```

- [ ] **Step 2: Add pass stats to `chunk-radius-strategy.js`**

Add to class `ChunkRadiusStrategy` (next to `radius = Infinity`, line 24):

```js
  passStats = { passes: 0, queuedLastPass: 0, destroyedLastPass: 0 };

  getStats() {
    return { ...this.passStats, loading: this.chunksLoading, initializing: false };
  }
```

In `updateChunks` (line 65), after computing `currentChunkX/Z` add:

```js
    this.passStats.passes++;
    let queuedThisPass = 0;
```

Increment `queuedThisPass++;` right before `this.chunkMesher.generateChunkData(chunk, null, "v1")` (line 118). Because the function has three `return` exits inside the loops, write the counter in a `try/finally` — wrap the `this.breakLoop = false;` line and everything after it:

```js
    this.breakLoop = false;
    try {
      // ... existing triple loop unchanged, with queuedThisPass++ added ...
    } finally {
      this.passStats.queuedLastPass = queuedThisPass;
      this.passStats.destroyedLastPass = 0;
    }
```

- [ ] **Step 3: Add the proxy in `chunk-manager.js`**

Add a method to `ChunkManager` (after `getChunkData()`, line 104-106):

```js
  getStrategyStats() {
    return this.activeStrategy.getStats();
  }
```

- [ ] **Step 4: Verify in browser**

Reload `http://localhost:8000`. In DevTools console (game must be running):
`document.querySelector("canvas")` — then get stats via the console after Task 6 wires `__bench`; for now verify by temporarily running in console. Expected: `passes` climbing continuously, `queuedLastPass` mostly 1 while loading, `0` once the view stops changing; no console errors; terrain edges (fly toward the map border with a high speed via mouse wheel) show loaded high-LOD chunks instead of a permanently coarse parent.

There is no handle to the strategy from the console yet — verify indirectly: no errors, terrain still loads, and border areas sharpen over time where they previously stayed coarse. Full stats verification happens in Task 6 Step 4.

- [ ] **Step 5: Commit**

```bash
git add public/chunk-quad-strategy.js public/chunk-radius-strategy.js public/chunk-manager.js
git commit -m "fix: 404 chunks no longer pin isLoading forever; per-pass strategy stats"
```

---

### Task 3: UI state sync (`applyState`, `Slider.setValue`)

**Files:**
- Modify: `public/ui-manager.js`
- Modify: `public/game-manager.js:32-42` (startGame)

**Interfaces:**
- Produces: `UIManager.applyState({renderType, strategy, fx, sockets, culling, chunkSize})` — updates DOM control visuals WITHOUT dispatching change events. `Slider.setValue(value)` positions a single-handle slider. Task 6's `configure` consumes `applyState`.

- [ ] **Step 1: Keep slider references and add `Slider.setValue`**

In `UIManager.setupListeners` (line 65-70), assign the sliders to fields:

```js
        const chunkSizeSlider = document.querySelector("#chunk-size");
        this.chunkSizeSlider = new Slider(chunkSizeSlider, 2, 1000, false, 0, 2);
        const viewDistanceSlider = document.querySelector("#view-distance");
        this.viewDistanceSlider = new Slider(viewDistanceSlider, 0, 200000, false, 0, 5);
        const lodLimitsSlider = document.querySelector("#lod-limits");
        this.lodLimitsSlider = new Slider(lodLimitsSlider, 0, 9, true, 0);
```

Add to `class Slider` (after `dispatch()`, line 225-228):

```js
    // Position the handle to show `value` without dispatching a change event.
    // Single-handle sliders only (double sliders are not needed by applyState).
    setValue(value) {
        if (this.double) return;
        value = Math.max(this.minVal, Math.min(this.maxVal, value));
        const rangeValue = ((value - this.minVal) / (this.maxVal - this.minVal)) ** (1 / this.exponent);
        this.value = value;
        this.handle1.value = value;
        this.positionHandle(this.handle1, rangeValue);
        this.maxContainer.innerText = value.toFixed(this.decimalPlaces);
    }
```

- [ ] **Step 2: Add `applyState` to `UIManager`**

```js
    // Make the DOM controls display the given state. Never dispatches events —
    // this reflects state, it does not cause it.
    applyState(state) {
        const renderTypeSelect = document.querySelector(".render-type-container select");
        if (renderTypeSelect && state.renderType !== undefined) renderTypeSelect.value = state.renderType;
        const strategySelect = document.querySelector(".chunk-strategy-container select");
        if (strategySelect && state.strategy !== undefined) strategySelect.value = state.strategy;
        if (state.fx !== undefined) this.setToggle("fx-toggle", state.fx);
        // The toggle's label is "RPC not Websockets": active means HTTP.
        if (state.sockets !== undefined) this.setToggle("socket-toggle", !state.sockets);
        if (state.culling !== undefined) this.setToggle("culling-toggle", state.culling);
        if (state.chunkSize !== undefined) this.chunkSizeSlider.setValue(state.chunkSize);
    }

    setToggle(id, active) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("active", !!active);
    }
```

- [ ] **Step 3: Sync on startup in `game-manager.js`**

In `startGame()` (line 40, after `this.uiManager = new UIManager();`):

```js
    // The renderer's defaults and the static HTML disagree on load; make the
    // UI display what is actually rendering.
    this.uiManager.applyState({
      renderType: this.renderer.renderType,
      strategy: "quad",
      fx: this.renderer.useFX,
      sockets: true,
      culling: this.renderer.manualCulling,
      chunkSize: this.renderer.chunkSize,
    });
```

- [ ] **Step 4: Verify in browser**

Reload. Expected: the render-type dropdown shows **hybrid** (not Mesh), the FX toggle renders active, "RPC not Websockets" inactive, chunk-size slider handle sits near 128's position. Changing the dropdown still works (events still flow). No console errors.

- [ ] **Step 5: Commit**

```bash
git add public/ui-manager.js public/game-manager.js
git commit -m "fix: UI controls reflect actual renderer state on load; Slider.setValue"
```

---

### Task 4: Network byte counters

**Files:**
- Modify: `public/chunk-websocket.js`

**Interfaces:**
- Produces: `window.__netStats = { wsBytes, wsMessages, requestsSent, firstResponseAt }` (numbers; `firstResponseAt` = `performance.now()` ms or `null`). Task 6 consumes it and resets it via `window.__netStats.reset()`.

- [ ] **Step 1: Add counters to `chunk-websocket.js`**

At module top (before the class):

```js
// Benchmark instrumentation: WS transfer counters, reset per benchmark run.
export const netStats = {
  wsBytes: 0,
  wsMessages: 0,
  requestsSent: 0,
  firstResponseAt: null,
  reset() {
    this.wsBytes = 0;
    this.wsMessages = 0;
    this.requestsSent = 0;
    this.firstResponseAt = null;
  },
};
window.__netStats = netStats;
```

In `onmessage` (line 14), after the `instanceof ArrayBuffer` guard:

```js
      netStats.wsBytes += buffer.byteLength;
      netStats.wsMessages += 1;
      if (netStats.firstResponseAt === null) netStats.firstResponseAt = performance.now();
```

In `requestChunk` (line 49), right after the `readyState` guard passes:

```js
      netStats.requestsSent += 1;
```

- [ ] **Step 2: Verify in browser**

Reload, let chunks stream a few seconds, console: `window.__netStats` → `wsBytes` in the millions and climbing, `firstResponseAt` a small number. `window.__netStats.reset()` zeroes it.

- [ ] **Step 3: Commit**

```bash
git add public/chunk-websocket.js
git commit -m "feat: WebSocket transfer counters for benchmarking"
```

---

### Task 5: Renderer frame stats + GPU timestamp queries

**Files:**
- Modify: `public/main.js:10-31`
- Modify: `public/renderer.js` (init ~line 106-172, render ~line 776-1064)

**Interfaces:**
- Produces: `renderer.frameStats = { drawCalls, instancesDrawn, chunksRendered, chunksResident }` (rebuilt every frame); `renderer.gpuFrameTimes` (array of main-pass durations in ms, rolling cap 20000, empty array when the feature is missing); `window.__gpuAdapterInfo` (plain object); `window.__deviceLost` (`null` or `{reason, message}`). Task 6 consumes all four.

- [ ] **Step 1: Request the feature and expose adapter info / device-lost in `main.js`**

In `initWebGPU()` replace `const device = await adapter.requestDevice();` with:

```js
  const requiredFeatures = adapter.features.has("timestamp-query")
    ? ["timestamp-query"]
    : [];
  const device = await adapter.requestDevice({ requiredFeatures });
  if (!device) alertError("Failed to get GPU device.");

  // Benchmark provenance + failure capture (E3 needs device-loss as a result).
  const info = adapter.info;
  window.__gpuAdapterInfo = {
    vendor: info?.vendor ?? null,
    architecture: info?.architecture ?? null,
    device: info?.device ?? null,
    description: info?.description ?? null,
    timestampQuery: requiredFeatures.length > 0,
  };
  window.__deviceLost = null;
  device.lost.then((e) => {
    window.__deviceLost = { reason: e.reason, message: e.message };
  });
```

- [ ] **Step 2: Create timestamp resources in `renderer.init`**

In `init()` after `this.createBindGroups();` (line 160):

```js
    // GPU timing of the main terrain pass via timestamp queries (feature-gated).
    this.gpuFrameTimes = [];
    if (this.device.features.has("timestamp-query")) {
      this.tsQuerySet = this.device.createQuerySet({ type: "timestamp", count: 2 });
      this.tsResolveBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.tsReadBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.tsPending = false;
    }
```

- [ ] **Step 3: Wire timestamps + frame stats into `render`**

At the top of `render(dt)` after `this.frameIndex++;` (line 778):

```js
    this.frameStats = { drawCalls: 0, instancesDrawn: 0, chunksRendered: 0, chunksResident: 0 };
```

Add `timestampWrites` to the main pass descriptor (line 783) — the pass becomes:

```js
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [ /* unchanged */ ],
      depthStencilAttachment: { /* unchanged */ },
      ...(this.tsQuerySet && !this.tsPending && {
        timestampWrites: {
          querySet: this.tsQuerySet,
          beginningOfPassWriteIndex: 0,
          endOfPassWriteIndex: 1,
        },
      }),
    });
```

After `const chunkData = this.chunkManager.getChunkData();` (line 804): `this.frameStats.chunksResident = chunkData.size;`

In the draw branches (lines 929-1001) add counters:
- raycast: `this.frameStats.drawCalls++; this.frameStats.instancesDrawn += 1;`
- greedy (inside the `if (chunk.instanceBuffer)`): `this.frameStats.drawCalls++; this.frameStats.instancesDrawn += chunk.instanceArray.length / 2;`
- cubes: `this.frameStats.drawCalls++; this.frameStats.instancesDrawn += chunk.chunkSize * chunk.chunkSize;`
- planes (after `facesToRender` is final, next to the existing `pass.drawIndexed`): `this.frameStats.drawCalls++; this.frameStats.instancesDrawn += chunk.chunkSize * chunk.chunkSize * facesToRender;`
- mesh (inside the `if (chunk.vertexBuffer && chunk.indexBuffer)`): `this.frameStats.drawCalls++; this.frameStats.instancesDrawn += chunk.indexCount / 3;` (triangles, not instances — documented in Task 6's counters)

And once per chunk that reaches the draw branches (right before `let useGreedy = ...`, line 912): `this.frameStats.chunksRendered++;`

After `pass.end();` (line 1005):

```js
    if (this.tsQuerySet && !this.tsPending) {
      commandEncoder.resolveQuerySet(this.tsQuerySet, 0, 2, this.tsResolveBuffer, 0);
      commandEncoder.copyBufferToBuffer(this.tsResolveBuffer, 0, this.tsReadBuffer, 0, 16);
      this.tsReadPendingThisFrame = true;
    } else {
      this.tsReadPendingThisFrame = false;
    }
```

After `this.device.queue.submit([commandEncoder.finish()]);` (line 1063):

```js
    if (this.tsReadPendingThisFrame) {
      this.tsPending = true;
      this.tsReadBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(this.tsReadBuffer.getMappedRange().slice(0));
        this.tsReadBuffer.unmap();
        const ms = Number(t[1] - t[0]) / 1e6;
        if (ms >= 0 && ms < 10000) {
          this.gpuFrameTimes.push(ms);
          if (this.gpuFrameTimes.length > 20000) this.gpuFrameTimes.shift();
        }
        this.tsPending = false;
      }).catch(() => { this.tsPending = false; });
    }
```

Note the guard interplay: while a map is pending, the pass runs WITHOUT `timestampWrites` and without resolve/copy, so the mapped buffer is never written. Frames measured by GPU timing are therefore a subset (roughly every other frame) — fine for percentile statistics; note it in the thesis text.

- [ ] **Step 4: Verify in browser**

Reload. Console:
- `window.__gpuAdapterInfo` → object with `timestampQuery: true` (on this machine's Chrome + RTX it should be available; if `false`, everything still runs and `gpuFrameTimes` stays empty — that fallback is by design).
- After a few seconds, from console there is no direct renderer handle yet; final check happens in Task 6 Step 4. For now: no console errors, no WebGPU validation warnings, terrain renders in all 6 render types (switch the dropdown through each).

- [ ] **Step 5: Commit**

```bash
git add public/main.js public/renderer.js
git commit -m "feat: per-frame render stats and GPU timestamp queries (feature-gated)"
```

---

### Task 6: `public/bench-api.js` + wiring

**Files:**
- Create: `public/bench-api.js`
- Modify: `public/main.js:33-38`

**Interfaces:**
- Consumes: `onFrame` hook (Task 1), `getStrategyStats()` (Task 2), `applyState` (Task 3), `window.__netStats` (Task 4), `frameStats`/`gpuFrameTimes`/`__gpuAdapterInfo`/`__deviceLost` (Task 5), `CommandConverter.coordinatesToPosition` (existing).
- Produces: `window.__bench` with the API below; `window.__bench.ready === true` once init ran and `renderer.initialized` is true. The Python driver (Task 9) calls exactly these:
  - `configure(cfg)` — cfg is the shared Config object; `viewDistance: null` → `Infinity`; throws on odd `chunkSize`.
  - `teleport({ latLng, position, y, pitch, yaw })` — `latLng` = `[lat, lng]`, or `position` = `[x, z]` world units.
  - `waitForQuiescence({ timeoutMs })` → `Promise<{quiesced, ms}>`.
  - `record({ warmupMs, durationMs })` → `Promise<{frameDtsMs, gpuFrameTimesMs, countersBefore, countersAfter}>`.
  - `getCounters()`, `getProvenance()`.

- [ ] **Step 1: Write `public/bench-api.js`**

```js
/**
 * Benchmark API. Drives the app through its existing CustomEvent plumbing.
 * Inert unless a driver (Playwright) calls it. No UI, no rendering impact.
 */
import { CommandConverter } from "./command-converter.js";

const QUIET_POLLS = 20;   // consecutive 200ms polls with a quiet pass
const POLL_MS = 200;

function gpuBytesFor(chunk) {
  let b = 0;
  if (chunk.colorTexture) b += chunk.colorTexture.width * chunk.colorTexture.height * 4;
  if (chunk.heightTexture) b += chunk.heightTexture.width * chunk.heightTexture.height * 2;
  if (chunk.instanceBuffer) b += chunk.instanceBuffer.size;
  if (chunk.vertexBuffer) b += chunk.vertexBuffer.size;
  if (chunk.indexBuffer) b += chunk.indexBuffer.size;
  if (chunk.chunkInfoBuffer) b += chunk.chunkInfoBuffer.size;
  return b;
}

class BenchAPI {
  gameManager = null;
  ready = false;
  frameDts = null; // recording buffer; null = not recording
  converter = new CommandConverter();

  init(gameManager) {
    this.gameManager = gameManager;
    // Default resource-timing buffer is 250 entries; HTTP runs make thousands.
    performance.setResourceTimingBufferSize(1000000);
    this.ready = true;
  }

  onFrame(dt) {
    if (this.frameDts) this.frameDts.push(dt);
  }

  configure(cfg) {
    if (cfg.chunkSize % 2 !== 0) {
      throw new Error(`chunkSize must be even, got ${cfg.chunkSize}`);
    }
    const viewDistance = cfg.viewDistance == null ? Infinity : cfg.viewDistance;
    if (cfg.strategy === "radius" && viewDistance === Infinity) {
      throw new Error("radius strategy requires a finite viewDistance (infinite loop otherwise)");
    }
    const cm = this.gameManager.renderer.chunkManager;
    cm.pauseLoop();
    const ev = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
    ev("render-type-changed", cfg.renderType);
    ev("chunk-strategy-changed", cfg.strategy);
    ev("socket-toggled", !cfg.sockets); // the toggle means "RPC not Websockets"
    ev("fx-toggled", !!cfg.fx);
    ev("culling-toggled", !!cfg.culling);
    ev("view-distance-changed", viewDistance);
    ev("lod-limits-changed", [cfg.lodMin, cfg.lodMax]);
    this.gameManager.updateChunkSize(cfg.chunkSize); // also destroys + rebuilds chunks
    this.gameManager.uiManager?.applyState({
      renderType: cfg.renderType, strategy: cfg.strategy, fx: cfg.fx,
      sockets: cfg.sockets, culling: cfg.culling, chunkSize: cfg.chunkSize,
    });
    // Clean slate for network accounting: drop bytes loaded under default config.
    window.__netStats?.reset();
    performance.clearResourceTimings();
    this.config = { ...cfg, viewDistance };
    this.configuredAt = performance.now();
    cm.continueLoop();
  }

  teleport({ latLng = null, position = null, y = 4000, pitch = 0, yaw = Math.PI }) {
    let pos = position;
    if (!pos && latLng) {
      const p = this.converter.coordinatesToPosition({ lat: latLng[0], lng: latLng[1] });
      pos = [p[0], p[2]];
    }
    if (!pos) throw new Error("teleport needs latLng or position");
    const t = this.gameManager.player.camera.transform;
    t.translation = [pos[0], y, pos[1]];
    t.rotation = [pitch, yaw, 0];
  }

  async waitForQuiescence({ timeoutMs = 600000 } = {}) {
    const t0 = performance.now();
    let quiet = 0;
    let lastPasses = -1;
    while (performance.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (window.__deviceLost) return { quiesced: false, ms: performance.now() - t0, deviceLost: true };
      const s = this.gameManager.renderer.chunkManager.getStrategyStats();
      if (s.passes === lastPasses) continue; // strategy hasn't run a new pass yet
      lastPasses = s.passes;
      const quietPass = !s.initializing &&
        s.queuedLastPass === 0 && s.destroyedLastPass === 0 && s.loading === 0;
      quiet = quietPass ? quiet + 1 : 0;
      if (quiet >= QUIET_POLLS) return { quiesced: true, ms: performance.now() - t0 };
    }
    return { quiesced: false, ms: timeoutMs };
  }

  async record({ warmupMs = 5000, durationMs = 20000 } = {}) {
    await new Promise((r) => setTimeout(r, warmupMs));
    const renderer = this.gameManager.renderer;
    const countersBefore = this.getCounters();
    const gpuStart = renderer.gpuFrameTimes.length;
    this.frameDts = [];
    await new Promise((r) => setTimeout(r, durationMs));
    const dts = this.frameDts;
    this.frameDts = null;
    return {
      frameDtsMs: dts.map((d) => d * 1000),
      gpuFrameTimesMs: renderer.gpuFrameTimes.slice(gpuStart),
      countersBefore,
      countersAfter: this.getCounters(),
    };
  }

  getCounters() {
    const r = this.gameManager.renderer;
    const chunkData = r.chunkManager.getChunkData();
    let gpuBytes = 0;
    let instancesResident = 0;
    for (const c of chunkData.values()) {
      gpuBytes += gpuBytesFor(c);
      if (c.instanceArray) instancesResident += c.instanceArray.length / 2;
    }
    const http = performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/get_chunk/"));
    return {
      chunksResident: chunkData.size,
      gpuBytes,
      instancesResident,
      // frameStats.instancesDrawn means triangles for renderType "mesh".
      frameStats: { ...(r.frameStats ?? {}) },
      net: {
        ws: {
          bytes: window.__netStats?.wsBytes ?? 0,
          messages: window.__netStats?.wsMessages ?? 0,
          requestsSent: window.__netStats?.requestsSent ?? 0,
          firstResponseAt: window.__netStats?.firstResponseAt ?? null,
        },
        http: {
          requests: http.length,
          bytes: http.reduce((a, e) => a + (e.transferSize || 0), 0),
          firstResponseAt: http.length ? Math.min(...http.map((e) => e.responseEnd)) : null,
        },
      },
      jsHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
      configuredAt: this.configuredAt ?? null,
      deviceLost: window.__deviceLost,
    };
  }

  getProvenance() {
    const canvas = document.querySelector("canvas#viewport");
    return {
      canvas: { width: canvas.width, height: canvas.height },
      devicePixelRatio: window.devicePixelRatio,
      screen: { width: screen.width, height: screen.height },
      adapterInfo: window.__gpuAdapterInfo ?? null,
      userAgent: navigator.userAgent,
    };
  }
}

window.__bench = new BenchAPI();
export default window.__bench;
```

- [ ] **Step 2: Wire into `main.js`**

Add the import at the top (with the other imports):

```js
import bench from "./bench-api.js";
```

After `gameManager.startGame();` (line 37):

```js
bench.init(gameManager);
```

Note `ready` becomes true immediately but the driver additionally waits for `renderer.initialized` (Task 9) — `startGame` is async and un-awaited here, matching existing behavior.

- [ ] **Step 3: Fix the `configure`→`updateChunkSize` interplay**

`configure` calls `this.gameManager.updateChunkSize(cfg.chunkSize)`. Check `game-manager.js:44-49` — it floors to even (harmless here) and forwards to `renderer.updateChunkSize`. No change needed; this step is verification-by-reading only: confirm `renderer.updateChunkSize` → `chunkManager.updateChunkSize` destroys the quad tree so the new size takes effect from scratch (`chunk-manager.js:33-44`). If `renderer.chunkManager` is undefined at configure time (renderer not initialized), that is a driver sequencing bug — the driver must wait for `renderer.initialized` first.

- [ ] **Step 4: Verify end-to-end in browser console**

Reload `http://localhost:8000`, open DevTools console:

```js
__bench.ready                                   // true
__bench.configure({renderType: "greedy", strategy: "quad", chunkSize: 128,
  viewDistance: null, lodMin: 0, lodMax: 9, fx: false, culling: false, sockets: true})
__bench.teleport({latLng: [46.0489, 14.5086], y: 4000, pitch: 0, yaw: Math.PI})
await __bench.waitForQuiescence({timeoutMs: 300000})   // {quiesced: true, ms: ...}
const rec = await __bench.record({warmupMs: 2000, durationMs: 5000})
rec.frameDtsMs.length                            // > 100
rec.gpuFrameTimesMs.length                       // > 0 if timestampQuery true
__bench.getCounters().gpuBytes                   // > 0
__bench.getProvenance()                          // adapterInfo populated
```

Also verify the UI dropdown now shows "greedy" (applyState was called) and the odd-size guard: `__bench.configure({...same, chunkSize: 127})` throws.

- [ ] **Step 5: Commit**

```bash
git add public/bench-api.js public/main.js
git commit -m "feat: window.__bench in-page benchmark API"
```

---

### Task 7: Python deps + `bench/stats.py` (TDD)

**Files:**
- Create: `bench/__init__.py` (empty), `bench/stats.py`, `bench/tests/__init__.py` (empty), `bench/tests/test_stats.py`
- Modify: `requirements.txt`

**Interfaces:**
- Produces: `bench.stats.aggregate(frame_dts_ms: list[float]) -> dict` with keys `frames, mean_fps, p50_ms, p95_ms, p99_ms, low1_fps` (all floats; `frames` int). Empty input → `{"frames": 0}` only. Tasks 9 and 10 consume it.

- [ ] **Step 1: Install deps and pin them**

```powershell
venv\Scripts\pip install playwright matplotlib psutil
venv\Scripts\playwright install chromium
```

Then append the exact installed versions to `requirements.txt` (get them via `venv\Scripts\pip show playwright matplotlib psutil`), as a new section:

```
# Benchmark harness
playwright==<installed>
matplotlib==<installed>
psutil==<installed>
```

- [ ] **Step 2: Write the failing test**

`bench/tests/test_stats.py`:

```python
from bench.stats import aggregate


def test_aggregate_uniform_frames():
    # 100 frames at exactly 10ms => 100 FPS everywhere
    r = aggregate([10.0] * 100)
    assert r["frames"] == 100
    assert abs(r["mean_fps"] - 100.0) < 1e-9
    assert r["p50_ms"] == 10.0
    assert r["p95_ms"] == 10.0
    assert r["p99_ms"] == 10.0
    assert abs(r["low1_fps"] - 100.0) < 1e-9


def test_aggregate_hitches_dominate_percentiles_not_mean():
    # 99 fast frames + 1 huge hitch. mean_fps uses N/sum (Jensen-safe).
    dts = [10.0] * 99 + [510.0]
    r = aggregate(dts)
    assert abs(r["mean_fps"] - (100 * 1000.0 / (99 * 10.0 + 510.0))) < 1e-9
    assert r["p50_ms"] == 10.0
    assert r["p99_ms"] == 510.0     # nearest-rank on sorted data
    # low1: mean FPS of the slowest 1% (here: the single 510ms frame)
    assert abs(r["low1_fps"] - (1000.0 / 510.0)) < 1e-9


def test_aggregate_empty():
    assert aggregate([]) == {"frames": 0}


def test_percentile_nearest_rank():
    r = aggregate([float(i) for i in range(1, 101)])  # 1..100 ms
    assert r["p50_ms"] == 50.0
    assert r["p95_ms"] == 95.0
    assert r["p99_ms"] == 99.0
```

- [ ] **Step 3: Run to verify failure**

Run: `venv\Scripts\python -m pytest bench/tests/test_stats.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'bench.stats'`

- [ ] **Step 4: Implement `bench/stats.py`**

```python
"""Frame-time aggregation. Pure functions, no I/O."""
import math


def _percentile_nearest_rank(sorted_vals, p):
    # Nearest-rank: smallest value with at least p% of data at or below it.
    k = max(1, math.ceil(p / 100.0 * len(sorted_vals)))
    return sorted_vals[k - 1]


def aggregate(frame_dts_ms):
    n = len(frame_dts_ms)
    if n == 0:
        return {"frames": 0}
    total = sum(frame_dts_ms)
    s = sorted(frame_dts_ms)
    # "1% low FPS": mean FPS over the slowest 1% of frames (at least one frame).
    k = max(1, math.ceil(n / 100.0))
    worst = s[-k:]
    return {
        "frames": n,
        "mean_fps": 1000.0 * n / total,
        "p50_ms": _percentile_nearest_rank(s, 50),
        "p95_ms": _percentile_nearest_rank(s, 95),
        "p99_ms": _percentile_nearest_rank(s, 99),
        "low1_fps": 1000.0 * k / sum(worst),
    }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `venv\Scripts\python -m pytest bench/tests/test_stats.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add bench/__init__.py bench/stats.py bench/tests/__init__.py bench/tests/test_stats.py requirements.txt
git commit -m "feat: bench.stats frame-time aggregation + harness deps"
```

---

### Task 8: `bench/matrix.py` — experiments, run IDs, resume (TDD)

**Files:**
- Create: `bench/matrix.py`, `bench/tests/test_matrix.py`

**Interfaces:**
- Produces (Task 9/10 consume):
  - `@dataclass Run: run_id: str, experiment: str, repeat: int, config: dict, view: dict`
  - `build_matrix(experiments: list[str] | None = None) -> list[Run]` — all runs for the named experiments (default: all of E0–E5), deterministically shuffled with seed 1337 (E0 always first).
  - `pending(runs, results_dir) -> list[Run]` — drops runs whose `<results_dir>/<run_id>.json` exists.
  - `run_id(experiment, config, view, repeat) -> str` — `f"{experiment}-{sha1(canonical_json)[:8]}-r{repeat}"`.
  - Constants: `LOCATIONS`, `PITCHES`, `BASE_CONFIG`, `E2_SIZES`, `E2_FAIL_SIZES`, `E2_RENDER_TYPE` (provisional `"greedy"`, updated after E1 review), `RENDER_TYPES`.

- [ ] **Step 1: Write the failing tests**

`bench/tests/test_matrix.py`:

```python
import json
from pathlib import Path

from bench.matrix import build_matrix, pending, run_id, BASE_CONFIG, E2_SIZES


def test_run_id_is_deterministic_and_config_sensitive():
    cfg = dict(BASE_CONFIG)
    view = {"location": "ljubljana", "pitch": "horizon"}
    a = run_id("E1", cfg, view, 0)
    b = run_id("E1", cfg, view, 0)
    assert a == b
    assert a.startswith("E1-") and a.endswith("-r0")
    cfg2 = dict(cfg, chunkSize=cfg["chunkSize"] + 2)
    assert run_id("E1", cfg2, view, 0) != a


def test_all_chunk_sizes_even():
    for s in E2_SIZES:
        assert s % 2 == 0
    for run in build_matrix():
        assert run.config["chunkSize"] % 2 == 0


def test_matrix_shapes():
    e1 = [r for r in build_matrix(["E1"])]
    # 6 render types x 3 locations x 3 pitches x 3 repeats
    assert len(e1) == 6 * 3 * 3 * 3
    e0 = build_matrix(["E0"])
    assert len(e0) == 1
    # E0 comes first even in a full shuffled matrix
    assert build_matrix()[0].experiment == "E0"


def test_matrix_deterministic_order():
    assert [r.run_id for r in build_matrix()] == [r.run_id for r in build_matrix()]


def test_radius_runs_have_finite_view_distance():
    for run in build_matrix():
        if run.config["strategy"] == "radius":
            assert run.config["viewDistance"] is not None


def test_pending_skips_existing(tmp_path: Path):
    runs = build_matrix(["E1"])
    done = runs[3]
    (tmp_path / f"{done.run_id}.json").write_text(json.dumps({"run_id": done.run_id}))
    left = pending(runs, tmp_path)
    assert len(left) == len(runs) - 1
    assert all(r.run_id != done.run_id for r in left)
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python -m pytest bench/tests/test_matrix.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'bench.matrix'`

- [ ] **Step 3: Implement `bench/matrix.py`**

```python
"""Experiment matrix: every benchmark run, deterministically enumerated.

A Run's identity is the sha1 of its canonical config+view JSON, so re-running
the driver after a crash (or a machine power-off) skips completed runs.
"""
import hashlib
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

SHUFFLE_SEED = 1337

# --- Shared tables (the JS side has its own copy of nothing: views resolve here) ---

BASE_CONFIG = {
    "renderType": "hybrid", "strategy": "quad", "chunkSize": 128,
    "viewDistance": None,  # null => Infinity client-side
    "lodMin": 0, "lodMax": 9,
    "fx": False, "culling": False, "sockets": True,
    "timeoutS": 600,
}

# y in world units (~meters). yaw values are provisional until E0 screenshots
# confirm each view shows what it should (adjust here only).
LOCATIONS = {
    "ljubljana": {"latLng": [46.0489, 14.5086], "y": 4000, "yaw": math.pi},
    "alps":      {"latLng": [46.3783, 13.8367], "y": 5000, "yaw": math.pi},
    # NE corner looking back across the whole country (raycast long-view case)
    "ne_plain":  {"latLng": [46.6457, 16.1686], "y": 3000, "yaw": math.pi / 2},
}

PITCHES = {"horizon": 0.0, "down": -math.pi / 2, "up": math.pi / 2}

RENDER_TYPES = ["mesh", "cubes", "planes", "greedy", "raycast", "hybrid"]

E2_SIZES = [1000, 900, 800, 700, 600, 512, 500, 400, 300, 256, 200, 128, 100, 64, 50, 32, 20, 16, 10]
E2_FAIL_SIZES = [8, 4, 2]        # expected to time out: (1000/size)^2 serial base loads
E2_RENDER_TYPE = "greedy"        # PROVISIONAL: set to the E1 winner after E1 review
E2_FAIL_TIMEOUT_S = 900

E1_REPEATS = 3
E4_REPEATS = 3
E5_RADIUS_VIEW_DISTANCE = 50000  # radius + Infinity hangs the tab

DEFAULT_VIEW = {"location": "ljubljana", "pitch": "horizon"}


@dataclass(frozen=True)
class Run:
    run_id: str
    experiment: str
    repeat: int
    config: dict
    view: dict


def run_id(experiment, config, view, repeat):
    canonical = json.dumps({"config": config, "view": view}, sort_keys=True)
    digest = hashlib.sha1(canonical.encode()).hexdigest()[:8]
    return f"{experiment}-{digest}-r{repeat}"


def _mk(experiment, config, view, repeat=0):
    return Run(run_id(experiment, config, view, repeat), experiment, repeat, config, view)


def _e0():
    return [_mk("E0", dict(BASE_CONFIG, renderType="greedy"), dict(DEFAULT_VIEW))]


def _e1():
    runs = []
    for rt in RENDER_TYPES:
        for loc in LOCATIONS:
            for pitch in PITCHES:
                for rep in range(E1_REPEATS):
                    runs.append(_mk("E1", dict(BASE_CONFIG, renderType=rt),
                                    {"location": loc, "pitch": pitch}, rep))
    return runs


def _e2():
    runs = [_mk("E2", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, chunkSize=s),
                dict(DEFAULT_VIEW)) for s in E2_SIZES]
    runs += [_mk("E2", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, chunkSize=s,
                            timeoutS=E2_FAIL_TIMEOUT_S), dict(DEFAULT_VIEW))
             for s in E2_FAIL_SIZES]
    return runs


def _e3():
    runs = [_mk("E3", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE, lodMax=m),
                dict(DEFAULT_VIEW)) for m in range(9, 0, -1)]
    # The no-LOD extreme: base resolution everywhere. Expected to die; the
    # failure mode (timeout / device lost) IS the result.
    runs.append(_mk("E3", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE,
                               lodMin=9, lodMax=9, timeoutS=900), dict(DEFAULT_VIEW)))
    return runs


def _e4():
    runs = []
    for sockets in (True, False):
        for loc in ("ljubljana", "alps"):
            for rep in range(E4_REPEATS):
                runs.append(_mk("E4", dict(BASE_CONFIG, renderType=E2_RENDER_TYPE,
                                           sockets=sockets),
                                {"location": loc, "pitch": "horizon"}, rep))
    return runs


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
    return runs


_BUILDERS = {"E0": _e0, "E1": _e1, "E2": _e2, "E3": _e3, "E4": _e4, "E5": _e5}


def build_matrix(experiments=None):
    experiments = experiments or list(_BUILDERS)
    runs = []
    for exp in experiments:
        runs.extend(_BUILDERS[exp]())
    # Deterministic shuffle so thermal drift over a night doesn't correlate
    # with any single factor. E0 (the pilot) always runs first.
    rng = random.Random(SHUFFLE_SEED)
    e0 = [r for r in runs if r.experiment == "E0"]
    rest = [r for r in runs if r.experiment != "E0"]
    rng.shuffle(rest)
    return e0 + rest


def pending(runs, results_dir):
    results_dir = Path(results_dir)
    return [r for r in runs if not (results_dir / f"{r.run_id}.json").exists()]
```

- [ ] **Step 4: Run tests to verify pass**

Run: `venv\Scripts\python -m pytest bench/tests/test_matrix.py -v`
Expected: 6 passed. Also run the whole suite: `venv\Scripts\python -m pytest bench/tests python/tests -v` — everything green.

- [ ] **Step 5: Commit**

```bash
git add bench/matrix.py bench/tests/test_matrix.py
git commit -m "feat: bench.matrix experiment definitions with resumable run ids"
```

---

### Task 9: `bench/driver.py` — Playwright runner with checkpointing

**Files:**
- Create: `bench/driver.py`
- Create: `bench/results/.gitkeep` (results ARE committed later — they are thesis data)

**Interfaces:**
- Consumes: `bench.matrix` (Task 8), `bench.stats.aggregate` (Task 7), `window.__bench` (Task 6).
- Produces: `bench/results/<run_id>.json` per the Result JSON schema; `bench/results/manifest.jsonl` (one line per completed run: `{"run_id", "experiment", "quiesced", "mean_fps", "finished_at"}`); screenshots in `bench/results/shots/<run_id>.png` when `--screenshots`.
- CLI: `venv\Scripts\python -m bench.driver [--experiments E0,E1] [--redo RUN_ID_OR_EXPERIMENT] [--screenshots] [--results-dir bench/results] [--record-ms 20000] [--warmup-ms 5000]`

- [ ] **Step 1: Implement `bench/driver.py`**

```python
"""Benchmark driver: one config per fresh browser, checkpointed JSON results.

Usage:
    venv\\Scripts\\python -m bench.driver --experiments E0 --screenshots
    venv\\Scripts\\python -m bench.driver                  # full pending matrix
    venv\\Scripts\\python -m bench.driver --redo E1        # re-run all of E1
"""
import argparse
import datetime
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import psutil
from playwright.sync_api import sync_playwright

from bench.matrix import LOCATIONS, PITCHES, build_matrix, pending
from bench.stats import aggregate

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_URL = "http://localhost:8000"
LOD_DIR = "lod_output"  # what server.py serves (ChunkManager default)
VIEWPORT = {"width": 1920, "height": 1080}
CHROMIUM_ARGS = [
    "--disable-frame-rate-limit",
    "--disable-gpu-vsync",
    "--force-device-scale-factor=1",
]
QUIESCE_SAFETY_MS = 30000  # driver-side wait beyond the JS timeout


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def assert_no_pyramid_rebuild():
    for p in psutil.process_iter(["cmdline"]):
        cmdline = " ".join(p.info["cmdline"] or [])
        if "build_quad_tree" in cmdline:
            fail("build_quad_tree.py is running. Benchmarks and pyramid rebuilds "
                 "must never run concurrently. Finish or stop the rebuild first.")


def git_rev():
    return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
                          capture_output=True, text=True).stdout.strip()


def server_alive():
    try:
        with urllib.request.urlopen(SERVER_URL + "/", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def start_server():
    if server_alive():
        print("Server already running; using it.")
        return None
    proc = subprocess.Popen(
        [str(REPO_ROOT / "venv" / "Scripts" / "python"), "server.py"],
        cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        if server_alive():
            return proc
        time.sleep(1)
    proc.kill()
    fail("Flask server did not come up within 60s")


def resolve_view(view):
    loc = LOCATIONS[view["location"]]
    return {
        "latLng": loc["latLng"], "y": loc["y"], "yaw": loc["yaw"],
        "pitch": PITCHES[view["pitch"]],
    }


def run_one(playwright, run, args):
    """Run a single config in a fresh browser. Never raises; failures are results."""
    result = {
        "run_id": run.run_id, "experiment": run.experiment, "repeat": run.repeat,
        "config": run.config, "view": run.view,
        "started_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "git_rev": git_rev(), "lod_dir": LOD_DIR,
        "quiesce": None, "summary": {"frames": 0}, "gpu_summary": {"frames": 0},
        "raw": {"frameDtsMs": [], "gpuFrameTimesMs": []},
        "counters_before": None, "counters_after": None,
        "provenance": None, "device_lost": None, "error": None,
    }
    browser = None
    try:
        browser = playwright.chromium.launch(headless=False, args=CHROMIUM_ARGS)
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
        page = context.new_page()
        page.goto(SERVER_URL + "/", wait_until="load")
        page.wait_for_function(
            "window.__bench?.ready === true && "
            "window.__bench?.gameManager?.renderer?.initialized === true",
            timeout=60000)

        page.evaluate("cfg => window.__bench.configure(cfg)", run.config)
        page.evaluate("v => window.__bench.teleport(v)", resolve_view(run.view))
        result["provenance"] = page.evaluate("() => window.__bench.getProvenance()")

        timeout_ms = run.config.get("timeoutS", 600) * 1000
        # page.evaluate awaits the returned Promise; give Playwright's own
        # timeout headroom beyond the in-page one.
        page.set_default_timeout(timeout_ms + QUIESCE_SAFETY_MS)
        result["quiesce"] = page.evaluate(
            "t => window.__bench.waitForQuiescence({timeoutMs: t})", timeout_ms)

        rec = page.evaluate(
            "o => window.__bench.record(o)",
            {"warmupMs": args.warmup_ms, "durationMs": args.record_ms})
        result["raw"]["frameDtsMs"] = rec["frameDtsMs"]
        result["raw"]["gpuFrameTimesMs"] = rec["gpuFrameTimesMs"]
        result["counters_before"] = rec["countersBefore"]
        result["counters_after"] = rec["countersAfter"]
        result["summary"] = aggregate(rec["frameDtsMs"])
        result["gpu_summary"] = aggregate(rec["gpuFrameTimesMs"])
        result["device_lost"] = page.evaluate("() => window.__deviceLost")

        if args.screenshots:
            shots = Path(args.results_dir) / "shots"
            shots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(shots / f"{run.run_id}.png"))
    except Exception as e:  # timeout, crash, device-lost tab death: record it
        result["error"] = f"{type(e).__name__}: {e}"
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
    return result


def write_result(result, results_dir):
    results_dir = Path(results_dir)
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / f"{result['run_id']}.json").write_text(
        json.dumps(result, indent=1))
    with open(results_dir / "manifest.jsonl", "a") as f:
        f.write(json.dumps({
            "run_id": result["run_id"], "experiment": result["experiment"],
            "quiesced": (result["quiesce"] or {}).get("quiesced"),
            "mean_fps": result["summary"].get("mean_fps"),
            "error": result["error"],
            "finished_at": datetime.datetime.now().isoformat(timespec="seconds"),
        }) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--experiments", help="comma list, e.g. E0,E1 (default: all)")
    ap.add_argument("--redo", help="run id or experiment name to force re-run")
    ap.add_argument("--screenshots", action="store_true")
    ap.add_argument("--results-dir", default=str(REPO_ROOT / "bench" / "results"))
    ap.add_argument("--record-ms", type=int, default=20000)
    ap.add_argument("--warmup-ms", type=int, default=5000)
    args = ap.parse_args(argv)

    assert_no_pyramid_rebuild()

    experiments = args.experiments.split(",") if args.experiments else None
    runs = build_matrix(experiments)
    if args.redo:
        runs = [r for r in runs
                if r.run_id == args.redo or r.experiment == args.redo]
        if not runs:
            fail(f"--redo matched nothing: {args.redo}")
    else:
        before = len(runs)
        runs = pending(runs, args.results_dir)
        print(f"{before - len(runs)} runs already done (checkpointed), "
              f"{len(runs)} to go.")
    if not runs:
        print("Nothing to do.")
        return

    server_proc = start_server()
    try:
        with sync_playwright() as pw:
            for i, run in enumerate(runs, 1):
                print(f"[{i}/{len(runs)}] {run.run_id} "
                      f"({run.config['renderType']}, {run.view})...", flush=True)
                t0 = time.time()
                result = run_one(pw, run, args)
                write_result(result, args.results_dir)
                status = ("ERROR " + result["error"]) if result["error"] else (
                    f"quiesced={result['quiesce']['quiesced']} "
                    f"mean_fps={result['summary'].get('mean_fps', 0):.1f}")
                print(f"    {status}  ({time.time() - t0:.0f}s)")
    finally:
        if server_proc:
            server_proc.kill()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-run E0**

Stop any manually started server first (the driver can also reuse it — either is fine).

Run: `venv\Scripts\python -m bench.driver --experiments E0 --screenshots --record-ms 5000 --warmup-ms 2000`

Expected: a Chrome window opens, terrain loads, the run completes; `bench/results/E0-*.json` exists with `quiesce.quiesced: true`, `summary.mean_fps > 0`, `raw.frameDtsMs` non-empty, and `bench/results/shots/E0-*.png` shows Ljubljana from the air. Note: with the clean-pyramid rebuild running concurrently this smoke test only validates plumbing — numbers are meaningless. That's fine here.

Re-run the same command: expected output `1 runs already done (checkpointed), 0 to go.` — this verifies resume.

- [ ] **Step 3: Commit**

```bash
git add bench/driver.py bench/results/.gitkeep
git commit -m "feat: bench.driver Playwright runner with checkpointed results"
```

(Do not commit smoke-run results; delete `bench/results/E0-*.json`, `manifest.jsonl`, and `shots/` before the real E0.)

---

### Task 10: `bench/plot.py` — figures, CSVs, report (TDD on synthetic data)

**Files:**
- Create: `bench/plot.py`, `bench/tests/test_plot.py`
- Create: `bench/figures/.gitkeep`

**Interfaces:**
- Consumes: `bench/results/*.json` (Result JSON schema).
- Produces: `bench/figures/<experiment>_<name>.png` and `.csv` pairs plus `bench/figures/report.md`. Public functions: `load_results(results_dir) -> list[dict]`, `table_e1(results) -> list[dict]` (rows: experiment/renderType/location/pitch/median-of-repeats metrics), `write_all(results_dir, figures_dir)`.

**Note for the implementer:** before writing any chart code, invoke the `dataviz` skill and follow its palette/mark guidance; every figure must also be written as CSV (same basename) — figures are derived artifacts, JSON stays the source of truth.

- [ ] **Step 1: Write the failing test**

`bench/tests/test_plot.py`:

```python
import json
from pathlib import Path

from bench.plot import load_results, table_e1, write_all


def _fake_result(run_id, experiment, render_type, location, pitch, mean_fps, repeat):
    return {
        "run_id": run_id, "experiment": experiment, "repeat": repeat,
        "config": {"renderType": render_type, "strategy": "quad", "chunkSize": 128,
                   "viewDistance": None, "lodMin": 0, "lodMax": 9, "fx": False,
                   "culling": False, "sockets": True, "timeoutS": 600},
        "view": {"location": location, "pitch": pitch},
        "quiesce": {"quiesced": True, "ms": 30000.0},
        "summary": {"frames": 1000, "mean_fps": mean_fps, "p50_ms": 1000 / mean_fps,
                    "p95_ms": 1500 / mean_fps, "p99_ms": 2000 / mean_fps,
                    "low1_fps": mean_fps / 2},
        "gpu_summary": {"frames": 0},
        "raw": {"frameDtsMs": [], "gpuFrameTimesMs": []},
        "counters_before": {"chunksResident": 100, "gpuBytes": 1_000_000,
                            "net": {"ws": {"bytes": 5_000_000}, "http": {"bytes": 0}}},
        "counters_after": {"chunksResident": 100, "gpuBytes": 1_000_000,
                           "net": {"ws": {"bytes": 5_000_000}, "http": {"bytes": 0}}},
        "provenance": {}, "device_lost": None, "error": None,
    }


def _make_results_dir(tmp_path: Path):
    d = tmp_path / "results"
    d.mkdir()
    i = 0
    for rt, fps in [("greedy", 300.0), ("mesh", 40.0)]:
        for rep, jitter in [(0, 0.0), (1, 5.0), (2, -5.0)]:
            r = _fake_result(f"E1-{i:08d}-r{rep}", "E1", rt, "ljubljana",
                             "horizon", fps + jitter, rep)
            (d / f"{r['run_id']}.json").write_text(json.dumps(r))
            i += 1
    return d


def test_load_results(tmp_path):
    d = _make_results_dir(tmp_path)
    results = load_results(d)
    assert len(results) == 6


def test_table_e1_medians_repeats(tmp_path):
    results = load_results(_make_results_dir(tmp_path))
    rows = table_e1(results)
    assert len(rows) == 2  # greedy + mesh, one row per (renderType, location, pitch)
    greedy = next(r for r in rows if r["renderType"] == "greedy")
    assert greedy["mean_fps"] == 300.0  # median of 295/300/305
    assert greedy["repeats"] == 3


def test_write_all_produces_figures_and_csvs(tmp_path):
    d = _make_results_dir(tmp_path)
    figs = tmp_path / "figures"
    write_all(d, figs)
    assert (figs / "report.md").exists()
    pngs = list(figs.glob("E1_*.png"))
    csvs = list(figs.glob("E1_*.csv"))
    assert pngs, "no E1 figures produced"
    assert csvs, "no E1 csv produced"
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python -m pytest bench/tests/test_plot.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'bench.plot'`

- [ ] **Step 3: Implement `bench/plot.py`**

Structure (implementer fills chart specifics per the dataviz skill; the data plumbing below is required):

```python
"""Derive figures + CSV tables + report.md from bench/results/*.json.

Reading results NEVER triggers benchmarking. Every figure has a CSV twin.
Run: venv\\Scripts\\python -m bench.plot [--results-dir ...] [--figures-dir ...]
"""
import argparse
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load_results(results_dir):
    out = []
    for p in sorted(Path(results_dir).glob("*.json")):
        out.append(json.loads(p.read_text()))
    return out


def _median_rows(results, key_fn, metrics=("mean_fps", "p50_ms", "p95_ms", "p99_ms", "low1_fps")):
    """Group results, take the median across repeats for each metric."""
    groups = defaultdict(list)
    for r in results:
        groups[key_fn(r)].append(r)
    rows = []
    # json key: group tuples may mix None with numbers (E5 viewDistance) —
    # plain tuple sort would TypeError.
    for key, rs in sorted(groups.items(), key=lambda kv: json.dumps(kv[0])):
        row = dict(key)
        row["repeats"] = len(rs)
        row["quiesced_all"] = all((r["quiesce"] or {}).get("quiesced") for r in rs)
        row["quiesce_ms"] = statistics.median(
            (r["quiesce"] or {}).get("ms", 0) for r in rs)
        for m in metrics:
            vals = [r["summary"][m] for r in rs if r["summary"].get("frames")]
            row[m] = statistics.median(vals) if vals else None
        rows.append(row)
    return rows


def table_e1(results):
    e1 = [r for r in results if r["experiment"] == "E1"]
    return _median_rows(e1, lambda r: (
        ("renderType", r["config"]["renderType"]),
        ("location", r["view"]["location"]),
        ("pitch", r["view"]["pitch"]),
    ))


def _write_csv(rows, path):
    if not rows:
        return
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def write_all(results_dir, figures_dir):
    figures_dir = Path(figures_dir)
    figures_dir.mkdir(parents=True, exist_ok=True)
    results = load_results(results_dir)
    report = ["# Benchmark report", ""]

    # --- E1: render tactic shootout ---
    rows = table_e1(results)
    if rows:
        _write_csv(rows, figures_dir / "E1_tactics.csv")
        # Figure: grouped bars of mean_fps by renderType, one group per
        # (location, pitch). Also a p95_ms variant. Save as E1_tactics_fps.png
        # and E1_tactics_p95.png. (Chart specifics per the dataviz skill.)
        ...
        report.append("## E1 render tactics\n\nSee E1_tactics.csv\n")

    # --- E2: chunk size sweep (line: mean_fps vs chunkSize, log-x; and
    #         quiesce_ms vs chunkSize; timeouts marked) ---
    # --- E3: lodMax sweep (mean_fps + counters vs lodMax; failures annotated
    #         with device_lost / error text) ---
    # --- E4: transport (bars: quiesce_ms, first response, total bytes;
    #         headline: bytes-to-quiescence vs 70 GB dataset) ---
    # --- E5: ablations (simple bars) ---
    # Each block follows the E1 pattern: _median_rows with its own key_fn,
    # CSV twin, figure(s), report section. Group keys:
    #   E2: chunkSize     E3: (lodMin, lodMax)     E4: (sockets, location)
    #   E5: (renderType, strategy, fx, culling, viewDistance)

    (figures_dir / "report.md").write_text("\n".join(report))


def main(argv=None):
    ap = argparse.ArgumentParser()
    root = Path(__file__).resolve().parent
    ap.add_argument("--results-dir", default=str(root / "results"))
    ap.add_argument("--figures-dir", default=str(root / "figures"))
    args = ap.parse_args(argv)
    write_all(args.results_dir, args.figures_dir)


if __name__ == "__main__":
    main()
```

The `...` and comment blocks are the implementer's chart work — every experiment section must end with: a CSV written, at least one PNG written, a report.md section appended. E2/E3/E4/E5 blocks must not crash when their experiment has no results yet (guard like E1 does) — plotting must work mid-campaign.

- [ ] **Step 4: Run tests to verify pass**

Run: `venv\Scripts\python -m pytest bench/tests/test_plot.py -v`
Expected: 3 passed. Then full suite: `venv\Scripts\python -m pytest bench/tests -v` — all green.

- [ ] **Step 5: Commit**

```bash
git add bench/plot.py bench/tests/test_plot.py bench/figures/.gitkeep
git commit -m "feat: bench.plot figures, CSV twins, and report from result JSONs"
```

---

### Task 11: E0 pilot + human review gate

This task is mostly operational; it exists so nobody starts a 162-run night on unverified plumbing. **Prerequisite: the clean-pyramid rebuild must be finished or stopped — check with the user first.**

**Files:**
- Modify: `bench/matrix.py` (constants only, if review demands it)
- Modify: `CLAUDE.md` (status note)

- [ ] **Step 1: Clean slate**

Delete any smoke-test leftovers: `bench/results/*.json`, `bench/results/manifest.jsonl`, `bench/results/shots/`.

- [ ] **Step 2: Run E0 for real**

Close Parsec and everything nonessential. Run:
`venv\Scripts\python -m bench.driver --experiments E0 --screenshots`

- [ ] **Step 3: Human review gate (STOP — user reviews)**

Present to the user:
- The screenshot (does the Ljubljana horizon view look right?)
- `quiesce.ms` (this number × 180 ≈ E1 night length; decide with the user whether to cut E1 locations/repeats in `bench/matrix.py`)
- `summary.mean_fps` vs the on-screen counter sanity
- `gpu_summary.frames > 0` (timestamp queries actually working) — if 0, wall-clock stays primary; note it
- Counters: `gpuBytes`, `chunksResident`, `net.ws.bytes` all plausible
- Then run one E1 cell of each pitch at one location with `--screenshots` (e.g. `--redo` by run id) and review the three screenshots: horizon/down/up must actually show horizon/down/up, and yaw must face into the country. Adjust `LOCATIONS[...]["yaw"]`/`y` in `bench/matrix.py` if not — run ids change when view params change, which is correct (the old results are invalid).

- [ ] **Step 4: Record decisions**

Update `CLAUDE.md` "Current phase" line: harness verified, E0 timing = X s/run, matrix trimmed to Y runs (if trimmed). Update `E2_RENDER_TYPE` comment status if E1 has since decided it (normally later).

- [ ] **Step 5: Commit**

```bash
git add bench/matrix.py CLAUDE.md
git commit -m "chore: E0-calibrated matrix constants"
```

---

## Execution notes (not tasks)

- **Campaign order after Task 11:** E1 overnight → review → set `E2_RENDER_TYPE` to the winner in `bench/matrix.py` (one-line change; E2/E3/E4/E5 run ids intentionally depend on it) → E2+E3 overnight → E4+E5 (short) → `venv\Scripts\python -m bench.plot`. Commit `bench/results/` and `bench/figures/` after each campaign — they are thesis data.
- **E2 pre-sweep smoke (spec requirement):** before the E2 overnight, validate every size loads at all with short records into a scratch dir so the real sweep isn't polluted by short-record checkpoints:
  `venv\Scripts\python -m bench.driver --experiments E2 --record-ms 2000 --warmup-ms 1000 --results-dir bench/results-smoke` — review `bench/results-smoke/manifest.jsonl` for unexpected errors, then delete `bench/results-smoke/`. The real E2 runs into the default results dir untouched.
- **Every sweep command is safely re-runnable** — that is the checkpointing contract. After any crash/power-off, rerun the identical command.
- The driver deliberately reuses an already-running server if one is up (dev convenience) — for real campaigns start nothing manually so the driver owns a clean server.
- `--disable-frame-rate-limit`/`--disable-gpu-vsync` uncap Chrome; if E0 still shows FPS pinned at 165, add `--disable-gpu-compositing` to a test run ONLY to diagnose — never to a measured campaign (it changes the render path).
