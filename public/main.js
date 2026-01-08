import { alertError } from "./errors.js";
import GameManager from "./game-manager.js";

const canvas = document.querySelector("canvas#viewport");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

if (!navigator.gpu) alertError("WebGPU is not supported in this browser.");

async function initWebGPU() {
  // Request discrete GPU
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) alertError("Failed to get GPU adapter.");

  const device = await adapter.requestDevice();
  if (!device) alertError("Failed to get GPU device.");

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

const gameManager = new GameManager(device, context, format, canvas);
gameManager.startGame();