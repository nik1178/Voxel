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
  lastFrames = [];
  framesToCapture = 100;
  async frame(time) {
    if (!this.running) return;

    let dt = (time - this.lastTime) / 1000;
    this.updateFPS(dt);
    this.lastTime = time;

    this.player.update(dt);
    this.renderer.updateVPMatrix(this.player.camera, this.canvas);
    this.renderer.render(dt);

    // --------------------------------------------
    requestAnimationFrame(this.frame.bind(this));
  }

  updateFPS(dt) {
    if (this.fpsCounter) {
      this.lastFrames.push(1 / dt);
      if (this.lastFrames.length > this.framesToCapture) {
        this.lastFrames.shift();
      }
      this.fpsCounter.innerText = (this.lastFrames.reduce((a, b) => a + b, 0) / this.lastFrames.length).toFixed(2);
      // const sortedFrames = [...this.lastFrames].sort((a, b) => a - b);
      // this.fpsCounter.innerText = Math.floor(sortedFrames[Math.floor(sortedFrames.length / 2)]);
    }
  }
}
