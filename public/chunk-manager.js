import ChunkRadiusStrategy from "./chunk-radius-strategy.js";
import Chunk from "./chunk.js";
import { vprint } from "./vprint.js";
import ChunkQuadStrategy from "./chunk-quad-strategy.js";
import ChunkMesher from "./chunk-mesher.js";

export default class ChunkManager {
  constructor(device, voxelSize = 100, chunkSize = 1000) {
    this.device = device;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;

    this.chunkMesher = new ChunkMesher(this.device, this.chunkSize);
    this.quadStrategy = new ChunkQuadStrategy(this.chunkMesher, this.voxelSize, this.chunkSize);
    this.radiusStrategy = new ChunkRadiusStrategy(this.chunkMesher, this.voxelSize, this.chunkSize);

    this.activeStrategy = this.quadStrategy;
  }
  
  setStrategy(type) {
    if (type === "quad") {
      this.activeStrategy = this.quadStrategy;
    } else if (type === "radius") {
      this.activeStrategy = this.radiusStrategy;
    }
  }

  async updateChunks(playerPosition) {
    await this.activeStrategy.updateChunks(playerPosition);
  }

  running = false;
  async startLoop(player) {
    vprint("Starting chunk manager loop...");
    this.running = true;
    /* setInterval(() => {
      if (this.running) {
        this.updateChunks({
          x: player.camera.transform.translation[0],
          z: player.camera.transform.translation[2],
        });
      }
    }, 100); // Update every second */
    while (this.running) {
      await this.updateChunks({
        x: player.camera.transform.translation[0],
        z: player.camera.transform.translation[2],
      });

      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  stopLoop() {
    this.running = false;
  }

  resetChunkData() {
    this.chunkData = new Map();
  }

  getChunkData() {
    return this.activeStrategy.getChunkData();
  }
}
