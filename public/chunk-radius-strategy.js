import { vprint } from "./vprint.js";
import Chunk from "./chunk.js";

export default class ChunkRadiusStrategy {
  constructor(chunkMesher, voxelSize = 100, chunkSize = 1000) {
    this.chunkMesher = chunkMesher;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;
    this.chunkData = new Map();
    this.chunksLoading = 0;
  }

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  async updateChunks(playerPosition) {
    const currentChunkX = Math.floor(playerPosition.x / this.chunkSize);
    const currentChunkZ = Math.floor(playerPosition.z / this.chunkSize);

    const radius = 3; // The number of chunks in radius to load

    // Remove chunks that are too far away
    for (const [key, chunk] of this.chunkData.entries()) {
      if (Math.abs(chunk.position.x - currentChunkX) > radius || 
          Math.abs(chunk.position.z - currentChunkZ) > radius) {
        chunk.destroy();
        this.chunkData.delete(key);
      }
    }

    // Load chunks within radius
    for (let layer = 0; layer <= radius; layer++) {
      for (let dx = -layer; dx <= layer; dx++) {
        for (let dz = -layer; dz <= layer; dz++) {
          if (Math.abs(dx) !== layer && Math.abs(dz) !== layer) {
            continue; // Process outer ring
          }

          const chunkX = currentChunkX + dx;
          const chunkZ = currentChunkZ + dz;
          const key = this.getChunkKey(chunkX, chunkZ);

          if (!this.chunkData.has(key)) {
            if (this.chunksLoading >= 2) {
              return; // Load a few at a time
            }
            
            // Mark as loading by adding a dummy chunk object temporarily, or just block
            const chunk = new Chunk({ x: chunkX, z: chunkZ }, null, null, 0, null, 1);
            chunk.scale = 1; // Radius strategy typically doesn't scale up for LOD unless desired
            
            this.chunkData.set(key, chunk);
            this.chunksLoading++;

            this.chunkMesher.generateChunkData(chunk).then(res => {
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
