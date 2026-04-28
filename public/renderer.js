/**
 * @fileoverview Renderer module for the Voxel project.
 * Handles all WebGPU initialization, pipeline setup, and frame rendering.
 * Includes support for Vertex Texture Fetch (VTF) based chunk instancing.
 */

import * as Matrix from "./matrix.js";
import ChunkManager from "./chunk-manager.js";
import { vprint } from "./vprint.js";

/**
 * Manages the WebGPU rendering pipeline, resource allocation, and drawing loops.
 * Responsible for translating chunk data into GPU-bound textures and rendering them.
 */
export default class Renderer {
  /** @type {boolean} Indicates whether the renderer has completed initialization. */
  initialized = false;

  /**
   * Constructs the Renderer instance.
   * 
   * @param {GPUDevice} device - The WebGPU logical device.
   * @param {GPUCanvasContext} context - The WebGPU canvas context.
   * @param {GPUTextureFormat} format - The preferred canvas texture format.
   * @param {HTMLCanvasElement} canvas - The target HTML canvas element.
   * @param {number} [voxelSize=100] - Scale of individual voxels.
   * @param {number} [chunkSize=1000] - Dimensional size of a chunk.
   */
  constructor(device, context, format, canvas, voxelSize = 100, chunkSize = 1000) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
    this.voxelSize = voxelSize;
    this.chunkSize = chunkSize;
  }

  /**
   * Initializes the rendering engine, compiling shaders, and setting up buffers.
   * Also bootstraps the ChunkManager to begin yielding chunk data.
   * 
   * @param {Player} player - The local player instance for camera tracking.
   * @param {HTMLCanvasElement} canvas - The target HTML canvas element.
   * @returns {Promise<void>} Resolves when initialization is complete.
   */
  async init(player, canvas) {
    this.player = player;
    vprint("Initializing renderer...");
    
    await this.getShaders();
    this.createBufferLayouts();
    this.createBuffers();

    this.updateVPMatrix(player.camera, canvas);
    
    // Compile the core shader module using the loaded WGSL code.
    this.cellShaderModule = this.device.createShaderModule({
      label: "Cell shader",
      code: this.wgslShader,
    });

    this.createDepthTexture();
    this.createPipelines();
    this.createBindGroups();

    // Initialize the chunk lifecycle manager.
    this.chunkManager = new ChunkManager(
      this.device,
      this.voxelSize,
      this.chunkSize
    );
    this.chunkManager.startLoop(player);
    
    this.initialized = true;
    vprint("Renderer initialized");
  }

  /**
   * Converts a 4x4 mathematical matrix into a 1D column-major Float32Array.
   * Required for WebGPU uniform buffer matrix representations.
   * 
   * @param {number[][]} m - 4x4 matrix represented as a 2D array.
   * @returns {Float32Array} Column-major 1D array.
   */
  toColumnMajor(m) {
    // prettier-ignore
    return new Float32Array([
      m[0][0], m[1][0], m[2][0], m[3][0],
      m[0][1], m[1][1], m[2][1], m[3][1],
      m[0][2], m[1][2], m[2][2], m[3][2],
      m[0][3], m[1][3], m[2][3], m[3][3],
    ]);
  }

  /**
   * Updates the global View-Projection matrix uniform buffer.
   * 
   * @param {Object} camera - The active camera instance.
   * @param {HTMLCanvasElement} canvas - The canvas, used for aspect ratio calculations.
   */
  updateVPMatrix(camera, canvas) {
    if (!this.initialized) return;
    let vpMatrix = Matrix.getViewProjectionMatrix(camera, canvas);

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.toColumnMajor(vpMatrix)
    );
  }

  /**
   * Fetches and loads the WGSL shader source code.
   * 
   * @returns {Promise<void>} Resolves when the shader source is loaded.
   */
  async getShaders() {
    this.wgslShader = await fetch("shader.wgsl").then((response) =>
      response.text()
    );
  }

  /**
   * Defines the memory layout for vertex attributes to be used by the pipeline.
   */
  createBufferLayouts() {
    this.vertexBufferLayout = {
      arrayStride: 3 * 4, // 3 floats x 4 bytes (position x, y, z)
      attributes: [
        {
          format: "float32x3",
          offset: 0,
          shaderLocation: 0,
        }
      ],
    };
  }

  /**
   * Creates core GPU buffers including the global uniform buffer and the unit cube mesh.
   * The unit cube serves as the base geometry for instanced rendering or VTF.
   */
  createBuffers() {
    // Uniform buffer for vpMatrix (4x4 float matrix)
    const uniformBufferSize = 4 * 16; 
    this.uniformBuffer = this.device.createBuffer({
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Unit Cube Vertex Buffer
    // This cube geometry is shared across all chunk cells and scaled/positioned in the shader.
    const cubeVerts = new Float32Array([
      // Top face (y=1) -> height driven
      0, 1, 0,  1, 1, 0,  0, 1, 1,  1, 1, 1,
      // Front face (+z)
      0, 0, 1,  1, 0, 1,  0, 1, 1,  1, 1, 1,
      // Back face (-z)
      1, 0, 0,  0, 0, 0,  1, 1, 0,  0, 1, 0,
      // Left face (-x)
      0, 0, 0,  0, 0, 1,  0, 1, 0,  0, 1, 1,
      // Right face (+x)
      1, 0, 1,  1, 0, 0,  1, 1, 1,  1, 1, 0,
    ]);
    
    const cubeIndices = new Uint32Array([
      0, 1, 2,  1, 3, 2, // Top
      4, 5, 6,  5, 7, 6, // Front
      8, 9, 10,  9, 11, 10, // Back
      12, 13, 14,  13, 15, 14, // Left
      16, 17, 18,  17, 19, 18, // Right
    ]);
    
    this.gridIndexCount = cubeIndices.length;
    
    this.gridVertexBuffer = this.device.createBuffer({
      size: cubeVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridVertexBuffer, 0, cubeVerts);
    
    this.gridIndexBuffer = this.device.createBuffer({
      size: cubeIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.gridIndexBuffer, 0, cubeIndices);
    


    // Single face for better instancing not requiring to draw full cube geometry
    const faceVerts = new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 0, 1,  1, 0, 1,
    ]);

    const faceIndices = new Uint32Array([
      0, 1, 2,  1, 3, 2,
    ]);

    this.faceIndexCount = faceIndices.length;

    this.faceVertexBuffer = this.device.createBuffer({
      size: faceVerts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.faceVertexBuffer, 0, faceVerts);

    this.faceIndexBuffer = this.device.createBuffer({
      size: faceIndices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.faceIndexBuffer, 0, faceIndices);
  }

  /**
   * Creates the depth texture attachment used for Z-buffering.
   */
  createDepthTexture() {
    this.depthFormat = "depth24plus";
    this.depthTexture = this.device.createTexture({
      size: {
        width: this.canvas.width,
        height: this.canvas.height,
        depthOrArrayLayers: 1,
      },
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /**
   * Assembles the WebGPU render pipelines and bind group layouts.
   * Configures the VTF (Vertex Texture Fetch) layout for heightmap and color sampling.
   */
  createPipelines() {
    // Layout for the global View-Projection matrix
    this.globalBindGroupLayout = this.device.createBindGroupLayout({
      label: "Global Bind Group Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }
      ]
    });

    // Layout for per-chunk Vertex Texture Fetch data
    this.vtfBindGroupLayout = this.device.createBindGroupLayout({
      label: "VTF Bind Group Layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: "non-filtering" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, texture: { sampleType: "uint" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.globalBindGroupLayout, this.vtfBindGroupLayout]
    });

    this.cellPipeline = this.device.createRenderPipeline({
      label: "Cell pipeline",
      layout: pipelineLayout,
      vertex: {
        module: this.cellShaderModule,
        entryPoint: "vertexMain",
        buffers: [this.vertexBufferLayout],
      },
      fragment: {
        module: this.cellShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.format }],
      },
        primitive: {
        topology: 'triangle-list',
        cullMode: 'back', // <--- Add this! Let the hardware do the heavy lifting
      },
      depthStencil: {
        format: this.depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // We use a nearest-neighbor sampler for discrete voxel boundaries
    this.nearestSampler = this.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest'
    });
  }

  /**
   * Creates the global bind groups, such as the View-Projection uniform bind group.
   */
  createBindGroups() {
    this.bindGroup = this.device.createBindGroup({
      label: "Global uniform bind group",
      layout: this.globalBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });
  }

  /**
   * Uploads raw chunk data to the GPU by generating color and height textures.
   * 
   * @param {Object} chunk - The target chunk entity.
   * @param {Object} dataObj - The raw chunk data containing height and color arrays.
   * @param {Uint8Array} dataObj.colorData - Flattened RGBA color data.
   * @param {Uint16Array} dataObj.heightData - Flattened 16-bit height data.
   */
  createWebGPUTextures(chunk, dataObj) {
    const size = Math.sqrt(dataObj.heightData.length); // Assuming square aspect ratio

    // Create and write the color texture (rgba8unorm)
    const colorTexture = this.device.createTexture({
      size: [size, size, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: colorTexture },
      dataObj.colorData,
      { bytesPerRow: size * 4 },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    // Create and write the height texture (r16uint)
    const heightTexture = this.device.createTexture({
      size: [size, size, 1],
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: heightTexture },
      dataObj.heightData,
      { bytesPerRow: size * 2 },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    // Bind the generated textures to the chunk instance
    chunk.setTextures(colorTexture, heightTexture);
  }

  /** @type {number} Monotonically increasing frame counter. */
  frameIndex = 0;

  /**
   * Main rendering loop execution. 
   * Encodes render commands, processes chunk textures, and submits the command buffer.
   */
  render() {
    if (!this.initialized) return;
    this.frameIndex++;

    const commandEncoder = this.device.createCommandEncoder();
    
    // Begin the main render pass, clearing the color and depth attachments.
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0.4, a: 1 }, // Sky blue background
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });
    
    // Bind global pipeline state
    pass.setPipeline(this.cellPipeline);
    pass.setBindGroup(0, this.bindGroup);

    // TODO: Change to actual variable later
    let renderMode = "face";
    if (renderMode == "cube") {
      pass.setVertexBuffer(0, this.gridVertexBuffer);
      pass.setIndexBuffer(this.gridIndexBuffer, "uint32");
    } else {
      pass.setVertexBuffer(0, this.faceVertexBuffer);
      pass.setIndexBuffer(this.faceIndexBuffer, "uint32");
    }

    // Iterate through all chunks managed by the ChunkManager
    const chunkData = this.chunkManager.getChunkData();
    for (const chunk of chunkData.values()) {
      
      // If a chunk has raw data ready but no GPU textures, initialize them
      if (chunk.rawData && (!chunk.colorTexture || !chunk.heightTexture)) {
        this.createWebGPUTextures(chunk, chunk.rawData);
      }

      // Skip rendering if textures are still unavailable
      if (!chunk.colorTexture || !chunk.heightTexture) {
        vprint("Chunk at", chunk.position, "not ready for rendering");
        continue;
      }

      //const chunkSize = chunk.colorTexture.width;

      // Lazy-initialize the VTF (Vertex Texture Fetch) bind group for this specific chunk
      if (!chunk.vtfBindGroup) {
        // Uniform buffer storing position, size, and scale of the chunk
        const chunkInfoBuffer = this.device.createBuffer({
          size: 16, // 4 floats: x, z, size, scale
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(chunkInfoBuffer, 0, new Float32Array([
          chunk.position.x, chunk.position.z, this.chunkSize, chunk.scale
        ]));

        chunk.vtfBindGroup = this.device.createBindGroup({
          layout: this.vtfBindGroupLayout,
          entries: [
            { binding: 0, resource: this.nearestSampler },
            { binding: 1, resource: chunk.heightTexture.createView() },
            { binding: 2, resource: chunk.colorTexture.createView() },
            { binding: 3, resource: { buffer: chunkInfoBuffer } },
          ]
        });
      }

      // Execute the instanced draw call for the chunk
      pass.setBindGroup(1, chunk.vtfBindGroup);
      if (renderMode == "cube") {
        pass.drawIndexed(this.gridIndexCount, this.chunkSize * this.chunkSize);
      } else {
        pass.drawIndexed(this.faceIndexCount, this.chunkSize * this.chunkSize * 5);
      }
    }

    // Finalize and submit the command buffer to the GPU queue
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}
