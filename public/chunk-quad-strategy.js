import { vprint } from "./vprint.js";
import HmapLoader from "./hmap-loader.js";
import Chunk from "./chunk.js";
import ChunkMesher from "./chunk-mesher.js";
import HeightmapGrid from "./heightmap-grid.js";


export default class ChunkQuadStrategy {
  chunkSize = 1000;
  constructor(device, voxelSize = 100) {
    this.voxelSize = voxelSize;
    this.hmapLoader = new HmapLoader();
    this.chunkMesher = new ChunkMesher(device);
  }

  async updateChunks(playerPosition) {
    if (!this.quadTree) {
      this.quadTree = new QuadTree();
      let heightMapData = await this.getChunk(0, 0, 1);
      heightMapData = this.handleNewHeightmap(heightMapData, 1, null, 0, 0);
      let chunk = new Chunk({ x: 0, z: 0 }, null, null, 0, heightMapData, 1);
      chunk.scale = 1024 * (2);
      chunk = this.chunkMesher.addChunkMesh(chunk);
      this.quadTree.addChunk(chunk);
      return;
    }
    const currentTime = performance.now();
    
    const playerChunkNode = this.quadTree.getPlayerChunkNode(playerPosition);

    console.log(`Time to find player chunk node: ${performance.now() - currentTime} ms`);
    vprint("Player chunk node:", playerChunkNode);
    if (!playerChunkNode) {
      vprint("Player is outside of loaded chunks, can't determine which chunk to load next.");
      return;
    }
    const childCoordinates = playerChunkNode.getChildCoordinates();
    if (!childCoordinates) {
      vprint("Max LOD reached for this chunk, no further children to load.");
      return;
    }
    if (playerChunkNode.isLoading) {
      vprint("Already loading children for this chunk, skipping fetch.");
      return;
    }
    vprint("Child coordinates to load:", childCoordinates);
    playerChunkNode.isLoading = true; // Set loading flag to prevent duplicate fetches

    for (const { x: chunkX, z: chunkZ, levelOfDetail } of childCoordinates) {
      if (levelOfDetail > 9) {
        continue;
      }
      
      this.getChunk(chunkX, chunkZ, levelOfDetail).then(heightMapData => {
        if (heightMapData === 404) {
          vprint(`Chunk at (${chunkX}, ${chunkZ}) not found (404). Skipping.`);
          return;
        }
        heightMapData = this.handleNewHeightmap(heightMapData, levelOfDetail, playerChunkNode, chunkX, chunkZ);
        let chunk = new Chunk({ x: chunkX, z: chunkZ }, null, null, 0, heightMapData, levelOfDetail);
        chunk.scale = playerChunkNode.chunk.scale / 2; // Each child chunk is half the scale of its parent
        chunk = this.chunkMesher.addChunkMesh(chunk);
        let chunkNode = new ChunkNode();
        chunkNode.chunk = chunk;
        playerChunkNode.children.push(chunkNode);
      }).catch(err => {
        console.error(`Error loading chunk at (${chunkX}, ${chunkZ}):`, err);
      });
    }

  }

  async getChunk(chunkX, chunkZ, levelOfDetail = 0) {
    vprint(`Requesting chunk at (${chunkX}, ${chunkZ})`);
    return this.hmapLoader.loadHeightMap(
      chunkX,
      chunkZ,
      this.chunkSize,
      levelOfDetail,
    );
  }

  handleNewHeightmap(heightMapData, levelOfDetail, parentNode, chunkX, chunkZ) {
    if (levelOfDetail == 1) {
      // let grid = Array.from({ length: this.chunkSize }, () => Array(this.chunkSize));
      let grid = new HeightmapGrid(this.chunkSize);
      for (let y = 0; y < this.chunkSize; y++) {
        for (let x = 0; x < this.chunkSize; x++) {
          const index = x + y * this.chunkSize; // pixel index
          
          // grid[x][y] = heightMapData[index];
          grid.setPixel(x, y, heightMapData[index][0], heightMapData[index][1], heightMapData[index][2], heightMapData[index][3]);
        }
      }
      return grid;
    }

    let grid = new HeightmapGrid(this.chunkSize);
    let index = 0;

    const xOffset = chunkX % 2 * 500; // 0 for even chunks, 500 for odd chunks
    const zOffset = chunkZ % 2 * 500; // 0 for even chunks, 500 for odd chunks

    for (let py = 0; py < this.chunkSize / 2; py++) {
      for (let px = 0; px < this.chunkSize / 2; px++) {
        const x = px * 2;
        const y = py * 2;
        
        // TR (Top-Right -> x + 1, y)
        // grid[x + 1][y] = heightMapData[index++];
        grid.setPixel(x + 1, y, heightMapData[index][0], heightMapData[index][1], heightMapData[index][2], heightMapData[index][3]);
        index++;
        // BL (Bottom-Left -> x, y + 1)
        // grid[x][y + 1] = heightMapData[index++];
        grid.setPixel(x, y + 1, heightMapData[index][0], heightMapData[index][1], heightMapData[index][2], heightMapData[index][3]);
        index++;
        // BR (Bottom-Right -> x + 1, y + 1)
        // grid[x + 1][y + 1] = heightMapData[index++];
        grid.setPixel(x + 1, y + 1, heightMapData[index][0], heightMapData[index][1], heightMapData[index][2], heightMapData[index][3]);
        index++;
        
        // TL (Top-Left -> matches parent directly)
        // grid[x][y] = parentNode.chunk.heightMap[px + xOffset][py + zOffset];
        const parentHeight = parentNode.chunk.heightMap.getHeight(px + xOffset, py + zOffset);
        const parentR = parentNode.chunk.heightMap.getR(px + xOffset, py + zOffset);
        const parentG = parentNode.chunk.heightMap.getG(px + xOffset, py + zOffset);
        const parentB = parentNode.chunk.heightMap.getB(px + xOffset, py + zOffset);
        grid.setPixel(x, y, parentR, parentG, parentB, parentHeight);
      }
    }

    return grid;
  }

