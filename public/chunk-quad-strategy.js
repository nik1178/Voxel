import { vprint } from "./vprint.js";
import Chunk from "./chunk.js";

export default class ChunkQuadStrategy {
  constructor(chunkMesher, voxelSize = 100, chunkSize = 1000) {
    this.chunkMesher = chunkMesher;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;

    this.setupEventListeners();
  }

  lodMinBound = 0;
  lodMaxBound = 9;
  renderDistance = Infinity;

  setupEventListeners() {
    document.addEventListener("lod-limits-changed", (e) => {
      this.updateLODLimits(e.detail);
    });
    document.addEventListener("view-distance-changed", (e) => {
      this.updateViewDistance(e.detail);
    });
  }

  updateLODLimits(lodLimits) {
    console.log("LOD Lims: ", lodLimits);
    this.lodMinBound = Math.round(lodLimits[0]);
    this.lodMaxBound = Math.round(lodLimits[1]);
  }

  updateViewDistance(viewDistance) {
    this.renderDistance = viewDistance;
  }

  getBaseChunkList() {
    const chunks = [];

    for (let x = 0; x < 1000; x += this.chunkSize) {
      for (let z = 0; z < 1000; z += this.chunkSize) {
        chunks.push({ x: x / this.chunkSize, z: z / this.chunkSize, levelOfDetail: 1 });
      }
    }

    return chunks;
  }

  howManyChunksLoading = 0;
  maximumChunksLoading = 1;
  previousChunk = { x: 0, z: 0, levelOfDetail: 1 };
  iteration = 0;

  passStats = { passes: 0, queuedLastPass: 0, destroyedLastPass: 0 };

  getStats() {
    // `initializing` matters: during the serial base-chunk init, `passes` does
    // not advance and the counters read quiet — quiescence must not fire then.
    return {
      ...this.passStats,
      loading: this.howManyChunksLoading,
      initializing: !!this.initializing || !this.quadTree,
    };
  }

  destroy() {
    if (this.quadTree) {
      this.quadTree.baseNode.destroy();
      this.quadTree = null;
    }
    this.howManyChunksLoading = 0;
    this.previousChunk = { x: 0, z: 0, levelOfDetail: 1 };
    this.iteration++;
  }

  initializing = false;
  async updateChunks(playerPosition) {
    if (!this.quadTree) {
      this.initializing = true;
      this.quadTree = new QuadTree(this.chunkSize);
      let baseChunks = this.getBaseChunkList();
      for (const chunkCoords of baseChunks) {
        let chunk = new Chunk({ x: chunkCoords.x, z: chunkCoords.z }, this.chunkSize, null, null, 0, null, chunkCoords.levelOfDetail);
        chunk.scale = 2 ** 8;
        chunk.iteration = this.iteration;
        await this.chunkMesher.generateChunkData(chunk);
        if (!this.quadTree || this.iteration !== chunk.iteration) {
          return;
        }
        this.quadTree.addChunk(chunk);
      }
      //this.quadTree.addChunk(chunk);
      this.initializing = false;
      return;
    }
    if (this.initializing) {
      return;
    }

    this.passStats.passes++;
    let queuedThisPass = 0;
    let destroyedThisPass = 0;

    let currentChunk = this.quadTree.getPlayerChunkNode(playerPosition);
    if (currentChunk.chunk.position.x !== this.previousChunk.x || currentChunk.chunk.position.z !== this.previousChunk.z || currentChunk.chunk.levelOfDetail !== this.previousChunk.levelOfDetail) {
      this.previousChunk = { x: currentChunk.chunk.position.x, z: currentChunk.chunk.position.z, levelOfDetail: currentChunk.chunk.levelOfDetail };
      this.howManyChunksLoading = 0;
    }

    // Get list of all the chunks that need new children
    if (this.howManyChunksLoading >= this.maximumChunksLoading) {
      return;
    }

    const allChunkNodes = this.quadTree.getChunkNodeData();
    for (const chunkNode of allChunkNodes) {
      chunkNode.distanceFromPlayer = chunkNode.chunk.distanceFromPlayer(playerPosition);
      // console.log(chunkNode.distanceFromPlayer);
    }
    allChunkNodes.sort((a, b) => a.distanceFromPlayer - b.distanceFromPlayer);


    // Chunks to load in order of distance
    let nodesToLoad = [];
    for (const chunkNode of allChunkNodes) {
      if (chunkNode.chunk.levelOfDetail > 9) {
        continue;
      }
      if (chunkNode.isLoading) {
        continue;
      }
      if (chunkNode.is404) {
        continue; // permanently empty (outside survey); never subdivide or re-request
      }
      if (chunkNode.children.length > 0) {
        continue;
      }
      if (chunkNode.distanceFromPlayer > this.renderDistance) {
        continue;
      }
      const distanceRatio = Math.max(1, chunkNode.distanceFromPlayer / (this.chunkSize * 2));
      let expectedLOD = Math.min(this.lodMaxBound, this.lodMaxBound - Math.floor(Math.log2(distanceRatio * 1)));

      if (expectedLOD < this.lodMinBound) {
        expectedLOD = this.lodMinBound;
      }
      // const expectedLOD = 9;

      if (chunkNode.chunk.levelOfDetail < expectedLOD && this.howManyChunksLoading < this.maximumChunksLoading) {
        nodesToLoad.push(chunkNode);
        this.howManyChunksLoading++;
        queuedThisPass++;
      }
      else if (chunkNode.chunk.levelOfDetail > expectedLOD + 1 && chunkNode.chunk.levelOfDetail > 1) {

        vprint("Destroying chunk at (" + chunkNode.chunk.position.x + ", " + chunkNode.chunk.position.z + ") at size " + this.chunkSize + ", LOD " + chunkNode.chunk.levelOfDetail);
        chunkNode.destroyFamily();
        destroyedThisPass++;
      }
    }

    this.passStats.queuedLastPass = queuedThisPass;
    this.passStats.destroyedLastPass = destroyedThisPass;
    if (nodesToLoad.length === 0) {
      return;
    }

    this.loadingNewChunk = performance.now();
    for (const chunkNode of nodesToLoad) {
      const childCoordinates = chunkNode.getChildCoordinates();
      for (const childCoordinate of childCoordinates) {
        let chunkX = childCoordinate.x;
        let chunkZ = childCoordinate.z;
        let levelOfDetail = childCoordinate.levelOfDetail;
        let chunk = new Chunk({ x: chunkX, z: chunkZ }, this.chunkSize, null, null, 0, null, levelOfDetail);
        chunk.scale = chunkNode.chunk.scale / 2;
        let childChunkNode = new ChunkNode();
        childChunkNode.chunk = chunk;
        childChunkNode.parent = chunkNode;
        chunkNode.children.push(childChunkNode);
        childChunkNode.isLoading = true;
      }

      let loadPromises = chunkNode.children.map((childChunkNode) => {
        const chunkX = childChunkNode.chunk.position.x;
        const chunkZ = childChunkNode.chunk.position.z;
        return this.chunkMesher.generateChunkData(childChunkNode.chunk, chunkNode.chunk).then(res => {
          childChunkNode.isLoading = false;
          if (res === 404) {
            // Permanently empty (outside the survey). Previously isLoading stayed
            // true forever, which pinned the parent at low LOD and made
            // quiescence unobservable.
            childChunkNode.is404 = true;
            vprint(`Chunk at (${chunkX}, ${chunkZ}) not found (404). Skipping.`);
          }
        }).catch(err => {
          childChunkNode.isLoading = false;
          childChunkNode.is404 = true;
          console.error(`Error loading chunk at (${chunkX}, ${chunkZ}):`, err);
        });
      });
      Promise.all(loadPromises).then(() => {
        this.howManyChunksLoading--;
        if (this.howManyChunksLoading < 0) {
          this.howManyChunksLoading = 0;
        }
      });
    }


  }

