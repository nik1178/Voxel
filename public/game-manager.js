import Renderer from "./renderer.js";
import Player from "./player.js";
import { vprint } from "./vprint.js";
import { UIManager } from "./ui-manager.js";
import { CommandConverter } from "./command-converter.js";

export default class GameManager {
  constructor(device, context, format, canvas, voxelSize = 100, chunkSize = 128) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;

    this.running = false;
    this.renderer = new Renderer(device, context, format, canvas, voxelSize, chunkSize);
    this.player = new Player(canvas);

    this.commandConverter = new CommandConverter();
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener("command-input-entered", (e) => {
      const newPosition = this.commandConverter.getPosition(e.detail);
      if (newPosition) {
          this.player.camera.transform.translation = newPosition;
          this.player.camera.transform.rotation[0] = -Math.PI/2;
      }
    });
  }

  async startGame() {
    vprint("Starting game...");
    await this.renderer.init(this.player, this.canvas);
    this.running = true;
    this.canvas.addEventListener("click", () => {
      this.canvas.requestPointerLock();
    });
    vprint("Game started");
    this.uiManager = new UIManager();
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
    requestAnimationFrame(this.frame.bind(this));
  }

  updateChunkSize(chunkSize) {
    chunkSize = Math.floor(chunkSize/2)*2;

    this.chunkSize = chunkSize;
    this.renderer.updateChunkSize(chunkSize);
  }

  updateViewDistance(viewDistance) {
    this.renderer.updateViewDistance(viewDistance);
  }

  updateLODLimits(lodLimits) {
    this.renderer.updateLODLimits(lodLimits);
  }


  pauseGame() {
    vprint("Game paused");
    this.running = false;
  }

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
}
