import Renderer from "./renderer.js";
import Player from "./player.js";

export default class GameManager {
  constructor(device, context, format, canvas) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;

    this.running = false;
    this.renderer = new Renderer(device, context, format, canvas);
    this.player = new Player(canvas);
  }
  async startGame() {
    await this.renderer.init(this.player.camera, this.canvas);
    this.running = true;
    this.canvas.addEventListener("click", () => {
      this.canvas.requestPointerLock();
    });
    requestAnimationFrame(this.frame.bind(this));
  }

  pauseGame() {
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