  getChunkData() {
    if (!this.quadTree) {
      return new Map(); // Return empty if quad tree isn't initialized
    }
    const chunkData = this.quadTree.getChunkData();
    return chunkData;
  }
}

class QuadTree {
  constructor(chunkSize = 256) {
    this.baseNode = new ChunkNode();
    this.baseNode.chunk = new Chunk({ x: 0, z: 0 }, chunkSize, null, null, 0, null, 0);
    this.baseNode.chunk.scale = 2 ** 9;
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

  getChunkNodeData() {
    let chunkNodes = [];
    if (!this.baseNode.children.length) {
      return chunkNodes; // Return empty if base chunk isn't ready
    }
    for (const chunkNode of this.baseNode.getAllChunkNodes()) {
      chunkNodes.push(chunkNode);
    }
    return chunkNodes;
  }

  addChunk(chunk) {
    // For simplicity, we add all chunks as children of the base node
    const newNode = new ChunkNode();
    newNode.chunk = chunk;
    newNode.parent = this.baseNode;
    this.baseNode.children.push(newNode);
  }

  // LEGACY - Not used with current LOD system
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
  is404 = false;

  getAllChunks() {
    let chunks = [];
    if (this.children.length > 0) {
      let noneLoading = true;
      for (const child of this.children) {
        if (child.isLoading) {
          noneLoading = false;
          break;
        }
      }
      if (noneLoading) {
        for (const child of this.children) {
          chunks.push(...child.getAllChunks());
        }
        return chunks;
      }
    }
    if (this.chunk && !this.is404) {
      chunks.push(this.chunk);
    } else if (!this.chunk) {
      vprint("Warning: Leaf node without chunk");
    }
    return chunks;
  }

  getAllChunkNodes() {
    let nodes = [];
    if (this.children.length > 0) {
      for (const child of this.children) {
        nodes.push(...child.getAllChunkNodes());
      }
    } else if (this.chunk) {
      nodes.push(this);
    } else {
      vprint("Warning: Leaf node without chunk");
    }
    return nodes;
  }

  getChildCoordinates() {
    if (!this.chunk) {
      return null; // Can't determine coordinates without chunk
    }
    if (this.chunk.levelOfDetail == 9) {
      return null; // Max LOD reached, no further children
    }
    const { x, z } = this.chunk.position;
    const firstChild = { x: x * 2, z: z * 2 };
    const levelOfDetail = this.chunk.levelOfDetail + 1;
    return [
      { x: firstChild.x, z: firstChild.z, levelOfDetail },
      { x: firstChild.x + 1, z: firstChild.z, levelOfDetail },
      { x: firstChild.x, z: firstChild.z + 1, levelOfDetail },
      { x: firstChild.x + 1, z: firstChild.z + 1, levelOfDetail },
    ];
  }

  destroyFamily() {
    if (!this.parent) {
      vprint("Error destroying family.");
      return;
    }
    for (const siblingNode of this.parent.children) {
      siblingNode.destroy();
    }
    this.parent.children = [];
  }

  destroy() {
    if (this.children.length > 0) {
      for (const child of this.children) {
        child.destroy();
      }
    }
    if (this.chunk) {
      this.chunk.destroy();
    }
  }
}