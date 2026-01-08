import { alertError } from "./errors.js";
import * as Matrix from "./matrix.js";
import { loadHeightMap } from "./hmap-loader.js";

const canvas = document.querySelector("canvas#viewport");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

if (!navigator.gpu) alertError("WebGPU is not supported in this browser.");

async function initWebGPU() {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) alertError("Failed to get GPU adapter.");

  const device = await adapter.requestDevice();
  if (!device) alertError("Failed to get GPU device.");

  const context = canvas.getContext("webgpu");

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: format,
  });
  return { device, context, format };
}

const { device, context, format } = await initWebGPU();
console.log("WebGPU initialized:", { device, context, format });

//---------------

const camera = {
    transform: {
        translation: [0, 1, 3],
        rotation: [0, 0, 0],
    },
    fov: 1,
    near: 0.01,
    far: 10000,
};


function inverseTransform({
    translation = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
} = {}) {
  var scaleMatrix = Matrix.scale(1 / scale[0], 1 / scale[1], 1 / scale[2]);
  var rotationMatrixX = Matrix.rotationX(-rotation[0]);
  var rotationMatrixY = Matrix.rotationY(-rotation[1]);
  var rotationMatrixZ = Matrix.rotationZ(-rotation[2]);
  var translationMatrix = Matrix.translation(-translation[0], -translation[1], -translation[2]);

  var result = Matrix.identity();
  result = Matrix.multiply(result, scaleMatrix);
  result = Matrix.multiply(result, rotationMatrixX);
  result = Matrix.multiply(result, rotationMatrixY);
  result = Matrix.multiply(result, rotationMatrixZ);
  result = Matrix.multiply(result, translationMatrix);

  return result;
}

function getViewProjectionMatrix(camera, canvas) {
  let viewMatrix = inverseTransform(camera.transform);
  let perspectiveMatrix = Matrix.perspective(
    camera.fov,
    canvas.width / canvas.height,
    camera.near,
    camera.far
  );
  return Matrix.multiply(perspectiveMatrix, viewMatrix);
}

// Get final VP matrix - VP means ViewProjection
let vpMatrix = getViewProjectionMatrix(camera, canvas);

// Uniform buffer for vpMatrix
const uniformBufferSize = 4 * 16; // 4x4 matrix
const uniformBuffer = device.createBuffer({
  size: uniformBufferSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformBuffer, 0, toColumnMajor(vpMatrix));

canvas.style.cursor = "none";
canvas.requestPointerLock();
// Event listeners

canvas.addEventListener("click", () => {
    canvas.requestPointerLock();
});

canvas.addEventListener("mousemove", (event) => {
    camera.transform.rotation[1] -= event.movementX * 0.002;
    camera.transform.rotation[0] -= event.movementY * 0.002;

    device.queue.writeBuffer(uniformBuffer, 0, toColumnMajor(getViewProjectionMatrix(camera, canvas)));
});

let currentChunkX = 461;
let currentChunkZ = 101;

const defaultSpeed = 0.1;
let speed = defaultSpeed;
let moving = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
}
document.addEventListener("keydown", (event) => {
  const eventKey = event.key.toLowerCase();
  console.log("Key down:", eventKey);
    if (eventKey === "w") {
        moving.forward = true;
    } 
    if (eventKey === "s") {
        moving.backward = true;
    }
    if (eventKey === "a") {
        moving.left = true;
    }
    if (eventKey === "d") {
        moving.right = true;
    }
    if (eventKey === " ") {
        moving.up = true;
    }
    if (eventKey === "shift") {
        moving.down = true;
    }
    if (eventKey === "q") {
        speed = 5.0;
    }
    if (eventKey === "z") {
        currentChunkX += 1;
        buildVertices(currentChunkX, currentChunkZ).then(() => {
            device.queue.writeBuffer(vertexBuffer, 0, vertices);
        });
    }
    if (eventKey === "t") {
        currentChunkX -= 1;
        buildVertices(currentChunkX, currentChunkZ).then(() => {
            device.queue.writeBuffer(vertexBuffer, 0, vertices);
        });
    }
    if (eventKey === "+") {
        currentChunkZ += 1;
        buildVertices(currentChunkX, currentChunkZ).then(() => {
            device.queue.writeBuffer(vertexBuffer, 0, vertices);
        });
    }
    if (eventKey === "-") {
        currentChunkZ -= 1;
        buildVertices(currentChunkX, currentChunkZ).then(() => {
            device.queue.writeBuffer(vertexBuffer, 0, vertices);
        });
    }
    device.queue.writeBuffer(uniformBuffer, 0, toColumnMajor(getViewProjectionMatrix(camera, canvas)));
});

