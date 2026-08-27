import { alertError } from "./errors.js";
import GameManager from "./game-manager.js";
import bench from "./bench-api.js";
import { sizeCanvas } from "./canvas-size.js";

const canvas = document.querySelector("canvas#viewport");
sizeCanvas(canvas);

if (!navigator.gpu) alertError("WebGPU is not supported in this browser.");

async function initWebGPU() {
  // Request discrete GPU
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) alertError("Failed to get GPU adapter.");

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

  const context = canvas.getContext("webgpu");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: format,
  });
  return { device, context, format };
}

const { device, context, format } = await initWebGPU();
console.log("WebGPU initialized:", { device, context, format });

const fpsCounter = document.getElementById("fpscounter");

const gameManager = new GameManager(device, context, format, canvas);
gameManager.fpsCounter = fpsCounter;
gameManager.startGame();
bench.init(gameManager);

// Listen for events
document.addEventListener("chunk-size-changed", (e) => {
  gameManager.updateChunkSize(e.detail);
});
document.addEventListener("view-distance-changed", (e) => {
  gameManager.updateViewDistance(e.detail);
});
document.addEventListener("lod-limits-changed", (e) => {
  gameManager.updateLODLimits(e.detail);
});