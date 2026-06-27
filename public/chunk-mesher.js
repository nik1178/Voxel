import { vprint } from "./vprint.js";
import Chunk from "./chunk.js";
import HmapLoader from "./hmap-loader.js";
import { GreedyMesher } from "./greedy-mesher.js";

export default class ChunkMesher {
  constructor(device, chunkSize = 1000) {
    this.device = device;
    this.chunkSize = chunkSize;
    this.hmapLoader = new HmapLoader();
    this.greedyMesher = GreedyMesher.getMesher();

    this.setupEventListeners();
  }

  useWebsockets = true;

  setupEventListeners() {
    document.addEventListener("socket-toggled", (e) => {
      this.useWebsockets = !e.detail;
    });

    document.addEventListener("render-type-changed", (e) => {
      if (e.detail === "mesh") {
        this.useMesh = true;
      } else {
        this.useMesh = false;
      }
    });
  }

  updateChunkSize(chunkSize) {
    this.chunkSize = chunkSize;
  }

  async generateChunkData(chunk, parentChunk = null, strategy="quad") {
    let heightMapData = await this.getChunk(chunk.position.x, chunk.position.z, chunk.levelOfDetail, strategy);
    if (heightMapData === 404) return 404;

    if (parentChunk) {
      heightMapData = this.handleNewHeightmapVTF(heightMapData, chunk.levelOfDetail, parentChunk, chunk.position.x, chunk.position.z);
    }
    
    chunk.rawData = heightMapData;
    if (!this.useMesh) {
      chunk.instanceArray = this.greedyMesher.toInstanceArray(this.greedyMesher.remesh(chunk.rawData));
    } else {
      this.addChunkMesh(chunk);
    }
    
    return chunk;
  }

  addChunkMesh(chunk) {
    // if (!chunk.heightMap) {
    //   chunk.heightMap = this.hmapLoader.webGPUArraysTo1DArray(chunk.rawData);
    // }
    const { localVertices, localIndices } = this.buildMesh(chunk);
    if (!localVertices || !localIndices) return chunk;
    // chunk.setVertices(localVertices);
    const { vertexBuffer, indexBuffer } = this.createBuffers(localVertices, localIndices);
    chunk.setMeshData(vertexBuffer, indexBuffer, localIndices.length);
    return chunk;
  }

