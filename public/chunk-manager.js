import HmapLoader from "./hmap-loader";

export default class ChunkManager {
  constructor(voxelSize = 100, chunkSize = 1000) {
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;

    this.hmapLoader = new HmapLoader();
  }

  getChunk(chunkX, chunkZ) {
    return this.hmapLoader.loadHeightMap(chunkX, chunkZ, this.chunkSize);
  }

  getChunkData() {
    
  }

}