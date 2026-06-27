import { vprint } from "./vprint.js";
import Chunk from "./chunk.js";

export default class ChunkRadiusStrategy {
  constructor(chunkMesher, voxelSize = 100, chunkSize = 1000) {
    this.chunkMesher = chunkMesher;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;
    this.chunkData = new Map();
    this.chunksLoading = 0;

    this.setupEventListeners();
  }

  setupEventListeners() {
    document.addEventListener("lod-limits-changed", (e) => {
      this.updateLODLimits(e.detail);
    });
    document.addEventListener("view-distance-changed", (e) => {
      this.updateViewDistance(e.detail);
    });
  }

  radius = Infinity;
  updateViewDistance(viewDistance) {
    let newRadius = viewDistance/this.chunkSize;
    console.log("New Radius: ", newRadius, "Old radius", this.radius);
    if (newRadius<this.radius){
      this.destroy();
    }
    this.radius = newRadius;
  }

  lodMinBound = 0;
  lodMaxBound = 9;
  updateLODLimits(lodLimits) {
    console.log("LOD Lims: ", lodLimits);
    this.lodMinBound = Math.round(lodLimits[0]);
    this.lodMaxBound = Math.round(lodLimits[1]);
  }

  maxChunksToLoadAtOnce = 10;

  iteration = 0;

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  destroy() {
    for (const chunk of this.chunkData.values()) {
      chunk.destroy();
    }
    this.chunkData.clear();
    this.chunksLoading = 0;
    this.iteration++;
  }

  updateChunkSize(chunkSize) {
    this.chunkSize = chunkSize;
    this.destroy();
    this.breakLoop = true;
  }

  async updateChunks(playerPosition) {
    const currentChunkX = -Math.floor(playerPosition.x / this.chunkSize);
    const currentChunkZ = Math.floor(playerPosition.z / this.chunkSize);

    // Remove chunks that are too far away
    // for (const [key, chunk] of this.chunkData.entries()) {
    //   if (Math.abs(chunk.position.x - currentChunkX) > radius || 
    //       Math.abs(chunk.position.z - currentChunkZ) > radius) {
    //     chunk.destroy();
    //     this.chunkData.delete(key);
    //   }
    // }

    this.breakLoop = false;
    // Load chunks within radius
    for (let layer = 0; layer <= this.radius; layer++) {
      for (let dx = -layer; dx <= layer; dx++) {
        for (let dz = -layer; dz <= layer; dz++) {
          if (this.chunksLoading >= this.maxChunksToLoadAtOnce) {
            return; // Load a few at a time
          }
          if (Math.abs(dx) !== layer && Math.abs(dz) !== layer) {
            continue; // Process outer ring
          }
          if (this.breakLoop) {
            return;
          }

          const chunkX = currentChunkX + dx;
          const chunkZ = currentChunkZ + dz;
          const key = this.getChunkKey(chunkX, chunkZ);
          
          let lod = Math.min(7, Math.floor(Math.pow((layer/3), 0.85)));
          lod = Math.min(this.lodMaxBound, lod);
          lod = Math.max(this.lodMinBound, lod);
          lod = Math.min(7, lod);
          lod = Math.max(0, lod);
          if (!this.chunkData.has(key) || this.chunkData.get(key).levelOfDetail !== lod) {
            // if (this.chunkData.has(key) && this.chunkData.get(key).lod > lod) {
            //   this.chunkData.get(key).destroy();
            //   this.chunkData.delete(key);
            // }
            
            // Mark as loading by adding a dummy chunk object temporarily, or just block
            const chunk = new Chunk({ x: chunkX, z: chunkZ }, this.chunkSize/Math.pow(2, lod), null, null, 0, null, lod);
            chunk.scale = Math.pow(2, lod); // Radius strategy typically doesn't scale up for LOD unless desired
            chunk.key = key;
            if (!this.chunkData.has(key)) {
              this.chunkData.set(chunk.key, chunk);
            }
            chunk.iteration = this.iteration;
            this.chunksLoading++;
            
            this.chunkMesher.generateChunkData(chunk, null, "v1").then(res => {
              if (chunk.iteration !== this.iteration) {
                this.chunksLoading--;
                chunk.destroy();
                return;
              }
              this.chunkData.set(chunk.key, chunk);
              this.chunksLoading--;
              if (res === 404) {
                vprint(`Chunk at (${chunkX}, ${chunkZ}) not found (404).`);
                this.chunkData.delete(key);
              }
            }).catch(err => {
              this.chunksLoading--;
              console.error(`Error loading chunk at (${chunkX}, ${chunkZ}):`, err);
              this.chunkData.delete(key);
            });
          }
        }
      }
    }
  }

  getChunkData() {
    return this.chunkData;
  }
}