  getChunkData() {
    if (!this.quadTree) {
      return new Map(); // Return empty if quad tree isn't initialized
    }
    const chunkData = this.quadTree.getChunkData();
    return chunkData;
  }

  // offsetVertices(vertices, offsetX, offsetZ) {
  //   vprint("Offsetting vertices by:", offsetX, offsetZ);
  //   const offsetVertices = new Float32Array(vertices.length);
  //   const vertexSize = 8; // 8 floats per vertex
  //   for (let i = 0; i < vertices.length / vertexSize; i++) {
  //     const baseIndex = i * vertexSize;
  //     for (let j = 1; j < vertexSize; j++) {
  //       offsetVertices[baseIndex + j] = vertices[baseIndex + j];
  //     }
  //     offsetVertices[baseIndex] = vertices[baseIndex] + offsetX;
  //     offsetVertices[baseIndex + 2] = vertices[baseIndex + 2] + offsetZ;
  //   }
  //   return offsetVertices;
  // }
}

class QuadTree {
  constructor() {
    this.baseNode = new ChunkNode();
  }

  getChunkData() {
    let chunkData = new Map();
    if (!this.baseNode.children.length) {
      return chunkData; // Return empty if base chunk isn't ready
    }
    for (const chunk of this.baseNode.getAllChunks()) {
      const key = `${chunk.position.x},${chunk.position.z},${chunk.levelOfDetail}`;
      if (chunkData.has(key)) {
        vprint(`Warning: Duplicate chunk key ${key} - overwriting existing chunk`);
      }
      chunkData.set(key, chunk);
    }
    console.log("Current chunk data size:", chunkData.size);
    return chunkData;
  }

  addChunk(chunk) {
    // For simplicity, we add all chunks as children of the base node
    const newNode = new ChunkNode();
    newNode.chunk = chunk;
    this.baseNode.children.push(newNode);
  }

  getPlayerChunkNode(playerPosition) {
    // This function would traverse the quad tree to find the node containing the player
    let currentNode = this.baseNode.children[0]; // Start with the first chunk (assuming it's the base chunk)
    while (currentNode.children.length > 0) {
      const currentChunk = currentNode.chunk;
      if (!currentChunk) {
        return null; // No chunk at this node, can't determine which child to go to
      }
      const { x: chunkX, z: chunkZ } = currentChunk.position;
      const halfSize = currentChunk.scale / 2 * 1000; // Assuming each chunk is 1000 units at LOD 0, scaled by the chunk's scale
      const inLeft = playerPosition.x < chunkX + halfSize;
      const inBottom = playerPosition.z < chunkZ + halfSize;
      const newCoordinates = {x: currentChunk.position.x*2, z: currentChunk.position.z*2};
      if (!inLeft) {
        newCoordinates.x += 1;
      }
      if (!inBottom) {
        newCoordinates.z += 1;
      }
      const children = currentNode.children;
      for (const child of children) {
        if (child.chunk && child.chunk.position.x === newCoordinates.x && child.chunk.position.z === newCoordinates.z) {
          currentNode = child;
          break;
        }
      }
    }
    return currentNode;
  }
}

class ChunkNode {
  parent = null;
  chunk = null;
  children = [];

  getAllChunks() {
    let chunks = [];
    if (this.children.length > 0) {
      for (const child of this.children) {
        chunks.push(...child.getAllChunks());
      }
    } else if (this.chunk) {
      chunks.push(this.chunk);
    } else {
      vprint("Warning: Leaf node without chunk");
    }
    return chunks;
  }

  getChildCoordinates() {
    if (!this.chunk) {
      return null; // Can't determine coordinates without chunk
    }
    if (this.chunk.levelOfDetail == 9) {
      return null; // Max LOD reached, no further children
    }
    const { x, z } = this.chunk.position;
    const firstChild = { x: x*2, z: z*2 };
    const levelOfDetail = this.chunk.levelOfDetail + 1;
    return [
      { x: firstChild.x, z: firstChild.z, levelOfDetail },
      { x: firstChild.x + 1, z: firstChild.z, levelOfDetail },
      { x: firstChild.x, z: firstChild.z + 1, levelOfDetail },
      { x: firstChild.x + 1, z: firstChild.z + 1, levelOfDetail },
    ];
  }
}