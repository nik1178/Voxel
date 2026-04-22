import { vprint } from "./vprint.js";
import Chunk from "./chunk.js";
import HeightmapGrid from "./heightmap-grid.js";

export default class ChunkMesher {
  constructor(device) {
    this.device = device;
  }

  addChunkMesh(chunk) {
    const { localVertices, localIndices } = this.buildMesh(chunk);
    chunk.setVertices(localVertices);
    const { vertexBuffer, indexBuffer } = this.createBuffers(localVertices, localIndices);
    chunk.setMeshData(vertexBuffer, indexBuffer, localIndices.length);
    return chunk;
  }

  buildMesh(chunk) {
    let heightMapData = chunk.heightMap;
    let scale = chunk.scale;
    let zOffset = chunk.position.z;
    let xOffset = chunk.position.x;
    let localVertices;
    let localIndices;

    // const width = Math.floor(heightMapData.length);
    // const depth = Math.floor(heightMapData[0].length);
    const width = heightMapData.size;
    const depth = heightMapData.size;

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

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        // const [r, g, b, height] = heightMapData[x][z];
        const r = heightMapData.getR(x, z);
        const g = heightMapData.getG(x, z);
        const b = heightMapData.getB(x, z);
        const height = heightMapData.getHeight(x, z);

        const fx = -(x + xOffset * 1000) * scale;
        const fy = height;
        const fz = (z + zOffset * 1000) * scale;

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
}
