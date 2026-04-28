import { vprint } from "./vprint.js";
import HmapLoader from "./hmap-loader.js";
import Chunk from "./chunk.js";
import ChunkMesher from "./chunk-mesher.js";
import HeightmapGrid from "./heightmap-grid.js";


export default class ChunkQuadStrategy {
  constructor(voxelSize = 100, chunkSize = 1000) {  
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;
    this.hmapLoader = new HmapLoader();
  }

  getBaseChunkList() {
    const chunks = [];

    for (let x = 0; x < 1000; x+=this.chunkSize) {
      for (let z = 0; z < 1000; z+=this.chunkSize) {
        chunks.push({x: x/this.chunkSize, z: z/this.chunkSize, levelOfDetail: 1});
      }
    }
    
    return chunks;
  }

  initializing = false;
  async updateChunks(playerPosition) {
    if (!this.quadTree) {
      this.initializing = true;
      this.quadTree = new QuadTree(this.chunkSize);
      //let heightMapData = await this.getChunk(0, 0, 1);
      let baseChunks = this.getBaseChunkList();
      for (const chunkCoords of baseChunks) {
        let heightMapData = await this.getChunk(chunkCoords.x, chunkCoords.z, chunkCoords.levelOfDetail);
        let chunk = new Chunk({ x: chunkCoords.x, z: chunkCoords.z }, null, null, 0, null, chunkCoords.levelOfDetail);
        chunk.scale = 2**8;
        chunk.rawData = heightMapData;
        this.quadTree.addChunk(chunk);
      }
      //this.quadTree.addChunk(chunk);
      this.initializing = false;
      return;
    }
    if (this.initializing) {
      return;
    }
    
    const playerChunkNode = this.quadTree.getPlayerChunkNode(playerPosition);

    vprint("Player chunk node:", playerChunkNode);
    if (!playerChunkNode) {
      vprint("Player is outside of loaded chunks, can't determine which chunk to load next.");
      return;
    }
    if (playerChunkNode.isLoading) {
      vprint("Already loading children for this chunk, skipping fetch.");
      return;
    }
    const childCoordinates = playerChunkNode.getChildCoordinates();
    if (!childCoordinates) {
      vprint("Max LOD reached for this chunk, no further children to load.");
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
        heightMapData = this.handleNewHeightmapVTF(heightMapData, levelOfDetail, playerChunkNode, chunkX, chunkZ);
        let chunk = new Chunk({ x: chunkX, z: chunkZ }, null, null, 0, null, levelOfDetail);
        chunk.scale = playerChunkNode.chunk.scale / 2; // Each child chunk is half the scale of its parent
        chunk.rawData = heightMapData;
        let chunkNode = new ChunkNode();
        chunkNode.chunk = chunk;
        playerChunkNode.children.push(chunkNode);
      }).catch(err => {
        console.error(`Error loading chunk at (${chunkX}, ${chunkZ}):`, err);
      });
    }

  }

  async getChunk(chunkX, chunkZ, levelOfDetail = 0) {
    vprint(`Requesting chunk at (${chunkX}, ${chunkZ}) at size ${this.chunkSize}, LOD ${levelOfDetail}`);
    
    return this.hmapLoader.loadHeightMap(
      chunkX,
      chunkZ,
      this.chunkSize,
      levelOfDetail,
      "quad",
      false // use VTF repacked typed arrays
    );
  }

  handleNewHeightmapVTF(childDataObj, levelOfDetail, parentNode, chunkX, chunkZ) {
    if (levelOfDetail == 1) {
      return childDataObj;
    }

    const size = this.chunkSize;
    const fullColorData = new Uint8Array(size * size * 4);
    const fullHeightData = new Uint16Array(size * size);
    
    const parentData = parentNode.chunk.rawData;
    let index = 0;
    
    // X, Z are coordinates within the parent's local space.
    // By multiplying by size/2, we map the child's quadrant to the parent's actual offset.
    const xOffset = chunkX % 2 * (size / 2);
    const pyOffset = chunkZ % 2 * (size / 2);

    for (let py = 0; py < size / 2; py++) {
      for (let px = 0; px < size / 2; px++) {
        const x = px * 2;
        const y = py * 2;
        
        // TR (Top-Right -> x + 1, y)
        let idxTR = (y * size + (x + 1));
        let srcIdx = index * 4;
        let dstIdx = idxTR * 4;
        fullColorData[dstIdx]     = childDataObj.colorData[srcIdx];
        fullColorData[dstIdx + 1] = childDataObj.colorData[srcIdx + 1];
        fullColorData[dstIdx + 2] = childDataObj.colorData[srcIdx + 2];
        fullColorData[dstIdx + 3] = childDataObj.colorData[srcIdx + 3];
        fullHeightData[idxTR] = childDataObj.heightData[index];
        index++;
        
        // BL (Bottom-Left -> x, y + 1)
        let idxBL = ((y + 1) * size + x);
        srcIdx = index * 4;
        dstIdx = idxBL * 4;
        fullColorData[dstIdx]     = childDataObj.colorData[srcIdx];
        fullColorData[dstIdx + 1] = childDataObj.colorData[srcIdx + 1];
        fullColorData[dstIdx + 2] = childDataObj.colorData[srcIdx + 2];
        fullColorData[dstIdx + 3] = childDataObj.colorData[srcIdx + 3];
        fullHeightData[idxBL] = childDataObj.heightData[index];
        index++;
        
        // BR (Bottom-Right -> x + 1, y + 1)
        let idxBR = ((y + 1) * size + (x + 1));
        srcIdx = index * 4;
        dstIdx = idxBR * 4;
        fullColorData[dstIdx]     = childDataObj.colorData[srcIdx];
        fullColorData[dstIdx + 1] = childDataObj.colorData[srcIdx + 1];
        fullColorData[dstIdx + 2] = childDataObj.colorData[srcIdx + 2];
        fullColorData[dstIdx + 3] = childDataObj.colorData[srcIdx + 3];
        fullHeightData[idxBR] = childDataObj.heightData[index];
        index++;
        
        // TL (Top-Left -> from parent)
        let parentX = px + xOffset;
        let parentY = py + pyOffset;
        let pIdx = parentY * size + parentX;
        let idxTL = y * size + x;
        
        let pSrcIdx = pIdx * 4;
        let tDstIdx = idxTL * 4;
        fullColorData[tDstIdx]     = parentData.colorData[pSrcIdx];
        fullColorData[tDstIdx + 1] = parentData.colorData[pSrcIdx + 1];
        fullColorData[tDstIdx + 2] = parentData.colorData[pSrcIdx + 2];
        fullColorData[tDstIdx + 3] = parentData.colorData[pSrcIdx + 3];
        fullHeightData[idxTL] = parentData.heightData[pIdx];
      }
    }

    return { colorData: fullColorData, heightData: fullHeightData };
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
  constructor(chunkSize = 256) {
    this.baseNode = new ChunkNode();
    this.baseNode.chunk = new Chunk({ x: 0, z: 0 }, null, null, 0, null, 0);
    this.baseNode.chunk.scale = 2**9;
    this.chunkSize = chunkSize;
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
    //console.log("Current chunk data size:", chunkData.size);
    return chunkData;
  }

  addChunk(chunk) {
    // For simplicity, we add all chunks as children of the base node
    const newNode = new ChunkNode();
    newNode.chunk = chunk;
    this.baseNode.children.push(newNode);
  }

  getPlayerChunkNode(playerPosition) {
    // Traverse the quad tree using world-space midpoints to find the container node
    let currentNode = this.baseNode;
    if (!currentNode) return null;

    while (currentNode.children.length > 0) {
      const currentChunk = currentNode.chunk;
      if (!currentChunk) break;

      /* // Calculate the world-space center of the current chunk
      // Mirroring shader: fx = -(chunkX * chunkSize) * scale, fz = (chunkZ * chunkSize) * scale
      const scale = currentChunk.scale;
      const worldCenterX = -(currentChunk.position.x + 0.5) * this.chunkSize * scale;
      const worldCenterZ = (currentChunk.position.z + 0.5) * this.chunkSize * scale;

      // Determine which quadrant the player is in.
      // Because X is negative-increasing, "further" (x+1) means playerX < centerX.
      let nextX = currentChunk.position.x * 2;
      let nextZ = currentChunk.position.z * 2;

      if (playerPosition.x < worldCenterX) {
        nextX += 1;
      }
      if (playerPosition.z > worldCenterZ) {
        nextZ += 1;
      } */

      let scale = currentChunk.scale;

      let nextScale = scale / 2;
      let nextX = Math.floor((-playerPosition.x) / (this.chunkSize * nextScale));
      let nextZ = Math.floor(playerPosition.z / (this.chunkSize * nextScale));

      const children = currentNode.children;
      let foundChild = false;
      for (const child of children) {
        if (child.chunk && child.chunk.position.x === nextX && child.chunk.position.z === nextZ) {
          currentNode = child;
          foundChild = true;
          break;
        }
      }
      if (!foundChild) break; 
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