document.addEventListener("keyup", (event) => {
  const eventKey = event.key.toLowerCase();
    if (eventKey === "w") {
        moving.forward = false;
    }
    if (eventKey === "s") {
        moving.backward = false;
    }
    if (eventKey === "a") {
        moving.left = false;
    }
    if (eventKey === "d") {
        moving.right = false;
    }
    if (eventKey === " ") {
        moving.up = false;
    }
    if (eventKey === "shift") {
        moving.down = false;
    }
    if (eventKey === "q") {
        speed = defaultSpeed;
    }
    device.queue.writeBuffer(uniformBuffer, 0, toColumnMajor(getViewProjectionMatrix(camera, canvas)));
});

function updateMovement() {

  const forward = [
        Math.sin(camera.transform.rotation[1]),
        0,
        Math.cos(camera.transform.rotation[1]),
    ];
    const right = [
        Math.cos(camera.transform.rotation[1]),
        0,
        -Math.sin(camera.transform.rotation[1]),
    ];

    if (moving.forward) {
        camera.transform.translation[0] -= forward[0] * speed;
        camera.transform.translation[2] -= forward[2] * speed;
    } 
    if (moving.backward) {
        camera.transform.translation[0] += forward[0] * speed;
        camera.transform.translation[2] += forward[2] * speed;
    } 
    if (moving.left) {
        camera.transform.translation[0] -= right[0] * speed;
        camera.transform.translation[2] -= right[2] * speed;
    } 
    if (moving.right) {
        camera.transform.translation[0] += right[0] * speed;
        camera.transform.translation[2] += right[2] * speed;
    } 
    if (moving.up) {
        camera.transform.translation[1] += speed;
    } 
    if (moving.down) {
        camera.transform.translation[1] -= speed;
    }
    device.queue.writeBuffer(uniformBuffer, 0, toColumnMajor(getViewProjectionMatrix(camera, canvas)));

    currentChunkX = Math.floor(camera.transform.translation[0] / 1000);
    currentChunkZ = Math.floor(camera.transform.translation[2] / 1000);

}
    

//---------------

