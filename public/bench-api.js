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
    if (this.frameDts && isFinite(dt) && dt > 0) this.frameDts.push(dt);
  }

  async configure(cfg) {
    if (cfg.chunkSize % 2 !== 0) {
      throw new Error(`chunkSize must be even, got ${cfg.chunkSize}`);
    }
    const viewDistance = cfg.viewDistance == null ? Infinity : cfg.viewDistance;
    if (cfg.strategy === "radius" && viewDistance === Infinity) {
      throw new Error("radius strategy requires a finite viewDistance (infinite loop otherwise)");
    }
    const cm = this.gameManager.renderer.chunkManager;
    cm.pauseLoop();
    // Drain in-flight loads before resetting net counters, so stale responses
    // that land after the reset don't leak into the next config's accounting.
    const drainStart = performance.now();
    while (cm.getStrategyStats().loading !== 0 && performance.now() - drainStart < 10000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (cm.getStrategyStats().loading !== 0) {
      console.warn("configure: in-flight loads did not drain within 10s cap");
    }
    const ev = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
    ev("render-type-changed", cfg.renderType);
    ev("chunk-strategy-changed", cfg.strategy);
    ev("socket-toggled", !cfg.sockets); // the toggle means "RPC not Websockets"
    ev("fx-toggled", !!cfg.fx);
    ev("culling-toggled", !!cfg.culling);
    ev("view-distance-changed", viewDistance);
    ev("lod-limits-changed", [cfg.lodMin, cfg.lodMax]);
    this.gameManager.updateChunkSize(cfg.chunkSize); // also destroys + rebuilds chunks
    // New-cell-only knobs; defaults equal the hard-coded values they replaced.
    this.gameManager.renderer.hybridNearCount = cfg.hybridNear ?? 9;
    cm.quadStrategy.maximumChunksLoading = cfg.maxLoading ?? 1;
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
    // Truncate rather than snapshot-and-slice: the renderer's gpuFrameTimes is a
    // 20000-cap ring buffer (shift()), so once it's pinned, slice(oldLength) is
    // always []. Emptying it here means everything pushed during this window is
    // ours to read back at the end.
    renderer.gpuFrameTimes.length = 0;
    this.frameDts = [];
    await new Promise((r) => setTimeout(r, durationMs));
    const dts = this.frameDts;
    this.frameDts = null;
    return {
      frameDtsMs: dts.map((d) => d * 1000),
      gpuFrameTimesMs: renderer.gpuFrameTimes.slice(0),
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
          firstResponseAt: http.length
            ? http.reduce((min, e) => (e.responseEnd < min ? e.responseEnd : min), Infinity)
            : null,
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
