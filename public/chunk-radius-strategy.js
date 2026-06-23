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

  maxChunksToLoadAtOnce = 10;

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  destroy() {
    for (const chunk of this.chunkData.values()) {
      chunk.destroy();
    }
    this.chunkData.clear();
    this.chunksLoading = 0;
  }

  async updateChunks(playerPosition) {
    const currentChunkX = -Math.floor(playerPosition.x / this.chunkSize);
    const currentChunkZ = Math.floor(playerPosition.z / this.chunkSize);

    const radius = 5000; // The number of chunks in radius to load

    // Remove chunks that are too far away
    // for (const [key, chunk] of this.chunkData.entries()) {
    //   if (Math.abs(chunk.position.x - currentChunkX) > radius || 
    //       Math.abs(chunk.position.z - currentChunkZ) > radius) {
    //     chunk.destroy();
    //     this.chunkData.delete(key);
    //   }
    // }

    // Load chunks within radius
    for (let layer = 0; layer <= radius; layer++) {
      for (let dx = -layer; dx <= layer; dx++) {
        for (let dz = -layer; dz <= layer; dz++) {
          if (this.chunksLoading >= this.maxChunksToLoadAtOnce) {
            return; // Load a few at a time
          }
          if (Math.abs(dx) !== layer && Math.abs(dz) !== layer) {
            continue; // Process outer ring
          }

          const chunkX = currentChunkX + dx;
          const chunkZ = currentChunkZ + dz;
          const key = this.getChunkKey(chunkX, chunkZ);
          
          let lod = Math.min(7, Math.floor(Math.pow((layer/3), 0.85)));
          if (!this.chunkData.has(key) || this.chunkData.get(key).levelOfDetail > lod) {
            // if (this.chunkData.has(key) && this.chunkData.get(key).lod > lod) {
            //   this.chunkData.get(key).destroy();
            //   this.chunkData.delete(key);
            // }
            
            // Mark as loading by adding a dummy chunk object temporarily, or just block
            const chunk = new Chunk({ x: chunkX, z: chunkZ }, this.chunkSize/Math.pow(2, lod), null, null, 0, null, lod);
            chunk.scale = Math.pow(2, lod); // Radius strategy typically doesn't scale up for LOD unless desired
            chunk.key = key;
            this.chunksLoading++;
            
            this.chunkMesher.generateChunkData(chunk, null, "v1").then(res => {
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