/* Previous buildVertices implementation
const FLOATS_PER_VERTEX = 8;  // X, Y, Z, W, R, G, B, A
const VERTICES_PER_SQUARE = 6*2;

let vertices = null;
let indices = null;

async function buildVertices(chunkX = 0, chunkZ = 0) {
  console.log(`Building vertices for chunk (${chunkX}, ${chunkZ})`);
  const heightMapData = await loadHeightMap("map/heightmap_FRI.hmap");
  console.log("Height map data received in main.js:", heightMapData);

  const width = Math.floor(heightMapData.length/3)*2;   // number of x samples (your logic)
  const depth = Math.floor(heightMapData[0].length/3)*2;     // number of z samples

  const numSquares = width * depth;
  const totalFloats = numSquares * VERTICES_PER_SQUARE * FLOATS_PER_VERTEX;

  const buffer = new Float32Array(totalFloats);
  console.log("Final byte length:", buffer.byteLength);
  let i = 0;

  for (let x = 0 + chunkX*99; x < width + (chunkX*99); x++) {
    for (let z = 0 + chunkZ*99; z < depth + (chunkZ*99); z++) {
      const [r, g, b, height] = heightMapData[x][z];

      const fx = x;
      const fy = height;
      const fz = z;

      const cr = r / 255;
      const cg = g / 255;
      const cb = b / 255;
      const ca = 1.0;

      // Convenience helpers to push a vertex
      const pushVertex = (vx, vy, vz, buffer) => {
        buffer[i++] = vx;
        buffer[i++] = vy;
        buffer[i++] = vz;
        buffer[i++] = 1.0; // w
        buffer[i++] = cr;
        buffer[i++] = cg;
        buffer[i++] = cb;
        buffer[i++] = ca;
      };

      const topY = fy;
      const bottomY = fy - 1;

      const x0 = fx;
      const x1 = fx + 1;
      const z0 = fz;
      const z1 = fz + 1;

      // ----------------------
      // 1) TOP FACE (y = topY)
      // ----------------------
      // Triangle 1: (x0, topY, z0), (x0, topY, z1), (x1, topY, z0)
      pushVertex(x0, topY, z0, buffer);
      pushVertex(x0, topY, z1, buffer);
      pushVertex(x1, topY, z0, buffer);

      // Triangle 2: (x0, topY, z1), (x1, topY, z0), (x1, topY, z1)
      pushVertex(x0, topY, z1, buffer);
      pushVertex(x1, topY, z0, buffer);
      pushVertex(x1, topY, z1, buffer);

      // -------------------------
      // 2) FRONT FACE (z = z0)
      // -------------------------
      // Triangle 3: (x0, topY, z0), (x1, topY, z0), (x0, bottomY, z0)
      pushVertex(x0, topY, z0);
      pushVertex(x1, topY, z0);
      pushVertex(x0, bottomY, z0);

      // Triangle 4: (x1, topY, z0), (x0, bottomY, z0), (x1, bottomY, z0)
      pushVertex(x1, topY, z0);
      pushVertex(x0, bottomY, z0);
      pushVertex(x1, bottomY, z0);

      // ------------------------
      // 3) LEFT FACE (x = x0)
      // ------------------------
      // Triangle 5: (x0, topY, z0), (x0, bottomY, z0), (x0, topY, z1)
      pushVertex(x0, topY, z0);
      pushVertex(x0, bottomY, z0);
      pushVertex(x0, topY, z1);

      // Triangle 6: (x0, bottomY, z0), (x0, topY, z1), (x0, bottomY, z1)
      pushVertex(x0, bottomY, z0);
      pushVertex(x0, topY, z1);
      pushVertex(x0, bottomY, z1);

      // -------------------------
      // 4) RIGHT FACE (x = x1)
      // -------------------------
      // Triangle 7: (x1, topY, z0), (x1, topY, z1), (x1, bottomY, z0)
      pushVertex(x1, topY, z0);
      pushVertex(x1, topY, z1);
      pushVertex(x1, bottomY, z0);

      // Triangle 8: (x1, bottomY, z0), (x1, topY, z1), (x1, bottomY, z1)
      pushVertex(x1, bottomY, z0);
      pushVertex(x1, topY, z1);
      pushVertex(x1, bottomY, z1);

      // -------------------------
      // 5) BACK FACE (z = z1)
      // -------------------------
      // Triangle 9: (x0, topY, z1), (x1, topY, z1), (x0, bottomY, z1)
      pushVertex(x0, topY, z1);
      pushVertex(x1, topY, z1);
      pushVertex(x0, bottomY, z1);

      // Triangle 10: (x1, topY, z1), (x1, bottomY, z1), (x0, bottomY, z1)
      pushVertex(x1, topY, z1);
      pushVertex(x1, bottomY, z1);
      pushVertex(x0, bottomY, z1);

      // -------------------------
      // 6) BOTTOM FACE (y = bottomY)
      // -------------------------
      // Triangle 11: (x0, bottomY, z0), (x1, bottomY, z0), (x0, bottomY, z1)
      pushVertex(x0, bottomY, z0);
      pushVertex(x1, bottomY, z0);
      pushVertex(x0, bottomY, z1);

      // Triangle 12: (x0, bottomY, z1), (x1, bottomY, z0), (x1, bottomY, z1)
      pushVertex(x0, bottomY, z1);
      pushVertex(x1, bottomY, z0);
      pushVertex(x1, bottomY, z1);
    }
  }

  vertices = buffer;
  console.log("Total vertices:", vertices.length / FLOATS_PER_VERTEX);
}
*/

const FLOATS_PER_VERTEX = 8; // x, y, z, w, r, g, b, a;

// let vertices;
// let indices;

