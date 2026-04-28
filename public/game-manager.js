import Renderer from "./renderer.js";
import Player from "./player.js";
import { vprint } from "./vprint.js";

export default class GameManager {
  constructor(device, context, format, canvas, voxelSize = 100, chunkSize = 128) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;

    this.running = false;
    this.renderer = new Renderer(device, context, format, canvas, voxelSize, chunkSize);
    this.player = new Player(canvas);
  }
  async startGame() {
    vprint("Starting game...");
    await this.renderer.init(this.player, this.canvas);
    this.running = true;
    this.canvas.addEventListener("click", () => {
      this.canvas.requestPointerLock();
    });
    vprint("Game started");
    requestAnimationFrame(this.frame.bind(this));
  }

  pauseGame() {
    vprint("Game paused");
    this.running = false;
  }

  lastTime = 0;
  lastFrames = [];
  frame(time) {
    if (!this.running) return;

    let dt = (time - this.lastTime)/1000;
    this.updateFPS(dt);
    this.lastTime = time;

    this.player.update(dt);
    this.renderer.updateVPMatrix(this.player.camera, this.canvas);
    this.renderer.render();
    // --------------------------------------------
    requestAnimationFrame(this.frame.bind(this));
  }
  
  updateFPS(dt) {
    if (this.fpsCounter) {
      this.lastFrames.push(1/dt);
      if (this.lastFrames.length > 10) {
        this.lastFrames.shift();
      }
      this.fpsCounter.innerText = (this.lastFrames.reduce((a, b) => a + b, 0) / this.lastFrames.length).toFixed(2);
    }
  }
}
