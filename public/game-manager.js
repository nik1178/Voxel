import Renderer from "./renderer.js";
import Player from "./player.js";
import { vprint } from "./vprint.js";

export default class GameManager {
  constructor(device, context, format, canvas, voxelSize = 100, chunkSize = 256) {
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

  frame() {
    if (!this.running) return;

    this.player.update();
    this.renderer.updateVPMatrix(this.player.camera, this.canvas);
    this.renderer.render();
    // --------------------------------------------
    requestAnimationFrame(this.frame.bind(this));
  }
}