async function buildVerticesAndIndices(chunkX = 0, chunkZ = 0) {
  const heightMapData = await loadHeightMap("map/heightmap_UDO.hmap");

  const width  = Math.floor(heightMapData.length);
  const depth  = Math.floor(heightMapData[0].length);

  const vertexArray = [];
  const indexArray = [];

  const cubeIndicesTemplate = [
    // top
    0, 1, 2,  1, 3, 2,
    // bottom
    4, 6, 5,  5, 6, 7,
    // front
    0, 2, 4,  2, 6, 4,
    // back
    1, 5, 3,  3, 5, 7,
    // left
    0, 4, 1,  1, 4, 5,
    // right
    2, 3, 6,  3, 7, 6,
  ];

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
      const bottomY = fy - 1;

      const x0 = fx;
      const x1 = fx + 1;
      const z0 = fz;
      const z1 = fz + 1;

      // 8 unique corners of the cube
      const corners = [
        [x0, topY,    z0],
        [x1, topY,    z0],
        [x0, topY,    z1],
        [x1, topY,    z1],
        [x0, bottomY, z0],
        [x1, bottomY, z0],
        [x0, bottomY, z1],
        [x1, bottomY, z1],
      ];

      // push 8 vertices
      for (const [vx, vy, vz] of corners) {
        vertexArray.push(
          vx, vy, vz, 1.0,   // position + w
          cr, cg, cb, ca     // color
        );
      }

      // push indices for this cube
      const baseIndex = cubeIndex * 8;
      for (const idx of cubeIndicesTemplate) {
        indexArray.push(baseIndex + idx);
      }

      cubeIndex++;
    }
  }

  // Convert to typed arrays for GPU
  vertices = new Float32Array(vertexArray);
  indices  = new Uint32Array(indexArray);
}

async function buildMap(chunkX = 0, chunkZ = 0) {
  let localVertices;
  let localIndices;
  const heightMapData = await loadHeightMap(chunkX, chunkZ);

  const width  = Math.floor(heightMapData.length);
  const depth  = Math.floor(heightMapData[0].length);

  const mapArray = Array.from({ length: depth }, () => Array(width));

  const vertexArray = [];

  const cubeIndicesTemplate = [
    // top
    0, 1, 2,  1, 3, 2,
    // bottom
    4, 6, 5,  5, 6, 7,
    // front
    0, 2, 4,  2, 6, 4,
    // back
    1, 5, 3,  3, 5, 7,
    // left
    0, 4, 1,  1, 4, 5,
    // right
    2, 3, 6,  3, 7, 6,
  ];

  const cubeIndices = {
    top:    [0, 1, 2,  1, 3, 2],
    bottom: [4, 6, 5,  5, 6, 7],
    front:  [0, 2, 4,  2, 6, 4],
    back:   [1, 5, 3,  3, 5, 7],
    left:   [0, 4, 1,  1, 4, 5],
    right:  [2, 3, 6,  3, 7, 6],
  }

  let cubeIndex = 0;

  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) {
      const [r, g, b, height] = heightMapData[x][z];

      const fx = x /* + chunkX * width */;
      const fy = height;
      const fz = z /* + chunkZ * depth */;

      const cr = r / 255;
      const cg = g / 255;
      const cb = b / 255;
      const ca = 1;

      const topY = fy;

      const x0 = fx;
      const x1 = fx + 1;
      const z0 = fz;
      const z1 = fz + 1;

      // 4 unique corners of the plane
      const corners = [
        [x0, topY,    z0],
        [x1, topY,    z0],
        [x0, topY,    z1],
        [x1, topY,    z1],
      ];

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
      for (const idx of cubeIndices['top']) {
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
      const x1 = x-1;
      const z1 = z;

      if (x1 >= 0 && z1 >= 0) {
        const neighborIndices = mapArray[x1][z1];
        // connect current to neighbor
        const bridge1 = [
          currentIndices[0], neighborIndices[4], currentIndices[2],
          currentIndices[0], neighborIndices[1], neighborIndices[4],
        ];
        mapArray[x][z].push(...bridge1);
      }

      // 0 -1
      const x2 = x;
      const z2 = z-1;
      if (x2 >= 0 && z2 >= 0) {
        const neighborIndices = mapArray[x2][z2];
        // connect current to neighbor
        const bridge2 = [
          currentIndices[0], neighborIndices[2], currentIndices[1],
          currentIndices[1], neighborIndices[2], neighborIndices[4],
        ];
        mapArray[x][z].push(...bridge2);
      }
    }
  }

  // Convert to typed arrays for GPU
  localVertices = new Float32Array(vertexArray);
  localIndices  = new Uint32Array(mapArray.flat(3));

  return {localVertices, localIndices};
}