  // SHOULD BE THE SAME AS BUILD MAP I THINK
  buildMesh(chunk) {
    let heightMapData = chunk.rawData.heightData;
    let colorData = chunk.rawData.colorData;
    let scale = chunk.scale;
    let chunkSize = chunk.chunkSize;
    let zOffset = chunk.position.z;
    let xOffset = chunk.position.x;
    let localVertices;
    let localIndices;

    // const width = Math.floor(heightMapData.length);
    // const depth = Math.floor(heightMapData[0].length);
    const width = Math.sqrt(heightMapData.length);
    const depth = width;

    const mapArray = Array.from({ length: depth }, () => new Array(width));

    const vertexArray = [];

    const cubeIndicesTemplate = [
      // top
      0, 1, 2, 1, 3, 2,
      // bottom
      4, 6, 5, 5, 6, 7,
      // front
      0, 2, 4, 2, 6, 4,
      // back
      1, 5, 3, 3, 5, 7,
      // left
      0, 4, 1, 1, 4, 5,
      // right
      2, 3, 6, 3, 7, 6,
    ];

    const cubeIndices = {
      top: [0, 1, 2, 1, 3, 2],
      bottom: [4, 6, 5, 5, 6, 7],
      front: [0, 2, 4, 2, 6, 4],
      back: [1, 5, 3, 3, 5, 7],
      left: [0, 4, 1, 1, 4, 5],
      right: [2, 3, 6, 3, 7, 6],
    };

    let cubeIndex = 0;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    let zeroCounter = 0;
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const index = z * width + x;
        const colorIndex = index * 4;

        const r = colorData[colorIndex];
        const g = colorData[colorIndex + 1];
        const b = colorData[colorIndex + 2];
        const height = heightMapData[index];

        if (height < 1) {
          zeroCounter++;
        }

        const fx = -(x + xOffset * chunkSize) * scale;
        const fy = height;
        const fz = (z + zOffset * chunkSize) * scale;

        // if (height <= 0) {
        //   mapArray[x][z] = []; // No cube, but still need to fill mapArray
        //   continue; // Skip empty cubes
        // }

        const cr = r / 255;
        const cg = g / 255;
        const cb = b / 255;
        const ca = 1;

        const topY = fy;

        const x0 = fx;
        const x1 = x0 - scale;
        const z0 = fz;
        const z1 = z0 + scale;

        if (x0 < minX) minX = x0;
        if (x1 > maxX) maxX = x1;
        if (z0 < minZ) minZ = z0;
        if (z1 > maxZ) maxZ = z1;

        // 4 unique corners of the plane
        const corners = [
          [x0, topY, z0],
          [x1, topY, z0],
          [x0, topY, z1],
          [x1, topY, z1],
        ];

        if (x === width - 1 && z === depth - 1) {
          // console.log("First cube corners:", corners);
        }

        for (const corner of corners) {
          vertexArray.push(...corner, 1.0, cr, cg, cb, ca);
        }

        // push 4 vertices
        // for (const [vx, vy, vz] of corners) {
        //   vertexArray.push(
        //     vx, vy, vz, 1.0,   // position + w
        //     cr, cg, cb, ca     // color
        //   );
        // }

        // push indices for this cube
        const baseIndex = cubeIndex * 4;
        const entry = [];
        for (const idx of cubeIndices["top"]) {
          entry.push(baseIndex + idx);
        }
        mapArray[x][z] = entry;

        cubeIndex++;
      }
    }

    if (zeroCounter === width * depth) {
      chunk.instanceArray = [];
      return chunk;
    }

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const currentIndices = mapArray[x][z];
        if (currentIndices.length === 0) continue; // Skip empty cubes

        // -1 0
        const x1 = x - 1;
        const z1 = z;

        if (x1 >= 0 && z1 >= 0) {
          const neighborIndices = mapArray[x1][z1];
          // connect current to neighbor
          const bridge1 = [
            currentIndices[0],
            neighborIndices[4],
            currentIndices[2],
            currentIndices[0],
            neighborIndices[1],
            neighborIndices[4],
          ];
          mapArray[x][z].push(...bridge1);
        }

        // 0 -1
        const x2 = x;
        const z2 = z - 1;
        if (x2 >= 0 && z2 >= 0) {
          const neighborIndices = mapArray[x2][z2];
          // connect current to neighbor
          const bridge2 = [
            currentIndices[0],
            neighborIndices[2],
            currentIndices[1],
            currentIndices[1],
            neighborIndices[2],
            neighborIndices[4],
          ];
          mapArray[x][z].push(...bridge2);
        }
      }
    }

    // Convert to typed arrays for GPU
    localVertices = new Float32Array(vertexArray);
    localIndices = new Uint32Array(mapArray.flat(3));

    return { localVertices, localIndices };
  }

  createBuffers(vertices, indices) {
    const vertexBuffer = this.device.createBuffer({
      label: "Cell vertices",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, vertices);

    const indexBuffer = this.device.createBuffer({
      label: "Cell indices",
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, indices);

    return { vertexBuffer, indexBuffer };
  }

  // QUAD STRATEGY -------------------------------------------
  handleNewHeightmapVTF(childDataObj, levelOfDetail, parentChunk, chunkX, chunkZ) {
    if (levelOfDetail == 1) {
      return childDataObj;
    }

    const size = this.chunkSize;
    const fullColorData = new Uint8Array(size * size * 4);
    const fullHeightData = new Uint16Array(size * size);

    const parentData = parentChunk.rawData;
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
        fullColorData[dstIdx] = childDataObj.colorData[srcIdx];
        fullColorData[dstIdx + 1] = childDataObj.colorData[srcIdx + 1];
        fullColorData[dstIdx + 2] = childDataObj.colorData[srcIdx + 2];
        fullColorData[dstIdx + 3] = childDataObj.colorData[srcIdx + 3];
        fullHeightData[idxTR] = childDataObj.heightData[index];
        index++;

        // BL (Bottom-Left -> x, y + 1)
        let idxBL = ((y + 1) * size + x);
        srcIdx = index * 4;
        dstIdx = idxBL * 4;
        fullColorData[dstIdx] = childDataObj.colorData[srcIdx];
        fullColorData[dstIdx + 1] = childDataObj.colorData[srcIdx + 1];
        fullColorData[dstIdx + 2] = childDataObj.colorData[srcIdx + 2];
        fullColorData[dstIdx + 3] = childDataObj.colorData[srcIdx + 3];
        fullHeightData[idxBL] = childDataObj.heightData[index];
        index++;

        // BR (Bottom-Right -> x + 1, y + 1)
        let idxBR = ((y + 1) * size + (x + 1));
        srcIdx = index * 4;
        dstIdx = idxBR * 4;
        fullColorData[dstIdx] = childDataObj.colorData[srcIdx];
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
        fullColorData[tDstIdx] = parentData.colorData[pSrcIdx];
        fullColorData[tDstIdx + 1] = parentData.colorData[pSrcIdx + 1];
        fullColorData[tDstIdx + 2] = parentData.colorData[pSrcIdx + 2];
        fullColorData[tDstIdx + 3] = parentData.colorData[pSrcIdx + 3];
        fullHeightData[idxTL] = parentData.heightData[pIdx];
      }
    }

    return { colorData: fullColorData, heightData: fullHeightData };
  }

  // QUAD STRATEGY
  async getChunk(chunkX, chunkZ, levelOfDetail = 0, strategy="quad") {
    vprint(`Requesting chunk at (${chunkX}, ${chunkZ}) at size ${this.chunkSize}, LOD ${levelOfDetail}`);
    
    return this.hmapLoader.loadHeightMap(
      chunkX,
      chunkZ,
      this.chunkSize,
      levelOfDetail,
      strategy,
      false, // use VTF repacked typed arrays
      this.useWebsockets
    );
  }
  
  // FROM RADIUS STRATEGY ---------------------------------
  async buildMap(heightMapData, levelOfDetail = 0) {
    let localVertices;
    let localIndices;

    const width = Math.floor(heightMapData.length);
    const depth = Math.floor(heightMapData[0].length);

    const mapArray = Array.from({ length: depth }, () => new Array(width));

    const vertexArray = [];

    const cubeIndicesTemplate = [
      // top
      0, 1, 2, 1, 3, 2,
      // bottom
      4, 6, 5, 5, 6, 7,
      // front
      0, 2, 4, 2, 6, 4,
      // back
      1, 5, 3, 3, 5, 7,
      // left
      0, 4, 1, 1, 4, 5,
      // right
      2, 3, 6, 3, 7, 6,
    ];

    const cubeIndices = {
      top: [0, 1, 2, 1, 3, 2],
      bottom: [4, 6, 5, 5, 6, 7],
      front: [0, 2, 4, 2, 6, 4],
      back: [1, 5, 3, 3, 5, 7],
      left: [0, 4, 1, 1, 4, 5],
      right: [2, 3, 6, 3, 7, 6],
    };

    let cubeIndex = 0;

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const [r, g, b, height] = heightMapData[x][z];

        const fx = x;
        const fy = height;
        const fz = z;

        const cr = r / 255;
        const cg = g / 255;
        const cb = b / 255;
        const ca = 1;

        const topY = fy;

        const levelScale = 2 ** levelOfDetail;
        const x0 = fx*levelScale
        const x1 = x0 + levelScale;
        const z0 = fz*levelScale;
        const z1 = z0 + levelScale;

        // 4 unique corners of the plane
        const corners = [
          [x0, topY, z0],
          [x1, topY, z0],
          [x0, topY, z1],
          [x1, topY, z1],
        ];

        // if (x === width-1 && z === depth-1) {
        //   console.log("First cube corners:", corners);
        // }

        for (const corner of corners) {
          vertexArray.push(...corner, 1.0, cr, cg, cb, ca);
        }

        // push 4 vertices
        // for (const [vx, vy, vz] of corners) {
        //   vertexArray.push(
        //     vx, vy, vz, 1.0,   // position + w
        //     cr, cg, cb, ca     // color
        //   );
        // }

        // push indices for this cube
        const baseIndex = cubeIndex * 4;
        const entry = [];
        for (const idx of cubeIndices["top"]) {
          entry.push(baseIndex + idx);
        }
        mapArray[x][z] = entry;

        cubeIndex++;
      }
    }

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        const currentIndices = mapArray[x][z];

        // -1 0
        const x1 = x - 1;
        const z1 = z;

        if (x1 >= 0 && z1 >= 0) {
          const neighborIndices = mapArray[x1][z1];
          // connect current to neighbor
          const bridge1 = [
            currentIndices[0],
            neighborIndices[4],
            currentIndices[2],
            currentIndices[0],
            neighborIndices[1],
            neighborIndices[4],
          ];
          mapArray[x][z].push(...bridge1);
        }

        // 0 -1
        const x2 = x;
        const z2 = z - 1;
        if (x2 >= 0 && z2 >= 0) {
          const neighborIndices = mapArray[x2][z2];
          // connect current to neighbor
          const bridge2 = [
            currentIndices[0],
            neighborIndices[2],
            currentIndices[1],
            currentIndices[1],
            neighborIndices[2],
            neighborIndices[4],
          ];
          mapArray[x][z].push(...bridge2);
        }
      }
    }

    // Convert to typed arrays for GPU
    localVertices = new Float32Array(vertexArray);
    localIndices = new Uint32Array(mapArray.flat(3));

    return { localVertices, localIndices };
  }

  offsetVertices(vertices, offsetX, offsetZ) {
    vprint("Offsetting vertices by:", offsetX, offsetZ);
    const offsetVertices = new Float32Array(vertices.length);
    const vertexSize = 8; // 8 floats per vertex
    for (let i = 0; i < vertices.length / vertexSize; i++) {
      const baseIndex = i * vertexSize;
      for (let j = 1; j < vertexSize; j++) {
        offsetVertices[baseIndex + j] = vertices[baseIndex + j];
      }
      offsetVertices[baseIndex] = vertices[baseIndex] + offsetX;
      offsetVertices[baseIndex + 2] = vertices[baseIndex + 2] + offsetZ;
    }
    return offsetVertices;
  }
}
