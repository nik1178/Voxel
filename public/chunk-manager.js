import HmapLoader from "./hmap-loader.js";
import ChunkBuilder from "./chunk-builder.js";
import Chunk from "./chunk.js";
import { vprint } from "./vprint.js";

export default class ChunkManager {
  constructor(device, voxelSize = 100, chunkSize = 1000) {
    this.device = device;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;

    this.hmapLoader = new HmapLoader();
  }

  getChunk(chunkX, chunkZ, levelOfDetail = 0) {
    vprint(`Requesting chunk at (${chunkX}, ${chunkZ})`);
    return this.hmapLoader.loadHeightMap(
      chunkX,
      chunkZ,
      this.chunkSize,
      levelOfDetail
    );
  }

  getChunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  async handleNewChunk(chunkX, chunkZ, levelOfDetail, heightMapData) {
    this.chunksLoading--;
    if (heightMapData === 404) {
      vprint(`Chunk at (${chunkX}, ${chunkZ}) not found (404).`);
      // this.chunkData.set(
      //   this.getChunkKey(chunkX, chunkZ),
      //   new Chunk({ x: chunkX, z: chunkZ })
      // );
      return;
    }

    const chunkBuilder = new ChunkBuilder();
    const { localVertices, localIndices } = await chunkBuilder.buildMap(
      heightMapData,
      levelOfDetail
    );
    const vertices = chunkBuilder.offsetVertices(
      localVertices,
      chunkX * this.chunkSize,
      chunkZ * this.chunkSize
    );
    // const vertices = localVertices;

    const vertexBuffer = this.device.createBuffer({
      label: "Cell vertices",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, vertices);

    const indexBuffer = this.device.createBuffer({
      label: "Cell indices",
      size: localIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, localIndices);

    const chunk = new Chunk(
      { x: chunkX, z: chunkZ },
      vertexBuffer,
      indexBuffer,
      localIndices.length,
      heightMapData,
      levelOfDetail
    );
    chunk.setVertices(vertices);
    this.chunkData.set(this.getChunkKey(chunkX, chunkZ), chunk);
    vprint(`Loaded chunk at (${chunkX}, ${chunkZ})`);
  }

  chunkData = new Map();
  chunksLoading = 0;
  async updateChunks(playerPosition) {
    // Pseudo-code for chunk updating logic
    const currentChunkX = Math.floor(playerPosition.x / this.chunkSize);
    const currentChunkZ = Math.floor(playerPosition.z / this.chunkSize);
    // const currentChunkX = 461;
    // const currentChunkZ = 101;


    // Check which chunk is needed next based on player position and stored chunks
    for (let layer = 0; layer < 300; layer++) {
      for (let dx = -layer; dx <= layer; dx++) {
        for (let dz = -layer; dz <= layer; dz++) {
          if (Math.abs(dx) !== layer && Math.abs(dz) !== layer) {
            continue; // Skip inner chunks, only process the outer ring
          }

          const chunkX = currentChunkX + dx;
          const chunkZ = currentChunkZ + dz;
          let levelOfDetail = Math.floor(Math.log2(layer));
          if (levelOfDetail < 0) levelOfDetail = 0;
          levelOfDetail = 4; // For testing, force LOD 4
          if (Math.floor(this.chunkSize / 2 ** levelOfDetail) <= 0) {
            levelOfDetail = Math.floor(Math.log2(this.chunkSize));
          }
          if (!this.chunkData.has(this.getChunkKey(chunkX, chunkZ)) || (this.chunkData.get(this.getChunkKey(chunkX, chunkZ)).levelOfDetail != levelOfDetail && this.chunkData.get(this.getChunkKey(chunkX, chunkZ)).levelOfDetail != null)) {
            if (this.chunksLoading >= 200) {
              return; // Load one chunk at a time
            }
            if (!this.chunkData.has(this.getChunkKey(chunkX, chunkZ))) {
              this.chunkData.set(
                this.getChunkKey(chunkX, chunkZ),
                new Chunk({ x: chunkX, z: chunkZ })
              );
            }

            this.getChunk(chunkX, chunkZ, levelOfDetail).then(
              this.handleNewChunk.bind(this, chunkX, chunkZ, levelOfDetail)
            );
            this.chunksLoading++;
          }
        }
      }
    }
  }

  running = false;
  startLoop(player) {
    vprint("Starting chunk manager loop...");
    this.running = true;
    setInterval(() => {
      if (this.running) {
        this.updateChunks({
          x: player.camera.transform.translation[0],
          z: player.camera.transform.translation[2],
        });
      }
    }, 1000); // Update every second
  }

  stopLoop() {
    this.running = false;
  }

  resetChunkData() {
    this.chunkData = new Map();
  }

  getChunkData() {
    return this.chunkData;
  }
}