// Call this once at startup / when needed
// await buildVertices();
// await buildVerticesAndIndices();
let vertices;
let { localVertices, localIndices: indices } = await buildMap(currentChunkX, currentChunkZ);
vertices = localVertices;

const vertexBuffer = device.createBuffer({
  label: "Cell vertices",
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, vertices);

const indexBuffer = device.createBuffer({
  label: "Cell indices",
  size: indices.byteLength,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(indexBuffer, 0, indices);

// let { localVertices: v, localIndices: indices1 } = await buildMap(-1, 0, "map/heightmap_NM.hmap");
// vertices = v;

// const vertexBuffer1 = device.createBuffer({
//   label: "Cell vertices",
//   size: vertices.byteLength,
//   usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
// });
// device.queue.writeBuffer(vertexBuffer1, 0, vertices);

// const indexBuffer1 = device.createBuffer({
//   label: "Cell indices",
//   size: indices1.byteLength,
//   usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
// });
// device.queue.writeBuffer(indexBuffer1, 0, indices1);

const vertexBufferLayout = {
  arrayStride: 8 * 4, // 8 floats x 4 bytes
  attributes: [
    {
      // Position
      format: "float32x4",
      offset: 0,
      shaderLocation: 0, // Position, see vertex shader
    },
    {
      // Color
      format: "float32x4",
      offset: 4*4,
      shaderLocation: 1, // Color, see vertex shader
    }

  ],
};

const wgslShader = await fetch("shader.wgsl").then((response) => response.text());

const cellShaderModule = device.createShaderModule({
  label: "Cell shader",
  code: wgslShader,
});

const depthFormat = "depth24plus";

let depthTexture = device.createTexture({
  size: {
    width: canvas.width,
    height: canvas.height,
    depthOrArrayLayers: 1,
  },
  format: depthFormat,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

const cellPipeline = device.createRenderPipeline({
  label: "Cell pipeline",
  layout: "auto",
  vertex: {
    module: cellShaderModule,
    entryPoint: "vertexMain",
    buffers: [vertexBufferLayout]
  },
  fragment: {
    module: cellShaderModule,
    entryPoint: "fragmentMain",
    targets: [{
      format: format
    }]
  },
  depthStencil: {
    format: depthFormat,
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});

const bindGroup = device.createBindGroup({
  label: "Cell renderer bind group",
  layout: cellPipeline.getBindGroupLayout(0),
  entries: [{
    binding: 0,
    resource: { buffer: uniformBuffer }
  }],
});





// const uniformBufferSize = 4 * 16; // 4x4 matrix
// const uniformBuffer = device.createBuffer({
//   size: uniformBufferSize,
//   usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
// });

// const uniformBindGroup = device.createBindGroup({
//   layout: pipeline.getBindGroupLayout(0),
//   entries: [
//     {
//       binding: 0,
//       resource: {
//         buffer: uniformBuffer,
//       },
//     },
//   ],
// });




// pass.end();
// device.queue.submit([encoder.finish()]);

let fps = 0;
let lastTime = performance.now();
let frameCount = 0;
const fpsCounter = document.getElementById("fpscounter");

setInterval(() => {
  fpsCounter.textContent = fps.toString();
}, 500);
function frame() {
  updateMovement();

  const commandEncoder = device.createCommandEncoder();
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0.4, a: 1 },
    }],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthLoadOp: "clear",
      depthStoreOp: "store",
      depthClearValue: 1.0,
    },
  });

  pass.setPipeline(cellPipeline);
  pass.setBindGroup(0, bindGroup); // New line!
  
  // pass.draw(vertices.length / 8);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32"); // or "uint16"
  pass.drawIndexed(indices.length);

  // pass.setVertexBuffer(0, vertexBuffer1);
  // pass.setIndexBuffer(indexBuffer1, "uint32"); // or "uint16"
  // pass.drawIndexed(indices1.length);
  
  pass.end();
  device.queue.submit([commandEncoder.finish()]);

  // FPS calculation
  frameCount++;
  const now = performance.now();
  const delta = now - lastTime;

  if (delta >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastTime += delta;
    
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);