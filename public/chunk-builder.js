import { vprint } from "./vprint.js";

export default class ChunkBuilder {
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

        if (x === width-1 && z === depth-1) {
          console.log("First cube corners:", corners);
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
